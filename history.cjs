function capture(document) {
  return {
    bytes: document.bytes, pages: document.pages,
    marks: structuredClone(document.marks), fields: { ...document.fields },
    wordEdits: { ...document.wordEdits }, wordFormats: structuredClone(document.wordFormats || {}),
    word: document.word, extension: document.extension, filename: document.filename, ocr: structuredClone(document.ocr)
  }
}

function remember(document, before) {
  document.undo.push(before)
  document.redo = []
  while (document.undo.length > 50 || document.undo.length > 1 &&
    new Set(document.undo.map(item => item.bytes)).size * document.bytes.length > 100 * 1024 * 1024) {
    document.undo.shift()
  }
}

function restore(document, direction) {
  const source = document[direction]
  if (!source.length) throw new Error("There are no changes to " + direction + ".")
  const target = direction === "undo" ? document.redo : document.undo
  target.push(capture(document))
  Object.assign(document, source.pop())
  document.contentVersion++
}

module.exports = { capture, remember, restore }
