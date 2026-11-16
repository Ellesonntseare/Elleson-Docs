const {test}=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright'),{PDFDocument}=require('pdf-lib'),{start}=require('../server.cjs'),{clickTool}=require('./menu-helper.cjs')
test('partial eraser cuts a PDF stroke on the page and one Undo restores it',{timeout:60000},async()=>{
 const host=await start(),browser=await chromium.launch({channel:'msedge'})
 try{const pdf=await PDFDocument.create();pdf.addPage([400,600]);await host.open('Erase.pdf',await pdf.save())
 const page=await browser.newPage({viewport:{width:1100,height:900}});await page.goto(host.address+'/#owner='+host.owner);await page.getByText('PDF ready',{exact:true}).waitFor()
 const headers={Authorization:'Bearer '+host.owner,'Content-Type':'application/json'}
 await fetch(host.address+'/api/edit/'+host.getDocument().id,{method:'POST',headers,body:JSON.stringify({kind:'ink',id:'partial-ui-original-ink',page:1,points:[[80,300],[320,300]],width:2,color:'#000000'})})
 await clickTool(page,page.locator('[data-mode=pen]'))
 await clickTool(page,page.locator('#drawing-eraser'));await page.locator('#eraser-type').selectOption('partial');await page.keyboard.press('Escape')
 const box=await page.locator('#pdf-sheet').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2
 await page.mouse.move(x,y);await page.mouse.down();assert.equal(await page.locator('#eraser-cursor').isVisible(),true);await page.mouse.up()
 const deadline=Date.now()+5000;while(host.getDocument().marks.length!==2&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));assert.equal(host.getDocument().marks.length,2)
 const r=await fetch(host.address+'/api/edit/'+host.getDocument().id,{method:'POST',headers,body:JSON.stringify({kind:'history-undo',id:'partial-ui-undo-action'})});assert.equal(r.status,200);assert.equal(host.getDocument().marks.length,1);assert.deepEqual(host.getDocument().marks[0].points,[[80,300],[320,300]])
 }finally{await browser.close();host.server.closeAllConnections();await new Promise(r=>host.server.close(r))}
})
