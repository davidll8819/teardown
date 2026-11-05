import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {normalizeAnalysis, normalizeReferences} from './references.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function normalizeQuality(value, visualReviewed = false) {
  const quality = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const attempt = value => Number.isInteger(value) ? Math.max(0, Math.min(value, 3)) : 0;
  const check = value => ['passed', 'failed'].includes(value) ? value : 'not_run';
  const feedback = Array.isArray(quality.feedback) ? quality.feedback.slice(0, 3).filter(item => item && typeof item === 'object' && typeof item.feedback === 'string').map(item => ({
    attempt: attempt(item.attempt),
    passed: item.passed === true,
    feedback: item.feedback.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 1000),
  })) : [];
  return {
    compile: check(quality.compile),
    visual: !value && visualReviewed === true ? 'passed' : check(quality.visual),
    interaction: check(quality.interaction),
    reviewAttempts: attempt(quality.reviewAttempts),
    feedback,
  };
}
const publicJob = ({id, description, status, createdAt, updatedAt, error, phase, stages, references, analysis, quality, visualReviewed}) => ({id, description, status, createdAt, updatedAt, ...(error ? {error} : {}), ...(phase ? {phase} : {}), ...(stages ? {stages} : {}), ...(references?.length ? {references} : {}), ...(analysis ? {analysis} : {}), ...(quality || status === 'completed' ? {quality: normalizeQuality(quality, visualReviewed)} : {})});
const phases = new Set(['analyzing', 'generating', 'working', 'building', 'reviewing']);
function failureCode(error) {
  if (error?.status === 401 || error?.status === 403) return 'gateway_auth_failed';
  if (error?.status === 400) return 'gateway_request_invalid';
  if (error?.status === 402) return 'balance_required';
  const code = error?.code || error?.message;
  return ['gateway_configuration_missing', 'gateway_timeout', 'gateway_unreachable', 'model_did_not_call_tools', 'agent_step_limit', 'reference_analysis_invalid', 'visual_review_limit', 'visual_review_invalid', 'visual_response_invalid', 'visual_configuration_invalid'].includes(code) ? code : 'generation_failed';
}

/** Disk-backed jobs. A process owns a single store; scopes are never supplied as paths. */
export function createJobStore({directory, generate, now = () => new Date().toISOString(), maxActive = 3}) {
  const active = new Map();
  const scopeDir = scope => path.join(directory, createHash('sha256').update(JSON.stringify([scope.org, scope.user])).digest('hex'));
  const jobDir = (scope, id) => {
    if (!UUID.test(id)) throw new Error('job_not_found');
    return path.join(scopeDir(scope), id);
  };
  async function save(dir, job) {
    const temporary = path.join(dir, `${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(job), {mode: 0o600});
    await rename(temporary, path.join(dir, 'job.json'));
  }
  async function get(scope, id) {
    try {
      const dir = jobDir(scope, id);
      let job = JSON.parse(await readFile(path.join(dir, 'job.json'), 'utf8'));
      if (['queued', 'generating'].includes(job.status) && active.get(scopeDir(scope))?.id !== id) {
        // A concurrent completion may have replaced the file after the first
        // read but before its in-memory lease was released. Re-read before
        // classifying the run as interrupted.
        job = JSON.parse(await readFile(path.join(dir, 'job.json'), 'utf8'));
        if (['queued', 'generating'].includes(job.status) && active.get(scopeDir(scope))?.id !== id) {
          job.status = 'failed'; job.error = 'interrupted'; job.updatedAt = now(); await save(dir, job);
        }
      }
      return job;
    }
    catch (error) {
      if (error.code === 'ENOENT' || error.message === 'job_not_found') throw new Error('job_not_found');
      throw new Error('storage_unavailable');
    }
  }
  async function list(scope) {
    let ids;
    try { ids = await readdir(scopeDir(scope)); } catch (error) { if (error.code === 'ENOENT') return []; throw new Error('storage_unavailable'); }
    const items = await Promise.all(ids.filter(id => UUID.test(id)).map(id => get(scope, id).catch(error => {
      if (error.message === 'job_not_found') return null;
      throw error;
    })));
    return items.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicJob);
  }
  async function create(scope, description, references = []) {
    if (typeof description !== 'string' || description.trim().length < 2 || description.length > 8000) throw new Error('invalid_description');
    const scopeKey = scopeDir(scope);
    if (active.has(scopeKey)) throw new Error('job_already_running');
    if (active.size >= maxActive) throw new Error('job_capacity_reached');
    const images = normalizeReferences(references);
    const controller = new AbortController();
    active.set(scopeKey, {id: null, controller});
    const id = randomUUID();
    active.get(scopeKey).id = id;
    const dir = jobDir(scope, id);
    const job = {id, description: description.trim(), status: 'queued', createdAt: now(), updatedAt: now(), ...(images.length ? {references: images.map(({buffer, ...metadata}) => metadata)} : {})};
    try {
      await mkdir(dir, {recursive: true, mode: 0o700});
      for (const image of images) await writeFile(path.join(dir, `${image.id}.image`), image.buffer, {mode: 0o600, flag: 'wx'});
      await save(dir, job);
    }
    catch (error) { active.delete(scopeKey); await rm(dir, {recursive: true, force: true}).catch(() => {}); throw error; }
    const run = async () => {
      let progressWrites = Promise.resolve();
      let acceptingUpdates = true;
      const enqueueSnapshot = () => {
        const snapshot = structuredClone(job);
        // Progress and reference analysis share one queue so neither can
        // replace a newer snapshot or a final terminal state.
        progressWrites = progressWrites.then(() => save(dir, snapshot));
        void progressWrites.catch(() => {});
      };
      const onProgress = phase => {
        if (!acceptingUpdates || !phases.has(phase) || controller.signal.aborted || job.phase === phase) return;
        job.phase = phase; job.updatedAt = now();
        job.stages = [...(job.stages || []), {phase, at: job.updatedAt}];
        enqueueSnapshot();
      };
      const onAnalysis = analysis => {
        if (!acceptingUpdates || controller.signal.aborted) return;
        job.analysis = normalizeAnalysis(analysis); job.updatedAt = now();
        enqueueSnapshot();
      };
      try {
        job.status = 'generating'; job.updatedAt = now(); await save(dir, job);
        if (controller.signal.aborted) throw new Error('cancelled');
        const result = await generate({description: job.description, references: images.map(({name, mimeType, buffer}) => ({name, mimeType, data: buffer.toString('base64')})), signal: controller.signal, onProgress, onAnalysis});
        if (!job.analysis && result.analysis) onAnalysis(result.analysis);
        acceptingUpdates = false;
        await progressWrites;
        if (controller.signal.aborted) throw new Error('cancelled');
        // Keep the bounded virtual project for later visual repairs. These
        // files stay in one private JSON document, never executable paths or
        // public task metadata.
        if (result.sources !== undefined) await writeFile(path.join(dir, 'project.json'), JSON.stringify(result.sources), {mode: 0o600});
        await writeFile(path.join(dir, 'simulator.html'), result.html, {mode: 0o600});
        job.quality = normalizeQuality(result.quality, result.visualReviewed);
        job.status = 'completed';
      } catch (error) {
        acceptingUpdates = false;
        job.status = controller.signal.aborted ? 'cancelled' : 'failed';
        if (!controller.signal.aborted) console.error('generation failed:', typeof error?.code === 'string' ? error.code : typeof error?.message === 'string' && /^[a-z_]+$/.test(error.message) ? error.message : 'unknown', 'status:', Number.isInteger(error?.status) ? error.status : 'none');
        if (!controller.signal.aborted) {
          job.error = failureCode(error);
          if (error?.quality) job.quality = normalizeQuality(error.quality);
        }
      } finally {
        acceptingUpdates = false;
        await progressWrites.catch(() => {});
        job.updatedAt = now(); await save(dir, job).catch(() => {}); active.delete(scopeKey);
      }
    };
    void run();
    return publicJob(job);
  }
  async function artifact(scope, id) {
    const job = await get(scope, id);
    if (job.status !== 'completed') throw new Error('job_not_ready');
    return readFile(path.join(jobDir(scope, id), 'simulator.html'), 'utf8');
  }
  async function cancel(scope, id) {
    const job = await get(scope, id);
    const execution = active.get(scopeDir(scope));
    if (!execution || execution.id !== id || !['queued', 'generating'].includes(job.status)) throw new Error('job_not_running');
    execution.controller.abort();
    return {id, cancellationRequested: true};
  }
  async function reference(scope, id, referenceId) {
    const job = await get(scope, id);
    if (!UUID.test(referenceId)) throw new Error('reference_not_found');
    const metadata = job.references?.find(image => image.id === referenceId);
    if (!metadata) throw new Error('reference_not_found');
    const buffer = await readFile(path.join(jobDir(scope, id), `${referenceId}.image`));
    return {buffer, ...metadata};
  }
  return {create, list, get: async (scope, id) => publicJob(await get(scope, id)), artifact, cancel, reference};
}
