export class RequestError extends Error {
  constructor(code, {status, uncertain = false} = {}) {
    super(code);
    this.name = 'RequestError';
    this.code = code;
    this.status = status;
    this.uncertain = uncertain;
  }
}

/** Bound the entire request, including reading its response body. Never retry. */
export async function requestJson(url, {timeoutMs = 15_000, signal, ...options} = {}, {fetchImpl = fetch, setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
  const mutation = !['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase());
  if (signal?.aborted) throw new RequestError('request_cancelled');
  const controller = new AbortController();
  let timer, onAbort;
  const stopped = new Promise((_, reject) => {
    timer = setTimer(() => {
      const error = new RequestError('request_timeout', {uncertain: mutation});
      // Reject first so the stable error wins over fetch's AbortError.
      reject(error); controller.abort(error);
    }, timeoutMs);
    onAbort = () => {
      const error = new RequestError('request_cancelled', {uncertain: mutation});
      reject(error); controller.abort(error);
    };
    signal?.addEventListener('abort', onAbort, {once: true});
  });
  const response = (async () => {
    let result;
    try {result = await fetchImpl(url, {...options, signal: controller.signal});}
    catch {throw new RequestError('request_network', {uncertain: mutation});}
    let value;
    try {value = await result.json();}
    catch {throw new RequestError(result.ok ? 'request_invalid_response' : 'request_failed', {status: result.status, uncertain: mutation && (result.ok || result.status >= 500)});}
    if (!result.ok) throw new RequestError(typeof value?.error === 'string' ? value.error : 'request_failed', {status: result.status, uncertain: mutation && result.status >= 500});
    return value;
  })();
  try {return await Promise.race([response, stopped]);}
  finally {clearTimer(timer); signal?.removeEventListener('abort', onAbort);}
}

/** One read at a time. Invalidated/late responses cannot overwrite newer state. */
export function createReadCoordinator({load, onValue, onError}) {
  let current = null, generation = 0, disposed = false;
  function invalidate() {
    generation++;
    const stale = current; current = null;
    stale?.controller.abort();
  }
  function refresh() {
    if (disposed) return Promise.resolve({ok: false, stale: true});
    if (current) return current.promise;
    const record = {generation, controller: new AbortController()};
    current = record;
    const fresh = () => !disposed && record.generation === generation;
    record.promise = Promise.resolve().then(() => load({signal: record.controller.signal})).then(value => {
      if (!fresh()) return {ok: false, stale: true};
      onValue(value); return {ok: true, value};
    }).catch(error => {
      if (!fresh()) return {ok: false, stale: true};
      onError(error); return {ok: false, error};
    }).finally(() => {if (current === record) current = null;});
    return record.promise;
  }
  return {refresh, invalidate, dispose() {disposed = true; invalidate();}};
}
