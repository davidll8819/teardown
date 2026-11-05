// Tiny valid PNG fixtures plus optional ancillary data for upload-limit tests.
import {deflateSync} from 'node:zlib';

function chunk(type, data) {
  const content = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, content, checksum]);
}
export function pngFixture({width = 1, height = 1, padding = 0} = {}) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const parts = [Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header)];
  if (padding) parts.push(chunk('tEXt', Buffer.concat([Buffer.from('Comment\0'), Buffer.alloc(padding, 97)])));
  // Actual pixels for the default tiny fixture. Oversized header fixtures are
  // rejected on dimensions before a consumer attempts to decode their pixels.
  parts.push(chunk('IDAT', deflateSync(Buffer.from([0, 255, 128, 0, 255]))), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
export function imageFixture(options) {
  return {name: '参考图片.png', mimeType: 'image/png', data: pngFixture(options).toString('base64')};
}
