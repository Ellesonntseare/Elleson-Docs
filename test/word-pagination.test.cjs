const {test}=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright'),{Document,Paragraph,Packer}=require('docx'),{unzipSync,zipSync,strFromU8,strToU8}=require('fflate'),{start}=require('../server.cjs')
test('saved Word page breaks remain visible and have identical phone and PC geometry',{timeout:60000},async()=>{
 const archive=unzipSync(await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('First page'),new Paragraph('Second page'),new Paragraph('Third page')]}]})))
 archive['word/document.xml']=strToU8(strFromU8(archive['word/document.xml']).replace('<w:t xml:space="preserve">Second page','<w:lastRenderedPageBreak/><w:t xml:space="preserve">Second page').replace('<w:t xml:space="preserve">Third page','<w:lastRenderedPageBreak/><w:t xml:space="preserve">Third page'))
 const host=await start(),browser=await chromium.launch({channel:'msedge'})
 try{await host.open('Preserved pages.docx',zipSync(archive));const pc=await browser.newPage(),phone=await browser.newPage({viewport:{width:390,height:844}});await pc.goto(host.address+'/#owner='+host.owner);await phone.goto(host.address)
 for(const page of [pc,phone])await page.waitForFunction(()=>document.querySelectorAll('#word-sheet section.docx').length===3)
 await phone.waitForFunction(()=>document.querySelector('#word-sheet').dataset.sharedLayout)
 const geometry=page=>page.locator('#word-sheet section.docx').evaluateAll(pages=>pages.map(p=>({width:p.offsetWidth,height:p.offsetHeight,text:p.textContent.trim()})))
 assert.deepEqual(await geometry(phone),await geometry(pc));assert.deepEqual((await geometry(pc)).map(p=>p.text),['First page','Second page','Third page'])
 assert.equal(await phone.locator('#word-sheet section.docx').evaluateAll(p=>p[1].getBoundingClientRect().top>p[0].getBoundingClientRect().bottom),true)
 }finally{await browser.close();host.server.closeAllConnections();await new Promise(r=>host.server.close(r))}
})
