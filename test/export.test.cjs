const { test } = require("node:test")
const assert = require("node:assert/strict")
const { PDFDocument } = require("pdf-lib")
const { start } = require("../server.cjs")

test("fixed PDF exports retain answers and save state tracks the exported revision", async () => {
  const host = await start()
  const headers = { Authorization: "Bearer " + host.owner, "Content-Type": "application/json" }
  const state = async () => (await (await fetch(host.address + "/api/state", { headers })).json()).document
  try {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage()
    pdf.getForm().createTextField("Answer").addToPage(page, { x: 30, y: 300, width: 200, height: 30 })
    await host.open("answers.pdf", Buffer.from(await pdf.save()))
    const id = (await state()).id
    assert.equal((await state()).dirty, false)
    const edit = async (value, suffix) => {
      const response = await fetch(host.address + "/api/edit/" + id, { method: "POST", headers,
        body: JSON.stringify({ id: "export-field-" + suffix, kind: "field", name: "Answer", value }) })
      assert.equal(response.status, 200)
    }
    await edit("Completed answer", "first")
    assert.equal((await state()).dirty, true)
    const normal = await host.exportFile(id)
    assert.equal((await PDFDocument.load(normal.bytes)).getForm().getTextField("Answer").getText(), "Completed answer")
    const fixed = await host.exportFile(id, { flatten: true })
    assert.equal(fixed.filename, "answers - final.pdf")
    const reopened = await PDFDocument.load(fixed.bytes)
    assert.equal(reopened.getForm().getFields().length, 0)
    assert.equal(reopened.getPageCount(), 1)
    await host.markSaved(id, normal.changeNumber)
    assert.equal((await state()).dirty, false)
    await edit("Later answer", "second")
    await host.markSaved(id, normal.changeNumber)
    assert.equal((await state()).dirty, true)
    assert.equal((await PDFDocument.load((await host.exportFile(id)).bytes)).getForm().getTextField("Answer").getText(), "Later answer")
    const download = await fetch(host.address + "/api/save/" + id + "?ack=1", { headers })
    await download.arrayBuffer()
    assert.equal((await state()).dirty, true, "Preparing a native download must not mark it saved")
    const receipt = download.headers.get("X-Elleson-Save-Receipt")
    assert.ok(receipt)
    assert.equal((await fetch(host.address + "/api/saved/" + receipt, { method: "POST", headers })).status, 204)
    assert.equal((await state()).dirty, false)
  } finally {
    await new Promise(resolve => host.server.close(resolve))
  }
})
