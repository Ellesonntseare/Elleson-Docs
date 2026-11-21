const {test}=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright'),{PDFDocument}=require('pdf-lib'),{start}=require('../server.cjs')
test('idle mobile toolbar settles instead of scheduling itself every animation frame',{timeout:60000},async()=>{
 const host=await start(),browser=await chromium.launch({channel:'msedge'})
 try{const pdf=await PDFDocument.create();pdf.addPage();await host.open('Idle.pdf',await pdf.save());const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(host.address+'/#owner='+host.owner);await page.getByText('PDF ready',{exact:true}).waitFor();await page.waitForTimeout(500)
 const count=await page.evaluate(()=>new Promise(resolve=>{let changes=0;const observer=new MutationObserver(records=>changes+=records.length);observer.observe(document.querySelector('#toolbar'),{subtree:true,attributes:true,attributeFilter:['hidden','aria-pressed']});setTimeout(()=>{observer.disconnect();resolve(changes)},1000)}));console.log('Idle toolbar mutations per second:',count);assert.ok(count<40,'Toolbar should settle while idle')
 }finally{await browser.close();host.server.closeAllConnections();await new Promise(r=>host.server.close(r))}
})
