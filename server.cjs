const crypto = require("node:crypto")
const os = require("node:os")
const path = require("node:path")
const fs = require("node:fs/promises")
const history = require("./history.cjs")
const { DocumentLibrary } = require("./library.cjs")
const express = require("express")
const { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, degrees, rgb, StandardFonts } = require("pdf-lib")
const { readWord, saveWord } = require("./word.cjs")

const maxBytes = 40 * 1024 * 1024
const token = () => crypto.randomBytes(24).toString("base64url")
const isPoint = value => Array.isArray(value) && value.length === 2 && value.every(number => Number.isFinite(number) && Math.abs(number) < 200000)
const inkStyle = edit => ({
  color: /^#[a-f0-9]{6}$/i.test(edit.color || "") ? edit.color : "#093352",
  width: [1, 2, 4, 8, 12].includes(edit.width) ? edit.width : 1.7,
  opacity: edit.opacity === .25 ? .25 : 1
})
const latinFont = PDFDocument.create().then(document => document.embedFont(StandardFonts.Helvetica))
const downloadMime = {
  pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}

async function start(port = 0, recoveryDirectory) {
  const web = express()
  const owner = token()
  const library = new DocumentLibrary(recoveryDirectory ? path.join(recoveryDirectory, "library") : null)
  await library.load()
  let pairing
  let mobile
  let mobileUntil = 0
  let lastPhoneSeen = 0
  let document
  const documents = new Map()
  let recoveryWarning = ""
  let openSequence = 0
  let revision = 0
  let recognizing = false
  let checkpointQueue = Promise.resolve()
  let editQueue = Promise.resolve()
  const previews = Object.create(null)
  const pendingExports = new Map()
  let handoff
  const isLoopback = request => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress)
  if (recoveryDirectory) {
    try { const saved = JSON.parse(await fs.readFile(path.join(recoveryDirectory, "paired-device.json"), "utf8")); if (/^[A-Za-z0-9_-]{32}$/.test(saved.token) && saved.until > Date.now()) { mobile = saved.token; mobileUntil = saved.until } } catch {}
  }

  web.disable("x-powered-by")
  web.use((request, response, next) => {
    response.set({
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; font-src 'self' data: blob:; connect-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    })
    if (request.path.startsWith("/api/")) response.set("Cache-Control", "no-store")
    next()
  })
  web.use(express.static(path.join(__dirname, "web")))
  web.use("/vendor/docx", express.static(path.dirname(require.resolve("docx-preview"))))
  web.use("/vendor/jszip", express.static(path.join(path.dirname(require.resolve("jszip/package.json")), "dist")))
  const pdfRoot = path.dirname(require.resolve("pdfjs-dist/package.json"))
  for (const folder of ["legacy/build", "cmaps", "standard_fonts", "wasm"]) {
    web.use("/pdfjs/" + folder, express.static(path.join(pdfRoot, folder)))
  }
  web.use(express.json({ limit: "384kb" }))

  web.post("/api/pair", async (request, response) => {
    const supplied = String(request.body?.code ?? "").toUpperCase().trim()
    if (!pairing || pairing.until < Date.now()) return response.status(403).json({ error: "Start pairing from the PC again." })
    if (supplied !== pairing.code) {
      if (++pairing.attempts >= 10) pairing = undefined
      return response.status(403).json({ error: "Check the pairing code on the PC." })
    }
    pairing = undefined
    mobile = token()
    mobileUntil = Date.now() + 30 * 86400000
    lastPhoneSeen = Date.now()
    if (recoveryDirectory) { await fs.mkdir(recoveryDirectory, { recursive: true }); await fs.writeFile(path.join(recoveryDirectory, "paired-device.json"), JSON.stringify({ token: mobile, until: mobileUntil })) }
    response.json({ token: mobile })
  })
  web.use("/api", (request, response, next) => {
    const credential = request.get("authorization")?.replace(/^Bearer /, "")
    request.role = credential === owner && isLoopback(request) ? "pc" : credential && credential === mobile && mobileUntil > Date.now() ? "phone" : ""
    if (request.role === "phone") lastPhoneSeen = Date.now()
    if (!request.role) return response.status(401).json({ error: "Connect to Elleson Docs to continue." })
    next()
  })

  web.post("/api/pairing", (request, response) => {
    if (request.role !== "pc") return response.sendStatus(403)
    pairing = { code: crypto.randomBytes(4).toString("hex").toUpperCase(), until: Date.now() + 180000, attempts: 0 }
    const interfaces = Object.values(os.networkInterfaces()).flat()
    const addresses = interfaces.filter(item => item && item.family === "IPv4" && !item.internal)
      .map(item => "http://" + item.address + ":" + server.address().port)
    response.json({ code: pairing.code, addresses })
  })
  web.get("/api/library", (request, response) => response.json(library.list()))
  web.get("/api/storage", (request, response) => response.json({ ...library.stats(), recoveryWarning }))
  web.post("/api/storage", async (request, response) => { await library.settings(request.body.limit); response.sendStatus(204) })
  web.delete("/api/library/:id", async (request, response) => { await library.remove(request.params.id); response.sendStatus(204) })
  web.delete("/api/library/:id/versions/:version", async (request, response) => { await library.remove(request.params.id, request.params.version); response.sendStatus(204) })
  web.get("/api/backup", async (request, response) => response.attachment("Elleson Docs backup.zip").type("application/zip").send(await library.backup()))
  web.get("/api/library/:id/compare", async (request, response) => {
    const versions = await Promise.all([request.query.left, request.query.right].map(version => library.read(request.params.id, version)))
    const results = []
    for (const saved of versions) {
      if (/\.pdf$/i.test(saved.filename)) {
        const engine = await import("./pdf-edit.mjs"), pdf = await PDFDocument.load(saved.bytes)
        const count = pdf.getPageCount()
        results.push({ filename: saved.filename, pages: count, limited: count > 200, text: Array.from({ length: Math.min(count, 200) }, (_, index) =>
          "Page " + (index + 1) + "\n" + engine.extract(saved.bytes, index).map(span => span.text).join("\n")).join("\n\n") + "\n" + pdf.getForm().getFields().map(field => field.getName() + ": " + (field instanceof PDFTextField ? field.getText() || "" : field instanceof PDFCheckBox ? field.isChecked() : field instanceof PDFDropdown ? field.getSelected().join(", ") : "")).join("\n") })
      } else results.push({ filename: saved.filename, text: (await readWord(saved.bytes, path.extname(saved.filename).slice(1))).lines.map(line => line.text).join("\n") })
    }
    response.json(results)
  })
  web.get("/api/library/:id/versions", (request, response) => response.json(library.versions(request.params.id)))
  web.post("/api/library/:id/pin", async (request, response) => {
    await library.pin(request.params.id, request.body.pinned === true)
    response.sendStatus(204)
  })
  web.post("/api/library/:id/open", async (request, response) => {
    const existing = !request.body.version && [...documents.values()].find(item => item.libraryId === request.params.id)
    if (existing) {
      const operation = editQueue.then(async () => { document = existing; revision++; await checkpoint() })
      editQueue = operation.catch(() => {})
      await operation
      return response.sendStatus(204)
    }
    const saved = await library.read(request.params.id, request.body.version)
    await open(saved.filename, saved.bytes, false, request.params.id)
    response.sendStatus(204)
  })
  web.delete("/api/pairing", async (request, response) => {
    if (request.role !== "pc") return response.sendStatus(403)
    pairing = undefined
    mobile = undefined
    if (recoveryDirectory) await fs.unlink(path.join(recoveryDirectory, "paired-device.json")).catch(error => { if (error.code !== "ENOENT") throw error })
    response.sendStatus(204)
  })
  web.get("/api/state", (request, response) => {
    const unchanged = Number(request.query.revision) === revision
    response.json({
      revision, role: request.role, paired: Boolean(mobile) && mobileUntil > Date.now(), phoneOnline: Date.now() - lastPhoneSeen < 6000, recoveryWarning, handoff: handoff?.target === request.role ? handoff : null,
      tabs: [...documents.values()].map(item => ({ id: item.libraryId, documentId: item.id, filename: item.filename, dirty: item.changeNumber !== item.savedNumber })),
      preview: previews[request.role === "pc" ? "phone" : "pc"]?.until > Date.now()
        ? previews[request.role === "pc" ? "phone" : "pc"].mark : null,
      ...(unchanged ? {} : { document: document ? snapshot(document) : null })
    })
  })
  web.post("/api/handoff", (request, response) => {
    if (!document) return response.sendStatus(409)
    if (!["pc", "phone"].includes(request.body.target)) return response.sendStatus(400)
    handoff = { id: token(), document: document.id, target: request.body.target, page: Math.max(1, Math.min(document.pages || 1, Number(request.body.page) || 1)), zoom: Math.max(.25, Math.min(4, Number(request.body.zoom) || 1)), standalone: request.body.standalone === true }
    revision++
    response.sendStatus(204)
  })
  web.post("/api/preview/:id", (request, response) => {
    if (document?.id !== request.params.id || document.extension !== "pdf") return response.sendStatus(409)
    const { page, points, id } = request.body || {}
    if (!points) {
      delete previews[request.role]
    } else if (/^[a-zA-Z0-9-]{12,80}$/.test(id || "") && Number.isInteger(page) && page >= 1 && page <= document.pages && Array.isArray(points)
      && points.length >= 1 && points.length <= 1200 && points.every(isPoint)) {
      if (!document.applied.has(id)) previews[request.role] = { until: Date.now() + 2200, mark: { kind: "ink", page, points, ...inkStyle(request.body) } }
    } else return response.sendStatus(400)
    response.sendStatus(204)
  })
  web.get("/api/source/:id", async (request, response) => {
    const current = document
    if (current?.id !== request.params.id) return response.sendStatus(404)
    const bytes = current.word && (Object.keys(current.wordEdits).length || Object.keys(current.wordFormats).length)
      ? await saveWord(current.word, { ...current.wordEdits }, structuredClone(current.wordFormats)) : current.bytes
    response.type(downloadMime[current.extension]).send(Buffer.from(bytes))
  })
  web.get("/api/text/:id/:page", async (request, response) => {
    const current = document
    const index = Number(request.params.page) - 1
    if (current?.id !== request.params.id || current.extension !== "pdf" || !Number.isInteger(index) || index < 0 || index >= current.pages) return response.sendStatus(404)
    const engine = await import("./pdf-edit.mjs")
    response.json({ version: current.contentVersion, spans: engine.extract(current.bytes, index, current.ocr[index] || []) })
  })
  web.post("/api/preview-text/:id", async (request, response) => {
    const current = document
    const edit = request.body
    if (current?.id !== request.params.id || current.extension !== "pdf" || edit.version !== current.contentVersion ||
      !Number.isInteger(edit.page) || edit.page < 1 || edit.page > current.pages ||
      typeof edit.value !== "string" || edit.value.length > 2000) return response.sendStatus(409)
    const engine = await import("./pdf-edit.mjs")
    const run = typeof edit.span === "string" ? current.ocr[edit.page - 1]?.find(line => line.id === edit.span) : undefined
    if (typeof edit.span === "string" && !run) throw new Error("Recognize the page again.")
    const bytes = engine.replace(current.bytes, edit.page - 1, edit.span, edit.before, edit.value, run, edit.font, edit.layout)
    response.type("image/png").send(Buffer.from(engine.scanImage(bytes, edit.page - 1).image))
  })
  web.post("/api/ocr/:id/:page", async (request, response) => {
    const current = document
    const index = Number(request.params.page) - 1
    if (current?.id !== request.params.id || current.extension !== "pdf" || !Number.isInteger(index) || index < 0 || index >= current.pages) return response.sendStatus(404)
    if (recognizing) return response.status(409).json({ error: "Text recognition is already running. Try again when it finishes." })
    recognizing = true
    const version = current.contentVersion
    try {
      const engine = await import("./pdf-edit.mjs")
      const { recognize } = require("./ocr.cjs")
      const image = engine.scanImage(current.bytes, index)
      const lines = await recognize(image.image, image.scale, image.bounds, request.body.lang || "eng")
      if (documents.get(current.id) !== current || current.contentVersion !== version) return response.status(409).json({ error: "The document changed during text recognition. Try again." })
      current.ocr[index] = lines
      current.contentVersion++
      revision++
      await checkpoint()
      response.json({ lines: lines.length })
    } finally { recognizing = false }
  })
  web.post("/api/open", express.raw({ type: "application/octet-stream", limit: maxBytes }), async (request, response) => {
    if (!Buffer.isBuffer(request.body)) return response.status(400).json({ error: "Choose a document to open." })
    await open(decodeURIComponent(request.get("x-filename") || ""), request.body)
    response.sendStatus(204)
  })
  web.post("/api/close/:id", (request, response, next) => {
    const operation = editQueue.then(async () => {
      const closing = documents.get(request.params.id)
      if (!closing) return response.sendStatus(409)
      await checkpointQueue
      documents.delete(closing.id)
      if (document === closing) document = [...documents.values()].at(-1) || null
      await checkpoint()
      delete previews.pc
      delete previews.phone
      revision++
      response.sendStatus(204)
    })
    editQueue = operation.catch(() => {})
    operation.catch(next)
  })
  web.get("/api/extract/:id", async (request, response) => {
    const current = document
    if (current?.id !== request.params.id || current.extension !== "pdf") return response.sendStatus(409)
    const pages = String(request.query.pages || "").split(",").map(value => Number(value.trim()) - 1)
    const engine = await import("./pdf-edit.mjs")
    const { bytes } = await exportFile(current.id)
    const extracted = engine.organize(bytes, "extract", pages)
    response.attachment("Selected pages.pdf").type("application/pdf").send(Buffer.from(extracted.bytes))
  })
  web.get("/api/print/:id", async (request, response) => {
    const result = await exportFile(request.params.id, { flatten: true })
    response.type("application/pdf").send(Buffer.from(result.bytes))
  })
  web.post("/api/combine/:id", express.raw({ type: "application/octet-stream", limit: maxBytes }), (request, response, next) => {
    const operation = editQueue.then(async () => {
      const current = document
      if (current?.id !== request.params.id || current.extension !== "pdf" || !Buffer.isBuffer(request.body)) return response.sendStatus(409)
      const operationId = request.get("X-Operation-Id")
      if (!/^[a-zA-Z0-9-]{12,80}$/.test(operationId || "")) return response.sendStatus(400)
      if (current.applied.has(operationId)) return response.json(snapshot(current))
      const before = history.capture(current)
      const engine = await import("./pdf-edit.mjs")
      const exported = await exportFile(current.id)
      if (documents.get(current.id) !== current) return response.sendStatus(409)
      const result = request.query.editable === "1" ? await (await import("./pdf-tools.mjs")).combineEditable(exported.bytes, request.body) : engine.organize(exported.bytes, "combine", null, request.body)
      current.bytes = result.bytes
      current.pages = result.pages
      current.marks = []
      current.fields = Object.create(null)
      current.originalFields = Object.fromEntries((await PDFDocument.load(current.bytes)).getForm().getFields().map(field => [field.getName(), field instanceof PDFTextField ? field.getText() || "" : field instanceof PDFCheckBox ? field.isChecked() : field instanceof PDFDropdown ? field.getSelected()[0] || "" : ""]))
      current.ocr = Object.create(null)
      current.contentVersion++
      current.changeNumber++
      history.remember(current, before)
      current.applied.add(operationId)
      revision++
      await checkpoint()
      response.json(snapshot(current))
    })
    editQueue = operation.catch(() => {})
    operation.catch(next)
  })
  web.post("/api/edit/:id", (request, response, next) => {
    const operation = editQueue.then(() => applyEdit(request, response))
    editQueue = operation.catch(() => {})
    operation.catch(next)
  })
  web.get("/api/review/:id/:page", async (request, response) => {
    const current = documents.get(request.params.id)
    if (!current || current.extension !== "pdf") return response.sendStatus(404)
    response.json((await import("./pdf-tools.mjs")).reviewList(current.bytes, Number(request.params.page) - 1))
  })
  web.get("/api/pdf-images/:id/:page", async (request, response) => {
    const current = documents.get(request.params.id)
    if (!current || current.extension !== "pdf") return response.sendStatus(404)
    response.json((await import("./pdf-tools.mjs")).images(current.bytes, Number(request.params.page) - 1))
  })
  web.post("/api/pdf-image/:id", express.raw({ type: "application/octet-stream", limit: maxBytes }), (request, response, next) => {
    const operation = editQueue.then(async () => {
      const current = documents.get(request.params.id), edit = JSON.parse(request.get("X-Image-Edit") || "{}")
      if (!current || current.extension !== "pdf" || current.contentVersion !== edit.version || !Buffer.isBuffer(request.body)) return response.status(409).json({ error: "Select the page again." })
      if (current.applied.has(edit.id)) return response.json(snapshot(current))
      if (!/^[a-zA-Z0-9-]{12,80}$/.test(edit.id || "")) return response.sendStatus(400)
      const before = history.capture(current)
      current.bytes = await (await import("./pdf-tools.mjs")).image(current.bytes, request.body, edit)
      current.contentVersion++; current.changeNumber++; current.applied.add(edit.id)
      history.remember(current, before)
      revision++; await checkpoint()
      response.json(snapshot(current))
    })
    editQueue = operation.catch(() => {})
    operation.catch(next)
  })
  async function applyWordBytes(current, bytes) {
    const word = await readWord(bytes, "docx")
    if (documents.get(current.id) !== current) throw Object.assign(new Error("The open document changed."), { status: 409 })
    current.bytes = Buffer.from(bytes)
    current.word = word
    current.extension = "docx"
    current.filename = current.filename.replace(/\.doc$/i, ".docx")
    current.wordEdits = Object.create(null)
    current.wordFormats = Object.create(null)
    current.contentVersion++
  }
  web.post("/api/word-image/:id", express.raw({ type: "application/octet-stream", limit: maxBytes }), (request, response, next) => {
    const operation = editQueue.then(async () => {
      const current = document
      const index = Number(request.get("X-Paragraph-Index"))
      const operationId = request.get("X-Operation-Id")
      if (current?.id !== request.params.id || !current.word || !Buffer.isBuffer(request.body)) return response.sendStatus(409)
      if (current.applied.has(operationId)) return response.json(snapshot(current))
      if (!Number.isInteger(index) || !current.word.lines[index] || !/^[a-zA-Z0-9-]{12,80}$/.test(operationId || "") ||
        Number(request.get("X-Document-Version")) !== current.contentVersion) return response.status(409).json({ error: "Select the paragraph again." })
      const before = history.capture(current)
      const engine = await import("./pdf-edit.mjs")
      const image = { ...engine.imageInfo(request.body), bytes: request.body, index }
      const bytes = await saveWord(current.word, current.wordEdits, current.wordFormats, undefined, image)
      await applyWordBytes(current, bytes)
      history.remember(current, before)
      current.changeNumber++
      current.applied.add(operationId)
      revision++
      await checkpoint()
      response.json(snapshot(current))
    })
    editQueue = operation.catch(() => {})
    operation.catch(next)
  })
  async function applyEdit(request, response) {
    const current = documents.get(request.params.id)
    if (!current || current.id !== request.params.id) return response.status(409).json({ error: "The open document changed." })
    const edit = request.body
    if (!edit || !/^[a-zA-Z0-9-]{12,80}$/.test(edit.id ?? "")) return response.sendStatus(400)
    if (current.applied.has(edit.id)) return response.json(snapshot(current))
    if (current.applied.size >= 30000) throw new Error("Save a copy and reopen it to continue editing.")
    const before = history.capture(current)
    if (edit.kind === "history-undo" || edit.kind === "history-redo") {
      history.restore(current, edit.kind === "history-undo" ? "undo" : "redo")
    } else if (edit.kind === "pages" && current.extension === "pdf" && edit.version === current.contentVersion) {
      const engine = await import("./pdf-edit.mjs")
      const exported = await exportFile(current.id)
      if (documents.get(current.id) !== current) return response.sendStatus(409)
      const result = engine.organize(exported.bytes, edit.action, edit.pages)
      current.bytes = result.bytes
      current.pages = result.pages
      current.marks = []
      current.fields = Object.create(null)
      current.originalFields = Object.fromEntries((await PDFDocument.load(current.bytes)).getForm().getFields().map(field => [field.getName(), field instanceof PDFTextField ? field.getText() || "" : field instanceof PDFCheckBox ? field.isChecked() : field instanceof PDFDropdown ? field.getSelected()[0] || "" : ""]))
      current.ocr = Object.create(null)
      current.contentVersion++
    } else if (edit.kind === "replace" && current.extension === "pdf" && edit.version === current.contentVersion
      && Number.isInteger(edit.page) && edit.page >= 1 && edit.page <= current.pages && (Number.isInteger(edit.span) || /^ocr-\d+$/.test(edit.span))
      && typeof edit.before === "string" && typeof edit.value === "string" && edit.value.length <= 2000) {
      const version = current.contentVersion
      const engine = await import("./pdf-edit.mjs")
      if (documents.get(current.id) !== current || version !== current.contentVersion) return response.status(409).json({ error: "The document changed. Select the text again." })
      const run = typeof edit.span === "string" ? current.ocr[edit.page - 1]?.find(line => line.id === edit.span) : undefined
      if (typeof edit.span === "string" && !run) throw new Error("Recognize the scan again and select the text.")
      current.bytes = engine.replace(current.bytes, edit.page - 1, edit.span, edit.before, edit.value, run, edit.font, edit.layout)
      current.ocr[edit.page - 1] = []
      current.contentVersion++
    } else if (edit.kind === "word-tools" && current.word) {
      if (edit.version !== current.contentVersion) throw Object.assign(new Error("The document changed. Select the text again."), { status: 409 })
      const parsed = await readWord(await saveWord(current.word, current.wordEdits, current.wordFormats), "docx")
      const { DOMParser, XMLSerializer } = require("@xmldom/xmldom")
      const { strFromU8, strToU8, zipSync } = require("fflate")
      ;(await import("./word-tools.mjs")).editWord(parsed.document, parsed.archive, edit, DOMParser, XMLSerializer, strFromU8, strToU8)
      parsed.archive["word/document.xml"] = strToU8(new XMLSerializer().serializeToString(parsed.document))
      await applyWordBytes(current, Buffer.from(zipSync(parsed.archive)))
    } else if (edit.kind === "review" && current.extension === "pdf") {
      if (edit.version !== current.contentVersion) throw Object.assign(new Error("The page changed. Review the latest page."), { status: 409 })
      current.bytes = (await import("./pdf-tools.mjs")).review(current.bytes, edit)
      current.contentVersion++
    } else if (edit.kind === "transform" && current.extension === "pdf") {
      if (typeof edit.value === "string") (await latinFont).encodeText(edit.value)
      current.marks = (await import("./mark-tools.mjs")).changeMarks(current.marks, edit)
    } else if (edit.kind === "word-format" && current.word?.lines[edit.index] && Number.isInteger(edit.index)) {
      if (edit.version !== current.contentVersion) return response.status(409).json({ error: "The document changed. Select the paragraph again." })
      const { validFormat } = await import("./word-format.mjs")
      if (!validFormat(edit.format)) throw new Error("Choose valid text formatting.")
      if (documents.get(current.id) !== current) return response.sendStatus(409)
      current.wordFormats[edit.index] = { ...current.wordFormats[edit.index], ...edit.format }
      if (current.extension === "doc") await applyWordBytes(current, await saveWord(current.word, current.wordEdits, current.wordFormats))
      else current.contentVersion++
    } else if (edit.kind === "word-table" && current.word?.lines[edit.index] && Number.isInteger(edit.index)) {
      if (edit.version !== current.contentVersion) return response.status(409).json({ error: "The document changed. Select the paragraph again." })
      const bytes = await saveWord(current.word, current.wordEdits, current.wordFormats, {
        index: edit.index, rows: edit.rows, columns: edit.columns
      })
      await applyWordBytes(current, bytes)
    } else if (edit.kind === "word" && current.word?.lines[edit.index]?.editable && typeof edit.value === "string" && edit.value.length <= 16000) {
      const existing = current.wordEdits[edit.index] ?? current.word.lines[edit.index].text
      if (existing !== edit.before) return response.status(409).json({ error: "This paragraph changed on the other device.", code: "EDIT_CONFLICT", actual: existing })
      current.wordEdits[edit.index] = edit.value
      current.contentVersion++
    } else if (edit.kind === "field" && current.extension === "pdf" && typeof edit.name === "string" && edit.name.length <= 300 && (typeof edit.value === "boolean" || typeof edit.value === "string" && edit.value.length <= 2000)) {
      const actual = current.fields[edit.name] ?? current.originalFields?.[edit.name] ?? ""
      if (Object.hasOwn(edit, "before") && edit.before !== actual) return response.status(409).json({ error: "This field changed on the other device.", code: "EDIT_CONFLICT", actual })
      if (typeof edit.value === "string") (await latinFont).encodeText(edit.value)
      current.fields[edit.name] = edit.value
    } else if (edit.kind === "undo" && typeof edit.target === "string" && current.extension === "pdf") {
      const group = current.marks.find(mark => mark.id === edit.target)?.group
      current.marks = current.marks.filter(mark => group ? mark.group !== group : mark.id !== edit.target)
    } else if (current.extension === "pdf" && Number.isInteger(edit.page) && edit.page >= 1 && edit.page <= current.pages && current.marks.length < 4000) {
      if (edit.kind === "signature" && Array.isArray(edit.strokes) && edit.strokes.length > 0 && edit.strokes.length <= 100 &&
        edit.strokes.every(stroke => Array.isArray(stroke) && stroke.length >= 2 && stroke.length <= 1200 && stroke.every(isPoint))) {
        current.marks.push(...edit.strokes.map((points, index) => ({
          id: edit.id + "-" + index, group: edit.id, kind: "ink", page: edit.page, points, ...inkStyle(edit)
        })))
      } else if (edit.kind === "ink" && Array.isArray(edit.points) && edit.points.length > 0 && edit.points.length <= 1200 && edit.points.every(isPoint)) {
        delete previews[request.role]
        current.marks.push({ id: edit.id, page: edit.page, kind: "ink", points: edit.points, ...inkStyle(edit) })
      } else if (edit.kind === "text" && typeof edit.value === "string" && edit.value.trim() && edit.value.length <= 400 && isPoint(edit.at) && Number.isFinite(edit.angle) && Math.abs(edit.angle) <= 360 && [10, 12, 14, 18, 24].includes(edit.size)) {
        (await latinFont).encodeText(edit.value)
        current.marks.push({ id: edit.id, page: edit.page, kind: "text", at: edit.at, angle: edit.angle, size: edit.size, value: edit.value })
      } else return response.status(400).json({ error: "This change could not be applied." })
    } else return response.status(400).json({ error: "This change could not be applied." })
    if (edit.kind !== "history-undo" && edit.kind !== "history-redo") history.remember(current, before)
    current.applied.add(edit.id)
    current.changeNumber++
    revision++
    await checkpoint()
    response.json(snapshot(current))
  }
  web.get("/api/save/:id", async (request, response) => {
    const result = await exportFile(request.params.id, { flatten: request.query.flatten === "1" })
    if (request.query.ack === "1") {
      for (const [key, entry] of pendingExports) if (entry.expires < Date.now()) pendingExports.delete(key)
      while (pendingExports.size >= 4) pendingExports.delete(pendingExports.keys().next().value)
      const receipt = token()
      pendingExports.set(receipt, { id: request.params.id, result, expires: Date.now() + 600000 })
      response.set("X-Elleson-Save-Receipt", receipt)
    } else if (request.query.transfer !== "1") response.once("finish", () => void markSaved(request.params.id, result.changeNumber, result).catch(() => {}))
    response.set("X-Elleson-Revision", String(result.changeNumber))
    response.attachment(result.filename).type(downloadMime[result.extension]).send(Buffer.from(result.bytes))
  })
  web.post("/api/saved/:receipt", async (request, response) => {
    const entry = pendingExports.get(request.params.receipt)
    if (!entry || entry.expires < Date.now()) return response.status(410).json({ error: "Save confirmation expired. The downloaded copy is still available." })
    await markSaved(entry.id, entry.result.changeNumber, entry.result)
    pendingExports.delete(request.params.receipt)
    response.sendStatus(204)
  })
  web.use((error, request, response, next) => {
    if (response.headersSent) return next(error)
    if (["ENOSPC", "EDQUOT", "EIO", "EACCES"].includes(error.code)) recoveryWarning = "Recovery storage is full or unavailable. Keep your documents open and save copies to another location."
    response.status(error.status || 422).json({ error: error.type === "entity.too.large" ? "Choose a file smaller than 40 MB." : ["ENOSPC", "EDQUOT", "EIO", "EACCES"].includes(error.code) ? recoveryWarning : error.message })
  })

  const server = await new Promise((resolve, reject) => {
    const listener = web.listen(port, "0.0.0.0", () => resolve(listener))
    listener.once("error", reject)
  })
  if (recoveryDirectory) {
    try {
      let workspace
      try { workspace = JSON.parse(await fs.readFile(path.join(recoveryDirectory, "workspace.json"), "utf8")) }
      catch (error) {
        if (error.code !== "ENOENT") {
          recoveryWarning = "The latest workspace could not be read. Trying the recovery copy."
          workspace = JSON.parse(await fs.readFile(path.join(recoveryDirectory, "workspace.backup.json"), "utf8"))
        } else {
          const saved = JSON.parse(await fs.readFile(path.join(recoveryDirectory, "session.json"), "utf8"))
          workspace = { active: saved.id, documents: [saved] }
        }
      }
      for (const saved of workspace.documents || []) {
        try {
          if (!/^[a-f0-9-]+\.bin$/.test(saved.source)) throw new Error("Invalid recovery source")
          await open(saved.filename, await fs.readFile(path.join(recoveryDirectory, saved.source)), true)
          documents.delete(document.id)
          Object.assign(document, saved, { bytes: document.bytes, word: document.word, applied: new Set(saved.applied),
            fields: Object.assign(Object.create(null), saved.fields), wordEdits: Object.assign(Object.create(null), saved.wordEdits),
            wordFormats: Object.assign(Object.create(null), saved.wordFormats), ocr: Object.assign(Object.create(null), saved.ocr),
            changeNumber: saved.changeNumber ?? saved.applied.length, savedNumber: saved.savedNumber ?? 0 })
          documents.set(document.id, document)
        } catch { recoveryWarning = "Some tabs could not be recovered. Reopen the original file or a saved version from Files." }
      }
      document = documents.get(workspace.active) || [...documents.values()].at(-1) || null
    } catch (error) {
      if (error.code !== "ENOENT") recoveryWarning = "The editing session could not be recovered. Your saved library is still available in Files."
    }
  }

  async function checkpoint() {
    if (!recoveryDirectory) return
    const entries = [...documents.values()].map(current => ({ current, bytes: current.bytes, metadata: {
      id: current.id, filename: current.filename, source: current.id + "-" + current.contentVersion + ".bin", contentVersion: current.contentVersion, libraryId: current.libraryId,
      fields: { ...current.fields }, wordEdits: { ...current.wordEdits }, wordFormats: structuredClone(current.wordFormats), marks: structuredClone(current.marks),
      ocr: structuredClone(current.ocr), applied: [...current.applied], changeNumber: current.changeNumber, savedNumber: current.savedNumber
    } }))
    const metadata = JSON.stringify({ active: document?.id, documents: entries.map(entry => entry.metadata) })
    checkpointQueue = checkpointQueue.catch(() => {}).then(async () => {
      await fs.mkdir(recoveryDirectory, { recursive: true })
      for (const entry of entries) {
        const target = path.join(recoveryDirectory, entry.metadata.source)
        try { await fs.access(target) } catch {
          await fs.writeFile(target + ".tmp", entry.bytes)
          await fs.rename(target + ".tmp", target)
        }
      }
      await fs.writeFile(path.join(recoveryDirectory, "workspace.tmp"), metadata)
      await fs.copyFile(path.join(recoveryDirectory, "workspace.json"), path.join(recoveryDirectory, "workspace.backup.json")).catch(error => { if (error.code !== "ENOENT") throw error })
      await fs.rename(path.join(recoveryDirectory, "workspace.tmp"), path.join(recoveryDirectory, "workspace.json"))
      // Retain the previous workspace's sources as well, so its recovery index remains usable.
      let backup = []
      try { backup = JSON.parse(await fs.readFile(path.join(recoveryDirectory, "workspace.backup.json"), "utf8")).documents || [] } catch {}
      const keep = new Set([...entries.map(entry => entry.metadata.source), ...backup.map(entry => entry.source)])
      for (const file of await fs.readdir(recoveryDirectory)) if (/^[a-f0-9-]+\.bin$/.test(file) && !keep.has(file)) await fs.unlink(path.join(recoveryDirectory, file)).catch(() => {})
    })
    return checkpointQueue
  }

  function snapshot(current) {
    return {
      id: current.id, filename: current.filename, extension: current.extension, pages: current.pages, contentVersion: current.contentVersion,
      saveExtension: current.extension === "doc" && (Object.keys(current.wordEdits).length || Object.keys(current.wordFormats).length) ? "docx" : current.extension,
      marks: current.marks, fields: current.fields, originalFields: current.originalFields || {},
      canUndo: current.undo.length > 0, canRedo: current.redo.length > 0,
      dirty: current.changeNumber !== current.savedNumber, libraryId: current.libraryId,
      lines: current.word?.lines.map((line, index) => ({ ...line, text: current.wordEdits[index] ?? line.text }))
    }
  }

  async function open(name, bytes, restoring = false, existingLibraryId) {
    const operation = editQueue.then(() => openNow(name, bytes, restoring, existingLibraryId))
    editQueue = operation.catch(() => {})
    return operation
  }
  async function openNow(name, bytes, restoring = false, existingLibraryId) {
    if (!restoring && !existingLibraryId && (documents.size >= 12 || [...documents.values()].reduce((sum, item) => sum + item.bytes.length + Object.values(item.word?.archive || {}).reduce((size, part) => size + part.length, 0), bytes.length) > 250 * 1024 * 1024)) throw new Error("Close another tab before opening more documents. Your saved files remain in Files.")
    const order = ++openSequence
    const filename = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, "").slice(0, 240)
    const extension = path.extname(filename).slice(1).toLowerCase()
    if (!downloadMime[extension] || bytes.length > maxBytes) throw new Error("Choose a PDF, DOC, or DOCX under 40 MB.")
    const next = {
      id: crypto.randomUUID(), filename, bytes, extension, marks: [], applied: new Set(), contentVersion: 0,
      fields: Object.create(null), wordEdits: Object.create(null), wordFormats: Object.create(null), ocr: Object.create(null), undo: [], redo: [], changeNumber: 0, savedNumber: 0
    }
    if (extension === "pdf") {
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
      next.pages = pdf.getPageCount()
      next.originalFields = Object.fromEntries(pdf.getForm().getFields().map(field => [field.getName(), field instanceof PDFCheckBox ? field.isChecked() : field instanceof PDFTextField ? field.getText() || "" : field instanceof PDFDropdown ? field.getSelected()[0] || "" : ""]))
    } else next.word = await readWord(bytes, extension)
    if (order !== openSequence) throw new Error("A newer file was selected.")
    try { next.libraryId = existingLibraryId || (restoring ? undefined : await library.save(filename, bytes)) }
    catch { next.libraryId = crypto.randomUUID(); recoveryWarning = "This document opened, but it could not be added to local history. Save a copy before closing it." }
    if (order !== openSequence) throw new Error("A newer file was selected.")
    if (existingLibraryId) for (const [id, item] of documents) if (item.libraryId === existingLibraryId) documents.delete(id)
    documents.set(next.id, next)
    document = next
    delete previews.pc
    delete previews.phone
    revision++
    if (!restoring) await checkpoint()
    return snapshot(next)
  }

  async function markSaved(id, changeNumber, result) {
    const current = documents.get(id)
    if (!current) return
    current.savedNumber = Math.max(current.savedNumber, changeNumber)
    const saved = result || (changeNumber === current.changeNumber ? await exportFile(id) : null)
    if (saved) {
      try { current.libraryId = await library.save(saved.filename, saved.bytes, current.libraryId) }
      catch { recoveryWarning = "The file was saved, but local version history could not be updated. Free device storage and keep the exported copy." }
    }
    revision++
    try { await checkpoint() } catch { recoveryWarning = "The file was saved, but the recovery session could not be updated. Keep the exported copy." }
  }

  async function exportFile(id, options = {}) {
    const current = documents.get(id)
    if (!current || current.id !== id) throw new Error("The open document changed.")
    const stem = path.basename(current.filename, path.extname(current.filename))
    const changeNumber = current.changeNumber
    let { extension, bytes } = current
    const marks = [...current.marks]
    const fields = Object.entries(current.fields)
    const wordEdits = { ...current.wordEdits }
    const wordFormats = structuredClone(current.wordFormats)
    if (current.word && (Object.keys(wordEdits).length || Object.keys(wordFormats).length)) {
      bytes = await saveWord(current.word, wordEdits, wordFormats)
      extension = "docx"
    }
    if (extension === "pdf" && (marks.length || fields.length || options.flatten)) {
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
      const font = await pdf.embedFont(StandardFonts.Helvetica)
      const color = rgb(0.035, 0.20, 0.32)
      if (fields.length) {
        const form = pdf.getForm()
        for (const [name, value] of fields) {
          const field = form.getFieldMaybe(name)
          if (field instanceof PDFTextField && typeof value === "string") field.setText(value)
          if (field instanceof PDFCheckBox && typeof value === "boolean") value ? field.check() : field.uncheck()
          if (field instanceof PDFDropdown && typeof value === "string") field.select(value)
        }
        form.updateFieldAppearances(font)
      }
      for (const mark of marks) {
        const page = pdf.getPage(mark.page - 1)
        const inkColor = mark.color ? rgb(...[1, 3, 5].map(offset => parseInt(mark.color.slice(offset, offset + 2), 16) / 255)) : color
        if (mark.kind === "text") {
          page.drawText(mark.value, { x: mark.at[0], y: mark.at[1], size: mark.size, rotate: degrees(mark.angle), font, color })
        } else {
          for (let index = 1; index < mark.points.length; index++) {
            const [x, y] = mark.points[index - 1]
            const [endX, endY] = mark.points[index]
            page.drawLine({ start: { x, y }, end: { x: endX, y: endY }, thickness: mark.width || 1.7, color: inkColor, opacity: mark.opacity ?? 1 })
          }
        }
      }
      if (options.flatten) pdf.getForm().flatten()
      bytes = await pdf.save({ updateFieldAppearances: false })
    }
    return { filename: stem + (options.flatten ? " - final." : " - copy.") + extension, bytes, extension, changeNumber }
  }

  return { server, owner, address: "http://127.0.0.1:" + server.address().port, maxBytes, open, exportFile, markSaved,
    getDocument: () => document ? snapshot(document) : null }
}

module.exports = { start }
if (require.main === module) start().then(({ address, owner }) => console.log(address + "/#owner=" + owner))
