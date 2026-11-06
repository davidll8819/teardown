// Deterministic UI regression. Uses an isolated browser and the real locale
// hook against mocked API responses; it does not certify deployed platform integration.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root,'.taste-skill','i18n-ui');
await mkdir(output,{recursive:true});
const bundle = await build({absWorkingDir:root,entryPoints:['web/app.jsx'],bundle:true,write:false,outfile:path.join(output,'app.js'),external:['/assets/*'],minify:false,platform:'browser',target:'es2022',define:{'process.env.NODE_ENV':'"production"'},loader:{'.js':'jsx'}});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const origin='https://i18n-ui-regression.invalid';
const now='2026-11-06T00:00:00Z';
let jobs=[],posts=[],releasePost,platformLocale='zh-CN';
const report={kind:'fixture-ui-i18n',deployedPlatformVerified:false,checks:[],pageErrors:[],screenshots:[]};
const widths=[1440,1024,768,600,390,320];
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:960},locale:'en-US'});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin)return route.abort();
  if(url.pathname==='/api/locale')return route.fulfill({json:{locale:platformLocale,scopeFingerprint:'fixture-user'}});
  if(url.pathname==='/api/jobs'){
   if(route.request().method()==='POST'){
    const value=route.request().postDataJSON();posts.push(value);
    await new Promise(resolve=>{releasePost=resolve;});
    const job={id:'12345678-1234-4234-9234-123456789012',description:value.description,locale:value.locale,status:'generating',phase:'working',createdAt:now,updatedAt:now,references:[]};jobs=[job];
    return route.fulfill({status:202,json:job});
   }
   return route.fulfill({json:{jobs}});
  }
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:await readFile(path.join(root,'web/index.html'),'utf8')});
  if(url.pathname==='/assets/app.js')return route.fulfill({contentType:'text/javascript',body:js});
  if(url.pathname==='/assets/app.css')return route.fulfill({contentType:'text/css',body:css});
  if(url.pathname==='/assets/inter-latin.woff2')return route.fulfill({contentType:'font/woff2',body:await readFile(path.join(root,'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'))});
  return route.fulfill({status:404,body:'not found'});
 });
 const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.goto(origin);await page.getByRole('heading',{name:'今天，拆开哪台机器？'}).waitFor();
 await page.locator('#description').fill('My draft remains unchanged');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XkAAAAASUVORK5CYII=','base64');
 await page.locator('#reference-upload').setInputFiles({name:'my-part.png',mimeType:'image/png',buffer:png});
 await page.locator('.draft-reference').waitFor();
 const src=await page.locator('.draft-reference img').getAttribute('src');
 // A platform locale update rerenders the same component tree, not a page reload.
 platformLocale='en'; await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByRole('heading',{name:'What shall we take apart today?'}).waitFor();
 assert.equal(await page.locator('#description').inputValue(),'My draft remains unchanged');
 assert.equal(await page.locator('.draft-reference img').getAttribute('src'),src);
 assert.equal(posts.length,0);
 assert.equal(await page.locator('html').getAttribute('lang'),'en');
 await page.getByText('Uses the latest language received from 4yi. If it is out of sync, reopen the app from the marketplace.',{exact:true}).waitFor();
 assert.doesNotMatch((await page.locator('body').innerText()).replace('中文',''),/\p{Script=Han}/u);
 report.checks.push('platform fixture zh→en preserves draft and image object URL; no task submission; English UI has no Chinese copy');
 await page.getByRole('button',{name:'User guide',exact:true}).click();
 assert.doesNotMatch((await page.locator('.help-dialog').innerText()).replace('中文',''),/\p{Script=Han}/u);
 await page.getByRole('button',{name:'Close user guide'}).click();
 report.checks.push('English guide and accessible labels translated');
 for(const width of widths){
  await page.setViewportSize({width,height:960});
  await page.evaluate(()=>{window.scrollTo(0,0);return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`English layout fits ${width}`);
  if([1440,390,320].includes(width)){
   const file=path.join(output,`english-${width}.png`);await page.screenshot({path:file,fullPage:width>600});report.screenshots.push(file);
  }
  if(width<=600){
   await page.locator('.composer').scrollIntoViewIfNeeded();
   const upload=await page.locator('.upload-button').boundingBox(),submit=await page.locator('button[type=submit]').boundingBox();
   assert.ok(upload.x+upload.width<=submit.x || submit.x+submit.width<=upload.x || upload.y+upload.height<=submit.y || submit.y+submit.height<=upload.y,'mobile reference and submit controls must not overlap');
   if(width===320){const composer=path.join(output,'english-320-composer.png');await page.screenshot({path:composer});report.screenshots.push(composer);}
  }
 }
 report.checks.push('English layout fits 1440, 1024, 768, 600, 390 and 320px; upload and submit controls do not overlap');
 platformLocale=null;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByText('No language received from 4yi yet. Choose a language here, or reopen the app from the marketplace.',{exact:true}).waitFor();
 assert.equal(await page.locator('.draft-reference img').getAttribute('src'),src);
 assert.equal(posts.length,0);
 platformLocale='en';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByText('Uses the latest language received from 4yi. If it is out of sync, reopen the app from the marketplace.',{exact:true}).waitFor();
 report.checks.push('platform and unavailable-language hints state the latest received language and marketplace reopening fallback without promising live sync');
 await page.setViewportSize({width:1440,height:960});
 await page.getByRole('button',{name:'Generate simulator',exact:true}).click();
 await page.getByRole('button',{name:'Submitting',exact:true}).waitFor();
 assert.equal(posts.length,1);assert.equal(posts[0].locale,'en');
 await page.getByRole('combobox',{name:'Interface language'}).selectOption('zh-CN');
 await page.getByRole('button',{name:'正在提交',exact:true}).waitFor();
 assert.equal(await page.locator('#description').inputValue(),'My draft remains unchanged');
 assert.equal(posts.length,1);releasePost();
 await page.getByRole('heading',{name:'编写与完善模拟器'}).waitFor();
 await page.getByRole('combobox',{name:'界面语言'}).selectOption('en');
 await page.getByRole('heading',{name:'Building the simulator'}).waitFor();
 assert.equal(posts.length,1);assert.equal(jobs[0].locale,'en');
 report.checks.push('switching during submission and generation preserves one task and its original target locale');
 // A validation failure remains in state and translates on the next render.
 await page.locator('#reference-upload').setInputFiles({name:'bad.gif',mimeType:'image/gif',buffer:Buffer.from('invalid')});
 await page.getByText('Please upload a JPG, PNG or WebP image.',{exact:true}).waitFor();
 await page.getByRole('combobox',{name:'Interface language'}).selectOption('zh-CN');
 await page.getByText('请上传 JPG、PNG 或 WebP 图片。',{exact:true}).waitFor();
 assert.equal(posts.length,1);
 await page.getByRole('combobox',{name:'界面语言'}).selectOption('platform');
 await page.getByText('Please upload a JPG, PNG or WebP image.',{exact:true}).waitFor();
 report.checks.push('existing image validation errors switch language; return-to-platform mode works without retrying');
 jobs=[{...jobs[0],status:'failed',error:'gateway_auth_failed',stages:[{phase:'working',at:now}],quality:{visual:'failed',interaction:'passed'},updatedAt:'2026-11-06T00:01:23Z'}];
 await page.getByRole('button',{name:'Refresh tasks',exact:true}).click();
 await page.getByRole('heading',{name:'Generation did not finish',exact:true}).waitFor();
 await page.getByRole('button',{name:'Task details',exact:true}).click();
 await page.getByText('Run time',{exact:true}).waitFor();
 assert.doesNotMatch((await page.locator('body').innerText()).replace('中文',''),/\p{Script=Han}/u);
 assert.match(await page.locator('.state-content').innerText(),/key/i);
 assert.equal(posts.length,1);
 report.checks.push('failed task, model authentication error, history, review status and dates use the selected language');
 for(const error of ['gateway_configuration_missing','gateway_request_invalid','balance_required','gateway_timeout','gateway_unreachable','model_did_not_call_tools','agent_step_limit','interrupted','reference_analysis_invalid','visual_review_limit','visual_review_invalid','visual_response_invalid','visual_configuration_invalid']){
  jobs=[{...jobs[0],error}];
  // Wait for this read, rather than accidentally checking the previous error.
  await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/api/jobs'),page.getByRole('button',{name:'Refresh tasks',exact:true}).click()]);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const copy=await page.locator('.state-content p').innerText();
  assert.doesNotMatch(copy,/\p{Script=Han}/u);assert.ok(!copy.startsWith('A problem occurred during generation.'),error);
 }
 for(const language of ['zh-CN','en']){
  await page.locator('.language-control select').selectOption(language);
  for(const width of widths){
   await page.setViewportSize({width,height:960});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${language} failed task layout fits ${width}`);
  }
 }
 report.checks.push('all known task failures translate; Chinese and English failed-task details fit six screen widths');
 await page.setViewportSize({width:1440,height:960});
 jobs=[{...jobs[0],status:'completed',error:null,references:[{id:'reference-1',name:'original-part.jpg'}]}];
 await page.getByRole('button',{name:'Refresh tasks',exact:true}).click();
 await page.getByRole('heading',{name:'The simulator cannot be displayed',exact:true}).waitFor();
 for(const width of widths){
  await page.setViewportSize({width,height:960});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`result actions and preview failure fit ${width}`);
  for(const action of await page.locator('.object-actions>button,.object-actions>a').all()){
   const box=await action.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width,`result action stays visible at ${width}`);
  }
 }
 await page.getByRole('button',{name:'Download HTML',exact:true}).click();
 await page.getByText(/^Download failed\. /).waitFor();
 await page.locator('.language-control select').selectOption('zh-CN');
 await page.getByText(/^下载未成功。/).waitFor();
 await page.getByRole('heading',{name:'模拟器暂时无法显示',exact:true}).waitFor();
 assert.equal(posts.length,1);
 report.checks.push('result actions and preview recovery fit six widths; existing preview and download errors change language without regenerating');
 assert.deepEqual(report.pageErrors,[]);
}finally{await browser.close();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
