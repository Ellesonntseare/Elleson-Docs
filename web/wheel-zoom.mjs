export function installWheelZoom({stage,sheet,isActive,getZoom,setZoom,render,fail,anchorAt}) {
  let gesture, frame=0, timer, committing=false
  function paint(){
    frame=0
    if(!gesture)return
    const {ratio,dx,dy,cssZoom}=gesture
    sheet.style.transform=`translate(${dx/cssZoom}px,${dy/cssZoom}px) scale(${ratio})`
  }
  async function finish(){
    const state=gesture
    gesture=null
    committing=true
    if(frame){cancelAnimationFrame(frame);frame=0}
    try{
      if(!state||!isActive())return
      setZoom(state.zoom*state.ratio)
      await render()
      if(!isActive())return
      sheet.style.transform=''
      const target=state.anchor?.find()||sheet
      const bounds=target.getBoundingClientRect()
      stage.scrollLeft+=bounds.left+bounds.width*state.x-state.cursorX
      stage.scrollTop+=bounds.top+bounds.height*state.y-state.cursorY
    }catch(error){fail?.(error)}
    finally{
      committing=false
      sheet.style.transform=''
      sheet.style.transformOrigin=''
      sheet.style.willChange=''
      delete stage.dataset.navigating
    }
  }
  stage.addEventListener('wheel',event=>{
    if(window.EllesonAndroid||!isActive()||!event.ctrlKey||event.shiftKey||event.altKey||!event.deltaY)return
    if(!event.target.closest('.stage')||event.target.closest('select,input,textarea,button'))return
    if(!gesture&&!committing&&stage.dataset.navigating==='true')return
    event.preventDefault()
    if(committing)return
    if(!gesture){
      const bounds=sheet.getBoundingClientRect()
      if(!bounds.width||!bounds.height)return
      gesture={bounds,cssZoom:sheet.currentCSSZoom||1,ratio:1,dx:0,dy:0,zoom:getZoom()}
      stage.dataset.navigating='true'
      sheet.style.transformOrigin='0 0'
      sheet.style.willChange='transform'
    }
    const state=gesture
    const multiplier=event.deltaMode===1?16:event.deltaMode===2?stage.clientHeight:1
    const factor=Math.exp(Math.max(-.24,Math.min(.24,-event.deltaY*multiplier*.002)))
    const ratio=state.ratio*factor,magnification=state.zoom*ratio
    if(!Number.isFinite(magnification)||magnification<=0){clearTimeout(timer);timer=setTimeout(()=>void finish(),110);return}
    const localX=(event.clientX-state.bounds.left-state.dx)/state.ratio
    const localY=(event.clientY-state.bounds.top-state.dy)/state.ratio
    state.anchor=anchorAt?.(localY,state.ratio)
    if(state.anchor){
      state.x=(localX-state.anchor.left)/state.anchor.width
      state.y=(localY-state.anchor.top)/state.anchor.height
    }else{
      state.x=localX/state.bounds.width
      state.y=localY/state.bounds.height
    }
    state.cursorX=event.clientX
    state.cursorY=event.clientY
    state.dx=event.clientX-state.bounds.left-localX*ratio
    state.dy=event.clientY-state.bounds.top-localY*ratio
    state.ratio=ratio
    if(!frame)frame=requestAnimationFrame(paint)
    clearTimeout(timer)
    timer=setTimeout(()=>void finish(),110)
  },{passive:false})
}
