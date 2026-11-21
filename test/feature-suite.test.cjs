const { test } = require("node:test")
const assert = require("node:assert/strict")
const { start } = require("../server.cjs")
const { PDFDocument, PDFName, PDFString } = require("pdf-lib")
const { Document, Paragraph, Packer } = require("docx")
const { mkdtemp, rm } = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")

async function call(host, route, credential, options = {}) {
  return fetch(host.address + "/api/" + route, {
    method: options.body === undefined ? "GET" : "POST",
    headers: {
      ...(credential ? { Authorization: "Bearer " + credential } : {}),
      ...(options.bytes ? { "Content-Type": "application/octet-stream" } : { "Content-Type": "application/json" }),
      ...options.headers
    },
    body: options.body === undefined ? undefined : options.bytes ? options.body : JSON.stringify(options.body)
  })
}
async function ok(response) {
  assert.ok(response.ok, response.status + " " + (await response.clone().text()).slice(0, 500))
  return response
}
const json = async response => (await ok(await response)).json()
const pdfFixture = async phrase => {
  const pdf = await PDFDocument.create()
  pdf.addPage([400, 500]).drawText(phrase, { x: 30, y: 440 })
  return pdf
}

test("PDF form authoring updates widgets, fills atomically, and preserves text", async () => {
  const { authorForm, inspectForm } = await import("../form-authoring.mjs")
  const form = [
    { action: "create", type: "text", name: "Full name", label: "Your name", required: true, page: 1, x: 30, y: 365, width: 150, height: 20 },
    { action: "create", type: "checkbox", name: "Agree", page: 1, x: 30, y: 310, width: 20, height: 20 },
    { action: "create", type: "dropdown", name: "Work type", page: 1, x: 30, y: 270, width: 120, height: 20, options: ["Full time", "Part time"] },
    { action: "create", type: "date", name: "Start date", page: 1, x: 30, y: 230, width: 120, height: 20 },
    { action: "create", type: "radio", name: "Work location", page: 1, x: 30, y: 190, width: 15, height: 15, options: ["Remote", "Office"] }
  ]
  const bytes = await authorForm(await (await pdfFixture("Readable original")).save(), form)
  const fields = await inspectForm(bytes)
  assert.equal(fields[0].label, "Your name")
  assert.equal(fields[0].required, true)
  assert.equal(fields[0].widgets[0].page, 1)
  assert.equal(fields[0].value, "")
  const updated = await authorForm(bytes, [
    { ...form[0], action: "update", x: 90, width: 180 },
    { action: "fill", name: "Full name", value: "Example Person", before: "" },
    { action: "update", name: "Work location", newName: "Location", resize: false, required: true },
    { action: "delete", name: "Agree" }
  ])
  const info = await inspectForm(updated)
  assert.equal(info[0].widgets[0].x, 90)
  assert.equal(info[0].widgets[0].width, 180)
  assert.equal(info[0].value, "Example Person")
  assert.equal(info.length, 4)
  assert.equal(info.find(field => field.name === "Start date").type, "date")
  const radio = info.find(field => field.name === "Location")
  assert.equal(radio.type, "radio")
  assert.deepEqual(radio.options, ["Remote", "Office"])
  assert.equal(radio.widgets.length, 2)
  await assert.rejects(authorForm(updated, [{ action: "fill", name: "Full name", value: "Stale answer", before: "" }]), /changed/)
})

test("privacy export removes selected material and optimization retains live PDF content", async () => {
  const { cleanPdf, inspectPrivacy, optimizePdf } = await import("../pdf-copy-tools.mjs")
  const { default: mupdf } = await import("mupdf")
  const pdf = await pdfFixture("Visible searchable copy")
  const page = pdf.getPage(0)
  pdf.setAuthor("Private Author")
  pdf.addJavaScript("sample", "void 0")
  await pdf.attach(Buffer.from("Private attachment"), "notes.txt", { mimeType: "text/plain" })
  const note = pdf.context.register(pdf.context.obj({ Type: "Annot", Subtype: "Text", Rect: [5, 5, 20, 20], Contents: PDFString.of("Private note") }))
  const link = pdf.context.register(pdf.context.obj({ Type: "Annot", Subtype: "Link", Rect: [28, 421, 220, 460], A: { S: "URI", URI: PDFString.of("https://example.com") } }))
  page.node.addAnnot(note)
  page.node.addAnnot(link)
  const form = pdf.getForm().createTextField("answer")
  form.addToPage(page, { x: 40, y: 350, width: 140, height: 20 })
  form.setText("Readable answer")
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 2100, 1500], false)
  pixmap.clear(231)
  const png = pixmap.getPixels()
  for (let i = 0; i < png.length; i += 7) png[i] = i % 256
  const jpeg = await pdf.embedJpg(pixmap.asJPEG(96))
  pixmap.destroy()
  page.drawImage(jpeg, { x: 20, y: 30, width: 250, height: 180 })
  const bytes = await pdf.save()
  const categories = ["metadata", "comments", "attachments", "scripts"]
  const original = inspectPrivacy(bytes)
  for (const category of categories) assert.ok(original[category] > 0, category)
  assert.throws(() => cleanPdf(bytes, categories, "Visible searchable copy"), /still extractable on page/)
  const cleaned = cleanPdf(bytes, categories)
  for (const category of categories) assert.equal(cleaned.after[category], 0, category)
  const result = optimizePdf(cleaned.bytes, true)
  assert.equal(result.changedImages, 1)
  assert.ok(result.bytes.length < cleaned.bytes.length)
  const output = await PDFDocument.load(result.bytes, { updateMetadata: false })
  assert.equal(output.getForm().getTextField("answer").getText(), "Readable answer")
  assert.ok(output.getPage(0).node.Annots().asArray().some(ref => output.context.lookup(ref).get(PDFName.of("Subtype"))?.toString() === "/Link"))
  const rendering = new mupdf.PDFDocument(result.bytes)
  try { assert.match(rendering.loadPage(0).toStructuredText().asText(), /Visible searchable copy/) }
  finally { rendering.destroy() }
})

test("Word structure features write standard parts while retaining the original content", async () => {
  const { readWord } = require("../word.cjs")
  const { DOMParser, XMLSerializer } = require("@xmldom/xmldom")
  const { strFromU8, strToU8 } = require("fflate")
  const { editWord } = await import("../word-tools.mjs")
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("Introduction"), new Paragraph("Opening content")] }] }))
  const { archive, document } = await readWord(bytes, "docx")
  const apply = change => editWord(document, archive, change, DOMParser, XMLSerializer, strFromU8, strToU8)
  apply({ action: "paragraph-style", index: 0, style: "Heading1" })
  apply({ action: "hyperlink", index: 1, url: "https://example.com/reference", label: "Reference" })
  apply({ action: "footnote", index: 1, text: "Source note" })
  apply({ action: "section-settings", index: 1, size: "a4", orientation: "landscape", margin: 20 })
  apply({ action: "table-of-contents", index: 1 })
  assert.match(strFromU8(archive["word/footnotes.xml"]), /Source note/)
  assert.match(strFromU8(archive["word/_rels/document.xml.rels"]), /TargetMode="External"/)
  const output = new XMLSerializer().serializeToString(document)
  for (const text of ["Introduction", "Opening content", "Reference", "EllesonContents", 'w:orient="landscape"', "footnoteReference"]) assert.ok(output.includes(text), text)
  assert.throws(() => apply({ action: "hyperlink", index: 1, url: "javascript:void 0", label: "Invalid" }), /web URL/)
})

test("library search, invited simultaneous editing and direct phone capture on the local host", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "elleson-features-"))
  let host = await start(0, dir)
  const open = async (name, bytes) => {
    await ok(await host.open(name, Buffer.from(bytes)).then(() => call(host, "state", host.owner)))
    return (await json(call(host, "state", host.owner))).document
  }
  const close = () => new Promise(resolve => {
    host.server.close(resolve)
    host.server.closeAllConnections()
  })
  try {
    const pdf = await pdfFixture("Library zebra reference")
    pdf.getForm().createTextField("Job number").addToPage(pdf.getPage(0), { x: 20, y: 300, width: 150, height: 30 })
    const source = await open("Search attachment.pdf", await pdf.save())
    await ok(await call(host, "library/" + source.libraryId + "/tags", host.owner, { body: { tags: ["Business", "Business", "  Forms  "] } }))
    const records = await json(call(host, "library", host.owner))
    assert.deepEqual(records[0].tags, ["Business", "Forms"])
    const search = await json(call(host, "library-search?q=Business%20zebra", host.owner))
    assert.equal(search.matches[0].id, source.libraryId)
    assert.equal(search.matches[0].page, 1)

    const word = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("alpha bravo charlie"), new Paragraph("second line")] }] }))
    const doc = await open("Collaborative draft.docx", word)
    const invite = async name => {
      const links = await json(call(host, "collab-invite/" + doc.id, host.owner, { body: {} }))
      const code = new URL(links.local).hash.split("=")[1]
      const guest = await json(call(host, "collab-join", null, { body: { invite: code, name } }))
      assert.equal((await call(host, "collab-join", null, { body: { invite: code, name } })).status, 410)
      return guest.token
    }
    const [alice, bob] = await Promise.all([invite("Alice"), invite("Bob")])
    assert.equal((await call(host, "library", alice)).status, 403)
    assert.equal((await call(host, "source/" + source.id, alice)).status, 403)
    assert.equal((await call(host, "edit/" + doc.id, alice, { body: { kind: "history-undo" } })).status, 403)
    const edit = (access, body) => call(host, "edit/" + doc.id, access, { body })
    const base = { kind: "word", index: 0, before: "alpha bravo charlie", structureVersion: 0 }
    const [a, b] = await Promise.all([edit(alice, { ...base, value: "ALPHA bravo charlie", id: "alice-change-001" }),
      edit(bob, { ...base, value: "alpha bravo CHARLIE", id: "bob-change-0001" })])
    await ok(a); await ok(b)
    let snapshot = (await json(call(host, "state", alice))).document
    assert.equal(snapshot.lines[0].text, "ALPHA bravo CHARLIE")
    const conflict = await edit(bob, { ...base, value: "another bravo charlie", id: "bob-conflict-01" })
    assert.equal(conflict.status, 409)
    assert.equal((await conflict.json()).code, "EDIT_CONFLICT")
    await ok(await edit(alice, { ...base, value: "ALPHA bravo charlie", id: "alice-change-001" }))
    const styles = await json(call(host, "word-styles/" + doc.id, bob))
    assert.ok(styles.some(style => style.id === "Heading1"))
    snapshot = await json(edit(bob, { kind: "word-tools", action: "paragraph-style", index: 1, style: "Heading1", id: "bob-style-0001", version: snapshot.contentVersion }))
    assert.equal(snapshot.lines[1].style, "Heading1")
    await close()
    host = await start(0, dir)
    const roster = await json(call(host, "collab-room", alice))
    assert.deepEqual(new Set(roster.activity.map(item => item.author)), new Set(["Alice", "Bob"]))
    assert.equal(roster.activity.length, 3)

    await ok(await call(host, "collab-revoke/" + doc.id, host.owner, { body: { participant: roster.participants.find(person => person.name === "Alice").id } }))
    assert.equal((await call(host, "state", alice)).status, 401)
    const captured = await open("Capture target.pdf", await pdf.save())
    assert.equal((await json(call(host, "state", bob))).document.id, doc.id)
    const pairing = await json(call(host, "pairing", host.owner, { body: {} }))
    const phone = await json(call(host, "pair", null, { body: { code: pairing.code } }))
    const formUpdate = await json(call(host, "edit/" + captured.id, host.owner, { body: { id: "phone-form-value", kind: "field", name: "Job number", before: "", value: "124" } }))
    const scan = (await pdfFixture("Captured page")).save()
    const options = { body: await scan, bytes: true, headers: { "X-Operation-Id": "phone-capture-01" } }
    const appended = await json(call(host, "capture-pages/" + captured.id, phone.token, options))
    assert.equal(appended.pages, 2)
    assert.equal(appended.fields["Job number"], formUpdate.fields["Job number"])
    assert.equal((await json(call(host, "capture-pages/" + captured.id, phone.token, options))).pages, 2)
    assert.equal((await json(call(host, "form-fields/" + captured.id, host.owner)))[0].value, "124")
  } finally {
    await close()
    await rm(dir, { recursive: true, force: true })
  }
})
