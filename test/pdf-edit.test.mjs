import { test } from "node:test"
import assert from "node:assert/strict"
import * as mupdf from "mupdf"
import { readFile } from "node:fs/promises"
import { extract, replace } from "../pdf-edit.mjs"

test("existing PDF text is replaced with the original font, size, color and position", async () => {
  const buffer = new mupdf.Buffer()
  const writer = new mupdf.DocumentWriter(buffer, "pdf", "")
  const device = writer.beginPage([0, 0, 400, 500])
  const font = new mupdf.Font("Arial", await readFile("C:/Windows/Fonts/arialbd.ttf"))
  for (const [value, size, y] of [["Original heading", 18, 100], ["Keep this line", 12, 150]]) {
    const text = new mupdf.Text()
    text.showString(font, [size, 0, 0, -size, 40, y], value)
    device.fillText(text, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, [0, .2, .1], 1)
    text.destroy()
  }
  writer.endPage()
  writer.close()
  const input = Uint8Array.from(buffer.asUint8Array())
  device.destroy()
  writer.destroy()
  buffer.destroy()
  font.destroy()
  const spans = extract(input, 0)
  assert.equal(spans[0].text, "Original heading")
  const output = replace(input, 0, spans[0].id, spans[0].text, "Updated heading")
  const edited = extract(output, 0)
  const replaced = edited.find(span => span.text === "Updated heading")
  assert.equal(replaced.font, spans[0].font)
  assert.equal(replaced.size, spans[0].size)
  assert.deepEqual(replaced.color, spans[0].color)
  assert.deepEqual(replaced.quad[0], spans[0].quad[0])
  assert.ok(edited.some(span => span.text === "Keep this line"))
  assert.ok(!edited.some(span => span.text.includes("Original")))
  const reopened = new mupdf.PDFDocument(output)
  assert.equal(reopened.countPages(), 1)
  reopened.destroy()
  assert.throws(() => replace(input, 0, spans[0].id, "stale text", "Updated"), /changed/)
  assert.throws(() => replace(input, 0, spans[0].id, spans[0].text, "X".repeat(300)), /available space/)
})
