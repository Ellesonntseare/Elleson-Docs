import {drawingSettings} from './drawing-settings.mjs'
import {erasePath,inkPng} from './ink-vectors.mjs'
export function installPartialEraser(app){
 const stage=document.getElementById('stage'),ring=document.createElement('div');ring.id='eraser-cursor';ring.hidden=true;document.body.append(ring)
 let gesture,busy=false
 const enabled=()=>drawingSettings.eraserType==='partial'&&(drawingSettings.eraser||document.getElementById('pdf-sheet').dataset.mode==='erase')
 const cancel=()=>{gesture=null;ring.hidden=true}
 stage.addEventListener('document-navigation-start',cancel)
 stage.addEventListener('pointerdown',event=>{
  if(!enabled()||busy||!app.get()||event.button!==0||stage.dataset.navigating==='true')return
  const sheet=event.target.closest('#pdf-sheet,section.docx');if(!sheet)return
  event.preventDefault();event.stopImmediatePropagation();sheet.setPointerCapture(event.pointerId)
  const rect=sheet.getBoundingClientRect(),word=app.get().extension!=='pdf',view=app.viewport()
  const project=e=>word?[(e.clientX-rect.left)*sheet.offsetWidth/rect.width,(e.clientY-rect.top)*sheet.offsetHeight/rect.height]:view.convertToPdfPoint((e.clientX-rect.left)*view.width/rect.width,(e.clientY-rect.top)*view.height/rect.height)
  const radius=drawingSettings.eraserSize/2;gesture={id:event.pointerId,sheet,word,document:app.get().id,version:app.get().contentVersion,page:app.page(),path:[project(event)],project,radius,cssRadius:radius*(word?rect.width/sheet.offsetWidth:rect.width/view.width*view.scale)}
  show(event)
 },true)
 function show(event){if(!gesture)return;const r=gesture.cssRadius;Object.assign(ring.style,{left:event.clientX-r+'px',top:event.clientY-r+'px',width:r*2+'px',height:r*2+'px'});ring.hidden=false}
 stage.addEventListener('pointermove',event=>{if(gesture?.id!==event.pointerId)return;event.preventDefault();event.stopImmediatePropagation();if(gesture.path.length<2000)gesture.path.push(gesture.project(event));show(event)},true)
 stage.addEventListener('pointercancel',cancel,true)
 stage.addEventListener('pointerup',event=>{
  if(gesture?.id!==event.pointerId)return
  event.preventDefault();event.stopImmediatePropagation();const g=gesture;cancel();busy=true
  void commit(g).catch(app.fail).finally(()=>busy=false)
 },true)
 async function commit(g){
  await app.pending();const doc=app.get();if(doc?.id!==g.document||doc.contentVersion!==g.version)throw Error('The document changed. Try erasing again.')
  if(!g.word){
   const items=[]
   for(const mark of doc.marks.filter(m=>m.kind==='ink'&&m.page===g.page)){
    const fragments=erasePath(mark.points,g.path,g.radius+mark.width/2)
    if(JSON.stringify(fragments)!==JSON.stringify([mark.points]))items.push({target:mark.id,before:mark.points,fragments})
   }
   if(items.length)await app.edit({kind:'ink-cut',page:g.page,items})
  }else{
   const items=[],deleted=[];let legacy=false
   for(const image of g.sheet.querySelectorAll('.word-saved-ink')){
    const position={x:parseFloat(image.style.left),y:parseFloat(image.style.top),width:parseFloat(image.style.width),height:parseFloat(image.style.height)}
    const xs=g.path.map(p=>p[0]),ys=g.path.map(p=>p[1]);if(Math.max(...xs)<position.x-g.radius||Math.min(...xs)>position.x+position.width+g.radius||Math.max(...ys)<position.y-g.radius||Math.min(...ys)>position.y+position.height+g.radius)continue
    if(!image.dataset.inkVectors){legacy=true;continue}
    const ink=JSON.parse(image.dataset.inkVectors),path=g.path.map(([x,y])=>[(x-position.x)*ink.width/position.width,(y-position.y)*ink.height/position.height])
    const strokes=ink.strokes.flatMap(s=>erasePath(s.points,path,g.radius*ink.width/position.width+s.width/2).map(points=>({...s,points})))
    if(JSON.stringify(strokes)===JSON.stringify(ink.strokes))continue
    if(image.dataset.inkParagraphY!==undefined)position.paragraphY=Number(image.dataset.inkParagraphY)
    position.ink={...ink,strokes}
    if(!strokes.length)deleted.push({target:image.dataset.inkTarget,remove:true});else items.push({target:image.dataset.inkTarget,position,png:inkPng(position.ink)})
   }
   if(items.length||deleted.length)await app.request('/api/word-ink-batch/'+doc.id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:app.editId(),version:doc.contentVersion,action:'erase',items:[...items,...deleted]})})
   if(items.length||deleted.length)await app.refresh()
   if(legacy)app.status('Older Word drawings are flat images. Use whole-stroke erasing for those drawings.')
  }
 }
}
