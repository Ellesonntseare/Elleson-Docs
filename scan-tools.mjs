import {pageCorners} from "./scan-detection.mjs"
import { PDFDocument, StandardFonts } from "pdf-lib"
import { applyScanFilter } from "./scan-filters.mjs"
export const defaultCorners = () => [[0, 0], [1, 0], [1, 1], [0, 1]]
function valid(points) {
  return Array.isArray(points) && points.length === 4 && points.every(point => Array.isArray(point) && point.length === 2 && point.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) && points.every((a, index) => { const b = points[(index + 1) % 4], c = points[(index + 2) % 4]; return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) > .0001 })
}
export async function detectCorners(file) {
  const image = await createImageBitmap(file, { imageOrientation: "from-image" })
  try {
    const scale = Math.min(1, 500 / Math.max(image.width, image.height)), canvas = document.createElement("canvas")
    canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale)
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return pageCorners(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height)
  } finally { image.close() }
}
function homography(points) {
  const rows = []
  ;[[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([x, y], index) => { const [u, v] = points[index]; rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]) })
  for (let column = 0; column < 8; column++) {
    let pivot = column
    for (let row = column + 1; row < 8; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row
    ;[rows[column], rows[pivot]] = [rows[pivot], rows[column]]
    if (Math.abs(rows[column][column]) < 1e-10) throw new Error("Choose four distinct page corners.")
    const divisor = rows[column][column]; rows[column] = rows[column].map(value => value / divisor)
    for (let row = 0; row < 8; row++) if (row !== column) { const factor = rows[row][column]; rows[row] = rows[row].map((value, index) => value - rows[column][index] * factor) }
  }
  return rows.map(row => row[8])
}
export async function prepareImage(file, options = {}) {
  const image = await createImageBitmap(file, { imageOrientation: "from-image" })
  try {
    const scale = Math.min(1, 2000 / Math.max(image.width, image.height)), sourceCanvas = document.createElement("canvas")
    sourceCanvas.width = Math.round(image.width * scale); sourceCanvas.height = Math.round(image.height * scale)
    const sourceContext = sourceCanvas.getContext("2d"); sourceContext.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height)
    const corners = options.corners || defaultCorners()
    if (!valid(corners)) throw new Error("Set corners clockwise: top left, top right, bottom right, bottom left.")
    const points = corners.map(([x, y]) => [x * (sourceCanvas.width - 1), y * (sourceCanvas.height - 1)]), distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
    const width = Math.max(20, Math.round(Math.max(distance(points[0], points[1]), distance(points[3], points[2])))), height = Math.max(20, Math.round(Math.max(distance(points[0], points[3]), distance(points[1], points[2]))))
    const source = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data, canvas = document.createElement("canvas")
    canvas.width = width; canvas.height = height
    const context = canvas.getContext("2d"), output = context.createImageData(width, height), h = homography(points)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const nx = x / Math.max(1, width - 1), ny = y / Math.max(1, height - 1), denominator = h[6] * nx + h[7] * ny + 1
      const sx = Math.max(0, Math.min(sourceCanvas.width - 1, Math.round((h[0] * nx + h[1] * ny + h[2]) / denominator))), sy = Math.max(0, Math.min(sourceCanvas.height - 1, Math.round((h[3] * nx + h[4] * ny + h[5]) / denominator)))
      const from = (sy * sourceCanvas.width + sx) * 4, to = (y * width + x) * 4
      for (let channel = 0; channel < 3; channel++) output.data[to + channel] = source[from + channel]
      output.data[to + 3] = 255
    }
    applyScanFilter(output.data, width, height, options)
    context.putImageData(output, 0, 0)
    const rad = Math.max(-15, Math.min(15, Number(options.angle) || 0)) * Math.PI / 180, rotated = document.createElement("canvas")
    rotated.width = Math.ceil(Math.abs(width * Math.cos(rad)) + Math.abs(height * Math.sin(rad))); rotated.height = Math.ceil(Math.abs(height * Math.cos(rad)) + Math.abs(width * Math.sin(rad)))
    const draw = rotated.getContext("2d"); draw.fillStyle = "white"; draw.fillRect(0, 0, rotated.width, rotated.height); draw.translate(rotated.width / 2, rotated.height / 2); draw.rotate(rad); draw.drawImage(canvas, -width / 2, -height / 2)
    return new Promise((resolve, reject) => rotated.toBlob(blob => blob ? resolve(blob) : reject(new Error("Photo conversion failed.")), "image/png"))
  } finally { image.close() }
}
export async function imagesToPdf(pages) {
  if (!pages.length || pages.length > 30) throw new Error("Capture between 1 and 30 pages.")
  const pdf = await PDFDocument.create()
  for (const item of pages) {
    const bitmap = await pdf.embedPng(await (await prepareImage(item.file, item)).arrayBuffer()), size = bitmap.width > bitmap.height ? [842, 595] : [595, 842], page = pdf.addPage(size)
    const scale = Math.min((size[0] - 40) / bitmap.width, (size[1] - 40) / bitmap.height), width = bitmap.width * scale, height = bitmap.height * scale
    page.drawImage(bitmap, { x: (size[0] - width) / 2, y: (size[1] - height) / 2, width, height })
  }
  const bytes = await pdf.save()
  if (bytes.length > 40 * 1024 * 1024) throw new Error("This scan exceeds 40 MB. Use fewer pages.")
  return new File([bytes], pages[0].file.name.replace(/\.[^.]+$/, "") + ".pdf", { type: "application/pdf" })
}
export const imageToPdf = (file, angle = 0) => imagesToPdf([{ file, angle }])

export async function filteredPdf(bytes,images){
  const pdf=await PDFDocument.load(bytes)
  const font=images.some(item=>item.ocr)?await pdf.embedFont(StandardFonts.Helvetica):null
  for(const item of images){
    const old=pdf.getPage(item.index),size=old.getSize(),angle=old.getRotation().angle
    if(angle===90||angle===270)[size.width,size.height]=[size.height,size.width]
    const image=await pdf.embedPng(await item.blob.arrayBuffer())
    pdf.removePage(item.index)
    const page=pdf.insertPage(item.index,[size.width,size.height])
    page.drawImage(image,{x:0,y:0,width:size.width,height:size.height})
    for(const block of item.ocr?.blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[])for(const word of line.words||[]){
      const value=word.text?.trim()
      if(!value)continue
      try{font.encodeText(value)}catch{continue}
      const box=word.bbox
      const sx=size.width/image.width,sy=size.height/image.height
      const sizePt=Math.max(1,Math.min((box.y1-box.y0)*sy,(box.x1-box.x0)*sx/Math.max(.1,font.widthOfTextAtSize(value,1))))
      page.drawText(value,{x:box.x0*sx,y:size.height-box.y1*sy,size:sizePt,font,opacity:0})
    }
  }
  return pdf.save()
}
