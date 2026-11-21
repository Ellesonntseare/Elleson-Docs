const {test}=require('node:test')
const assert=require('node:assert/strict')
const {chromium}=require('playwright')
const {PDFDocument}=require('pdf-lib')
const {start}=require('../server.cjs')
const {clickTool,waitForAsync}=require('./menu-helper.cjs')

test('phone touch drawing and handwritten signatures remain in the exported PDF', {timeout:90000}, async()=>{
  const host=await start(),browser=await chromium.launch({channel:'msedge'})
  try {
    const pdf=await PDFDocument.create();pdf.addPage([400,600])
    await host.open('Sign on phone.pdf',Buffer.from(await pdf.save()))
    const page=await browser.newPage({viewport:{width:412,height:915},isMobile:true,hasTouch:true})
    const cdp=await page.context().newCDPSession(page)
    const stroke=async(selector,points)=>{
      const box=await page.locator(selector).boundingBox()
      const point=([x,y])=>({id:1,x:box.x+x*box.width,y:box.y+y*box.height,radiusX:3,radiusY:3,force:1})
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(points[0])]})
      for(const next of points.slice(1))await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(next)]})
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    }
    await page.goto(host.address+'/#owner='+host.owner)
    await page.getByText('PDF ready',{exact:true}).waitFor()
    await clickTool(page,page.locator('[data-mode=pen]'))
    await stroke('#ink-canvas',[[.15,.2],[.2,.25],[.25,.2],[.3,.27]])
    await clickTool(page,page.locator('#drawing-done'))
    assert.equal(host.getDocument().marks.length,1)
    const oldMark=host.getDocument().marks[0]
    const inkBounds=await page.locator('#ink-canvas').boundingBox()
    await page.waitForFunction(()=>['read','edit'].includes(document.querySelector('#pdf-sheet').dataset.mode))
    const [tapX,tapY]=oldMark.points[1]
    const x=inkBounds.x+inkBounds.width*tapX/400,y=inkBounds.y+inkBounds.height*(1-tapY/600)
    await page.touchscreen.tap(x,y)
    await page.locator('#selection-box').waitFor()
    await page.locator('#selection-edit').click()
    await page.locator('#mark-x').fill('14')
    await page.locator('#mark-apply').click()
    await waitForAsync(page,async ({owner,oldX})=>(await(await fetch('/api/state',{headers:{Authorization:'Bearer '+owner}})).json()).document.marks[0].points[0][0]>oldX,{owner:host.owner,oldX:oldMark.points[0][0]})
    await clickTool(page,page.locator('#signature'))
    const pad=await page.locator('#signature-pad').boundingBox(),finger=(id,x)=>({id,x:pad.x+pad.width*x,y:pad.y+pad.height*.5,radiusX:3,radiusY:3,force:1})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger(1,.4)]})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger(1,.4),finger(2,.6)]})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[finger(1,.25),finger(2,.75)]})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    assert.ok(Number(await page.locator('#signature-pad').getAttribute('data-zoom'))>1,'two fingers zoom the signature writing surface')
    await stroke('#signature-pad',[[.1,.65],[.2,.2],[.25,.7],[.4,.35],[.5,.65],[.7,.5]])
    await stroke('#signature-pad',[[.15,.8],[.4,.75],[.7,.7]])
    await stroke('#signature-pad',[[.3,.3],[.5,.5]])
    assert.equal(await page.locator('#signature-pad').getAttribute('data-stroke-count'),'3')
    await page.locator('#signature-undo').tap()
    await page.waitForFunction(()=>document.getElementById('signature-pad').dataset.strokeCount==='2',{},{timeout:3000})
    await page.locator('#signature-insert').tap()
    const box=await page.locator('#ink-canvas').boundingBox()
    await page.touchscreen.tap(box.x+box.width*.2,box.y+box.height*.45)
    await page.locator('.signature-placement').getByRole('button', { name: 'Place', exact: true }).tap()
    await waitForAsync(page, async owner=>(await(await fetch('/api/state',{headers:{Authorization:'Bearer '+owner}})).json()).document.marks.length===3,host.owner)
    const marks=host.getDocument().marks
    assert.equal(marks[1].group,marks[2].group)
    const exported=await host.exportFile(host.getDocument().id)
    assert.equal((await PDFDocument.load(exported.bytes)).getPageCount(),1)
    await host.open('Signed.pdf',exported.bytes)
    await page.locator('#file-title').getByText('Signed.pdf',{exact:true}).waitFor()
    await page.waitForFunction(()=>document.querySelector('#pdf-canvas')?.width>0)
    // Verify the actual exported page paints ink, independent of editor overlays.
    const dark=await page.evaluate(async owner=>{
      const state=(await(await fetch('/api/state',{headers:{Authorization:'Bearer '+owner}})).json()).document
      const bytes=new Uint8Array(await(await fetch('/api/source/'+state.id,{headers:{Authorization:'Bearer '+owner}})).arrayBuffer())
      const pdfjs=await import('/pdfjs/legacy/build/pdf.mjs'),task=pdfjs.getDocument({data:bytes}),doc=await task.promise,sheet=await doc.getPage(1)
      const canvas=document.createElement('canvas'),viewport=sheet.getViewport({scale:1});canvas.width=viewport.width;canvas.height=viewport.height
      await sheet.render({canvas,viewport}).promise
      const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data
      let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<160&&pixels[i+1]<160&&pixels[i+2]<160)count++
      await task.destroy();return count
    },host.owner)
    assert.ok(dark>100,'exported PDF must paint the drawing and signature')
  } finally {await browser.close();await new Promise(resolve=>host.server.close(resolve))}
})
