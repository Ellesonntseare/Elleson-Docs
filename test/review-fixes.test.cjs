const {test} = require('node:test')
const assert = require('node:assert/strict')
const {start} = require('../server.cjs')
const {Document,Paragraph,Packer} = require('docx')
const {PDFDocument} = require('pdf-lib')
const {DOMParser,XMLSerializer} = require('@xmldom/xmldom')
const {strFromU8,strToU8} = require('fflate')
const {chromium} = require('playwright')
const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const word = async (...lines) => Packer.toBuffer(new Document({sections:[{children:lines.map(text=>new Paragraph(text))}]}))
const state = async host => (await (await fetch(host.address+'/api/state',{headers:{Authorization:'Bearer '+host.owner}})).json()).document
const edit = async (host,id,change) => fetch(host.address+'/api/edit/'+id,{method:'POST',headers:{Authorization:'Bearer '+host.owner,'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),...change})})
const close = host => new Promise(resolve=>host.server.close(resolve))
async function tool(page, id) {
  const locator = page.locator(id.startsWith('[data-mode=') ? 'button'+id : id)
  const menu = await locator.evaluate(node=>node.closest('details')?.querySelector('summary')?.textContent)
  if (menu && !await locator.isVisible()) await page.locator('summary').filter({hasText:new RegExp('^'+menu.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')}).click()
  await locator.click()
}

test('stale paragraph edits are rejected even when repeated text matches, including after recovery', async()=>{
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'elleson-review-'))
  let host = await start(0,directory)
  try {
    await host.open('same.docx',await word('Same','Same'))
    const original = await state(host)
    assert.equal((await edit(host,original.id,{kind:'word-tools',action:'paragraph',index:0,version:0,text:'Same'})).status,200)
    assert.equal((await edit(host,original.id,{kind:'word',index:1,before:'Same',value:'Wrong target',structureVersion:0})).status,409)
    await close(host); host=await start(0,directory)
    const recovered=await state(host)
    assert.equal(recovered.structureVersion,1)
    assert.equal((await edit(host,recovered.id,{kind:'word',index:1,before:'Same',value:'Wrong target',structureVersion:0})).status,409)
    assert.equal((await edit(host,recovered.id,{kind:'word',index:2,before:'Same',value:'Correct target',structureVersion:1})).status,200)
  } finally {await close(host);await fs.rm(directory,{recursive:true,force:true})}
})

test('paragraph splitting retains each drawing, section and bookmark once and preserves text spaces',async()=>{
  const {editWord}=await import('../word-tools.mjs')
  const xml=new DOMParser().parseFromString(`<w:document xmlns:w="${ns}"><w:body><w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t>Alpha beta</w:t><w:drawing/></w:r><w:bookmarkStart w:id="1" w:name="b"/><w:bookmarkEnd w:id="1"/></w:p></w:body></w:document>`,'application/xml')
  editWord(xml,{}, {action:'split',index:0,offset:5},DOMParser,XMLSerializer,strFromU8,strToU8)
  for(const name of ['drawing','sectPr','bookmarkStart','bookmarkEnd']) assert.equal(xml.getElementsByTagNameNS(ns,name).length,1,name)
  const paragraphs=Array.from(xml.getElementsByTagNameNS(ns,'p'))
  assert.deepEqual(paragraphs.map(p=>Array.from(p.getElementsByTagNameNS(ns,'t'),t=>t.textContent).join('')),['Alpha',' beta'])
  assert.equal(paragraphs[0].getElementsByTagNameNS(ns,'sectPr').length,0)
  const complex=new DOMParser().parseFromString(`<w:document xmlns:w="${ns}"><w:body><w:p><w:ins w:id="1"><w:r><w:t>Tracked</w:t></w:r></w:ins></w:p></w:body></w:document>`,'application/xml')
  const before=new XMLSerializer().serializeToString(complex)
  assert.throws(()=>editWord(complex,{}, {action:'split',index:0,offset:3},DOMParser,XMLSerializer,strFromU8,strToU8),/tracked changes/)
  assert.equal(new XMLSerializer().serializeToString(complex),before)
})

test('PDF radio and multi-select answers survive editing and exporting',async()=>{
  const host=await start()
  try {
    const pdf=await PDFDocument.create(),page=pdf.addPage(),form=pdf.getForm()
    const radio=form.createRadioGroup('Answer');radio.addOptionToPage('Yes',page,{x:30,y:500,width:20,height:20});radio.addOptionToPage('No',page,{x:80,y:500,width:20,height:20})
    const list=form.createOptionList('List');list.addOptions(['One','Two','Three']);list.enableMultiselect();list.select(['One']);list.addToPage(page,{x:30,y:350,width:100,height:80})
    await host.open('fields.pdf',await pdf.save());const current=await state(host)
    assert.deepEqual(current.originalFields.List,['One'])
    assert.equal((await edit(host,current.id,{kind:'field',name:'Answer',before:'',value:'Yes'})).status,200)
    assert.equal((await edit(host,current.id,{kind:'field',name:'List',before:['One'],value:['Two','Three']})).status,200)
    const result=await PDFDocument.load((await host.exportFile(current.id)).bytes)
    assert.equal(result.getForm().getRadioGroup('Answer').getSelected(),'Yes')
    assert.deepEqual(result.getForm().getOptionList('List').getSelected(),['Two','Three'])
  } finally {await close(host)}
})

test('offline typing stays visible and immediate typing survives a reload', {timeout:45000},async()=>{
  const host=await start(),browser=await chromium.launch({channel:'msedge'})
  try {
    await host.open('draft.docx',await word('Alpha beta','Second paragraph'))
    const page=await browser.newPage();await page.goto(host.address+'/#owner='+host.owner)
    await page.locator('[data-word-index="0"]').waitFor();await tool(page,'[data-mode="word"]')
    await page.locator('[data-word-index="0"][contenteditable="plaintext-only"]').waitFor()
    await page.context().setOffline(true)
    await page.locator('[data-word-index="0"]').fill('Offline new text')
    await page.waitForTimeout(500);await page.locator('#status').click();await page.waitForTimeout(300)
    assert.equal(await page.locator('[data-word-index="0"]').innerText(),'Offline new text')
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('elleson-pending-edits')).length),1)
    await page.context().setOffline(false)
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('elleson-pending-edits')||'[]').length===0)
    await page.locator('[data-word-index="0"]').fill('Before debounce restart')
    await page.reload()
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('elleson-input-drafts-v1')||'[]').length===0)
    assert.equal((await state(host)).lines[0].text,'Before debounce restart')
  } finally {await browser.close();await close(host)}
})

test('PDF form controls render and continuous reading retries after a temporary failure', {timeout:65000},async()=>{
  const host=await start(),browser=await chromium.launch({channel:'msedge'})
  try {
    const pdf=await PDFDocument.create(),page=pdf.addPage([400,500]),form=pdf.getForm()
    const radio=form.createRadioGroup('Answer');radio.addOptionToPage('Yes',page,{x:30,y:300,width:20,height:20});radio.addOptionToPage('No',page,{x:80,y:300,width:20,height:20})
    const list=form.createOptionList('List');list.addOptions(['One','Two']);list.enableMultiselect();list.addToPage(page,{x:30,y:200,width:130,height:60})
    await host.open('controls.pdf',await pdf.save());const screen=await browser.newPage();await screen.goto(host.address+'/#owner='+host.owner)
    await screen.locator('#pdf-fields input[type=radio]').first().waitFor()
    assert.equal(await screen.locator('#pdf-fields input[type=radio]').count(),2)
    await screen.getByRole('radio',{name:'Answer: Yes',exact:true}).check()
    await screen.locator('#pdf-fields select').selectOption(['One','Two'])
    await screen.waitForFunction(()=>document.querySelector('#save-state').textContent.includes('Recovery copy'))
    await screen.route('**/api/print/**',route=>route.abort())
    await tool(screen,'#page-tools button:has-text("Continuous reading")')
    await screen.waitForTimeout(300);await screen.unroute('**/api/print/**')
    await screen.locator('#reading-pages canvas').waitFor({timeout:8000})
    assert.ok(await screen.locator('#reading-pages article').count()>0)
  } finally {await browser.close();await close(host)}
})

test('scan failures retain captured pages and drafts reopen after a reload', {timeout:75000},async()=>{
  const host=await start(),browser=await chromium.launch({channel:'msedge'})
  try {
    const screen=await browser.newPage();await screen.goto(host.address+'/#owner='+host.owner)
    screen.setDefaultTimeout(10000)
    await screen.locator('#welcome').waitFor({state:'visible'})
    const png=await screen.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=400;canvas.height=500;const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,400,500);context.fillStyle='black';context.font='32px sans-serif';context.fillText('Scan recovery',20,70);return canvas.toDataURL().split(',')[1]})
    await screen.locator('#scan-file').setInputFiles({name:'scan.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')})
    await screen.locator('#scan-dialog[open]').waitFor()
    await screen.route('**/api/open',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Temporary failure'})}))
    await screen.locator('#scan-create').click()
    await screen.getByText('Temporary failure',{exact:true}).waitFor()
    assert.equal(await screen.locator('#scan-dialog').isVisible(),true)
    assert.equal(await screen.locator('#scan-pages button').filter({hasText:/^Page 1$/}).count(),1)
    await screen.unroute('**/api/open');await screen.reload()
    await tool(screen,'#resume-scan');await screen.locator('#scan-dialog[open]').waitFor()
    assert.equal(await screen.locator('#scan-pages button').filter({hasText:/^Page 1$/}).count(),1)
    await screen.locator('#scan-create').click()
    await screen.locator('#scan-dialog').waitFor({state:'hidden'})
    await screen.locator('#pdf-sheet').waitFor({state:'visible'})
  } finally {await browser.close();await close(host)}
})

test('formatting follows the current selection and selected words still allow paragraph alignment', {timeout:40000},async()=>{
  const {readWord}=require('../word.cjs')
  const host=await start(),browser=await chromium.launch({channel:'msedge'})
  try {
    await host.open('selection.docx',await word('Alpha beta','Second paragraph'))
    const page=await browser.newPage();await page.goto(host.address+'/#owner='+host.owner)
    await page.locator('[data-word-index="0"]').waitFor();await tool(page,'[data-mode="word"]')
    const selectFirst = async () => { await page.locator('[data-word-index="0"]').waitFor(); return page.evaluate(()=>{const element=document.querySelector('[data-word-index="0"]');element.focus();const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),node=walker.nextNode(),range=document.createRange();range.setStart(node,0);range.setEnd(node,5);getSelection().removeAllRanges();getSelection().addRange(range)}) }
    await selectFirst();await page.waitForTimeout(50);await page.locator('[data-word-index="1"]').click()
    await tool(page,'#word-ribbon-controls button:has-text("Bold")')
    await page.waitForTimeout(300)
    let current=await state(host),parsed=await readWord((await host.exportFile(current.id)).bytes,'docx')
    const paragraphs=Array.from(parsed.document.getElementsByTagNameNS(ns,'p'))
    assert.equal(paragraphs[0].getElementsByTagNameNS(ns,'b').length,0)
    assert.equal(paragraphs[1].getElementsByTagNameNS(ns,'b').length,1)
    await page.keyboard.press('Escape');await selectFirst();await page.waitForTimeout(50)
    const select=page.locator('#word-ribbon-controls select[aria-label="Alignment"]')
    if (!await select.isVisible()) await page.locator('summary').filter({hasText:/^Formatting$/}).click()
    await select.selectOption('center')
    await page.waitForTimeout(300)
    current=await state(host);parsed=await readWord((await host.exportFile(current.id)).bytes,'docx')
    assert.equal(parsed.document.getElementsByTagNameNS(ns,'p')[0].getElementsByTagNameNS(ns,'jc')[0].getAttributeNS(ns,'val'),'center')
  } finally {await browser.close();await close(host)}
})
