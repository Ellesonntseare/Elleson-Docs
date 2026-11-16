import {installWordInkEditor} from './word-ink-editor.mjs'
import {drawingSettings,appendPoint} from './drawing-settings.mjs'
import {createInkStream} from './live-ink.mjs'
import {strokePath,pointerSamples,incrementalStroke,createStrokeTip} from './smooth-ink.mjs'
export function installWordInk({sheet,toolbar,get,request,editId,status,fail,pending,refresh,sizing,undoSaved}) {
  const editor=installWordInkEditor({sheet,get,request,editId,pending:async()=>{await pending();if(savePromise)await savePromise},refresh,fail})
  const streamInk=createInkStream(request),remoteRecords=new Map(),commits=new Map()
  let attachedVersion=-1
  const key='elleson-word-ink-v1'
  let records=[]
  try {records=JSON.parse(localStorage.getItem(key)||'[]');for(const record of records)delete record.sending} catch {}
  let inkFrame, journalAt=0, pageObserver, remoteKey=''
  let active=false,saving=false,source,gesture,completed=[],commitTimer,savePromise
  const button=(id,text,action)=>{const b=document.createElement('button');b.id=id;b.textContent=text;b.onclick=action;toolbar.append(b);return b}
  const persist=()=>{try{localStorage.setItem(key,JSON.stringify(records))}catch{status('Drawing recovery storage is full. Keep this window open and save the drawing.')}}
  const draw=button('word-draw','Draw / sign',async()=>{try{await pending();active=!active;update();status(active?'Draw or sign on the Word page. Completed strokes sync automatically. Use two fingers to zoom.':'Drawing paused. You can scroll the document.')}catch(error){fail(error)}})
  const done=button('word-ink-save','Save drawing',()=>void save().catch(fail))
  const undo=button('word-ink-undo','Undo stroke',async()=>{try{const item=records.findLast(r=>r.document===source?.id&&!r.sending&&r.strokes.length);if(item){item.strokes.pop();persist();paintAll();update();stream(item)}else if(!saving){active=false;await undoSaved();await refresh()}}catch(error){fail(error)}})
  button('word-zoom-out','Zoom out',()=>sizing.zoom(1/1.25))
  button('word-fit','Fit width',()=>sizing.reset())
  button('word-zoom-in','Zoom in',()=>sizing.zoom(1.25))
  const update=()=>{sheet.classList.toggle('word-drawing',active);draw.setAttribute('aria-pressed',String(active));done.disabled=saving||!records.some(r=>r.document===source?.id&&r.strokes.length);undo.disabled=saving||(!get()?.canUndo&&!records.some(r=>r.document===source?.id&&r.strokes.length));draw.disabled=!sheet.querySelector('section.docx');for(const p of sheet.querySelectorAll('[data-word-index]'))p.contentEditable=!active&&p.dataset.wordCanEdit==='true'?'plaintext-only':'false'}
  const paint=(canvas)=>{const context=canvas.getContext('2d'),page=Number(canvas.dataset.inkPage);context.clearRect(0,0,canvas.width,canvas.height);context.lineCap=context.lineJoin='round';const own=[...completed,...records].filter(r=>r.document===source?.id&&r.page===page).flatMap(r=>r.strokes);const incoming=[...remoteRecords.values()].filter(r=>r.document===source?.id&&r.page===page).flatMap(r=>r.strokes);for(const stroke of [...own,...incoming]){context.strokeStyle=/^#[a-f0-9]{6}$/i.test(stroke.color)?stroke.color:'#093352';context.lineWidth=stroke.width*2;strokePath(context,stroke.points.map(([x,y])=>[x*2,y*2]))}}
  const paintAll=()=>sheet.querySelectorAll('.word-ink-layer').forEach(canvas=>{if(canvas.width>1)paint(canvas)})
  function prepareCanvas(canvas){
    const page=canvas.parentElement
    if(canvas.width>1||!page?.offsetWidth)return
    canvas.width=page.offsetWidth*2
    canvas.height=page.offsetHeight*2
    paint(canvas)
  }
  const stream=record=>{if(record)streamInk(record.document,{kind:'word-ink',document:record.document,id:record.operation,page:record.page,index:record.index,width:record.width,height:record.height,version:record.version,strokes:record.strokes})}
  setInterval(()=>{if(gesture)stream(gesture.record)},800)
  const schedule=()=>{clearTimeout(commitTimer);commitTimer=setTimeout(()=>{if(gesture){schedule();return}void save(true).catch(fail)},240)}
  const finish=()=>{gesture?.tip.clear();const record=gesture?.record;gesture=null;persist();paintAll();update();if(record?.strokes.length){stream(record);schedule()}}
  function save(background=false){if(savePromise)return savePromise;let succeeded=false;savePromise=commit(background).then(result=>{succeeded=true;return result}).finally(()=>{savePromise=undefined;if(succeeded&&records.some(r=>r.document===source?.id&&r.strokes.length))schedule()});return savePromise}
  async function commit(background){
    clearTimeout(commitTimer);if(gesture){schedule();return}
    await pending();saving=true;update()
    try {
      for(const record of [...records].filter(r=>r.document===source.id&&!r.sending&&r.strokes.length)){
        if(record.version!==get().contentVersion)throw Error('This Word document changed after drawing began. The drawing is retained on this device. Reopen the same version before saving it.')
        record.sending=true;record.operation ||= editId();persist()
        const all=record.strokes.flatMap(s=>s.points),xs=all.map(p=>p[0]),ys=all.map(p=>p[1]);const padding=Math.max(...record.strokes.map(s=>s.width))/2+2,x=Math.max(0,Math.floor(Math.min(...xs)-padding)),y=Math.max(0,Math.floor(Math.min(...ys)-padding)),width=Math.min(record.width-x,Math.ceil(Math.max(...xs)-x+padding)),height=Math.min(record.height-y,Math.ceil(Math.max(...ys)-y+padding))
        const scale=Math.min(4,4096/Math.max(width,height));const canvas=document.createElement('canvas');canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale)
        const context=canvas.getContext('2d');context.lineCap=context.lineJoin='round'
        for(const stroke of record.strokes){context.strokeStyle=stroke.color;context.lineWidth=stroke.width*scale;strokePath(context,stroke.points.map(([px,py])=>[(px-x)*scale,(py-y)*scale]))}
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))
        if(!blob)throw Error('Could not prepare the drawing. Its strokes are retained.')
        record.operation ||= editId();persist()
        const response=await request('/api/word-image/'+record.document,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Operation-Id':record.operation,'X-Document-Version':String(record.version),'X-Paragraph-Index':String(record.index),'X-Word-Ink':JSON.stringify({x,y,width,height,paragraphY:Number.isFinite(record.anchorY)?y-record.anchorY:undefined})},body:blob})
        const updated=await response.json();records=records.filter(r=>r!==record);completed.push(record)
        // Our own image insertion changes bytes, but leaves paragraph identities intact.
        for(const remaining of records)if(remaining.document===updated.id&&remaining.version===record.version)remaining.version=updated.contentVersion
        source=updated;persist();await refresh(updated,background&&active)
      }
      if(!background){active=false;await refresh()}status('Drawing synced into the Word document. Save updates the external file.')
    }finally{saving=false;for(const record of records)delete record.sending;persist();update()}
  }
  return {get drawing(){return Boolean(gesture)},async undoPending(){
    if(gesture){const record=gesture.record;record.strokes.pop();gesture.tip.clear();gesture=null;persist();paintAll();update();stream(record);return true}
    const item=records.findLast(r=>r.document===source?.id&&!r.sending&&r.strokes.length)
    if(item){item.strokes.pop();persist();paintAll();update();stream(item);return true}
    if(savePromise)await savePromise
    return false
  },preview(value,inkCommits){
    for(const [id,version] of Object.entries(inkCommits||{}))commits.set(id,version)
    let changed=false
    for(const [id,record] of remoteRecords)if((commits.get(id)??Infinity)<=attachedVersion||Date.now()-record.received>15000){remoteRecords.delete(id);changed=true}
    const next=value?.kind==='word-ink'?value:null,key=JSON.stringify(next)
    if(next){if(next.strokes.length&&(commits.get(next.id)??Infinity)>attachedVersion)remoteRecords.set(next.id,{...next,received:Date.now()});else remoteRecords.delete(next.id)}
    if(key!==remoteKey||changed){remoteKey=key;if(!gesture)paintAll()}
  },pending:async()=>{await save(true);if(records.some(r=>r.document===source?.id&&r.strokes.length))await save(true)},cancelStroke(){if(gesture){const record=gesture.record;record.strokes=record.strokes.filter(stroke=>stroke!==gesture.stroke);gesture.tip.clear();gesture=null;persist();paintAll();update();stream(record)}},attach(document){
    if(source?.id!==document.id){active=false;remoteRecords.clear();commits.clear();remoteKey=''}
    attachedVersion=document.contentVersion
    for(const id of remoteRecords.keys())if((commits.get(id)??Infinity)<=attachedVersion)remoteRecords.delete(id)
    source=document;completed=[]
    pageObserver?.disconnect()
    const stage=sheet.closest('#stage')
    pageObserver=new IntersectionObserver(entries=>{
      for(const entry of entries){
        const canvas=entry.target
        if(!canvas.isConnected)continue
        if(entry.isIntersecting)prepareCanvas(canvas)
        else if(!gesture||gesture.record.page!==Number(canvas.dataset.inkPage)){canvas.width=1;canvas.height=1}
      }
    },{root:stage,rootMargin:'500px'})
    for(const [pageIndex,page] of [...sheet.querySelectorAll('section.docx')].entries()){
      const anchor=page.querySelector('[data-word-source-index]')
      if(!anchor)continue
      const canvas=window.document.createElement('canvas');canvas.className='word-ink-layer';canvas.dataset.inkPage=pageIndex;canvas.setAttribute('aria-label','Draw on Word page '+(pageIndex+1));canvas.width=1;canvas.height=1;page.append(canvas);pageObserver.observe(canvas)
      const tip=createStrokeTip(canvas)
      const paintTip=()=>{if(gesture)tip.paint(gesture.stroke.points,gesture.stroke.width*2,gesture.stroke.color,1,([x,y])=>[x*2,y*2])}
      let strokeRect
      const point=event=>{const rect=strokeRect||canvas.getBoundingClientRect();return [Math.max(0,Math.min(page.offsetWidth,(event.clientX-rect.left)*page.offsetWidth/rect.width)),Math.max(0,Math.min(page.offsetHeight,(event.clientY-rect.top)*page.offsetHeight/rect.height))]}
      canvas.onpointerdown=event=>{if(!active||stage.dataset.navigating==='true'||event.button!==0||event.pointerType==='touch'&&(drawingSettings.stylusOnly||event.width>48||event.height>48))return;prepareCanvas(canvas);if(drawingSettings.eraser){
        strokeRect=canvas.getBoundingClientRect();const [x,y]=point(event)
        const record=records.findLast(r=>r.document===source.id&&r.page===pageIndex&&!r.sending&&r.strokes.some(s=>s.points.some(p=>Math.hypot(p[0]-x,p[1]-y)<12)))
        if(record){const index=record.strokes.findLast(s=>s.points.some(p=>Math.hypot(p[0]-x,p[1]-y)<12));record.strokes.splice(index,1);persist();paintAll();stream(record);return}
        const image=[...page.querySelectorAll('.word-saved-ink')].findLast(img=>{const r=img.getBoundingClientRect();return event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom})
        if(image)void pending().then(()=>request('/api/word-erase/'+source.id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:editId(),version:get().contentVersion,target:image.dataset.inkTarget})})).then(r=>r.json()).then(updated=>refresh(updated,false)).catch(fail)
        return;
      }if(gesture){finish();return}clearTimeout(commitTimer);strokeRect=canvas.getBoundingClientRect();canvas.setPointerCapture(event.pointerId);const nearest=[...page.querySelectorAll('[data-word-source-index]')].reduce((best,p)=>Math.abs(p.getBoundingClientRect().top-event.clientY)<Math.abs(best.getBoundingClientRect().top-event.clientY)?p:best,anchor);const record={document:source.id,version:source.contentVersion,page:pageIndex,index:Number(nearest.dataset.wordSourceIndex),width:page.offsetWidth,height:page.offsetHeight,operation:editId(),anchorY:drawingSettings.anchor==='paragraph'?(nearest.getBoundingClientRect().top-strokeRect.top)*page.offsetHeight/strokeRect.height:undefined,strokes:[]};records.push(record);const stroke={color:window.document.getElementById('ink-color').value,width:Number(window.document.getElementById('ink-width').value)||2,points:[point(event)]};record.strokes.push(stroke);gesture={record,stroke,painted:1,tip,pointer:event.pointerId};paintTip();stream(record);persist();update()}
      canvas.onpointermove=event=>{if(!gesture||!canvas.hasPointerCapture(event.pointerId))return;for(const sample of pointerSamples(event)){if(gesture.stroke.points.length>=3000)break;appendPoint(gesture.stroke.points,point(sample))}if(!inkFrame)inkFrame=requestAnimationFrame(()=>{inkFrame=null;if(!gesture)return;const ctx=canvas.getContext('2d');ctx.lineCap=ctx.lineJoin='round';ctx.strokeStyle=gesture.stroke.color;ctx.lineWidth=gesture.stroke.width*2;gesture.painted=incrementalStroke(ctx,gesture.stroke.points,gesture.painted,false,([x,y])=>[x*2,y*2])});if(Date.now()-journalAt>150){journalAt=Date.now();persist()}paintTip();stream(gesture.record)}
      canvas.onpointerup=event=>{
        if(!gesture||gesture.pointer!==event.pointerId)return
        const tap=gesture.stroke.points.length===1
        if(!tap)appendPoint(gesture.stroke.points,point(event))
        if(!tap){finish();return}
        const image=[...page.querySelectorAll('.word-saved-ink')].findLast(item=>{
          const rect=item.getBoundingClientRect()
          return event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom
        })
        if(image){gesture.record.strokes.pop();editor.open(image)}
        finish()
      }
      canvas.onpointercancel=()=>{if(gesture){gesture.record.strokes.pop();stream(gesture.record);finish()}}
    }
    update()
  }}
}
