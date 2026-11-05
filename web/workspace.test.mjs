import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace} from './workspace.mjs';

test('builds a multi-file project without reading local server files', async () => {
  const ws = createWorkspace();
  ws.write('main.js', "import {value} from './parts/crank.js'; import {Scene} from 'three'; window.result = [value, new Scene()];");
  ws.write('parts/crank.js', 'export const value = 42;');
  const snapshot = ws.sources();
  snapshot['parts/crank.js'] = 'tampered';
  assert.equal(ws.read('parts/crank.js'), 'export const value = 42;');
  ws.write('later.js', 'export const later = true;');
  assert.equal(snapshot['later.js'], undefined);
  await ws.compile(); assert.match(ws.artifact(), /42/);
  assert.throws(() => ws.write('../secret.js', 'x'), /invalid_path/);
  ws.write('main.js', "import x from '../paths.mjs';");
  assert.throws(() => ws.artifact(), /build_required/);
  await assert.rejects(ws.compile());
  ws.write('main.js', "import x from 'node:fs';"); await assert.rejects(ws.compile());
});

test('bundles only the exact trusted studio module, retaining the filesystem boundary', async () => {
  const ws = createWorkspace();
  ws.write('main.js', "import {createMechanicalStage, ringGeometry} from 'teardown-stage'; window.studio = createMechanicalStage; window.ring = ringGeometry({outerRadius: 2, innerRadius: 1, depth: 1});");
  await ws.compile();
  assert.match(ws.artifact(), /stage_container_required/);
  assert.match(ws.artifact(), /invalid_ring_dimensions/);
  for (const specifier of ['teardown-stage/../gateway.mjs', 'teardown-stage/other.js', '/etc/passwd', '../simulator-stage.js', 'three/addons/controls/OrbitControls.js']) {
    ws.write('main.js', `import x from ${JSON.stringify(specifier)}; window.x = x;`);
    await assert.rejects(ws.compile(), undefined, specifier);
  }
});
