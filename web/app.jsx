import React, {useCallback, useContext, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Plus, ArrowUp, ArrowUpRight, Search, PanelLeftOpen, SlidersHorizontal, X, Download, RotateCw, Check, CircleAlert, LoaderCircle, Square, ChevronRight, Layers3, Keyboard, MoveUpRight, ImagePlus, Images, Expand} from 'lucide-react';
import {Button, Textarea} from './ui.jsx';
import {prepareReference, restoreReferences, createJobWithReferences, MAX_REFERENCES, MAX_REFERENCE_TOTAL} from './reference-images.js';
import {requestJson as api, RequestError, createReadCoordinator} from './requests.mjs';
import {SimulatorPreview} from './simulator-preview.jsx';
import {readPreview, previewMessage} from './preview-loader.mjs';
import {exportLocaleDocument} from './preview-locale.mjs';
import {useLocale} from './use-locale.jsx';
import {createTranslator, formatStamp, formatDuration, knownMessage} from './i18n-ui.js';
import './style.css';

const UiLocale = React.createContext('zh-CN');
const useText = () => createTranslator(useContext(UiLocale));

const labels = {queued: '等待生成', generating: '生成中', completed: '生成完成', failed: '生成失败', cancelled: '已取消'};
const phases = {analyzing: '分析参考图片', generating: '构思机械结构', working: '编写与完善模拟器', building: '编译交互页面', reviewing: '检查渲染效果'};
const submissionErrors = {
  invalid_locale: '当前语言设置未被接受，请刷新页面后重试。',
  job_already_running: '已有任务正在生成，请等待完成。',
  job_capacity_reached: '当前任务较多，请稍后重试。',
  reference_description_too_large: '参考图上传时描述过长，请缩短到约 3000 字后重试。',
  reference_upload_capacity: '参考图片上传较多，请稍后重试。',
  reference_upload_rate_limited: '参考图片提交过于频繁，请稍后重试。',
  reference_upload_not_found: '参考图片暂存已过期或服务已重启，请重新提交。',
};
const errors = {
  gateway_configuration_missing: '尚未配置模型密钥。请完成网关配置后重新生成。',
  gateway_auth_failed: '模型密钥认证失败。请检查密钥是否完整、有效。',
  gateway_request_invalid: '模型未接受生成参数，请检查模型与工具调用的兼容配置。',
  balance_required: '模型额度不足，请检查当前密钥所属组织的额度。',
  gateway_timeout: '模型响应超时。可以缩小描述范围后重新生成。',
  gateway_unreachable: '暂时无法连接模型服务，请检查网络后重试。',
  model_did_not_call_tools: '模型未返回可用的构建指令，请重新生成。',
  agent_step_limit: '本次构建未能在限定步骤内完成，可以简化需求后重试。',
  interrupted: '上次生成因服务重启而中断，请重新生成。',
  reference_analysis_invalid: '参考图分析未完成，请换用清晰图片后重试。',
  visual_review_limit: '画面或交互检查仍有未解决的问题，本次结果尚未通过检查。可以修改描述后重新生成。',
  visual_review_invalid: '画面检查未返回有效结果，本次未能完成检查。请稍后重试。',
  visual_response_invalid: '未能取得有效的画面检查结果，请稍后重试。',
  visual_configuration_invalid: '画面检查暂时不可用，请稍后重试。',
};
const examples = [
  {name: '电车马达', detail: '从旋转磁场到零件拆解', prompt: '展示一个电车马达的工作原理、主要配件及拆解组装，提供转速和拆解进度控制。'},
  {name: '齿轮传动', detail: '观察啮合与传动比', prompt: '展示齿轮箱的啮合与传动过程，可以调整输入转速，并观察不同齿轮的转速关系。'},
  {name: '飞机起落架', detail: '理解折叠与锁定过程', prompt: '展示飞机起落架的主要部件、折叠展开过程及锁定原理，提供逐步演示控制。'},
];
const running = job => job && ['queued', 'generating'].includes(job.status);
function Mark({className = ''}) { return <svg className={`mark ${className}`} viewBox="0 0 32 36" fill="none" aria-hidden="true"><path d="M16 2 29 9.5 16 17 3 9.5 16 2Z"/><path d="m3 16 13 7.5L29 16M3 22.5 16 30l13-7.5M16 30v4"/></svg>; }
function Status({job}) { const t = useText(); const Icon = running(job) ? LoaderCircle : job.status === 'completed' ? Check : job.status === 'failed' ? CircleAlert : Square; return <span className={`status ${job.status}`}><Icon className={running(job) ? 'spin' : ''}/>{t(labels[job.status])}</span>; }
function QualityNote({quality}) {
  const t = useText();
  const visual = quality?.visual, interaction = quality?.interaction;
  const label = (name, status) => status === 'passed' ? t('{name}检查通过', {name: t(name)}) : status === 'failed' ? t('{name}检查未通过', {name: t(name)}) : t('尚未检查{name}', {name: t(name)});
  const neitherChecked = !['passed', 'failed'].includes(visual) && !['passed', 'failed'].includes(interaction);
  return <p className="quality-note" aria-label={t("结果检查情况")}>{neitherChecked ? t("尚未检查画面和交互") : `${label('画面', visual)} · ${label('交互', interaction)}`}{visual === 'failed' || interaction === 'failed' ? t("，需修改后重新检查。") : visual !== 'passed' || interaction !== 'passed' ? t("，请对照参考图并试用控件。") : ''}</p>;
}
function QualityDetails({quality}) {
  const t = useText();
  const label = status => status === 'passed' ? t('检查通过') : status === 'failed' ? t('检查未通过') : t('未检查');
  return <div className="detail-block"><h3>{t("检查情况")}</h3><p>{t("画面：")}{label(quality?.visual)}<br/>{t("交互：")}{label(quality?.interaction)}</p>{quality?.feedback?.length > 0 && <ol className="stage-history quality-feedback">{quality.feedback.map((review, index) => <li key={index}><span>{t('第 {attempt} 次检查 · {status}', {attempt: review.attempt || index + 1, status: t(review.passed ? '通过' : '需要改进')})}</span><p>{review.feedback || t("未提供补充说明。")}</p></li>)}</ol>}<p>{t("生成完成表示已得到页面；机械精度与实际装配仍需另行验证。")}</p></div>;
}
const referenceUrl = (job, reference) => `/api/jobs/${job.id}/references/${reference.id}`;
function ReferencePhoto({src, name, onOpen}) {
  const t = useText();
  const [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {setFailed(false); setRetry(0);}, [src]);
  return <button type="button" className="reference-photo" aria-label={failed ? t('重新载入 {name}', {name}) : t('放大参考图 {name}', {name})} onClick={() => failed ? (setFailed(false), setRetry(value => value + 1)) : onOpen({src, name})}>{failed ? <span className="image-failure"><RotateCw/>{t("图片加载失败，点击重试")}</span> : <><img src={retry && !src.startsWith('blob:') ? `${src}?retry=${retry}` : src} alt={name} onError={() => setFailed(true)}/><Expand className="image-expand"/></>}</button>;
}
function ReferencePanel({job, onClose, onOpen, onReuse, loading}) {
  const t = useText();
  const analysis = job.analysis;
  const sections = [['observedParts', '图中可见'], ['inferredParts', '结构推测'], ['uncertainties', '尚无法确认']];
  return <aside id="reference-panel" className="detail-panel reference-panel" aria-label={t("参考图与分析")}><div className="detail-heading"><h2>{t("参考对照")}</h2><button type="button" className="icon-button" aria-label={t("关闭参考对照")} onClick={onClose}><X/></button></div><p className="reference-intro">{t('{count} 张参考图 · 点击放大', {count: job.references.length})}</p><div className="reference-gallery">{job.references.map(reference => <figure key={reference.id}><ReferencePhoto src={referenceUrl(job, reference)} name={reference.name} onOpen={onOpen}/><figcaption title={reference.name}>{reference.name}</figcaption></figure>)}</div><div className="analysis-content">{analysis ? <><h3>{t("图片分析")}</h3><p>{analysis.summary}</p>{sections.map(([key, label]) => <div className="analysis-section" key={key}><h3>{t(label)}</h3>{analysis[key]?.length ? <ul>{analysis[key].map((text, index) => <li key={index}>{text}</li>)}</ul> : <p>{t("暂无相关结论。")}</p>}</div>)}</> : <p className="analysis-pending">{running(job) ? t("正在识别外形与结构，分析结果会显示在这里。") : t("本次任务尚未得到图片分析。可复用参考图重新生成。")}</p>}<p className="model-limit">{t("展示模型 · 未验证打印装配")}</p><button type="button" className="text-button" disabled={loading} onClick={() => onReuse(job)}>{loading ? <LoaderCircle className="spin"/> : <RotateCw/>}{t('复用描述与参考图')}</button></div></aside>;
}
function App() {
  const {locale, preference, setPreference, platformAvailable} = useLocale();
  const t = createTranslator(locale);
  const stamp = value => formatStamp(value, locale), duration = job => formatDuration(job, locale);

  const [description, setDescription] = useState(() => {try {return sessionStorage.getItem('teardown-draft') || '';} catch {return '';}});
  const [jobs, setJobs] = useState([]), [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState(undefined), [busy, setBusy] = useState(false), [error, setError] = useState(''), [loadError, setLoadError] = useState('');
  const [submissionUncertain, setSubmissionUncertain] = useState(() => {try {return sessionStorage.getItem('teardown-submit-pending') === '1';} catch {return false;}});
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [navOpen, setNavOpen] = useState(false), [details, setDetails] = useState(false), [help, setHelp] = useState(false), [downloading, setDownloading] = useState(false);
  const [references, setReferences] = useState([]), [processingImages, setProcessingImages] = useState(false), [imageError, setImageError] = useState(''), [dragging, setDragging] = useState(false), [compare, setCompare] = useState(false), [zoomImage, setZoomImage] = useState(null);
  const input = useRef(null), submitLock = useRef(false), helpDialog = useRef(null), fileInput = useRef(null), imageDialog = useRef(null), referencesRef = useRef([]), imageLock = useRef(false), imageEpoch = useRef(0), dragDepth = useRef(0);
  const descriptionRef = useRef(description), descriptionRevision = useRef(0);
  const reads = useRef(null), submitAbort = useRef(null), submitGeneration = useRef(0);
  const refresh = useCallback(() => reads.current?.refresh(), []);
  useEffect(() => {
    const coordinator = createReadCoordinator({
      load: async ({signal}) => {
        const value = await api('/api/jobs', {signal});
        if (!Array.isArray(value?.jobs)) throw new RequestError('request_invalid_response');
        return value.jobs;
      },
      onValue: value => {setJobs(value); setLoaded(true); setLoadError('');},
      onError: () => {setLoadError('任务暂时无法同步，请重试。'); setLoaded(true);},
    });
    reads.current = coordinator;
    void refresh();
    const timer = setInterval(refresh, 3000);
    const reconnect = () => {if (document.visibilityState !== 'hidden') {coordinator.invalidate(); void refresh();}};
    window.addEventListener('online', reconnect); document.addEventListener('visibilitychange', reconnect);
    return () => {
      clearInterval(timer); window.removeEventListener('online', reconnect); document.removeEventListener('visibilitychange', reconnect);
      coordinator.dispose(); if (reads.current === coordinator) reads.current = null;
      submitGeneration.current++; submitAbort.current?.abort();
    };
  }, [refresh]);
  useEffect(() => {try {sessionStorage.setItem('teardown-draft', description);} catch {}}, [description]);
  useEffect(() => {if (help) helpDialog.current?.showModal(); else helpDialog.current?.close();}, [help]);
  useEffect(() => {if (zoomImage) imageDialog.current?.showModal(); else imageDialog.current?.close();}, [zoomImage]);
  useEffect(() => () => {imageEpoch.current++; referencesRef.current.forEach(reference => URL.revokeObjectURL(reference.url));}, []);
  useEffect(() => {const close = e => {if (e.key === 'Escape') setNavOpen(false);}; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);}, []);
  const active = selected === null ? null : selected === undefined ? jobs[0] : jobs.find(job => job.id === selected);
  useEffect(() => {setCompare(Boolean(active?.references?.length)); setDetails(false);}, [active?.id]);
  const ongoing = jobs.find(running);
  const filtered = jobs.filter(job => (filter === 'all' || job.status === 'completed') && job.description.toLowerCase().includes(query.toLowerCase()));
  const ready = active?.status === 'completed';
  const preview = ready ? `/api/jobs/${active.id}/preview` : null;
  function updateDescription(value) {
    if (value === descriptionRef.current) return;
    descriptionRef.current = value; descriptionRevision.current++; setDescription(value);
  }
  function focusPrompt(value) {if (value !== undefined) updateDescription(value); setNavOpen(false); requestAnimationFrame(() => input.current?.focus());}
  function replaceReferences(next) {
    referencesRef.current.forEach(reference => {if (!next.some(item => item.url === reference.url)) URL.revokeObjectURL(reference.url);});
    referencesRef.current = next; setReferences(next);
  }
  function rememberSubmission(uncertain) {
    setSubmissionUncertain(uncertain);
    try {if (uncertain) sessionStorage.setItem('teardown-submit-pending', '1'); else sessionStorage.removeItem('teardown-submit-pending');} catch {}
  }
  function newJob() {if (submitLock.current) return; imageEpoch.current++; replaceReferences([]); setImageError(''); setSelected(null); setError(''); rememberSubmission(false); focusPrompt('');}
  async function addImages(files) {
    if (imageLock.current || submitLock.current) return;
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) return;
    if (referencesRef.current.length + selectedFiles.length > MAX_REFERENCES) {setImageError('最多添加 3 张参考图，请先移除不需要的图片。'); return;}
    imageLock.current = true; setProcessingImages(true); setImageError('');
    const epoch = imageEpoch.current, added = [];
    try {
      for (const file of selectedFiles) added.push(await prepareReference(file));
      if (epoch !== imageEpoch.current) {added.forEach(reference => URL.revokeObjectURL(reference.url)); return;}
      const next = [...referencesRef.current, ...added];
      if (next.reduce((sum, reference) => sum + reference.bytes, 0) > MAX_REFERENCE_TOTAL) throw new Error('参考图总大小不能超过 4 MB，请减少图片或裁小后重试。');
      replaceReferences(next);
    } catch (err) {added.forEach(reference => URL.revokeObjectURL(reference.url)); if (epoch === imageEpoch.current) setImageError(knownMessage(err.message, '图片处理失败，请重新选择。'));}
    finally {imageLock.current = false; setProcessingImages(false);}
  }
  async function reuseJob(job) {
    if (imageLock.current || submitLock.current) return;
    imageLock.current = true; setProcessingImages(true); setImageError('');
    const epoch = imageEpoch.current, revision = descriptionRevision.current;
    try {
      const restored = await restoreReferences(job);
      if (epoch !== imageEpoch.current) {restored.forEach(reference => URL.revokeObjectURL(reference.url)); return;}
      replaceReferences(restored);
      // A slow image fetch must not overwrite text written while it was pending.
      focusPrompt(revision === descriptionRevision.current ? job.description : undefined);
    } catch (err) {if (epoch === imageEpoch.current) setImageError(knownMessage(err.message, '参考图载入失败，请重试。'));}
    finally {imageLock.current = false; setProcessingImages(false);}
  }
  async function submit(event) {
    event?.preventDefault();
    if (submitLock.current || imageLock.current || description.trim().length < 2 || description.length > 8000 || ongoing) return;
    submitLock.current = true; setBusy(true); setError('');
    // Reloading during a POST must not silently turn an uncertain submission
    // into an apparently safe fresh one. Store no image or identity data here.
    try {sessionStorage.setItem('teardown-submit-pending', '1');} catch {}
    const generation = ++submitGeneration.current, controller = new AbortController();
    submitAbort.current = controller;
    try {
      const job = await createJobWithReferences(description.trim(), referencesRef.current, {request: api, signal: controller.signal, locale});
      if (!job || typeof job.id !== 'string' || typeof job.description !== 'string' || !Object.hasOwn(labels, job.status)) throw new RequestError('request_invalid_response', {uncertain: true});
      if (generation !== submitGeneration.current) return;
      // An older list response must not erase this accepted job. A follow-up
      // list read is independent of submission and cannot hold its UI lock.
      reads.current?.invalidate();
      setJobs(previous => [job, ...previous.filter(j => j.id !== job.id)]); setSelected(job.id);
      updateDescription(''); replaceReferences([]); setImageError(''); rememberSubmission(false);
      void refresh();
    } catch (err) {
      if (generation !== submitGeneration.current) return;
      if (err.uncertain) {
        // Aborting fetch does not cancel a server-side creation. Do not match
        // by description or retry the POST: either would invent certainty.
        rememberSubmission(true); reads.current?.invalidate(); void refresh();
      } else {
        if (!submissionUncertain) rememberSubmission(false);
        setError(submissionErrors[err.message] || (/reference|image|body_too_large/.test(err.message) ? '参考图片未被接受，请检查图片格式、大小后重试。' : '提交失败，请检查网络和描述后重试。'));
      }
    } finally {
      if (generation === submitGeneration.current) {submitAbort.current = null; submitLock.current = false; setBusy(false);}
    }
  }
  async function cancel(id) {try {await api(`/api/jobs/${id}/cancel`, {method: 'POST'}); await refresh();} catch {setError('取消未成功，请刷新任务后重试。');}}
  async function download() {
    setDownloading(true); setError('');
    try {const html = exportLocaleDocument(await readPreview(`${preview}?locale=${encodeURIComponent(locale)}`), locale); const url = URL.createObjectURL(new Blob([html], {type: 'text/html;charset=utf-8'})); const link = document.createElement('a'); link.href = url; link.download = `teardown-${active.id.slice(0,8)}.html`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);}
    catch (err) {setError({download: true, code: err.code});} finally {setDownloading(false);}
  }
  const currentPhase = t(phases[active?.phase] || '构思与生成模拟器');
  const localeHint = platformAvailable ? '使用 4yi 最近传入的语言。未同步时请从应用市场重新打开。' : '尚未收到 4yi 语言。可在此切换语言，或从应用市场重新打开。';
  const helper = processingImages ? '正在处理参考图，完成后即可提交。' : ongoing ? '任务正在生成，你可以先准备下一个描述。' : description.trim().length === 1 ? '再补充至少 1 个字，即可生成。' : references.length && !description.trim() ? '再写一句想分析的内容（至少 2 个字），即可生成。' : references.length ? '将结合参考图分析外形与结构，再生成展示模型。' : '描述机械对象、工作原理，或你想拆开的部分。';
  return <UiLocale.Provider value={locale}><div className="app-shell">
    <aside className={`sidebar ${navOpen ? 'is-open' : ''}`} aria-label={t("任务导航")}>
      <div className="brand"><Mark/><div><strong>3D <span>simulator</span></strong><small>{t("机械探索工作台")}</small></div><button className="icon-button mobile-close" aria-label={t("关闭任务列表")} onClick={() => setNavOpen(false)}><X/></button></div>
      <Button className="new-button" variant="outline" disabled={busy} onClick={newJob}><Plus/>{t("新建模拟器")}<span className="new-key">＋</span></Button>
      <div className="library-heading"><h2>{t("我的模拟器")}</h2><button className="icon-button" aria-label={t("刷新任务列表")} title={t("刷新任务列表")} onClick={refresh}><RotateCw/></button></div>
      <label className="search"><Search/><input value={query} onChange={e => setQuery(e.target.value)} placeholder={t("搜索机械或描述")} aria-label={t("搜索任务")}/>{query && <button aria-label={t("清除搜索")} onClick={() => setQuery('')}><X/></button>}</label>
      <div className="filters" aria-label={t("任务筛选")}><button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>{t("全部任务")}</button><button aria-pressed={filter === 'completed'} onClick={() => setFilter('completed')}>{t("已生成")}</button></div>
      <div className="task-list">
        {!loaded ? <p className="list-message">{t("正在载入任务…")}</p> : filtered.length === 0 ? <p className="list-message">{query ? t("没有匹配的模拟器。") : filter === 'completed' ? t("生成的模拟器会保存在这里。") : t("你的第一次探索，从一个问题开始。")}</p> : filtered.map(job => <button className={`task ${active?.id === job.id ? 'selected' : ''}`} key={job.id} aria-current={active?.id === job.id ? 'true' : undefined} title={job.description} onClick={() => {setSelected(job.id); setNavOpen(false); setError('');}}><div className="task-name">{job.description}</div><div className="task-meta"><Status job={job}/><time dateTime={job.createdAt}>{stamp(job.createdAt)}</time></div></button>)}
      </div>
      {loadError && <div className="sync-error" role="alert">{t(loadError)}<button onClick={refresh}>{t("重新连接")}</button></div>}
      <div className="sidebar-footer"><button onClick={() => setHelp(true)}><Keyboard/>{t("使用指南")}<ArrowUpRight/></button><div><span>3D simulator</span><span>{t("交互 · 理解 · 探索")}</span></div></div>
    </aside>
    {navOpen && <button className="nav-scrim" aria-label={t("关闭任务列表遮罩")} onClick={() => setNavOpen(false)}/>}
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button nav-toggle" aria-label={t("打开任务列表")} aria-expanded={navOpen} onClick={() => setNavOpen(true)}><PanelLeftOpen/></button><Mark className="mobile-mark"/><span>{t("工作台")}</span><ChevronRight/><h1>{active ? t("模拟器预览") : t("新建模拟器")}</h1></div><div className="top-actions"><label className="language-control"><span className="sr-only">{t('界面语言')}</span><select aria-label={t('界面语言')} value={preference} onChange={event => setPreference(event.target.value)} aria-describedby={preference === 'platform' ? 'locale-hint' : undefined}><option value="platform">{t('跟随 4yi')}</option><option value="zh-CN">中文</option><option value="en">English</option></select></label>{active && <Status job={active}/>}<button className={`icon-button ${details ? 'is-active' : ''}`} aria-label={t("任务详情")} title={t("任务详情")} aria-pressed={details} onClick={() => {setDetails(!details); setCompare(false);}}><SlidersHorizontal/></button></div></header>
      {preference === 'platform' && <p id="locale-hint" className="locale-hint">{t(localeHint)}</p>}
      <main className="work-area">
        <div className="object-header"><div className="object-title"><div className="object-type"><Layers3/><span>{active ? t("交互式机械模型") : t("从想象，到看得见的原理")}</span></div><h2 title={active?.description}>{active?.description || t("今天，拆开哪台机器？")}</h2></div><div className="object-actions">{active?.references?.length > 0 && <Button variant="outline" aria-controls="reference-panel" aria-expanded={compare} onClick={() => {setCompare(!compare); setDetails(false);}}><Images/><span>{t("参考对照")}</span></Button>}{ready && <><Button variant="outline" onClick={download} disabled={downloading}><Download/><span>{downloading ? t("下载中") : t("下载 HTML")}</span></Button><a className="button-link" href={`${preview}?locale=${encodeURIComponent(locale)}`} target="_blank" rel="noopener noreferrer"><ArrowUpRight/><span>{t("独立窗口")}</span></a></>}{running(active) && <Button variant="outline" onClick={() => cancel(active.id)}><Square/>{t("取消生成")}</Button>}</div></div>
        <div className={`stage-layout ${details ? 'with-details' : compare && active?.references?.length ? 'with-reference' : ''}`}>
          <section className={`viewport ${ready ? 'has-preview' : ''}`} aria-label={t("模拟器工作区")}>
            <div className="viewport-toolbar"><span><span className={`state-dot ${ready ? 'is-ready' : ''}`}/>{ready ? t("交互预览") : running(active) ? currentPhase : active ? t("任务状态") : t("创作空间")}</span><span>{ready ? t("在模型中直接操作") : running(active) ? t("完成后自动显示") : '3D simulator'}</span></div>
            {ready ? <><SimulatorPreview key={active.id} url={preview} locale={locale} onRefresh={refresh}/><QualityNote quality={active.quality}/></> : <div className="stage-content">
              {!loaded ? <div className="state-content"><LoaderCircle className="spin"/><h3>{t("正在打开工作台")}</h3><p>{t("读取你的模拟器和任务记录。")}</p></div> : running(active) ? <div className="state-content"><div className="working-mark"><Mark/><LoaderCircle className="spin"/></div><h3>{currentPhase}</h3><p>{t("正在把你的描述转化为可交互的机械模型。")}<br/>{t("你可以离开此页，稍后从任务列表继续查看。")}</p><div className="live-stage"><span className="state-dot"/>{t("已开始 ·")} {stamp(active.createdAt)}</div></div> : active ? <div className="state-content"><CircleAlert/><h3>{active.status === 'cancelled' ? t("这次探索已暂停") : t("这次生成没有完成")}</h3><p>{active.status === 'cancelled' ? t("描述仍然保留，随时可以再次开始。") : t(errors[active.error] || "生成过程中遇到了问题。请重新编辑描述后再试一次。")}</p><Button variant="outline" disabled={processingImages || busy} onClick={() => reuseJob(active)}><RotateCw/>{t(active.references?.length ? '重新编辑并保留参考图' : '重新编辑描述')}</Button></div> : <div className="welcome"><Mark/><h3>{t("理解机械，从拆开它开始。")}</h3><p>{t("描述一台机器，让运动、结构和工作原理变得直观。")}</p><div className="examples">{examples.map(item => <button key={item.name} onClick={() => focusPrompt(t(item.prompt))}><span>{t(item.name)}<MoveUpRight/></span><small>{t(item.detail)}</small></button>)}</div></div>}
            </div>}
          </section>
          {compare && active?.references?.length > 0 && <ReferencePanel key={active.id} job={active} onClose={() => setCompare(false)} onOpen={setZoomImage} onReuse={reuseJob} loading={processingImages || busy}/>}
          {details && <aside className="detail-panel" aria-label={t("任务详情面板")}><div className="detail-heading"><h2>{active ? t("任务详情") : t("创作提示")}</h2><button className="icon-button" aria-label={t("关闭任务详情")} onClick={() => setDetails(false)}><X/></button></div>{active ? <><div className="detail-block"><h3>{t("原始描述")}</h3><p>{active.description}</p></div><dl><div><dt>{t("创建时间")}</dt><dd>{stamp(active.createdAt)}</dd></div><div><dt>{t("当前状态")}</dt><dd>{t(labels[active.status])}</dd></div>{!running(active) && <div><dt>{ready ? t("生成用时") : t("运行用时")}</dt><dd>{duration(active)}</dd></div>}{ready && <div><dt>{t("结果格式")}</dt><dd>{t("交互式 HTML")}</dd></div>}</dl>{(ready || active.quality) && <QualityDetails quality={active.quality}/>} {active.stages?.length > 0 && <div className="detail-block"><h3>{t("生成记录")}</h3><ol className="stage-history">{active.stages.map((stage, i) => <li key={`${stage.at}-${i}`}><span>{t(phases[stage.phase])}</span><time>{new Date(stage.at).toLocaleTimeString(locale, {hour12:false})}</time></li>)}</ol></div>}<div className="detail-block"><h3>{t("继续探索")}</h3><p>{t("使用模型中的控件观察运动和拆解。想看另一种结构，可以在下方创建新模拟器。")}</p><button className="text-button" disabled={processingImages || busy} onClick={() => reuseJob(active)}>{t(active.references?.length ? '复用描述与参考图' : '复用描述')}<ArrowUpRight/></button></div></> : <><div className="detail-block"><h3>{t("从具体对象开始")}</h3><p>{t("如电车马达、机械手表、液压泵。")}</p></div><div className="detail-block"><h3>{t("说清楚想看什么")}</h3><p>{t("外壳里的零件、传动过程，或拆解与组装的顺序。")}</p></div><div className="detail-block"><h3>{t("加入可操作的细节")}</h3><p>{t("调节转速、切换视角、逐步展开，帮助你观察每个动作。")}</p></div></>}</aside>}
        </div>
        <form className={`composer ${dragging ? 'is-dragging' : ''}`} onSubmit={submit}
          onDragEnter={event => {if (Array.from(event.dataTransfer.types).includes('Files')) {event.preventDefault(); dragDepth.current++; setDragging(true);}}}
          onDragOver={event => {if (Array.from(event.dataTransfer.types).includes('Files')) {event.preventDefault(); event.dataTransfer.dropEffect = 'copy';}}}
          onDragLeave={event => {if (Array.from(event.dataTransfer.types).includes('Files')) {dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false);}}}
          onDrop={event => {if (Array.from(event.dataTransfer.types).includes('Files')) {event.preventDefault(); dragDepth.current = 0; setDragging(false); void addImages(event.dataTransfer.files);}}}
          onPaste={event => {const files = Array.from(event.clipboardData.items).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean); if (files.length) {event.preventDefault(); void addImages(files);}}}>
          <div className="composer-title"><label htmlFor="description">{active ? t("开始下一次探索") : t("描述你的机械想法")}</label><span>{dragging ? t("松开添加参考图") : t("描述 + 参考图")}</span></div>
          <Textarea ref={input} id="description" value={description} onChange={event => updateDescription(event.target.value)} disabled={busy} onKeyDown={event => {if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {event.preventDefault(); void submit();}}} minLength={2} maxLength={8000} required aria-describedby="prompt-help" placeholder={t("比如：对照照片拆开这台马达，看看定子与转子如何配合…")}/>
          {references.length > 0 && <div className="draft-references" aria-label={t("待提交的参考图片")}>{references.map(reference => <div className="draft-reference" key={reference.id}><ReferencePhoto src={reference.url} name={reference.name} onOpen={setZoomImage}/><div><span title={reference.name}>{reference.name}</span><small>{t("已准备 ·")} {new Intl.NumberFormat(locale, {maximumFractionDigits: 0}).format(reference.bytes / 1024)} KB</small></div><button type="button" className="icon-button" disabled={busy || processingImages} aria-label={t('移除参考图 {name}', {name: reference.name})} onClick={() => {replaceReferences(referencesRef.current.filter(item => item.id !== reference.id)); setImageError('');}}><X/></button></div>)}</div>}
          <div className="composer-bottom"><div className="composer-support"><input ref={fileInput} id="reference-upload" className="file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple tabIndex={-1} aria-label={t("上传参考图片")} disabled={busy || processingImages || references.length >= MAX_REFERENCES} onChange={event => {void addImages(event.target.files); event.target.value = '';}}/><Button type="button" variant="outline" className="upload-button" disabled={busy || processingImages || references.length >= MAX_REFERENCES} onClick={() => fileInput.current?.click()} title={references.length >= MAX_REFERENCES ? t("已添加 3 张图片，请先移除再替换") : t("选择参考图片，也支持拖入或粘贴图片")}>{processingImages ? <LoaderCircle className="spin"/> : <ImagePlus/>}{processingImages ? t("处理图片中") : `${t('参考图片')}${references.length ? ` ${references.length}/3` : ''}`}</Button><p id="prompt-help">{t(helper)}</p></div><Button type="submit" disabled={busy || processingImages || description.trim().length < 2 || Boolean(ongoing)}>{busy ? <LoaderCircle className="spin"/> : <ArrowUp/>}{busy ? t("正在提交") : submissionUncertain ? t("仍要再次提交") : t("生成模拟器")}</Button></div>
          {submissionUncertain && !busy && <div className="form-error" role="status"><CircleAlert/><div>{t("提交结果尚未确认，描述已保留。请先检查任务列表；再次提交可能重复创建任务。")}<button type="button" className="text-button" onClick={refresh}><RotateCw/>{t("检查任务列表")}</button></div></div>}
          <p className="creation-note">{t("生成后请对照参考图检查结构，并试用运动与拆解控件。")}</p>
          <p className="upload-hint">{t("最多 3 张 JPG、PNG 或 WebP，单张原图 ≤ 12 MB。支持拖入、粘贴；提交后用于模型分析。")}</p>
          {imageError && <div className="form-error" role="alert"><CircleAlert/>{t(imageError)}</div>}{error && <div className="form-error" role="alert"><CircleAlert/>{typeof error === 'object' ? `${t('下载未成功。')}${previewMessage(error, locale)}` : t(error)}</div>}
        </form>
        <footer className="workspace-footer"><span>{t("让复杂的机械原理，成为可以触碰的知识。")}</span><span><Keyboard/>{t("⌘ / Ctrl + Enter 提交")}</span></footer>
      </main>
    </div>
    <dialog ref={imageDialog} className="image-dialog" aria-label={t("参考图片大图")} onCancel={() => setZoomImage(null)} onClick={event => {if (event.target === event.currentTarget) setZoomImage(null);}}><div className="detail-heading"><h2>{zoomImage?.name || t("参考图片")}</h2><button type="button" className="icon-button" aria-label={t("关闭参考图片大图")} onClick={() => setZoomImage(null)}><X/></button></div>{zoomImage && <img src={zoomImage.src} alt={zoomImage.name}/>}</dialog>
    <dialog ref={helpDialog} onCancel={() => setHelp(false)} onClick={e => {if (e.target === e.currentTarget) setHelp(false);}} className="help-dialog"><div className="detail-heading"><h2>{t("开始你的机械探索")}</h2><button className="icon-button" aria-label={t("关闭使用指南")} onClick={() => setHelp(false)}><X/></button></div><ol><li><strong>{t("描述对象，加入参考图")}</strong><p>{t("至少输入 2 个字，可上传、拖入或粘贴最多 3 张产品照片。图片会参与模型分析，草稿图片刷新后需重新添加。")}</p></li><li><strong>{t("对照结构分析")}</strong><p>{t("图中可见、结构推测与无法确认的部分会分别列出。提交后参考图与任务一起保存。")}</p></li><li><strong>{t("操作与保存")}</strong><p>{t("生成完成后可预览、打开独立窗口或下载 HTML。结果下方会说明画面与交互是否经过检查，未检查时请对照参考图并试用控件。")}</p></li></ol><Button onClick={() => {setHelp(false); focusPrompt();}}>{t("开始探索")}<ArrowUpRight/></Button></dialog>
  </div></UiLocale.Provider>;
}
createRoot(document.getElementById('root')).render(<App/>);
