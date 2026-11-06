import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSimulatorHtml, generateSimulator} from './generator.mjs';
import {analyzeReferences} from './generation-reference.mjs';
import {exportLocaleDocument, previewLocaleDocument, supportsPreviewLocale} from './preview-locale.mjs';
import {isolatedPreviewDocument} from './preview-loader.mjs';
import {validateExhibitText} from './exhibit-text.mjs';

const pair = text => ({'zh-CN': text, en: text});
const textFixture = () => ({version: 1, title: pair('Rotor'), subtitle: pair('Schematic model'), parts: {}, parameters: {}, readouts: {}, tour: []});

test('new artifacts have an explicit initial locale and a separate preview language bridge', () => {
  const html = makeSimulatorHtml('window.example=true;', 'en', textFixture());
  assert.match(html, /<html lang="en">/);
  assert.equal(supportsPreviewLocale(html), true);
  assert.throws(() => makeSimulatorHtml('', 'invalid'), /invalid_locale/);
  assert.throws(() => previewLocaleDocument(html, 'en', 'https://host.invalid/path'), /preview_parent_origin_invalid/);
  assert.throws(() => previewLocaleDocument(html, 'fr', 'https://host.invalid'), /preview_locale_invalid/);
  const bridge = previewLocaleDocument(isolatedPreviewDocument(html), 'en', 'https://host.invalid');
  assert.match(bridge, /event.source!==parent\|\|event.origin!==config.parentOrigin/);
  assert.match(bridge, /connect-src 'none'/);
  assert.doesNotMatch(bridge, /allow-same-origin|unsafe-eval/);
  assert.match(exportLocaleDocument(html, 'zh-CN'), /<html lang="zh-CN">/);
  assert.throws(() => exportLocaleDocument(html, 'fr'), /preview_locale_invalid/);
  const legacy = html.replace('<meta name="teardown-i18n" content="1">', '');
  assert.equal(supportsPreviewLocale(legacy), false);
  assert.equal(previewLocaleDocument(legacy, 'en', 'https://host.invalid'), legacy, 'legacy bytes must remain unchanged');
  assert.equal(exportLocaleDocument(legacy, 'zh-CN'), legacy, 'legacy downloads must remain unchanged');
  assert.equal(supportsPreviewLocale(makeSimulatorHtml('window.example=true;', 'en')), false, 'a prompt or bundle alone cannot earn the bilingual marker');
});

test('bilingual payload is inert, bounded and structurally complete without rejecting numeric labels or invariant units', () => {
  const value = textFixture();
  value.parts.rotor = {label: pair('M8'), description: pair('123')};
  value.parameters.speed = {label: pair('RPM'), unit: pair('rpm')};
  value.readouts.phase = {label: pair('°'), unit: pair('')};
  assert.deepEqual(validateExhibitText(JSON.stringify(value)), value);
  for (const bad of [
    {...value, title: 'Rotor'}, {...value, title: {en:'Rotor'}}, {...value, subtitle: pair(' ')},
    {...value, title: {...pair('Rotor'), fr:'Rotor'}}, {...value, other:true},
    {...value, parts:{rotor:{label:pair('Rotor')}}}, {...value, parameters:{speed:{label:pair('Speed'),unit:'rpm'}}},
    {...value, parts:JSON.parse('{"__proto__":{"label":{"en":"x","zh-CN":"x"},"description":{"en":"x","zh-CN":"x"}}}')},
    {...value, tour:[pair('x'.repeat(161))]}, {...value, version:2},
  ]) assert.throws(() => validateExhibitText(bad), /exhibit_text_invalid/);
  assert.throws(() => validateExhibitText(' '.repeat(65537)), /exhibit_text_invalid: size/);
  value.title = pair('</script><img src=x onerror=alert(1)>');
  const html = makeSimulatorHtml('', 'en', value);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /writable:false,configurable:false/);
});

test('generation repairs missing and incomplete bilingual JSON before finish, including when visual review is configured', async () => {
  const main = "import * as THREE from 'three'; import {createMechanicalExhibit} from 'teardown-exhibit'; createMechanicalExhibit({container:document.getElementById('app'),root:new THREE.Group(),parts:[],parameters:[],readouts:[],tour:[],model:()=>({}),update:()=>{}});";
  const plan = [
    ['write_file',{path:'main.js',content:main}], ['build_simulator',{entry:'main.js'}], ['finish',{}],
    ['write_file',{path:'exhibit-text.json',content:JSON.stringify({...textFixture(),title:{en:'Rotor'}})}], ['build_simulator',{entry:'main.js'}],
    ['write_file',{path:'exhibit-text.json',content:JSON.stringify(textFixture())}], ['build_simulator',{entry:'main.js'}], ['finish',{}],
  ];
  let attempts = 0, reviews = 0;
  const gateway = {complete:async({messages})=>{
    if (attempts === 0) assert.match(messages[0].content, /selected locale is en/);
    if (attempts === 2 || attempts === 3) assert.match(messages.at(-1).content, /exhibit_text_required/);
    if (attempts === 5) assert.match(messages.at(-1).content, /exhibit_text_invalid/);
    const [name,input] = plan[attempts++];
    return {role:'assistant',tool_calls:[{id:`text-${attempts}`,type:'function',function:{name,arguments:JSON.stringify(input)}}]};
  }};
  const result = await generateSimulator({gateway, description:'中文描述', locale:'en', visualReview:async()=>{reviews++;return {passed:true,visual:'passed',interaction:'passed',feedback:'fixture'};}});
  assert.equal(attempts,8); assert.equal(reviews,1); assert.equal(result.locale,'en');
  assert.equal(supportsPreviewLocale(result.html),true);
  assert.match(result.html, /__TEARDOWN_EXHIBIT_TEXT__/);
});

test('reference analysis follows explicit locale rather than the prompt language', async () => {
  let content;
  const gateway = {complete: async ({messages}) => {content = messages[0].content; return {content: JSON.stringify({summary:'A rotor',observedParts:[],inferredParts:[],uncertainties:[]})};}};
  await analyzeReferences({gateway, description: '中文描述', locale: 'en', references: []});
  assert.match(content, /Answer in English.*explicit requested locale: en/);
  await assert.rejects(analyzeReferences({gateway, description:'test', locale:'fr', references:[]}), /invalid_locale/);
  await assert.rejects(generateSimulator({gateway, description:'test', locale:'fr'}), /invalid_locale/);
});
