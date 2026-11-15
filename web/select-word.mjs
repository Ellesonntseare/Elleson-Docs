export function selectTappedWord(element,event){
  if(event.detail>1||element.contentEditable==='false')return
  const selection=getSelection()
  if(selection&&!selection.isCollapsed&&element.contains(selection.anchorNode))return
  const caret=document.caretPositionFromPoint?.(event.clientX,event.clientY)
  const range=caret?null:document.caretRangeFromPoint?.(event.clientX,event.clientY)
  const node=caret?.offsetNode||range?.startContainer,offset=caret?.offset??range?.startOffset
  if(!node||node.nodeType!==Node.TEXT_NODE||!element.contains(node))return
  const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),nodes=[]
  let text='',child
  while(child=walker.nextNode()){nodes.push({node:child,offset:text.length});text+=child.textContent}
  const position=nodes.find(item=>item.node===node).offset+offset
  const segments=[...new Intl.Segmenter(undefined,{granularity:'word'}).segment(text)]
  const word=segments.find(s=>s.isWordLike&&position>=s.index&&position<s.index+s.segment.length)||segments.find(s=>s.isWordLike&&position===s.index+s.segment.length)
  if(!word)return
  const locate=index=>{
    const item=nodes.findLast(item=>item.offset<=index)
    return [item.node,index-item.offset]
  }
  selection.setBaseAndExtent(...locate(word.index),...locate(word.index+word.segment.length))
}
export function installSelectionTools(stage){
  const controls=document.createElement('div')
  controls.className='selection-tools'
  controls.hidden=true
  controls.innerHTML='<button type="button">Copy</button><button type="button">Select paragraph</button><button type="button">Deselect</button>'
  document.body.append(controls)
  const [copy,select,clear]=controls.children
  const handles=['start','end'].map(edge=>{
    const handle=document.createElement('button')
    handle.className='selection-handle'
    handle.setAttribute('aria-label','Drag selection '+edge)
    handle.hidden=true
    document.body.append(handle)
    handle.onpointerdown=event=>{event.preventDefault();handle.setPointerCapture(event.pointerId)}
    handle.onpointermove=event=>{
      if(!handle.hasPointerCapture(event.pointerId)||!paragraph)return
      const caret=document.caretPositionFromPoint?.(event.clientX,event.clientY-14)
      const range=caret?null:document.caretRangeFromPoint?.(event.clientX,event.clientY-14)
      const node=caret?.offsetNode||range?.startContainer,offset=caret?.offset??range?.startOffset
      if(!node||!paragraph.contains(node))return
      const selection=getSelection(),existing=selection.getRangeAt(0)
      if(edge==='start')selection.setBaseAndExtent(existing.endContainer,existing.endOffset,node,offset)
      else selection.setBaseAndExtent(existing.startContainer,existing.startOffset,node,offset)
    }
    return handle
  })
  let paragraph,frame=0
  function update(){
    frame=0
    const selection=getSelection(),node=selection?.anchorNode
    paragraph=(node?.nodeType===1?node:node?.parentElement)?.closest('[data-word-index]')
    controls.hidden=!paragraph||selection.isCollapsed||!matchMedia('(pointer:coarse)').matches
    for(const handle of handles)handle.hidden=true
    if(controls.hidden)return
    const rect=selection.getRangeAt(0).getBoundingClientRect(),bounds=stage.getBoundingClientRect()
    if(rect.bottom<bounds.top||rect.top>bounds.bottom){controls.hidden=true;return}
    const rects=selection.getRangeAt(0).getClientRects()
    if(rects.length){
      const start=rects[0],end=rects[rects.length-1]
      for(const [i,handle] of handles.entries()){
        const r=i?end:start
        if(r.bottom<bounds.top||r.bottom>bounds.bottom)continue
        handle.hidden=false
        handle.style.left=(i?r.right:r.left)+'px'
        handle.style.top=r.bottom+'px'
      }
    }
    controls.style.top=Math.max(bounds.top,rect.top-48)+'px'
    controls.style.left=Math.max(4,Math.min(innerWidth-controls.offsetWidth-4,rect.left))+'px'
  }
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(update)}
  document.addEventListener('selectionchange',schedule)
  stage.addEventListener('scroll',schedule,{passive:true})
  controls.addEventListener('pointerdown',event=>event.preventDefault())
  copy.onclick=async()=>{
    const value=getSelection()?.toString()
    if(!value)return
    try{await navigator.clipboard.writeText(value)}catch{document.execCommand('copy')}
  }
  select.onclick=()=>{if(paragraph)getSelection().selectAllChildren(paragraph)}
  clear.onclick=()=>getSelection().collapseToEnd()
}
