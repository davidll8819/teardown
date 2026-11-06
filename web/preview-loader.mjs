import {createTranslator} from './i18n-ui.js';

export const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
export const PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";

export class PreviewError extends Error {
  constructor(code) {super(code); this.name = 'PreviewError'; this.code = code;}
}

export function previewMessage(error, locale = 'zh-CN') {
  const t = createTranslator(locale);
  return t(({
    preview_auth: '登录状态已失效，请从 4yi 应用入口重新打开，再载入结果。',
    preview_forbidden: '当前账号无法读取这份结果，请确认登录账号与所属组织。',
    preview_missing: '当前账号或应用实例找不到这份结果。请刷新任务列表后重新选择。',
    preview_pending: '结果还没有准备好，请稍后重新载入。',
    preview_unavailable: '应用暂时无法读取结果存储，请稍后重新载入。',
    preview_redirect: '结果请求跳转到了其他页面，请从 4yi 应用入口重新打开，再载入结果。',
    preview_timeout: '载入结果超时，应用可能正在唤醒。请稍后重新载入。',
    preview_too_large: '结果文件超出预览大小限制，暂时无法载入。',
    preview_invalid: '服务器没有返回有效的模拟器页面，请重新载入；仍失败时请联系管理员。',
  })[error?.code] || '暂时无法读取模拟器，请检查连接后重新载入。');
}

// Preserve the generator's document, including its own restrictive meta CSP.
// srcDoc does not inherit the preview endpoint's response headers, so insert an
// additional fixed CSP before any model-authored content. Never parse this HTML
// into the application's live DOM or grant the iframe allow-same-origin.
export function isolatedPreviewDocument(html) {
  if (typeof html !== 'string' || !/^\s*<!doctype html>\s*<html(?:\s[^>]*)?>\s*<head(?:\s[^>]*)?>/i.test(html) || !/<main\b[^>]*\bid\s*=\s*["']app["'][^>]*>/i.test(html) || !/<script\b/i.test(html)) {
    throw new PreviewError('preview_invalid');
  }
  return html.replace(/<head(?:\s[^>]*)?>/i, head => `${head}<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`);
}

/** Read the complete authorized result with one timeout and a streamed byte cap. */
export async function readPreview(url, {signal, timeoutMs = 20_000, maxBytes = MAX_PREVIEW_BYTES, fetchImpl = fetch} = {}) {
  if (signal?.aborted) throw new PreviewError('preview_cancelled');
  const controller = new AbortController();
  let timer, onAbort, reader;
  const stopped = new Promise((_, reject) => {
    const stop = code => {const error = new PreviewError(code); reject(error); controller.abort(error); void reader?.cancel().catch(() => {});};
    timer = setTimeout(() => stop('preview_timeout'), timeoutMs);
    onAbort = () => stop('preview_cancelled');
    signal?.addEventListener('abort', onAbort, {once: true});
  });
  const pending = (async () => {
    let response;
    try {response = await fetchImpl(url, {signal: controller.signal, credentials: 'same-origin', redirect: 'manual', cache: 'no-store', referrerPolicy: 'no-referrer'});}
    catch {throw new PreviewError('preview_network');}
    if (response.type === 'opaqueredirect' || response.redirected || response.status >= 300 && response.status < 400) throw new PreviewError('preview_redirect');
    if (!response.ok) throw new PreviewError(({401: 'preview_auth', 403: 'preview_forbidden', 404: 'preview_missing', 409: 'preview_pending', 503: 'preview_unavailable'})[response.status] || 'preview_network');
    if (!/^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw new PreviewError('preview_invalid');
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > maxBytes) {void response.body?.cancel().catch(() => {}); throw new PreviewError('preview_too_large');}
    if (!response.body?.getReader) throw new PreviewError('preview_invalid');
    reader = response.body.getReader();
    let bytes = 0, html = '';
    const decoder = new TextDecoder('utf-8', {fatal: true});
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw new PreviewError('preview_too_large');
        html += decoder.decode(value, {stream: true});
      }
      html += decoder.decode();
    } catch (error) {void reader.cancel().catch(() => {}); throw error instanceof PreviewError ? error : new PreviewError('preview_invalid');}
    // Also rejects successful responses containing an SSO/login document.
    isolatedPreviewDocument(html);
    return html;
  })();
  try {return await Promise.race([pending, stopped]);}
  finally {clearTimeout(timer); signal?.removeEventListener('abort', onAbort);}
}
