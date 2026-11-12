import { test } from "node:test"
import assert from "node:assert/strict"
import { PDFDocument } from "pdf-lib"
import { organize } from "../pdf-edit.mjs"

test("page operations preserve form answers and fixed combination retains both documents", async () => {
  const pdf = await PDFDocument.create()
  pdf.addPage()
  const middle = pdf.addPage()
  pdf.addPage()
  pdf.getForm().createTextField("Name").addToPage(middle, { x: 30, y: 400, width: 120, height: 25 })
  pdf.getForm().getTextField("Name").setText("Preserved")
  const bytes = await pdf.save()
  const reordered = organize(bytes, "reorder", [2, 1, 0])
  assert.equal((await PDFDocument.load(reordered.bytes)).getForm().getTextField("Name").getText(), "Preserved")
  const extracted = organize(bytes, "extract", [1])
  const result = await PDFDocument.load(extracted.bytes)
  assert.equal(result.getPageCount(), 1)
  assert.equal(result.getForm().getTextField("Name").getText(), "Preserved")
  const rotated = organize(bytes, "rotate", [0])
  assert.equal((await PDFDocument.load(rotated.bytes)).getPage(0).getRotation().angle, 90)
  assert.equal(organize(bytes, "delete", [0]).pages, 2)
  assert.throws(() => organize(bytes, "delete", [0, 1, 2]), /Keep/)
  assert.throws(() => organize(bytes, "reorder", [0, 0, 1]), /unique/)
  const combined = organize(bytes, "combine", null, bytes)
  const merged = await PDFDocument.load(combined.bytes)
  assert.equal(merged.getPageCount(), 6)
  assert.equal(merged.getForm().getFields().length, 0)
})
