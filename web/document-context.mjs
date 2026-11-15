export function installDocumentContext({get,go,closeTab,tools}) {
  const byId=id=>document.getElementById(id)
  const menu=document.createElement('div')
  menu.className='document-context-menu'
  menu.setAttribute('role','menu')
  menu.setAttribute('aria-label','Document actions')
  menu.hidden=true
  document.body.append(menu)
  let restoreFocus,selectedText=''
  const close=(restore=false)=>{
    if(menu.hidden)return
    menu.hidden=true
    if(restore&&restoreFocus?.isConnected)restoreFocus.focus({preventScroll:true})
  }
  function action(label,run,disabled=false){
    const button=document.createElement('button')
    button.type='button'
    button.textContent=label
    button.setAttribute('role','menuitem')
    button.disabled=disabled
    button.onclick=()=>{close();run()}
    menu.append(button)
  }
  function control(id,label){
    const target=byId(id)
    if(target)action(label,()=>target.click(),target.disabled)
  }
  function separator(){
    const line=document.createElement('hr')
    line.setAttribute('role','separator')
    menu.append(line)
  }
  function show(event,source){
    event.preventDefault()
    restoreFocus=document.activeElement
    const dialog=event.target.closest('dialog[open]')
    ;(dialog||document.body).append(menu)
    menu.hidden=false
    const bounds=menu.getBoundingClientRect()
    const anchor=source.getBoundingClientRect()
    const x=event.clientX||anchor.left,y=event.clientY||anchor.bottom
    menu.style.left=Math.max(6,Math.min(x,innerWidth-bounds.width-6))+'px'
    menu.style.top=Math.max(6,Math.min(y,innerHeight-bounds.height-6))+'px'
    menu.querySelector('button:not([disabled])')?.focus({preventScroll:true})
  }
  document.addEventListener('contextmenu',event=>{
    const source=event.target
    if(window.EllesonAndroid||!source.closest||source.closest('input, textarea, select, .document-context-menu'))return
    const libraryRow=source.closest('.library-row')
    const tab=source.closest('.document-tab')
    const doc=get()
    if(!libraryRow&&(!doc||!source.closest('#stage,#file-title,.document-tab')))return
    menu.replaceChildren()
    if(libraryRow){
      const [open,pin,versions]=libraryRow.querySelectorAll('button')
      for(const [label,item] of [['Open',open],[pin?.textContent,pin],['Saved versions',versions]]){
        if(item)action(label,()=>item.click(),item.disabled)
      }
    }else if(tab&&!tab.classList.contains('active')){
      action('Open tab',()=>tab.querySelector('.tab-name').click())
      action('Close tab',()=>tab.querySelector('button:last-child').click())
    }else{
      const image=source.closest('.word-saved-ink')
      const ink=source.closest('#pdf-sheet')&&tools.inkAt(event.clientX,event.clientY)
      if(image||ink){
        action('Edit drawing',()=>{
          if(image)image.click()
          else{tools.selectInk(ink);byId('selection-edit').click()}
        })
        separator()
      }
      selectedText=source.closest('#stage')?getSelection()?.toString():''
      if(selectedText){
        action('Copy selected text',()=>{navigator.clipboard?.writeText(selectedText).catch(()=>document.execCommand('copy'))??document.execCommand('copy')})
        separator()
      }
      control('save-original','Save')
      control('save-as','Save As…')
      control('save','Save a copy')
      control('rename-document','Rename')
      control('print','Print')
      separator()
      control('history-undo','Undo')
      control('history-redo','Redo')
      control('find','Find in document')
      if(doc.extension==='pdf'){
        action('Previous page',()=>go(Number(byId('page').value)-1),byId('prev').disabled)
        action('Next page',()=>go(Number(byId('page').value)+1),byId('next').disabled)
        control('fit','Fit page')
      }else control('word-fit','Fit width')
      if(doc.libraryId){separator();action('Close document',()=>closeTab(doc.libraryId))}
    }
    show(event,source)
  })
  document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target))close()},true)
  document.addEventListener('keydown',event=>{
    if(menu.hidden)return
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close(true);return}
    if(event.key==='Tab'){close(true);return}
    const keys=['ArrowDown','ArrowUp','Home','End']
    if(!keys.includes(event.key))return
    event.preventDefault()
    const items=[...menu.querySelectorAll('button:not([disabled])')]
    if(!items.length)return
    const index=items.indexOf(document.activeElement)
    const target=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length
    items[target]?.focus()
  },true)
  byId('stage').addEventListener('scroll',()=>close(),{passive:true})
  window.addEventListener('resize',()=>close())
}
