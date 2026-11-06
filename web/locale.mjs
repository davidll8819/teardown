/** Task language is immutable once submitted; absent values preserve legacy behavior. */
export function normalizeJobLocale(value) {
  if (value === undefined) return 'zh-CN';
  if (value === 'zh-CN' || value === 'en') return value;
  throw new Error('invalid_locale');
}
