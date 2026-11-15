function capture(document) {
  return {
    bytes: document.bytes, pages: document.pages,
    marks: structuredClone(document.marks), fields: { ...document.fields }, originalFields: { ...document.originalFields },
    wordEdits: { ...document.wordEdits }, wordFormats: structuredClone(document.wordFormats || {}),
    word: document.word, extension: document.extension, filename: document.filename, ocr: structuredClone(document.ocr)
  }
}

function remember(document, before, label) {
  before.historyLabel = label
  document.undo.push(before)
  document.redo = []
  const size = () => {
    const bytes = new Set(document.undo.map(item => item.bytes)), words = new Set(document.undo.map(item => item.word).filter(Boolean))
    return [...bytes].reduce((sum, item) => sum + item.length, 0) + [...words].reduce((sum, item) => sum + Object.values(item.archive || {}).reduce((size, data) => size + data.length, 0), 0)
      + document.undo.reduce((sum, item) => sum + item.marks.reduce((size, mark) => size + (mark.points?.length || 0) * 24 + (mark.value?.length || 0) * 2, 0), 0)
  }
  while (document.undo.length > 50 || document.undo.length > 1 && size() > 100 * 1024 * 1024) {
    document.undo.shift()
  }
}

function restore(document, direction) {
  const source = document[direction]
  if (!source.length) throw new Error("There are no changes to " + direction + ".")
  const target = direction === "undo" ? document.redo : document.undo
  const entry = source.pop()
  target.push({...capture(document),historyLabel:entry.historyLabel})
  const {historyLabel,...state}=entry
  Object.assign(document,state)
  document.contentVersion++
}

module.exports = { capture, remember, restore }
