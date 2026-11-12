const { test } = require("node:test")
const assert = require("node:assert/strict")
const { PDFDocument } = require("pdf-lib")
const { start } = require("../server.cjs")

test("a multistroke signature exports and erases as a group with reversible history", async () => {
  const host = await start()
  try {
    const pdf = await PDFDocument.create()
    pdf.addPage([400, 500])
    await host.open("signature.pdf", Buffer.from(await pdf.save()))
    const headers = { Authorization: "Bearer " + host.owner, "Content-Type": "application/json" }
    const state = await (await fetch(host.address + "/api/state", { headers })).json()
    const id = state.document.id
    let operation = 0
    const edit = async body => {
      const result = await fetch(host.address + "/api/edit/" + id, { method: "POST", headers,
        body: JSON.stringify({ id: "signature-test-" + ++operation, ...body }) })
      assert.equal(result.status, 200, await result.clone().text())
      return result.json()
    }
    const placed = await edit({ kind: "signature", page: 1, color: "#144536", width: 2,
      strokes: [[[20, 30], [30, 40]], [[32, 40], [42, 30]]] })
    assert.equal(placed.marks.length, 2)
    assert.equal(placed.marks[0].group, placed.marks[1].group)
    assert.equal((await PDFDocument.load((await host.exportFile(id)).bytes)).getPageCount(), 1)
    const erased = await edit({ kind: "undo", target: placed.marks[0].id })
    assert.equal(erased.marks.length, 0)
    assert.equal((await edit({ kind: "history-undo" })).marks.length, 2)
    assert.equal((await edit({ kind: "history-redo" })).marks.length, 0)
  } finally { await new Promise(resolve => host.server.close(resolve)) }
})
