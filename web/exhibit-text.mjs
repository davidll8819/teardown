const TEXT_FILE = 'exhibit-text.json';
const MAX_TEXT_BYTES = 64 * 1024;
const ids = /^[a-zA-Z0-9_-]{1,80}$/;
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = path => { throw new Error(`exhibit_text_invalid: ${path}; provide complete zh-CN and en text in ${TEXT_FILE}`); };

function keys(value, expected, path) {
  if (!object(value) || Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) invalid(path);
}
function bilingual(value, path, max, empty = false) {
  keys(value, ['zh-CN', 'en'], path);
  for (const locale of ['zh-CN', 'en']) {
    if (typeof value[locale] !== 'string' || value[locale].length > max || (!empty && !value[locale].trim())) invalid(`${path}.${locale}`);
  }
  // Equal values are valid for names, numeric labels and invariant units.
  return {'zh-CN': value['zh-CN'], en: value.en};
}
function table(value, path, fields, max) {
  if (!object(value) || Object.keys(value).length > max) invalid(path);
  const result = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!ids.test(id) || forbidden.has(id)) invalid(`${path}.id`);
    keys(entry, Object.keys(fields), `${path}.${id}`);
    result[id] = Object.fromEntries(Object.entries(fields).map(([name, [limit, empty]]) => [name, bilingual(entry[name], `${path}.${id}.${name}`, limit, empty)]));
  }
  return result;
}

/** Validate inert JSON only. This never evaluates the model-authored JavaScript. */
export function validateExhibitText(input) {
  let value = input;
  if (typeof input === 'string') {
    if (Buffer.byteLength(input) > MAX_TEXT_BYTES) invalid('size');
    try {value = JSON.parse(input);} catch {invalid('JSON');}
  }
  keys(value, ['version', 'title', 'subtitle', 'parts', 'parameters', 'readouts', 'tour'], 'root');
  if (value.version !== 1) invalid('version');
  const result = {
    version: 1,
    title: bilingual(value.title, 'title', 160),
    subtitle: bilingual(value.subtitle, 'subtitle', 1600),
    parts: table(value.parts, 'parts', {label: [160], description: [1600]}, 48),
    parameters: table(value.parameters, 'parameters', {label: [160], unit: [80, true]}, 24),
    readouts: table(value.readouts, 'readouts', {label: [160], unit: [80, true]}, 32),
    tour: [],
  };
  if (!Array.isArray(value.tour) || value.tour.length > 24) invalid('tour');
  result.tour = value.tour.map((entry, index) => bilingual(entry, `tour.${index}`, 160));
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_TEXT_BYTES) invalid('size');
  return result;
}

export function readExhibitText(workspace) {
  let source;
  try {source = workspace.read(TEXT_FILE);} catch {throw new Error(`exhibit_text_required: write ${TEXT_FILE} with version, title, subtitle, parts, parameters, readouts and tour before building`);}
  return validateExhibitText(source);
}
