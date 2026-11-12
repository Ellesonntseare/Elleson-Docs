import { PDFDocument } from "pdf-lib"

export async function imageToPdf(file, angle = 0) {
  const image = await createImageBitmap(file, { imageOrientation: "from-image" })
  try {
    const factor = Math.min(1, 2600 / Math.max(image.width, image.height))
    const radians = Math.max(-15, Math.min(15, Number(angle) || 0)) * Math.PI / 180
    const originalWidth = image.width * factor, originalHeight = image.height * factor
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(Math.abs(originalWidth * Math.cos(radians)) + Math.abs(originalHeight * Math.sin(radians)))
    canvas.height = Math.round(Math.abs(originalHeight * Math.cos(radians)) + Math.abs(originalWidth * Math.sin(radians)))
    const context = canvas.getContext("2d")
    context.fillStyle = "white"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.translate(canvas.width / 2, canvas.height / 2)
    context.rotate(radians)
    context.drawImage(image, -originalWidth / 2, -originalHeight / 2, originalWidth, originalHeight)
    const blob = await new Promise((resolve, reject) => canvas.toBlob(result =>
      result ? resolve(result) : reject(new Error("The photo could not be converted.")), "image/png"))
    const pdf = await PDFDocument.create()
    const bitmap = await pdf.embedPng(await blob.arrayBuffer())
    const size = canvas.width > canvas.height ? [842, 595] : [595, 842]
    const page = pdf.addPage(size)
    const scale = Math.min((size[0] - 40) / canvas.width, (size[1] - 40) / canvas.height)
    const width = canvas.width * scale, height = canvas.height * scale
    page.drawImage(bitmap, { x: (size[0] - width) / 2, y: (size[1] - height) / 2, width, height })
    return new File([await pdf.save()], file.name.replace(/\.[^.]+$/, "") + ".pdf", { type: "application/pdf" })
  } finally { image.close() }
}
