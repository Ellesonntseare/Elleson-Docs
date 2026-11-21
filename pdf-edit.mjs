import * as mupdf from "mupdf"
const toBytes = value => typeof Buffer !== "undefined" ? Buffer.from(value) : Uint8Array.from(value)

function pointTransform([x, y], matrix) {
  return [x * matrix[0] + y * matrix[2] + matrix[4], x * matrix[1] + y * matrix[3] + matrix[5]]
}

function readSpans(page) {
  const structured = page.toStructuredText("preserve-whitespace")
  const spans = []
  let run
  const finish = () => {
    if (run?.text.trim()) spans.push(run)
    run = undefined
  }
  structured.walk({
    beginLine: finish,
    onChar(char, origin, font, size, quad, color) {
      const signature = [font.getName(), size, ...color].join("|")
      if (run && run.signature !== signature) finish()
      if (!run) run = { text: "", signature, font, size, color, origin, quads: [] }
      run.text += char === "\u00a0" ? " " : char
      run.quads.push(quad)
    },
    endLine: finish
  })
  for (const run of spans) {
    const points = run.quads.flatMap(quad => [[quad[0], quad[1]], [quad[2], quad[3]], [quad[4], quad[5]], [quad[6], quad[7]]])
    run.rect = [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]
    const first = run.quads[0]
    const width = Math.hypot(first[2] - first[0], first[3] - first[1]) || 1
    run.direction = [(first[2] - first[0]) / width, (first[3] - first[1]) / width]
  }
  return { structured, spans }
}

export function extract(bytes, index, ocr = []) {
  const document = new mupdf.PDFDocument(bytes)
  const page = document.loadPage(index)
  const { structured, spans } = readSpans(page)
  const inverse = mupdf.Matrix.invert(page.getTransform())
  const result = spans.map((run, id) => ({
    id, text: run.text, font: run.font.getName(), size: run.size, color: run.color,
    quad: [
      pointTransform([run.rect[0], run.rect[1]], inverse),
      pointTransform([run.rect[2], run.rect[3]], inverse)
    ]
  }))
  for (const run of ocr) result.push({
    id: run.id, text: run.text, font: "Helvetica · estimated scan font", size: run.size, confidence: run.confidence,
    quad: [pointTransform([run.rect[0], run.rect[1]], inverse), pointTransform([run.rect[2], run.rect[3]], inverse)]
  })
  structured.destroy()
  page.destroy()
  document.destroy()
  return result
}

export function replace(bytes, index, spanId, before, value, ocrRun, fontName, layout = {}) {
  const document = new mupdf.PDFDocument(bytes)
  const page = document.loadPage(index)
  const { structured, spans } = readSpans(page)
  let overlayBuffer, writer, overlayDoc, text, redaction, device
  try {
    const run = ocrRun ? {
      ...ocrRun, font: new mupdf.Font("Helvetica"), color: [0, 0, 0], direction: [1, 0],
      origin: [ocrRun.rect[0], ocrRun.rect[3] - ocrRun.size * .18]
    } : spans[spanId]
    if (!run || run.text !== before) throw new Error("The selected text changed. Select it again.")
    const originalFontName = run.font.getName()
    if (fontName && !["Helvetica", "Times-Roman", "Courier"].includes(fontName)) throw new Error("Choose a supported replacement font.")
    if (fontName) run.font = new mupdf.Font(fontName)
    const widths = Array.from(value.replaceAll("\n", ""), char => {
      const glyph = run.font.encodeCharacter(char.codePointAt(0))
      if (!glyph && char.trim()) throw new Error("The original font has no glyph for “" + char + "”. Choose text that this font supports.")
      return run.font.advanceGlyph(glyph) * run.size
    })
    const bounds = page.getBounds()
    const horizontal = run.direction[0] > .99 && Math.abs(run.direction[1]) < .01
    const right = Math.min(bounds[2] - 6, ...spans.filter(other =>
      other !== run && other.rect[0] > run.rect[2] + 1 && other.rect[1] < run.rect[3] && other.rect[3] > run.rect[1]
    ).map(other => other.rect[0] - 3))
    const [dx, dy] = run.direction
    const limits = []
    if (Math.abs(dx) > .001) limits.push(((dx > 0 ? bounds[2] - 6 : bounds[0] + 6) - run.origin[0]) / dx)
    if (Math.abs(dy) > .001) limits.push(((dy > 0 ? bounds[3] - 6 : bounds[1] + 6) - run.origin[1]) / dy)
    const available = horizontal ? right - run.origin[0] : Math.min(...limits)
    const paragraph = layout.paragraph === true
    let lines = [value], chosen = [run], lineWidth = available, lineHeight = run.size * 1.2
    if (paragraph) {
      if (!horizontal || ocrRun) throw new Error("Paragraph reflow currently requires horizontal digital text. Edit scanned or rotated lines individually.")
      const count = Number(layout.lines || 1)
      if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("Select between 1 and 20 text runs.")
      chosen = spans.slice(spanId, spanId + count)
      if (chosen.length !== count || chosen.some(other => other !== run && other.font.getName() !== originalFontName || Math.abs(other.direction[1]) > .01)) throw new Error("Select adjacent horizontal text with a consistent font.")
      lineWidth = Number(layout.width) || Math.max(...chosen.map(other => other.rect[2])) - run.origin[0]
      const height = Number(layout.height) || Math.max(...chosen.map(other => other.rect[3])) - run.rect[1]
      const spacing = Number(layout.spacing || 1.2)
      if (lineWidth < 10 || lineWidth > bounds[2] - run.origin[0] || height < run.size || height > bounds[3] - run.rect[1] || spacing < 1 || spacing > 3) throw new Error("Choose a text area inside the page and line spacing between 1 and 3.")
      lineHeight = run.size * spacing
      const measure = text => Array.from(text).reduce((width, char) => width + run.font.advanceGlyph(run.font.encodeCharacter(char.codePointAt(0))) * run.size, 0)
      lines = []
      for (const paragraphText of value.split("\n")) {
        let line = ""
        for (const word of paragraphText.split(/\s+/).filter(Boolean)) {
          if (measure(word) > lineWidth) throw new Error("A word is wider than the text area. Increase the width or use shorter wording.")
          if (line && measure(line + " " + word) > lineWidth) { lines.push(line); line = word }
          else line += (line ? " " : "") + word
        }
        lines.push(line)
      }
      const bottom = run.rect[1] + run.size + (lines.length - 1) * lineHeight
      if (bottom > run.rect[1] + height) throw new Error("The paragraph does not fit the selected height. Increase the height or shorten the wording.")
      if (spans.some(other => !chosen.includes(other) && other.rect[0] < run.origin[0] + lineWidth && other.rect[2] > run.origin[0] && other.rect[1] < bottom && other.rect[3] > run.rect[1])) throw new Error("The text area overlaps other text. Reduce its width or height.")
    } else if (value.includes("\n") || widths.reduce((sum, width) => sum + width, 0) > available) {
      throw new Error("The new text exceeds the available space at the original font size. Shorten it to keep the layout.")
    }
    redaction = page.createAnnotation("Redact")
    const inset = ocrRun ? -1 : Math.min(run.size * .25, (run.rect[3] - run.rect[1]) * .2)
    if (paragraph) redaction.setQuadPoints(chosen.flatMap(other => other.quads))
    else if (!horizontal && run.quads) redaction.setQuadPoints(run.quads)
    else redaction.setRect([run.rect[0], run.rect[1] + inset, run.rect[2], run.rect[3] - inset])
    redaction.update()
    redaction.applyRedaction(0, ocrRun ? mupdf.PDFPage.REDACT_IMAGE_PIXELS : mupdf.PDFPage.REDACT_IMAGE_NONE,
      mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE)

    overlayBuffer = new mupdf.Buffer()
    writer = new mupdf.DocumentWriter(overlayBuffer, "pdf", "")
    device = writer.beginPage(bounds)
    text = new mupdf.Text()
    lines.forEach((line, index) => {
      const length = Array.from(line).reduce((sum, char) => sum + run.font.advanceGlyph(run.font.encodeCharacter(char.codePointAt(0))) * run.size, 0)
      const offset = layout.align === "center" ? (lineWidth - length) / 2 : layout.align === "right" ? lineWidth - length : 0
      text.showString(run.font, [run.size * dx, run.size * dy, run.size * dy, -run.size * dx, run.origin[0] + (paragraph ? offset : 0), run.origin[1] + index * lineHeight], line)
    })
    device.fillText(text, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, run.color, 1)
    writer.endPage()
    writer.close()
    overlayDoc = new mupdf.PDFDocument(overlayBuffer)
    const overlayPage = overlayDoc.loadPage(0)
    const overlayObject = overlayPage.getObject()
    const object = page.getObject()
    const resources = document.newDictionary()
    object.getInheritable("Resources").forEach((value, key) => resources.put(key, value))
    const xobjects = document.newDictionary()
    const existingXobjects = resources.get("XObject")
    if (!existingXobjects.isNull()) existingXobjects.forEach((value, key) => xobjects.put(key, value))
    const name = "EllesonEdit" + document.countObjects()
    const overlayResources = document.graftObject(overlayObject.getInheritable("Resources"))
    const streamDictionary = document.newDictionary()
    streamDictionary.put("Type", document.newName("XObject"))
    streamDictionary.put("Subtype", document.newName("Form"))
    streamDictionary.put("BBox", overlayObject.getInheritable("MediaBox").asJS())
    streamDictionary.put("Resources", overlayResources)
    const overlayStream = document.addStream(overlayObject.get("Contents").readStream(), streamDictionary)
    xobjects.put(name, overlayStream)
    resources.put("XObject", xobjects)
    object.put("Resources", resources)
    const contents = object.get("Contents")
    const list = document.newArray()
    if (contents.isArray()) contents.forEach(value => list.push(value))
    else list.push(contents)
    const transform = mupdf.Matrix.concat(overlayPage.getTransform(), mupdf.Matrix.invert(page.getTransform()))
    list.push(document.addStream("q " + transform.join(" ") + " cm /" + name + " Do Q", {}))
    object.put("Contents", list)
    const output = document.saveToBuffer("garbage=1,compress")
    const result = toBytes(output.asUint8Array())
    output.destroy()
    overlayPage.destroy()
    if (ocrRun || fontName) run.font.destroy()
    return result
  } finally {
    text?.destroy()
    device?.destroy()
    writer?.destroy()
    overlayDoc?.destroy()
    overlayBuffer?.destroy()
    structured.destroy()
    page.destroy()
    document.destroy()
  }
}

export function scanImage(bytes, index) {
  const document = new mupdf.PDFDocument(bytes)
  const page = document.loadPage(index)
  const bounds = page.getBounds()
  const scale = Math.min(2, Math.sqrt(9000000 / ((bounds[2] - bounds[0]) * (bounds[3] - bounds[1]))))
  const bitmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, false)
  const image = toBytes(bitmap.asPNG())
  bitmap.destroy()
  page.destroy()
  document.destroy()
  return { image, scale, bounds }
}

export function imageInfo(bytes) {
  const type = bytes[0] === 137 && bytes[1] === 80 ? "png" : bytes[0] === 255 && bytes[1] === 216 ? "jpeg" : null
  if (!type) throw new Error("Choose a PNG or JPEG image.")
  const image = new mupdf.Image(bytes)
  try { return { type, width: image.getWidth(), height: image.getHeight() } }
  finally { image.destroy() }
}

export function organize(bytes, action, pages, extra) {
  const document = new mupdf.PDFDocument(bytes)
  let incoming
  const arrange = order => {
    const root = document.getTrailer().get("Root", "Pages")
    const objects = order.map(index => document.findPage(index))
    const widgets = new Set()
    const key = object => object.isIndirect() ? "ref-" + object.asIndirect() : "direct-" + object.resolve().pointer
    const children = document.newArray()
    for (const object of objects) {
      for (const name of ["Resources", "MediaBox", "CropBox", "Rotate"]) {
        const inherited = object.getInheritable(name)
        if (!inherited.isNull()) object.put(name, inherited)
      }
      object.put("Parent", root)
      children.push(object)
      const annotations = object.get("Annots")
      if (!annotations.isNull()) annotations.forEach(annotation => {
        if (annotation.get("Subtype").asName() === "Widget") widgets.add(key(annotation))
      })
    }
    root.put("Kids", children)
    root.put("Count", objects.length)
    const fields = document.getTrailer().get("Root", "AcroForm", "Fields")
    const retain = field => {
      const kids = field.get("Kids")
      if (!kids.isNull() && kids.length) {
        const remaining = document.newArray()
        kids.forEach(child => { if (retain(child)) remaining.push(child) })
        field.put("Kids", remaining)
        return remaining.length > 0
      }
      return field.get("Subtype").asName() !== "Widget" || widgets.has(key(field))
    }
    if (!fields.isNull()) {
      const remaining = document.newArray()
      fields.forEach(field => { if (retain(field)) remaining.push(field) })
      document.getTrailer().get("Root", "AcroForm").put("Fields", remaining)
    }
  }
  try {
    const count = document.countPages()
    if (action === "plan") {
      if (!Array.isArray(pages) || !pages.length || pages.length > 1000 || pages.some(item => !Number.isInteger(item.index) || item.index < 0 || item.index >= count || ![0,90,180,270].includes(item.rotation))) throw new Error("Choose a valid page arrangement.")
      const used = new Set(), order = []
      for (const item of pages) {
        let index = item.index
        if (used.has(index)) {
          if (!incoming) { incoming = new mupdf.PDFDocument(bytes); incoming.bake(true,true) }
          document.graftPage(-1,incoming,index); index = document.countPages()-1
        }
        used.add(item.index)
        const object = document.findPage(index)
        object.put("Rotate",(object.getInheritable("Rotate").asNumber()+item.rotation)%360)
        order.push(index)
      }
      arrange(order)
    } else if (action === "combine") {
      document.bake(true, true)
      incoming = new mupdf.PDFDocument(extra)
      incoming.bake(true, true)
      for (let index = 0; index < incoming.countPages(); index++) document.graftPage(-1, incoming, index)
    } else {
      if (!Array.isArray(pages) || !pages.length || new Set(pages).size !== pages.length ||
          pages.some(index => !Number.isInteger(index) || index < 0 || index >= count)) throw new Error("Choose valid, unique page numbers.")
      if (action === "rotate") {
        for (const index of pages) {
          const object = document.findPage(index)
          object.put("Rotate", (object.getInheritable("Rotate").asNumber() + 90) % 360)
        }
      } else if (action === "delete") {
        const remaining = Array.from({ length: count }, (_, index) => index).filter(index => !pages.includes(index))
        if (!remaining.length) throw new Error("Keep at least one page.")
        arrange(remaining)
      } else if (action === "reorder" || action === "extract") {
        if (action === "reorder" && pages.length !== count) throw new Error("Include every page once in the new order.")
        arrange(pages)
      } else throw new Error("Choose a page action.")
    }
    const buffer = document.saveToBuffer("garbage=1,compress")
    const result = { bytes: toBytes(buffer.asUint8Array()), pages: document.countPages() }
    buffer.destroy()
    return result
  } finally { incoming?.destroy(); document.destroy() }
}
