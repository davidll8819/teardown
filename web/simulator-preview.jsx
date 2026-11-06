import React, {useEffect, useRef, useState} from 'react';
import {CircleAlert, LoaderCircle, RotateCw} from 'lucide-react';
import {Button} from './ui.jsx';
import {isolatedPreviewDocument, previewMessage, readPreview} from './preview-loader.mjs';
import {PREVIEW_LOCALE_MESSAGE, previewLocaleDocument, supportsPreviewLocale} from './preview-locale.mjs';

export function SimulatorPreview({url, onRefresh, locale = 'zh-CN'}) {
  const [attempt, setAttempt] = useState(0), [state, setState] = useState({phase: 'loading'});
  const loadTimeout = useRef(null), iframe = useRef(null), currentLocale = useRef(locale);
  currentLocale.current = locale;
  const text = (zh, en) => locale === 'en' ? en : zh;
  const syncLocale = () => {
    // An opaque srcdoc frame cannot be addressed by an origin; the message is
    // only a locale, and its receiver checks the parent window and exact origin.
    iframe.current?.contentWindow?.postMessage({type: PREVIEW_LOCALE_MESSAGE, locale: currentLocale.current}, '*');
  };
  useEffect(() => {syncLocale();}, [locale]);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setState({phase: 'loading'});
    readPreview(url, {signal: controller.signal}).then(html => {
      if (!current) return;
      const localized = supportsPreviewLocale(html);
      setState({phase: 'displaying', localized, html: previewLocaleDocument(isolatedPreviewDocument(html), currentLocale.current, window.location.origin)});
      loadTimeout.current = setTimeout(() => {if (current) setState({phase: 'error', error: {code: 'preview_timeout'}});}, 15_000);
    }).catch(error => {if (current) setState({phase: 'error', error});});
    return () => {current = false; controller.abort(); clearTimeout(loadTimeout.current);};
  }, [url, attempt]);
  const retry = () => {setState({phase: 'loading'}); setAttempt(value => value + 1);};
  return <><div className="preview-surface">
    {state.html && <iframe ref={iframe} key={`${url}:${attempt}`} title={text('模拟器预览', 'Simulator preview')} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={state.html} onLoad={() => {clearTimeout(loadTimeout.current); syncLocale(); setState(previous => previous.html ? {...previous, phase: 'ready'} : previous);}} onError={() => {clearTimeout(loadTimeout.current); setState({phase: 'error', error: {code: 'preview_network'}});}}/>}
    {state.phase !== 'ready' && <div className="stage-content preview-status"><div className="state-content" role={state.phase === 'error' ? 'alert' : 'status'}>
      {state.phase === 'error' ? <><CircleAlert/><h3>{text('模拟器暂时无法显示', 'The simulator cannot be displayed')}</h3><p>{previewMessage(state.error, locale)}</p><div className="preview-recovery"><Button variant="outline" onClick={retry}><RotateCw/>{text('重新载入结果', 'Reload result')}</Button><button type="button" className="text-button" onClick={onRefresh}>{text('刷新任务列表', 'Refresh tasks')}</button></div></> : <><LoaderCircle className="spin"/><h3>{state.phase === 'displaying' ? text('正在打开模型', 'Opening model') : text('正在载入模拟器', 'Loading simulator')}</h3><p>{text('正在读取这份任务的结果。', 'Reading the result for this task.')}</p></>}
    </div></div>}
  </div>
    {state.phase === 'ready' && !state.localized && <p className="quality-note">{text('这份历史结果保留原来的语言。新生成的模型支持中英文切换。', 'This earlier result keeps its original language. Newly generated models support Chinese and English.')}</p>}
  </>;
}
