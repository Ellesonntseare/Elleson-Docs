const crypto = require("node:crypto")
const os = require("node:os")
const path = require("node:path")
const fs = require("node:fs/promises")
const history = require("./history.cjs")
const express = require("express")
const { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, degrees, rgb, StandardFonts } = require("pdf-lib")
const { readWord, saveWord } = require("./word.cjs")

const maxBytes = 40 * 1024 * 1024
const token = () => crypto.randomBytes(24).toString("base64url")
const isPoint = value => Array.isArray(value) && value.length === 2 && value.every(number => Number.isFinite(number) && Math.abs(number) < 200000)
const latinFont = PDFDocument.create().then(document => document.embedFont(StandardFonts.Helvetica))
const downloadMime = {
  pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}

async function start(port = 0, recoveryDirectory) {
  const web = express()
  const owner = token()
  let pairing
  let mobile
  let document
  let openSequence = 0
  let revision = 0
  let recognizing = false
  let checkpointQueue = Promise.resolve()
  let previousSource
  let editQueue = Promise.resolve()
  const previews = Object.create(null)
  const isLoopback = request => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress)

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

  web.post("/api/pair", (request, response) => {
    const supplied = String(request.body?.code ?? "").toUpperCase().trim()
    if (!pairing || pairing.until < Date.now()) return response.status(403).json({ error: "Start pairing from the PC again." })
    if (supplied !== pairing.code) {
      if (++pairing.attempts >= 10) pairing = undefined
      return response.status(403).json({ error: "Check the pairing code on the PC." })
    }
    pairing = undefined
    mobile = token()
    response.json({ token: mobile })
  })
  web.use("/api", (request, response, next) => {
    const credential = request.get("authorization")?.replace(/^Bearer /, "")
    request.role = credential === owner && isLoopback(request) ? "pc" : credential && credential === mobile ? "phone" : ""
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
  web.delete("/api/pairing", (request, response) => {
    if (request.role !== "pc") return response.sendStatus(403)
    pairing = undefined
    mobile = undefined
    response.sendStatus(204)
  })
  web.get("/api/state", (request, response) => {
    const unchanged = Number(request.query.revision) === revision
    response.json({
      revision, role: request.role, paired: Boolean(mobile),
      preview: previews[request.role === "pc" ? "phone" : "pc"]?.until > Date.now()
        ? previews[request.role === "pc" ? "phone" : "pc"].mark : null,
      ...(unchanged ? {} : { document: document ? snapshot(document) : null })
    })
  })
  web.post("/api/preview/:id", (request, response) => {
    if (document?.id !== request.params.id || document.extension !== "pdf") return response.sendStatus(409)
    const { page, points, id } = request.body || {}
    if (!points) {
      delete previews[request.role]
    } else if (/^[a-zA-Z0-9-]{12,80}$/.test(id || "") && Number.isInteger(page) && page >= 1 && page <= document.pages && Array.isArray(points)
      && points.length >= 1 && points.length <= 1200 && points.every(isPoint)) {
      if (!document.applied.has(id)) previews[request.role] = { until: Date.now() + 2200, mark: { kind: "ink", page, points } }
    } else return response.sendStatus(400)
    response.sendStatus(204)
  })
  web.get("/api/source/:id", async (request, response) => {
    const current = document
    if (current?.id !== request.params.id) return response.sendStatus(404)
    const bytes = current.word && Object.keys(current.wordEdits).length
      ? await saveWord(current.word, { ...current.wordEdits }) : current.bytes
    response.type(downloadMime[current.extension]).send(Buffer.from(bytes))
  })
  web.get("/api/text/:id/:page", async (request, response) => {
    const current = document
    const index = Number(request.params.page) - 1
    if (current?.id !== request.params.id || current.extension !== "pdf" || !Number.isInteger(index) || index < 0 || index >= current.pages) return response.sendStatus(404)
    const engine = await import("./pdf-edit.mjs")
    response.json({ version: current.contentVersion, spans: engine.extract(current.bytes, index, current.ocr[index] || []) })
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
      const lines = await recognize(image.image, image.scale, image.bounds)
      if (document !== current || current.contentVersion !== version) return response.status(409).json({ error: "The document changed during text recognition. Try again." })
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
  web.post("/api/edit/:id", (request, response, next) => {
    const operation = editQueue.then(() => applyEdit(request, response))
    editQueue = operation.catch(() => {})
    operation.catch(next)
  })
  async function applyEdit(request, response) {
    const current = document
    if (!current || current.id !== request.params.id) return response.status(409).json({ error: "The open document changed." })
    const edit = request.body
    if (!edit || !/^[a-zA-Z0-9-]{12,80}$/.test(edit.id ?? "")) return response.sendStatus(400)
    if (current.applied.has(edit.id)) return response.json(snapshot(current))
    if (current.applied.size >= 30000) throw new Error("Save a copy and reopen it to continue editing.")
    const before = history.capture(current)
    if (edit.kind === "history-undo" || edit.kind === "history-redo") {
      history.restore(current, edit.kind === "history-undo" ? "undo" : "redo")
    } else if (edit.kind === "replace" && current.extension === "pdf" && edit.version === current.contentVersion
      && Number.isInteger(edit.page) && edit.page >= 1 && edit.page <= current.pages && (Number.isInteger(edit.span) || /^ocr-\d+$/.test(edit.span))
      && typeof edit.before === "string" && typeof edit.value === "string" && edit.value.length <= 2000) {
      const version = current.contentVersion
      const engine = await import("./pdf-edit.mjs")
      if (document !== current || version !== current.contentVersion) return response.status(409).json({ error: "The document changed. Select the text again." })
      const run = typeof edit.span === "string" ? current.ocr[edit.page - 1]?.find(line => line.id === edit.span) : undefined
      if (typeof edit.span === "string" && !run) throw new Error("Recognize the scan again and select the text.")
      current.bytes = engine.replace(current.bytes, edit.page - 1, edit.span, edit.before, edit.value, run)
      current.ocr[edit.page - 1] = []
      current.contentVersion++
    } else if (edit.kind === "word" && current.word?.lines[edit.index]?.editable && typeof edit.value === "string" && edit.value.length <= 16000) {
      const existing = current.wordEdits[edit.index] ?? current.word.lines[edit.index].text
      if (existing !== edit.before) return response.status(409).json({ error: "This paragraph changed on the other device. Review the latest text and try again." })
      current.wordEdits[edit.index] = edit.value
      current.contentVersion++
    } else if (edit.kind === "field" && current.extension === "pdf" && typeof edit.name === "string" && edit.name.length <= 300 && (typeof edit.value === "boolean" || typeof edit.value === "string" && edit.value.length <= 2000)) {
      if (typeof edit.value === "string") (await latinFont).encodeText(edit.value)
      current.fields[edit.name] = edit.value
    } else if (edit.kind === "undo" && typeof edit.target === "string" && current.extension === "pdf") {
      current.marks = current.marks.filter(mark => mark.id !== edit.target)
    } else if (current.extension === "pdf" && Number.isInteger(edit.page) && edit.page >= 1 && edit.page <= current.pages && current.marks.length < 4000) {
      if (edit.kind === "ink" && Array.isArray(edit.points) && edit.points.length > 0 && edit.points.length <= 1200 && edit.points.every(isPoint)) {
        delete previews[request.role]
        current.marks.push({ id: edit.id, page: edit.page, kind: "ink", points: edit.points })
      } else if (edit.kind === "text" && typeof edit.value === "string" && edit.value.trim() && edit.value.length <= 400 && isPoint(edit.at) && Number.isFinite(edit.angle) && Math.abs(edit.angle) <= 360 && [10, 12, 14, 18, 24].includes(edit.size)) {
        (await latinFont).encodeText(edit.value)
        current.marks.push({ id: edit.id, page: edit.page, kind: "text", at: edit.at, angle: edit.angle, size: edit.size, value: edit.value })
      } else return response.status(400).json({ error: "This change could not be applied." })
    } else return response.status(400).json({ error: "This change could not be applied." })
    if (edit.kind !== "history-undo" && edit.kind !== "history-redo") history.remember(current, before)
    current.applied.add(edit.id)
    revision++
    await checkpoint()
    response.json(snapshot(current))
  }
  web.get("/api/save/:id", async (request, response) => {
    const result = await exportFile(request.params.id)
    response.attachment(result.filename).type(downloadMime[result.extension]).send(Buffer.from(result.bytes))
  })
  web.use((error, request, response, next) => {
    if (response.headersSent) return next(error)
    response.status(error.status || 422).json({ error: error.type === "entity.too.large" ? "Choose a file smaller than 40 MB." : error.message })
  })

  const server = await new Promise((resolve, reject) => {
    const listener = web.listen(port, "0.0.0.0", () => resolve(listener))
    listener.once("error", reject)
  })
  if (recoveryDirectory) {
    try {
      const saved = JSON.parse(await fs.readFile(path.join(recoveryDirectory, "session.json"), "utf8"))
      if (!/^[a-f0-9-]+\.bin$/.test(saved.source)) throw new Error("Invalid recovery source")
      const bytes = await fs.readFile(path.join(recoveryDirectory, saved.source))
      await open(saved.filename, bytes, true)
      document.id = saved.id
      document.contentVersion = saved.contentVersion
      document.fields = Object.assign(Object.create(null), saved.fields)
      document.wordEdits = Object.assign(Object.create(null), saved.wordEdits)
      document.marks = saved.marks
      document.ocr = Object.assign(Object.create(null), saved.ocr)
      document.applied = new Set(saved.applied)
      previousSource = saved.source
    } catch (error) {
      if (error.code !== "ENOENT") console.warn("The previous document session could not be recovered.")
    }
  }

  async function checkpoint() {
    if (!recoveryDirectory || !document) return
    const current = document
    const source = current.id + "-" + current.contentVersion + ".bin"
    const bytes = current.bytes
    const metadata = JSON.stringify({
      id: current.id, filename: current.filename, source, contentVersion: current.contentVersion,
      fields: current.fields, wordEdits: current.wordEdits, marks: current.marks,
      ocr: current.ocr, applied: [...current.applied]
    })
    checkpointQueue = checkpointQueue.catch(() => {}).then(async () => {
      await fs.mkdir(recoveryDirectory, { recursive: true })
      if (source !== previousSource) {
        await fs.writeFile(path.join(recoveryDirectory, source + ".tmp"), bytes)
        await fs.rename(path.join(recoveryDirectory, source + ".tmp"), path.join(recoveryDirectory, source))
      }
      await fs.writeFile(path.join(recoveryDirectory, "session.tmp"), metadata)
      await fs.rename(path.join(recoveryDirectory, "session.tmp"), path.join(recoveryDirectory, "session.json"))
      if (previousSource && previousSource !== source) await fs.unlink(path.join(recoveryDirectory, previousSource)).catch(() => {})
      previousSource = source
    })
    return checkpointQueue
  }

  function snapshot(current) {
    return {
      id: current.id, filename: current.filename, extension: current.extension, pages: current.pages, contentVersion: current.contentVersion,
      saveExtension: current.extension === "doc" && Object.keys(current.wordEdits).length ? "docx" : current.extension,
      marks: current.marks, fields: current.fields,
      canUndo: current.undo.length > 0, canRedo: current.redo.length > 0,
      lines: current.word?.lines.map((line, index) => ({ ...line, text: current.wordEdits[index] ?? line.text }))
    }
  }

  async function open(name, bytes, restoring = false) {
    const order = ++openSequence
    const filename = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, "").slice(0, 240)
    const extension = path.extname(filename).slice(1).toLowerCase()
    if (!downloadMime[extension] || bytes.length > maxBytes) throw new Error("Choose a PDF, DOC, or DOCX under 40 MB.")
    const next = {
      id: crypto.randomUUID(), filename, bytes, extension, marks: [], applied: new Set(), contentVersion: 0,
      fields: Object.create(null), wordEdits: Object.create(null), ocr: Object.create(null), undo: [], redo: []
    }
    if (extension === "pdf") {
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
      next.pages = pdf.getPageCount()
    } else next.word = await readWord(bytes, extension)
    if (order !== openSequence) throw new Error("A newer file was selected.")
    document = next
    delete previews.pc
    delete previews.phone
    revision++
    if (!restoring) await checkpoint()
  }

  async function exportFile(id) {
    const current = document
    if (!current || current.id !== id) throw new Error("The open document changed.")
    const stem = path.basename(current.filename, path.extname(current.filename))
    let { extension, bytes } = current
    const marks = [...current.marks]
    const fields = Object.entries(current.fields)
    const wordEdits = { ...current.wordEdits }
    if (current.word && Object.keys(wordEdits).length) {
      bytes = await saveWord(current.word, wordEdits)
      extension = "docx"
    }
    if (extension === "pdf" && (marks.length || fields.length)) {
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
        if (mark.kind === "text") {
          page.drawText(mark.value, { x: mark.at[0], y: mark.at[1], size: mark.size, rotate: degrees(mark.angle), font, color })
        } else {
          for (let index = 1; index < mark.points.length; index++) {
            const [x, y] = mark.points[index - 1]
            const [endX, endY] = mark.points[index]
            page.drawLine({ start: { x, y }, end: { x: endX, y: endY }, thickness: 1.7, color })
          }
        }
      }
      bytes = await pdf.save({ updateFieldAppearances: false })
    }
    return { filename: stem + " - copy." + extension, bytes, extension }
  }

  return { server, owner, address: "http://127.0.0.1:" + server.address().port, maxBytes, open, exportFile }
}

module.exports = { start }
if (require.main === module) start().then(({ address, owner }) => console.log(address + "/#owner=" + owner))
