// Trusted presentation controls for generated mechanical models. This module does
// not supply a machine, invent telemetry, certify physics, or grant execution rights.
import * as THREE from 'three';
import {createMechanicalStage} from './simulator-stage.js';

const MODES = Object.freeze({assembled: '装配', cutaway: '剖切', exploded: '爆炸'});
const VIEWS = Object.freeze({perspective: [4, 2.4, 4], front: [0, 0.02, 1], side: [1, 0.02, 0], top: [0.01, 1, 0]});
const VIEW_LABELS = {perspective: '透视', front: '正面', side: '侧面', top: '俯视'};
const IDLE_MS = 25_000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const now = () => performance.now();

// Reference-led instrumentation: cream, graphite and one safety-orange accent.
// Wide grid arithmetic: 216 + 2×16 + flexible model area + 236 = total width.
// At tablet/phone widths the two instrument rails move BELOW the real canvas.
const CSS = `
.td-exhibit{--paper:#f4f1eb;--surface:#faf8f3;--ink:#232522;--muted:#69675f;--line:#dfdcd4;--accent:#ee4d25;--accent-ink:#b53213;box-sizing:border-box;background:var(--paper);color:var(--ink);font:14px/1.45 Arial,"PingFang SC","Microsoft YaHei",sans-serif;width:100%;height:100%;overflow:auto;min-width:0;padding:18px;isolation:isolate}
.td-exhibit *{box-sizing:border-box}.td-exhibit button,.td-exhibit input{font:inherit}.td-exhibit button{color:inherit;cursor:pointer}.td-exhibit button:disabled{cursor:default;color:var(--muted)}
.td-exhibit button:focus-visible,.td-exhibit input:focus-visible,.td-exhibit canvas:focus-visible{outline:2px solid var(--accent-ink);outline-offset:3px}.td-exhibit [hidden]{display:none!important}
.td-exhibit__header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 0 16px;border-bottom:1px solid var(--line)}
.td-exhibit__identity{display:flex;align-items:center;gap:16px;min-width:0}.td-exhibit__mark{color:var(--accent);flex:none;width:42px;height:42px}.td-exhibit h1{font-size:25px;font-weight:600;line-height:1.15;margin:0 0 5px;letter-spacing:-.6px;overflow-wrap:anywhere}.td-exhibit__subtitle{margin:0;color:var(--muted);font-size:12px;max-width:66ch;overflow-wrap:anywhere}
.td-exhibit__meta{display:flex;align-items:center;gap:22px;flex:none}.td-exhibit__meta-item{display:grid;gap:3px}.td-exhibit__label{color:var(--muted);font-size:11px}.td-exhibit__num{font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace;font-variant-numeric:tabular-nums}.td-exhibit__status{font-size:12px;white-space:nowrap}.td-exhibit__status:before{content:"";display:inline-block;background:var(--accent);width:5px;height:5px;margin:0 7px 2px 0}
.td-exhibit__grid{display:grid;grid-template-columns:216px minmax(0,1fr) 236px;gap:16px;align-items:start;padding:16px 0}.td-exhibit__rail{display:grid;gap:16px;min-width:0}.td-exhibit__panel{padding:14px;background:var(--surface);border:1px solid var(--line);border-radius:4px;min-width:0}.td-exhibit__panel h2{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;margin:0 0 14px}.td-exhibit__panel h2:before{content:"";width:2px;height:11px;background:var(--accent);flex:none}
.td-exhibit__readout{padding:12px 0;border-top:1px solid var(--line)}.td-exhibit__readout:first-child{padding-top:0;border-top:0}.td-exhibit__readout:last-child{padding-bottom:0}.td-exhibit__readout-name{font-size:12px;color:var(--muted)}.td-exhibit__reading{display:flex;gap:6px;align-items:baseline;justify-content:flex-end;margin-top:4px}.td-exhibit__value{font-size:25px;line-height:1.2;font-weight:500}.td-exhibit__readout:first-child .td-exhibit__value{font-size:30px}.td-exhibit__unit{font-size:11px;color:var(--muted)}.td-exhibit__gauge{height:3px;background:var(--line);margin-top:10px;overflow:hidden}.td-exhibit__gauge-fill{display:block;background:var(--accent);height:100%;width:0}.td-exhibit__limits{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--muted);margin-top:4px}
.td-exhibit__parameter{display:grid;grid-template-columns:1fr auto;gap:7px;margin-top:15px}.td-exhibit__parameter:first-of-type{margin-top:0}.td-exhibit__parameter label{font-size:12px}.td-exhibit__parameter output{font-size:12px;text-align:right}.td-exhibit input[type=range]{width:100%;min-width:0;margin:0;accent-color:var(--accent);height:25px;cursor:pointer}.td-exhibit__parameter input{grid-column:1/-1}.td-exhibit__note{margin:9px 0 0;color:var(--muted);font-size:11px;line-height:1.6}
.td-exhibit__center{min-width:0;position:relative}.td-exhibit__viewport{position:relative;width:100%;height:clamp(400px,66vh,720px);min-width:0;overflow:hidden}.td-exhibit__viewport canvas{position:absolute;inset:0}.td-exhibit__canvas-top{position:absolute;left:12px;right:12px;top:12px;display:flex;justify-content:space-between;gap:8px;pointer-events:none;font-size:11px;color:var(--muted)}.td-exhibit__canvas-bottom{position:absolute;bottom:18px;left:12px;pointer-events:none;max-width:calc(100% - 24px)}.td-exhibit__mode-name{font-size:21px;color:var(--accent-ink);font-weight:600;line-height:1.2}.td-exhibit__mode-description{font-size:11px;color:var(--muted);margin-top:5px;max-width:35ch}.td-exhibit__selection-tag{position:absolute;max-width:180px;padding:5px 8px;background:var(--surface);border:1px solid var(--line);border-left:2px solid var(--accent);font-size:11px;pointer-events:none;transform:translate(-50%,-120%);overflow-wrap:anywhere}.td-exhibit__error{margin:0 0 12px;padding:10px 12px;border-left:2px solid #a8311b;background:var(--surface);font-size:12px;color:#86291a;overflow-wrap:anywhere}
.td-exhibit__buttons{display:flex;gap:5px;flex-wrap:wrap}.td-exhibit__button{border:1px solid #c9c5bc;border-radius:3px;background:transparent;min-height:32px;padding:6px 9px;font-size:12px!important;line-height:1.2}.td-exhibit__button:hover{border-color:var(--ink)}.td-exhibit__button[aria-pressed=true]{border-color:var(--ink);background:var(--ink);color:var(--surface)}.td-exhibit__button--quiet{border-color:transparent}.td-exhibit__section-gap{margin-top:16px}.td-exhibit__part-list{display:grid;gap:1px;max-height:280px;overflow:auto;scrollbar-width:thin}.td-exhibit__part{display:grid;grid-template-columns:minmax(0,1fr) 28px;align-items:center;gap:6px;min-height:35px;border-bottom:1px solid var(--line)}.td-exhibit__part:last-child{border-bottom:0}.td-exhibit__part-select{background:transparent;border:0;padding:8px 0;text-align:left;font-size:12px!important;line-height:1.4;overflow-wrap:anywhere}.td-exhibit__part-select[aria-pressed=true]{color:var(--accent-ink);font-weight:600}.td-exhibit__part-toggle{accent-color:var(--accent);width:16px;height:16px;margin:5px;cursor:pointer}.td-exhibit__selection-title{margin:0 0 5px;font-size:13px;font-weight:600}.td-exhibit__selection-description{margin:0;color:var(--muted);font-size:12px;line-height:1.6;overflow-wrap:anywhere}.td-exhibit__selection-state{margin:8px 0 0;font-size:11px;color:var(--accent-ink)}
.td-exhibit__transport{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:16px;align-items:center;border:1px solid var(--line);border-radius:4px;background:var(--surface);padding:12px 16px}.td-exhibit__play{width:38px;min-height:38px;padding:0;font-size:16px!important;background:var(--accent);color:white!important;border:0;border-radius:50%;display:grid;place-items:center}.td-exhibit__timeline-head{display:flex;justify-content:space-between;gap:10px;font-size:11px;margin-bottom:2px}.td-exhibit__tour-label{color:var(--accent-ink)}.td-exhibit__timeline{position:relative}.td-exhibit__timeline input{display:block;height:25px}.td-exhibit__tour-chapters{display:flex;gap:0;min-height:10px}.td-exhibit__chapter{font-size:11px;border-left:1px solid var(--line);padding:0 4px;color:var(--muted);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.td-exhibit__chapter[aria-current=true]{color:var(--accent-ink)}.td-exhibit__tour-controls{display:grid;gap:3px;justify-items:end}.td-exhibit__idle{font-size:11px;color:var(--muted);text-align:right}.td-exhibit__footer{display:flex;justify-content:space-between;gap:16px;padding-top:12px;font-size:11px;color:var(--muted)}
@media(min-width:1500px){.td-exhibit__grid{grid-template-columns:240px minmax(0,1fr) 260px}.td-exhibit{padding:24px}.td-exhibit__viewport{height:clamp(480px,68vh,800px)}}
@media(max-width:1050px){.td-exhibit__grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.td-exhibit__center{grid-column:1/-1;grid-row:1}.td-exhibit__rail{grid-row:2}.td-exhibit__viewport{height:clamp(380px,58vh,640px)}.td-exhibit__rail--left{grid-template-columns:1fr 1fr}.td-exhibit__rail--right{grid-template-columns:1fr 1fr}.td-exhibit__part-list{max-height:220px}.td-exhibit__meta{gap:16px}}
@media(max-width:760px){.td-exhibit{padding:12px}.td-exhibit__header{align-items:flex-start;padding-bottom:12px}.td-exhibit__identity{gap:10px}.td-exhibit__mark{width:30px;height:30px}.td-exhibit h1{font-size:21px}.td-exhibit__meta-item:first-child{display:none}.td-exhibit__meta{gap:8px}.td-exhibit__grid{gap:12px;padding:12px 0}.td-exhibit__rail{gap:12px;grid-template-columns:1fr}.td-exhibit__viewport{height:clamp(350px,55vh,540px)}.td-exhibit__transport{gap:10px;padding:10px;grid-template-columns:auto minmax(0,1fr)}.td-exhibit__tour-controls{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between}.td-exhibit__tour-controls .td-exhibit__button{min-width:110px}.td-exhibit__button{min-height:40px}.td-exhibit__panel{padding:12px}.td-exhibit__chapter{font-size:11px}.td-exhibit__footer{flex-wrap:wrap;gap:4px}.td-exhibit__part{min-height:44px}.td-exhibit__part-select{min-height:44px}.td-exhibit__part-toggle{width:20px;height:20px;margin:3px}.td-exhibit input[type=range]{height:36px}}
@media(max-width:430px){.td-exhibit__meta{display:none}.td-exhibit__grid{grid-template-columns:1fr 1fr}.td-exhibit__viewport{height:360px}.td-exhibit__panel{padding:10px}.td-exhibit__rail--right{min-width:0}.td-exhibit__buttons{gap:4px}.td-exhibit__button{padding:6px 7px}.td-exhibit__part-list{max-height:250px}.td-exhibit__value{font-size:23px}.td-exhibit__readout:first-child .td-exhibit__value{font-size:27px}}
@media(prefers-reduced-motion:reduce){.td-exhibit *{scroll-behavior:auto!important}}
`;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function indexed(items, kind) {
  if (!Array.isArray(items)) throw new TypeError(`exhibit_${kind}_must_be_array`);
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) throw new TypeError(`exhibit_${kind}_unique_id_required`);
    ids.add(item.id);
  }
  return items;
}

function numericPath(state, key) {
  if (typeof key !== 'string' || !key) return null;
  let value = state;
  for (const field of key.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, field) || ['__proto__', 'constructor', 'prototype'].includes(field)) return null;
    value = value[field];
  }
  return finite(value) ? value : null;
}

/**
 * Owns controls/stage, not the caller's mesh/material resources. Call dispose()
 * before disposing caller resources. Explode vectors use each object's ORIGINAL
 * parent coordinates; wrapper groups protect animated pivots/transforms. Mark only
 * removable shells cutaway:true. Readouts are numeric state paths; absent is null.
 */
export function createMechanicalExhibit(options = {}) {
  const {container, root, model, update} = options;
  if (!container?.appendChild) throw new TypeError('exhibit_container_required');
  if (!root?.isObject3D) throw new TypeError('exhibit_root_required');
  if (typeof model !== 'function' || typeof update !== 'function') throw new TypeError('exhibit_model_and_update_required');
  const descendants = new Set(); root.traverse(object => descendants.add(object));
  const partObjects = new Set();
  const parts = indexed(options.parts ?? [], 'parts').map(part => {
    if (part.object === root || !descendants.has(part.object) || partObjects.has(part.object)) throw new TypeError(`exhibit_part_object_invalid:${part.id}`);
    partObjects.add(part.object);
    const vector = part.explode ?? [0, 0, 0];
    if (!Array.isArray(vector) || vector.length !== 3 || !vector.every(finite)) throw new TypeError(`exhibit_explode_invalid:${part.id}`);
    return {...part, label: String(part.label ?? part.id), description: String(part.description ?? ''), explode: [...vector], cutaway: part.cutaway === true, shown: true};
  });
  const parameterDefs = indexed(options.parameters ?? [], 'parameters').map(parameter => {
    if (![parameter.value, parameter.min, parameter.max].every(finite) || parameter.max <= parameter.min || !finite(parameter.max - parameter.min) || (parameter.step !== undefined && (!finite(parameter.step) || parameter.step <= 0))) throw new TypeError(`exhibit_parameter_invalid:${parameter.id}`);
    return {...parameter, step: parameter.step ?? (parameter.max - parameter.min) / 100, label: String(parameter.label ?? parameter.id), unit: String(parameter.unit ?? '')};
  });
  const readoutDefs = indexed(options.readouts ?? [], 'readouts').map(readout => ({...readout, label: String(readout.label ?? readout.id), unit: String(readout.unit ?? ''), digits: clamp(Math.round(finite(readout.digits) ? readout.digits : 1), 0, 6)}));
  const defaultTour = [{label: '整体运转', duration: 8, mode: 'assembled', view: 'perspective'}, {label: '内部机构', duration: 8, mode: 'cutaway', view: 'side'}, {label: '拆解与装配', duration: 8, mode: 'exploded', view: 'perspective'}];
  const tourSteps = (options.tour ?? defaultTour).map(step => {
    if (!finite(step.duration) || step.duration <= 0 || step.duration > 3600 || !Object.hasOwn(MODES, step.mode ?? 'assembled') || !Object.hasOwn(VIEWS, step.view ?? 'perspective')) throw new TypeError('exhibit_tour_step_invalid');
    return {...step, label: String(step.label ?? MODES[step.mode ?? 'assembled']), mode: step.mode ?? 'assembled', view: step.view ?? 'perspective'};
  });
  const tourDuration = tourSteps.reduce((sum, step) => sum + step.duration, 0);
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let reducedMotion = !!media?.matches;
  let paused = reducedMotion, disposed = false, time = 0, mode = 'assembled', view = 'perspective';
  let tourEnabled = !reducedMotion && tourDuration > 0, tourHeld = false, tourPosition = 0, tourIndex = -1;
  let selectedId = null, state = null, error = null, lastInteraction = now(), previousFrame = now(), raf = 0;
  let readoutValues = Object.create(null);
  const parameters = Object.create(null);
  const parameterById = new Map(parameterDefs.map(def => [def.id, def]));
  const partById = new Map(parts.map(part => [part.id, part]));
  const cleanups = [];
  const rootParent = root.parent;
  const rootIndex = rootParent?.children.indexOf(root) ?? -1;
  const shell = element('section', 'td-exhibit');
  shell.setAttribute('aria-label', String(options.title ?? '机械交互展台'));
  const style = element('style'); style.textContent = CSS; shell.append(style);
  const listen = (node, name, handler, config) => {node.addEventListener(name, handler, config); cleanups.push(() => node.removeEventListener(name, handler, config));};
  const interact = () => {if (disposed) return; lastInteraction = now(); const changed = !tourHeld; tourHeld = true; if (changed) refreshControls();};
  const button = (label, action, handler, className = '') => {
    const node = element('button', `td-exhibit__button ${className}`, label); node.type = 'button';
    if (action) node.dataset.exhibitAction = action;
    listen(node, 'click', () => {if (action !== 'tour') interact(); handler();});
    return node;
  };
  const panel = title => {const node = element('section', 'td-exhibit__panel'); node.append(element('h2', '', title)); return node;};

  const header = element('header', 'td-exhibit__header');
  const identity = element('div', 'td-exhibit__identity');
  const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  mark.setAttribute('viewBox', '0 0 48 48'); mark.setAttribute('class', 'td-exhibit__mark'); mark.setAttribute('aria-hidden', 'true');
  mark.innerHTML = '<g fill="none" stroke="currentColor" stroke-width="1.4"><path d="M24 3 42 14v20L24 45 6 34V14Z M24 3v14m0 14v14M6 14l12 7m12 6 12 7M6 34l12-7m12-6 12-7"/><circle cx="24" cy="24" r="8"/><circle cx="24" cy="24" r="3"/></g>';
  const identityText = element('div'); identityText.append(element('h1', '', String(options.title ?? '机械交互展台')), element('p', 'td-exhibit__subtitle', String(options.subtitle ?? '')));
  identity.append(mark, identityText);
  const meta = element('div', 'td-exhibit__meta');
  const runtimeMeta = element('div', 'td-exhibit__meta-item'); const runtimeValue = element('span', 'td-exhibit__num', '00:00'); runtimeMeta.append(element('span', 'td-exhibit__label', '模型时间'), runtimeValue);
  const statusMeta = element('div', 'td-exhibit__meta-item'); const statusValue = element('span', 'td-exhibit__status', '运行'); statusMeta.append(element('span', 'td-exhibit__label', '控制状态'), statusValue); meta.append(runtimeMeta, statusMeta); header.append(identity, meta); shell.append(header);
  const grid = element('div', 'td-exhibit__grid');
  const left = element('aside', 'td-exhibit__rail td-exhibit__rail--left');
  const center = element('div', 'td-exhibit__center');
  const right = element('aside', 'td-exhibit__rail td-exhibit__rail--right');
  const viewport = element('div', 'td-exhibit__viewport');
  const errorNode = element('p', 'td-exhibit__error'); errorNode.hidden = true; errorNode.setAttribute('role', 'alert'); center.append(errorNode, viewport);
  grid.append(left, center, right); shell.append(grid);
  container.append(shell);
  let stage;
  try {stage = createMechanicalStage({container: viewport, background: '#f4f1eb', onInteract: interact});}
  catch (cause) {shell.remove(); throw cause;}
  stage.canvas.tabIndex = 0;
  stage.scene.add(root);

  // Wrap, never animate the model's own transform. This works for nested parts too.
  for (const part of parts) {
    const object = part.object, parent = object.parent, index = parent.children.indexOf(object);
    const wrapper = new THREE.Group(); wrapper.name = `exhibit-offset:${part.id}`;
    parent.remove(object); parent.add(wrapper); parent.children.splice(parent.children.indexOf(wrapper), 1); parent.children.splice(index, 0, wrapper); wrapper.add(object);
    Object.assign(part, {parent, index, wrapper});
  }
  const selectionBox = new THREE.Box3Helper(new THREE.Box3(), 0xee4d25);
  selectionBox.visible = false; selectionBox.material.depthTest = false; selectionBox.material.transparent = true; selectionBox.material.opacity = 0.55; selectionBox.renderOrder = 10; stage.scene.add(selectionBox);
  const canvasTop = element('div', 'td-exhibit__canvas-top'); canvasTop.append(element('span', '', '机械研究 / 交互视图'), element('span', '', '拖动旋转 · 滚轮缩放'));
  const canvasBottom = element('div', 'td-exhibit__canvas-bottom'); const modeName = element('div', 'td-exhibit__mode-name'); const modeDescription = element('div', 'td-exhibit__mode-description'); canvasBottom.append(modeName, modeDescription);
  const selectionTag = element('div', 'td-exhibit__selection-tag'); selectionTag.hidden = true; viewport.append(canvasTop, canvasBottom, selectionTag);

  const readoutPanel = panel('运行读数'); const readoutList = element('div'); readoutPanel.append(readoutList);
  const readoutNodes = new Map();
  for (const def of readoutDefs) {
    const row = element('div', 'td-exhibit__readout'); row.append(element('div', 'td-exhibit__readout-name', def.label));
    const reading = element('div', 'td-exhibit__reading'); const value = element('output', 'td-exhibit__value td-exhibit__num', '—'); value.dataset.exhibitReadout = def.id;
    reading.append(value, element('span', 'td-exhibit__unit', def.unit)); row.append(reading);
    let gauge = null;
    if (finite(def.min) && finite(def.max) && def.max > def.min) {
      const track = element('div', 'td-exhibit__gauge'); gauge = element('span', 'td-exhibit__gauge-fill'); track.append(gauge); track.setAttribute('aria-hidden', 'true');
      const limits = element('div', 'td-exhibit__limits td-exhibit__num'); limits.append(element('span', '', String(def.min)), element('span', '', `${def.max} ${def.unit}`)); row.append(track, limits);
    }
    readoutNodes.set(def.id, {value, gauge}); readoutList.append(row);
  }
  if (!readoutDefs.length) readoutList.append(element('p', 'td-exhibit__note', '此模型未提供数值读数。'));
  left.append(readoutPanel);
  const parameterPanel = panel('模型参数');
  const parameterNodes = new Map();
  const normalizeParameter = (def, value) => clamp(Number((def.min + Math.round((clamp(value, def.min, def.max) - def.min) / def.step) * def.step).toPrecision(12)), def.min, def.max);
  for (const def of parameterDefs) {
    parameters[def.id] = normalizeParameter(def, def.value);
    const row = element('div', 'td-exhibit__parameter'); const label = element('label', '', def.label);
    const output = element('output', 'td-exhibit__num'); const input = element('input'); input.type = 'range'; input.min = def.min; input.max = def.max; input.step = def.step; input.value = parameters[def.id]; input.dataset.exhibitParameter = def.id; input.setAttribute('aria-label', def.label);
    label.append(input); // Explicit nested label associates without global ID collisions.
    row.append(element('span', '', def.label), output, label); label.style.gridColumn = '1 / -1'; label.replaceChildren(input);
    output.textContent = `${parameters[def.id]} ${def.unit}`.trim();
    listen(input, 'input', () => {interact(); changeParameter(def.id, Number(input.value));});
    parameterNodes.set(def.id, {input, output}); parameterPanel.append(row);
  }
  if (!parameterDefs.length) parameterPanel.append(element('p', 'td-exhibit__note', '此模型没有可调参数。'));
  left.append(parameterPanel);

  const displayPanel = panel('拆解与视角'); const modeButtons = new Map(); const modesRow = element('div', 'td-exhibit__buttons');
  for (const [key, label] of Object.entries(MODES)) {const node = button(label, key, () => changeMode(key)); node.setAttribute('aria-pressed', String(key === mode)); modeButtons.set(key, node); modesRow.append(node);}
  displayPanel.append(modesRow);
  const viewButtons = new Map(); const viewsRow = element('div', 'td-exhibit__buttons td-exhibit__section-gap');
  for (const [key, label] of Object.entries(VIEW_LABELS)) {const node = button(label, `view-${key}`, () => changeView(key)); node.setAttribute('aria-pressed', String(key === view)); viewButtons.set(key, node); viewsRow.append(node);}
  displayPanel.append(viewsRow, button('重置相机', 'reset', () => {view = 'perspective'; fit(); refreshControls();}, 'td-exhibit__button--quiet td-exhibit__section-gap'));
  const partPanel = panel('子系统'); const partList = element('div', 'td-exhibit__part-list');
  const partNodes = new Map();
  for (const part of parts) {
    const row = element('div', 'td-exhibit__part'); const select = button(part.label, null, () => changeSelection(part.id), 'td-exhibit__part-select'); select.className = 'td-exhibit__part-select'; select.dataset.exhibitSelectPart = part.id; select.setAttribute('aria-pressed', 'false');
    const toggle = element('input', 'td-exhibit__part-toggle'); toggle.type = 'checkbox'; toggle.checked = true; toggle.dataset.exhibitPart = part.id; toggle.setAttribute('aria-label', `显示${part.label}`);
    listen(toggle, 'change', () => {interact(); part.shown = toggle.checked; applyPartMode(); paint();}); row.append(select, toggle); partList.append(row); partNodes.set(part.id, {select, toggle});
  }
  if (!parts.length) partList.append(element('p', 'td-exhibit__note', '此模型未定义可拆解子系统。'));
  partPanel.append(partList);
  const selectionDetails = element('div', 'td-exhibit__section-gap'); const selectionTitle = element('p', 'td-exhibit__selection-title', '选择一个子系统'); const selectionDescription = element('p', 'td-exhibit__selection-description', '点击模型部件或上方名称，查看它的作用。'); const selectionState = element('p', 'td-exhibit__selection-state');
  selectionDetails.append(selectionTitle, selectionDescription, selectionState); partPanel.append(selectionDetails); right.append(displayPanel, partPanel);

  const transport = element('footer', 'td-exhibit__transport');
  const pauseButton = button('Ⅱ', 'pause', () => changePaused(!paused), 'td-exhibit__play'); pauseButton.setAttribute('aria-label', '暂停运动');
  const timelineBlock = element('div'); const timelineHead = element('div', 'td-exhibit__timeline-head'); const tourLabel = element('span', 'td-exhibit__tour-label'); const tourClock = element('span', 'td-exhibit__num'); timelineHead.append(tourLabel, tourClock);
  const timeline = element('div', 'td-exhibit__timeline'); const scrubber = element('input'); scrubber.type = 'range'; scrubber.min = '0'; scrubber.max = String(tourDuration || 1); scrubber.step = '0.01'; scrubber.value = '0'; scrubber.disabled = !tourDuration; scrubber.dataset.exhibitAction = 'timeline'; scrubber.setAttribute('aria-label', '巡游进度');
  listen(scrubber, 'input', () => {interact(); tourPosition = clamp(Number(scrubber.value), 0, tourDuration); applyTourStep(true); paint();}); timeline.append(scrubber);
  const chapterRow = element('div', 'td-exhibit__tour-chapters'); const chapterNodes = tourSteps.map(step => {const node = element('span', 'td-exhibit__chapter', step.label); node.style.flex = `${step.duration} 1 0`; node.title = step.label; chapterRow.append(node); return node;});
  timelineBlock.append(timelineHead, timeline, chapterRow);
  const tourControls = element('div', 'td-exhibit__tour-controls'); const tourButton = button('自动巡游', 'tour', () => changeTour(!tourEnabled || tourHeld)); const idleText = element('span', 'td-exhibit__idle'); tourControls.append(tourButton, idleText); transport.append(pauseButton, timelineBlock, tourControls); shell.append(transport);
  const footer = element('div', 'td-exhibit__footer'); footer.append(element('span', '', '读数与部件运动使用同一模型状态'), element('span', '', 'TEARDOWN / MECHANICAL EXHIBIT')); shell.append(footer);

  function ensureLive() {if (disposed) throw new Error('exhibit_disposed');}
  function fit() {stage.fit(root, {padding: 1.12, direction: VIEWS[view]});}
  function effectiveVisible(object) {for (let current = object; current; current = current.parent) if (!current.visible) return false; return true;}
  function applyPartMode() {
    for (const part of parts) {
      part.wrapper.position.set(...(mode === 'exploded' ? part.explode : [0, 0, 0]));
      part.wrapper.visible = part.shown && !(mode === 'cutaway' && part.cutaway);
    }
  }
  function changeMode(next, refit = true) {
    if (!Object.hasOwn(MODES, next)) throw new TypeError('exhibit_mode_invalid');
    mode = next; applyPartMode(); if (refit) fit(); refreshControls(); paint();
  }
  function changeView(next) {
    if (!Object.hasOwn(VIEWS, next)) throw new TypeError('exhibit_view_invalid');
    view = next; stage.setView(view); refreshControls(); paint();
  }
  function changeSelection(id) {
    if (id !== null && !partById.has(id)) throw new TypeError('exhibit_part_unknown');
    selectedId = id; refreshControls(); paint();
  }
  function changeParameter(id, value) {
    const def = parameterById.get(id);
    if (!def || !finite(value)) throw new TypeError('exhibit_parameter_unknown_or_invalid');
    // Quantize relative to min, then cap; avoids slider/model disagreement.
    parameters[id] = normalizeParameter(def, value);
    const nodes = parameterNodes.get(id); nodes.input.value = parameters[id]; nodes.output.textContent = `${parameters[id]} ${def.unit}`.trim();
    evaluate(); paint();
  }
  function changePaused(next) {paused = !!next; previousFrame = now(); if (!paused && error) evaluate(); refreshControls(); paint();}
  function changeTour(next) {
    tourEnabled = !!next && tourDuration > 0; tourHeld = false; lastInteraction = now();
    if (tourEnabled) {paused = false; applyTourStep(true); previousFrame = now();}
    refreshControls(); paint();
  }
  function currentTourIndex() {
    if (!tourSteps.length) return -1;
    let elapsed = 0;
    for (let i = 0; i < tourSteps.length; i++) {elapsed += tourSteps[i].duration; if (tourPosition < elapsed || i === tourSteps.length - 1) return i;}
    return 0;
  }
  function applyTourStep(force = false) {
    const index = currentTourIndex();
    if (index < 0 || (!force && index === tourIndex)) return;
    tourIndex = index; const step = tourSteps[index]; mode = step.mode; view = step.view; applyPartMode(); fit(); refreshControls();
  }
  function evaluate() {
    try {
      const next = model({time, parameters: Object.freeze({...parameters})});
      if (!next || typeof next !== 'object' || Array.isArray(next) || typeof next.then === 'function') throw new TypeError('model must return a synchronous state object');
      update(next); state = next; error = null; errorNode.hidden = true;
      readoutValues = Object.create(null);
      for (const def of readoutDefs) {
        const value = numericPath(state, def.key); readoutValues[def.id] = value;
        const nodes = readoutNodes.get(def.id); nodes.value.textContent = value === null ? '—' : value.toLocaleString('en-US', {minimumFractionDigits: def.digits, maximumFractionDigits: def.digits});
        nodes.value.dataset.value = value === null ? '' : String(value);
        if (nodes.gauge) nodes.gauge.style.width = value === null ? '0%' : `${clamp((value - def.min) / (def.max - def.min), 0, 1) * 100}%`;
      }
      // The caller may change part visibility in update; the separate wrapper
      // continues to enforce user controls without altering the model's flag.
      applyPartMode(); return true;
    } catch (cause) {
      error = String(cause?.message ?? cause).slice(0, 240); paused = true;
      errorNode.textContent = `模型更新停止：${error}。下方保留最后一次有效读数。`; errorNode.hidden = false; refreshControls(); return false;
    }
  }
  function refreshControls() {
    for (const [key, node] of modeButtons) node.setAttribute('aria-pressed', String(key === mode));
    for (const [key, node] of viewButtons) node.setAttribute('aria-pressed', String(key === view));
    modeName.textContent = MODES[mode];
    modeDescription.textContent = mode === 'exploded' ? '各子系统沿指定装配方向分离' : mode === 'cutaway' ? (parts.some(part => part.cutaway) ? '隐藏可移除外壳，观察内部机构' : '此模型未标记可移除外壳') : '完整机构 · 运动与读数同步';
    pauseButton.textContent = paused ? '▶' : 'Ⅱ'; pauseButton.setAttribute('aria-label', paused ? '继续运动' : '暂停运动'); pauseButton.setAttribute('aria-pressed', String(paused));
    tourButton.setAttribute('aria-pressed', String(tourEnabled && !tourHeld)); tourButton.disabled = !tourDuration;
    tourButton.textContent = tourHeld && tourEnabled ? '恢复巡游' : tourEnabled ? '停止巡游' : '自动巡游';
    for (const part of parts) {const nodes = partNodes.get(part.id); nodes.select.setAttribute('aria-pressed', String(selectedId === part.id)); nodes.toggle.checked = part.shown;}
    const selected = partById.get(selectedId);
    selectionTitle.textContent = selected?.label ?? '选择一个子系统';
    selectionDescription.textContent = selected ? selected.description || '模型未提供此子系统的说明。' : '点击模型部件或上方名称，查看它的作用。';
  }
  function paint() {
    if (disposed) return;
    runtimeValue.textContent = clock(time);
    statusValue.textContent = error ? '模型错误' : paused ? '已暂停' : tourEnabled && !tourHeld ? '自动巡游' : '手动探索';
    const index = currentTourIndex();
    tourLabel.textContent = tourSteps[index]?.label ?? '手动探索'; tourClock.textContent = `${clock(tourPosition)} / ${clock(tourDuration)}`;
    scrubber.value = String(tourPosition); chapterNodes.forEach((node, i) => node.setAttribute('aria-current', String(index === i)));
    idleText.textContent = tourEnabled && tourHeld && !paused ? `${Math.max(0, Math.ceil((IDLE_MS - (now() - lastInteraction)) / 1000))} 秒后恢复巡游` : reducedMotion && !tourEnabled ? '已尊重减少动态效果偏好' : tourEnabled ? '操作即可接管' : '巡游已关闭';
    const part = partById.get(selectedId);
    selectionBox.visible = !!part && effectiveVisible(part.object);
    selectionTag.hidden = !selectionBox.visible;
    if (part) selectionState.textContent = effectiveVisible(part.object) ? '当前可见' : mode === 'cutaway' && part.cutaway ? '剖切模式已移除此外壳' : '当前隐藏'; else selectionState.textContent = '';
    root.updateWorldMatrix(true, true);
    if (selectionBox.visible) {
      selectionBox.box.setFromObject(part.object);
      if (selectionBox.box.isEmpty()) {selectionBox.visible = false; selectionTag.hidden = true;}
      else {
        const point = stage.project(selectionBox.box.getCenter(new THREE.Vector3()));
        selectionTag.hidden = !point.visible; selectionTag.textContent = part.label;
        selectionTag.style.left = `${clamp(point.x, 90, Math.max(90, viewport.clientWidth - 90))}px`; selectionTag.style.top = `${clamp(point.y, 45, viewport.clientHeight - 35)}px`;
      }
    }
    stage.render();
  }

  const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
  let clickStart = null; const activePointers = new Set();
  listen(stage.canvas, 'pointerdown', event => {
    activePointers.add(event.pointerId);
    if (activePointers.size > 1) {clickStart = null; return;}
    if (event.isPrimary && (event.button === 0 || event.pointerType !== 'mouse')) clickStart = {x: event.clientX, y: event.clientY, id: event.pointerId};
  });
  listen(stage.canvas, 'pointercancel', event => {activePointers.delete(event.pointerId); clickStart = null;});
  listen(stage.canvas, 'pointerup', event => {
    activePointers.delete(event.pointerId);
    const start = clickStart; clickStart = null;
    if (!start || start.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
    const rect = stage.canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, stage.camera);
    for (const hit of raycaster.intersectObject(root, true)) {
      if (!effectiveVisible(hit.object)) continue;
      let object = hit.object;
      while (object && object !== root) {const part = parts.find(candidate => candidate.object === object); if (part) {changeSelection(part.id); return;} object = object.parent;}
    }
    changeSelection(null);
  });
  listen(shell, 'keydown', event => {
    if (!event.target.closest?.('[data-exhibit-action="tour"]')) interact();
    if (event.target !== stage.canvas) return;
    if (event.code === 'Space') {event.preventDefault(); changePaused(!paused);}
    if (event.key === 'Escape') changeSelection(null);
    if (event.key.toLowerCase() === 'r') {view = 'perspective'; fit(); refreshControls(); paint();}
  });
  listen(shell, 'pointerdown', event => {if (!event.target.closest?.('[data-exhibit-action="tour"]')) interact();});
  listen(shell, 'wheel', interact, {passive: true});
  listen(document, 'visibilitychange', () => {previousFrame = now(); if (!document.hidden) lastInteraction = now();});
  if (media?.addEventListener) listen(media, 'change', event => {reducedMotion = event.matches; if (reducedMotion) {paused = true; tourEnabled = false;} refreshControls(); paint();});
  const resizeObserver = new ResizeObserver(() => {if (!disposed) paint();}); resizeObserver.observe(viewport); cleanups.push(() => resizeObserver.disconnect());

  function frame(stamp) {
    if (disposed) return;
    const delta = clamp((stamp - previousFrame) / 1000, 0, 0.05); previousFrame = stamp;
    if (!document.hidden) {
      if (tourEnabled && tourHeld && !paused && now() - lastInteraction >= IDLE_MS) {tourHeld = false; applyTourStep(true); refreshControls();}
      if (!paused) {
        time += delta;
        if (tourEnabled && !tourHeld && tourDuration) {tourPosition = (tourPosition + delta) % tourDuration; applyTourStep();}
        evaluate();
      }
      paint();
    }
    raf = requestAnimationFrame(frame);
  }

  function snapshot() {
    return {time, paused, mode, view, selectedPart: selectedId, reducedMotion, error, disposed,
      tour: {enabled: tourEnabled, active: tourEnabled && !tourHeld && !paused && !disposed, position: tourPosition, duration: tourDuration, label: tourSteps[currentTourIndex()]?.label ?? null},
      parameters: {...parameters}, readouts: {...readoutValues},
      parts: parts.map(part => ({id: part.id, visible: effectiveVisible(part.object), enabled: part.shown, cutaway: part.cutaway, offset: part.wrapper.position.toArray()}))};
  }
  const previousHook = Object.getOwnPropertyDescriptor(window, '__TEARDOWN_EXHIBIT__');
  function restoreChild(parent, object, index) {
    object.removeFromParent(); if (!parent) return;
    parent.add(object); parent.children.splice(parent.children.indexOf(object), 1); parent.children.splice(clamp(index, 0, parent.children.length), 0, object);
  }
  function dispose() {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(raf); cleanups.splice(0).reverse().forEach(cleanup => cleanup());
    // Reverse nesting is safe: original parent references remain the caller's objects.
    for (const part of [...parts].reverse()) {restoreChild(part.parent, part.object, part.index); part.wrapper.removeFromParent();}
    restoreChild(rootParent, root, rootIndex);
    selectionBox.geometry.dispose(); selectionBox.material.dispose(); stage.dispose(); shell.remove();
    if (window.__TEARDOWN_EXHIBIT__ === api) {if (previousHook) Object.defineProperty(window, '__TEARDOWN_EXHIBIT__', previousHook); else delete window.__TEARDOWN_EXHIBIT__;}
  }
  const api = Object.freeze({
    setMode(next) {ensureLive(); interact(); changeMode(next); return snapshot();},
    setTime(next) {ensureLive(); if (!finite(next) || next < 0) throw new TypeError('exhibit_time_invalid'); interact(); time = next; evaluate(); paint(); return snapshot();},
    setParameter(id, value) {ensureLive(); interact(); changeParameter(id, value); return snapshot();},
    selectPart(id) {ensureLive(); interact(); changeSelection(id); return snapshot();},
    setTour(next) {ensureLive(); changeTour(next); return snapshot();},
    setPaused(next) {ensureLive(); interact(); changePaused(next); return snapshot();},
    snapshot, dispose,
  });
  // A frozen diagnostic interface, not an execution sandbox or physics certificate.
  if (!previousHook || previousHook.configurable) Object.defineProperty(window, '__TEARDOWN_EXHIBIT__', {configurable: true, enumerable: false, writable: false, value: api});
  evaluate(); applyPartMode(); if (tourEnabled) applyTourStep(true); else fit(); refreshControls(); paint();
  raf = requestAnimationFrame(frame);
  return api;
}
