import {useEffect, useRef, useState, useCallback} from 'react';
import {requestJson} from './requests.mjs';
import {browserLocale, supportedLocale, resolveLocalePreference} from './platform-locale.mjs';

const prefix = '3d-simulator:locale:v1:';
function readPreference(key) {
  try { return key ? JSON.parse(localStorage.getItem(key) || 'null') : null; } catch { return null; }
}
function writePreference(key, value) {
  try { if (key) localStorage.setItem(key, JSON.stringify(value)); } catch { /* Language changes also work without storage. */ }
}
export function useLocale() {
  const fallback = useRef(browserLocale(navigator.language));
  const [state, setState] = useState({locale: fallback.current, preference: 'platform', platformAvailable: false});
  const context = useRef({key: null, platformLocale: null, lastKnownLocale: null, saved: null, initialized: false, pendingExplicit: false});
  useEffect(() => {
    let disposed = false, pending = false;
    const controller = new AbortController();
    const apply = (saved, persist = true) => {
      const current = context.current;
      const resolved = resolveLocalePreference(saved, current.platformLocale, current.lastKnownLocale || fallback.current);
      // Once a platform change takes over, do not resurrect the old manual
      // preference when the platform later returns to its previous language.
      const next = {
        preference: resolved.preference,
        platformLocaleAtChoice: current.platformLocale || (supportedLocale(saved?.platformLocaleAtChoice) ? saved.platformLocaleAtChoice : null),
        lastKnownLocale: current.lastKnownLocale,
      };
      current.saved = next;
      if (persist) writePreference(current.key, next);
      setState({...resolved, platformAvailable: supportedLocale(context.current.platformLocale)});
    };
    const refresh = async () => {
      if (disposed || pending) return;
      pending = true;
      try {
        const data = await requestJson('/api/locale', {signal: controller.signal});
        if (disposed) return;
        const scope = typeof data.scopeFingerprint === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(data.scopeFingerprint) ? data.scopeFingerprint : null;
        const key = scope ? prefix + scope : null;
        // Missing scope must not reuse a previous account's language/cache.
        const locale = key && supportedLocale(data.locale) ? data.locale : null;
        const previous = context.current;
        const sameScope = previous.initialized && key === previous.key;
        const initialChoice = key && !previous.initialized && previous.pendingExplicit;
        // A choice made while the first request is pending belongs to the
        // first identified account; later account changes read their own key.
        const saved = initialChoice ? {...previous.saved, platformLocaleAtChoice: locale}
          : sameScope ? previous.saved : readPreference(key);
        const lastKnownLocale = locale || (key && sameScope ? previous.lastKnownLocale : key && supportedLocale(saved?.lastKnownLocale) ? saved.lastKnownLocale : null);
        context.current = {key, platformLocale: locale, lastKnownLocale, saved, initialized: true, pendingExplicit: false};
        apply(saved);
      } catch { /* Keep the current language during a temporary disconnect. */ }
      finally { pending = false; }
    };
    const visible = () => { if (!document.hidden) void refresh(); };
    const stored = event => { if (context.current.key && event.key === context.current.key) apply(readPreference(context.current.key), false); };
    void refresh();
    const timer = setInterval(visible, 5000);
    window.addEventListener('focus', visible);
    window.addEventListener('online', visible);
    window.addEventListener('storage', stored);
    document.addEventListener('visibilitychange', visible);
    return () => { disposed = true; controller.abort(); clearInterval(timer); window.removeEventListener('focus', visible); window.removeEventListener('online', visible); window.removeEventListener('storage', stored); document.removeEventListener('visibilitychange', visible); };
  }, []);
  useEffect(() => { document.documentElement.lang = state.locale; }, [state.locale]);
  const setPreference = useCallback(preference => {
    if (!['platform', 'zh-CN', 'en'].includes(preference)) return;
    const saved = {preference, platformLocaleAtChoice: context.current.platformLocale};
    saved.lastKnownLocale = context.current.lastKnownLocale;
    context.current.saved = saved;
    context.current.pendingExplicit = !context.current.initialized && preference !== 'platform';
    writePreference(context.current.key, saved);
    setState({...resolveLocalePreference(saved, context.current.platformLocale, context.current.lastKnownLocale || fallback.current), platformAvailable: supportedLocale(context.current.platformLocale)});
  }, []);
  return {...state, setPreference};
}
