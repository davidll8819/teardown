import test from 'node:test';
import assert from 'node:assert/strict';
import {createVisualReviewer} from './visual-review.mjs';

const checks = ['runtime_mounted', 'runtime_state_valid', 'readouts_finite', 'pause_stops_clock', 'resume_advances_clock', 'assembled_control', 'assembled_alignment', 'cutaway_control', 'cutaway_reveals_interior', 'exploded_control', 'exploded_moves_parts', 'subsystem_toggle', 'tour_starts', 'manual_control_takes_over'];
const frame = {canvasCount: 1, errors: [], image: 'YWJj'};

test('review compares every generated state with the actual user references', async () => {
  const review = createVisualReviewer({
    render: async () => ({...frame, frames: ['assembled', 'cutaway', 'exploded', 'tour'].map(mode => ({mode, image: 'ZGVm'})), interaction: {passed: true, checks, failures: []}}),
    gateway: {complete: async ({messages}) => {
      const content = messages[1].content;
      assert.equal(content.filter(item => item.type === 'image_url').length, 6);
      assert.equal(content.at(-1).image_url.url, 'data:image/png;base64,Z2hp');
      assert.match(content.filter(item => item.type === 'text').map(item => item.text).join('\n'), /GENERATED exploded view/);
      assert.match(messages[0].content, /cannot compensate for crude geometry/);
      return {content: '{"passed":false,"feedback":"The housing is a plain box and has no layered interior."}'};
    }},
  });
  const result = await review({html: 'fixture', description: 'precision bee robot', references: [{name: 'target.png', mimeType: 'image/png', data: 'Z2hp'}]});
  assert.equal(result.passed, false);
  assert.equal(result.interaction, 'passed');
});

test('failed runtime controls return repair feedback without a vision claim', async () => {
  const review = createVisualReviewer({render: async () => ({...frame, interaction: {passed: false, checks: [], failures: ['pause_stops_clock']}}), gateway: {complete: async () => {throw new Error('must_not_call');}}});
  const result = await review({html: 'fixture', description: 'machine'});
  assert.equal(result.passed, false);
  assert.equal(result.interaction, 'failed');
  assert.match(result.feedback, /pause_stops_clock/);
});

test('unverified or malformed control reports never become verified', async () => {
  const gateway = {complete: async () => ({content: '{"passed":true,"feedback":"Visible result meets the brief."}'})};
  const legacy = createVisualReviewer({render: async () => frame, gateway});
  assert.equal((await legacy({html: 'fixture', description: 'machine'})).interaction, 'not_run');
  const incomplete = createVisualReviewer({render: async () => ({...frame, interaction: {passed: true, checks: ['runtime_mounted'], failures: []}}), gateway});
  await assert.rejects(incomplete({html: 'fixture', description: 'machine'}), /visual_response_invalid/);
  const oversized = createVisualReviewer({render: async () => ({...frame, frames: Array(5).fill({mode: 'assembled', image: 'YWJj'})}), gateway});
  await assert.rejects(oversized({html: 'fixture', description: 'machine'}), /visual_response_invalid/);
  for (const frames of [[], Array(4).fill({mode: 'assembled', image: 'YWJj'})]) {
    const missingStates = createVisualReviewer({render: async () => ({...frame, frames, interaction: {passed: true, checks, failures: []}}), gateway});
    await assert.rejects(missingStates({html: 'fixture', description: 'machine'}), /visual_response_invalid/);
  }
});
