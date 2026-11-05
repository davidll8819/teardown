import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readdir, readFile, stat, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createJobStore} from './jobs.mjs';
import {imageFixture, pngFixture} from './reference-fixtures.mjs';

test('corrupt persisted metadata is reported as storage failure rather than hidden or missing', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-corrupt-'));
  try {
    const scope = {org: 'one', user: 'alice'};
    const store = createJobStore({directory, generate: async () => ({html: '<p>saved</p>'})});
    const job = await store.create(scope, '一个真实保存的任务');
    for (let i = 0; i < 100 && (await store.get(scope, job.id)).status !== 'completed'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await store.get(scope, job.id)).status, 'completed');
    const [scopeDirectory] = await readdir(directory);
    await writeFile(path.join(directory, scopeDirectory, job.id, 'job.json'), '{broken');
    await assert.rejects(store.get(scope, job.id), /storage_unavailable/);
    await assert.rejects(store.list(scope), /storage_unavailable/);
    await assert.rejects(store.artifact(scope, job.id), /storage_unavailable/);
    await assert.rejects(store.get({org: 'two', user: 'alice'}, job.id), /job_not_found/);
    assert.deepEqual(await store.list({org: 'two', user: 'alice'}), []);
  } finally {await rm(directory, {recursive: true, force: true});}
});

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

test('quality evidence is bounded, scoped and retained after restarting the store', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-quality-'));
  try {
    const scope = {org: 'one', user: 'alice'};
    const store = createJobStore({directory, generate: async () => ({html: '<p>result</p>', quality: {
      compile: 'passed', visual: 'passed', interaction: 'not_run', reviewAttempts: 8,
      privateDiagnostic: 'must not be published',
      feedback: [
        {attempt: 1, passed: false, feedback: '零件相互穿插。', image: 'private screenshot'},
        {attempt: 2, passed: true, feedback: `已修正。\u0000${'形'.repeat(1100)}`},
        {attempt: 8, passed: 'true', feedback: '仅保留明确的检查结果。'},
        {attempt: 4, passed: true, feedback: '超出记录数量'},
      ],
    }})});
    const job = await store.create(scope, '带传动与仪表的机器');
    let state;
    for (let i = 0; i < 100; i++) {state = await store.get(scope, job.id); if (state.status === 'completed') break; await new Promise(resolve => setTimeout(resolve, 5));}
    assert.equal(state.status, 'completed');
    assert.deepEqual(Object.keys(state.quality).sort(), ['compile', 'feedback', 'interaction', 'reviewAttempts', 'visual']);
    assert.equal(state.quality.visual, 'passed');
    assert.equal(state.quality.interaction, 'not_run');
    assert.equal(state.quality.reviewAttempts, 3);
    assert.equal(state.quality.feedback.length, 3);
    assert.equal(state.quality.feedback[1].feedback.length, 1000);
    assert.deepEqual(state.quality.feedback[2], {attempt: 3, passed: false, feedback: '仅保留明确的检查结果。'});
    assert.doesNotMatch(JSON.stringify(state), /private|must not|超出记录|\\u0000/);
    const reopened = createJobStore({directory, generate: async () => {throw new Error('must_not_run');}});
    assert.deepEqual((await reopened.get(scope, job.id)).quality, state.quality);
    assert.deepEqual((await reopened.list(scope))[0].quality, state.quality);
    await assert.rejects(reopened.get({org: 'two', user: 'alice'}, job.id), /job_not_found/);
    await assert.rejects(reopened.get({org: 'one', user: 'bob'}, job.id), /job_not_found/);
    const [scopeDirectory] = await readdir(directory);
    const persisted = await readFile(path.join(directory, scopeDirectory, job.id, 'job.json'), 'utf8');
    assert.deepEqual(JSON.parse(persisted).quality, state.quality);
    assert.doesNotMatch(persisted, /privateDiagnostic|private screenshot|超出记录/);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('legacy completed jobs do not imply visual or interaction checks and remain unchanged on disk', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-legacy-quality-'));
  try {
    const scope = {org: 'one', user: 'alice'};
    const store = createJobStore({directory, generate: async () => ({html: '<p>legacy result</p>', visualReviewed: true})});
    const job = await store.create(scope, '原来的模拟器');
    let state;
    for (let i = 0; i < 100; i++) {state = await store.get(scope, job.id); if (state.status === 'completed') break; await new Promise(resolve => setTimeout(resolve, 5));}
    assert.equal(state.quality.visual, 'passed');
    assert.equal(state.quality.interaction, 'not_run');
    assert.equal(state.quality.compile, 'not_run');
    const [scopeDirectory] = await readdir(directory);
    const file = path.join(directory, scopeDirectory, job.id, 'job.json');
    const oldJob = JSON.parse(await readFile(file, 'utf8'));
    delete oldJob.quality;
    const original = JSON.stringify(oldJob);
    await writeFile(file, original);
    const reopened = createJobStore({directory, generate: async () => {throw new Error('must_not_run');}});
    const expected = {compile: 'not_run', visual: 'not_run', interaction: 'not_run', reviewAttempts: 0, feedback: []};
    assert.deepEqual((await reopened.get(scope, job.id)).quality, expected);
    assert.deepEqual((await reopened.list(scope))[0].quality, expected);
    assert.equal(await readFile(file, 'utf8'), original);
    assert.equal(await reopened.artifact(scope, job.id), '<p>legacy result</p>');
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('failed review retains safe feedback without exposing the underlying error', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-review-failed-'));
  try {
    const store = createJobStore({directory, generate: async () => {throw Object.assign(new Error('private renderer diagnostic'), {
      code: 'visual_review_limit', quality: {compile: 'passed', visual: 'failed', interaction: 'failed', reviewAttempts: 3, feedback: [{attempt: 3, passed: false, feedback: '拆解后零件偏离装配轴线。'}]},
    });}});
    const scope = {org: 'one', user: 'alice'};
    const job = await store.create(scope, '展示拆解过程');
    let state;
    for (let i = 0; i < 100; i++) {state = await store.get(scope, job.id); if (state.status === 'failed') break; await new Promise(resolve => setTimeout(resolve, 5));}
    assert.equal(state.error, 'visual_review_limit');
    assert.equal(state.quality.visual, 'failed');
    assert.equal(state.quality.interaction, 'failed');
    assert.equal(state.quality.feedback[0].feedback, '拆解后零件偏离装配轴线。');
    assert.doesNotMatch(JSON.stringify(state), /private renderer/);
    await assert.rejects(store.artifact(scope, job.id), /job_not_ready/);
    const compileStore = createJobStore({directory, generate: async () => {throw Object.assign(new Error('agent_step_limit'), {
      quality: {compile: 'failed', visual: 'not_run', interaction: 'not_run', reviewAttempts: 0, feedback: []},
    });}});
    const compilation = await compileStore.create(scope, '无法编译的模型');
    for (let i = 0; i < 100; i++) {state = await compileStore.get(scope, compilation.id); if (state.status === 'failed') break; await new Promise(resolve => setTimeout(resolve, 5));}
    assert.equal(state.quality.compile, 'failed');
    assert.equal(state.quality.visual, 'not_run');
  } finally {await rm(directory, {recursive: true, force: true});}
});
