import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash, createHmac, randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {imageFixture, pngFixture} from './reference-fixtures.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('declared router authentication cannot be bypassed by a local-mode override', () => {
  const result = spawnSync(process.execPath, ['web/server.mjs'], {
    cwd: root,
    env: {FOURYI_ROUTER_IDENTITY_REQUIRED: '1', TEARDOWN_LOCAL_MODE: '1'},
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /local_mode_conflicts_with_router_identity/);
  assert.doesNotMatch(result.stderr, /gateway_configuration_missing/);
});

async function waitFor(check, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function unusedPort() {
  const reservation = http.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  return port;
}

// This exercises the production CLI and declared runtime configuration against
// a synthetic local gateway. It is not a Docker or real 4yi installation test.
test('declared production entry supports signed image jobs and durable restart recovery', {timeout: 30000}, async () => {
  const manifest = JSON.parse(await readFile(path.join(root, '4yi-app.json'), 'utf8'));
  const service = manifest.services.find(item => item.route === 'public');
  assert.equal(manifest.services.filter(item => item.route === 'public').length, 1);
  assert.equal(service.healthPath, '/healthz');
  assert.equal(service.env.FOURYI_ROUTER_IDENTITY_REQUIRED, '1');
  assert.equal(service.env.TEARDOWN_REASONING_EFFORT, 'none');
  const modelEnv = Object.fromEntries(manifest.models.map(slot => [slot.env, slot.default]));
  assert.equal(modelEnv.TEXT_MODEL, 'gpt-6-sol');

  const directory = await mkdtemp(path.join(os.tmpdir(), 'teardown-deployment-'));
  const key = randomBytes(32).toString('hex');
  const hostname = 'deployment-fixture.example';
  const token = 'deployment-fixture-token';
  const reference = imageFixture({padding: 20000});
  const analysis = {summary: 'Fixture reference analysis', observedParts: ['Orange pixel fixture'], inferredParts: [], uncertainties: ['Synthetic image; no physical assembly validation.']};
  const gatewayRequests = [];
  const fixtureErrors = [];
  let interruptedRequestSeen = false;
  const gateway = http.createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/v1/chat/completions');
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      gatewayRequests.push(body);
      assert.equal(body.model, 'gpt-6-sol');
      assert.equal(body.reasoning_effort, 'none');
      assert.ok(body.max_completion_tokens > 0);
      if (JSON.stringify(body.messages).includes('deployment-interruption-fixture')) {
        interruptedRequestSeen = true;
        // Leave this synthetic response pending until the application is killed.
        return;
      }
      const user = body.messages.find(message => message.role === 'user');
      assert.ok(Array.isArray(user.content));
      assert.equal(user.content.find(part => part.type === 'image_url').image_url.url, `data:image/png;base64,${reference.data}`);
      let message;
      if (!body.tools) {
        message = {role: 'assistant', content: JSON.stringify(analysis)};
      } else {
        const previous = body.messages.filter(item => item.role === 'tool');
        for (const item of previous) assert.equal(JSON.parse(item.content).error, undefined);
        const plan = [
          ['read_reference', {name: 'v8-geometry'}],
          ['write_file', {path: 'main.js', content: `import * as THREE from 'three';
import {ringGeometry} from 'teardown-stage';
import {createMechanicalExhibit} from 'teardown-exhibit';
const root = new THREE.Group();
const part = new THREE.Mesh(ringGeometry({outerRadius:2,innerRadius:1,depth:1}),new THREE.MeshStandardMaterial());
root.add(part);
createMechanicalExhibit({container:document.getElementById('app'),title:'deployment fixture result',root,
parts:[{id:'ring',label:'Fixture ring',object:part,cutaway:true,explode:[0,0,2]}],
parameters:[{id:'speed',label:'Fixture speed',value:1,min:0,max:2,step:0.1}],
readouts:[{id:'angle',label:'Fixture angle',key:'angle',unit:'rad'}],
model:({time,parameters})=>({angle:time*parameters.speed}),update:state=>{part.rotation.z=state.angle;}});`}],
          ['write_file', {path: 'exhibit-text.json', content: JSON.stringify({version: 1,
            title: {'zh-CN': '部署测试模型', en: 'deployment fixture result'}, subtitle: {'zh-CN': '仅测试部署流程', en: 'Deployment fixture only'},
            parts: {ring: {label: {'zh-CN': '测试圆环', en: 'Fixture ring'}, description: {'zh-CN': '测试部件', en: 'Fixture part'}}},
            parameters: {speed: {label: {'zh-CN': '测试速度', en: 'Fixture speed'}, unit: {'zh-CN': '', en: ''}}},
            readouts: {angle: {label: {'zh-CN': '测试角度', en: 'Fixture angle'}, unit: {'zh-CN': 'rad', en: 'rad'}}}, tour: []})}],
          ['build_simulator', {entry: 'main.js'}],
          ['finish', {}],
        ];
        assert.ok(previous.length < plan.length);
        const [name, args] = plan[previous.length];
        message = {role: 'assistant', tool_calls: [{id: `fixture-${previous.length}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]};
      }
      res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify({choices: [{message}]}));
    } catch (error) {
      fixtureErrors.push(error);
      res.writeHead(500, {'content-type': 'application/json'});
      res.end(JSON.stringify({error: 'fixture_request_invalid'}));
    }
  });

  let child;
  let childExit;
  let childOutput = '';
  let base;
  const signed = (method, url, body = '', user = 'alice', org = 'org-a') => {
    const time = String(Date.now());
    const nonce = randomBytes(16).toString('hex');
    const hash = createHash('sha256').update(body).digest('hex');
    return {
      'x-xclaw-user-id': user, 'x-xclaw-owner-org-id': org,
      'x-xclaw-hostname': hostname, 'x-xclaw-identity-time': time,
      'x-xclaw-identity-nonce': nonce,
      'x-xclaw-identity-signature': createHmac('sha256', key).update(JSON.stringify(['v1', hostname, method, url, user, org, time, nonce, hash])).digest('hex'),
      origin: `https://${hostname}`, 'content-type': 'application/json',
    };
  };
  const request = (url, options = {}) => fetch(`${base}${url}`, {...options, signal: AbortSignal.timeout(2000)});
  const authenticated = (url, user, org) => request(url, {headers: signed('GET', url, '', user, org)});
  const stop = async () => {
    if (!child) return;
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await childExit;
    child = undefined;
  };
  try {
    gateway.listen(0, '127.0.0.1');
    await once(gateway, 'listening');
    const port = await unusedPort();
    assert.notEqual(port, 3000);
    assert.notEqual(port, 4317);
    base = `http://127.0.0.1:${port}`;
    const start = async () => {
      // Deliberately do not spread process.env: no real key, local identity
      // bypass, developer renderer or external gateway can enter this child.
      childOutput = '';
      child = spawn(process.execPath, ['web/server.mjs'], {
        cwd: root,
        env: {
          ...service.env, ...modelEnv, NODE_ENV: 'production', PORT: String(port),
          TEARDOWN_DATA_DIR: directory, FOURYI_ROUTER_IDENTITY_KEY: key,
          XCLAW_APP_HOSTNAME: hostname,
          OPENAI_API_BASE: `http://127.0.0.1:${gateway.address().port}/v1`,
          OPENAI_API_KEY: token,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      childExit = once(child, 'exit');
      for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {childOutput = (childOutput + data).slice(-8000);});
      await waitFor(async () => {
        assert.equal(child.exitCode, null, `Production entry exited: ${childOutput}`);
        assert.equal(child.signalCode, null, `Production entry terminated: ${childOutput}`);
        try {return (await request(service.healthPath)).status === 200;} catch {return false;}
      }, 'production health');
    };
    await start();
    assert.deepEqual(await (await request('/healthz')).json(), {ok: true});
    assert.equal(gatewayRequests.length, 0, 'health must not call the model');
    for (const url of ['/', '/api/jobs']) assert.equal((await request(url)).status, 401);
    assert.equal((await request('/api/jobs', {headers: {'x-xclaw-user-id': 'alice', 'x-xclaw-owner-org-id': 'org-a'}})).status, 401);

    const body = JSON.stringify({description: 'Analyze the uploaded fixture mechanism', references: [reference]});
    assert.ok(Buffer.byteLength(body) > 16384);
    const created = await request('/api/jobs', {method: 'POST', headers: signed('POST', '/api/jobs', body), body});
    assert.equal(created.status, 202);
    const job = await created.json();
    const jobUrl = `/api/jobs/${job.id}`;
    const previewUrl = `${jobUrl}/preview`;
    const imageUrl = `${jobUrl}/references/${job.references[0].id}`;
    const completed = await waitFor(async () => {
      const result = await authenticated(jobUrl);
      assert.equal(result.status, 200);
      const current = await result.json();
      assert.notEqual(current.status, 'failed', JSON.stringify({job: current, fixtureErrors: fixtureErrors.map(error => error.message)}));
      return current.status === 'completed' && current;
    }, 'completed fixture job');
    assert.deepEqual(completed.analysis, analysis);
    assert.deepEqual(fixtureErrors, []);
    assert.equal(gatewayRequests.length, 6, 'one image analysis plus five authoring tool turns');
    const preview = await authenticated(previewUrl);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-security-policy'), /sandbox allow-scripts/);
    assert.match(preview.headers.get('content-security-policy'), /connect-src 'none'/);
    const html = await preview.text();
    assert.match(html, /deployment fixture result/);
    const image = await authenticated(imageUrl);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), pngFixture({padding: 20000}));
    for (const [user, org] of [['bob', 'org-a'], ['alice', 'org-b']]) {
      assert.deepEqual((await (await authenticated('/api/jobs', user, org)).json()).jobs, []);
      for (const url of [jobUrl, previewUrl, imageUrl]) assert.equal((await authenticated(url, user, org)).status, 404);
    }

    const pendingBody = JSON.stringify({description: 'deployment-interruption-fixture'});
    const pendingResponse = await request('/api/jobs', {method: 'POST', headers: signed('POST', '/api/jobs', pendingBody), body: pendingBody});
    assert.equal(pendingResponse.status, 202);
    const pending = await pendingResponse.json();
    await waitFor(() => interruptedRequestSeen, 'pending fixture gateway request');
    assert.equal((await (await authenticated(`/api/jobs/${pending.id}`)).json()).status, 'generating');
    const replayHeaders = signed('GET', '/api/jobs');
    assert.equal((await request('/api/jobs', {headers: replayHeaders})).status, 200);
    await stop();
    await start();
    // Keep the signature fresh so a rejection proves durable nonce replay
    // protection rather than merely expiration of the 30-second time window.
    assert.ok(Date.now() - Number(replayHeaders['x-xclaw-identity-time']) < 30000);
    assert.equal((await request('/api/jobs', {headers: replayHeaders})).status, 401);
    const restored = await (await authenticated(jobUrl)).json();
    assert.equal(restored.status, 'completed');
    assert.deepEqual(restored.analysis, analysis);
    assert.equal(await (await authenticated(previewUrl)).text(), html);
    assert.deepEqual(Buffer.from(await (await authenticated(imageUrl)).arrayBuffer()), pngFixture({padding: 20000}));
    const interrupted = await (await authenticated(`/api/jobs/${pending.id}`)).json();
    assert.equal(interrupted.status, 'failed');
    assert.equal(interrupted.error, 'interrupted');
    assert.equal(gatewayRequests.length, 7, 'restart must not silently rerun the model');
    assert.deepEqual(fixtureErrors, []);
  } finally {
    await stop();
    gateway.closeAllConnections();
    await new Promise(resolve => gateway.close(resolve));
    await rm(directory, {recursive: true, force: true});
  }
});
