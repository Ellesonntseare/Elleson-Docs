const {test}=require('node:test'),assert=require('node:assert/strict')
const {chromium}=require('playwright'),{PDFDocument}=require('pdf-lib'),{start}=require('../server.cjs')
const {clickTool}=require('./menu-helper.cjs')

test('preview sender coalesces slow requests without replaying stale positions',async()=>{
  const {createInkStream}=await import('../web/live-ink.mjs')
  const sent=[];let release
  const stream=createInkStream(async(url,options)=>{sent.push(JSON.parse(options.body));if(sent.length===1)await new Promise(r=>release=r)})
  stream('document',{points:[[0,0]]});await new Promise(r=>setTimeout(r,30))
  for(let i=1;i<=100;i++)stream('document',{points:[[i,i]]})
  assert.equal(sent.length,1);release();await new Promise(r=>setTimeout(r,30))
  assert.equal(sent.length,2);assert.deepEqual(sent[1].points,[[100,100]])
})

test('phone ink paints on PC before pen-up without polling, and keeps document coordinates after zoom',{timeout:60000},async()=>{
  const host=await start();let browser
  try{
    browser=await chromium.launch({channel:'msedge'})
    const pdf=await PDFDocument.create();pdf.addPage([400,600]);await host.open('Live signing.pdf',await pdf.save())
    const pc=await browser.newPage(),phone=await browser.newPage({viewport:{width:412,height:915},isMobile:true,hasTouch:true})
    const errors=[];for(const page of [pc,phone])page.on('pageerror',e=>errors.push(e.message))
    await pc.goto(host.address+'/#owner='+host.owner);await phone.goto(host.address)
    for(const page of [pc,phone])await page.getByText('PDF ready',{exact:true}).waitFor()
    await clickTool(phone,phone.locator('#suite-companion'))
    await phone.locator('#companion-workspace').getByRole('button',{name:'Sign on page',exact:true}).click()
    assert.equal(await phone.locator('#signature-dialog').isVisible(),false)
    await phone.waitForFunction(()=>document.querySelector('#pdf-sheet').dataset.mode==='pen')
    const cdp=await phone.context().newCDPSession(phone)
    const stage=await phone.locator('#stage').boundingBox(),cx=stage.x+stage.width/2,cy=stage.y+stage.height*.35
    const finger=(id,x,y)=>({id,x,y,radiusX:3,radiusY:3,force:1})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger(1,cx-30,cy)]})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger(1,cx-30,cy),finger(2,cx+30,cy)]})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[finger(1,cx-65,cy-15),finger(2,cx+65,cy-15)]})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    await phone.waitForFunction(()=>!document.querySelector('#stage').dataset.navigating)
    assert.equal(host.getDocument().marks.length,0,'pinching must not leave a dot or stroke')
    let pollingBlocked=true
    await pc.route('**/api/state?*',route=>pollingBlocked?route.abort():route.continue())
    const bounds=await phone.locator('#ink-canvas').boundingBox(),start=[cx-35,cy+25],end=[cx+45,cy+45]
    const expected=[(start[0]-bounds.x)*400/bounds.width,600-(start[1]-bounds.y)*600/bounds.height]
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger(1,...start)]})
    await phone.waitForFunction(()=>!document.querySelector('.live-ink-tip').hidden)
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[finger(1,...end)]})
    await pc.waitForFunction(()=>{const c=document.querySelector('#ink-canvas'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return p.some((v,i)=>i%4===3&&v>0)},{},{timeout:2500})
    assert.equal(host.getDocument().marks.length,0,'PC displays the stroke while the pen is still down')
    pollingBlocked=false
    await phone.waitForTimeout(2600)
    assert.ok(await pc.locator('#ink-canvas').evaluate(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)),'ink stays visible when the pen pauses longer than preview expiry')
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    await phone.waitForFunction(()=>document.querySelector('.live-ink-tip').hidden)
    pollingBlocked=false
    const deadline=Date.now()+4000
    while(!host.getDocument().marks.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20))
    const mark=host.getDocument().marks[0];assert.ok(mark)
    assert.ok(Math.abs(mark.points[0][0]-expected[0])<.1);assert.ok(Math.abs(mark.points[0][1]-expected[1])<.1)
    assert.equal(mark.width,2)
    const normalized=page=>page.evaluate(()=>{const c=document.querySelector('#ink-canvas'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let left=c.width,right=0,top=c.height,bottom=0;for(let i=3;i<p.length;i+=4)if(p[i]>100){const n=(i-3)/4,x=n%c.width,y=Math.floor(n/c.width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}return [left/c.width,top/c.height,right/c.width,bottom/c.height]})
    await phone.waitForTimeout(450)
    const a=await normalized(phone),b=await normalized(pc)
    for(let i=0;i<4;i++)assert.ok(Math.abs(a[i]-b[i])<.01,`ink bounds match: ${a} / ${b}`)
    assert.deepEqual(errors,[])
  }finally{await browser?.close();host.server.closeAllConnections();await new Promise(r=>host.server.close(r))}
})
