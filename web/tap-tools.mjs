// A short tap selects the page and brings editing tools to the document.
// Dragging, pinching and active handwriting must never open this toolbar.
export function installTapTools(app){
  const stage=document.getElementById('stage'),bar=document.createElement('nav')
  bar.id='page-tap-tools';bar.hidden=true;bar.setAttribute('aria-label','Selected page tools')
  document.body.append(bar)
  let down,selected,selectedDocument
  const close=()=>{bar.hidden=true;selected?.classList.remove('tap-selected-page');selected=null;down=null}
  function button(label,run){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{close();Promise.resolve().then(run).catch(app.fail)};bar.append(b);return b}
  const text=button('Add text',()=>{
    if(app.get()?.extension==='pdf')app.setMode('text')
    else app.setMode('word')
  })
  const write=()=>{
    if(app.get()?.extension==='pdf')app.setMode('pen')
    else if(document.getElementById('word-draw').getAttribute('aria-pressed')!=='true')document.getElementById('word-draw').click()
    app.status('Write on the page. Use two fingers to move and zoom.')
  }
  button('Draw',write);button('Sign',write)
  button('Tools',()=>document.getElementById('document-extras').click())
  button('Close',close).setAttribute('aria-label','Hide page tools')
  const writing=()=>['pen','highlight','signature','text','erase','select','review'].includes(document.getElementById('pdf-sheet').dataset.mode)&&app.get()?.extension==='pdf'||document.getElementById('word-sheet').classList.contains('word-drawing')||stage.classList.contains('suite-drawing-active')
  stage.addEventListener('pointerdown',event=>{
    down=null
    if(event.button!==0||writing()||stage.dataset.navigating==='true'||document.querySelector('dialog[open]'))return
    if(event.target.closest('button,input,textarea,select,[contenteditable="plaintext-only"],[contenteditable="true"],.word-saved-ink,.textLayer span'))return
    const page=event.target.closest('#pdf-sheet,section.docx')
    if(page)down={id:event.pointerId,x:event.clientX,y:event.clientY,page,document:app.get()?.id}
  })
  stage.addEventListener('pointermove',event=>{if(down&&Math.hypot(event.clientX-down.x,event.clientY-down.y)>8)down=null})
  stage.addEventListener('pointerup',event=>{
    const tap=down;down=null
    if(!tap||tap.id!==event.pointerId||writing()||stage.dataset.navigating==='true'||tap.document!==app.get()?.id)return
    close();selected=tap.page;selectedDocument=tap.document;selected.classList.add('tap-selected-page')
    text.textContent=app.get()?.extension==='pdf'?'Add text':'Edit text'
    bar.hidden=false
  })
  stage.addEventListener('pointercancel',close)
  stage.addEventListener('document-navigation-start',close)
  stage.addEventListener('scroll',close,{passive:true})
  document.addEventListener('pointerdown',event=>{if(!stage.contains(event.target)&&!bar.contains(event.target))close()},true)
  document.addEventListener('keydown',event=>{if(event.key==='Escape')close()})
  new MutationObserver(()=>{if(selected&&(!selected.isConnected||selectedDocument!==app.get()?.id))close()}).observe(stage,{childList:true,subtree:true})
}
