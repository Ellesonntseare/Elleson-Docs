import {inkPng} from './ink-vectors.mjs'
export function installWordInkEditor({sheet,get,request,editId,pending,refresh,fail}) {
  const dialog=document.createElement('dialog')
  dialog.id='word-ink-editor'
  dialog.innerHTML=`<form><h2>Edit drawing</h2>
    <label>Left <input name="x" type="number" min="0" step="any" required></label>
    <label>Top <input name="y" type="number" min="0" step="any" required></label>
    <label>Size (%) <input name="scale" type="number" min="5" max="1000" step="any" value="100" required></label>
    <fieldset data-vector hidden><legend>Stroke appearance</legend><label>Colour <input name="color" type="color"></label><label>Pen size <input name="width" type="number" min="0.5" max="100" step="0.5"></label></fieldset><p role="status"></p>
    <div class="actions"><button type="submit" class="primary">Apply</button><button type="button" data-delete>Delete drawing</button><button type="button" data-close>Cancel</button></div>
  </form>`
  document.body.append(dialog)
  const form=dialog.querySelector('form')
  const fields=form.elements
  const status=dialog.querySelector('[role=status]')
  let selection,busy=false

  function open(image){
    if(busy||dialog.open||!image?.isConnected)return
    const page=image.closest('section.docx'),doc=get()
    if(!page||!doc?.lines)return
    const bounds={
      x:parseFloat(image.style.left),y:parseFloat(image.style.top),
      width:parseFloat(image.style.width),height:parseFloat(image.style.height)
    }
    if(!Object.values(bounds).every(Number.isFinite))return
    const paragraphY=image.dataset.inkParagraphY===undefined?undefined:Number(image.dataset.inkParagraphY)
    const ink=image.dataset.inkVectors?JSON.parse(image.dataset.inkVectors):null;form.querySelector('[data-vector]').hidden=!ink;fields.color.value=ink?.strokes[0]?.color||'#093352';fields.width.value=ink?.strokes[0]?.width||2;
    selection={ink,id:doc.id,version:doc.contentVersion,target:image.dataset.inkTarget,bounds,paragraphY,pageWidth:page.offsetWidth,pageHeight:page.offsetHeight}
    fields.x.value=String(Math.round(bounds.x*100)/100)
    fields.y.value=String(Math.max(0,Math.round(bounds.y*100)/100))
    fields.scale.value='100'
    status.textContent=''
    dialog.showModal()
  }

  async function commit(erase){
    if(busy||!selection)return
    const {id,version,target,bounds,paragraphY,pageWidth,pageHeight}=selection
    const x=fields.x.valueAsNumber,y=fields.y.valueAsNumber,scale=fields.scale.valueAsNumber/100
    const position={x,y,width:bounds.width*scale,height:bounds.height*scale}
    if(paragraphY!==undefined)position.paragraphY=paragraphY+y-bounds.y
    if(!erase&&(x+position.width>pageWidth+.01||y+position.height>pageHeight+.01)){
      status.textContent='Move or resize the drawing to fit on the page.'
      return
    }
    busy=true
    for(const button of form.querySelectorAll('button'))button.disabled=true
    try{
      await pending()
      if(get()?.id!==id||get().contentVersion!==version)throw Error('The document changed. Close this panel and select the drawing again.')
      if(!erase&&selection.ink){position.ink={...selection.ink,strokes:selection.ink.strokes.map(stroke=>({...stroke,color:fields.color.value!==selection.ink.strokes[0].color?fields.color.value:stroke.color,width:fields.width.valueAsNumber!==selection.ink.strokes[0].width?fields.width.valueAsNumber:stroke.width}))}}
      const response=await request('/api/'+(erase?'word-erase':selection.ink?'word-ink-batch':'word-ink-edit')+'/'+id,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(!erase&&selection.ink?{id:editId(),version,action:'apply',items:[{target,position,png:inkPng(position.ink)}]}:{id:editId(),version,target,position:erase?undefined:position})
      })
      const updated=await response.json()
      dialog.close()
      await refresh(updated)
    }catch(error){if(dialog.open)status.textContent=error.message;else fail(error)}
    finally{
      busy=false
      for(const button of form.querySelectorAll('button'))button.disabled=false
    }
  }
  form.onsubmit=event=>{event.preventDefault();void commit(false)}
  dialog.querySelector('[data-delete]').onclick=()=>void commit(true)
  dialog.querySelector('[data-close]').onclick=()=>dialog.close()
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault()})
  let tap
  sheet.addEventListener('pointerdown',event=>{
    const image=event.target.closest('.word-saved-ink')
    if(image&&event.isPrimary&&event.button===0)tap={image,id:event.pointerId,x:event.clientX,y:event.clientY}
    else tap=null
  })
  sheet.addEventListener('pointercancel',()=>{tap=null})
  sheet.addEventListener('pointerup',event=>{
    const target=tap
    tap=null
    if(target?.id===event.pointerId&&Math.hypot(event.clientX-target.x,event.clientY-target.y)<8)open(target.image)
  })
  sheet.addEventListener('click',event=>{
    const image=event.target.closest('.word-saved-ink')
    if(image)open(image)
  })
  sheet.addEventListener('keydown',event=>{
    const image=event.target.closest('.word-saved-ink')
    if(image&&(event.key==='Enter'||event.key===' ')){event.preventDefault();open(image)}
  })
  return {open}
}
