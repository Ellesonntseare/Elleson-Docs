const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs/promises')
const path=require('node:path')
const {chromium}=require('playwright')
const {PDFDocument}=require('pdf-lib')
const {Document,Paragraph,Packer}=require('docx')

test('standalone Android assets preserve PDF choices and reject stale Word positions after reload', {timeout:45000},async()=>{
  const browser=await chromium.launch({channel:'msedge'})
  try {
    const context=await browser.newContext(),assets=path.resolve(__dirname,'../.build/android-assets/app')
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url())
      if(url.hostname!=='appassets.androidplatform.net'||url.pathname.startsWith('/api/')) return route.abort()
      const filename=path.resolve(assets,url.pathname==='/'?'index.html':url.pathname.slice(1))
      if(!filename.startsWith(assets+path.sep))return route.abort()
      const contentType=/\.(mjs|js)$/.test(filename)?'application/javascript':filename.endsWith('.wasm')?'application/wasm':filename.endsWith('.css')?'text/css':'application/octet-stream'
      try{await route.fulfill({body:await fs.readFile(filename),contentType:filename.endsWith('.html')?'text/html':contentType})}catch{await route.fulfill({status:404,body:'Missing'})}
    })
    const page=await context.newPage();await page.goto('https://appassets.androidplatform.net/#owner=local')
    await page.locator('#welcome').waitFor({state:'visible'})
    const pdf=await PDFDocument.create(),sheet=pdf.addPage(),form=pdf.getForm()
    const radio=form.createRadioGroup('Answer');radio.addOptionToPage('Yes',sheet,{x:30,y:400,width:20,height:20})
    const list=form.createOptionList('List');list.addOptions(['One','Two']);list.enableMultiselect();list.addToPage(sheet,{x:30,y:250,width:130,height:100})
    await page.locator('#file').setInputFiles({name:'choices.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())})
    await page.locator('#pdf-fields input[type=radio]').waitFor()
    const exported=await page.evaluate(async()=>{
      const document=(await(await fetch('/api/state')).json()).document
      for(const [name,value,before] of [['Answer','Yes',''],['List',['One','Two'],[]]]){
        const response=await fetch('/api/edit/'+document.id,{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),kind:'field',name,value,before})})
        if(!response.ok)throw Error(await response.text())
      }
      return Array.from(new Uint8Array(await(await fetch('/api/save/'+document.id+'?transfer=1')).arrayBuffer()))
    })
    const saved=await PDFDocument.load(Uint8Array.from(exported))
    assert.equal(saved.getForm().getRadioGroup('Answer').getSelected(),'Yes')
    assert.deepEqual(saved.getForm().getOptionList('List').getSelected(),['One','Two'])
    const docx=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('Same'),new Paragraph('Same')]}]}))
    await page.locator('#file').setInputFiles({name:'same.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:docx})
    await page.locator('[data-word-index="0"]').waitFor()
    await page.evaluate(async()=>{const document=(await(await fetch('/api/state')).json()).document;const response=await fetch('/api/edit/'+document.id,{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),kind:'word-tools',action:'paragraph',index:0,version:document.contentVersion,text:'Same'})});if(!response.ok)throw Error(await response.text())})
    await page.reload();await page.locator('[data-word-index="2"]').waitFor()
    const rejected=await page.evaluate(async()=>{const document=(await(await fetch('/api/state')).json()).document;const response=await fetch('/api/edit/'+document.id,{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),kind:'word',index:1,before:'Same',value:'Wrong target',structureVersion:0})});return {status:response.status,epoch:document.structureVersion}})
    assert.deepEqual(rejected,{status:409,epoch:1})
  } finally {await browser.close()}
})
