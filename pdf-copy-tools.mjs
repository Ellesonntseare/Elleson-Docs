import * as mupdf from "mupdf"

export const privacyLabels = {
  metadata: "Document metadata",
  comments: "Comments and markup",
  attachments: "Attachments",
  scripts: "JavaScript and automatic actions",
  layers: "Optional layer controls"
}
const metadata = new Set(["Info", "Metadata", "PieceInfo", "LastModified"])
const attachments = new Set(["EmbeddedFiles", "AF", "EF", "RF"])
const automatic = new Set(["JavaScript", "JS", "AA", "OpenAction"])
const actions = new Set(["JavaScript", "Launch", "SubmitForm", "ImportData", "GoToE", "Rendition", "RichMediaExecute", "Movie", "Sound"])
const retained = new Set(["Widget", "Link"])

function scan(document, remove = new Set()) {
  const counts = Object.fromEntries(Object.keys(privacyLabels).map(key => [key, 0]))
  const seen = new Set()
  let visited = 0
  function visit(object, depth = 0) {
    if (object.isNull()) return
    if (depth > 150 || ++visited > 500000) throw new Error("The PDF structure exceeds the inspection limit.")
    if (object.isIndirect()) {
      const id = object.asIndirect()
      if (seen.has(id)) return
      seen.add(id)
    }
    if (!object.isDictionary() && !object.isArray()) return
    const deletions = []
    object.forEach((value, key) => {
      let categories = []
      if (metadata.has(key)) categories.push("metadata")
      if (attachments.has(key) || value.isDictionary() && value.get("Subtype").asName() === "FileAttachment") categories.push("attachments")
      if (automatic.has(key) || value.isDictionary() && actions.has(value.get("S").asName())) categories.push("scripts")
      if (key === "OCProperties" || key === "OC") categories.push("layers")
      if (object.isArray() && value.isDictionary() && value.get("Type").asName() === "Annot") {
        if (!retained.has(value.get("Subtype").asName())) categories.push("comments")
      }
      if (key === "Annots" && value.isArray()) {
        for (let index = value.length - 1; index >= 0; index--) {
          const subtype = value.get(index).get("Subtype").asName()
          if (!subtype || retained.has(subtype)) continue
          counts.comments++
          if (subtype === "FileAttachment") counts.attachments++
          if (remove.has("comments") || subtype === "FileAttachment" && remove.has("attachments")) value.delete(index)
        }
        visit(value, depth + 1)
        return
      }
      categories = [...new Set(categories)]
      for (const category of categories) counts[category]++
      if (categories.some(category => remove.has(category))) deletions.push(key)
      else visit(value, depth + 1)
    })
    for (const key of deletions.reverse()) object.delete(key)
  }
  const trailer = document.getTrailer()
  const info = trailer.get("Info")
  if (info.isDictionary()) {
    const keys = []
    info.forEach((value, key) => keys.push(key))
    if (keys.length) counts.metadata++
    if (remove.has("metadata")) {
      // MuPDF can restore the trailer's Info reference when rewriting an xref stream.
      for (const key of keys) info.delete(key)
      trailer.delete("Info")
    }
  }
  visit(trailer.get("Root"))
  return counts
}

export function inspectPrivacy(bytes) {
  const document = new mupdf.PDFDocument(bytes)
  try { return scan(document) }
  finally { document.destroy() }
}

function save(document, options) {
  const output = document.saveToBuffer(options)
  try { return output.asUint8Array().slice() }
  finally { output.destroy() }
}

function findVisibleText(bytes, input) {
  if (typeof input !== "string" || !input.trim()) return undefined
  const document = new mupdf.PDFDocument(bytes)
  const normalize = text => text.toLowerCase().replace(/\s+/g, " ").trim()
  const expected = normalize(input.slice(0, 200))
  try {
    if (document.countPages() > 400) throw new Error("Text verification is limited to PDFs with up to 400 pages.")
    const found = []
    for (let index = 0; index < document.countPages(); index++) {
      const page = document.loadPage(index)
      try {
        const text = page.toStructuredText()
        try { if (normalize(text.asText()).includes(expected)) found.push(index + 1) }
        finally { text.destroy() }
      } finally { page.destroy() }
    }
    return found
  } finally { document.destroy() }
}

export function cleanPdf(bytes, categories, verifyText) {
  const allowed = ["metadata", "comments", "attachments", "scripts"]
  if (!Array.isArray(categories) || !categories.length || categories.some(category => !allowed.includes(category))) throw new Error("Choose supported categories to remove.")
  const document = new mupdf.PDFDocument(bytes)
  try {
    const before = scan(document)
    scan(document, new Set(categories))
    const output = save(document, "garbage=4,compress")
    const after = inspectPrivacy(output)
    const remaining = categories.filter(category => after[category] > 0)
    if (remaining.length) throw new Error("Could not remove " + remaining.map(category => privacyLabels[category]).join(", ") + ".")
    const matchingPages = findVisibleText(output, verifyText)
    if (matchingPages?.length) throw new Error("The phrase is still extractable on page(s) " + matchingPages.slice(0, 20).join(", ") + ". Redact every occurrence before sharing.")
    return { bytes: output, before, after, phraseChecked: Boolean(matchingPages) }
  } finally { document.destroy() }
}

function shrinkJpeg(document, object, quality, maxSide) {
  const color = object.get("ColorSpace").asName()
  if (object.get("Filter").asName() !== "DCTDecode" ||
      !["DeviceRGB", "DeviceGray"].includes(color) || object.get("BitsPerComponent").asNumber() !== 8 ||
      ["SMask", "Mask", "ImageMask", "Decode", "DecodeParms", "Alternates", "SMaskInData"].some(key => !object.get(key).isNull())) return
  const width = object.get("Width").asNumber(), height = object.get("Height").asNumber()
  if (Math.max(width, height) <= maxSide || width * height > 24000000) return
  const ratio = maxSide / Math.max(width, height)
  const original = object.readRawStream()
  let image, pixmap, small
  try {
    image = document.loadImage(object)
    pixmap = image.toPixmap()
    small = pixmap.warp([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
      Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)))
    const jpeg = small.asJPEG(quality)
    if (jpeg.length >= original.asUint8Array().length) return
    object.writeRawStream(jpeg)
    object.put("Width", small.getWidth())
    object.put("Height", small.getHeight())
    return true
  } finally { small?.destroy(); pixmap?.destroy(); image?.destroy(); original.destroy() }
}

export function optimizePdf(bytes, resize = false) {
  const document = new mupdf.PDFDocument(bytes)
  try {
    let changedImages = 0
    if (resize) {
      for (let index = 1; index < document.countObjects(); index++) {
        const object = document.newIndirect(index)
        try {
          if (object.isStream() && object.get("Subtype").asName() === "Image" && shrinkJpeg(document, object, 80, 1800)) changedImages++
        } finally { object.destroy() }
      }
    }
    const result = save(document, "garbage=4,compress,compress-fonts,compress-images")
    return result.length < bytes.length ? { bytes: result, changedImages } : { bytes, changedImages: 0 }
  } finally { document.destroy() }
}
