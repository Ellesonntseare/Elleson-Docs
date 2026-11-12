import { PDFDocument, StandardFonts } from 'pdf-lib'
import { Document, Paragraph, Packer, ImageRun } from 'docx'
import { unzipSync, strFromU8, zipSync } from 'fflate'

export function pageSize(options = {}) {
  let size = options.size === 'letter' ? [612, 792] : options.size === 'custom'
    ? [Number(options.width) * 72 / 25.4, Number(options.height) * 72 / 25.4] : [595.28, 841.89]
  if (size.some(n => !Number.isFinite(n) || n < 72 || n > 2880)) throw new Error('Page dimensions must be between 25.4 and 1016 mm.')
  if (options.landscape) size = [Math.max(...size), Math.min(...size)]
  return size
}
export function selectedPages(value, count) {
  if (!value?.trim()) return Array.from({ length: count }, (_, i) => i)
  const pages = []
  for (const part of value.split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!match) throw new Error('Use page numbers such as 1,3-5.')
    const start = Number(match[1]), end = Number(match[2] || start)
    if (start < 1 || end > count || start > end) throw new Error('Selected pages are outside this document.')
    for (let n = start; n <= end; n++) if (!pages.includes(n - 1)) pages.push(n - 1)
  }
  return pages
}
export function archive(outputs) {
  const files = {}
  for (const output of outputs) {
    const safe = output.name.replace(/[\\/:*?"<>|]/g, '_')
    let name = safe, i = 2
    while (files[name]) name = safe.replace(/(\.[^.]+)?$/, (_, ext = '') => ` (${i++})${ext}`)
    files[name] = output.bytes
  }
  return zipSync(files)
}
export async function wordBytes(text, images = []) {
  const children = text.split('\n').map(line => new Paragraph(line))
  for (const image of images) children.push(new Paragraph({ children: [new ImageRun({ data: image.bytes, type: 'png', transformation: { width: image.width, height: image.height } })] }))
  return new Uint8Array(await Packer.toArrayBuffer(new Document({ sections: [{ children }] })))
}
export function wordText(bytes) {
  const data = unzipSync(bytes), xml = data['word/document.xml']
  if (!xml) throw new Error('This is not a supported DOCX document.')
  const document = new DOMParser().parseFromString(strFromU8(xml), 'application/xml')
  return [...document.getElementsByTagNameNS('*', 'p')].map(p => [...p.getElementsByTagNameNS('*', 't')].map(t => t.textContent).join('')).join('\n')
}
export async function textPdf(text, options) {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), size = pageSize(options)
  const margin = Number(options.margin ?? 12) * 72 / 25.4, lineHeight = 16, width = size[0] - margin * 2
  if (!Number.isFinite(margin) || margin < 0 || width < 36 || size[1] - margin * 2 < 36) throw new Error('Margins leave too little space on this page.')
  let page, y
  const line = value => {
    if (!page || y < margin + lineHeight) { page = pdf.addPage(size); y = size[1] - margin - 12 }
    try { page.drawText(value, { x: margin, y, size: 11, font }) }
    catch { throw new Error('This text needs a font not supported by text-to-PDF yet. Export as Word or text to preserve it.') }
    y -= lineHeight
  }
  for (const paragraph of text.split('\n')) {
    let pending = ''
    for (const character of paragraph) {
      let measured
      try { measured = font.widthOfTextAtSize(pending + character, 11) } catch { throw new Error('This text needs a font not supported by text-to-PDF yet. Export as Word or text instead.') }
      if (pending && measured > width) { line(pending); pending = '' }
      pending += character
    }
    line(pending)
  }
  return new Uint8Array(await pdf.save())
}
export async function imageData(file) {
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    if (image.width * image.height > 60000000) throw new Error('Image is too large. Resize it below 60 megapixels.')
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    canvas.getContext('2d').drawImage(image, 0, 0)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: image.width, height: image.height }
  } finally { image.close() }
}
export async function imagePdf(file, options) {
  const pdf = await PDFDocument.create(), image = await pdf.embedPng((await imageData(file)).bytes), size = pageSize(options), page = pdf.addPage(size)
  const margin = Number(options.margin ?? 12) * 72 / 25.4, width = size[0] - margin * 2, height = size[1] - margin * 2
  if (!Number.isFinite(margin) || margin < 0 || Math.min(width, height) < 36) throw new Error('Margins leave too little space on this page.')
  const scale = (options.fit === 'fill' ? Math.max : Math.min)(width / image.width, height / image.height)
  // Fill uses a page-sized image; fit preserves the complete image and margins.
  page.drawImage(image, { x: (size[0] - image.width * scale) / 2, y: (size[1] - image.height * scale) / 2, width: image.width * scale, height: image.height * scale })
  return new Uint8Array(await pdf.save())
}
export async function combinePdfs(inputs, check = () => {}) {
  const output = await PDFDocument.create()
  for (const bytes of inputs) {
    check()
    const pdf = await PDFDocument.load(bytes)
    for (const page of await output.copyPages(pdf, pdf.getPageIndices())) output.addPage(page)
  }
  return new Uint8Array(await output.save())
}
export async function extractPages(bytes, selection) {
  const source = await PDFDocument.load(bytes), output = await PDFDocument.create()
  for (const page of await output.copyPages(source, selectedPages(selection, source.getPageCount()))) output.addPage(page)
  return new Uint8Array(await output.save())
}
export async function rasterPdf(pdfjs, bytes, options, progress, check, preview) {
  const task = pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/' })
  const outputs = [], output = await PDFDocument.create()
  try {
    const source = await task.promise, pages = selectedPages(options.pages, source.numPages)
    for (let i = 0; i < pages.length; i++) {
      check(); progress(`Page ${i + 1} of ${pages.length}`)
      const page = await source.getPage(pages[i] + 1), natural = page.getViewport({ scale: 1 })
      const frame = page.getViewport({ scale: Math.min(Number(options.dpi || 120) / 72, 3000 / Math.max(natural.width, natural.height)) })
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(frame.width); canvas.height = Math.ceil(frame.height)
      await page.render({ canvas, viewport: frame, background: 'white' }).promise
      check()
      const blob = await new Promise(resolve => canvas.toBlob(resolve, options.target === 'png' ? 'image/png' : 'image/jpeg', Number(options.quality || .75)))
      if (i === 0) preview?.(blob)
      const image = new Uint8Array(await blob.arrayBuffer())
      if (options.target === 'compress') {
        const embedded = await output.embedJpg(image)
        output.addPage([natural.width, natural.height]).drawImage(embedded, { x: 0, y: 0, width: natural.width, height: natural.height })
      } else outputs.push({ name: `Page ${pages[i] + 1}.${options.target}`, bytes: image })
      canvas.width = canvas.height = 0
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    return options.target === 'compress' ? new Uint8Array(await output.save()) : outputs
  } finally { await task.destroy() }
}
