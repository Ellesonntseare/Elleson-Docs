export function installMobileNavigation({stage, get, getPage, go, readingView}) {
  const tools=document.getElementById('toolbar')
  const jump=document.createElement('button')
  jump.id='quick-page'
  jump.textContent='Page'
  const focus=document.createElement('button')
  focus.id='document-focus'
  focus.textContent='Focus'
  focus.onclick=()=>document.body.classList.add('focus-reading')
  tools.append(jump,focus)
  const dialog=document.createElement('dialog')
  dialog.innerHTML='<form><label>Go to page <input type="number" min="1" value="1" required></label><button>Go</button></form><div class="actions"><button data-view="thumbnails">Thumbnails</button><button data-view="bookmarks">Bookmarks</button><button data-view="close">Close</button></div>'
  dialog.id='page-jump-dialog'
  const heading=document.createElement('h2')
  heading.textContent='Jump to page'
  const range=document.createElement('input')
  range.type='range'
  range.min='1'
  range.setAttribute('aria-label','Page scrubber')
  const preview=document.createElement('div')
  preview.className='jump-previews'
  dialog.prepend(heading,preview,range)
  document.body.append(dialog)
  const input=dialog.querySelector('input')
  function pages() {
    return readingView.active?readingView.pages():[...document.querySelectorAll('#word-sheet section.docx')]
  }
  function pageNumber(list) {
    if(!list.length)return getPage()
    const y=stage.getBoundingClientRect().top+16
    const index=list.findIndex(p=>p.getBoundingClientRect().bottom>y)
    return Math.max(1,index+1)
  }
  jump.onclick=()=>{
    const current=get()
    if(!current)return
    const list=pages()
    input.max=list.length||current.pages||1
    input.value=pageNumber(list)
    range.max=input.max
    range.value=input.value
    preview.replaceChildren()
    const selected=Number(input.value)
    const count=Number(input.max)
    for(let n=Math.max(1,Math.min(selected,count-1));n<=Math.min(count,Math.max(2,selected+1));n++){
      const tile=document.createElement('button')
      tile.type='button'
      tile.className='jump-preview'
      const thumbnail=document.querySelector('#pages button[data-page="'+n+'"] canvas')
      if(thumbnail&&thumbnail.width>0){
        const canvas=document.createElement('canvas')
        canvas.width=thumbnail.width;canvas.height=thumbnail.height
        canvas.getContext('2d').drawImage(thumbnail,0,0)
        tile.append(canvas)
      }
      tile.append('Page '+n)
      tile.setAttribute('aria-current',n===selected?'page':'false')
      tile.onclick=()=>{input.value=n;dialog.querySelector('form').requestSubmit()}
      preview.append(tile)
    }
    for(const button of dialog.querySelectorAll('[data-view]:not([data-view="close"])'))button.hidden=current.extension!=='pdf'
    dialog.showModal()
  }
  range.oninput=()=>{input.value=range.value}
  input.oninput=()=>{range.value=input.value}
  dialog.querySelector('form').onsubmit=e=>{
    e.preventDefault()
    const list=pages(),number=Number(input.value)
    dialog.close()
    if(list.length)list[number-1]?.scrollIntoView({block:'start'})
    else go(number)
  }
  dialog.onclick=e=>{
    const action=e.target.dataset.view
    if(!action)return
    dialog.close()
    if(action==='bookmarks')document.getElementById('bookmarks').click()
    if(action==='thumbnails'&&document.getElementById('pages').hidden)document.getElementById('sidebar-toggle').click()
  }
}
