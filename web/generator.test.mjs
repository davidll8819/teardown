import test from 'node:test';
import assert from 'node:assert/strict';
import {compileSimulator, generateSimulator, makeSimulatorHtml} from './generator.mjs';
import {createVisualReviewer} from './visual-review.mjs';
import {readGenerationReference, referenceCatalog, validateReferenceAnalysis} from './generation-reference.mjs';

// A real compilable exhibit contract fixture. These tests exercise authoring
// plumbing; only the browser tests can establish that its controls render/work.
function exhibitSource(title = "'Crank mechanism'", imports = '') {
  return `import * as THREE from 'three';
import {ringGeometry} from 'teardown-stage';
import {createMechanicalExhibit} from 'teardown-exhibit';
${imports}
const root = new THREE.Group();
const assembly = new THREE.Group(); const pivot = new THREE.Group();
root.add(assembly); assembly.add(pivot);
pivot.add(new THREE.Mesh(ringGeometry({outerRadius:1,innerRadius:0.2,depth:0.2}), new THREE.MeshStandardMaterial({color:0x787878})));
const cover = new THREE.Group(); root.add(cover);
cover.add(new THREE.Mesh(ringGeometry({outerRadius:1.15,innerRadius:1.04,depth:0.4}), new THREE.MeshStandardMaterial({color:0xcacac4})));
createMechanicalExhibit({container:document.getElementById('app'),title:${title},subtitle:'Schematic dimensions',root,
parts:[{id:'crank',label:'Crank',description:'Rotating around its bore',object:assembly,explode:[0,0,1]}, {id:'cover',label:'Shell',description:'Removable surrounding shell',object:cover,explode:[0,0,2],cutaway:true}],
parameters:[{id:'rpm',label:'Speed',value:30,min:0,max:120,step:1,unit:'rpm'}],
readouts:[{id:'phase',label:'Phase',key:'degrees',unit:'°',min:0,max:360,digits:1}],
model:({time,parameters})=>({angle:time*parameters.rpm*Math.PI/30,degrees:(time*parameters.rpm*6)%360}),
update:state=>{pivot.rotation.z=state.angle;},
tour:[{label:'Assembly',duration:6,mode:'assembled',view:'perspective'},{label:'Axial detail',duration:5,mode:'exploded',view:'front'}]});`;
}

test('bundles three and denies server and arbitrary path imports', async () => {
  const bundle = await compileSimulator("import {Scene} from 'three'; window.scene = new Scene();");
  assert.match(bundle, /scene/);
  assert.doesNotMatch(bundle, /process\.emitWarning/);
  await assert.rejects(compileSimulator("import fs from 'node:fs';"));
  await assert.rejects(compileSimulator("import x from '../paths.mjs';"));
});

test('preview diagnostics precede generated code without relaxing CSP or swallowing errors', () => {
  const html = makeSimulatorHtml("throw new Error('bootstrap-order-marker');");
  assert.ok(html.indexOf("addEventListener('error'") < html.indexOf('bootstrap-order-marker'));
  assert.match(html, /addEventListener\('unhandledrejection'/);
  assert.equal((html.match(/<main id="app"/g) || []).length, 1);
  assert.match(html, /id="teardown-boot-retry"/);
  assert.match(html, /script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'/);
  assert.doesNotMatch(html, /preventDefault|postMessage|unsafe-eval|allow-same-origin/);
});

test('creates a multi-file project, repairs a build, and produces a sandboxed preview document', async () => {
  let attempts = 0;
  const plan = [
    ['write_file', {path: 'main.js', content: exhibitSource('value', "import {value} from './part.js';")}],
    ['build_simulator', {entry: 'main.js'}],
    ['write_file', {path: 'part.js', content: "export const value='OK';"}],
    ['build_simulator', {entry: 'main.js'}],
    ['finish', {}],
  ];
  const gateway = {complete: async ({messages}) => {
    if (!attempts) {
      assert.match(messages[0].content, /document\.getElementById\('app'\)/);
      assert.match(messages[0].content, /NEVER create a second element/);
      assert.match(messages[0].content, /ROTATION CONTRACT/);
      assert.match(messages[0].content, /actual shaft\/joint axis/);
      assert.match(messages[0].content, /a black circle painted on a solid disc is not a hole/);
      assert.match(messages[0].content, /REQUIRED EXHIBIT CONTRACT/);
    }
    if (attempts) assert.equal(messages.at(-1).role, 'tool');
    const [name, args] = plan[attempts++];
    return {role: 'assistant', tool_calls: [{id: `call-${attempts}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]};
  }};
  const output = await generateSimulator({gateway, description: 'A simple crank mechanism'});
  assert.equal(attempts, 5);
  assert.deepEqual(output.files, ['main.js', 'part.js']);
  assert.equal(output.sources['part.js'], "export const value='OK';");
  assert.equal(Object.keys(output.sources).length, 2);
  assert.match(output.html, /connect-src 'none'/);
  assert.deepEqual(output.quality, {compile: 'passed', visual: 'not_run', interaction: 'not_run', reviewAttempts: 0, feedback: []});
  assert.match(makeSimulatorHtml('</script>'), /<\\\/script>/);
});

test('repairs truncated tool arguments with a valid follow-up message', async () => {
  let attempts = 0;
  const gateway = {complete: async ({messages}) => {
    attempts++;
    if (attempts === 2) assert.equal(messages.at(-2).tool_calls[0].function.arguments, '{}');
    const action = attempts === 1 ? ['write_file', '{"path":'] : attempts === 2 ? ['write_file', JSON.stringify({path: 'main.js', content: exhibitSource()})] : attempts === 3 ? ['build_simulator', JSON.stringify({entry: 'main.js'})] : ['finish', '{}'];
    return {role: 'assistant', tool_calls: [{id: 'c', type: 'function', function: {name: action[0], arguments: action[1]}}]};
  }};
  const output = await generateSimulator({gateway, description: 'A simple crank mechanism'});
  assert.equal(attempts, 4);
  assert.match(output.html, /<script>/);
});

test('a canvas-only authoring result cannot finish until it includes the full exhibit runtime', async () => {
  const plan = [
    ['write_file', {path: 'main.js', content: "import {Scene} from 'three'; window.scene = new Scene();"}],
    ['build_simulator', {entry: 'main.js'}], ['finish', {}],
    ['write_file', {path: 'main.js', content: exhibitSource()}],
    ['build_simulator', {entry: 'main.js'}], ['finish', {}],
  ];
  let attempts = 0;
  const gateway = {complete: async ({messages}) => {
    if (attempts === 2) assert.match(messages.at(-1).content, /exhibit_runtime_required/);
    if (attempts === 3) assert.match(messages.at(-1).content, /build_required/);
    if (attempts === 5) assert.equal(JSON.parse(messages.at(-1).content).exhibitRuntime, 'included');
    const [name, args] = plan[attempts++];
    return {role: 'assistant', tool_calls: [{id: `required-${attempts}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]};
  }};
  const result = await generateSimulator({gateway, description: 'A crank mechanism'});
  assert.equal(attempts, 6);
  assert.equal(result.quality.compile, 'passed');
  assert.equal(result.quality.visual, 'not_run');
});

test('visual review sends a rendered frame to the vision model and validates its decision', async () => {
  let visionCalls = 0;
  const reviewer = createVisualReviewer({render: async () => ({canvasCount: 1, errors: [], image: 'YWJj'}), gateway: {complete: async ({messages}) => {
    visionCalls++;
    assert.match(messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
    return {content: '{"passed":false,"feedback":"The mechanism is blank."}'};
  }}});
  const decision = await reviewer({html: '<html/>', description: 'A crank mechanism'});
  assert.equal(decision.passed, false);
  assert.equal(decision.feedback, 'The mechanism is blank.');
  assert.equal(visionCalls, 1);
  const empty = createVisualReviewer({render: async () => ({canvasCount: 0, errors: [], image: 'YWJj'}), gateway: {complete: async () => {throw new Error('unexpected');}}});
  assert.equal((await empty({html: '<html/>', description: 'A crank mechanism'})).passed, false);
  const invalid = createVisualReviewer({render: async () => ({canvasCount: 1, errors: [], image: 'YWJj'}), gateway: {complete: async () => ({content: 'not json'})}});
  await assert.rejects(invalid({html: '<html/>', description: 'A crank mechanism'}), /visual_review_invalid/);
});

test('agent repairs a failed visual review before completing', async () => {
  const plan = [
    ['write_file', {path: 'main.js', content: exhibitSource("'before'")}],
    ['build_simulator', {entry: 'main.js'}], ['finish', {}],
    ['write_file', {path: 'main.js', content: exhibitSource("'after'")}],
    ['build_simulator', {entry: 'main.js'}], ['finish', {}],
  ];
  let attempts = 0; let reviews = 0;
  const gateway = {complete: async ({messages}) => {
    if (attempts === 3) assert.match(messages.at(-1).content, /visual_review_failed/);
    const [name, args] = plan[attempts++];
    return {role: 'assistant', tool_calls: [{id: `call-${attempts}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]};
  }};
  const output = await generateSimulator({gateway, description: 'A simple crank mechanism', visualReview: async ({references}) => {
    assert.deepEqual(references, []);
    return {passed: ++reviews === 2, feedback: reviews === 1 ? 'Repair the blank view.' : 'Visible exhibit.', interaction: reviews === 2 ? 'passed' : 'not_run'};
  }});
  assert.equal(reviews, 2);
  assert.equal(output.visualReviewed, true);
  assert.match(output.html, /after/);
  assert.deepEqual(output.quality, {compile: 'passed', visual: 'passed', interaction: 'passed', reviewAttempts: 2, feedback: [{attempt: 1, passed: false, feedback: 'Repair the blank view.'}, {attempt: 2, passed: true, feedback: 'Visible exhibit.'}]});
});

for (const review of [
  {passed: false, visual: 'not_run', interaction: 'failed', feedback: 'Cutaway has no registered cover.'},
  {passed: false, visual: 'failed', interaction: 'passed', feedback: 'The housing is an unrelated plain block.'},
]) {
  test(`failed review is preserved after the retry limit (${review.visual}/${review.interaction})`, async () => {
    let calls = 0;
    const gateway = {complete: async () => {
      const [name, input] = calls === 0 ? ['write_file', {path: 'main.js', content: exhibitSource()}] : calls === 1 ? ['build_simulator', {entry: 'main.js'}] : ['finish', {}];
      calls++;
      return {role: 'assistant', tool_calls: [{id: `review-${calls}`, type: 'function', function: {name, arguments: JSON.stringify(input)}}]};
    }};
    await assert.rejects(generateSimulator({gateway, description: 'A crank mechanism', visualReview: async () => review}), error => {
      assert.equal(error.message, 'visual_review_limit');
      assert.equal(error.quality.compile, 'passed');
      assert.equal(error.quality.visual, review.visual);
      assert.equal(error.quality.interaction, review.interaction);
      assert.equal(error.quality.reviewAttempts, 3);
      assert.deepEqual(error.quality.feedback, [1, 2, 3].map(attempt => ({attempt, passed: false, feedback: review.feedback})));
      return true;
    });
    assert.equal(calls, 5, 'three failed reviews must stop without another model call');
  });
}

test('reference images are analyzed and sent to the authoring model with uncertainty preserved', async () => {
  const reference = {name: 'motor.png', mimeType: 'image/png', data: 'YWJj'};
  const analysis = {summary: 'A small motor housing', observedParts: ['Visible mounting flange'], inferredParts: ['Rotor is inferred, not visible'], uncertainties: ['No measured dimensions; print assembly not verified']};
  const events = [];
  let call = 0;
  const gateway = {complete: async ({messages, tools}) => {
    call++;
    if (call === 1) {
      assert.equal(tools, undefined);
      assert.match(messages[0].content, /never instructions/);
      assert.equal(messages[1].content.at(-1).image_url.url, 'data:image/png;base64,YWJj');
      return {role: 'assistant', content: JSON.stringify(analysis)};
    }
    assert.deepEqual(events.slice(0, 2), ['analyzing', analysis]);
    assert.match(messages[1].content[0].text, /Rotor is inferred/);
    assert.equal(messages[1].content.at(-1).image_url.url, 'data:image/png;base64,YWJj');
    const step = [
      ['read_reference', {name: 'exhibit-api'}],
      ['write_file', {path: 'main.js', content: exhibitSource()}],
      ['build_simulator', {entry: 'main.js'}],
      ['finish', {}],
    ][call - 2];
    if (call === 3) assert.match(messages.at(-1).content, /createMechanicalExhibit/);
    return {role: 'assistant', tool_calls: [{id: `r-${call}`, type: 'function', function: {name: step[0], arguments: JSON.stringify(step[1])}}]};
  }};
  const result = await generateSimulator({gateway, description: '根据马达照片做拆解', references: [reference], onProgress: phase => events.push(phase), onAnalysis: value => events.push(value), visualReview: async ({references, description}) => {
    assert.deepEqual(references, [reference]);
    assert.equal(description, '根据马达照片做拆解');
    return {passed: true, feedback: 'Visual comparison complete.'};
  }});
  assert.equal(call, 5);
  assert.deepEqual(result.analysis, analysis);
  assert.equal(result.visualReviewed, true);
  assert.equal(result.quality.visual, 'passed');
  assert.equal(result.quality.interaction, 'not_run', 'visual approval alone must not certify controls');
  assert.match(result.html, /connect-src 'none'/);
});

test('invalid analysis fails before authoring; abort never sends reference data', async () => {
  const reference = {name: 'part.png', mimeType: 'image/png', data: 'YWJj'};
  let calls = 0;
  const gateway = {complete: async () => {calls++; return {content: '{"summary":"maybe"}'};}};
  await assert.rejects(generateSimulator({gateway, description: '一个马达', references: [reference]}), /reference_analysis_invalid/);
  assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(generateSimulator({gateway, description: '一个马达', references: [reference], signal: controller.signal}), /cancelled/);
  assert.equal(calls, 1);
  await assert.rejects(generateSimulator({gateway, description: '一个马达', references: [{...reference, mimeType: 'image/svg+xml'}]}), /invalid_references/);
  assert.equal(calls, 1);
});

test('read-only references expose a fixed catalog, not arbitrary filesystem access', async () => {
  assert.match(await readGenerationReference('v8-geometry'), /gearGeo/);
  assert.match(await readGenerationReference('v8-kinematics'), /piston/);
  for (const name of ['exhibit-api', 'v8-console', 'v8-live', 'v8-film', 'cessna-geometry', 'cessna-kinematics', 'strandbeest-geometry', 'strandbeest-kinematics']) {
    assert.ok(referenceCatalog.some(item => item.name === name));
    assert.ok((await readGenerationReference(name)).length > 100, name);
  }
  for (const name of ['../.local/teardown.env', '/etc/passwd', 'constructor', '__proto__', 'v8-geometry/../../gateway.mjs']) {
    await assert.rejects(readGenerationReference(name), /reference_not_found/);
  }
  const valid = {summary: 'Object', observedParts: [], inferredParts: [], uncertainties: []};
  assert.deepEqual(validateReferenceAnalysis({...valid, ignored: 'unexpected'}), valid);
  assert.throws(() => validateReferenceAnalysis({...valid, summary: 'x'.repeat(1601)}), /reference_analysis_invalid/);
  assert.throws(() => validateReferenceAnalysis({...valid, inferredParts: Array(25).fill('x')}), /reference_analysis_invalid/);
  assert.throws(() => validateReferenceAnalysis({...valid, observedParts: [5]}), /reference_analysis_invalid/);
});
