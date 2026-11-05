import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRuntimeInfo} from './runtime-info.mjs';

test('runtime diagnostics identify deployment and scope without publishing identity or credentials', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'simulator-runtime-'));
  try {
    const buildFile = path.join(directory, 'build-info.json');
    await writeFile(buildFile, JSON.stringify({sourceFingerprint: 'a'.repeat(64), secret: 'never-publish-me'}));
    const report = createRuntimeInfo({hostname: 'simulator.example', model: 'test-model', buildFile});
    const owner = {org: 'private-org', user: 'private-user'};
    const first = report(owner);
    assert.equal(first.sourceFingerprint, 'a'.repeat(64));
    assert.equal(first.mode, 'platform');
    assert.deepEqual(report(owner), first);
    assert.notEqual(report({...owner, user: 'another-user'}).scopeFingerprint, first.scopeFingerprint);
    assert.notEqual(report({...owner, org: 'another-org'}).scopeFingerprint, first.scopeFingerprint);
    assert.notEqual(createRuntimeInfo({buildFile})(owner).instanceId, first.instanceId);
    assert.doesNotMatch(JSON.stringify(first), /private-org|private-user|never-publish-me|build-info|\/tmp/);
    const missing = createRuntimeInfo({local: true, buildFile: path.join(directory, 'missing')})(owner);
    assert.equal(missing.sourceFingerprint, null);
    assert.equal(missing.mode, 'local');
  } finally {await rm(directory, {recursive: true, force: true});}
});
