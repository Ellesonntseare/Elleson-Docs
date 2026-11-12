// Keep navigation gestures separate from drawing. Suppress the remaining finger
// until all contacts are released after a pinch, so it cannot begin a new stroke.
export function installDocumentGestures({ stage, sheet, cancelStroke, getZoom, setZoom, render }) {
  const touches = new Map()
  let gesture = null, navigating = false
  const measure = () => {
    const [a, b] = [...touches.values()]
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) }
  }
  stage.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') return
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (touches.size < 2) return
    cancelStroke()
    if (!gesture) {
      const point = measure(), bounds = sheet.getBoundingClientRect()
      gesture = { ...point, zoom: getZoom(), left: stage.scrollLeft, top: stage.scrollTop,
        anchorX: point.x - bounds.left, anchorY: point.y - bounds.top, ratio: 1 }
      navigating = true
      sheet.style.transformOrigin = `${gesture.anchorX}px ${gesture.anchorY}px`
    }
    event.preventDefault(); event.stopImmediatePropagation()
    stage.setPointerCapture(event.pointerId)
  }, true)
  stage.addEventListener('pointermove', event => {
    if (!touches.has(event.pointerId)) return
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (!navigating) return
    event.preventDefault(); event.stopImmediatePropagation()
    if (touches.size < 2 || !gesture) return
    const point = measure()
    gesture.ratio = Math.max(.35 / gesture.zoom, Math.min(3 / gesture.zoom, point.distance / gesture.distance))
    stage.scrollLeft = gesture.left + gesture.x - point.x
    stage.scrollTop = gesture.top + gesture.y - point.y
    sheet.style.transform = `scale(${gesture.ratio})`
  }, true)
  const end = event => {
    touches.delete(event.pointerId)
    if (!navigating) return
    event.preventDefault(); event.stopImmediatePropagation()
    if (gesture && touches.size < 2) {
      const finished = gesture; gesture = null
      sheet.style.transform = ''; sheet.style.transformOrigin = ''
      const left = stage.scrollLeft, top = stage.scrollTop
      setZoom(finished.zoom * finished.ratio)
      Promise.resolve(render()).then(() => {
        stage.scrollLeft = left + finished.anchorX * (finished.ratio - 1)
        stage.scrollTop = top + finished.anchorY * (finished.ratio - 1)
      })
    }
    if (!touches.size) navigating = false
  }
  stage.addEventListener('pointerup', end, true)
  stage.addEventListener('pointercancel', end, true)
}
