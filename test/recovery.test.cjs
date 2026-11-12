const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const { PDFDocument } = require("pdf-lib")
const { start } = require("../server.cjs")

test("acknowledged changes recover after the PC host restarts", async () => {
  const directory = await fs.mkdtemp(path.join(__dirname, "../.build/recovery-test-"))
  const first = await start(0, directory)
  const pdf = await PDFDocument.create()
  pdf.addPage()
  await first.open("recovery.pdf", Buffer.from(await pdf.save()))
  const headers = { Authorization: "Bearer " + first.owner, "Content-Type": "application/json" }
  const state = await (await fetch(first.address + "/api/state", { headers })).json()
  const edit = await fetch(first.address + "/api/edit/" + state.document.id, {
    method: "POST", headers,
    body: JSON.stringify({ id: "recovery-edit-123", kind: "text", page: 1, value: "Recovered text", at: [40, 400], size: 12, angle: 0 })
  })
  assert.equal(edit.status, 200)
  await new Promise(resolve => first.server.close(resolve))
  const second = await start(0, directory)
  try {
    const resumed = await (await fetch(second.address + "/api/state", { headers: { Authorization: "Bearer " + second.owner } })).json()
    assert.equal(resumed.document.id, state.document.id)
    assert.equal(resumed.document.marks[0].value, "Recovered text")
    const exported = await second.exportFile(resumed.document.id)
    assert.equal((await PDFDocument.load(exported.bytes)).getPageCount(), 1)
  } finally {
    await new Promise(resolve => second.server.close(resolve))
  }
})
