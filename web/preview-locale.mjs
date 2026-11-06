export const PREVIEW_LOCALE_MESSAGE = '3d-simulator.locale.v1';
export function supportsPreviewLocale(html) {
  return /<meta\s+name="teardown-i18n"\s+content="1"\s*\/?\s*>/i.test(html);
}

// Downloaded blobs lose their request URL. Select the initial language in this
// exported copy only; stored and legacy artifacts retain their original bytes.
export function exportLocaleDocument(html, locale) {
  if (!supportsPreviewLocale(html)) return html;
  if (!['en', 'zh-CN'].includes(locale)) throw new Error('preview_locale_invalid');
  return html.replace(/<html\b([^>]*)\blang="(?:en|zh-CN)"/i, `<html$1lang="${locale}"`);
}

// Call only after isolatedPreviewDocument. This adds a display-only bridge;
// the result remains an opaque sandbox and receives no credentials or job data.
export function previewLocaleDocument(html, locale, parentOrigin) {
  if (!supportsPreviewLocale(html)) return html;
  if (!['en', 'zh-CN'].includes(locale)) throw new Error('preview_locale_invalid');
  const origin = new URL(parentOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== parentOrigin) throw new Error('preview_parent_origin_invalid');
  const config = JSON.stringify({locale, parentOrigin, type: PREVIEW_LOCALE_MESSAGE}).replace(/</g, '\\u003c');
  const bridge = `<script>(()=>{const config=${config};const apply=locale=>{document.documentElement.lang=locale;window.dispatchEvent(new CustomEvent('teardown:locale',{detail:locale}));};apply(config.locale);window.addEventListener('message',event=>{if(event.source!==parent||event.origin!==config.parentOrigin||!event.data||event.data.type!==config.type||!['en','zh-CN'].includes(event.data.locale))return;apply(event.data.locale);});})();</script>`;
  return html.replace(/<\/head\s*>/i, `${bridge}</head>`);
}
