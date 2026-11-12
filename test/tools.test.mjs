import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { PDFDocument, StandardFonts } from "pdf-lib"
import { Document, Paragraph, Packer } from "docx"
import { DOMParser, XMLSerializer } from "@xmldom/xmldom"
import { strFromU8, strToU8, zipSync } from "fflate"
import { readWord, saveWord } from "../word.cjs"
import { editWord } from "../word-tools.mjs"
import { review, reviewList, images, image, combineEditable } from "../pdf-tools.mjs"
import { changeMarks } from "../mark-tools.mjs"
import { extract, replace } from "../pdf-edit.mjs"

test("PDF review annotations, replies and image replacement survive export", async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([400, 500])
  let bytes = await pdf.save()
  bytes = review(bytes, { id: "note-one", type: "Text", page: 1, text: "Review this answer", rect: [30, 40, 52, 62] })
  bytes = review(bytes, { id: "note-two", type: "Text", page: 1, text: "Reviewed", replyTo: "note-one", rect: [60, 40, 82, 62] })
  bytes = review(bytes, { id: "underline-one", type: "Underline", page: 1, text: "Check wording", rect: [30, 100, 130, 115] })
  const notes = reviewList(bytes, 0)
  assert.equal(notes.length, 3); assert.equal(notes[1].replyTo, "note-one")
  const png = await fs.readFile(new URL("../web/logo.png", import.meta.url))
  bytes = await image(bytes, png, { page: 1, rect: [30, 200, 130, 300] })
  assert.equal(images(bytes, 0).length, 1)
  bytes = await image(bytes, png, { page: 1, replace: 0, rect: [30, 200, 150, 320] })
  assert.ok(images(bytes, 0).some(item => item.rect[2] >= 149))
  assert.equal(reviewList(bytes, 0).length, 3)
})
test("editable PDF combination retains independently editable answers with unique names", async () => {
  const documents = []
  for (const value of ["First answer", "Second answer"]) {
    const pdf = await PDFDocument.create(), page = pdf.addPage([400, 500])
    const field = pdf.getForm().createTextField("Answer"); field.addToPage(page, { x: 30, y: 350, width: 200, height: 30 }); field.setText(value)
    documents.push(await pdf.save())
  }
  const combined = await combineEditable(documents[0], documents[1]), pdf = await PDFDocument.load(combined.bytes)
  assert.equal(pdf.getPageCount(), 2)
  const fields = pdf.getForm().getFields()
  assert.equal(fields.length, 2); assert.notEqual(fields[0].getName(), fields[1].getName())
  assert.deepEqual(fields.map(field => field.getText()).sort(), ["First answer", "Second answer"])
  fields[1].setText("Updated independently")
  assert.equal((await PDFDocument.load(await pdf.save())).getForm().getFields()[1].getText(), "Updated independently")
})
test("Word tools preserve selected-word formatting, structural edits and header/footer parts", async () => {
  let source = await readWord(await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("First second third")] }] })), "docx")
  const run = async edit => {
    editWord(source.document, source.archive, edit, DOMParser, XMLSerializer, strFromU8, strToU8)
    source.archive["word/document.xml"] = strToU8(new XMLSerializer().serializeToString(source.document))
    source = await readWord(Buffer.from(zipSync(source.archive)), "docx")
  }
  await run({ action: "range", index: 0, start: 6, end: 12, format: { bold: true, font: "Georgia" } })
  const ns = source.document.documentElement.namespaceURI
  const runs = Array.from(source.document.getElementsByTagNameNS(ns, "r"))
  assert.equal(runs[1].textContent, "second"); assert.equal(runs[1].getElementsByTagNameNS(ns, "b").length, 1)
  assert.equal(runs[0].getElementsByTagNameNS(ns, "b").length, 0)
  await run({ action: "split", index: 0, offset: 6 })
  assert.equal(source.lines[0].text, "First "); assert.equal(source.lines[1].text, "second third")
  await run({ action: "header-footer", index: 0, header: "My header", footer: "Page ", pageNumbers: true })
  assert.ok(Object.keys(source.archive).some(name => name.includes("Ellesonheader")))
  assert.ok(Object.keys(source.archive).some(name => name.includes("Ellesonfooter")))
  source = await readWord(await saveWord(source, {}, {}, { index: 0, rows: 2, columns: 2 }), "docx")
  await run({ action: "add-row", index: 1 }); await run({ action: "add-column", index: 1 })
  assert.equal(source.document.getElementsByTagNameNS(ns, "tr").length, 3)
  assert.equal(source.document.getElementsByTagNameNS(ns, "tc").length, 9)
  await run({ action: "delete-row", index: 1 }); await run({ action: "delete-column", index: 1 })
  assert.equal(source.document.getElementsByTagNameNS(ns, "tc").length, 4)
})
test("added-content transforms retain signature grouping and PDF paragraphs reflow", async () => {
  const marks = [{ id: "a", group: "signature", kind: "ink", page: 1, points: [[10, 20], [30, 40]], width: 2 }, { id: "b", group: "signature", kind: "ink", page: 1, points: [[30, 40], [50, 20]], width: 2 }]
  const moved = changeMarks(marks, { id: "transform-one", target: "a", action: "apply", dx: 10, dy: 20, scale: 2, angle: 90 })
  assert.equal(moved.length, 2); assert.equal(moved[0].width, 4); assert.deepEqual(marks[0].points[0], [10, 20])
  assert.equal(changeMarks(moved, { id: "duplicate-one", target: "a", action: "duplicate", dx: 20 }).length, 4)
  const pdf = await PDFDocument.create(), page = pdf.addPage([500, 600]), font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText("First line", { x: 40, y: 500, size: 16, font }); page.drawText("Second line", { x: 40, y: 478, size: 16, font })
  const bytes = await pdf.save(), spans = extract(bytes, 0)
  const edited = replace(bytes, 0, 0, spans[0].text, "A paragraph that wraps onto several lines", undefined, undefined, { paragraph: true, lines: 2, width: 180, height: 90, spacing: 1.3, align: "left" })
  const text = extract(edited, 0).map(span => span.text).join(" ")
  assert.match(text, /A paragraph/); assert.doesNotMatch(text, /Second line/)
})
