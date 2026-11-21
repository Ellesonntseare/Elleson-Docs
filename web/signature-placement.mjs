let active
export function cancelPlacement() {
  active?.remove()
  active = null
}

// All positions are fractions of the page, including during a zoom or rotation.
export function previewSignature({sheet, strokes, color, thickness, x, y, width, height, commit, fail}) {
  cancelPlacement()
  const box = document.createElement('div')
  active = box
  box.className = 'signature-placement'
  const canvas = document.createElement('canvas')
  canvas.width = 900
  canvas.height = 300
  const pen = canvas.getContext('2d')
  pen.strokeStyle = color
  pen.lineCap = pen.lineJoin = 'round'
  pen.lineWidth = Math.max(1, thickness * canvas.width / (width * sheet.offsetWidth))
  for (const stroke of strokes) {
    pen.beginPath()
    stroke.forEach(([px, py], i) => pen[i ? 'lineTo' : 'moveTo'](px * 900, py * 300))
    pen.stroke()
  }
  const controls = document.createElement('div')
  controls.className = 'placement-controls'
  const button = (label, parent) => {
    const el = document.createElement('button')
    el.type = 'button'
    el.textContent = label
    parent.append(el)
    return el
  }
  const place = button('Place', controls), cancel = button('Cancel', controls)
  const handle = button('↘', box)
  handle.setAttribute('aria-label', 'Resize signature')
  handle.className = 'placement-handle'
  box.prepend(canvas)
  box.append(controls)
  sheet.append(box)
  const clamp = (n, max) => Math.max(0, Math.min(n, max))
  function paint() {
    x = clamp(x, 1 - width)
    y = clamp(y, 1 - height)
    Object.assign(box.style, {left:x*100+'%',top:y*100+'%',width:width*100+'%',height:height*100+'%'})
    controls.style.top = y < 0.15 ? '100%' : ''
  }
  paint()
  box.onpointerdown = e => {
    if (controls.contains(e.target)) return
    e.preventDefault()
    box.setPointerCapture(e.pointerId)
    const resize = e.target === handle
    const origin = [x,y,width,height]
    const bounds = sheet.getBoundingClientRect()
    box.onpointermove = move => {
      if(move.pointerId !== e.pointerId) return
      const dx = (move.clientX-e.clientX)/bounds.width, dy = (move.clientY-e.clientY)/bounds.height
      if(resize) {
        const scale = Math.min((1-x)/origin[2],(1-y)/origin[3],Math.max(0.08/origin[2],1+dx/origin[2]))
        width = origin[2]*scale
        height = origin[3]*scale
      } else { x = origin[0]+dx; y = origin[1]+dy }
      paint()
    }
  }
  box.onlostpointercapture = () => {box.onpointermove=null}
  cancel.onclick = cancelPlacement
  place.onclick = async () => {
    place.disabled = true
    try { await commit({x,y,width,height}); if(active===box)cancelPlacement() }
    catch(error) { fail(error); place.disabled=false }
  }
}
