import React, {useEffect, useRef, useState} from 'react';
import {CircleAlert, LoaderCircle, RotateCw} from 'lucide-react';
import {Button} from './ui.jsx';
import {isolatedPreviewDocument, previewMessage, readPreview} from './preview-loader.mjs';

export function SimulatorPreview({url, onRefresh}) {
  const [attempt, setAttempt] = useState(0), [state, setState] = useState({phase: 'loading'});
  const loadTimeout = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setState({phase: 'loading'});
    readPreview(url, {signal: controller.signal}).then(html => {
      if (!current) return;
      setState({phase: 'displaying', html: isolatedPreviewDocument(html)});
      loadTimeout.current = setTimeout(() => {if (current) setState({phase: 'error', error: {code: 'preview_timeout'}});}, 15_000);
    }).catch(error => {if (current) setState({phase: 'error', error});});
    return () => {current = false; controller.abort(); clearTimeout(loadTimeout.current);};
  }, [url, attempt]);
  const retry = () => {setState({phase: 'loading'}); setAttempt(value => value + 1);};
  return <div className="preview-surface">
    {state.html && <iframe key={`${url}:${attempt}`} title="模拟器预览" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={state.html} onLoad={() => {clearTimeout(loadTimeout.current); setState(previous => previous.html ? {...previous, phase: 'ready'} : previous);}} onError={() => {clearTimeout(loadTimeout.current); setState({phase: 'error', error: {code: 'preview_network'}});}}/>}
    {state.phase !== 'ready' && <div className="stage-content preview-status"><div className="state-content" role={state.phase === 'error' ? 'alert' : 'status'}>
      {state.phase === 'error' ? <><CircleAlert/><h3>模拟器暂时无法显示</h3><p>{previewMessage(state.error)}</p><div className="preview-recovery"><Button variant="outline" onClick={retry}><RotateCw/>重新载入结果</Button><button type="button" className="text-button" onClick={onRefresh}>刷新任务列表</button></div></> : <><LoaderCircle className="spin"/><h3>{state.phase === 'displaying' ? '正在打开模型' : '正在载入模拟器'}</h3><p>正在读取这份任务的结果。</p></>}
    </div></div>}
  </div>;
}
