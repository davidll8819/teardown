// Isolated fixture regression, not production/multi-account evidence.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {makeSimulatorHtml} from './generator.mjs';
import {isolatedPreviewDocument} from './preview-loader.mjs';
import {previewLocaleDocument, PREVIEW_LOCALE_MESSAGE} from './preview-locale.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = new URL('../.taste-skill/generation-i18n/', import.meta.url);
await mkdir(output, {recursive:true});
const source = `import * as THREE from 'three'; import {createMechanicalExhibit} from './web/simulator-exhibit.js';
const root=new THREE.Group(),rotor=new THREE.Group(),cover=new THREE.Group();root.add(rotor,cover);
rotor.add(new THREE.Mesh(new THREE.TorusGeometry(1,.25,12,24),new THREE.MeshStandardMaterial({color:0x887766})));
cover.add(new THREE.Mesh(new THREE.TorusGeometry(1.2,.1,12,24),new THREE.MeshStandardMaterial({color:0x777777})));cover.position.z=-.3;
createMechanicalExhibit({container:document.getElementById('app'),title:'Ignored author title',subtitle:'Ignored author subtitle',root,
parts:[{id:'rotor',object:rotor,label:{'zh-CN':'转子','en':'Rotor'},description:{'zh-CN':'转动组件','en':'Rotating assembly'},explode:[0,0,1]},{id:'cover',object:cover,label:{'zh-CN':'外壳','en':'Cover'},description:{'zh-CN':'可拆外壳','en':'Removable cover'},cutaway:true,explode:[0,0,-1]}],
parameters:[{id:'speed',label:{'zh-CN':'速度','en':'Speed'},value:30,min:0,max:60,step:1,unit:'rpm'}],
readouts:[{id:'angle',label:{'zh-CN':'角度','en':'Angle'},key:'angle',min:0,max:360,unit:'°'}],
model:({time,parameters})=>({angle:(time*parameters.speed*6)%360}),update:state=>{rotor.rotation.z=state.angle*Math.PI/180;}});`;
const compiled = await build({stdin:{contents:source,resolveDir:root},bundle:true,write:false,format:'iife',platform:'browser'});
const pair = (zh, en = zh) => ({'zh-CN':zh,en});
const texts = {version:1,title:pair('转子测试','Rotor test'),subtitle:pair('双语测试夹具','Bilingual test fixture'),
 parts:{rotor:{label:pair('转子','Rotor'),description:pair('转动组件','Rotating assembly')},cover:{label:pair('外壳','Cover'),description:pair('可拆外壳','Removable cover')}},
 parameters:{speed:{label:pair('速度','Speed'),unit:pair('rpm')}},readouts:{angle:{label:pair('角度','Angle'),unit:pair('°')}},tour:[]};
const html = makeSimulatorHtml(compiled.outputFiles[0].text, 'en', texts);
const origin = 'https://locale-fixture.invalid';
const browser = await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true,args:['--enable-unsafe-swiftshader']});
const report = {kind:'isolated fixture regression',checks:[],errors:[]};
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}):route.abort());
 await page.goto(origin);
 await page.evaluate(html=>{const f=document.createElement('iframe');f.sandbox='allow-scripts';f.width='1400';f.height='850';f.srcdoc=html;document.body.append(f);},previewLocaleDocument(isolatedPreviewDocument(html),'en',origin));
 const frame=await (await page.locator('iframe').elementHandle()).contentFrame();
 await frame.waitForFunction(()=>window.__TEARDOWN_EXHIBIT__?.snapshot().parts.length===2);
 assert.equal(await frame.locator('.td-exhibit h1').innerText(),'Rotor test');
 assert.equal(await frame.getByRole('button',{name:'Cutaway',exact:true}).count(),1);
 assert.equal(await frame.evaluate(()=>Object.isFrozen(window.__TEARDOWN_EXHIBIT_TEXT__)&&Object.isFrozen(window.__TEARDOWN_EXHIBIT_TEXT__.parts.rotor.label)),true);
 await frame.evaluate(()=>{const a=window.__TEARDOWN_EXHIBIT__;a.setTour(false);a.setPaused(true);a.setTime(2);a.setParameter('speed',20);a.selectPart('rotor');a.setMode('cutaway');window.canvasBefore=document.querySelector('canvas');});
 const before=await frame.evaluate(()=>window.__TEARDOWN_EXHIBIT__.snapshot());
 const send=locale=>page.evaluate(({type,locale})=>document.querySelector('iframe').contentWindow.postMessage({type,locale},'*'),{type:PREVIEW_LOCALE_MESSAGE,locale});
 await send('zh-CN'); await frame.waitForFunction(()=>document.documentElement.lang==='zh-CN');
 assert.equal(await frame.locator('.td-exhibit h1').innerText(),'转子测试');
 assert.equal(await frame.locator('[data-exhibit-parameter="speed"]').count(),1,'locale change must preserve slider');
 const after=await frame.evaluate(()=>({...window.__TEARDOWN_EXHIBIT__.snapshot(),sameCanvas:window.canvasBefore===document.querySelector('canvas')}));
 assert.equal(after.time,before.time);assert.equal(after.paused,true);assert.equal(after.mode,'cutaway');assert.equal(after.selectedPart,'rotor');assert.deepEqual(after.parameters,before.parameters);assert.deepEqual(after.readouts,before.readouts);assert.equal(after.sameCanvas,true);
 report.checks.push('parent locale switches bilingual fields and controls without resetting model, slider, selection, clock or canvas');
 await frame.evaluate(type=>{
   window.dispatchEvent(new MessageEvent('message',{data:{type,locale:'en'},source:parent,origin:'https://evil.invalid'}));
   window.dispatchEvent(new MessageEvent('message',{data:{type,locale:'en'},source:window,origin:'https://locale-fixture.invalid'}));
 },PREVIEW_LOCALE_MESSAGE);
 assert.equal(await frame.evaluate(()=>document.documentElement.lang),'zh-CN');
 await send('fr');assert.equal(await frame.evaluate(()=>document.documentElement.lang),'zh-CN');
 assert.equal(await frame.evaluate(()=>{try{void parent.document;return false;}catch{return true;}}),true);
 report.checks.push('wrong origin/window/locale ignored; opaque sandbox still blocks parent DOM');
 await send('en');await frame.waitForFunction(()=>document.documentElement.lang==='en');
 for(const [width,height] of [[1440,900],[390,844]]){
  await page.setViewportSize({width,height});await page.evaluate(({width,height})=>{const f=document.querySelector('iframe');f.width=width-20;f.height=height-30;},{width,height});
  const layout=await frame.evaluate(()=>{const e=document.querySelector('.td-exhibit');return {client:e.clientWidth,scroll:e.scrollWidth};});
  assert.ok(layout.scroll<=layout.client+1,`English layout overflow at ${width}`);
  await page.screenshot({path:fileURLToPath(new URL(`english-${width}.png`,output))});
 }
 report.checks.push('English layout at desktop/mobile has no horizontal overflow');
 await page.setContent(html,{waitUntil:'load'}); await page.waitForFunction(()=>window.__TEARDOWN_EXHIBIT__);
 await page.getByRole('combobox',{name:'Model language'}).selectOption('zh-CN');assert.equal(await page.locator('.td-exhibit h1').innerText(),'转子测试');
 await page.getByRole('combobox',{name:'模型语言'}).selectOption('en');assert.equal(await page.locator('.td-exhibit h1').innerText(),'Rotor test');
 report.checks.push('standalone/downloaded HTML switches language offline');
 assert.deepEqual(report.errors,[]);
 const broken = await browser.newPage();
 await broken.route('**/*',route=>route.abort());
 const missing = structuredClone(texts); delete missing.parts.cover;
 await broken.setContent(makeSimulatorHtml(compiled.outputFiles[0].text,'en',missing));
 await broken.waitForFunction(()=>document.getElementById('teardown-boot').dataset.state==='error');
 assert.match(await broken.locator('#teardown-boot-detail').innerText(),/exhibit_text_mapping_invalid:parts/);
 assert.equal(await broken.locator('.td-exhibit').count(),0,'incomplete mappings must not silently fall back to monolingual author text');
 await broken.close();
 report.checks.push('validated text is immutable; missing runtime ID mapping fails visibly instead of falling back');
 console.log(JSON.stringify(report));
}finally{await writeFile(new URL('report.json',output),JSON.stringify(report,null,2));await browser.close();}
