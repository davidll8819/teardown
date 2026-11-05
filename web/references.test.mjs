import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAnalysis, normalizeReferences, MAX_REFERENCE_BYTES, MAX_REFERENCES_BYTES} from './references.mjs';
import {imageFixture, pngFixture} from './reference-fixtures.mjs';

// An orange 1×1 JPEG exported by ImageIO, and a decoded 1×1 WebP fixture.
const jpeg = '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A9cooor/Ks/0oP//Z';
const webp = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';

test('reference validation extracts image dimensions and rejects forged or damaged containers', () => {
  const input = imageFixture();
  const [image] = normalizeReferences([input]);
  assert.equal(image.width, 1); assert.equal(image.height, 1);
  assert.equal(image.name, input.name); assert.equal(image.bytes, pngFixture().length);
  assert.match(image.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(normalizeReferences(), []);
  assert.throws(() => normalizeReferences([{...input, mimeType: 'image/svg+xml'}]), /reference_type_invalid/);
  assert.throws(() => normalizeReferences([{...input, mimeType: 'image/jpeg'}]), /reference_image_invalid/);
  assert.throws(() => normalizeReferences([{...input, data: Buffer.from('<script>alert(1)</script>').toString('base64')}]), /reference_image_invalid/);
  assert.throws(() => normalizeReferences([{...input, data: pngFixture().subarray(0, -5).toString('base64')}]), /reference_image_invalid/);
  const damaged = pngFixture(); damaged[35] ^= 1;
  assert.throws(() => normalizeReferences([{...input, data: damaged.toString('base64')}]), /reference_image_invalid/);
  assert.throws(() => normalizeReferences([{...input, data: input.data + '\n'}]), /reference_image_invalid/);
  assert.throws(() => normalizeReferences([{...input, name: 'bad\nname.png'}]), /references_invalid/);
});

test('reference count, encoded bytes, total bytes and pixel dimensions are bounded', () => {
  assert.throws(() => normalizeReferences([imageFixture(), imageFixture(), imageFixture(), imageFixture()]), /references_invalid/);
  assert.throws(() => normalizeReferences([imageFixture({padding: MAX_REFERENCE_BYTES})]), /reference_too_large/);
  const large = imageFixture({padding: Math.ceil(MAX_REFERENCES_BYTES / 3)});
  assert.throws(() => normalizeReferences([large, large, large]), /references_too_large/);
  assert.throws(() => normalizeReferences([imageFixture({width: 4097})]), /reference_dimensions_invalid/);
  assert.throws(() => normalizeReferences([imageFixture({width: 4096, height: 4096})]), /reference_dimensions_invalid/);
  assert.throws(() => normalizeReferences([imageFixture({height: 0})]), /reference_dimensions_invalid/);
});

test('JPEG and WebP image headers are recognized and truncated or inconsistent images are rejected', () => {
  for (const [mimeType, data] of [['image/jpeg', jpeg], ['image/webp', webp]]) {
    const input = {name: 'image', mimeType, data};
    const [image] = normalizeReferences([input]);
    assert.equal(image.width, 1); assert.equal(image.height, 1);
    const bytes = Buffer.from(data, 'base64');
    assert.throws(() => normalizeReferences([{...input, data: bytes.subarray(0, -2).toString('base64')}]), /reference_image_invalid/);
    assert.throws(() => normalizeReferences([{...input, mimeType: 'image/png'}]), /reference_image_invalid/);
  }
  const hugeJpeg = Buffer.from(jpeg, 'base64');
  const sof = hugeJpeg.indexOf(Buffer.from([0xff, 0xc0]));
  hugeJpeg.writeUInt16BE(4097, sof + 7);
  assert.throws(() => normalizeReferences([{name: 'wide.jpg', mimeType: 'image/jpeg', data: hugeJpeg.toString('base64')}]), /reference_dimensions_invalid/);
  const brokenWebp = Buffer.from(webp, 'base64'); brokenWebp[23] = 0;
  assert.throws(() => normalizeReferences([{name: 'broken.webp', mimeType: 'image/webp', data: brokenWebp.toString('base64')}]), /reference_image_invalid/);
});

test('analysis exposes only bounded observed, inferred and uncertain descriptions', () => {
  const analysis = {summary: ' 可见外壳及转轴。 ', observedParts: ['转轴'], inferredParts: ['内部可能有转子'], uncertainties: ['无法确定尺寸'], unwanted: 'not public'};
  assert.deepEqual(normalizeAnalysis(analysis), {summary: '可见外壳及转轴。', observedParts: ['转轴'], inferredParts: ['内部可能有转子'], uncertainties: ['无法确定尺寸']});
  assert.throws(() => normalizeAnalysis({...analysis, summary: 'x'.repeat(1601)}), /reference_analysis_invalid/);
  assert.throws(() => normalizeAnalysis({...analysis, observedParts: ['x'.repeat(401)]}), /reference_analysis_invalid/);
  assert.throws(() => normalizeAnalysis({...analysis, uncertainties: null}), /reference_analysis_invalid/);
});
