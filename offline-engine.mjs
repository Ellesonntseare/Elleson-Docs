import {applyInkCut} from './ink-cut.mjs'
import {drawPdfInk} from './ink-export.mjs'
import { fieldValues, sameValue, validFieldValue, setFieldValue, flattenPdfForm } from './pdf-fields.mjs'
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib"
import { protectPdf } from "./pdf-protection.mjs"
import { decoratePdf, documentInfo, needsPassword, unlockPdf, redactPdf, extractImages } from "./document-extras.mjs"
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate"
import { extract, replace, organize, scanImage, imageInfo } from "./pdf-edit.mjs"
import { applyFormatting, ensureListParts, insertTable, insertImage, validFormat, changeWordInk, validInkPosition, changeWordInkBatch } from "./word-format.mjs"
import { diffChars } from "diff"
import { editWord } from "./word-tools.mjs"
import { changeMarks } from "./mark-tools.mjs"
import { review, reviewList, image as changeImage, images, combineEditable } from "./pdf-tools.mjs"

const namespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
const capture = file => ({
  bytes: file.bytes, marks: structuredClone(file.marks), fields: { ...file.fields },
  wordEdits: { ...file.wordEdits }, wordFormats: structuredClone(file.wordFormats || {}), lines: structuredClone(file.lines),
  pages: file.pages, ocr: structuredClone(file.ocr || {}), originalFields: { ...file.originalFields }
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
  const readStored = key => new Promise((resolve, reject) => { const request = database.transaction("documents").objectStore("documents").get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
  const workspace = await readStored("workspace")
  const files = new Map((workspace?.files || (file ? [file] : [])).map(item => [item.id, item]))
  if (workspace) file = files.get(workspace.active) || [...files.values()].at(-1) || null
  let versionLimit = (await readStored("settings"))?.limit || 20
  let library = await new Promise((resolve, reject) => {
    const request = database.transaction("documents").objectStore("documents").get("library")
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(request.error)
  })
  let revision = 1
  let storageWarning = ""
  let queue = Promise.resolve()
  const fetchAsset = window.fetch.bind(window)
  window.addEventListener("elleson-local-saved", event => {
    const operation = queue.then(async () => {
      const saved = files.get(event.detail.id)
      if (!saved) return
      saved.savedNumber = Math.max(saved.savedNumber, Number(event.detail.version))
      revision++
      await persist()
    })
    queue = operation.catch(() => {})
  })
  const persist = () => new Promise((resolve, reject) => {
    const transaction = database.transaction("documents", "readwrite")
    transaction.objectStore("documents").put(file, "active")
    transaction.objectStore("documents").put(library, "library")
    transaction.objectStore("documents").put({ active: file?.id, files: [...files.values()] }, "workspace")
    transaction.objectStore("documents").put({ limit: versionLimit }, "settings")
    transaction.oncomplete = resolve
    transaction.onerror = transaction.onabort = () => reject(new Error("Phone storage is full or unavailable. Keep this document open and save a copy to another location."))
  })
  const snapshot = () => file && ({
    id: file.id, filename: file.filename, extension: file.extension, pages: file.pages,
    contentVersion: file.contentVersion, structureVersion: file.structureVersion || 0, marks: file.marks, fields: file.fields, originalFields: file.originalFields || {},
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
    record.versions = record.versions.slice(-versionLimit)
  }
  function wordXml() {
    const archive = unzipSync(file.bytes)
    const document = new DOMParser().parseFromString(strFromU8(archive["word/document.xml"]), "application/xml")
    if (document.querySelector("parsererror")) throw new Error("This Word document could not be read.")
    return { archive, document }
  }
  function refreshWordLines(){
    const {document}=wordXml(),ns=document.documentElement.namespaceURI
    file.lines=Array.from(document.getElementsByTagNameNS(ns,'p'),paragraph=>({text:Array.from(paragraph.getElementsByTagNameNS(ns,'t')).filter(node=>{let p=node.parentNode;while(p&&p.localName!=='p')p=p.parentNode;return p===paragraph}).map(node=>node.textContent).join(''),editable:paragraph.getElementsByTagNameNS(ns,'t').length>0,style:''}))
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
  async function exported(flatten, excludeMarks = false) {
    if (file.extension === "docx") return source()
    const document = await PDFDocument.load(file.bytes)
    const font = await document.embedFont(StandardFonts.Helvetica)
    const form = document.getForm()
    for (const [name, value] of Object.entries(file.fields)) {
      const field = form.getFieldMaybe(name)
      if (!field) continue
      setFieldValue(field, value)
    }
    form.updateFieldAppearances(font)
    for (const mark of excludeMarks ? [] : file.marks) {
      const page = document.getPage(mark.page - 1)
      const color = rgb(.035, .2, .32)
      if (mark.kind === "text") page.drawText(mark.value, {
        x: mark.at[0], y: mark.at[1], size: mark.size, rotate: degrees(mark.angle), font, color
      })
      else {
        const inkColor = mark.color ? rgb(...[1, 3, 5].map(offset => parseInt(mark.color.slice(offset, offset + 2), 16) / 255)) : color
        drawPdfInk(page,mark,inkColor)
      }
    }
    if (flatten) flattenPdfForm(document)
    return document.save()
  }
  async function handle(url, options) {
    const parts = url.pathname.split("/").filter(Boolean)
    const action = parts[1]
    const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body
    if (action === "storage") {
      if (options.method === "POST") {
        if (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 100) throw new Error("Keep between 1 and 100 versions.")
        versionLimit = body.limit
        library.forEach(record => { record.versions = record.versions.slice(-versionLimit) })
        await persist()
      }
      return Response.json({ documents: library.length, versions: library.reduce((sum, record) => sum + record.versions.length, 0), bytes: library.reduce((sum, record) => sum + record.versions.reduce((size, version) => size + version.size, 0), 0), limit: versionLimit })
    }
    if (action === "backup") {
      const entries = { "README.txt": strToU8("Elleson Docs library backup. documents/ contains standard document files.") }
      for (const record of library) for (const version of record.versions) entries["documents/" + version.id + "." + version.filename.split(".").pop()] = version.bytes
      entries["index.json"] = strToU8(JSON.stringify(library.map(record => ({ ...record, versions: record.versions.map(({ bytes, ...version }) => version) }))))
      return new Response(zipSync(entries, { level: 1 }), { headers: { "Content-Type": "application/zip" } })
    }
    if(action==='restore-checkpoint'){
      if(file?.id!==parts[2])throw Error('The open document changed.')
      const record=library.find(record=>record.id===file.libraryId),saved=record?.versions.find(version=>version.id===body.version)
      if(!saved)throw Error('Saved version not found.')
      const libraryId=file.libraryId;recordVersion(file,await exported(false));await persist()
      return handle(new URL('/api/open',location.href),{headers:{'X-Filename':encodeURIComponent(saved.filename)},body:new Blob([saved.bytes]),libraryId})
    }
    if (action === "checkpoint") {
      if(file?.id!==parts[2])throw Error('The open document changed.')
      recordVersion(file,await exported(false));revision++;await persist();return Response.json(snapshot())
    }
    if (action === "library") {
      const record = library.find(record => record.id === parts[2])
      if (!parts[2]) return Response.json(library.map(({ versions, ...record }) => ({ ...record, versionCount: versions.length }))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated))
      if (!record) throw new Error("Saved document not found.")
      if(parts[3] === "preview") {
        const version=record.versions.find(version=>version.id===parts[4]);if(!version)throw Error('Saved version not found.')
        return new Response(version.bytes,{headers:{'Content-Type':/\.pdf$/i.test(version.filename)?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}})
      }
      if (options.method === "DELETE") {
        if (parts[3] === "versions") {
          if (record.versions.at(-1).id === parts[4]) throw new Error("Keep the latest version or remove the whole document.")
          record.versions = record.versions.filter(version => version.id !== parts[4])
        } else library = library.filter(item => item !== record)
        await persist(); return new Response(null, { status: 204 })
      }
      if (parts[3] === "compare") {
        const results = []
        for (const key of ["left", "right"]) {
          const saved = record.versions.find(version => version.id === url.searchParams.get(key))
          if (!saved) throw new Error("Saved version not found.")
          if (/\.pdf$/i.test(saved.filename)) {
            const pdf = await PDFDocument.load(saved.bytes), count = pdf.getPageCount()
            const fields = pdf.getForm().getFields().map(field => field.getName() + ": " + (field.getText?.() ?? field.isChecked?.() ?? field.getSelected?.()?.join(", ") ?? ""))
            results.push({ filename: saved.filename, pages: count, limited: count > 200, text: Array.from({ length: Math.min(count, 200) }, (_, index) => "Page " + (index + 1) + "\n" + extract(saved.bytes, index).map(span => span.text).join("\n")).join("\n\n") + "\n" + fields.join("\n") })
          } else {
            const xml = new DOMParser().parseFromString(strFromU8(unzipSync(saved.bytes)["word/document.xml"]), "application/xml")
            results.push({ filename: saved.filename, text: Array.from(xml.getElementsByTagNameNS(xml.documentElement.namespaceURI, "p"), p => p.textContent).join("\n") })
          }
        }
        return Response.json(results)
      }
      if (parts[3] === "versions") return Response.json([...record.versions].reverse().map(({ bytes, ...version }) => version))
      if (parts[3] === "pin") {
        record.pinned = body.pinned === true
        await persist()
        return new Response(null, { status: 204 })
      }
      if (parts[3] === "open") {
        const existing = !body.version && [...files.values()].find(item => item.libraryId === record.id)
        if (existing) { file = existing; revision++; await persist(); return new Response(null, { status: 204 }) }
        const version = body.version ? record.versions.find(version => version.id === body.version) : record.versions.at(-1)
        if (!version) throw new Error("Saved version not found.")
        return handle(new URL("/api/open", location.href), {
          headers: { "X-Filename": encodeURIComponent(version.filename) }, body: new Blob([version.bytes]), libraryId: record.id
        })
      }
    }
    if (action === "state") return Response.json({
      revision, role: "pc", paired: false, preview: null, recoveryWarning: storageWarning,
      tabs: [...files.values()].map(item => ({ id: item.libraryId, documentId: item.id, filename: item.filename, dirty: item.changeNumber !== item.savedNumber })),
      ...(Number(url.searchParams.get("revision")) === revision ? {} : { document: snapshot() })
    })
    if (action === "close") {
      if (!files.has(parts[2])) throw new Error("The open document changed.")
      files.delete(parts[2])
      if (file?.id === parts[2]) file = [...files.values()].at(-1) || null
      revision++
      await persist()
      return new Response(null, { status: 204 })
    }
    if (action === "open") {
      if (!options.libraryId && (files.size >= 12 || [...files.values()].reduce((sum, item) => sum + item.bytes.length, 0) > 120 * 1024 * 1024)) throw new Error("Close another tab before opening more documents.")
      const filename = decodeURIComponent(new Headers(options.headers).get("X-Filename") || "")
      const extension = filename.split(".").pop().toLowerCase()
      if (!["pdf", "docx"].includes(extension)) throw new Error("Standalone mode currently supports PDF and DOCX. Use the PC to open legacy DOC files.")
      let bytes = new Uint8Array(await options.body.arrayBuffer())
      if(extension==='pdf' && needsPassword(bytes)) {
        const password=new Headers(options.headers).get('x-pdf-password')
        if(!password)return Response.json({error:'This PDF needs a password.',passwordRequired:true},{status:422})
        try{bytes=unlockPdf(bytes,decodeURIComponent(password))}catch(error){return Response.json({error:error.message,passwordRequired:true},{status:422})}
      }
      if (bytes.length > 40 * 1024 * 1024) throw new Error("Choose a file smaller than 40 MB.")
      const next = {
        id: crypto.randomUUID(), filename, extension, bytes, marks: [], fields: {}, wordEdits: {}, wordFormats: {},
        undo: [], redo: [], contentVersion: 0, changeNumber: 0, savedNumber: 0, applied: [], ocr: {}, libraryId: options.libraryId
      }
      if (extension === "pdf") {
        const pdf = await PDFDocument.load(bytes)
        next.pages = pdf.getPageCount()
        next.originalFields = fieldValues(pdf)
      }
      else {
        const archive = unzipSync(bytes, { filter: entry => {
          if (entry.originalSize > 40 * 1024 * 1024) throw new Error("This Word file is too large.")
          return true
        } })
        if (!archive["word/document.xml"]) throw new Error("This is not a valid DOCX file.")
        const xml = new DOMParser().parseFromString(strFromU8(archive["word/document.xml"]), "application/xml")
        next.lines = Array.from(xml.getElementsByTagNameNS(xml.documentElement.namespaceURI, "p"), paragraph => {
          const nodes = Array.from(paragraph.getElementsByTagNameNS(xml.documentElement.namespaceURI, "t")).filter(node => { let owner = node.parentNode; while (owner && owner.localName !== "p") owner = owner.parentNode; return owner === paragraph })
          return { text: nodes.map(node => node.textContent).join(""), style: "", editable: nodes.length > 0 }
        })
      }
      file = next
      if (!options.libraryId) recordVersion(file, bytes)
      if (options.libraryId) for (const [id, item] of files) if (item.libraryId === options.libraryId) files.delete(id)
      files.set(file.id, file)
      revision++
      await persist()
      return new Response(null, { status: 204 })
    }
    if(action==='convert-word')return Response.json({error:'Connect to the Windows app to convert Word files.'},{status:422})
    if (!file || parts[2] !== file.id) return Response.json({ error: "The open document changed." }, { status: 409 })
    if (action === "rename") {
      const name = body.name
      if (typeof name !== "string" || !name.trim() || name.length > 180 || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || !name.toLowerCase().endsWith("." + file.extension)) throw new Error("Use a valid filename and keep its current extension.")
      file.filename = name.trim(); revision++; await persist(); return Response.json(snapshot())
    }
    if (action === "review") return Response.json(reviewList(file.bytes, Number(parts[3]) - 1))
    if (action === "pdf-images") return Response.json(images(file.bytes, Number(parts[3]) - 1))
    if (action === "pdf-image") {
      const description = JSON.parse(new Headers(options.headers).get("X-Image-Edit") || "{}")
      if (file.applied.includes(description.id)) { await persist(); return Response.json(snapshot()) }
      if (description.version !== file.contentVersion) throw new Error("Select the page again.")
      const before = capture(file)
      file.bytes = await changeImage(file.bytes, new Uint8Array(await options.body.arrayBuffer()), description)
      file.contentVersion++; file.changeNumber++; file.undo.push(before); file.redo = []; file.applied.push(description.id)
      revision++; await persist(); return Response.json(snapshot())
    }
    if (action === "preview") return new Response(null, { status: 204 })
    if (action === "source") return new Response(await source(), { headers: {
      "Content-Type": file.extension === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    } })
    if(action==='word-ink-batch'){
      if(file?.id!==parts[2]||!file.lines)throw Error('The open Word document changed.')
      if(file.applied.includes(body.id))return Response.json(snapshot())
      if(body.version!==file.contentVersion)throw Error('The document changed. Select the drawings again.')
      const before=capture(file);file.bytes=changeWordInkBatch(await source(),body);file.wordEdits={};file.wordFormats={};refreshWordLines();file.contentVersion++
      file.undo.push(before);file.redo=[];file.applied.push(body.id);file.changeNumber++;revision++;await persist();return Response.json(snapshot())
    }
    if (action === 'word-erase' || action === 'word-ink-edit') {
      const {id,version,target,position}=JSON.parse(options.body||'{}')
      if(file.applied.includes(id))return Response.json(snapshot())
      if(!file.lines||version!==file.contentVersion)return new Response(null,{status:409})
      const erase=action==='word-erase'
      if(!/^[a-zA-Z0-9-]{12,80}$/.test(id||'')||typeof target!=='string'||!erase&&!validInkPosition(position))return new Response(null,{status:400})
      const bytes=changeWordInk(await source(),target,erase?undefined:position)
      if(!bytes)return new Response(null,{status:404})
      file.undo.push(capture(file));file.redo=[]
      file.bytes=bytes;file.wordEdits={};file.wordFormats={};refreshWordLines()
      file.contentVersion++;file.changeNumber++;file.applied.push(id);revision++
      await persist()
      return Response.json(snapshot())
    }
    if (action === "word-image") {
      const headers = new Headers(options.headers)
      const operationId = headers.get("X-Operation-Id")
      if (file.applied.includes(operationId)) { await persist(); return Response.json(snapshot()) }
      const index = Number(headers.get("X-Paragraph-Index"))
      if (Number(headers.get("X-Document-Version")) !== file.contentVersion || !file.lines?.[index]) throw new Error("Select the paragraph again.")
      const before = capture(file)
      const bytes = headers.get('Content-Type')==='application/json'?Uint8Array.from(atob(body.png),c=>c.charCodeAt(0)):new Uint8Array(await options.body.arrayBuffer())
      const position = headers.get('Content-Type')==='application/json'?body.position:headers.get('X-Word-Ink') ? JSON.parse(headers.get('X-Word-Ink')) : undefined
      file.bytes = await source(undefined, { ...imageInfo(bytes), bytes, index, position })
      file.wordEdits = {}
      file.wordFormats = {}
      if (!position) file.structureVersion = (file.structureVersion || 0) + 1
      const { document } = wordXml()
      file.lines = Array.from(document.getElementsByTagNameNS(document.documentElement.namespaceURI, "p"), paragraph => {
        const nodes = Array.from(paragraph.getElementsByTagNameNS(document.documentElement.namespaceURI, "t")).filter(node => { let owner = node.parentNode; while (owner && owner.localName !== "p") owner = owner.parentNode; return owner === paragraph })
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
    if (action === "filter-source" && file.extension !== "pdf") return Response.json({error:"Connect to the Windows app to filter Word pages."},{status:422})
    if (action === "print" || action === "filter-source") return new Response(await exported(true), { headers: { "Content-Type": "application/pdf" } })
    if (action === "text") return Response.json({
      version: file.contentVersion, spans: extract(file.bytes, Number(parts[3]) - 1, file.ocr?.[Number(parts[3]) - 1] || [])
    })
    if (action === "preview-text") {
      if (body.version !== file.contentVersion) throw new Error("The page changed. Select the text again.")
      const run = typeof body.span === "string" ? file.ocr?.[body.page - 1]?.find(line => line.id === body.span) : undefined
      const bytes = replace(file.bytes, body.page - 1, body.span, body.before, body.value, run, body.font, body.layout)
      return new Response(scanImage(bytes, body.page - 1).image, { headers: { "Content-Type": "image/png" } })
    }
    if (action === "save") {
      const bytes = await exported(url.searchParams.get("flatten") === "1")
      if (!url.searchParams.has("transfer")) {
        const previousLibrary = library.map(record => ({ ...record, versions: [...record.versions] })), previousSaved = file.savedNumber
        recordVersion(file, bytes)
        if (!window.EllesonAndroid) { file.savedNumber = file.changeNumber; revision++ }
        try { await persist() }
        catch { library = previousLibrary; file.savedNumber = previousSaved; storageWarning = "The copy is available to export, but local history could not be updated. Free phone storage and keep your exported copy."; revision++ }
      }
      return new Response(bytes, { headers: { "Content-Type": file.extension === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "X-Elleson-Revision": String(file.changeNumber),
        "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(file.filename) } })
    }
    if (action === "protect") {
      if (file.extension !== "pdf") throw new Error("Open a PDF to set its password.")
      return new Response(protectPdf(await exported(false), body.password), { headers: { "Content-Type": "application/pdf" } })
    }
    if (action === "info") return Response.json(file.extension === "pdf" ? documentInfo(await exported(false)) : {bytes:(await source()).length,type:file.extension})
    if(action==='extract-images'){if(file.extension!=='pdf')throw new Error('Open a PDF first.');return new Response(extractImages(await exported(false)),{headers:{'Content-Type':'application/zip'}})}
    if(action==='redact'){if(file.extension!=='pdf')throw new Error('Open a PDF first.');return new Response(redactPdf(await exported(false),body),{headers:{'Content-Type':'application/pdf'}})}
    if (action === "decorate") {
      if (file.extension !== "pdf") throw new Error("Open a PDF first.")
      if (["header","footer","watermark"].some(key => body[key] && (typeof body[key] !== "string" || body[key].length > 120))) throw new Error("Keep each label under 120 characters.")
      return new Response(await decoratePdf(await exported(false),body),{headers:{"Content-Type":"application/pdf"}})
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
      if (file.applied.includes(operationId)) { await persist(); return Response.json(snapshot()) }
      const before = capture(file)
      const incoming = new Uint8Array(await options.body.arrayBuffer())
      const result = url.searchParams.get("editable") === "1" ? await combineEditable(await exported(false), incoming) : organize(await exported(false), "combine", null, incoming)
      file.undo.push(before)
      file.redo = []
      Object.assign(file, result, { marks: [], fields: {} })
      file.originalFields = fieldValues(await PDFDocument.load(file.bytes))
      file.contentVersion++
      file.changeNumber++
      revision++
      file.applied.push(operationId)
      await persist()
      return Response.json(snapshot())
    }
    if (action !== "edit") return Response.json({ error: "This action is unavailable offline." }, { status: 400 })
    if (file.applied.includes(body.id)) { await persist(); return Response.json(snapshot()) }
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
        const oldMarks=file.marks
        Object.assign(file, organize(await exported(false, body.action === "plan"), body.action, body.pages), { marks: body.action === "plan" ? body.pages.flatMap((item,index)=>oldMarks.filter(mark=>mark.page===item.index+1).map(mark=>({...mark,id:body.id+"-"+index+"-"+mark.id,group:mark.group?body.id+"-"+index+"-"+mark.group:undefined,page:index+1}))) : [], fields: {} })
        file.originalFields = fieldValues(await PDFDocument.load(file.bytes))
        file.contentVersion++
      } else if (body.kind === "field") {
        const actual = file.fields[body.name] ?? file.originalFields?.[body.name] ?? ""
        if (Object.hasOwn(body, "before") && !sameValue(actual, body.before)) return Response.json({ error: "This field changed.", actual, code: "EDIT_CONFLICT" }, { status: 409 })
        if (!validFieldValue(body.value)) throw new Error("Choose a valid field value.")
        file.fields[body.name] = body.value
      }
      else if (body.kind === "ink-cut" && file.extension === "pdf") file.marks=applyInkCut(file.marks,body)
      else if (body.kind === "transform") file.marks = changeMarks(file.marks, body)
      else if (body.kind === "review") {
        if (body.version !== file.contentVersion) throw new Error("The page changed.")
        file.bytes = review(file.bytes, body); file.contentVersion++
      }
      else if (body.kind === "word-tools") {
        if (body.version !== file.contentVersion) throw new Error("The document changed. Select the text again.")
        file.bytes = await source(); file.wordEdits = {}; file.wordFormats = {}
        const { document, archive } = wordXml()
        editWord(document, archive, body, DOMParser, XMLSerializer, strFromU8, strToU8)
        archive["word/document.xml"] = strToU8(new XMLSerializer().serializeToString(document))
        file.bytes = zipSync(archive)
        file.lines = Array.from(document.getElementsByTagNameNS(document.documentElement.namespaceURI, "p"), paragraph => {
          const nodes = Array.from(paragraph.getElementsByTagNameNS(document.documentElement.namespaceURI, "t")).filter(node => { let owner = node.parentNode; while (owner && owner.localName !== "p") owner = owner.parentNode; return owner === paragraph })
          return { text: nodes.map(node => node.textContent).join(""), editable: nodes.length > 0, style: "" }
        })
        file.contentVersion++
      }
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
          const nodes = Array.from(paragraph.getElementsByTagNameNS(document.documentElement.namespaceURI, "t")).filter(node => { let owner = node.parentNode; while (owner && owner.localName !== "p") owner = owner.parentNode; return owner === paragraph })
          return { text: nodes.map(node => node.textContent).join(""), editable: nodes.length > 0, style: "" }
        })
        file.contentVersion++
      } else if (body.kind === "word") {
        if ((body.structureVersion ?? 0) !== (file.structureVersion || 0)) return Response.json({error:"The paragraph order changed. Your draft is retained for review.",code:"STRUCTURE_CONFLICT"},{status:409})
        if ((file.wordEdits[body.index] ?? file.lines[body.index].text) !== body.before) return Response.json({ error: "The paragraph changed. Select it again.", code: "EDIT_CONFLICT", actual: file.wordEdits[body.index] ?? file.lines[body.index].text }, {status:409})
        file.wordEdits[body.index] = body.value
        file.contentVersion++
      } else if (body.kind === "replace") {
        if (body.version !== file.contentVersion) throw new Error("The page changed. Select the text again.")
      const run = typeof body.span === "string" ? file.ocr?.[body.page - 1]?.find(line => line.id === body.span) : undefined
      file.bytes = replace(file.bytes, body.page - 1, body.span, body.before, body.value, run, body.font, body.layout)
      if (file.ocr) file.ocr[body.page - 1] = []
        file.contentVersion++
      } else if (body.kind === "undo") {
        const group = file.marks.find(mark => mark.id === body.target)?.group
        file.marks = file.marks.filter(mark => group ? mark.group !== group : mark.id !== body.target)
      } else if (body.kind === "signature") file.marks.push(...body.strokes.map((points, index) => ({
        id: body.id + "-" + index, group: body.id, kind: "ink", page: body.page, points, color: /^#[a-f0-9]{6}$/i.test(body.color||"")?body.color:"#093352", width: Number.isFinite(body.width)&&body.width>=.25&&body.width<=30?body.width:2, opacity:body.opacity===.25?.25:1
      })))
      else if (["ink", "text"].includes(body.kind)) file.marks.push(body)
      else throw new Error("This change could not be applied.")
      file.undo.push(before)
      if (file.undo.length > 30) file.undo.shift()
      file.redo = []
    }
    if ((["word-table", "history-undo", "history-redo"].includes(body.kind) || body.kind === 'word-tools' && body.action !== 'range') && file.extension === "docx") file.structureVersion = (file.structureVersion || 0) + 1
    file.applied.push(body.id)
    file.changeNumber++
    revision++
    await persist()
    return Response.json(snapshot())
  }
  window.fetch = (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href)
    if (!url.pathname.startsWith("/api/")) return fetchAsset(input, options)
    const execute = () => handle(url, options).catch(error => Response.json({ error: error?.message || String(error) || 'The operation could not be completed.' }, { status: 422 }))
    if (options.method && options.method !== "GET") {
      const result = queue.then(execute)
      queue = result.catch(() => {})
      return result
    }
    return queue.then(execute)
  }
}
