const { createWorker } = require("tesseract.js")
const language = require("@tesseract.js-data/eng")
const languages = {
  eng: language, fra: require("@tesseract.js-data/fra"), spa: require("@tesseract.js-data/spa")
}

async function recognize(image, scale, bounds, code = "eng") {
  if (!languages[code]) throw new Error("Choose a supported recognition language.")
  const worker = await createWorker(code, 1, {
    langPath: languages[code].langPath, gzip: true, cacheMethod: "none", errorHandler() {}
  })
  try {
    const { data } = await worker.recognize(image, {}, { blocks: true })
    return (data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines))
      .filter(line => line.text.trim())
      .map((line, index) => ({
        id: "ocr-" + index, text: line.text.trim(),
        rect: [
          line.bbox.x0 / scale + bounds[0], line.bbox.y0 / scale + bounds[1],
          line.bbox.x1 / scale + bounds[0], line.bbox.y1 / scale + bounds[1]
        ],
        size: Math.max(6, (line.bbox.y1 - line.bbox.y0) / scale * 1.15),
        confidence: line.confidence
      }))
  } finally { await worker.terminate() }
}

module.exports = { recognize }
