// A bounded, sharp overlay follows the visible part of a zoomed PDF.
export function installPdfDetail({stage, sheet, annotationMode}) {
  const layer = document.createElement('canvas')
  layer.className = 'pdf-detail'
  layer.setAttribute('aria-hidden', 'true')
  sheet.insertBefore(layer, sheet.children[1])
  let page, viewport, timer, task, generation = 0
  function clear() {
    generation++
    clearTimeout(timer)
    task?.cancel()
    layer.hidden = true
  }
  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(() => void render(), 100)
  }
  async function render() {
    if (!page || sheet.hidden || stage.dataset.navigating === 'true') {
      if (page && !sheet.hidden) schedule()
      return
    }
    const own = ++generation
    task?.cancel()
    const bounds = sheet.getBoundingClientRect(), view = stage.getBoundingClientRect()
    const x = Math.max(0, Math.floor(view.left - bounds.left - 64))
    const y = Math.max(0, Math.floor(view.top - bounds.top - 64))
    const width = Math.min(viewport.width - x, stage.clientWidth + 128)
    const height = Math.min(viewport.height - y, stage.clientHeight + 128)
    if (width <= 0 || height <= 0) return
    const density = Math.min(devicePixelRatio || 1, 2, 1800 / Math.max(width,height))
    const next = document.createElement('canvas')
    next.width = Math.ceil(width * density)
    next.height = Math.ceil(height * density)
    try {
      task = page.render({canvas:next,viewport,transform:[density,0,0,density,-x*density,-y*density],annotationMode})
      await task.promise
      if (own !== generation) return
      layer.width = next.width
      layer.height = next.height
      Object.assign(layer.style,{left:x+'px',top:y+'px',width:width+'px',height:height+'px'})
      layer.getContext('2d').drawImage(next,0,0)
      layer.hidden = false
    } catch (error) {
      if (error.name !== 'RenderingCancelledException' && own === generation) layer.hidden = true
    }
  }
  stage.addEventListener('scroll', schedule, {passive:true})
  return {
    update(source, frame, baseDensity) {
      clear()
      page = baseDensity < Math.min(devicePixelRatio || 1, 2) ? source : null
      viewport = frame
      if (page) schedule()
    }
  }
}
