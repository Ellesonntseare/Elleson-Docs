const {test}=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright'),{Document,Paragraph,Packer,TextRun}=require('docx'),{start}=require('../server.cjs')
test('shared Word font features keep large text size and combine letters into compact runs',async()=>{
 const host=await start();let browser
 try{
  browser=await chromium.launch({channel:'msedge'});const page=await browser.newPage();await page.goto(host.address)
  const result=await page.evaluate(async()=>{
   const {shareWordLayout}=await import('/shared-layout.mjs')
   const sheet=document.createElement('div');sheet.style.cssText='position:absolute;left:0;top:0;font:12px Arial'
   sheet.innerHTML='<section class="docx" style="position:relative;width:600px;height:1000px"><p data-word-source-index="0"><span style="font-size:32px;font-weight:700;font-variant-numeric:tabular-nums">Heading 0123456789 with real font size</span></p></section>'
   document.body.append(sheet)
   let geometry
   await shareWordLayout({sheet,source:{id:'font-case',contentVersion:1},role:'pc',request:async(url,options)=>{geometry=JSON.parse(options.body)}})
   const p=sheet.querySelector('p'),range=document.createRange();range.selectNodeContents(p);const before=range.getBoundingClientRect(),length=p.textContent.length
   await shareWordLayout({sheet,source:{id:'font-case',contentVersion:1},role:'phone',request:async()=>({json:async()=>geometry})})
   range.selectNodeContents(p);const after=range.getBoundingClientRect(),style=getComputedStyle(p.firstElementChild)
   return {before:{width:before.width,height:before.height},after:{width:after.width,height:after.height},font:style.fontSize,runs:p.children.length,length,wireRuns:geometry.pages[0].paragraphs[0].characters.length,transform:style.transform}
  })
  assert.equal(result.font,'32px');assert.equal(result.transform,'none')
  assert.ok(Math.abs(result.before.height-result.after.height)<1,JSON.stringify(result))
  assert.ok(Math.abs(result.before.width-result.after.width)<1,JSON.stringify(result))
  assert.ok(result.runs<result.length/3,JSON.stringify(result));assert.ok(result.wireRuns<result.length/3)
 }finally{await browser?.close();host.server.closeAllConnections();await new Promise(r=>host.server.close(r))}
})
test('connected phone uses PC glyph positions in document units and remains editable',async()=>{const host=await start(),browser=await chromium.launch({channel:'msedge'});try{await host.open('Layout.docx',await Packer.toBuffer(new Document({sections:[{children:[new Paragraph({children:[new TextRun({text:'Exact shared layout across screens',font:'Calibri',size:28})]})]}]})));const pc=await browser.newPage(),phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await pc.goto(host.address+'/#owner='+host.owner);await pc.locator('[data-word-index="0"]').waitFor();await require('./menu-helper.cjs').connectPhone(pc, phone, host.address);await phone.waitForFunction(()=>document.querySelector('#word-sheet').dataset.sharedLayout);const geometry=()=>{const p=document.querySelector('[data-word-index="0"]'),page=p.closest('section.docx'),b=page.getBoundingClientRect(),scale=b.width/page.offsetWidth,w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT),result=[];let n;while(n=w.nextNode())for(let i=0;i<n.length;i++){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+1);const x=r.getBoundingClientRect();result.push([(x.left-b.left)/scale,(x.top-b.top)/scale,x.width/scale])}return result};const a=await pc.evaluate(geometry),b=await phone.evaluate(geometry);assert.equal(a.length,b.length);a.forEach((p,i)=>p.forEach((v,j)=>assert.ok(Math.abs(v-b[i][j])<1,'glyph '+i+' coordinate '+j+': '+v+' vs '+b[i][j])));await phone.locator('[data-word-index="0"]').fill('Edited on phone');await phone.locator('[data-word-index="0"]').blur();await pc.waitForFunction(()=>document.querySelector('[data-word-index="0"]')?.textContent==='Edited on phone')}finally{await browser.close();await new Promise(r=>host.server.close(r))}})

test('phone applies all paragraph positions before the next visible frame',async()=>{
 const host=await start(),browser=await chromium.launch({channel:'msedge'});try{
 const page=await browser.newPage();await page.goto(host.address)
 const result=await page.evaluate(async()=>{
  const {shareWordLayout}=await import('/shared-layout.mjs'),sheet=document.createElement('div'),paper=document.createElement('section');paper.className='docx';paper.style.cssText='position:relative;width:600px;height:1000px';sheet.append(paper);document.body.append(sheet)
  const paragraphs=Array.from({length:40},(_,index)=>{const p=document.createElement('p');p.dataset.wordSourceIndex=index;p.textContent='Line';paper.append(p);return {index,x:20,y:20+index*22,width:300,height:20,characters:[{text:'Line',x:0,y:0,width:30,height:20,font:'16px Arial',color:'#000000'}]}})
  let running=true,partial=0,frames=0
  const observe=()=>{if(!running)return;frames++;const positioned=[...paper.querySelectorAll('p')].filter(p=>p.style.position==='absolute').length;if(positioned>0&&positioned<40)partial++;requestAnimationFrame(observe)};requestAnimationFrame(observe)
  const start=performance.now();await shareWordLayout({sheet,source:{id:'test',contentVersion:1},role:'phone',request:async()=>({json:async()=>({pages:[{width:600,height:1000,paragraphs,objects:[]}]})})});running=false
  return {partial,frames,positioned:[...paper.querySelectorAll('p')].filter(p=>p.style.position==='absolute').length,duration:performance.now()-start}
 });assert.equal(result.partial,0,'unfinished layout must not be painted');assert.equal(result.positioned,40);console.log('40-paragraph phone layout applied in '+Math.round(result.duration)+' ms')
 }finally{await browser.close();await new Promise(resolve=>host.server.close(resolve))}
})
