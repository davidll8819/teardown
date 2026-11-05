const MiB = 1024 * 1024;
export const MAX_REFERENCES = 3;
export const MAX_REFERENCE_BYTES = 2 * MiB;
export const MAX_REFERENCE_TOTAL = 4 * MiB;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Read dimensions before asking the browser to allocate a decoded bitmap.
function dimensions(bytes, type) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset, count) => String.fromCharCode(...bytes.slice(offset, offset + count));
  if (type === 'image/png' && bytes.length >= 24 && text(1, 3) === 'PNG' && bytes[0] === 137 && text(12, 4) === 'IHDR') return [view.getUint32(16), view.getUint32(20)];
  if (type === 'image/webp' && bytes.length >= 30 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    if (text(12, 4) === 'VP8X') return [1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)];
    if (text(12, 4) === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) return [view.getUint16(26, true) & 16383, view.getUint16(28, true) & 16383];
    if (text(12, 4) === 'VP8L' && bytes[20] === 47) return [1 + bytes[21] + ((bytes[22] & 63) << 8), 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10)];
  }
  if (type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
      offset += length;
    }
  }
  throw new Error('图片格式无法识别，请重新导出为 JPG、PNG 或 WebP。');
}

export function blobBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择。'));
    reader.readAsDataURL(blob);
  });
}

export async function prepareReference(file) {
  if (!TYPES.has(file.type)) throw new Error('请上传 JPG、PNG 或 WebP 图片。');
  if (!file.size || file.size > 12 * MiB) throw new Error('单张原图不能超过 12 MB，请缩小后再上传。');
  const size = dimensions(new Uint8Array(await file.arrayBuffer()), file.type);
  if (size.some(value => value < 1 || value > 16384) || size[0] * size[1] > 48_000_000) throw new Error('图片尺寸过大，请缩小到 4800 万像素以内。');
  const source = URL.createObjectURL(file);
  const image = new Image();
  image.src = source;
  try {
    await image.decode();
    const scale = Math.min(1, 1536 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法处理图片，请换用其他浏览器。');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .86));
    canvas.width = canvas.height = 1;
    if (!blob || blob.size > MAX_REFERENCE_BYTES) throw new Error('压缩后图片仍超过 2 MB，请裁小后重试。');
    const data = await blobBase64(blob);
    const name = `${(file.name || '参考图片').replace(/\.[^.]+$/, '').slice(0, 100)}.jpg`;
    return {id: crypto.randomUUID(), name, mimeType: 'image/jpeg', data, bytes: blob.size, url: URL.createObjectURL(blob)};
  } catch (error) {
    if (error instanceof DOMException) throw new Error('这张图片无法打开，请重新保存后上传。');
    throw error;
  } finally { URL.revokeObjectURL(source); }
}

export async function restoreReferences(job) {
  const restored = [];
  try {
    for (const reference of job.references || []) {
      const response = await fetch(`/api/jobs/${job.id}/references/${reference.id}`);
      if (!response.ok) throw new Error('参考图载入失败，请重试。');
      const blob = await response.blob();
      if (blob.size > MAX_REFERENCE_BYTES || !TYPES.has(blob.type)) throw new Error('参考图格式无效，请重新上传。');
      restored.push({...reference, data: await blobBase64(blob), url: URL.createObjectURL(blob)});
    }
    return restored;
  } catch (error) {
    restored.forEach(reference => URL.revokeObjectURL(reference.url));
    throw error;
  }
}
