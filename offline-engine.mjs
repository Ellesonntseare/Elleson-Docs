import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib"
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate"
import { extract, replace, organize, scanImage, imageInfo } from "./pdf-edit.mjs"
import { applyFormatting, ensureListParts, insertTable, insertImage, validFormat } from "./word-format.mjs"
import { diffChars } from "diff"

const namespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
const capture = file => ({
  bytes: file.bytes, marks: structuredClone(file.marks), fields: { ...file.fields },
  wordEdits: { ...file.wordEdits }, wordFormats: structuredClone(file.wordFormats || {}), lines: structuredClone(file.lines),
  pages: file.pages, ocr: structuredClone(file.ocr || {})
})

export async function install() {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("elleson-docs", 1)
    request.onupgradeneeded = () => request.result.createObjectStore("documents")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const stored = await new Promise((resolve, reject) => {
    const request = database.transaction("documents").objectStore("documents").get("active")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  let file = stored || null
  let library = await new Promise((resolve, reject) => {
    const request = database.transaction("documents").objectStore("documents").get("library")
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(request.error)
  })
  let revision = 1
  let queue = Promise.resolve()
  const fetchAsset = window.fetch.bind(window)
  window.addEventListener("elleson-local-saved", event => {
    const operation = queue.then(async () => {
      if (file?.id !== event.detail.id) return
      file.savedNumber = Number(event.detail.version)
      revision++
      await persist()
    })
    queue = operation.catch(() => {})
  })
  const persist = () => new Promise((resolve, reject) => {
    const transaction = database.transaction("documents", "readwrite")
    transaction.objectStore("documents").put(file, "active")
    transaction.objectStore("documents").put(library, "library")
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error || new Error("Phone storage is full."))
  })
  const snapshot = () => file && ({
    id: file.id, filename: file.filename, extension: file.extension, pages: file.pages,
    contentVersion: file.contentVersion, marks: file.marks, fields: file.fields,
    saveExtension: file.extension, dirty: file.changeNumber !== file.savedNumber, libraryId: file.libraryId,
    canUndo: file.undo.length > 0, canRedo: file.redo.length > 0,
    lines: file.lines?.map((line, index) => ({ ...line, text: file.wordEdits[index] ?? line.text }))
  })
  function recordVersion(target, bytes) {
    target.libraryId ||= crypto.randomUUID()
    let record = library.find(record => record.id === target.libraryId)
    if (!record) {
      record = { id: target.libraryId, filename: target.filename, pinned: false, versions: [] }
      library.push(record)
    }
    record.updated = Date.now()
    record.versions.push({ id: crypto.randomUUID(), filename: target.filename, date: Date.now(), size: bytes.length, bytes })
  }
  function wordXml() {
    const archive = unzipSync(file.bytes)
    const document = new DOMParser().parseFromString(strFromU8(archive["word/document.xml"]), "application/xml")
    if (document.querySelector("parsererror")) throw new Error("This Word document could not be read.")
    return { archive, document }
  }
  async function source(table, image) {
    if (file.extension !== "docx" || !Object.keys(file.wordEdits).length && !Object.keys(file.wordFormats || {}).length && !table && !image) return file.bytes
    const { archive, document } = wordXml()
    const paragraphs = Array.from(document.getElementsByTagNameNS(document.documentElement.namespaceURI, "p"))
    for (const [index, value] of Object.entries(file.wordEdits)) {
      const runs = Array.from(paragraphs[index].getElementsByTagNameNS(document.documentElement.namespaceURI, "t"))
        .filter(node => node.closest("p") === paragraphs[index])
      const ownership = runs.flatMap((node, owner) => Array.from(node.textContent, () => owner))
      const replacement = runs.map(() => "")
      let offset = 0
      for (const part of diffChars(runs.map(node => node.textContent).join(""), value)) {
        const characters = Array.from(part.value)
        if (part.added) replacement[ownership[Math.min(offset, ownership.length - 1)] ?? 0] += part.value
        else {
          if (!part.removed) for (let index = 0; index < characters.length; index++) replacement[ownership[offset + index] ?? 0] += characters[index]
          offset += characters.length
        }
      }
      runs.forEach((node, index) => {
        node.textContent = replacement[index]
        node.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve")
      })
    }
    const formats = file.wordFormats || {}
    const listIds = Object.values(formats).some(format => ["bullet", "decimal"].includes(format.list))
      ? ensureListParts(archive, DOMParser, XMLSerializer, strFromU8, strToU8, document.documentElement.namespaceURI) : {}
    applyFormatting(document, formats, listIds)
    if (table) insertTable(document, table.index, table.rows, table.columns)
    if (image) insertImage(document, archive, image, DOMParser, XMLSerializer, strFromU8, strToU8)
    archive["word/document.xml"] = strToU8(new XMLSerializer().serializeToString(document))
    return zipSync(archive)
  }
  async function exported(flatten) {
    if (file.extension === "docx") return source()
    const document = await PDFDocument.load(file.bytes)
    const font = await document.embedFont(StandardFonts.Helvetica)
    const form = document.getForm()
    for (const [name, value] of Object.entries(file.fields)) {
      const field = form.getFieldMaybe(name)
      if (!field) continue
      if (typeof value === "boolean") value ? field.check() : field.uncheck()
      else if (typeof field.setText === "function") field.setText(value)
      else if (typeof field.select === "function") field.select(value)
    }
    form.updateFieldAppearances(font)
    for (const mark of file.marks) {
      const page = document.getPage(mark.page - 1)
      const color = rgb(.035, .2, .32)
      if (mark.kind === "text") page.drawText(mark.value, {
        x: mark.at[0], y: mark.at[1], size: mark.size, rotate: degrees(mark.angle), font, color
      })
      else for (let index = 1; index < mark.points.length; index++) {
        const inkColor = mark.color ? rgb(...[1, 3, 5].map(offset => parseInt(mark.color.slice(offset, offset + 2), 16) / 255)) : color
        page.drawLine({ start: { x: mark.points[index - 1][0], y: mark.points[index - 1][1] },
          end: { x: mark.points[index][0], y: mark.points[index][1] }, thickness: mark.width || 1.7, color: inkColor, opacity: mark.opacity ?? 1 })
      }
    }
    if (flatten) form.flatten()
    return document.save()
  }
  async function handle(url, options) {
    const parts = url.pathname.split("/").filter(Boolean)
    const action = parts[1]
    const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body
    if (action === "library") {
      const record = library.find(record => record.id === parts[2])
      if (!parts[2]) return Response.json(library.map(({ versions, ...record }) => ({ ...record, versionCount: versions.length }))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated))
      if (!record) throw new Error("Saved document not found.")
      if (parts[3] === "versions") return Response.json([...record.versions].reverse().map(({ bytes, ...version }) => version))
      if (parts[3] === "pin") {
        record.pinned = body.pinned === true
        await persist()
        return new Response(null, { status: 204 })
      }
      if (parts[3] === "open") {
        const version = body.version ? record.versions.find(version => version.id === body.version) : record.versions.at(-1)
        if (!version) throw new Error("Saved version not found.")
        return handle(new URL("/api/open", location.href), {
          headers: { "X-Filename": encodeURIComponent(version.filename) }, body: new Blob([version.bytes]), libraryId: record.id
        })
      }
    }
    if (action === "state") return Response.json({
      revision, role: "pc", paired: false, preview: null,
      ...(Number(url.searchParams.get("revision")) === revision ? {} : { document: snapshot() })
    })
    if (action === "close") {
      if (!file || parts[2] !== file.id) throw new Error("The open document changed.")
      file = null
      revision++
      await persist()
      return new Response(null, { status: 204 })
    }
    if (action === "open") {
      const filename = decodeURIComponent(new Headers(options.headers).get("X-Filename") || "")
      const extension = filename.split(".").pop().toLowerCase()
      if (!["pdf", "docx"].includes(extension)) throw new Error("Standalone mode currently supports PDF and DOCX. Use the PC to open legacy DOC files.")
      const bytes = new Uint8Array(await options.body.arrayBuffer())
      if (bytes.length > 40 * 1024 * 1024) throw new Error("Choose a file smaller than 40 MB.")
      const next = {
        id: crypto.randomUUID(), filename, extension, bytes, marks: [], fields: {}, wordEdits: {}, wordFormats: {},
        undo: [], redo: [], contentVersion: 0, changeNumber: 0, savedNumber: 0, applied: [], ocr: {}, libraryId: options.libraryId
      }
      if (extension === "pdf") next.pages = (await PDFDocument.load(bytes)).getPageCount()
      else {
        const archive = unzipSync(bytes, { filter: entry => {
          if (entry.originalSize > 40 * 1024 * 1024) throw new Error("This Word file is too large.")
          return true
        } })
        if (!archive["word/document.xml"]) throw new Error("This is not a valid DOCX file.")
        const xml = new DOMParser().parseFromString(strFromU8(archive["word/document.xml"]), "application/xml")
        next.lines = Array.from(xml.getElementsByTagNameNS(xml.documentElement.namespaceURI, "p"), paragraph => {
          const nodes = Array.from(paragraph.getElementsByTagNameNS(xml.documentElement.namespaceURI, "t"))
          return { text: nodes.map(node => node.textContent).join(""), style: "", editable: nodes.length > 0 }
        })
      }
      file = next
      if (!options.libraryId) recordVersion(file, bytes)
      revision++
      await persist()
      return new Response(null, { status: 204 })
    }
    if (!file || parts[2] !== file.id) return Response.json({ error: "The open document changed." }, { status: 409 })
    if (action === "preview") return new Response(null, { status: 204 })
    if (action === "source") return new Response(await source(), { headers: {
      "Content-Type": file.extension === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    } })
    if (action === "word-image") {
      const headers = new Headers(options.headers)
      const operationId = headers.get("X-Operation-Id")
      if (file.applied.includes(operationId)) return Response.json(snapshot())
      const index = Number(headers.get("X-Paragraph-Index"))
      if (Number(headers.get("X-Document-Version")) !== file.contentVersion || !file.lines?.[index]) throw new Error("Select the paragraph again.")
      const before = capture(file)
      const bytes = new Uint8Array(await options.body.arrayBuffer())
      file.bytes = await source(undefined, { ...imageInfo(bytes), bytes, index })
      file.wordEdits = {}
      file.wordFormats = {}
      const { document } = wordXml()
      file.lines = Array.from(document.getElementsByTagNameNS(document.documentElement.namespaceURI, "p"), paragraph => {
        const nodes = Array.from(paragraph.getElementsByTagNameNS(document.documentElement.namespaceURI, "t"))
        return { text: nodes.map(node => node.textContent).join(""), editable: nodes.length > 0, style: "" }
      })
      file.undo.push(before)
      file.redo = []
      file.contentVersion++
      file.changeNumber++
      file.applied.push(operationId)
      revision++
      await persist()
      return Response.json(snapshot())
    }
    if (action === "extract") {
      const pages = (url.searchParams.get("pages") || "").split(",").map(value => Number(value.trim()) - 1)
      return new Response(organize(await exported(false), "extract", pages).bytes, {
        headers: { "Content-Type": "application/pdf" }
      })
    }
    if (action === "print") return new Response(await exported(true), { headers: { "Content-Type": "application/pdf" } })
    if (action === "text") return Response.json({
      version: file.contentVersion, spans: extract(file.bytes, Number(parts[3]) - 1, file.ocr?.[Number(parts[3]) - 1] || [])
    })
    if (action === "preview-text") {
      if (body.version !== file.contentVersion) throw new Error("The page changed. Select the text again.")
      const run = typeof body.span === "string" ? file.ocr?.[body.page - 1]?.find(line => line.id === body.span) : undefined
      const bytes = replace(file.bytes, body.page - 1, body.span, body.before, body.value, run, body.font)
      return new Response(scanImage(bytes, body.page - 1).image, { headers: { "Content-Type": "image/png" } })
    }
    if (action === "save") {
      const bytes = await exported(url.searchParams.get("flatten") === "1")
      recordVersion(file, bytes)
      if (!window.EllesonAndroid) {
        file.savedNumber = file.changeNumber
        revision++
      }
      await persist()
      return new Response(bytes, { headers: { "Content-Type": file.extension === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "X-Elleson-Revision": String(file.changeNumber),
        "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(file.filename) } })
    }
    if (action === "ocr") {
      const language = body.lang || "eng"
      if (!["eng", "fra", "spa"].includes(language)) throw new Error("Choose a supported recognition language.")
      if (!window.Tesseract) await new Promise((resolve, reject) => {
        const script = document.createElement("script")
        script.src = "/vendor/tesseract/tesseract.min.js"
        script.onload = resolve
        script.onerror = () => reject(new Error("Could not load the local recognition engine."))
        document.head.append(script)
      })
      const index = Number(parts[3]) - 1
      const { image, scale, bounds } = scanImage(file.bytes, index)
      const worker = await window.Tesseract.createWorker(language, 1, {
        workerPath: location.origin + "/vendor/tesseract/worker.min.js", workerBlobURL: false,
        corePath: location.origin + "/vendor/tesseract-core/", langPath: location.origin + "/vendor/ocr-data/",
        gzip: true, cacheMethod: "none"
      })
      try {
        const { data } = await worker.recognize(new Blob([image], { type: "image/png" }), {}, { blocks: true })
        const lines = (data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines))
          .filter(line => line.text.trim()).map((line, id) => ({
            id: "ocr-" + id, text: line.text.trim(),
            rect: [line.bbox.x0 / scale + bounds[0], line.bbox.y0 / scale + bounds[1],
              line.bbox.x1 / scale + bounds[0], line.bbox.y1 / scale + bounds[1]],
            size: Math.max(6, (line.bbox.y1 - line.bbox.y0) / scale * 1.15), confidence: line.confidence
          }))
        file.ocr ||= {}
        file.ocr[index] = lines
        file.contentVersion++
        revision++
        await persist()
        return Response.json({ lines: lines.length })
      } finally { await worker.terminate() }
    }
    if (action === "combine") {
      const operationId = new Headers(options.headers).get("X-Operation-Id")
      if (file.applied.includes(operationId)) return Response.json(snapshot())
      const before = capture(file)
      const result = organize(await exported(false), "combine", null, new Uint8Array(await options.body.arrayBuffer()))
      file.undo.push(before)
      file.redo = []
      Object.assign(file, result, { marks: [], fields: {} })
      file.contentVersion++
      file.changeNumber++
      revision++
      file.applied.push(operationId)
      await persist()
      return Response.json(snapshot())
    }
    if (action !== "edit") return Response.json({ error: "This action is unavailable offline." }, { status: 400 })
    if (file.applied.includes(body.id)) return Response.json(snapshot())
    const before = capture(file)
    if (body.kind === "history-undo" || body.kind === "history-redo") {
      const direction = body.kind === "history-undo" ? "undo" : "redo"
      if (!file[direction].length) throw new Error("There are no changes to " + direction + ".")
      file[direction === "undo" ? "redo" : "undo"].push(before)
      Object.assign(file, file[direction].pop())
      file.contentVersion++
    } else {
      if (body.kind === "pages") {
        if (body.version !== file.contentVersion) throw new Error("The document changed.")
        Object.assign(file, organize(await exported(false), body.action, body.pages), { marks: [], fields: {} })
        file.contentVersion++
      } else if (body.kind === "field") file.fields[body.name] = body.value
      else if (body.kind === "word-format") {
        if (body.version !== file.contentVersion) throw new Error("The document changed. Select the paragraph again.")
        if (!validFormat(body.format)) throw new Error("Choose valid text formatting.")
        file.wordFormats ||= {}
        file.wordFormats[body.index] = { ...file.wordFormats[body.index], ...body.format }
        file.contentVersion++
      } else if (body.kind === "word-table") {
        if (body.version !== file.contentVersion) throw new Error("The document changed. Select the paragraph again.")
        file.bytes = await source({ index: body.index, rows: body.rows, columns: body.columns })
        file.wordEdits = {}
        file.wordFormats = {}
        const { document } = wordXml()
        file.lines = Array.from(document.getElementsByTagNameNS(document.documentElement.namespaceURI, "p"), paragraph => {
          const nodes = Array.from(paragraph.getElementsByTagNameNS(document.documentElement.namespaceURI, "t"))
          return { text: nodes.map(node => node.textContent).join(""), editable: nodes.length > 0, style: "" }
        })
        file.contentVersion++
      } else if (body.kind === "word") {
        if ((file.wordEdits[body.index] ?? file.lines[body.index].text) !== body.before) throw new Error("The paragraph changed. Select it again.")
        file.wordEdits[body.index] = body.value
        file.contentVersion++
      } else if (body.kind === "replace") {
        if (body.version !== file.contentVersion) throw new Error("The page changed. Select the text again.")
      const run = typeof body.span === "string" ? file.ocr?.[body.page - 1]?.find(line => line.id === body.span) : undefined
      file.bytes = replace(file.bytes, body.page - 1, body.span, body.before, body.value, run, body.font)
      if (file.ocr) file.ocr[body.page - 1] = []
        file.contentVersion++
      } else if (body.kind === "undo") {
        const group = file.marks.find(mark => mark.id === body.target)?.group
        file.marks = file.marks.filter(mark => group ? mark.group !== group : mark.id !== body.target)
      } else if (body.kind === "signature") file.marks.push(...body.strokes.map((points, index) => ({
        id: body.id + "-" + index, group: body.id, kind: "ink", page: body.page, points, color: body.color, width: 2, opacity: 1
      })))
      else if (["ink", "text"].includes(body.kind)) file.marks.push(body)
      else throw new Error("This change could not be applied.")
      file.undo.push(before)
      if (file.undo.length > 30) file.undo.shift()
      file.redo = []
    }
    file.applied.push(body.id)
    file.changeNumber++
    revision++
    await persist()
    return Response.json(snapshot())
  }
  window.fetch = (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href)
    if (!url.pathname.startsWith("/api/")) return fetchAsset(input, options)
    const execute = () => handle(url, options).catch(error => Response.json({ error: error.message }, { status: 422 }))
    if (options.method && options.method !== "GET") {
      const result = queue.then(execute)
      queue = result.catch(() => {})
      return result
    }
    return queue.then(execute)
  }
}
