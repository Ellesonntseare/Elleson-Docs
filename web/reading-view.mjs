export function installReadingView({ pdfjs, request, get, go, fail }) {
  const stage = document.getElementById('stage'), sheet = document.getElementById('pdf-sheet')
  const container = document.createElement('section'); container.id = 'reading-pages'; container.hidden = true; stage.append(container)
  const toggle = document.createElement('button'); toggle.textContent = 'Continuous reading'; toggle.setAttribute('aria-pressed', 'false'); document.getElementById('page-tools').append(toggle)
  let active = false, task, observer, sequence = 0, zoom = 1, currentPage = 1
  const toolbar = document.createElement('div'); toolbar.className = 'reading-toolbar'; toolbar.hidden = true
  toolbar.innerHTML = '<button data-reading="out" aria-label="Reading zoom out">−</button><button data-reading="fit">Fit width</button><button data-reading="in" aria-label="Reading zoom in">+</button><button data-reading="exit">Exit reading</button>'
  stage.before(toolbar)
  async function close() {
    active = false; sequence++; observer?.disconnect(); container.replaceChildren(); container.hidden = toolbar.hidden = true
    toggle.setAttribute('aria-pressed', 'false'); document.body.classList.remove('reading-mode')
    if (task) { await task.destroy().catch(() => {}); task = null }
    sheet.hidden = get()?.extension !== 'pdf'; if (get()?.extension === 'pdf') go(currentPage)
  }
  async function load() {
    const state = get(); if (!state || state.extension !== 'pdf') return
    const own = ++sequence; observer?.disconnect()
    if (task) await task.destroy().catch(() => {})
    container.replaceChildren(); container.hidden = toolbar.hidden = false; sheet.hidden = true
    document.body.classList.add('reading-mode'); toggle.setAttribute('aria-pressed', 'true')
    const response = await request('/api/print/' + state.id), bytes = new Uint8Array(await response.arrayBuffer())
    if (own !== sequence) return
    task = pdfjs.getDocument({ data: bytes, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/' })
    const pdf = await task.promise; if (own !== sequence) return
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
        })().catch(error => { if (own === sequence) fail(error) }).finally(() => { page.rendering = false })
      }
    }, { root: stage, rootMargin: '500px 0px' })
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = document.createElement('article'); page.className = 'reading-page'; page.dataset.number = n; page.setAttribute('aria-label', 'Page ' + n)
      page.style.width = width + 'px'; page.style.height = natural.height / natural.width * width + 'px'; container.append(page); observer.observe(page)
    }
    container.children[Math.min(currentPage, pdf.numPages) - 1]?.scrollIntoView({ block: 'start' })
  }
  stage.addEventListener('scroll', () => {
    if (!active) return
    const bounds = stage.getBoundingClientRect()
    for (const child of container.children) { const rect = child.getBoundingClientRect(); if (rect.bottom > bounds.top + 30 && rect.top < bounds.bottom) { currentPage = Number(child.dataset.number); try { localStorage.setItem('elleson-reading-' + (get()?.libraryId || get()?.filename), String(currentPage)) } catch {}; break } }
  }, { passive: true })
  toggle.onclick = () => { if (active) void close(); else { active = true; currentPage = Number(localStorage.getItem('elleson-reading-' + (get()?.libraryId || get()?.filename))) || 1; void load().catch(fail) } }
  toolbar.onclick = event => {
    const action = event.target.dataset.reading
    if (action === 'exit') { void close(); return }
    zoom = action === 'fit' ? 1 : Math.max(.5, Math.min(3, zoom * (action === 'in' ? 1.25 : .8))); void load().catch(fail)
  }
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { if (active) void close() }))
  return { close, get active() { return active } }
}
