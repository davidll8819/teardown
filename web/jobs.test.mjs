import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readdir, readFile, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createJobStore} from './jobs.mjs';
import {imageFixture, pngFixture} from './reference-fixtures.mjs';

test('jobs and artifacts are scoped to the requesting user and organization', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-jobs-'));
  try {
    let finish;
    const gate = new Promise(resolve => { finish = resolve; });
    const store = createJobStore({directory, generate: async () => { await gate; return {html: '<p>result</p>'}; }});
    const owner = {org: 'one', user: 'alice'};
    const job = await store.create(owner, 'Show a crank mechanism');
    await assert.rejects(store.create(owner, 'A second mechanism'), /job_already_running/);
    await assert.rejects(store.get({org: 'one', user: 'bob'}, job.id), /job_not_found/);
    await assert.rejects(store.get({org: 'two', user: 'alice'}, job.id), /job_not_found/);
    await assert.rejects(store.artifact(owner, job.id), /job_not_ready/);
    finish();
    for (let i = 0; i < 100 && (await store.get(owner, job.id)).status !== 'completed'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(await store.artifact(owner, job.id), '<p>result</p>');
    assert.equal((await store.list(owner)).length, 1);
    assert.deepEqual(await store.list({org: 'two', user: 'alice'}), []);
    await assert.rejects(store.get(owner, '../secret'), /job_not_found/);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('cancellation is scoped and aborts the active generator', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-cancel-'));
  try {
    const store = createJobStore({directory, generate: ({signal}) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true}))});
    const scope = {org: 'one', user: 'alice'};
    const job = await store.create(scope, 'Show a crank mechanism');
    await assert.rejects(store.cancel({org: 'one', user: 'bob'}, job.id), /job_not_found/);
    await store.cancel(scope, job.id);
    for (let i = 0; i < 100 && (await store.get(scope, job.id)).status !== 'cancelled'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await store.get(scope, job.id)).status, 'cancelled');
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('real progress is persisted in order without overwriting terminal state', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-progress-'));
  try {
    let finish;
    const gate = new Promise(resolve => { finish = resolve; });
    const store = createJobStore({directory, generate: async ({onProgress}) => {
      onProgress('generating'); onProgress('working'); onProgress('working');
      onProgress('building'); onProgress('invalid_phase');
      await gate; return {html: '<p>built</p>'};
    }});
    const scope = {org: 'one', user: 'alice'};
    const job = await store.create(scope, '电机');
    let state;
    for (let i = 0; i < 100; i++) {state = await store.get(scope, job.id); if (state.phase === 'building') break; await new Promise(resolve => setTimeout(resolve, 5));}
    assert.equal(state.status, 'generating');
    assert.deepEqual(state.stages.map(stage => stage.phase), ['generating', 'working', 'building']);
    finish();
    for (let i = 0; i < 100; i++) {state = await store.get(scope, job.id); if (state.status === 'completed') break; await new Promise(resolve => setTimeout(resolve, 5));}
    assert.equal(state.status, 'completed');
    const reopened = createJobStore({directory, generate: async () => { throw new Error('must_not_run'); }});
    assert.equal((await reopened.get(scope, job.id)).status, 'completed');
    assert.deepEqual((await reopened.list(scope))[0].stages, state.stages);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('public failure reasons are actionable and never include provider messages', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-errors-'));
  try {
    const store = createJobStore({directory, generate: async () => {throw Object.assign(new Error('private provider diagnostic'), {status: 400});}});
    const scope = {org: 'one', user: 'alice'};
    const job = await store.create(scope, '短描述');
    let state;
    for (let i = 0; i < 100; i++) {state = await store.get(scope, job.id); if (state.status === 'failed') break; await new Promise(resolve => setTimeout(resolve, 5));}
    assert.equal(state.error, 'gateway_request_invalid');
    assert.doesNotMatch(JSON.stringify(state), /private provider/);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('reference images and analysis persist privately, survive restart and reach the generator', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-reference-jobs-'));
  try {
    let finish;
    const gate = new Promise(resolve => { finish = resolve; });
    let lateAnalysis; let lateProgress;
    const analysis = {summary: '可见马达外壳。', observedParts: ['外壳'], inferredParts: ['可能包含转子'], uncertainties: ['内部不可见']};
    const sources = {'main.js': "import {parts} from './model.js'; window.motorParts=parts;", 'model.js': 'export const parts = ["stator", "rotor"];'};
    const input = imageFixture();
    const store = createJobStore({directory, generate: async ({references, onProgress, onAnalysis}) => {
      assert.deepEqual(references, [input]);
      onProgress('analyzing'); onAnalysis(analysis); onProgress('working');
      lateAnalysis = onAnalysis; lateProgress = onProgress;
      await gate; return {html: '<p>motor</p>', sources};
    }});
    const scope = {org: 'one', user: 'alice'};
    const job = await store.create(scope, '图片中的马达', [input]);
    assert.equal(job.references.length, 1);
    assert.deepEqual(Object.keys(job.references[0]).sort(), ['bytes', 'height', 'id', 'mimeType', 'name', 'width']);
    assert.doesNotMatch(JSON.stringify(job), /base64|buffer|iVBOR/);
    let state;
    for (let i = 0; i < 100; i++) {state = await store.get(scope, job.id); if (state.phase === 'working') break; await new Promise(resolve => setTimeout(resolve, 5));}
    assert.deepEqual(state.analysis, analysis);
    assert.equal(state.status, 'generating');
    const reference = await store.reference(scope, job.id, job.references[0].id);
    assert.deepEqual(reference.buffer, pngFixture());
    await assert.rejects(store.reference({org: 'one', user: 'bob'}, job.id, reference.id), /job_not_found/);
    await assert.rejects(store.reference({org: 'two', user: 'alice'}, job.id, reference.id), /job_not_found/);
    await assert.rejects(store.reference(scope, job.id, '../secret'), /reference_not_found/);
    finish();
    for (let i = 0; i < 100; i++) {state = await store.get(scope, job.id); if (state.status === 'completed') break; await new Promise(resolve => setTimeout(resolve, 5));}
    lateAnalysis({...analysis, summary: 'late update'}); lateProgress('reviewing');
    const reopened = createJobStore({directory, generate: async () => {throw new Error('unexpected');}});
    const restored = await reopened.get(scope, job.id);
    assert.equal(restored.status, 'completed'); assert.deepEqual(restored.analysis, analysis);
    assert.deepEqual((await reopened.reference(scope, job.id, reference.id)).buffer, pngFixture());
    const [scopeDirectory] = await readdir(directory);
    const saved = path.join(directory, scopeDirectory, job.id);
    assert.equal((await stat(path.join(saved, `${reference.id}.image`))).mode & 0o777, 0o600);
    assert.doesNotMatch(await readFile(path.join(saved, 'job.json'), 'utf8'), /iVBOR/);
    assert.deepEqual(JSON.parse(await readFile(path.join(saved, 'project.json'), 'utf8')), sources);
    assert.equal((await stat(path.join(saved, 'project.json'))).mode & 0o777, 0o600);
    assert.doesNotMatch(JSON.stringify(restored), /sources|motorParts|main\.js/);
    assert.doesNotMatch(JSON.stringify(await reopened.list(scope)), /sources|motorParts|main\.js/);
    assert.doesNotMatch(await readFile(path.join(saved, 'job.json'), 'utf8'), /sources|motorParts|main\.js/);
  } finally {await rm(directory, {recursive: true, force: true});}
});
