// 4yi Teardown integration, upstream 7d66c89f: an app SSO locale cookie.
// This is a presentation preference, never identity or authorization data.
export function platformLocaleFromCookie(header) {
  const values = new Map();
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const key = part.slice(0, at).trim();
    if (key === '__Host-xclaw_app_locale' || key === 'xclaw_app_locale') values.set(key, part.slice(at + 1).trim());
  }
  const value = values.get('__Host-xclaw_app_locale') ?? values.get('xclaw_app_locale');
  return value === 'zh' ? 'zh-CN' : value === 'en' ? 'en' : null;
}

export const supportedLocale = value => value === 'en' || value === 'zh-CN';
export function browserLocale(value) { return /^zh(?:-|$)/i.test(value || '') ? 'zh-CN' : 'en'; }
export function resolveLocalePreference(saved, platformLocale, fallback) {
  const preference = ['platform', 'zh-CN', 'en'].includes(saved?.preference) ? saved.preference : 'platform';
  // A fresh platform change supersedes an earlier app override; it never resets a job.
  const changed = supportedLocale(platformLocale) && platformLocale !== saved?.platformLocaleAtChoice;
  const effective = changed ? 'platform' : preference;
  return {preference: effective, locale: effective === 'platform' ? platformLocale || fallback : effective};
}
