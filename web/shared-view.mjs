// Share document coordinates, never device pixels. Remote movement must not echo.
export function installSharedView({stage,get,request,editId,pages,getPage,getZoom,setView,getReading=()=>false,isDrawing=()=>false}) {
  const client=editId()
  let pending=null,seen=0,applying=false,suppress=0,activeUntil=0,last='',sending=false
  const enabled=()=>location.hostname!=='appassets.androidplatform.net' && get()
  const intent=()=>{if(!applying){pending=null;activeUntil=Date.now()+1200;suppress=0}}
  stage.addEventListener('wheel',intent,{passive:true})
  document.addEventListener('pointerdown',intent,true)
  document.addEventListener('pointerup',intent,true)
  document.addEventListener('keydown',intent,true)
  document.addEventListener('input',intent,true)
  stage.addEventListener('scroll',()=>{if(!applying&&Date.now()>suppress)activeUntil=Date.now()+400},{passive:true})
  function capture(){
    const list=pages().filter(p=>!p.hidden&&p.getBoundingClientRect().width>0)
    if(!list.length)return null
    const bounds=stage.getBoundingClientRect(),cx=bounds.left+stage.clientWidth/2,cy=bounds.top+stage.clientHeight/2
    let index=0,distance=Infinity
    list.forEach((p,i)=>{const r=p.getBoundingClientRect(),d=Math.max(r.top-cy,cy-r.bottom,0);if(d<distance){distance=d;index=i}})
    const r=list[index].getBoundingClientRect(),clamp=v=>Math.max(0,Math.min(1,v))
    return {document:get().id,page:get().extension==='pdf'&&!getReading()?getPage():index+1,x:clamp((cx-r.left)/r.width),y:clamp((cy-r.top)/r.height),zoom:getZoom(),reading:getReading(),color:document.getElementById('ink-color').value,thickness:Number(document.getElementById('ink-width').value)}
  }
  async function tick(){
    if(!enabled()||applying||isDrawing()||stage.dataset.navigating==='true')return
    if(pending&&pending.document===get().id&&Date.now()>activeUntil){
      const value=pending
      applying=true
      try{
        if(!await setView(value))return
        for(const [id,v] of [['ink-color',value.color],['ink-width',value.thickness]])if(v!==undefined){const control=document.getElementById(id);control.value=String(v);control.dispatchEvent(new Event('input',{bubbles:true}))}
        if(get()?.id!==value.document)return
        const list=pages(),target=list[get().extension==='pdf'&&!getReading()?0:value.page-1]
        if(!target)return
        const r=target.getBoundingClientRect(),b=stage.getBoundingClientRect()
        stage.scrollLeft+=r.left+r.width*value.x-b.left-stage.clientWidth/2
        stage.scrollTop+=r.top+r.height*value.y-b.top-stage.clientHeight/2
        if(pending===value)pending=null;suppress=Date.now()+300;activeUntil=0;last=JSON.stringify(capture())
      }finally{applying=false}
      return
    }
    if(sending||Date.now()<suppress||Date.now()>activeUntil)return
    const value=capture(),key=JSON.stringify(value)
    if(!value||key===last)return
    sending=true
    try{await request('/api/view/'+value.document,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...value,client})});last=key}catch{}finally{sending=false}
  }
  setInterval(()=>void tick().catch(()=>{}),80)
  return {receive(value){if(!value){pending=null;seen=0;return}if(value.sequence<=seen)return;seen=value.sequence;if(value.client===client){pending=null;return}if(Date.now()>activeUntil)pending=value}}
}
