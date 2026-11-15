const paths = {
  read:'M12 7c-3-3-6-3-9-2v14c3-1 6-1 9 2 3-3 6-3 9-2V5c-3-1-6-1-9 2v14',
  edit:'M12 20h9M4 20l1-5L16 4l4 4-11 11zM14 6l4 4',
  draw:'m12 19 7-7-7-9-7 9 7 7Zm0 0v3m0-9v1',
  tools:'m14 7 3 3 4-4a6 6 0 0 1-8 8l-6 6a2 2 0 0 1-3-3l6-6a6 6 0 0 1 8-8z',
  sync:'M4 8a8 8 0 0 1 14-3l2 3m0-5v5h-5m5 8a8 8 0 0 1-14 3l-2-3m0 5v-5h5'
}
function button(label, run, glyph) {
  const control=document.createElement('button')
  control.type='button'
  if(glyph){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg')
    svg.setAttribute('viewBox','0 0 24 24')
    svg.setAttribute('aria-hidden','true')
    svg.classList.add('tool-icon')
    const path=document.createElementNS(svg.namespaceURI,'path')
    path.setAttribute('d',paths[glyph])
    svg.append(path)
    control.append(svg)
  }
  control.append(label)
  control.onclick=run
  return control
}
function group(className, ...children) {
  const section=document.createElement('div')
  section.className=className
  section.append(...children)
  return section
}

export function installMobileShell({get,stage,getPage,readingView}) {
  const $=id=>document.getElementById(id)
  if(window.desktopDocs)$('prototype-shell-style').media='all'
  const toolbar=$('toolbar')
  const menus=[...document.querySelectorAll('.tool-menu')]
  const menu=label=>menus.find(item=>item.firstElementChild.textContent===label)
  const panel=item=>item.querySelector('.tool-menu-panel')
  const file=menu('File'),more=menu('More'),drawing=menu('Drawing')
  file.classList.add('mobile-file-sheet')
  file.querySelector('summary path')?.setAttribute('d','M3 7h6l2 2h10l-3 11H3z M3 7V4h6l2 3')
  more.classList.add('mobile-more-sheet')
  drawing.classList.add('mobile-drawing-sheet')
  const backdrop=group('mobile-sheet-backdrop')
  backdrop.hidden=true
  document.body.append(backdrop)
  backdrop.onclick=()=>{for(const item of menus)item.open=false}
  for(const item of menus)item.addEventListener('toggle',()=>{
    const sheetOpen=menus.some(detail=>detail.open&&detail!==drawing)
    backdrop.hidden=!sheetOpen
    document.body.classList.toggle('mobile-sheet-open',sheetOpen)
  })

  const title=$('file-title')
  title.classList.add('mobile-document-title')
  title.setAttribute('role','button')
  title.tabIndex=0
  title.onclick=()=>{file.open=!file.open}
  title.onkeydown=event=>{
    if(event.key==='Enter'||event.key===' '){event.preventDefault();title.click()}
  }
  file.addEventListener('toggle',()=>title.setAttribute('aria-expanded',String(file.open)))
  const tabs=$('mobile-tabs')
  panel(file).prepend(group('mobile-open-files', 'Open documents', tabs))
  const open=button('Open file',()=>$('open').click())
  const save=button('Save',()=>$('save-original').click())
  open.className=save.className='mobile-only'
  const fileHeading=group('mobile-sheet-heading','Files',button('Close',()=>{file.open=false}))
  panel(file).prepend(fileHeading,open,save)
  panel(file).querySelector('.mobile-open-files').addEventListener('change',()=>{file.open=false})
  $('save').classList.add('mobile-save-card')
  const connection=group('mobile-sync-card')
  panel(more).prepend(group('mobile-sheet-heading','More',button('Close',()=>{more.open=false})),connection)
  const direct=group('mobile-quick-tools',
    button('Scan filters',()=>$('document-filters').click()),
    button('Focus reading',()=>$('document-focus').click()),
    button('Find in document',()=>$('find').click())
  )
  panel(more).append(direct)
  const allTools=button('All document controls',()=>document.body.classList.toggle('mobile-controls-open'))
  allTools.className='mobile-only'
  panel(more).append(allTools)

  const isPdf=()=>get()?.extension==='pdf'
  const mode=name=>$(isPdf()?'pdf-tools':'word-tools').querySelector('[data-mode="'+name+'"]')
  const wordDrawing=()=>$('word-draw').getAttribute('aria-pressed')==='true'
  const stopWordDrawing=()=>{if(wordDrawing())$('word-draw').click()}
  const read=button('Read',()=>{
    stopWordDrawing()
    mode('read').click()
    drawing.open=false
  },'read')
  const edit=button('Edit',()=>{
    stopWordDrawing()
    mode(isPdf()?'edit':'word').click()
    drawing.open=false
  },'edit')
  const draw=button('Draw',()=>{
    if(isPdf())mode('pen').click()
    else if(!wordDrawing())$('word-draw').click()
    drawing.open=true
  },'draw')
  const dock=group('mobile-mode-dock',read,edit,draw,button('Tools',()=>$('document-extras').click(),'tools'))
  dock.setAttribute('role','navigation')
  dock.setAttribute('aria-label','Document modes')
  toolbar.after(dock)

  const inkDone=button('Done',()=>{
    if(isPdf())$('drawing-done').click()
    else stopWordDrawing()
    drawing.open=false
  })
  inkDone.setAttribute('aria-label','Done drawing')
  panel(drawing).prepend(group('mobile-ink-actions',
    button('Undo stroke',()=>$('history-undo').click()),
    button('Pen settings',()=>panel(drawing).classList.toggle('ink-settings-expanded')),
    button('Eraser',()=>{const toggle=$('drawing-eraser');toggle.checked=!toggle.checked;toggle.dispatchEvent(new Event('input',{bubbles:true}))}),
    inkDone
  ))
  toolbar.append(group('mobile-edit-ribbon',
    button('Aa',()=>{const form=menu('Formatting');if(form)form.open=!form.open}),
    button('Undo',()=>$('history-undo').click()),
    button('Done',()=>document.activeElement?.blur())
  ))
  toolbar.querySelector('.mobile-edit-ribbon').addEventListener('pointerdown',event=>event.preventDefault())
  const focused=()=>document.body.classList.toggle('mobile-editing',Boolean(document.activeElement?.closest('#word-sheet [contenteditable="plaintext-only"]')))
  document.addEventListener('focusin',focused)
  document.addEventListener('focusout',()=>queueMicrotask(focused))
  window.visualViewport?.addEventListener('resize',()=>{
    const viewport=window.visualViewport
    document.body.style.setProperty('--keyboard-gap',Math.max(0,innerHeight-viewport.height-viewport.offsetTop)+'px')
  })
  const zoomPill=group('mobile-zoom-pill',
    button('-',() => $(isPdf()?'zoom-out':'word-zoom-out').click()),
    button('Fit',() => $(isPdf()?'fit':'word-fit').click()),
    button('+',() => $(isPdf()?'zoom-in':'word-zoom-in').click())
  )
  toolbar.append(zoomPill)

  const appStatus=$('status')
  let hideToast
  new MutationObserver(()=>{
    const message=appStatus.textContent
    clearTimeout(hideToast)
    appStatus.classList.toggle('mobile-toast-active', Boolean(message)&&!/^(Ready|PDF ready|Word document ready)$/.test(message))
    hideToast=setTimeout(()=>appStatus.classList.remove('mobile-toast-active'),2500)
  }).observe(appStatus,{childList:true})
  let frame=0
  const update=()=>{
    frame=0
    const doc=get()
    dock.hidden=!doc
    const name=$('file-title').textContent||'Elleson Docs'
    title.title=name
    title.setAttribute('aria-label','File menu for '+name)
    const status=$('connection').textContent
    if(connection.textContent!==status)connection.textContent=status
    title.dataset.connected=String(Boolean(status)&&!/offline|reconnect|connecting|on this phone/i.test(status))
    save.disabled=$('save-original').disabled
    direct.hidden=!doc
    const ink=isPdf()?mode('pen').getAttribute('aria-pressed')==='true':wordDrawing()
    read.setAttribute('aria-pressed',String(!ink&&mode('read').getAttribute('aria-pressed')==='true'))
    edit.setAttribute('aria-pressed',String(!ink&&mode(isPdf()?'edit':'word').getAttribute('aria-pressed')==='true'))
    draw.setAttribute('aria-pressed',String(ink))
    if(!window.desktopDocs&&!matchMedia('(max-width:600px)').matches)return
    const pages=readingView.active?readingView.pages():[...document.querySelectorAll('#word-sheet section.docx')]
    const top=stage.getBoundingClientRect().top+18
    const index=pages.findIndex(item=>item.getBoundingClientRect().bottom>top)
    const number=pages.length?Math.max(1,index+1):getPage()
    const label='Page '+number+' / '+(pages.length||doc?.pages||1)
    if($('quick-page').textContent!==label){$('quick-page').textContent=label;$('quick-page').setAttribute('aria-label',label)}
  }
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(update)}
  const observer=new MutationObserver(schedule)
  for(const id of ['file-title','connection','pdf-tools','word-tools','word-sheet','toolbar']){
    observer.observe($(id),{childList:true,subtree:true,attributes:true,attributeFilter:['aria-pressed','hidden']})
  }
  stage.addEventListener('scroll',schedule,{passive:true})
  $('page').addEventListener('change',schedule)
  schedule()

  const hub=$('extras-dialog')
  const sections=[...hub.querySelectorAll(':scope > details')].slice(0,4)
  const tabsRow=group('mobile-tools-tabs')
  tabsRow.setAttribute('role','navigation')
  tabsRow.setAttribute('aria-label','Document tool categories')
  for(const [index,label] of ['Fill & stamp','Profile','Replace','PDF'].entries()){
    const tab=button(label,()=>{
      sections.forEach((section,i)=>{section.open=i===index})
      for(const [i,item] of [...tabsRow.children].entries())item.setAttribute('aria-pressed',String(i===index))
    })
    tab.setAttribute('aria-pressed',String(index===0))
    tabsRow.append(tab)
  }
  hub.querySelector('h2').after(tabsRow)
}
