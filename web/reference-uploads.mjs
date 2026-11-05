import {createHash, randomUUID} from 'node:crypto';
import {normalizeReferences, MAX_REFERENCE_BYTES, MAX_REFERENCES_BYTES} from './references.mjs';

export const UPLOAD_CHUNK_CHARACTERS = 8192;
export const UPLOAD_BODY_BYTES = 12 * 1024;
const TTL = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Temporary batches are intentionally memory-only: no orphaned image files
// survive a crash. Reserved bytes, sessions, starts and lifetime are bounded.
// Every operation is scoped; IDs grant no authority on their own. Single process.
export function createReferenceUploadStore({now = Date.now, ttlMs = TTL, maxBatches = 8, maxBytes = 32 * 1024 * 1024} = {}) {
  const batches = new Map(), starts = new Map();
  let reserved = 0, globalStarts = [];
  const scopeKey = scope => createHash('sha256').update(JSON.stringify([scope.org, scope.user])).digest('hex');
  const remove = batch => {if (batches.delete(batch.id)) reserved -= batch.bytes;};
  function prune() {
    const clock = now();
    for (const batch of batches.values()) if (batch.expiresAt <= clock && !batch.claimed) remove(batch);
    globalStarts = globalStarts.filter(time => time > clock - TTL);
    for (const [key, times] of starts) {
      const live = times.filter(time => time > clock - TTL);
      if (live.length) starts.set(key, live); else starts.delete(key);
    }
  }
  const timer = setInterval(prune, 60000); timer.unref();
  function find(scope, id) {
    prune();
    const batch = typeof id === 'string' && UUID.test(id) ? batches.get(id) : null;
    if (!batch || batch.scope !== scopeKey(scope) || batch.expiresAt <= now()) throw new Error('reference_upload_not_found');
    if (batch.claimed) throw new Error('reference_upload_in_use');
    return batch;
  }
  function begin(scope, input) {
    prune();
    if (!Array.isArray(input) || !input.length || input.length > 3) throw new Error('references_invalid');
    let bytes = 0;
    const metadata = input.map(value => {
      if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 160 || /[\x00-\x1f\x7f]/.test(value.name)) throw new Error('references_invalid');
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(value.mimeType)) throw new Error('reference_type_invalid');
      if (!Number.isSafeInteger(value.bytes) || value.bytes < 1) throw new Error('reference_upload_invalid');
      if (value.bytes > MAX_REFERENCE_BYTES) throw new Error('reference_too_large');
      bytes += value.bytes;
      return {name: value.name.trim(), mimeType: value.mimeType, bytes: value.bytes};
    });
    if (bytes > MAX_REFERENCES_BYTES) throw new Error('references_too_large');
    const key = scopeKey(scope), clock = now();
    if ([...batches.values()].some(batch => batch.scope === key) || batches.size >= maxBatches || reserved + bytes > maxBytes) throw new Error('reference_upload_capacity');
    if ((starts.get(key)?.length || 0) >= 4 || globalStarts.length >= 40 || (!starts.has(key) && starts.size >= 1024)) throw new Error('reference_upload_rate_limited');
    const id = randomUUID();
    const maxChunks = metadata.reduce((sum, item) => sum + Math.ceil((Math.ceil(item.bytes / 3) * 4) / UPLOAD_CHUNK_CHARACTERS), 0);
    const batch = {id, scope: key, bytes, expiresAt: clock + ttlMs, completed: false, claimed: false, attempts: 0, maxAttempts: maxChunks * 2 + 10, images: metadata.map(item => ({...item, buffer: Buffer.alloc(item.bytes), offset: 0}))};
    batches.set(id, batch); reserved += bytes;
    starts.set(key, [...(starts.get(key) || []), clock]); globalStarts.push(clock);
    return {id, chunkCharacters: UPLOAD_CHUNK_CHARACTERS, expiresAt: batch.expiresAt};
  }
  function append(scope, id, value) {
    const batch = find(scope, id);
    if (++batch.attempts > batch.maxAttempts) {remove(batch); throw new Error('reference_upload_rate_limited');}
    if (!value || !Number.isSafeInteger(value.reference) || value.reference < 0 || value.reference >= batch.images.length || !Number.isSafeInteger(value.offset) || value.offset < 0 || value.offset % UPLOAD_CHUNK_CHARACTERS || typeof value.data !== 'string') throw new Error('reference_upload_invalid');
    const image = batch.images[value.reference];
    const encodedLength = Math.ceil(image.bytes / 3) * 4;
    const expectedLength = Math.min(UPLOAD_CHUNK_CHARACTERS, encodedLength - value.offset);
    if (expectedLength <= 0 || value.data.length !== expectedLength || value.data.length % 4 || /[^A-Za-z0-9+/=]/.test(value.data)) throw new Error('reference_upload_invalid');
    const decoded = Buffer.from(value.data, 'base64');
    const byteOffset = value.offset / 4 * 3;
    const expectedBytes = Math.min(UPLOAD_CHUNK_CHARACTERS / 4 * 3, image.bytes - byteOffset);
    if (decoded.length !== expectedBytes || decoded.toString('base64') !== value.data) throw new Error('reference_upload_invalid');
    if (value.offset < image.offset) {
      if (!image.buffer.subarray(byteOffset, byteOffset + decoded.length).equals(decoded)) throw new Error('reference_upload_conflict');
      return {offset: image.offset};
    }
    if (batch.completed || value.offset !== image.offset) throw new Error('reference_upload_conflict');
    decoded.copy(image.buffer, byteOffset); image.offset += value.data.length;
    return {offset: image.offset};
  }
  const references = batch => batch.images.map(({name, mimeType, buffer}) => ({name, mimeType, data: buffer.toString('base64')}));
  function complete(scope, id) {
    const batch = find(scope, id);
    if (batch.images.some(image => image.offset !== Math.ceil(image.bytes / 3) * 4)) throw new Error('reference_upload_incomplete');
    if (!batch.completed) {
      try {normalizeReferences(references(batch));}
      catch (error) {remove(batch); throw error;}
      batch.completed = true;
    }
    return {id, completed: true};
  }
  async function use(scope, id, create) {
    const batch = find(scope, id);
    if (!batch.completed) throw new Error('reference_upload_incomplete');
    batch.claimed = true;
    try {return await create(references(batch));}
    finally {remove(batch);}
  }
  function cancel(scope, id) {const batch = find(scope, id); remove(batch); return {cancelled: true};}
  return {begin, append, complete, use, cancel, prune, dispose() {clearInterval(timer); batches.clear(); starts.clear(); globalStarts = []; reserved = 0;}};
}
