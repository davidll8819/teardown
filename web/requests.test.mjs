import test from 'node:test';
import assert from 'node:assert/strict';
import {requestJson, createReadCoordinator} from './requests.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
function timerHarness(fetchImpl) {
  let fire, clears = 0;
  return {deps: {fetchImpl, setTimer: callback => {fire = callback; return 1;}, clearTimer: () => {clears++;}}, expire: () => fire(), get clears() {return clears;}};
}

test('a stalled POST times out, aborts its transport and remains uncertain without retrying', async () => {
  let calls = 0, signal;
  const late = deferred();
  const timer = timerHarness(async (_, options) => {calls++; signal = options.signal; return late.promise;});
  const request = requestJson('/api/jobs', {method: 'POST'}, timer.deps);
  timer.expire();
  await assert.rejects(request, error => error.code === 'request_timeout' && error.uncertain);
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
  assert.equal(timer.clears, 1);
  // A server may still accept the request. Its late response must not make the
  // already-timed-out caller announce success or start a second POST.
  late.resolve({ok: true, status: 202, json: async () => ({id: 'accepted-late'})});
  await Promise.resolve();
  assert.equal(calls, 1);
});

test('the deadline also covers a response body that never finishes', async () => {
  const body = deferred(); let bodyStarted = false;
  const timer = timerHarness(async () => ({ok: true, status: 200, json: () => {bodyStarted = true; return body.promise;}}));
  const request = requestJson('/api/jobs', {}, timer.deps);
  await Promise.resolve();
  assert.equal(bodyStarted, true);
  timer.expire();
  await assert.rejects(request, error => error.code === 'request_timeout' && !error.uncertain);
});

test('known HTTP rejection differs from an ambiguous network/server result', async () => {
  await assert.rejects(requestJson('/api/jobs', {method: 'POST'}, {fetchImpl: async () => ({ok: false, status: 409, json: async () => ({error: 'job_already_running'})})}), error => error.code === 'job_already_running' && error.status === 409 && !error.uncertain);
  await assert.rejects(requestJson('/api/jobs', {method: 'POST'}, {fetchImpl: async () => ({ok: false, status: 502, json: async () => {throw new Error('proxy HTML');}})}), error => error.status === 502 && error.uncertain);
  await assert.rejects(requestJson('/api/jobs', {method: 'POST'}, {fetchImpl: async () => {throw new Error('offline');}}), error => error.code === 'request_network' && error.uncertain);
});

test('an external cancellation settles once and success clears the deadline', async () => {
  const controller = new AbortController(); const pending = deferred();
  const timer = timerHarness(async () => pending.promise);
  const request = requestJson('/api/jobs', {signal: controller.signal}, timer.deps);
  controller.abort();
  await assert.rejects(request, error => error.code === 'request_cancelled');
  assert.equal(timer.clears, 1);
  let called = false;
  await assert.rejects(requestJson('/api/jobs', {signal: controller.signal}, {fetchImpl: async () => {called = true;}}), /request_cancelled/);
  assert.equal(called, false);
  const success = timerHarness(async () => ({ok: true, status: 202, json: async () => ({id: 'accepted'})}));
  assert.deepEqual(await requestJson('/api/jobs', {method: 'POST'}, success.deps), {id: 'accepted'});
  assert.equal(success.clears, 1);
});

test('polling joins an existing read instead of overlapping requests', async () => {
  let loads = 0; const pending = deferred(), values = [];
  const reader = createReadCoordinator({load: () => {loads++; return pending.promise;}, onValue: value => values.push(value), onError: assert.fail});
  const first = reader.refresh(), second = reader.refresh(), third = reader.refresh();
  assert.equal(first, second); assert.equal(second, third);
  await Promise.resolve(); assert.equal(loads, 1);
  pending.resolve(['job']);
  assert.equal((await first).ok, true);
  assert.deepEqual(values, [['job']]);
  reader.dispose();
});

test('an old list cannot erase an accepted job or restore a stale synchronization error', async () => {
  const pending = [deferred(), deferred(), deferred()];
  const signals = []; let loads = 0, visible = [], error = 'old failure';
  const reader = createReadCoordinator({load: ({signal}) => {signals.push(signal); return pending[loads++].promise;}, onValue: value => {visible = value; error = '';}, onError: () => {error = 'sync failed';}});
  const old = reader.refresh(); await Promise.resolve();
  reader.invalidate(); visible = ['accepted'];
  const fresh = reader.refresh(); await Promise.resolve();
  assert.equal(signals[0].aborted, true);
  pending[1].resolve(['accepted']); await fresh;
  pending[0].resolve([]);
  assert.equal((await old).stale, true);
  assert.deepEqual(visible, ['accepted']); assert.equal(error, '');
  const lateFailure = reader.refresh(); await Promise.resolve();
  reader.invalidate();
  pending[2].reject(new Error('late timeout'));
  assert.equal((await lateFailure).stale, true);
  assert.equal(error, '');
  reader.dispose();
});

test('dispose aborts pending reads and suppresses callbacks after unmount', async () => {
  const pending = deferred(); let signal, notifications = 0;
  const reader = createReadCoordinator({load: options => {signal = options.signal; return pending.promise;}, onValue: () => {notifications++;}, onError: () => {notifications++;}});
  const request = reader.refresh(); await Promise.resolve();
  reader.dispose(); assert.equal(signal.aborted, true);
  pending.resolve(['old']);
  assert.equal((await request).stale, true);
  assert.equal(notifications, 0);
  assert.equal((await reader.refresh()).stale, true);
});
