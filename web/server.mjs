import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGateway} from './gateway.mjs';
import {generateSimulator} from './generator.mjs';
import {createJobStore} from './jobs.mjs';
import {createVisualReviewer} from './visual-review.mjs';
import {createLocalVisualRenderer} from './visual-client.mjs';
import {createRouterIdentityVerifier} from './router-identity.mjs';
import {MAX_JOB_BODY_BYTES} from './references.mjs';
import {createReferenceUploadStore, UPLOAD_BODY_BYTES} from './reference-uploads.mjs';
import {createRuntimeInfo} from './runtime-info.mjs';
import {platformLocaleFromCookie} from './platform-locale.mjs';
import {normalizeJobLocale} from './locale.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const mime = {'.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2'};
const previewCsp = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
function json(res, status, value) { res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}); res.end(JSON.stringify(value)); }
async function rawBody(req) {
  const limit = req.bodyLimit || 16384;
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    const clean = () => {req.off('data', data); req.off('end', end); req.off('error', fail); req.off('aborted', aborted);};
    const fail = error => {clean(); reject(error);};
    const aborted = () => fail(new Error('body_aborted'));
    const data = chunk => {
      size += chunk.length;
      if (size > limit) {
        fail(new Error('body_too_large'));
        // The client may abort while the rejected body is being drained.
        // Keep that stream error from becoming an unhandled server error.
        req.on('error', () => {}); req.resume(); return;
      }
      chunks.push(chunk);
    };
    const end = () => {clean(); resolve(Buffer.concat(chunks));};
    req.on('data', data); req.on('end', end); req.on('error', fail); req.on('aborted', aborted);
  });
}
async function body(req) {
  if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('invalid_content_type');
  const bytes = req.signedBody ?? await rawBody(req);
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw new Error('invalid_json'); }
}
function scopeFor(req, local) {
  if (local) return {org: 'local', user: 'local'};
  const org = req.headers['x-xclaw-owner-org-id']; const user = req.headers['x-xclaw-user-id'];
  if (typeof org !== 'string' || typeof user !== 'string' || !org || !user) return null;
  return {org, user};
}
function sameOrigin(req, local) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const expected = local ? req.headers.host : req.headers['x-xclaw-hostname'];
    return new URL(origin).host === expected;
  } catch { return false; }
}
export function createApp({store, local = false, verifyIdentity, dist = path.join(root, 'web-dist'), uploads = createReferenceUploadStore(), runtimeInfo = () => ({})}) {
  const app = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://local'); }
    catch { return json(res, 400, {error: 'invalid_url'}); }
    req.bodyLimit = url.pathname.startsWith('/api/reference-uploads') ? UPLOAD_BODY_BYTES : req.method === 'POST' && url.pathname === '/api/jobs' ? MAX_JOB_BODY_BYTES : 16384;
    if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, {ok: true});
    if (!local) {
      try { req.signedBody = req.method === 'GET' || req.method === 'HEAD' ? Buffer.alloc(0) : await rawBody(req); }
      catch { return json(res, 413, {error: 'body_too_large'}); }
      if (!verifyIdentity || !verifyIdentity(req, req.signedBody)) return json(res, 401, {error: 'authentication_required'});
    }
    const scope = scopeFor(req, local);
    if (!scope) return json(res, 401, {error: 'authentication_required'});
    try {
      if (url.pathname === '/api/locale' && req.method === 'GET') return json(res, 200, {locale: platformLocaleFromCookie(req.headers.cookie), scopeFingerprint: runtimeInfo(scope).scopeFingerprint || (local ? 'local' : null)});
      if (url.pathname === '/api/runtime' && req.method === 'GET') return json(res, 200, runtimeInfo(scope));
      if (url.pathname === '/api/reference-uploads' && req.method === 'POST') {
        if (!sameOrigin(req, local)) return json(res, 403, {error: 'origin_invalid'});
        const value = await body(req);
        return json(res, 201, uploads.begin(scope, value?.references));
      }
      const uploadMatch = /^\/api\/reference-uploads\/([0-9a-f-]+)(?:\/(chunks|complete))?$/.exec(url.pathname);
      if (uploadMatch && (req.method === 'POST' || req.method === 'DELETE')) {
        if (!sameOrigin(req, local)) return json(res, 403, {error: 'origin_invalid'});
        if (req.method === 'DELETE' && !uploadMatch[2]) return json(res, 200, uploads.cancel(scope, uploadMatch[1]));
        if (req.method === 'POST' && uploadMatch[2] === 'chunks') return json(res, 200, uploads.append(scope, uploadMatch[1], await body(req)));
        if (req.method === 'POST' && uploadMatch[2] === 'complete') {
          await body(req);
          return json(res, 200, uploads.complete(scope, uploadMatch[1]));
        }
        return json(res, 404, {error: 'not_found'});
      }
      if (url.pathname === '/api/jobs' && req.method === 'GET') return json(res, 200, {jobs: await store.list(scope)});
      if (url.pathname === '/api/jobs' && req.method === 'POST') {
        if (!sameOrigin(req, local)) return json(res, 403, {error: 'origin_invalid'});
        const value = await body(req);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_json');
        const locale = normalizeJobLocale(value.locale);
        if (value.referenceUploadId !== undefined) {
          if (value.references !== undefined) throw new Error('references_invalid');
          return json(res, 202, await uploads.use(scope, value.referenceUploadId, references => store.create(scope, value.description, references, locale)));
        }
        return json(res, 202, await store.create(scope, value.description, value.references, locale));
      }
      const cancelMatch = /^\/api\/jobs\/([0-9a-f-]+)\/cancel$/.exec(url.pathname);
      if (req.method === 'POST' && cancelMatch) {
        if (!sameOrigin(req, local)) return json(res, 403, {error: 'origin_invalid'});
        return json(res, 202, await store.cancel(scope, cancelMatch[1]));
      }
      const match = /^\/api\/jobs\/([0-9a-f-]+)(\/preview)?$/.exec(url.pathname);
      const referenceMatch = /^\/api\/jobs\/([0-9a-f-]+)\/references\/([0-9a-f-]+)$/.exec(url.pathname);
      if (req.method === 'GET' && referenceMatch) {
        const image = await store.reference(scope, referenceMatch[1], referenceMatch[2]);
        res.writeHead(200, {'content-type': image.mimeType, 'content-length': image.buffer.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; sandbox", 'cross-origin-resource-policy': 'same-origin'});
        return res.end(image.buffer);
      }
      if (req.method === 'GET' && match) {
        if (!match[2]) return json(res, 200, await store.get(scope, match[1]));
        const html = await store.artifact(scope, match[1]);
        res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': previewCsp, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer'}); return res.end(html);
      }
      if (req.method !== 'GET') return json(res, 404, {error: 'not_found'});
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!/^(?:index\.html|assets\/[a-zA-Z0-9_.-]+)$/.test(name)) return json(res, 404, {error: 'not_found'});
      const content = await readFile(path.join(dist, name));
      res.writeHead(200, {'content-type': mime[path.extname(name)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store'}); return res.end(content);
    } catch (error) {
      const code = error?.message;
      const status = code === 'storage_unavailable' ? 503 : code === 'job_not_found' || code === 'reference_not_found' || code === 'reference_upload_not_found' || error?.code === 'ENOENT' ? 404 : code === 'body_too_large' ? 413 : ['reference_upload_capacity', 'reference_upload_rate_limited'].includes(code) ? 429 : ['job_already_running', 'job_capacity_reached', 'job_not_ready', 'job_not_running', 'reference_upload_in_use', 'reference_upload_conflict', 'reference_upload_incomplete'].includes(code) ? 409 : ['invalid_description', 'invalid_locale', 'invalid_content_type', 'invalid_json', 'references_invalid', 'reference_type_invalid', 'reference_image_invalid', 'reference_dimensions_invalid', 'reference_too_large', 'references_too_large', 'reference_upload_invalid'].includes(code) ? 400 : 500;
      return json(res, status, {error: status === 500 ? 'internal_error' : code});
    }
  });
  app.on('close', () => uploads.dispose());
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const local = process.env.TEARDOWN_LOCAL_MODE === '1';
  if (local && process.env.FOURYI_ROUTER_IDENTITY_REQUIRED === '1') throw new Error('local_mode_conflicts_with_router_identity');
  const dataDirectory = process.env.TEARDOWN_DATA_DIR || path.join(root, 'teardown-out', 'jobs');
  const verifyIdentity = local ? undefined : createRouterIdentityVerifier({key: process.env.FOURYI_ROUTER_IDENTITY_KEY, hostname: process.env.XCLAW_APP_HOSTNAME, replayDirectory: path.join(dataDirectory, 'router-nonces')});
  const gateway = createGateway({baseUrl: process.env.OPENAI_API_BASE || process.env.OPENAI_BASE_URL, apiKey: process.env.OPENAI_API_KEY, model: process.env.TEXT_MODEL, reasoningEffort: process.env.TEARDOWN_REASONING_EFFORT || (process.env.TEXT_MODEL === 'gpt-6-luna' ? 'none' : undefined)});
  const visualUrl = process.env.TEARDOWN_LOCAL_VISUAL_URL;
  if (visualUrl && !local) throw new Error('local_visual_renderer_requires_local_mode');
  const visualGateway = visualUrl ? createGateway({baseUrl: process.env.OPENAI_API_BASE || process.env.OPENAI_BASE_URL, apiKey: process.env.OPENAI_API_KEY, model: process.env.TEARDOWN_VISION_MODEL || process.env.TEXT_MODEL}) : null;
  const visualReview = visualUrl ? createVisualReviewer({render: createLocalVisualRenderer({url: visualUrl}), gateway: visualGateway}) : undefined;
  const store = createJobStore({directory: dataDirectory, generate: ({description, references, locale, signal, onProgress, onAnalysis}) => generateSimulator({gateway, description, references, locale, signal, onProgress, onAnalysis, visualReview})});
  const runtimeInfo = createRuntimeInfo({local, hostname: process.env.XCLAW_APP_HOSTNAME, model: process.env.TEXT_MODEL});
  createApp({store, local, verifyIdentity, runtimeInfo}).listen(Number(process.env.PORT || 3000), local ? '127.0.0.1' : '0.0.0.0');
}
