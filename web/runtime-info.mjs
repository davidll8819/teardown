import {createHash, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';

// Authenticated diagnostics only: never include keys, tokens, paths or raw IDs.
export function createRuntimeInfo({local = false, hostname, model, buildFile = new URL('../web-dist/build-info.json', import.meta.url)} = {}) {
  const instanceId = randomUUID();
  let sourceFingerprint = null;
  try {
    const build = JSON.parse(readFileSync(buildFile, 'utf8'));
    if (/^[a-f0-9]{64}$/.test(build.sourceFingerprint)) sourceFingerprint = build.sourceFingerprint;
  } catch {}
  return scope => ({
    application: '3D simulator',
    sourceFingerprint,
    instanceId,
    mode: local ? 'local' : 'platform',
    hostname: hostname || null,
    model: model || null,
    scopeFingerprint: createHash('sha256').update(JSON.stringify([hostname || 'local', scope.org, scope.user])).digest('hex').slice(0, 24),
  });
}
