// Keep navigation gestures separate from drawing. Suppress the remaining finger
// until all contacts are released after a pinch, so it cannot begin a new stroke.
export function installDocumentGestures({ stage, sheet, cancelStroke, getZoom, setZoom, render, isActive = () => true, minZoom = 0, maxZoom = Infinity, canPan = () => false }) {
  const touches = new Map()
  let gesture = null, navigating = false, pan = null
  let frame = 0, pendingPan, committing = false
  const paint = () => {
    frame = 0
    if (pendingPan) {
      stage.scrollTo(pendingPan)
      pendingPan = null
    }
    if (gesture) {
      const { dx, dy, cssZoom, ratio } = gesture
      sheet.style.transform = `translate(${dx / cssZoom}px, ${dy / cssZoom}px) scale(${ratio})`
    }
  }
  const schedulePaint = () => { if (!frame) frame = requestAnimationFrame(paint) }
  const measure = () => {
    const [a, b] = [...touches.values()]
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) }
  }
  stage.addEventListener('pointerdown', event => {
    if (!isActive() || committing || event.pointerType !== 'touch' || event.width > 48 || event.height > 48) return
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (touches.size === 1) pan = {x:event.clientX,y:event.clientY,left:stage.scrollLeft,top:stage.scrollTop}
    if (touches.size < 2) return
    if (pendingPan) paint()
    pan = null
    stage.dispatchEvent(new Event('document-navigation-start'))
    cancelStroke()
    if (!gesture) {
      const point = measure(), bounds = sheet.getBoundingClientRect()
      gesture = { ...point, zoom: getZoom(), left: stage.scrollLeft, top: stage.scrollTop,
        anchorX: point.x - bounds.left, anchorY: point.y - bounds.top, cssZoom: sheet.currentCSSZoom || 1, dx: 0, dy: 0, ratio: 1 }
      navigating = true
      stage.dataset.navigating='true';sheet.style.willChange='transform'
      sheet.style.transformOrigin = `${gesture.anchorX / gesture.cssZoom}px ${gesture.anchorY / gesture.cssZoom}px`
    }
    event.preventDefault(); event.stopImmediatePropagation()
    stage.setPointerCapture(event.pointerId)
  }, true)
  stage.addEventListener('pointermove', event => {
    if (!touches.has(event.pointerId)) return
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (!navigating) {
      if (pan && canPan() && Math.hypot(event.clientX-pan.x,event.clientY-pan.y)>8) {
        event.preventDefault();event.stopImmediatePropagation()
        stage.dataset.navigating = 'true'
        pendingPan = { left: pan.left + pan.x - event.clientX, top: pan.top + pan.y - event.clientY }
        schedulePaint()
      }
      return
    }
    event.preventDefault(); event.stopImmediatePropagation()
    if (touches.size < 2 || !gesture) return
    const point = measure()
    gesture.ratio = Math.max(minZoom / gesture.zoom, Math.min(maxZoom / gesture.zoom, point.distance / gesture.distance))
    gesture.dx = point.x - gesture.x
    gesture.dy = point.y - gesture.y
    schedulePaint()
  }, true)
  const end = event => {
    if (!touches.delete(event.pointerId)) return
    if (frame) cancelAnimationFrame(frame)
    paint()
    pan = null
    if (!navigating) {
      delete stage.dataset.navigating
      return
    }
    event.preventDefault(); event.stopImmediatePropagation()
    if (gesture && touches.size < 2) {
      const finished = gesture
      gesture = null
      committing = true
      setZoom(finished.zoom * finished.ratio)
      Promise.resolve(render()).then(() => {
        sheet.style.transform = ''
        const bounds = sheet.getBoundingClientRect()
        stage.scrollLeft += bounds.left + finished.anchorX * finished.ratio - finished.x - finished.dx
        stage.scrollTop += bounds.top + finished.anchorY * finished.ratio - finished.y - finished.dy
      }).finally(() => {
        committing = false
        sheet.style.transform = ''
        sheet.style.transformOrigin = ''
        sheet.style.willChange = ''
        if (!touches.size) delete stage.dataset.navigating
      })
    }
    if (!touches.size) {
      navigating = false
      if (!committing) delete stage.dataset.navigating
    }
  }
  stage.addEventListener('pointerup', end, true)
  stage.addEventListener('pointercancel', end, true)
}
