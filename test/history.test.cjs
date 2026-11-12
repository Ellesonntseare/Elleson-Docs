const { test } = require("node:test")
const assert = require("node:assert/strict")
const { PDFDocument } = require("pdf-lib")
const { Document, Paragraph, Packer } = require("docx")
const { start } = require("../server.cjs")
const { readWord } = require("../word.cjs")

test("undo and redo restore PDF changes and Word text after exporting", async () => {
  const host = await start()
  let operation = 0
  const headers = { Authorization: "Bearer " + host.owner, "Content-Type": "application/json" }
  const state = async () => (await (await fetch(host.address + "/api/state", { headers })).json()).document
  const edit = async change => {
    const current = await state()
    const response = await fetch(host.address + "/api/edit/" + current.id, {
      method: "POST", headers, body: JSON.stringify({ ...change, id: "history-operation-" + ++operation })
    })
    assert.equal(response.status, 200, await response.clone().text())
    return response.json()
  }
  try {
    const pdf = await PDFDocument.create()
    pdf.addPage().drawText("Original heading", { x: 40, y: 700, size: 16 })
    await host.open("history.pdf", Buffer.from(await pdf.save()))
    await edit({ kind: "text", page: 1, at: [40, 300], angle: 0, size: 12, value: "First entry" })
    await edit({ kind: "field", name: "Sample", value: "Changed" })
    assert.equal((await edit({ kind: "history-undo" })).fields.Sample, undefined)
    assert.equal((await edit({ kind: "history-undo" })).marks.length, 0)
    assert.equal((await edit({ kind: "history-redo" })).marks[0].value, "First entry")
    await edit({ kind: "text", page: 1, at: [40, 250], angle: 0, size: 12, value: "New branch" })
    assert.equal((await state()).canRedo, false)
    const engine = await import("../pdf-edit.mjs")
    const original = await state()
    await edit({ kind: "replace", page: 1, span: 0, version: original.contentVersion, before: "Original heading", value: "Updated heading" })
    assert.ok(engine.extract((await host.exportFile(original.id)).bytes, 0).some(span => span.text === "Updated heading"))
    await edit({ kind: "history-undo" })
    assert.ok(engine.extract((await host.exportFile(original.id)).bytes, 0).some(span => span.text === "Original heading"))
    await edit({ kind: "history-redo" })
    assert.ok(engine.extract((await host.exportFile(original.id)).bytes, 0).some(span => span.text === "Updated heading"))
    const word = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("Original text")] }] }))
    await host.open("history.docx", word)
    await edit({ kind: "word", index: 0, before: "Original text", value: "Revised text" })
    const id = (await state()).id
    await host.exportFile(id)
    await edit({ kind: "history-undo" })
    const undone = await readWord((await host.exportFile(id)).bytes, "docx")
    assert.equal(undone.lines[0].text, "Original text")
    await edit({ kind: "history-redo" })
    const redone = await readWord((await host.exportFile(id)).bytes, "docx")
    assert.equal(redone.lines[0].text, "Revised text")
  } finally {
    await new Promise(resolve => host.server.close(resolve))
  }
})
