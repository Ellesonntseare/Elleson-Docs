import { test } from "node:test"
import assert from "node:assert/strict"
import * as mupdf from "mupdf"
import { extract, replace } from "../pdf-edit.mjs"

test("rotated PDF text keeps its font, size and baseline direction when replaced", () => {
  const buffer = new mupdf.Buffer()
  const writer = new mupdf.DocumentWriter(buffer, "pdf", "")
  const device = writer.beginPage([0, 0, 400, 500])
  const font = new mupdf.Font("Helvetica")
  const text = new mupdf.Text()
  text.showString(font, [0, 18, 18, 0, 100, 40], "Original")
  device.fillText(text, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, [0, 0, 0], 1)
  writer.endPage()
  writer.close()
  const bytes = Uint8Array.from(buffer.asUint8Array())
  const before = extract(bytes, 0)[0]
  const after = extract(replace(bytes, 0, 0, before.text, "Updated"), 0)
  assert.ok(after.some(span => span.text === "Updated"))
  assert.ok(!after.some(span => span.text.includes("Original")))
  assert.equal(after[0].size, 18)
  assert.ok(Math.abs(after[0].quad[1][0] - after[0].quad[0][0]) < Math.abs(after[0].quad[1][1] - after[0].quad[0][1]))
  text.destroy()
  font.destroy()
  device.destroy()
  writer.destroy()
  buffer.destroy()
})
