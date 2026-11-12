import * as pdfjs from "/pdfjs/legacy/build/pdf.mjs"
import "./offline.mjs"

pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/legacy/build/pdf.worker.mjs"
const byId = id => document.getElementById(id)
const $ = Object.fromEntries(Array.from(document.querySelectorAll("[id]"), item => [item.id, item]))
const owner = new URLSearchParams(location.hash.slice(1)).get("owner") ||
  (location.hostname === "appassets.androidplatform.net" ? "local" : null)
if (owner) history.replaceState(null, "", "/")
let credential = owner || sessionStorage.getItem("elleson-session") || ""
let role = owner ? "pc" : "phone"
let current = null
let revision = -1
let pdf
let loadingTask
let page = 1
let zoom = 1
let viewport
let mode = "read"
let renderIndex = 0
let localSequence = 0
let draft
let activeText
let refreshPending
let pendingEdit = Promise.resolve()
let editingWord = false
let wordRender = 0
let selectedSpan
let loadSequence = 0
let searchPhrase = ""
let foundPages = []
let findPosition = -1
let searchSource
let thumbnailObserver
let remoteDraft
let previewAt = 0
let sidebarOpen = matchMedia("(min-width: 601px)").matches
let signatureStrokes = []
let signatureDraft
let savedSignatures = []
let scanFile
let selectedWordIndex = null
let wordTarget
let openTabs = []
let tabsRendered = ""
try { openTabs = JSON.parse(sessionStorage.getItem("elleson-open-tabs") || "[]") } catch {}
try { savedSignatures = JSON.parse(localStorage.getItem("elleson-signatures") || "[]") } catch {}

function status(message) { $.status.textContent = message }
const bookmarkKey = () => "elleson-bookmarks-" + (current?.libraryId || current?.id)
function readBookmarks() {
  try { return JSON.parse(localStorage.getItem(bookmarkKey()) || "[]").filter(number => Number.isInteger(number) && number > 0) } catch { return [] }
}
async function showBookmarks() {
  if (!pdf) return
  const source = pdf
  const saved = readBookmarks()
  $["bookmark-list"].replaceChildren(...saved.map(number => {
    const row = document.createElement("div")
    row.className = "actions"
    const jump = document.createElement("button")
    jump.textContent = "Page " + number
    jump.disabled = number > pdf.numPages
    jump.addEventListener("click", () => { go(number); $["bookmarks-dialog"].close() })
    const remove = document.createElement("button")
    remove.textContent = "Remove"
    remove.setAttribute("aria-label", "Remove bookmark for page " + number)
    remove.addEventListener("click", () => {
      try { localStorage.setItem(bookmarkKey(), JSON.stringify(readBookmarks().filter(item => item !== number))); void showBookmarks().catch(fail) } catch (error) { fail(error) }
    })
    row.append(jump, remove)
    return row
  }))
  $["outline-list"].replaceChildren()
  const outline = await source.getOutline()
  if (source !== pdf) return
  function addOutline(items, depth = 0) {
    for (const item of items || []) {
      if (item.dest) {
        const button = document.createElement("button")
        button.textContent = item.title
        button.style.marginLeft = Math.min(depth, 8) * 12 + "px"
        button.addEventListener("click", () => void (async () => {
          const destination = typeof item.dest === "string" ? await source.getDestination(item.dest) : item.dest
          if (!destination || source !== pdf) return
          const index = typeof destination[0] === "number" ? destination[0] : await source.getPageIndex(destination[0])
          go(index + 1)
          $["bookmarks-dialog"].close()
        })().catch(fail))
        $["outline-list"].append(button)
      }
      addOutline(item.items, depth + 1)
    }
  }
  addOutline(outline)
  if (!$["outline-list"].children.length) $["outline-list"].textContent = "This PDF has no document outline."
  if (!$["bookmarks-dialog"].open) $["bookmarks-dialog"].showModal()
}
$["bookmarks"].addEventListener("click", () => void showBookmarks().catch(fail))
$["bookmark-add"].addEventListener("click", () => {
  try {
    localStorage.setItem(bookmarkKey(), JSON.stringify([...new Set([...readBookmarks(), page])].sort((a, b) => a - b)))
    void showBookmarks().catch(fail)
  } catch (error) { fail(error) }
})
function fail(error) { status(error.message || String(error)) }
const editId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("")

async function request(url, options = {}) {
  const headers = new Headers(options.headers)
  if (credential) headers.set("Authorization", "Bearer " + credential)
  const response = await fetch(url, { ...options, headers, cache: "no-store" })
  if (!response.ok) {
    const problem = await response.json().catch(() => null)
    const error = new Error(problem?.error || "Request failed (" + response.status + ").")
    error.status = response.status
    throw error
  }
  return response
}

const postJson = (url, body) => request(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
})

function layout() {
  updateTabs()
  $["format-paragraph"].disabled = selectedWordIndex === null
  $["insert-table"].disabled = selectedWordIndex === null
  $["insert-image"].disabled = selectedWordIndex === null
  $["save-state"].textContent = current ? current.dirty ? "Unsaved changes" : "Saved" : ""
  $["flatten-copy"].disabled = current?.extension !== "pdf"
  $["history-undo"].disabled = !current?.canUndo
  $["history-redo"].disabled = !current?.canRedo
  const connected = Boolean(credential)
  const hasPdf = current?.extension === "pdf"
  $.open.hidden = !connected
  $.library.hidden = !connected
  $.connect.hidden = !connected || role !== "pc"
  $.connect.textContent = location.hostname === "appassets.androidplatform.net" ? "Connect to PC" : "Connect phone"
  $.find.hidden = !current
  $.save.disabled = !current
  $.print.disabled = !current
  $.welcome.hidden = !connected || Boolean(current)
  $["pair-form"].hidden = connected
  $.toolbar.hidden = !current
  $["pdf-tools"].hidden = !hasPdf
  $["word-tools"].hidden = !current || hasPdf
  $["page-tools"].hidden = !hasPdf
  $.pages.hidden = !hasPdf || !sidebarOpen
  $["sidebar-toggle"].setAttribute("aria-expanded", sidebarOpen)
  $["pdf-sheet"].hidden = !hasPdf
  $["word-sheet"].hidden = !current || hasPdf
  $["file-title"].textContent = current?.filename || ""
}
function updateTabs() {
  if (current?.libraryId) {
    const existing = openTabs.find(tab => tab.id === current.libraryId)
    if (existing) existing.filename = current.filename
    else openTabs.push({ id: current.libraryId, filename: current.filename })
  }
  const signature = JSON.stringify([openTabs, current?.libraryId])
  if (signature === tabsRendered) return
  tabsRendered = signature
  sessionStorage.setItem("elleson-open-tabs", JSON.stringify(openTabs))
  $["document-tabs"].hidden = !openTabs.length
  $["mobile-tabs"].hidden = !openTabs.length
  $["document-tabs"].replaceChildren(...openTabs.map(tab => {
    const container = document.createElement("div")
    container.className = "document-tab" + (tab.id === current?.libraryId ? " active" : "")
    const button = document.createElement("button")
    button.className = "tab-name"
    button.textContent = tab.filename
    button.setAttribute("aria-current", tab.id === current?.libraryId ? "page" : "false")
    button.addEventListener("click", () => {
      if (tab.id !== current?.libraryId) void openSaved(tab.id).catch(fail)
    })
    const close = document.createElement("button")
    close.textContent = "×"
    close.setAttribute("aria-label", "Close " + tab.filename)
    close.addEventListener("click", () => void closeTab(tab.id).catch(fail))
    container.append(button, close)
    return container
  }))
  $["mobile-tabs"].replaceChildren(...openTabs.map(tab => {
    const option = new Option(tab.filename, tab.id)
    option.selected = tab.id === current?.libraryId
    return option
  }))
}
async function closeTab(id) {
  document.activeElement?.blur()
  await pendingEdit
  if (id === current?.libraryId) {
    if (current.dirty && !confirm("Close the shared document with unsaved changes? Choose Cancel to save a copy first.")) return
    await postJson("/api/close/" + current.id, {})
    openTabs = openTabs.filter(tab => tab.id !== id)
    revision = -1
    await refresh()
    if (openTabs.length) await openSaved(openTabs.at(-1).id)
  } else openTabs = openTabs.filter(tab => tab.id !== id)
  updateTabs()
}
$["mobile-tabs"].addEventListener("change", () => {
  if ($["mobile-tabs"].value !== current?.libraryId) void openSaved($["mobile-tabs"].value).catch(fail)
})

function setMode(value) {
  mode = value
  draft = null
  $["pdf-sheet"].dataset.mode = mode
  for (const button of document.querySelectorAll("[data-mode]")) button.setAttribute("aria-pressed", button.dataset.mode === mode)
  if (current?.extension === "pdf") {
    drawMarks()
    status({ read: "View document", edit: "Select existing text to edit it in its original font.", text: "Tap or click where the text should go.", pen: "Draw directly on the page.", highlight: "Draw a highlight over the page.", erase: "Tap an added text or ink mark to erase it.", signature: "Tap the page to place the signature." }[mode])
    if (mode === "edit") void createTextTargets()
  } else if (current) {
    renderWord()
    status(mode === "word" ? "Edit an outlined paragraph. Changes sync as you type." : "View Word text")
  }
}

function refresh() {
  if (refreshPending) return refreshPending
  refreshPending = (async () => {
    if (!credential) return
    try {
      const marker = localSequence
      const response = await request("/api/state?revision=" + revision)
      const state = await response.json()
      role = state.role
      remoteDraft = state.preview
      if (current?.extension === "pdf") drawMarks()
      $.connection.textContent = state.paired ? "Phone and PC connected" : location.hostname === "appassets.androidplatform.net" ? "On this phone" : role === "pc" ? "This PC" : ""
      if (marker !== localSequence) return
      if (!Object.hasOwn(state, "document")) return
      revision = state.revision
      const before = current?.id
      const oldVersion = current?.contentVersion
      current = state.document
      layout()
      if (before !== current?.id) {
        selectedWordIndex = null
        layout()
        editingWord = false
        page = 1
        zoom = 1
        viewport = undefined
        if (loadingTask) void loadingTask.destroy().catch(() => {})
        loadingTask = undefined
        pdf = undefined
        $.pages.replaceChildren()
        $["pdf-fields"].replaceChildren()
        setMode("read")
        if (current?.extension === "pdf") void loadPdf(current.id)
        else if (!current) status("Ready")
      } else if (current?.extension === "pdf") {
        if (oldVersion !== current.contentVersion) void loadPdf(current.id)
        else { drawMarks(); syncFields() }
      } else if (current && !editingWord && oldVersion !== current.contentVersion) void renderWord()
    } catch (error) {
      if (error.status === 401 && !owner) {
        credential = ""
        sessionStorage.removeItem("elleson-session")
        revision = -1
        current = null
        layout()
      }
      fail(error)
    }
  })().finally(() => { refreshPending = undefined })
  return refreshPending
}

function edit(change) {
  const id = current?.id
  const operation = async () => {
    if (!id || current?.id !== id) return false
    localSequence++
    try {
      const response = await postJson("/api/edit/" + id, { ...change, id: change.id || editId() })
      const updated = await response.json()
      if (current?.id === id) {
        const before = current.contentVersion
        current = updated
        layout()
        revision = -1
        if (current.extension === "pdf") {
          if (before !== current.contentVersion) await loadPdf(id)
          else { drawMarks(); syncFields() }
        }
      }
      status("Change synced")
      return true
    } catch (error) {
      fail(error)
      if (error.status === 409) revision = -1
      return false
    } finally {
      localSequence++
    }
  }
  pendingEdit = pendingEdit.then(operation)
  return pendingEdit
}

async function loadPdf(id) {
  const sequence = ++loadSequence
  renderIndex++
  status("Opening PDF…")
  try {
    if (loadingTask) await loadingTask.destroy().catch(() => {})
    const sourceUrl = "/api/source/" + id + "?v=" + current.contentVersion
    const localData = location.hostname === "appassets.androidplatform.net"
      ? new Uint8Array(await (await request(sourceUrl)).arrayBuffer()) : null
    const task = pdfjs.getDocument({
      ...(localData ? { data: localData } : { url: sourceUrl }), httpHeaders: { Authorization: "Bearer " + credential },
      cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/", isEvalSupported: false
    })
    loadingTask = task
    const opened = await task.promise
    if (current?.id !== id) { await task.destroy(); return }
    pdf = opened
    page = Math.min(page, opened.numPages)
    createThumbnails()
    await renderPage()
  } catch (error) { if (current?.id === id && sequence === loadSequence) fail(error) }
}

function createThumbnails() {
  const source = pdf
  thumbnailObserver?.disconnect()
  $.pages.replaceChildren()
  const watcher = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const button = entry.target
      watcher.unobserve(button)
      void source.getPage(Number(button.dataset.page)).then(async pdfPage => {
        if (source !== pdf) return
        const thumbnail = document.createElement("canvas")
        const frame = pdfPage.getViewport({ scale: 60 / pdfPage.getViewport({ scale: 1 }).width })
        thumbnail.width = Math.ceil(frame.width)
        thumbnail.height = Math.ceil(frame.height)
        await pdfPage.render({ canvas: thumbnail, viewport: frame, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise
        button.prepend(thumbnail)
      }).catch(() => {})
    }
  }, { root: $.pages })
  thumbnailObserver = watcher
  for (let number = 1; number <= source.numPages; number++) {
    const button = document.createElement("button")
    button.textContent = number
    button.dataset.page = number
    button.setAttribute("aria-label", "Page " + number)
    button.addEventListener("click", () => go(number))
    $.pages.append(button)
    watcher.observe(button)
  }
}

async function renderPage() {
  if (!pdf) return
  const sequence = ++renderIndex
  const source = pdf
  const number = page
  $.page.value = number
  $.page.max = source.numPages
  $.total.textContent = "/ " + source.numPages
  $.prev.disabled = number <= 1
  $.next.disabled = number >= source.numPages
  for (const button of $.pages.children) button.setAttribute("aria-pressed", Number(button.dataset.page) === number)
  try {
    const pdfPage = await source.getPage(number)
    const natural = pdfPage.getViewport({ scale: 1 })
    const width = Math.max(140, $.stage.clientWidth - 42)
    const height = Math.max(160, $.stage.clientHeight - 42)
    const base = Math.min(width / natural.width, height / natural.height, 2)
    const frame = pdfPage.getViewport({ scale: base * zoom })
    const pixelRatio = Math.min(devicePixelRatio || 1, 2, 4500 / Math.max(frame.width, frame.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.ceil(frame.width * pixelRatio)
    canvas.height = Math.ceil(frame.height * pixelRatio)
    await pdfPage.render({
      canvas, viewport: frame, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
      annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS
    }).promise
    const annotations = await pdfPage.getAnnotations()
    const textContent = await pdfPage.getTextContent()
    if (sequence !== renderIndex || source !== pdf) return
    viewport = frame
    viewport.page = number
    viewport.pixelRatio = pixelRatio
    $["pdf-sheet"].style.width = frame.width + "px"
    $["pdf-sheet"].style.height = frame.height + "px"
    const target = $["pdf-canvas"]
    const ink = $["ink-canvas"]
    target.width = ink.width = canvas.width
    target.height = ink.height = canvas.height
    target.getContext("2d").drawImage(canvas, 0, 0)
    createFields(annotations)
    const layer = document.createElement("div")
    layer.className = "textLayer"
    layer.style.setProperty("--total-scale-factor", frame.scale * frame.userUnit)
    layer.style.setProperty("--scale-round-x", "1px")
    layer.style.setProperty("--scale-round-y", "1px")
    const selection = new pdfjs.TextLayer({ textContentSource: textContent, viewport: frame, container: layer })
    await selection.render()
    if (sequence !== renderIndex || source !== pdf) return
    $["selection-layer"].replaceChildren(...layer.childNodes)
    $["selection-layer"].style.cssText = layer.style.cssText
    $["selection-layer"].dataset.mainRotation = frame.rotation
    if (searchPhrase) for (const span of $["selection-layer"].querySelectorAll("span")) {
      span.classList.toggle("found", span.textContent.toLocaleLowerCase().includes(searchPhrase))
    }
    drawMarks()
    if (mode === "edit") void createTextTargets()
    status("PDF ready")
  } catch (error) { if (source === pdf && sequence === renderIndex) fail(error) }
}

function createFields(annotations) {
  const container = $["pdf-fields"]
  container.replaceChildren()
  for (const field of annotations) {
    if (!field.fieldName || field.readOnly || !field.rect) continue
    const dropdown = field.fieldType === "Ch" && field.combo && !field.multiSelect
    const checkbox = field.fieldType === "Btn" && field.checkBox
    if (!dropdown && !checkbox && field.fieldType !== "Tx") continue
    const element = document.createElement(dropdown ? "select" : field.multiLine ? "textarea" : "input")
    if (dropdown) {
      for (const item of field.options) element.add(new Option(item.displayValue, item.exportValue))
    } else if (!field.multiLine) element.type = checkbox ? "checkbox" : "text"
    if (field.maxLen && element.tagName !== "SELECT") element.maxLength = field.maxLen
    element.className = "pdf-field"
    element.dataset.field = field.fieldName
    element.setAttribute("aria-label", field.alternativeText || field.fieldName)
    const rect = [
      ...viewport.convertToViewportPoint(field.rect[0], field.rect[1]),
      ...viewport.convertToViewportPoint(field.rect[2], field.rect[3])
    ]
    Object.assign(element.style, {
      left: Math.min(rect[0], rect[2]) + "px", top: Math.min(rect[1], rect[3]) + "px",
      width: Math.abs(rect[2] - rect[0]) + "px", height: Math.abs(rect[3] - rect[1]) + "px"
    })
    const original = checkbox ? field.fieldValue !== "Off" && Boolean(field.fieldValue) : (field.fieldValue?.[0] && Array.isArray(field.fieldValue) ? field.fieldValue[0] : field.fieldValue) || ""
    element.originalValue = original
    let timer
    const commit = () => {
      clearTimeout(timer)
      void edit({ kind: "field", name: field.fieldName, value: checkbox ? element.checked : element.value })
    }
    element.addEventListener("change", commit)
    if (!checkbox && !dropdown) element.addEventListener("input", () => {
      clearTimeout(timer)
      timer = setTimeout(commit, 140)
    })
    container.append(element)
  }
  syncFields()
}

function syncFields() {
  for (const element of $["pdf-fields"].children) {
    if (document.activeElement === element) continue
    const value = current.fields[element.dataset.field] ?? element.originalValue
    if (element.type === "checkbox") element.checked = Boolean(value)
    else element.value = value
  }
}

function drawMarks() {
  if (!viewport || !current?.marks) return
  const canvas = $["ink-canvas"]
  const context = canvas.getContext("2d")
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.scale(viewport.pixelRatio, viewport.pixelRatio)
  context.fillStyle = context.strokeStyle = "#093352"
  context.lineCap = "round"
  context.lineJoin = "round"
  context.lineWidth = 1.7 * viewport.scale
  const marks = current.marks.filter(mark => mark.page === viewport.page)
  $.undo.disabled = marks.length === 0
  const pendingMarks = [...marks]
  if (remoteDraft?.page === viewport.page) pendingMarks.push(remoteDraft)
  if (draft?.page === viewport.page) pendingMarks.push(draft)
  for (const mark of pendingMarks) {
    context.strokeStyle = mark.color || "#093352"
    context.lineWidth = (mark.width || 1.7) * viewport.scale
    context.globalAlpha = mark.opacity ?? 1
    if (mark.kind === "text") {
      context.font = mark.size * viewport.scale + "px Arial, sans-serif"
      context.fillText(mark.value, ...viewport.convertToViewportPoint(...mark.at))
    } else {
      const points = mark.points.map(point => viewport.convertToViewportPoint(...point))
      context.beginPath()
      context.moveTo(...points[0])
      for (const point of points.slice(1)) context.lineTo(...point)
      context.stroke()
    }
  }
  context.globalAlpha = 1
}

function go(number) {
  if (!pdf) return
  page = Math.max(1, Math.min(pdf.numPages, number || 1))
  $.stage.scrollTop = $.stage.scrollLeft = 0
  void renderPage()
}

async function renderWord() {
  if (!current?.lines) return
  const render = ++wordRender
  const source = current
  const editable = (element, line, index) => {
    element.classList.toggle("word-selected", selectedWordIndex === index)
    const select = () => {
      selectedWordIndex = index
      for (const paragraph of $["word-sheet"].querySelectorAll(".word-selected")) paragraph.classList.remove("word-selected")
      element.classList.add("word-selected")
      layout()
    }
    element.addEventListener("click", select)
    element.contentEditable = mode === "word" && line.editable ? "plaintext-only" : "false"
    if (mode !== "word" || !line.editable) return
    let timer
    let lastSynced = line.text
    const flush = () => {
      clearTimeout(timer)
      const value = element.innerText.replace(/[\r\n]+/g, " ")
      if (value === lastSynced) return
      const before = lastSynced
      lastSynced = value
      void edit({ kind: "word", index, before, value }).then(success => {
        if (!success) lastSynced = before
        if (!editingWord && current?.id === source.id) void renderWord()
      })
    }
    element.addEventListener("focus", () => { editingWord = true; select() })
    element.addEventListener("input", () => {
      clearTimeout(timer)
      timer = setTimeout(flush, 350)
    })
    element.addEventListener("blur", () => {
      editingWord = false
      flush()
    })
    element.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); element.blur() }
    })
  }
  if (source.extension === "docx" && window.docx) {
    try {
      const data = await (await request("/api/source/" + source.id)).arrayBuffer()
      const container = document.createElement("div")
      const styles = document.createElement("div")
      await window.docx.renderAsync(data, container, styles, { inWrapper: true, useBase64URL: true, renderComments: false, renderFootnotes: true })
      if (render !== wordRender || current?.id !== source.id) return
      $["word-sheet"].classList.add("word-rich")
      $["word-sheet"].replaceChildren(styles, container)
      const paragraphs = Array.from(container.querySelectorAll("article p"))
      let position = 0
      for (const element of paragraphs) {
        const index = source.lines.findIndex((line, index) => index >= position && line.text === element.textContent)
        if (index < 0) continue
        position = index + 1
        editable(element, source.lines[index], index)
      }
      return
    } catch (error) {
      fail(error)
    }
  }
  $["word-sheet"].classList.remove("word-rich")
  const elements = current.lines.map((line, index) => {
    const element = document.createElement(/^heading|^title/i.test(line.style) ? "h2" : "p")
    element.textContent = line.text
    editable(element, line, index)
    return element
  })
  $["word-sheet"].replaceChildren(...elements)
}

async function createTextTargets() {
  if (!current || !viewport || mode !== "edit") return
  const id = current.id
  const number = viewport.page
  try {
    const { spans, version } = await (await request("/api/text/" + id + "/" + number)).json()
    if (id !== current?.id || number !== viewport?.page || version !== current.contentVersion) return
    const buttons = spans.map(span => {
      const button = document.createElement("button")
      const a = viewport.convertToViewportPoint(...span.quad[0])
      const b = viewport.convertToViewportPoint(...span.quad[1])
      Object.assign(button.style, {
        left: Math.min(a[0], b[0]) + "px", top: Math.min(a[1], b[1]) + "px",
        width: Math.abs(b[0] - a[0]) + "px", height: Math.abs(b[1] - a[1]) + "px"
      })
      button.setAttribute("aria-label", "Edit " + span.text)
      button.addEventListener("click", () => {
        selectedSpan = { document: id, page: number, span: span.id, before: span.text, version }
        $["original-font"].textContent = span.font + " · " + Number(span.size.toFixed(2)) + " pt"
        $.replacement.value = span.text
        $["replacement-font"].value = ""
        $["replacement-error"].textContent = ""
        $["replacement-preview"].hidden = true
        $["replace-dialog"].showModal()
        $.replacement.focus()
      })
      return button
    })
    $["pdf-text"].replaceChildren(...buttons)
    if (!spans.length) status("Use Scan & OCR to recognize this page, or Add text to fill it.")
  } catch (error) { fail(error) }
}

async function openFile() {
  document.activeElement?.blur()
  await pendingEdit
  if (current?.dirty && !window.confirm("Replace " + current.filename + " as the shared document? Choose Cancel to save a copy first.")) return
  if (window.desktopDocs) {
    await window.desktopDocs.open()
    await refresh()
  } else $.file.click()
}
$.open.addEventListener("click", () => void openFile().catch(fail))
$.scan.addEventListener("click", () => $["scan-file"].click())
$["scan-file"].addEventListener("change", async () => {
  const selected = $["scan-file"].files[0]
  if (!selected) return
  scanFile = selected
  const image = $["scan-preview"]
  if (image.src.startsWith("blob:")) URL.revokeObjectURL(image.src)
  image.src = URL.createObjectURL(selected)
  image.style.transform = ""
  $["scan-angle"].value = "0"
  $["scan-angle-value"].textContent = "0°"
  $["scan-dialog"].showModal()
})
$["scan-cancel"].addEventListener("click", () => { $["scan-dialog"].close(); $["scan-file"].value = ""; scanFile = null })
$["scan-angle"].addEventListener("input", () => {
  $["scan-preview"].style.transform = "rotate(" + $["scan-angle"].value + "deg)"
  $["scan-angle-value"].textContent = $["scan-angle"].value + "°"
})
$["scan-create"].addEventListener("click", async () => {
  const selected = scanFile
  if (!selected) return
  try {
    document.activeElement?.blur()
    await pendingEdit
    if (current?.dirty && !confirm("Replace the shared document with the scan? Choose Cancel to save a copy first.")) return
    status("Converting photo to PDF…")
    const { imageToPdf } = await import("./scan-runtime.mjs")
    const pdf = await imageToPdf(selected, $["scan-angle"].value)
    await request("/api/open", {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(pdf.name) }, body: pdf
    })
    revision = -1
    $["scan-dialog"].close()
    await refresh()
  } catch (error) { fail(error) }
  finally { $["scan-dialog"].close(); $["scan-file"].value = ""; scanFile = null }
})
async function openSaved(id, version) {
  document.activeElement?.blur()
  await pendingEdit
  if (current?.dirty && !confirm("Replace the shared document? Choose Cancel to save a copy first.")) return
  await postJson("/api/library/" + id + "/open", { version })
  $["versions-dialog"].close()
  $["library-dialog"].close()
  revision = -1
  await refresh()
}
async function showLibrary() {
  const records = await (await request("/api/library")).json()
  const rows = records.map(record => {
    const row = document.createElement("div")
    row.className = "library-row"
    const open = document.createElement("button")
    open.textContent = record.filename
    open.addEventListener("click", () => void openSaved(record.id).catch(fail))
    const details = document.createElement("small")
    details.textContent = new Date(record.updated).toLocaleString() + " · " + record.versionCount + " saved version(s)"
    const actions = document.createElement("div")
    actions.className = "actions"
    const pin = document.createElement("button")
    pin.textContent = record.pinned ? "Unpin" : "Pin"
    pin.addEventListener("click", async () => {
      try { await postJson("/api/library/" + record.id + "/pin", { pinned: !record.pinned }); await showLibrary() }
      catch (error) { fail(error) }
    })
    const versions = document.createElement("button")
    versions.textContent = "Versions"
    versions.addEventListener("click", async () => {
      try {
        const saved = await (await request("/api/library/" + record.id + "/versions")).json()
        $["versions-list"].replaceChildren(...saved.map(version => {
          const button = document.createElement("button")
          button.textContent = new Date(version.date).toLocaleString() + " · " + version.filename
          button.addEventListener("click", () => void openSaved(record.id, version.id).catch(fail))
          return button
        }))
        $["versions-dialog"].showModal()
      } catch (error) { fail(error) }
    })
    actions.append(pin, versions)
    row.append(open, details, actions)
    return row
  })
  $["library-list"].replaceChildren(...rows)
  if (!rows.length) $["library-list"].textContent = "Open a document to add it to your files."
  if (!$["library-dialog"].open) $["library-dialog"].showModal()
}
$.library.addEventListener("click", () => void showLibrary().catch(fail))
$["welcome-open"].addEventListener("click", () => void openFile().catch(fail))
$.file.addEventListener("change", async () => {
  const selected = $.file.files[0]
  if (!selected) return
  try {
    status("Opening " + selected.name + "…")
    await request("/api/open", { method: "POST", headers: {
      "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(selected.name)
    }, body: selected })
    await refresh()
  } catch (error) { fail(error) }
  finally { $.file.value = "" }
})

$.pair.addEventListener("submit", async event => {
  event.preventDefault()
  try {
    const result = await (await postJson("/api/pair", { code: $.code.value })).json()
    credential = result.token
    sessionStorage.setItem("elleson-session", credential)
    revision = -1
    layout()
    status("Connected")
    await refresh()
  } catch (error) { fail(error) }
})
$.connect.addEventListener("click", async () => {
  if (location.hostname === "appassets.androidplatform.net" && window.EllesonAndroid) {
    window.EllesonAndroid.connectPC()
    return
  }
  try {
    const data = await (await postJson("/api/pairing", {})).json()
    $["pair-code"].textContent = data.code
    $.addresses.replaceChildren(...data.addresses.map(address => {
      const label = document.createElement("code")
      label.textContent = address
      return label
    }))
    if (!data.addresses.length) $.addresses.textContent = "No local network address was found."
    $["pair-dialog"].showModal()
  } catch (error) { fail(error) }
})
$.disconnect.addEventListener("click", async () => {
  try { await request("/api/pairing", { method: "DELETE" }); $["pair-dialog"].close(); await refresh() }
  catch (error) { fail(error) }
})
$.save.addEventListener("click", async () => {
  try {
    if (!current) return
    document.activeElement?.blur()
    await pendingEdit
    if (window.desktopDocs) {
      if (await window.desktopDocs.save(current.id, { flatten: $["flatten-copy"].checked && current.extension === "pdf" })) status("Copy saved")
      return
    }
    const url = "/api/save/" + current.id + ($["flatten-copy"].checked && current.extension === "pdf" ? "?flatten=1" : "")
    if (window.EllesonAndroid) {
      const extension = current.saveExtension || current.extension
      const name = current.filename.replace(/\.[^.]+$/, "") + " - copy." + extension
      if (location.hostname === "appassets.androidplatform.net") {
        const response = await request(url)
        const version = response.headers.get("X-Elleson-Revision")
        const id = current.id
        const blob = await response.blob()
        const reader = new FileReader()
        reader.onload = () => window.EllesonAndroid.saveData(reader.result.split(",")[1], name, id, version)
        reader.readAsDataURL(blob)
        return
      }
      window.EllesonAndroid.save(location.origin + url, credential, name)
      return
    }
    const response = await request(url)
    const link = document.createElement("a")
    const blob = URL.createObjectURL(await response.blob())
    link.href = blob
    const attachment = response.headers.get("Content-Disposition") || ""
    const utf = attachment.match(/filename\*=UTF-8''([^;]+)/i)
    link.download = utf ? decodeURIComponent(utf[1]) : attachment.match(/filename="([^"]+)"/)?.[1] || current.filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(blob), 3000)
    status("Copy downloaded")
  } catch (error) { fail(error) }
})

for (const button of document.querySelectorAll("[data-mode]")) button.addEventListener("click", () => setMode(button.dataset.mode))
$.prev.addEventListener("click", () => go(page - 1))
$.next.addEventListener("click", () => go(page + 1))
$.page.addEventListener("change", () => go(Number($.page.value)))
byId("zoom-in").addEventListener("click", () => { zoom = Math.min(3, zoom * 1.25); void renderPage() })
byId("zoom-out").addEventListener("click", () => { zoom = Math.max(.35, zoom / 1.25); void renderPage() })
$.fit.addEventListener("click", () => { zoom = 1; void renderPage() })
$["sidebar-toggle"].addEventListener("click", () => {
  sidebarOpen = !sidebarOpen
  layout()
})
$.find.addEventListener("click", () => {
  $["search-dialog"].showModal()
  $.search.focus()
})
$["more-actions"].addEventListener("click", () => {
  const opened = document.querySelector(".app-header").classList.toggle("history-open")
  $["more-actions"].setAttribute("aria-expanded", opened)
})
document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && current) {
    event.preventDefault()
    $.find.click()
  }
})
$["search-form"].addEventListener("submit", async event => {
  event.preventDefault()
  const phrase = $.search.value.trim().toLocaleLowerCase()
  if (!phrase || !current) return
  if (!pdf) {
    const elements = Array.from($["word-sheet"].querySelectorAll("p")).filter(element => element.textContent.toLocaleLowerCase().includes(phrase))
    for (const element of $["word-sheet"].querySelectorAll(".found")) element.classList.remove("found")
    for (const element of elements) element.classList.add("found")
    if (elements.length) elements[(++findPosition) % elements.length].scrollIntoView({ block: "center" })
    status(elements.length + " matching paragraphs")
    return
  }
  const source = pdf
  if (phrase !== searchPhrase || searchSource !== source) {
    searchPhrase = phrase
    searchSource = source
    foundPages = []
    findPosition = -1
    status("Searching document…")
    for (let number = 1; number <= source.numPages; number++) {
      const content = await (await source.getPage(number)).getTextContent()
      if (source !== pdf) return
      if (content.items.map(item => item.str || "").join(" ").toLocaleLowerCase().includes(phrase)) foundPages.push(number)
    }
  }
  if (foundPages.length) {
    page = foundPages[(++findPosition) % foundPages.length]
    await renderPage()
  }
  status(foundPages.length ? "Found on " + foundPages.length + " page(s)" : "No matches. Use Scan & OCR for scanned text.")
})
$.undo.addEventListener("click", () => {
  const last = current?.marks.findLast(mark => mark.page === page)
  if (last) void edit({ kind: "undo", target: last.id })
})
$.organize.addEventListener("click", () => {
  $["pages-current"].textContent = "Current page " + page + " of " + current.pages
  $["page-order"].value = Array.from({ length: current.pages }, (_, index) => index + 1).join(", ")
  $["pages-dialog"].showModal()
})
const selectedPages = () => $["page-order"].value.split(",").map(value => Number(value.trim()) - 1)
async function changePages(action, pages) {
  $["pages-dialog"].close()
  await edit({ kind: "pages", action, pages, version: current.contentVersion })
}
$["rotate-page"].addEventListener("click", () => void changePages("rotate", [page - 1]))
$["delete-page"].addEventListener("click", () => {
  if (confirm("Delete page " + page + "? You can undo this change.")) void changePages("delete", [page - 1])
})
$["reorder-pages"].addEventListener("click", () => void changePages("reorder", selectedPages()))
async function downloadBytes(response, filename) {
  const blob = await response.blob()
  if (window.EllesonAndroid?.saveData) {
    const reader = new FileReader()
    reader.onload = () => window.EllesonAndroid.saveData(reader.result.split(",")[1], filename, "", "")
    reader.readAsDataURL(blob)
    return
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}
$["extract-pages"].addEventListener("click", async () => {
  try {
    await pendingEdit
    const response = await request("/api/extract/" + current.id + "?pages=" + selectedPages().map(index => index + 1).join(","))
    await downloadBytes(response, "Selected pages.pdf")
    $["pages-dialog"].close()
  } catch (error) { fail(error) }
})
$["combine-pages"].addEventListener("click", () => {
  if (confirm("Combine as a fixed PDF? Form fields and annotations in both documents will become part of the pages.")) $["combine-file"].click()
})
$["combine-file"].addEventListener("change", async () => {
  const selected = $["combine-file"].files[0]
  if (!selected) return
  try {
    $["pages-dialog"].close()
    await pendingEdit
    await request("/api/combine/" + current.id, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Operation-Id": editId() }, body: selected
    })
    revision = -1
    await refresh()
  } catch (error) { fail(error) }
  finally { $["combine-file"].value = "" }
})
$.print.addEventListener("click", async () => {
  $.print.disabled = true
  try {
    document.activeElement?.blur()
    await pendingEdit
    status("Preparing document for printing…")
    const container = $["print-area"]
    container.replaceChildren()
    if (current.extension === "pdf") {
      const data = new Uint8Array(await (await request("/api/print/" + current.id)).arrayBuffer())
      const task = pdfjs.getDocument({ data, standardFontDataUrl: "/pdfjs/standard_fonts/", cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, wasmUrl: "/pdfjs/wasm/" })
      try {
        const source = await task.promise
        for (let index = 1; index <= source.numPages; index++) {
          const page = await source.getPage(index)
          const natural = page.getViewport({ scale: 1 })
          const scale = Math.min(1.5, Math.sqrt(40000000 / (source.numPages * natural.width * natural.height)))
          const frame = page.getViewport({ scale })
          const canvas = document.createElement("canvas")
          canvas.width = Math.ceil(frame.width)
          canvas.height = Math.ceil(frame.height)
          await page.render({ canvas, viewport: frame }).promise
          container.append(canvas)
        }
      } finally { await task.destroy() }
    } else container.append($["word-sheet"].cloneNode(true))
    if (window.EllesonAndroid?.printDocument) window.EllesonAndroid.printDocument()
    else window.print()
    status("Document prepared for printing")
  } catch (error) { fail(error) }
  finally { $.print.disabled = !current }
})
for (const direction of ["undo", "redo"]) {
  byId("history-" + direction).addEventListener("click", async () => {
    document.activeElement?.blur()
    await pendingEdit
    await edit({ kind: "history-" + direction })
    if (current?.extension !== "pdf") void renderWord()
  })
}
for (const [button, dialog] of [["format-paragraph", "word-format-dialog"], ["insert-table", "table-dialog"]]) {
  byId(button).addEventListener("click", async () => {
    document.activeElement?.blur()
    await pendingEdit
    if (selectedWordIndex === null || !current?.lines) return
    wordTarget = { id: current.id, index: selectedWordIndex, version: current.contentVersion }
    if (dialog === "word-format-dialog") $["word-format-form"].reset()
    byId(dialog).showModal()
  })
}
$["word-format-cancel"].addEventListener("click", () => $["word-format-dialog"].close())
$["table-cancel"].addEventListener("click", () => $["table-dialog"].close())
$["insert-image"].addEventListener("click", async () => {
  document.activeElement?.blur()
  await pendingEdit
  if (selectedWordIndex === null || !current?.lines) return
  wordTarget = { id: current.id, index: selectedWordIndex, version: current.contentVersion }
  $["word-image-file"].click()
})
$["word-image-file"].addEventListener("change", async () => {
  const selected = $["word-image-file"].files[0]
  if (!selected || wordTarget?.id !== current?.id) return
  try {
    await request("/api/word-image/" + current.id, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Operation-Id": editId(),
        "X-Paragraph-Index": String(wordTarget.index), "X-Document-Version": String(wordTarget.version) }, body: selected
    })
    revision = -1
    await refresh()
  } catch (error) { fail(error) }
  finally { $["word-image-file"].value = "" }
})
$["word-format-form"].addEventListener("submit", async event => {
  event.preventDefault()
  if (wordTarget?.id !== current?.id) return
  const format = {}
  for (const key of ["font", "size", "bold", "italic", "align", "list"]) {
    const value = byId("word-" + key).value
    if (value) format[key] = key === "size" ? Number(value) : ["bold", "italic"].includes(key) ? value === "true" : value
  }
  if (!Object.keys(format).length) return
  $["word-format-dialog"].close()
  if (await edit({ kind: "word-format", index: wordTarget.index, version: wordTarget.version, format })) await renderWord()
})
$["table-form"].addEventListener("submit", async event => {
  event.preventDefault()
  if (wordTarget?.id !== current?.id) return
  $["table-dialog"].close()
  if (await edit({ kind: "word-table", index: wordTarget.index, version: wordTarget.version,
    rows: Number($["table-rows"].value), columns: Number($["table-columns"].value) })) await renderWord()
})
$.recognize.addEventListener("click", async () => {
  if (!current || !pdf) return
  $.recognize.disabled = true
  status("Recognizing text on this page…")
  try {
    const result = await (await postJson("/api/ocr/" + current.id + "/" + page, { lang: $["ocr-language"].value })).json()
    revision = -1
    await refresh()
    setMode("edit")
    status(result.lines ? "Select recognized text to edit. Scan fonts are estimated." : "No text was recognized on this page.")
  } catch (error) { fail(error) }
  finally { $.recognize.disabled = false }
})

const inkCanvas = $["ink-canvas"]
function canvasPoint(event) {
  const rect = inkCanvas.getBoundingClientRect()
  return [event.clientX - rect.left, event.clientY - rect.top]
}
inkCanvas.addEventListener("pointerdown", event => {
  if (!viewport || viewport.page !== page || event.button !== 0 || draft) return
  const position = canvasPoint(event)
  const at = viewport.convertToPdfPoint(...position)
  if (mode === "signature") {
    const width = Math.min(Number($["signature-width"].value) * viewport.scale, viewport.width - position[0])
    const height = Math.min(width / 3, viewport.height - position[1])
    if (width < 10 || height < 5) return
    const strokes = signatureStrokes.map(stroke => stroke.map(point =>
      viewport.convertToPdfPoint(position[0] + point[0] * width, position[1] + point[1] * height)))
    void edit({ kind: "signature", page, strokes, color: $["ink-color"].value, width: 2 }).then(() => setMode("read"))
  } else if (mode === "text") {
    const next = viewport.convertToPdfPoint(position[0] + 1, position[1])
    const angle = Math.atan2(next[1] - at[1], next[0] - at[0]) * 180 / Math.PI
    activeText = { kind: "text", page, at, angle, document: current.id }
    $.annotation.value = ""
    $["text-dialog"].showModal()
    $.annotation.focus()
  } else if (mode === "erase") {
    const hit = current.marks.findLast(mark => {
      if (mark.page !== page) return false
      if (mark.kind === "text") return at[0] >= mark.at[0] && at[0] <= mark.at[0] + mark.value.length * mark.size * .65 &&
        at[1] >= mark.at[1] - 4 && at[1] <= mark.at[1] + mark.size
      return mark.points.some((point, index) => {
        if (!index) return false
        const previous = mark.points[index - 1]
        const dx = point[0] - previous[0], dy = point[1] - previous[1]
        const fraction = Math.max(0, Math.min(1, ((at[0] - previous[0]) * dx + (at[1] - previous[1]) * dy) / (dx * dx + dy * dy || 1)))
        return Math.hypot(at[0] - previous[0] - fraction * dx, at[1] - previous[1] - fraction * dy) < (mark.width || 2) / 2 + 7
      })
    })
    if (hit) void edit({ kind: "undo", target: hit.id })
  } else if (mode === "pen" || mode === "highlight") {
    event.preventDefault()
    inkCanvas.setPointerCapture(event.pointerId)
    draft = { id: editId(), kind: "ink", page, pointer: event.pointerId, points: [at],
      color: mode === "highlight" ? "#f7ca42" : $["ink-color"].value,
      width: mode === "highlight" ? 12 : Number($["ink-width"].value), opacity: mode === "highlight" ? .25 : 1 }
  }
})
inkCanvas.addEventListener("pointermove", event => {
  if (!draft || event.pointerId !== draft.pointer || draft.points.length >= 1200) return
  draft.points.push(viewport.convertToPdfPoint(...canvasPoint(event)))
  drawMarks()
  if (Date.now() - previewAt >= 90) {
    previewAt = Date.now()
    void postJson("/api/preview/" + current.id, draft).catch(() => {})
  }
})
inkCanvas.addEventListener("pointerup", event => {
  if (!draft || event.pointerId !== draft.pointer) return
  const mark = draft
  draft = null
  if (mark.points.length > 1) void edit(mark)
})
inkCanvas.addEventListener("pointercancel", () => {
  draft = null
  drawMarks()
  if (current) void postJson("/api/preview/" + current.id, {}).catch(() => {})
})
$["cancel-text"].addEventListener("click", () => $["text-dialog"].close())
$["add-text"].addEventListener("submit", event => {
  event.preventDefault()
  $["text-dialog"].close()
  if (activeText?.document === current?.id) {
    void edit({ ...activeText, value: $.annotation.value, size: Number($["font-size"].value) })
  }
})
$["cancel-replace"].addEventListener("click", () => $["replace-dialog"].close())
function drawSignature() {
  const canvas = $["signature-pad"]
  const context = canvas.getContext("2d")
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = $["ink-color"].value
  context.lineWidth = 4
  context.lineJoin = context.lineCap = "round"
  for (const stroke of signatureDraft ? [...signatureStrokes, signatureDraft] : signatureStrokes) {
    context.beginPath()
    context.moveTo(stroke[0][0] * canvas.width, stroke[0][1] * canvas.height)
    for (const point of stroke.slice(1)) context.lineTo(point[0] * canvas.width, point[1] * canvas.height)
    context.stroke()
  }
}
$.signature.addEventListener("click", () => {
  signatureStrokes = []
  signatureDraft = null
  $["saved-signatures"].replaceChildren(new Option("New signature", ""), ...savedSignatures.map((item, index) => new Option(item.name, index)))
  $["signature-dialog"].showModal()
  drawSignature()
})
const signaturePad = $["signature-pad"]
const signaturePoint = event => {
  const rect = signaturePad.getBoundingClientRect()
  return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height]
}
signaturePad.addEventListener("pointerdown", event => {
  if (signatureDraft || event.button !== 0 || signatureStrokes.length >= 100) return
  signaturePad.setPointerCapture(event.pointerId)
  signatureDraft = [signaturePoint(event)]
})
signaturePad.addEventListener("pointermove", event => {
  if (!signaturePad.hasPointerCapture(event.pointerId) || !signatureDraft || signatureDraft.length >= 1200) return
  signatureDraft.push(signaturePoint(event))
  drawSignature()
})
signaturePad.addEventListener("pointerup", event => {
  if (!signaturePad.hasPointerCapture(event.pointerId)) return
  if (signatureDraft?.length > 1) signatureStrokes.push(signatureDraft)
  signatureDraft = null
})
signaturePad.addEventListener("pointercancel", () => { signatureDraft = null; drawSignature() })
$["signature-clear"].addEventListener("click", () => { signatureStrokes = []; drawSignature() })
$["signature-cancel"].addEventListener("click", () => $["signature-dialog"].close())
$["saved-signatures"].addEventListener("change", () => {
  signatureStrokes = structuredClone(savedSignatures[$["saved-signatures"].value]?.strokes || [])
  drawSignature()
})
$["signature-insert"].addEventListener("click", () => {
  if (!signatureStrokes.length) return
  let remembered = true
  if ($["signature-remember"].checked) {
    const next = [...savedSignatures, { name: new Date().toLocaleString(), strokes: structuredClone(signatureStrokes) }]
    try {
      localStorage.setItem("elleson-signatures", JSON.stringify(next))
      savedSignatures = next
    } catch { remembered = false }
  }
  $["signature-dialog"].close()
  setMode("signature")
  if (!remembered) status("Tap to place the signature. Device storage could not retain it for reuse.")
})
$["replace-text"].addEventListener("submit", async event => {
  event.preventDefault()
  if (selectedSpan?.document === current?.id) {
    const success = await edit({ ...selectedSpan, kind: "replace", value: $.replacement.value, font: $["replacement-font"].value })
    if (success) $["replace-dialog"].close()
    else $["replacement-error"].textContent = $.status.textContent
  }
})
$["preview-replacement"].addEventListener("click", async () => {
  try {
    const response = await postJson("/api/preview-text/" + current.id, { ...selectedSpan, value: $.replacement.value, font: $["replacement-font"].value })
    const image = $["replacement-preview"]
    if (image.src.startsWith("blob:")) URL.revokeObjectURL(image.src)
    image.src = URL.createObjectURL(await response.blob())
    image.hidden = false
    $["replacement-error"].textContent = ""
  } catch (error) { $["replacement-error"].textContent = error.message }
})

let resizeTimer
new ResizeObserver(() => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => void renderPage(), 90)
}).observe($.stage)
layout()
status(credential ? "Ready" : "Enter the pairing code from your PC.")
window.addEventListener("elleson-open-file", event => void (async () => {
  if (location.hostname !== "appassets.androidplatform.net") return
  document.activeElement?.blur()
  await pendingEdit
  if (current?.dirty && !confirm("Replace the document with unsaved changes? Choose Cancel to save a copy first.")) return
  const bytes = Uint8Array.from(atob(event.detail.data), character => character.charCodeAt(0))
  await request("/api/open", { method: "POST", headers: { "X-Filename": encodeURIComponent(event.detail.name) }, body: new Blob([bytes]) })
  revision = -1
  await refresh()
})().catch(fail))
void refresh().then(() => window.EllesonAndroid?.ready?.())
setInterval(() => void refresh(), 450)
