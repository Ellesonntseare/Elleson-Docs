const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs/promises'),path=require('node:path')
const {PDFDocument}=require('pdf-lib')
const {Document,Paragraph,Packer}=require('docx')
const {chromium}=require('playwright')
const {start}=require('../server.cjs')
const {clickTool}=require('./menu-helper.cjs')
const headers=host=>({Authorization:'Bearer '+host.owner})
const state=async host=>(await(await fetch(host.address+'/api/state',{headers:headers(host)})).json()).document
const edit=async(host,doc,change)=>{const response=await fetch(host.address+'/api/edit/'+doc.id,{method:'POST',headers:{...headers(host),'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),...change})});assert.equal(response.status,200,await response.clone().text());return response.json()}
const close=host=>new Promise(resolve=>host.server.close(resolve))
async function fixture(){const pdf=await PDFDocument.create();for(let i=0;i<3;i++)pdf.addPage([400+i*20,500]);pdf.getForm().createTextField('Name').addToPage(pdf.getPage(0),{x:20,y:300,width:130,height:25});return pdf.save()}

test('automatic crop isolates the paper from disconnected bright objects',async()=>{
 const {pageCorners}=await import('../scan-detection.mjs'),w=100,h=100,pixels=new Uint8Array(w*h*4)
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const value=x>=20&&x<=80&&y>=10&&y<=90||x<8&&y<8?245:45;const i=(y*w+x)*4;pixels.set([value,value,value,255],i)}
 const corners=pageCorners(pixels,w,h);assert.ok(corners[0][0]>.18&&corners[0][0]<.22);assert.ok(corners[0][1]<.12);assert.ok(corners[2][0]>.8&&corners[2][0]<.83)
})

test('page plans preserve form entries and editable ink through reorder, duplicate, rotation and undo',async()=>{
 const host=await start()
 try{await host.open('pages.pdf',Buffer.from(await fixture()));let doc=await state(host)
 doc=await edit(host,doc,{kind:'field',name:'Name',before:'',value:'Keep this'})
 doc=await edit(host,doc,{kind:'ink',page:2,points:[[30,40],[60,80]],color:'#cc2233',width:3})
 doc=await edit(host,doc,{kind:'pages',action:'plan',version:doc.contentVersion,pages:[{index:1,rotation:90},{index:0,rotation:0},{index:1,rotation:180}]})
 assert.deepEqual(doc.marks.map(m=>m.page),[1,3]);assert.equal(new Set(doc.marks.map(m=>m.id)).size,2)
 const pdf=await PDFDocument.load((await host.exportFile(doc.id)).bytes);assert.equal(pdf.getPageCount(),3);assert.equal(pdf.getPage(0).getRotation().angle,90);assert.equal(pdf.getForm().getTextField('Name').getText(),'Keep this')

 doc=await edit(host,doc,{kind:'history-undo'});assert.equal(doc.marks.length,1);assert.equal(doc.marks[0].page,2)
 }finally{await close(host)}
})

test('batch Word drawing edits duplicate independent images and are undoable',async()=>{
 const {readWord,saveWord}=require('../word.cjs'),{unzipSync,strFromU8}=require('fflate'),{DOMParser}=require('@xmldom/xmldom')
 const host=await start();try{
 const original=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('Sign here')]}]})),source=await readWord(original,'docx'),png=await fs.readFile(path.join(__dirname,'../web/logo.png'))
 const bytes=await saveWord(source,{}, {},undefined,{index:0,type:'png',bytes:png,width:100,height:50,position:{x:40,y:100,width:100,height:50}})
 await host.open('ink.docx',bytes);let doc=await state(host)
 const archive=unzipSync(bytes),xml=new DOMParser().parseFromString(strFromU8(archive['word/_rels/document.xml.rels']),'text/xml'),target=Array.from(xml.getElementsByTagNameNS('*','Relationship')).find(n=>/media\//.test(n.getAttribute('Target'))).getAttribute('Target')
 const response=await fetch(host.address+'/api/word-ink-batch/'+doc.id,{method:'POST',headers:{...headers(host),'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),version:doc.contentVersion,action:'duplicate',items:[{target,position:{x:160,y:100,width:100,height:50}}]})});assert.equal(response.status,200,await response.clone().text());doc=await response.json()
 const duplicated=unzipSync((await host.exportFile(doc.id)).bytes);assert.equal((strFromU8(duplicated['word/document.xml']).match(/name="Elleson ink"/g)||[]).length,2)
 doc=await edit(host,doc,{kind:'history-undo'});const undone=unzipSync((await host.exportFile(doc.id)).bytes);assert.equal((strFromU8(undone['word/document.xml']).match(/name="Elleson ink"/g)||[]).length,1)
 }finally{await close(host)}
})

test('phone workspace combines files, organises pages, draws shapes and previews recovery checkpoints', {timeout:120000},async()=>{
 const host=await start(),browser=await chromium.launch({channel:'msedge'})
 try{
 await host.open('Original.pdf',Buffer.from(await fixture()));const screen=await browser.newPage({viewport:{width:390,height:844},isMobile:true}),errors=[];screen.setDefaultTimeout(10000);screen.on('pageerror',e=>errors.push(e.message))
 await screen.goto(host.address+'/#owner='+host.owner);await screen.getByText('PDF ready',{exact:true}).waitFor()
 await clickTool(screen,screen.locator('#suite-combine'))
 await screen.getByLabel('Files to combine').setInputFiles([{name:'first.pdf',mimeType:'application/pdf',buffer:Buffer.from(await fixture())},{name:'second.png',mimeType:'image/png',buffer:await fs.readFile(path.join(__dirname,'../web/logo.png'))}])
 await screen.getByRole('button',{name:'Preview combined PDF',exact:true}).click();await screen.getByRole('button',{name:'Open combined PDF',exact:true}).waitFor();await screen.getByRole('button',{name:'Open combined PDF',exact:true}).click()
 await screen.locator('#file-title').getByText('Combined document.pdf',{exact:true}).waitFor();assert.equal((await state(host)).pages,4)
 await clickTool(screen,screen.locator('#suite-pages'));await screen.locator('#page-workspace .suite-page-card').nth(0).getByRole('button',{name:'Duplicate',exact:true}).click();await screen.locator('#page-workspace .suite-page-card').nth(0).getByRole('button',{name:'Rotate',exact:true}).click();await screen.getByRole('button',{name:'Apply page changes',exact:true}).click();await screen.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Page changes saved'))
 assert.equal((await state(host)).pages,5)
 await clickTool(screen,screen.locator('#suite-drawing'));await screen.locator('#drawing-workspace').getByRole('button',{name:'Rectangle',exact:true}).click()
 const r=await screen.locator('#pdf-sheet').boundingBox();await screen.mouse.move(r.x+40,r.y+40);await screen.mouse.down();await screen.mouse.move(r.x+100,r.y+100);await screen.mouse.up();await screen.getByText('Shape saved. Undo removes it.',{exact:true}).waitFor()
 let doc=await state(host);assert.ok(doc.marks.some(m=>m.kind==='ink'&&m.points.length===5))
 await screen.keyboard.press('Escape');await clickTool(screen,screen.locator('#suite-drawing'));await screen.locator('#drawing-workspace').getByRole('button',{name:'Select drawings',exact:true}).click()
 const selectedBounds=await screen.locator('#pdf-sheet').boundingBox();await screen.mouse.move(selectedBounds.x+20,selectedBounds.y+20);await screen.mouse.down();await screen.mouse.move(selectedBounds.x+120,selectedBounds.y+120);await screen.mouse.up()
 await screen.locator('#drawing-workspace[open]').waitFor();await screen.getByLabel('Drawing selection colour',{exact:true}).fill('#cc2233');await screen.getByRole('button',{name:'Apply colour',exact:true}).click();await screen.getByText('Drawing changes saved.',{exact:true}).waitFor();assert.ok((await state(host)).marks.every(mark=>mark.color==='#cc2233'))
 await screen.locator('#drawing-workspace').getByRole('button',{name:'Close',exact:true}).click();await screen.keyboard.press('Escape');await clickTool(screen,screen.locator('#suite-recovery'));await screen.getByRole('button',{name:'Create checkpoint',exact:true}).click();await screen.locator('.suite-history-list button').first().click();await screen.getByRole('button',{name:'Restore selected version',exact:true}).waitFor();await screen.locator('.suite-version-preview canvas').waitFor();await screen.locator('#recovery-workspace').getByRole('button',{name:'Close',exact:true}).click()
 await clickTool(screen,screen.locator('#suite-companion'));await screen.locator('#companion-workspace').getByRole('button',{name:'Pen pad',exact:true}).click();await screen.locator('body.phone-companion').waitFor();await screen.getByRole('button',{name:'Exit companion',exact:true}).click()
 assert.deepEqual(errors,[])
 }finally{await browser.close();await close(host)}
})

test('multi-page scanning auto-crops photos and Word shapes remain selectable and editable',{timeout:120000},async()=>{
 const host=await start(),browser=await chromium.launch({channel:'msedge'})
 try{
 await host.open('Start.pdf',Buffer.from(await fixture()));const screen=await browser.newPage({viewport:{width:390,height:844},isMobile:true}),errors=[];screen.setDefaultTimeout(10000);screen.on('pageerror',e=>errors.push(e.message));await screen.goto(host.address+'/#owner='+host.owner);await screen.getByText('PDF ready',{exact:true}).waitFor()
 const photo=Buffer.from(await screen.evaluate(()=>{const c=document.createElement('canvas');c.width=320;c.height=420;const x=c.getContext('2d');x.fillStyle='#333';x.fillRect(0,0,320,420);x.fillStyle='white';x.fillRect(40,30,240,360);x.fillStyle='black';x.font='20px sans-serif';x.fillText('Scan this page',60,90);return c.toDataURL('image/png').split(',')[1]}),'base64')
 await screen.locator('#scan-file').setInputFiles([{name:'Scan one.png',mimeType:'image/png',buffer:photo},{name:'Scan two.png',mimeType:'image/png',buffer:photo}]);await screen.locator('#scan-pages img').nth(1).waitFor();assert.equal(await screen.locator('#scan-pages img').count(),2)
 await screen.locator('#scan-create').click();await screen.locator('#scan-dialog').waitFor({state:'hidden'});assert.equal((await state(host)).pages,2)
 const word=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('Sign here')]}]}));await host.open('Shapes.docx',word);await screen.locator('#file-title').getByText('Shapes.docx',{exact:true}).waitFor();await screen.locator('#word-sheet section.docx').waitFor()
 await clickTool(screen,screen.locator('#suite-drawing'));await screen.locator('#drawing-workspace').getByRole('button',{name:'Arrow',exact:true}).click();await screen.locator('#drawing-workspace').waitFor({state:'hidden'});let r=await screen.locator('#word-sheet section.docx').first().boundingBox();await screen.mouse.move(r.x+30,r.y+60);await screen.mouse.down();await screen.mouse.move(r.x+110,r.y+100);await screen.mouse.up();await screen.locator('#word-sheet .word-saved-ink').waitFor().catch(async()=>{throw Error('Word shape failed: '+await screen.locator('#status').textContent()+' / '+JSON.stringify(errors))})
 await screen.keyboard.press('Escape');await clickTool(screen,screen.locator('#suite-drawing'));await screen.locator('#drawing-workspace').getByRole('button',{name:'Select drawings',exact:true}).click();await screen.locator('#drawing-workspace').waitFor({state:'hidden'});r=await screen.locator('#word-sheet section.docx').first().boundingBox();await screen.mouse.move(r.x+10,r.y+40);await screen.mouse.down();await screen.mouse.move(r.x+130,r.y+120);await screen.mouse.up();await screen.locator('#drawing-workspace[open]').waitFor();await screen.getByRole('button',{name:'Duplicate',exact:true}).click();await screen.waitForFunction(()=>document.querySelectorAll('#word-sheet .word-saved-ink').length===2).catch(async()=>{throw Error('Duplicate Word drawing: '+await screen.locator('#drawing-workspace [role=status]').textContent()+' / '+await screen.locator('#status').textContent()+' / '+JSON.stringify(errors))})
 assert.deepEqual(errors,[])
 }finally{await browser.close();await close(host)}
})

test('standalone phone applies page plans and restores previewed recovery checkpoints offline',{timeout:90000},async()=>{
 const browser=await chromium.launch({channel:'msedge'});try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true}),assets=path.resolve(__dirname,'../.build/android-assets/app'),errors=[],network=[]
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname!=='appassets.androidplatform.net'||url.pathname.startsWith('/api/')){network.push(url.href);return route.abort()}const name=path.resolve(assets,url.pathname==='/'?'index.html':url.pathname.slice(1));if(!name.startsWith(assets+path.sep))return route.abort();try{await route.fulfill({body:await fs.readFile(name),contentType:/\.(js|mjs)$/.test(name)?'application/javascript':name.endsWith('.wasm')?'application/wasm':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html'})}catch{await route.fulfill({status:404,body:'Missing'})}})
 const screen=await context.newPage();screen.setDefaultTimeout(10000);screen.on('pageerror',e=>errors.push(e.message));await screen.goto('https://appassets.androidplatform.net/#owner=local');await screen.getByRole('heading',{name:'Open a document',exact:true}).waitFor();await screen.locator('#file').setInputFiles({name:'Offline pages.pdf',mimeType:'application/pdf',buffer:Buffer.from(await fixture())});await screen.getByText('PDF ready',{exact:true}).waitFor()
 await clickTool(screen,screen.locator('#suite-pages'));await screen.locator('#page-workspace .suite-page-card').first().getByRole('button',{name:'Duplicate',exact:true}).click();await screen.getByRole('button',{name:'Apply page changes',exact:true}).click();await screen.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Page changes saved'))
 assert.equal(await screen.evaluate(async()=>(await(await fetch('/api/state')).json()).document.pages),4)
 await clickTool(screen,screen.locator('#suite-recovery'));await screen.getByRole('button',{name:'Create checkpoint',exact:true}).click();await screen.locator('.suite-history-list button').last().click();await screen.locator('.suite-version-preview canvas').waitFor();await screen.getByRole('button',{name:'Restore selected version',exact:true}).click();await screen.locator('#recovery-workspace').waitFor({state:'hidden'});assert.equal(await screen.evaluate(async()=>(await(await fetch('/api/state')).json()).document.pages),3)
 const {readWord,saveWord}=require('../word.cjs'),{unzipSync,strFromU8}=require('fflate'),{DOMParser}=require('@xmldom/xmldom')
 const original=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('Original text')]}]})),source=await readWord(original,'docx'),png=await fs.readFile(path.join(__dirname,'../web/logo.png'))
 const inkDoc=await saveWord(source,{}, {},undefined,{index:0,type:'png',bytes:png,width:100,height:50,position:{x:40,y:100,width:100,height:50}}),xml=new DOMParser().parseFromString(strFromU8(unzipSync(inkDoc)['word/_rels/document.xml.rels']),'text/xml'),target=Array.from(xml.getElementsByTagNameNS('*','Relationship')).find(n=>/media\//.test(n.getAttribute('Target'))).getAttribute('Target')
 await screen.locator('#file').setInputFiles({name:'Offline ink.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from(inkDoc)});await screen.locator('#file-title').getByText('Offline ink.docx',{exact:true}).waitFor()
 const result=await screen.evaluate(async target=>{
   const request=async(url,body)=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r}
   let doc=(await(await fetch('/api/state')).json()).document
   await request('/api/edit/'+doc.id,{id:crypto.randomUUID(),kind:'word',index:0,before:'Original text',value:'Edited text stays',structureVersion:doc.structureVersion})
   doc=(await(await fetch('/api/state')).json()).document
   await request('/api/word-ink-batch/'+doc.id,{id:crypto.randomUUID(),version:doc.contentVersion,action:'duplicate',items:[{target,position:{x:160,y:100,width:100,height:50}}]})
   return (await(await fetch('/api/state')).json()).document.lines[0].text
 },target);assert.equal(result,'Edited text stays')
 assert.deepEqual(errors,[]);assert.deepEqual(network,[])
 }finally{await browser.close()}
})

test('drawing selection transforms complete signatures together and leaves unrelated ink unchanged',async()=>{
 const {changeMarks}=await import('../mark-tools.mjs')
 const marks=[{id:'a',group:'signature',kind:'ink',page:1,points:[[0,0],[10,10]],width:2},{id:'b',group:'signature',kind:'ink',page:1,points:[[10,10],[20,0]],width:2},{id:'c',kind:'ink',page:1,points:[[30,0],[40,10]],width:2},{id:'other',kind:'ink',page:1,points:[[80,80],[90,90]],width:2}]
 const changed=changeMarks(marks,{id:'edit',targets:['a','c'],action:'apply',dx:5,dy:8,color:'#167642',width:4})
 assert.deepEqual(changed.slice(0,3).map(m=>m.color),['#167642','#167642','#167642']);assert.equal(changed[0].width,4);assert.deepEqual(changed[1].points[0],[15,18]);assert.deepEqual(changed[3],marks[3]);assert.equal(marks[0].color,undefined)
 const duplicated=changeMarks(changed,{id:'copy',targets:['a','c'],action:'duplicate',dx:10});assert.equal(duplicated.length,7);assert.equal(new Set(duplicated.map(m=>m.id)).size,7)
 assert.throws(()=>changeMarks(marks,{targets:['missing'],action:'delete'}),/again/)
})


test('restoring the oldest checkpoint succeeds when retaining only one version',async()=>{
 const host=await start();try{
   await host.open('History.pdf',Buffer.from(await fixture()));let doc=await state(host)
   const json={...headers(host),'Content-Type':'application/json'}
   const versions=await(await fetch(host.address+'/api/library/'+doc.libraryId+'/versions',{headers:headers(host)})).json(),old=versions[0].id
   await fetch(host.address+'/api/storage',{method:'POST',headers:json,body:JSON.stringify({limit:1})})
   doc=await edit(host,doc,{kind:'field',name:'Name',before:'',value:'Keep newer work'})
   const response=await fetch(host.address+'/api/restore-checkpoint/'+doc.id,{method:'POST',headers:json,body:JSON.stringify({version:old})});assert.equal(response.status,200,await response.clone().text());const restored=await response.json()
   const pdf=await PDFDocument.load((await host.exportFile(restored.id)).bytes);assert.equal(pdf.getForm().getTextField('Name').getText()??'','')
   const retained=await(await fetch(host.address+'/api/library/'+restored.libraryId+'/versions',{headers:headers(host)})).json();assert.equal(retained.length,1)
   const saved=await PDFDocument.load(await(await fetch(host.address+'/api/library/'+restored.libraryId+'/preview/'+retained[0].id,{headers:headers(host)})).arrayBuffer());assert.equal(saved.getForm().getTextField('Name').getText(),'Keep newer work')
 }finally{await close(host)}
})
