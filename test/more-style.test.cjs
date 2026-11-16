const {test}=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright'),{PDFDocument}=require('pdf-lib'),{start}=require('../server.cjs')
test('grouped More menu fits phone and desktop and exposes every section',{timeout:60000},async()=>{
 const host=await start(),browser=await chromium.launch({channel:'msedge'})
 try{const pdf=await PDFDocument.create();pdf.addPage();await host.open('Menu.pdf',await pdf.save())
 for(const width of [390,1100]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 if(width>600)await page.addInitScript(()=>window.desktopDocs={onPasswordRequired(){}})
 await page.goto(host.address+'/#owner='+host.owner);await page.getByText('PDF ready',{exact:true}).waitFor()
 await page.locator('.mobile-more-sheet > summary').click()
 const panel=page.locator('.grouped-more-panel');await panel.waitFor({state:'visible'})
 for(const title of ['Device & Connection','Document & Editing','Viewing & Reading','System'])assert.equal(await panel.getByRole('heading',{name:title,exact:true}).count(),1)
 const box=await panel.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1)
 await panel.screenshot({path:'.build/more-style-'+width+'.png'})
 await panel.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await panel.isVisible(),false);assert.deepEqual(errors,[]);await page.close()
 }
 }finally{await browser.close();host.server.closeAllConnections();await new Promise(r=>host.server.close(r))}
})

