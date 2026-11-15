import { clickTool } from './menu-helper.cjs'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PDFDocument} from 'pdf-lib'
import {protectPdf} from '../pdf-protection.mjs'
import {unlockPdf,needsPassword,decoratePdf,documentInfo,redactPdf} from '../document-extras.mjs'
import * as mupdf from 'mupdf'
import {review,reviewList} from '../pdf-tools.mjs'
import {start} from '../server.cjs'
import {chromium} from 'playwright'
import {searchablePdf} from '../conversion-engine.mjs'
test('searchable image output retains a hidden text layer',async()=>{
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
 const result=await searchablePdf([{bytes}],async()=>({blocks:[{paragraphs:[{lines:[{words:[{text:'Receipt',bbox:{x0:0,y0:0,x1:1,y1:1}}]}]}]}]}))
 const pdf=new mupdf.PDFDocument(result),page=pdf.loadPage(0),text=page.toStructuredText()
 try{assert.ok(text.asText().includes('Receipt'))}finally{text.destroy();page.destroy();pdf.destroy()}
})
test('protected copies unlock and PDF decorations and resolved comments persist',async()=>{
 const pdf=await PDFDocument.create();pdf.addPage();const original=await pdf.save(),locked=protectPdf(original,'secret-test-123')
 assert.ok(needsPassword(locked));assert.throws(()=>unlockPdf(locked,'wrong'))
 const unlocked=unlockPdf(locked,'secret-test-123');assert.equal(needsPassword(unlocked),false)
 const decorated=await decoratePdf(unlocked,{header:'Header',footer:'Footer',watermark:'DRAFT',numbers:true})
 assert.equal(documentInfo(decorated).pages[0].searchable,true)
 const annotated=review(decorated,{id:'test-comment',page:1,type:'Text',text:'Review me',rect:[20,20,40,40]})
 const resolved=review(annotated,{page:1,action:'resolve',target:'test-comment',resolved:true})
 assert.equal(reviewList(resolved,0)[0].resolved,true)
})
test('redaction removes selected text from the saved content stream',async()=>{
 const pdf=await PDFDocument.create(),page=pdf.addPage([400,500]);page.drawText('SECRET',{x:30,y:440,size:18});page.drawText('Keep this',{x:30,y:350,size:18})
 const result=redactPdf(await pdf.save(),{page:1,rect:[20,30,180,75]}),doc=new mupdf.PDFDocument(result),p=doc.loadPage(0),text=p.toStructuredText()
 try{assert.ok(!text.asText().includes('SECRET'));assert.ok(text.asText().includes('Keep this'))}finally{text.destroy();p.destroy();doc.destroy()}
})
test('productivity dialog creates reusable stamps and applies Word replacement', {timeout:90000},async()=>{
 const host=await start(),browser=await chromium.launch({channel:'msedge'})
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto(host.address+'/#owner='+host.owner)
  await clickTool(page, page.locator('#new-document'));await page.locator('#new-text').fill('Hello hello shello.');await clickTool(page, page.locator('#new-form button.primary'))
  await page.locator('#file-title').filter({hasText:'Untitled.docx'}).waitFor()
  await clickTool(page, page.locator("summary").filter({hasText:/^More$/}));await clickTool(page, page.locator('#document-extras'))
  await page.locator('#stamp-value').fill('RECEIVED');await clickTool(page, page.locator('#stamp-save'));assert.equal(await page.locator('#saved-stamps option').count(),2)
  await clickTool(page, page.getByText('Find and replace in Word',{exact:true}))
  await page.locator('#replace-find').fill('hello');await page.locator('#replace-with').fill('Welcome');await page.locator('#replace-whole').check();await clickTool(page, page.locator('#replace-all'))
  await page.locator('#replace-count').filter({hasText:'2 replacement(s)'}).waitFor()
  assert.equal(host.getDocument().lines[0].text,'Welcome Welcome shello.')
  assert.deepEqual(errors,[])
 }finally{await browser.close();await new Promise(resolve=>host.server.close(resolve))}
})
