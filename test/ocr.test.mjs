import { test } from "node:test"
import assert from "node:assert/strict"
import { PDFDocument, StandardFonts } from "pdf-lib"
import { createRequire } from "node:module"
import { extract, replace, scanImage } from "../pdf-edit.mjs"
const require = createRequire(import.meta.url)
const { recognize } = require("../ocr.cjs")

test("a scanned page is recognized and its printed words can be replaced", { timeout: 60000 }, async () => {
  const source = await PDFDocument.create()
  source.addPage([420, 400]).drawText("Visitor name", { x: 35, y: 310, size: 22, font: await source.embedFont(StandardFonts.Helvetica) })
  const image = scanImage(await source.save(), 0)
  const scan = await PDFDocument.create()
  const bitmap = await scan.embedPng(image.image)
  scan.addPage([420, 400]).drawImage(bitmap, { x: 0, y: 0, width: 420, height: 400 })
  const bytes = await scan.save()
  assert.equal(extract(bytes, 0).length, 0)
  const rendered = scanImage(bytes, 0)
  const lines = await recognize(rendered.image, rendered.scale, rendered.bounds)
  const line = lines.find(item => /Visitor name/i.test(item.text))
  assert.ok(line, "The scan must contain recognized text")
  const edited = replace(bytes, 0, line.id, line.text, "Guest name", line)
  assert.ok(extract(edited, 0).some(item => item.text === "Guest name"))
})
