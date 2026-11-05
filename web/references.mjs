import {randomUUID} from 'node:crypto';

export const MAX_REFERENCE_BYTES = 2 * 1024 * 1024;
export const MAX_REFERENCES_BYTES = 4 * 1024 * 1024;
export const MAX_JOB_BODY_BYTES = 6 * 1024 * 1024;
const MAX_SIDE = 4096;
const MAX_PIXELS = 16_000_000;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const invalid = () => { throw new Error('reference_image_invalid'); };

// Inspect bounded binary containers without executing uploaded content or
// decoding pixels in the web process. The browser still handles image decoding.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngSize(bytes) {
  if (!bytes.subarray(0, 8).equals(PNG)) invalid();
  let offset = 8; let width; let height; let data = false; let ended = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) invalid();
    const size = bytes.readUInt32BE(offset);
    const end = offset + 12 + size;
    if (end > bytes.length) invalid();
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) invalid();
    if (offset === 8 && type !== 'IHDR') invalid();
    if (type === 'IHDR') {
      if (offset !== 8 || size !== 13) invalid();
      width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12);
      const depth = bytes[offset + 16]; const colour = bytes[offset + 17];
      const depths = {0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16]};
      if (!depths[colour]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) invalid();
    }
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) invalid();
    if (type === 'IDAT' && size) data = true;
    if (type === 'IEND') {
      if (size !== 0 || end !== bytes.length || !data) invalid();
      ended = true;
    }
    offset = end;
  }
  if (!ended) invalid();
  return {width, height};
}
function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid();
  let offset = 2; let width; let height; let scan = false; let ended = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) { ended = scan && offset === bytes.length; break; }
    if (marker === 0 || marker === undefined || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) invalid();
    if (offset + 2 > bytes.length) invalid();
    const size = bytes.readUInt16BE(offset);
    if (size < 2 || offset + size > bytes.length) invalid();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (size < 11 || width || bytes[offset + 2] !== 8) invalid();
      height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5);
      const components = bytes[offset + 7];
      if (![1, 3, 4].includes(components) || size !== 8 + components * 3) invalid();
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) invalid();
    if (marker === 0xda) {
      if (!width || size < 6 || size !== 6 + bytes[offset + 2] * 2) invalid();
      scan = true;
      offset += size;
      const scanStart = offset;
      // Entropy data can contain stuffed 0xff and restart markers. Stop at
      // the next actual marker so progressive JPEG scans are checked too.
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        const next = bytes[offset + 1];
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { offset += 2; continue; }
        break;
      }
      if (offset === scanStart) invalid();
    } else offset += size;
  }
  if (!ended || !width || !height) invalid();
  return {width, height};
}
function webpSize(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) invalid();
  let offset = 12; let dimensions; let extended;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) invalid();
    const type = bytes.toString('ascii', offset, offset + 4); const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8; const end = start + size;
    if (end + (size % 2) > bytes.length) invalid();
    if (type === 'VP8X') {
      if (offset !== 12 || size !== 10 || (bytes[start] & 0xc3) || bytes.readUIntLE(start + 1, 3)) invalid();
      extended = {width: 1 + bytes.readUIntLE(start + 4, 3), height: 1 + bytes.readUIntLE(start + 7, 3)};
    } else if (type === 'VP8 ') {
      if (dimensions || size < 10 || (bytes[start] & 1) || bytes.toString('hex', start + 3, start + 6) !== '9d012a') invalid();
      if ((bytes.readUIntLE(start, 3) >>> 5) > size - 10) invalid();
      dimensions = {width: bytes.readUInt16LE(start + 6) & 0x3fff, height: bytes.readUInt16LE(start + 8) & 0x3fff};
    } else if (type === 'VP8L') {
      if (dimensions || size < 6 || bytes[start] !== 0x2f || (bytes[start + 4] & 0xe0)) invalid();
      const bits = bytes.readUInt32LE(start + 1);
      dimensions = {width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff)};
    } else if (['ANIM', 'ANMF'].includes(type)) invalid();
    offset = end + (size % 2);
  }
  if (!dimensions || (extended && (extended.width !== dimensions.width || extended.height !== dimensions.height))) invalid();
  return dimensions;
}

export function normalizeReferences(input = []) {
  if (!Array.isArray(input) || input.length > 3) throw new Error('references_invalid');
  let total = 0;
  return input.map(value => {
    if (!value || typeof value !== 'object' || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 160 || /[\x00-\x1f\x7f]/.test(value.name) || typeof value.data !== 'string') throw new Error('references_invalid');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(value.mimeType)) throw new Error('reference_type_invalid');
    if (value.data.length > Math.ceil(MAX_REFERENCE_BYTES / 3) * 4) throw new Error('reference_too_large');
    if (!value.data.length || value.data.length % 4 || /[^A-Za-z0-9+/=]/.test(value.data)) invalid();
    const buffer = Buffer.from(value.data, 'base64');
    if (buffer.length > MAX_REFERENCE_BYTES) throw new Error('reference_too_large');
    total += buffer.length;
    if (total > MAX_REFERENCES_BYTES) throw new Error('references_too_large');
    if (buffer.toString('base64') !== value.data) invalid();
    const {width, height} = value.mimeType === 'image/png' ? pngSize(buffer) : value.mimeType === 'image/jpeg' ? jpegSize(buffer) : webpSize(buffer);
    if (!width || !height || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) throw new Error('reference_dimensions_invalid');
    return {id: randomUUID(), name: value.name.trim(), mimeType: value.mimeType, bytes: buffer.length, width, height, buffer};
  });
}

export function normalizeAnalysis(value) {
  if (!value || typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 1600) throw new Error('reference_analysis_invalid');
  const result = {summary: value.summary.trim()};
  for (const key of ['observedParts', 'inferredParts', 'uncertainties']) {
    if (!Array.isArray(value[key]) || value[key].length > 24 || value[key].some(item => typeof item !== 'string' || !item.trim() || item.length > 400)) throw new Error('reference_analysis_invalid');
    result[key] = value[key].map(item => item.trim());
  }
  return result;
}
