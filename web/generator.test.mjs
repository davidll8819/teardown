import test from 'node:test';
import assert from 'node:assert/strict';
import {compileSimulator, generateSimulator, makeSimulatorHtml} from './generator.mjs';
import {createVisualReviewer} from './visual-review.mjs';
import {readGenerationReference, validateReferenceAnalysis} from './generation-reference.mjs';

test('bundles three and denies server and arbitrary path imports', async () => {
  const bundle = await compileSimulator("import {Scene} from 'three'; window.scene = new Scene();");
  assert.match(bundle, /scene/);
  assert.doesNotMatch(bundle, /process\.emitWarning/);
  await assert.rejects(compileSimulator("import fs from 'node:fs';"));
  await assert.rejects(compileSimulator("import x from '../paths.mjs';"));
});

test('creates a multi-file project, repairs a build, and produces a sandboxed preview document', async () => {
  let attempts = 0;
  const plan = [
    ['write_file', {path: 'main.js', content: "import {value} from './part.js'; document.querySelector('#app').textContent=value;"}],
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
  assert.match(makeSimulatorHtml('</script>'), /<\\\/script>/);
});

test('repairs truncated tool arguments with a valid follow-up message', async () => {
  let attempts = 0;
  const gateway = {complete: async ({messages}) => {
    attempts++;
    if (attempts === 2) assert.equal(messages.at(-2).tool_calls[0].function.arguments, '{}');
    const action = attempts === 1 ? ['write_file', '{"path":'] : attempts === 2 ? ['write_file', JSON.stringify({path: 'main.js', content: "document.querySelector('#app').textContent='OK'"})] : attempts === 3 ? ['build_simulator', JSON.stringify({entry: 'main.js'})] : ['finish', '{}'];
    return {role: 'assistant', tool_calls: [{id: 'c', type: 'function', function: {name: action[0], arguments: action[1]}}]};
  }};
  const output = await generateSimulator({gateway, description: 'A simple crank mechanism'});
  assert.equal(attempts, 4);
  assert.match(output.html, /<script>/);
});

test('visual review sends a rendered frame to the vision model and validates its decision', async () => {
  let visionCalls = 0;
  const reviewer = createVisualReviewer({render: async () => ({canvasCount: 1, errors: [], image: 'YWJj'}), gateway: {complete: async ({messages}) => {
    visionCalls++;
    assert.match(messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
    return {content: '{"passed":false,"feedback":"The mechanism is blank."}'};
  }}});
  assert.deepEqual(await reviewer({html: '<html/>', description: 'A crank mechanism'}), {passed: false, feedback: 'The mechanism is blank.'});
  assert.equal(visionCalls, 1);
  const empty = createVisualReviewer({render: async () => ({canvasCount: 0, errors: [], image: 'YWJj'}), gateway: {complete: async () => {throw new Error('unexpected');}}});
  assert.equal((await empty({html: '<html/>', description: 'A crank mechanism'})).passed, false);
  const invalid = createVisualReviewer({render: async () => ({canvasCount: 1, errors: [], image: 'YWJj'}), gateway: {complete: async () => ({content: 'not json'})}});
  await assert.rejects(invalid({html: '<html/>', description: 'A crank mechanism'}), /visual_review_invalid/);
});

test('agent repairs a failed visual review before completing', async () => {
  const plan = [
    ['write_file', {path: 'main.js', content: "document.querySelector('#app').textContent='before'"}],
    ['build_simulator', {entry: 'main.js'}], ['finish', {}],
    ['write_file', {path: 'main.js', content: "document.querySelector('#app').textContent='after'"}],
    ['build_simulator', {entry: 'main.js'}], ['finish', {}],
  ];
  let attempts = 0; let reviews = 0;
  const gateway = {complete: async ({messages}) => {
    if (attempts === 3) assert.match(messages.at(-1).content, /visual_review_failed/);
    const [name, args] = plan[attempts++];
    return {role: 'assistant', tool_calls: [{id: `call-${attempts}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]};
  }};
  const output = await generateSimulator({gateway, description: 'A simple crank mechanism', visualReview: async () => ({passed: ++reviews === 2, feedback: 'Repair the blank view.'})});
  assert.equal(reviews, 2);
  assert.equal(output.visualReviewed, true);
  assert.match(output.html, /after/);
});

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
      ['read_reference', {name: 'studio-api'}],
      ['write_file', {path: 'main.js', content: "import {ringGeometry} from 'teardown-stage'; window.geometry=ringGeometry();"}],
      ['build_simulator', {entry: 'main.js'}],
      ['finish', {}],
    ][call - 2];
    if (call === 3) assert.match(messages.at(-1).content, /createMechanicalStage/);
    return {role: 'assistant', tool_calls: [{id: `r-${call}`, type: 'function', function: {name: step[0], arguments: JSON.stringify(step[1])}}]};
  }};
  const result = await generateSimulator({gateway, description: '根据马达照片做拆解', references: [reference], onProgress: phase => events.push(phase), onAnalysis: value => events.push(value)});
  assert.equal(call, 5);
  assert.deepEqual(result.analysis, analysis);
  assert.equal(result.visualReviewed, false);
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
  for (const name of ['../.local/teardown.env', '/etc/passwd', 'constructor', '__proto__', 'v8-geometry/../../gateway.mjs']) {
    await assert.rejects(readGenerationReference(name), /reference_not_found/);
  }
  const valid = {summary: 'Object', observedParts: [], inferredParts: [], uncertainties: []};
  assert.deepEqual(validateReferenceAnalysis({...valid, ignored: 'unexpected'}), valid);
  assert.throws(() => validateReferenceAnalysis({...valid, summary: 'x'.repeat(1601)}), /reference_analysis_invalid/);
  assert.throws(() => validateReferenceAnalysis({...valid, inferredParts: Array(25).fill('x')}), /reference_analysis_invalid/);
  assert.throws(() => validateReferenceAnalysis({...valid, observedParts: [5]}), /reference_analysis_invalid/);
});
