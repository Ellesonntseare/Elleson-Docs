import {installWheelZoom} from './wheel-zoom.mjs'
import { installDocumentGestures } from './document-gestures.mjs'
export function installReadingView({ pdfjs, request, get, go, fail }) {
  const stage = document.getElementById('stage'), sheet = document.getElementById('pdf-sheet')
  const container = document.createElement('section'); container.id = 'reading-pages'; container.hidden = true; stage.append(container)
  const toggle = document.createElement('button'); toggle.textContent = 'Continuous reading'; toggle.setAttribute('aria-pressed', 'false'); document.getElementById('page-tools').append(toggle)
  let active = false, task, observer, sequence = 0, zoom = 1, currentPage = 1, latestSignature = '', sourceSignature='', loading = false
  const toolbar = document.createElement('div'); toolbar.className = 'reading-toolbar'; toolbar.hidden = true
  toolbar.innerHTML = '<button data-reading="out" aria-label="Reading zoom out">−</button><button data-reading="fit">Fit width</button><button data-reading="in" aria-label="Reading zoom in">+</button><button data-reading="exit">Exit reading</button>'
  stage.before(toolbar)
  async function close() {
    active = false; sequence++; observer?.disconnect(); container.replaceChildren(); container.hidden = toolbar.hidden = true
    toggle.setAttribute('aria-pressed', 'false'); document.body.classList.remove('reading-mode')
    if (task) { await task.destroy().catch(() => {}); task = null; sourceSignature='' }
    sheet.hidden = get()?.extension !== 'pdf'; if (get()?.extension === 'pdf') go(currentPage)
  }
  async function load() {
    const state = get(); if (!state || state.extension !== 'pdf') return
    const signature = JSON.stringify([state.id,state.contentVersion,state.marks,state.fields])
    latestSignature = ''
    const own=++sequence
    if(!task||sourceSignature!==signature){
      const previous=task
      const response=await request('/api/print/'+state.id)
      const bytes=new Uint8Array(await response.arrayBuffer())
      if(own!==sequence)return
      const next=pdfjs.getDocument({data:bytes,standardFontDataUrl:'/pdfjs/standard_fonts/',wasmUrl:'/pdfjs/wasm/'})
      await next.promise
      if(own!==sequence){await next.destroy();return}
      task=next
      sourceSignature=signature
      if(previous)void previous.destroy().catch(()=>{})
    }
    const pdf=await task.promise
    if(own!==sequence)return
    observer?.disconnect()
    container.hidden=toolbar.hidden=false
    sheet.hidden=true
    document.body.classList.add('reading-mode')
    toggle.setAttribute('aria-pressed','true')
    const first = await pdf.getPage(1), natural = first.getViewport({ scale: 1 }), width = Math.max(180, stage.clientWidth - 32) * zoom
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const page = entry.target
        if (!entry.isIntersecting) { if (!page.rendering) { page.replaceChildren(); page.loaded = false }; continue }
        if (page.loaded || page.rendering) continue
        page.rendering = true
        void (async () => {
          const source = await pdf.getPage(Number(page.dataset.number)), size = source.getViewport({ scale: 1 }), frame = source.getViewport({ scale: width / size.width })
          const canvas = document.createElement('canvas'), ratio = Math.min(devicePixelRatio || 1, 2, 3000 / Math.max(frame.width, frame.height))
          canvas.width = Math.ceil(frame.width * ratio); canvas.height = Math.ceil(frame.height * ratio)
          await source.render({ canvas, viewport: frame, transform: [ratio,0,0,ratio,0,0] }).promise
          if (own !== sequence) return
          page.style.height = frame.height + 'px'; page.replaceChildren(canvas); page.loaded = true
          const layer = document.createElement('div'); layer.className = 'textLayer'
          layer.style.setProperty('--total-scale-factor',frame.scale * frame.userUnit); layer.style.setProperty('--scale-round-x','1px'); layer.style.setProperty('--scale-round-y','1px')
          await new pdfjs.TextLayer({textContentSource:await source.getTextContent(),viewport:frame,container:layer}).render()
          if (own === sequence) page.append(layer)
        })().catch(error => { if (own === sequence) fail(error) }).finally(() => { page.rendering = false })
      }
    }, { root: stage, rootMargin: '500px 0px' })
    const nextPages=document.createDocumentFragment()
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = document.createElement('article'); page.className = 'reading-page'; page.dataset.number = n; page.setAttribute('aria-label', 'Page ' + n)
      page.style.width = width + 'px'; page.style.height = natural.height / natural.width * width + 'px'; nextPages.append(page); observer.observe(page)
    }
    container.replaceChildren(nextPages)
    container.children[Math.min(currentPage, pdf.numPages) - 1]?.scrollIntoView({ block: 'start' })
    if (own === sequence) latestSignature = signature
  }
  let scrollFrame=0
  stage.addEventListener('scroll', () => {
    if(scrollFrame)return
    scrollFrame=requestAnimationFrame(()=>{scrollFrame=0
    if (!active) return
    const bounds = stage.getBoundingClientRect()
    for (const child of container.children) { const rect = child.getBoundingClientRect(); if (rect.bottom > bounds.top + 30 && rect.top < bounds.bottom) { const next=Number(child.dataset.number); if(next===currentPage)break; currentPage=next; try { localStorage.setItem('elleson-reading-' + (get()?.libraryId || get()?.filename), String(currentPage)) } catch {}; break } }
    })
  }, { passive: true })
  toggle.onclick = () => { if (active) void close(); else { active = true; currentPage = Number(localStorage.getItem('elleson-reading-' + (get()?.libraryId || get()?.filename))) || 1; void load().catch(fail) } }
  toolbar.onclick = event => {
    const action = event.target.dataset.reading
    if (action === 'exit') { void close(); return }
    zoom = action === 'fit' ? 1 : zoom * (action === 'in' ? 1.25 : .8); void load().catch(fail)
  }
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { if (active) void close() }))
  setInterval(async () => {
    if (!active || loading || !get()) return
    const state=get(), signature=JSON.stringify([state.id,state.contentVersion,state.marks,state.fields])
    if(signature===latestSignature)return
    loading=true
    try { await load() } catch(error){fail(error)} finally {loading=false}
  },1500)
  installDocumentGestures({stage,sheet:container,isActive:()=>active,canPan:()=>true,cancelStroke:()=>{},getZoom:()=>zoom,setZoom:value=>{zoom=value},render:load})
  installWheelZoom({stage,sheet:container,isActive:()=>active,getZoom:()=>zoom,setZoom:value=>{zoom=value},render:load,fail,
    anchorAt(y,ratio){
      const list=[...container.children],bounds=container.getBoundingClientRect()
      const index=list.findIndex(page=>(page.getBoundingClientRect().bottom-bounds.top)/ratio>y)
      if(index<0)return null
      const rect=list[index].getBoundingClientRect()
      return {left:(rect.left-bounds.left)/ratio,top:(rect.top-bounds.top)/ratio,width:rect.width/ratio,height:rect.height/ratio,find:()=>container.children[index]}
    }})
  return { close, get active() { return active },getZoom:()=>zoom,pages:()=>[...container.children],async setView(value){currentPage=value.page;if(!active||zoom!==value.zoom){active=true;zoom=value.zoom;await load()}return container.children.length>0} }

}
