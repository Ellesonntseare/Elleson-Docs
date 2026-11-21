import {previewSignature,cancelPlacement} from './signature-placement.mjs'
import {installPictures} from './pictures.mjs'
import {installQuickPen} from './quick-pen.mjs'
import {installPartialEraser} from './partial-eraser.mjs'
import {restyleMoreMenu} from './more-menu.mjs'
import {installConflictHistory} from './conflict-history.mjs'
import {createDocumentCache} from './document-cache.mjs'
import {installWorkState} from './work-state.mjs'
import {installTapTools} from './tap-tools.mjs'
import {installDocumentSuite} from './document-suite.mjs'
import {installDrawingSuite} from './drawing-suite.mjs'
import {installCompanion} from './companion-mode.mjs'
import {installPdfFeatures} from './pdf-features.mjs'
import {installCollaboration} from './collaboration-ui.mjs'
import {openPictureAsPdf,pictureType} from './picture-import.mjs'
import {installDocumentContext} from './document-context.mjs'
import {installWheelZoom} from './wheel-zoom.mjs'
import {installMobileShell} from './mobile-shell.mjs'
import {installMobileNavigation} from './mobile-navigation.mjs'
import {installPdfDetail} from './pdf-detail.mjs'
import {installModernUI} from './modern-ui.mjs'
import {installDocumentFilters} from './document-filters.mjs'
import {drawingSettings,installDrawingSettings,appendPoint} from './drawing-settings.mjs'
import {shareWordLayout} from './shared-layout.mjs'
import {selectTappedWord, installSelectionTools} from './select-word.mjs'
import { installSharedView } from './shared-view.mjs'
import { createDraftJournal } from './draft-journal.mjs'
import { installWordPageSizing, renderWordPages, positionAnchoredInk } from './word-pages.mjs'
import { installWordInk } from './word-ink.mjs'
import { installUpdater } from './updater.mjs'
import { installSignatureGestures } from './signature-gestures.mjs'
import {createInkStream,installLiveInk} from './live-ink.mjs'
import {strokePath,pointerSamples,incrementalStroke,createStrokeTip} from './smooth-ink.mjs'
import * as pdfjs from "/pdfjs/legacy/build/pdf.mjs"
import "./offline.mjs"
import { installTools } from "./workspace-tools.mjs"
import { installDocumentGestures } from "./document-gestures.mjs"
import { installConverter } from "./converter.mjs"
import { installReadingView } from "./reading-view.mjs"
import { installCompareView } from './compare-view.mjs'

pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/legacy/build/pdf.worker.mjs"
const converter = installConverter(pdfjs)
const sourceCache=createDocumentCache()
const byId = id => document.getElementById(id)
const $ = Object.fromEntries(Array.from(document.querySelectorAll("[id]"), item => [item.id, item]))
const passwordDialog=document.createElement('dialog')
passwordDialog.innerHTML='<h2>Open protected PDF</h2><p>This opens an unlocked working copy. Save a protected copy again if you want the exported file to require a password.</p><form><label>Password <input type="password" autocomplete="current-password" required></label><p role="alert"></p><button class="primary">Open document</button><button type="button">Cancel</button></form>'
document.body.append(passwordDialog)
let lockedFile
const askPassword=()=>{passwordDialog.querySelector('input').value='';passwordDialog.querySelector('[role=alert]').textContent='';passwordDialog.showModal()}
window.desktopDocs?.onPasswordRequired(()=>{lockedFile=null;askPassword()})
passwordDialog.querySelector('[type=button]').onclick=()=>{lockedFile=null;passwordDialog.close();void window.desktopDocs?.unlock(null)}
passwordDialog.querySelector('form').onsubmit=async event=>{
  event.preventDefault()
  try{
    const password=passwordDialog.querySelector('input').value
    if(lockedFile)await request('/api/open',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(lockedFile.name),'X-PDF-Password':encodeURIComponent(password)},body:lockedFile})
    else await window.desktopDocs.unlock(password)
    lockedFile=null;passwordDialog.querySelector('input').value='';passwordDialog.close();await refresh()
  }catch(error){passwordDialog.querySelector('[role=alert]').textContent=error.message}
}
const startup = new URLSearchParams(location.hash.slice(1))
const invitation = startup.get("collab")
const guestSession = invitation ? "" : sessionStorage.getItem("elleson-collaboration")
const owner = !invitation && !guestSession && (startup.get("owner") ||
  (location.hostname === "appassets.androidplatform.net" ? "local" : sessionStorage.getItem("elleson-owner")))
if (owner) { sessionStorage.setItem("elleson-owner",owner); history.replaceState(null,"","/") }
let credential = guestSession || owner || (!invitation && (sessionStorage.getItem("elleson-session") || localStorage.getItem("elleson-session"))) || ""
let role = invitation || guestSession ? "guest" : owner ? "pc" : "phone"
const documentStorage = role === "guest" ? sessionStorage : localStorage
let current = null
let revision = -1
let pdf
let loadingTask
let page = 1
let zoom = 1
let viewport
let mode = "read"
let renderIndex = 0
let activeRenderTask
let localSequence = 0
let draft

let activeText
let pendingStamp
let refreshPending
let pendingEdit = Promise.resolve()
let editingWord = false
let flushWord = () => {}
let wordRender = 0
let selectedSpan
let replacementRuns = []
let loadSequence = 0
let searchPhrase = ""
let foundPages = []
let findPosition = -1
let searchSource
let thumbnailObserver
let lastRemoteInk
let remotePreviewSequence=-1
let remoteDraft
let inkFrame, signatureFrame, inkJournalAt=0
const localInkIds=new Set(),inkArrivals=new Map()
let fadeFrame
const remoteLineChanges=new Set()
let sidebarOpen = matchMedia("(min-width: 601px)").matches
let signatureStrokes = []
let signatureDraft
let signatureView = {scale:1,x:0,y:0}
let savedSignatures = []
let scanFile
let selectedWordIndex = null
let wordTarget
let openTabs = []
let tabsRendered = ""
let networkState = "Connected"
let queuedChanges = []
let flushing = false
let queueFlush
let requestedPhone
let tabViews
try { tabViews = new Map(JSON.parse(documentStorage.getItem("elleson-reading-positions") || "[]")) }
catch { tabViews = new Map() }
let restoringPosition = false
function rememberPosition() {
  if (!current || restoringPosition) return
  tabViews.delete(current.id)
  tabViews.set(current.id, { page, zoom: current.lines ? wordPageSizing.getZoom() : zoom, scroll: $.stage.scrollTop, left: $.stage.scrollLeft })
  try { documentStorage.setItem("elleson-reading-positions", JSON.stringify([...tabViews].slice(-50))) } catch {}
}
function restorePosition() {
  if (!restoringPosition) return
  const view = tabViews.get(current?.id)
  if (view) $.stage.scrollTo(view.left || 0, view.scroll || 0)
  restoringPosition = false
}
let positionTimer
$.stage.addEventListener("scroll", () => {
  clearTimeout(positionTimer)
  positionTimer = setTimeout(rememberPosition, 180)
}, { passive: true })
window.addEventListener("pagehide", rememberPosition)
const inputDrafts = createDraftJournal(documentStorage, message => status(message))
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const localValue = (id, change) => inputDrafts.latest(id, change)?.value ?? queuedChanges.findLast(item => item.document === id && item.change.kind === change.kind && (change.kind === 'word' ? item.change.index === change.index && item.change.structureVersion === change.structureVersion : item.change.name === change.name))?.change.value

try { queuedChanges = JSON.parse(documentStorage.getItem("elleson-pending-edits") || "[]") } catch {}
for (const record of inputDrafts.all()) {
  if (record.change.kind === 'ink' && record.change.points.length < 2) { inputDrafts.acknowledge(record.document, record.change); continue }
  if (!queuedChanges.some(item => item.change.id === record.change.id)) queuedChanges.push(record)
}
const persistQueue = () => {
  try { documentStorage.setItem("elleson-pending-edits", JSON.stringify(queuedChanges)) }
  catch { status("Device storage could not retain pending changes. Keep this window open until connected.") }
}
const updateConnection = () => {
  const blocked=queuedChanges.filter(item=>item.blocked).length
  const count=queuedChanges.length-blocked
  const message=[networkState,count?count+' waiting to sync':'',blocked?blocked+' to review':''].filter(Boolean).join(' · ')
  if($.connection.textContent!==message)$.connection.textContent=message
}
window.addEventListener('online',()=>{void refresh();void flushQueue()})
try { openTabs = JSON.parse(sessionStorage.getItem("elleson-open-tabs") || "[]") } catch {}
try { savedSignatures = JSON.parse(documentStorage.getItem("elleson-signatures") || "[]") } catch {}

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
    error.problem = problem
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
  const waiting = current && (queuedChanges.some(item => item.document === current.id) || inputDrafts.all().some(item => item.document === current.id))
  $["save-state"].textContent = current ? !inputDrafts.healthy ? "Recovery storage unavailable - keep this window open" : waiting ? "Progress stored on this device - waiting to sync" : current.dirty ? "Recovery copy stored - file has unsaved changes" : location.hostname === "appassets.androidplatform.net" ? "Saved on this phone" : "Saved on this PC" : ""
  $["flatten-copy"].disabled = current?.extension !== "pdf"
  $["history-undo"].disabled = !current
  $["history-undo"].title = current?.undoLabel ? 'Undo '+current.undoLabel : 'Undo'
  $["history-redo"].title = current?.redoLabel ? 'Redo '+current.redoLabel : 'Redo'
  $["history-redo"].disabled = !current?.canRedo
  const connected = Boolean(credential)
  document.body.classList.toggle("collaboration-guest", role === "guest")
  const hasPdf = current?.extension === "pdf"
  const saveAsLabel=hasPdf?'Save as PDF':'Save As'+String.fromCharCode(8230)
  if($['save-as'].textContent!==saveAsLabel)$['save-as'].textContent=saveAsLabel
  $.open.hidden = !connected || role === "guest"
  $.library.hidden = !connected || role === "guest"
  $.connect.hidden = !connected || role !== "pc"
  $.connect.textContent = location.hostname === "appassets.androidplatform.net" ? "Connect to PC" : "Connect phone"
  $.find.hidden = !current
  $.save.disabled = !current
  $.print.disabled = !current
  $["save-original"].disabled = !current
  $["word-more"].disabled = selectedWordIndex === null
  $["handoff"].hidden = !current || (!window.EllesonAndroid && role !== "pc")
  $["handoff"].textContent = location.hostname === "appassets.androidplatform.net" ? "Continue on PC" : role === "pc" ? "Continue on phone" : "Use on phone independently"
  $.welcome.hidden = !connected || Boolean(current)
  $["pair-form"].hidden = connected || role === "guest"
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
    if (existing) { existing.filename = current.filename; existing.dirty = current.dirty }
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
    button.textContent = tab.filename + (tab.dirty ? " •" : "")
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
  } else {
    const tab = openTabs.find(tab => tab.id === id)
    if (tab?.dirty && !confirm("Close " + tab.filename + " with unsaved changes?")) return
    if (tab?.documentId) await postJson("/api/close/" + tab.documentId, {})
    openTabs = openTabs.filter(tab => tab.id !== id)
  }
  updateTabs()
}
$["mobile-tabs"].addEventListener("change", () => {
  if ($["mobile-tabs"].value !== current?.libraryId) void openSaved($["mobile-tabs"].value).catch(fail)
})

function setMode(value) {
  cancelPlacement()
  const previousMode=mode
  if(current?.lines&&['word','read'].includes(value))wordInk.stopDrawing()
  mode = value
  draft = null;inkTip.clear()
  $["pdf-sheet"].dataset.mode = mode
  $["drawing-done"].hidden = !["pen", "highlight"].includes(mode)
  for (const button of document.querySelectorAll("[data-mode]")) button.setAttribute("aria-pressed", button.dataset.mode === mode)
  if (current?.extension === "pdf") {
    drawMarks()
    status({ read: "View document", edit: "Select existing text to edit it in its original font.", text: "Tap or click where the text should go.", pen: "Draw directly on the page.", highlight: "Draw a highlight over the page.", erase: "Tap an added text or ink mark to erase it.", signature: "Tap the page to place the signature.", select: "Tap added content to move, resize, rotate or duplicate it.", review: "Tap for a note, or drag across the words to mark up." }[mode])
    if (mode === "edit") void createTextTargets()
  } else if (current) {
    if(previousMode!==value||$["word-sheet"].dataset.renderDocument!==current.id)void renderWord()
    status(mode === "word" ? "Tap text to edit. Changes sync as you type." : "View Word text")
  }
  tools.updated()
}

let deliverySince = 0
let deliveryRevision
function updateDelivery(state) {
  const panel = document.getElementById("delivery")
  const retry = document.getElementById("retry-delivery")
  const text = document.getElementById("delivery-state")
  panel.hidden = !state.paired || role !== "pc"
  if (panel.hidden) { deliverySince = 0; return }
  const received = state.phoneOnline && state.phoneCurrent
  if (received) deliverySince = 0
  else if (!deliverySince || state.revision !== deliveryRevision) deliverySince = Date.now()
  deliveryRevision = state.revision
  const stalled = !received && (!state.phoneOnline || Date.now() - deliverySince > 8000)
  text.textContent = received ? "Phone up to date" : stalled ? "Waiting for phone" : "Sending to phone"
  retry.hidden = !stalled
}
document.getElementById("retry-delivery").onclick = async () => {
  try {
    await request("/api/sync/retry", {method:"POST"})
    deliverySince = Date.now()
    await refresh()
  } catch (error) { fail(error) }
}
function refresh() {
  if(draft||wordInk.drawing||$.stage.dataset.navigating==='true')return Promise.resolve()
  if (refreshPending) return refreshPending
  refreshPending = (async () => {
    if (!credential) return
    try {
      const marker = localSequence
      const response = await request("/api/state?revision=" + revision)
      const state = await response.json()
      if(draft||wordInk.drawing||$.stage.dataset.navigating==='true')return
      const warning = $["recovery-warning"]
      const warningsKey = JSON.stringify([state.recoveryWarning,state.failedTabs])
      if(warning.dataset.key !== warningsKey) {
        warning.dataset.key = warningsKey
        warning.textContent = state.recoveryWarning || ""
        for(const tab of state.failedTabs || []) {
          const retry=document.createElement("button")
          retry.textContent="Retry opening " + tab.filename
          retry.onclick=async()=>{
            try {await request("/api/recovery/retry/"+encodeURIComponent(tab.id),{method:"POST"});await refresh()}
            catch(error){fail(error)}
          }
          warning.append(retry)
        }
        warning.hidden = !warning.textContent
      }
      networkState = state.role === "guest" ? "Live collaboration" : location.hostname === "appassets.androidplatform.net" ? "On this phone" : state.paired ? state.phoneOnline === false ? "Phone reconnecting" : "Phone and PC connected" : "Connected"
      updateConnection()
      if (state.tabs) openTabs = state.tabs
      role = state.role
      updateDelivery(state)
      sharedView.receive(state.view)
      receivePreview(state)
      if (queuedChanges.length && !flushing) void flushQueue()
      if (state.handoff) void tools.receiveHandoff(state.handoff).catch(fail)
      if (state.pairRequest && requestedPhone !== state.pairRequest.id) {
        requestedPhone = state.pairRequest.id
        $["approve-phone-address"].textContent = "Device on your network: " + state.pairRequest.address
        if (!$["approve-phone-dialog"].open) $["approve-phone-dialog"].showModal()
      }
      if (marker !== localSequence) return
      if (!Object.hasOwn(state, "document")) return
      revision = state.revision
      const before = current?.id
      const oldVersion = current?.contentVersion
      if (before && before !== state.document?.id) rememberPosition()
      if(current?.id===state.document?.id&&current?.lines&&state.document?.lines)state.document.lines.forEach((line,index)=>{if(line.text!==current.lines[index]?.text)remoteLineChanges.add(index)})
      current = state.document
      if (before !== current?.id && readingView.active) void readingView.close()
      layout()
      if (before !== current?.id) {
        selectedWordIndex = null
        layout()
        editingWord = false
        const view = tabViews.get(current?.id)
        page = view?.page || 1
        zoom = view?.zoom || 1
        restoringPosition = Boolean(current)
        if (current?.lines) wordPageSizing.setZoom(zoom)
        viewport = undefined
        if (loadingTask) void loadingTask.destroy().catch(() => {})
        loadingTask = undefined
        pdf = undefined
        $.pages.replaceChildren()
        $["pdf-fields"].replaceChildren()
        setMode(current?.extension === 'pdf' ? 'edit' : current ? 'word' : 'read')
        if (current?.extension === "pdf") void loadPdf(current.id)
        else if (!current) status("Ready")
      } else if (current?.extension === "pdf") {
        if (oldVersion !== current.contentVersion) void loadPdf(current.id)
        else { drawMarks(); syncFields() }
      } else if (current && !editingWord && oldVersion !== current.contentVersion) void renderWord()
      tools.updated()
    } catch (error) {
      if (error.status === 401) {
        if (role === "guest") sessionStorage.removeItem("elleson-collaboration")
        else {
          sessionStorage.removeItem("elleson-owner")
          sessionStorage.removeItem("elleson-session")
          localStorage.removeItem("elleson-session")
        }
        credential = ""
        revision = -1
        current = null
        layout()
        if (role === 'phone') setTimeout(()=>{if(!credential&&!$['request-pair'].disabled)$['request-pair'].click()},600)
      }
      networkState = error.status === 401 ? "Connecting to the PC" : navigator.onLine === false ? "Offline" : "Reconnecting"
      updateConnection()
      fail(error)
    }
  })().finally(() => { refreshPending = undefined })
  return refreshPending
}

function edit(change) {
  const id = current?.id
  const payload = { ...change, id: change.id || editId() }
  localInkIds.add(payload.id)
  const operation = async () => {
    if (!id || current?.id !== id) return false
    localSequence++
    try {
      if (queuedChanges.some(item => item.document === id)) {
        await flushQueue()
        if (queuedChanges.some(item => item.document === id)) {
          if (!queuedChanges.some(item => item.change.id === payload.id)) queuedChanges.push({document:id,change:payload})
          persistQueue(); updateConnection(); return true
        }
      }
      const response = await postJson("/api/edit/" + id, payload)
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
      inputDrafts.acknowledge(id, payload)
      status("Change synced")
      return true
    } catch (error) {
      if (!error.status) {
        if (!queuedChanges.some(item => item.change.id === payload.id)) queuedChanges.push({ document: id, change: payload })
        persistQueue(); networkState = "Reconnecting"; updateConnection()
        status("Change retained on this device until the connection returns.")
        return true
      }
      if (error.status === 409 && ["field", "word"].includes(change.kind) && Object.hasOwn(error.problem || {}, "actual")) {
        conflictHistory.remember(id,payload,error.problem.actual)
        if (confirm("Another editor changed this entry. Choose OK to keep your entry, or Cancel to use the latest entry.")) {
          const retry = { ...change, id: editId(), before: error.problem.actual }
          try {
            const response = await postJson("/api/edit/" + id, retry)
            current = await response.json(); inputDrafts.acknowledge(id, change); revision = -1; layout(); syncFields(); return true
          } catch (error) {
            if (!error.status) { queuedChanges.push({ document: id, change: retry }); persistQueue(); updateConnection() }
            fail(error); return false
          }
        }
        inputDrafts.acknowledge(id, change); revision = -1; await refresh(); return false
      }
      if (["word", "field"].includes(change.kind) && !inputDrafts.latest(id, change)) inputDrafts.save(id, payload)
      fail(error)
      if (error.status === 409) revision = -1
      return false
    } finally {
      localSequence++
    }
  }
  pendingEdit = pendingEdit.catch(fail).then(operation)
  return pendingEdit
}
function flushQueue() {
  if (queueFlush) return queueFlush
  queueFlush = drainQueue().finally(() => { queueFlush = undefined })
  return queueFlush
}
async function drainQueue() {
  if (flushing || !credential) return
  flushing = true
  try {
    while (queuedChanges.length) {
      const queued = queuedChanges.find((item, index) => !item.blocked && !queuedChanges.slice(0,index).some(previous => previous.document === item.document && previous.blocked))
      if (!queued) break
      try { await postJson("/api/edit/" + queued.document, queued.change) }
      catch (error) {
        if (!error.status) break
        if (error.status === 409 && Object.hasOwn(error.problem || {}, "actual")) {
          conflictHistory.remember(queued.document,queued.change,error.problem.actual)
          if (sameValue(error.problem.actual, queued.change.value)) { /* Already received before this device restarted. */ }
          else if (confirm("A queued field entry conflicts with the other device. Keep your queued entry? Cancel uses the latest entry.")) { queued.change.before = error.problem.actual; queued.change.id = editId(); persistQueue(); continue }
        } else {
          queued.blocked = true; persistQueue()
          status("A pending edit needs review. Open Review pending edits to keep, copy or discard it.")
          break
        }
      }
      inputDrafts.acknowledge(queued.document, queued.change)
      queuedChanges = queuedChanges.filter(item => item !== queued); persistQueue(); revision = -1
    }
  } finally { flushing = false; updateConnection() }
}

const reviewDrafts = document.createElement('button'); reviewDrafts.id = 'review-pending-edits'; reviewDrafts.textContent = 'Review pending edits'
$['history-actions'].append(reviewDrafts)
const recoveryDialog = document.createElement('dialog'); recoveryDialog.innerHTML = '<h2>Pending edits on this device</h2><p>These changes are retained until they are received or you discard them. Copy text below if the document changed.</p><div></div><form method="dialog"><button>Close</button></form>'; document.body.append(recoveryDialog)
reviewDrafts.onclick = () => {
  const records = [...queuedChanges, ...inputDrafts.all().filter(record => !queuedChanges.some(item => item.change.id === record.change.id))]
  const list = recoveryDialog.querySelector('div'); list.replaceChildren()
  if (!records.length) list.textContent = 'All edits have reached document recovery storage.'
  for (const record of records) {
    const row = document.createElement('section'), label = document.createElement('p'), text = document.createElement('textarea'), discard = document.createElement('button')
    label.textContent = record.change.kind + '  -  document ' + record.document + (record.blocked ? '  -  needs review' : '')
    text.readOnly = true; text.rows = 4; text.setAttribute('aria-label','Retained edit'); text.value = typeof record.change.value === 'string' ? record.change.value : JSON.stringify(record.change.value ?? record.change)
    discard.textContent = 'Discard this retained edit'; discard.onclick = () => { if (!confirm('Discard this retained edit? Copy any text you need first.')) return; inputDrafts.acknowledge(record.document,record.change); queuedChanges = queuedChanges.filter(item=>item.change.id!==record.change.id); persistQueue(); row.remove(); updateConnection(); layout() }
    row.append(label,text)
    if (record.change.kind === 'word' && record.document === current?.id) {
      const apply = document.createElement('button'); apply.textContent = 'Apply to selected paragraph'
      apply.onclick = async () => {
        if (selectedWordIndex === null || !current.lines[selectedWordIndex]?.editable) { status('Select the destination paragraph before opening this review.'); return }
        if (!confirm('Replace the selected paragraph with this retained text? Current text: ' + current.lines[selectedWordIndex].text)) return
        const change = {kind:'word',index:selectedWordIndex,structureVersion:current.structureVersion || 0,before:current.lines[selectedWordIndex].text,value:record.change.value}
        inputDrafts.acknowledge(record.document,record.change)
        const replacement = inputDrafts.save(current.id,change)
        queuedChanges = queuedChanges.filter(item=>item.change.id!==record.change.id); persistQueue()
        recoveryDialog.close()
        if (await edit(replacement)) await renderWord()
      }
      row.append(apply)
    }
    row.append(discard); list.append(row)
  }
  recoveryDialog.showModal()
}

async function ensureSynced() {
  flushWord()
  await pendingEdit
  if(current?.lines)await wordInk.pending()
  await flushQueue()
  if (queuedChanges.some(item => item.document === current?.id) || inputDrafts.all().some(item => item.document === current?.id)) throw new Error('Your latest changes are retained on this device. Reconnect or review pending drafts before exporting the document.')
}
// Flush on ordinary backgrounding; the input journal also survives abrupt exits.
document.addEventListener('visibilitychange', () => { if (document.hidden) flushWord() })
window.addEventListener('pagehide', () => flushWord())

async function loadPdf(id) {
  const sequence = ++loadSequence
  renderIndex++
  status("Opening PDF…")
  try {
    if (loadingTask) await loadingTask.destroy().catch(() => {})
    const sourceUrl = "/api/source/" + id + "?v=" + current.contentVersion
    const localData = new Uint8Array((await sourceCache.load(id+':'+current.contentVersion,async()=>await (await request(sourceUrl)).arrayBuffer())).slice(0))
    const task = pdfjs.getDocument({
      ...(localData ? { data: localData } : { url: sourceUrl }), httpHeaders: { Authorization: "Bearer " + credential },
      cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/", isEvalSupported: false
    })
    loadingTask = task
    const opened = await task.promise
    if (current?.id !== id || sequence !== loadSequence) { await task.destroy(); return }
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
  activeRenderTask?.cancel()
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
    if (sequence !== renderIndex || source !== pdf) return
    const natural = pdfPage.getViewport({ scale: 1 })
    const width = Math.max(140, $.stage.clientWidth - 42)
    const height = Math.max(160, $.stage.clientHeight - 42)
    const base = matchMedia("(max-width:600px)").matches ? Math.min(($.stage.clientWidth - 12) / natural.width, 2) : Math.min(width / natural.width, height / natural.height, 2)
    const frame = pdfPage.getViewport({ scale: base * zoom })
    const pixelRatio = Math.min(devicePixelRatio || 1, 2, 2800 / Math.max(frame.width, frame.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.ceil(frame.width * pixelRatio)
    canvas.height = Math.ceil(frame.height * pixelRatio)
    activeRenderTask = pdfPage.render({
      canvas, viewport: frame, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
      annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS
    })
    await activeRenderTask.promise
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
    pdfDetail.update(pdfPage,frame,pixelRatio)
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
    restorePosition()
    rememberPosition()
    status("PDF ready")
    tools.updated()
  } catch (error) { if (source === pdf && sequence === renderIndex) fail(error) }
}

function createFields(annotations) {
  const container = $["pdf-fields"]
  container.replaceChildren()
  for (const field of annotations) {
    if (!field.fieldName || field.readOnly || !field.rect) continue
    const choice = field.fieldType === 'Ch'
    const checkbox = field.fieldType === 'Btn' && field.checkBox
    const radio = field.fieldType === 'Btn' && field.radioButton
    if (!choice && !checkbox && !radio && field.fieldType !== 'Tx') continue
    const element = document.createElement(choice ? 'select' : field.multiLine ? 'textarea' : 'input')
    if (choice) {
      element.multiple = Boolean(field.multiSelect)
      if (!field.combo) element.size = Math.max(2, Math.min(6, field.options.length))
      if (field.combo && !field.multiSelect) element.add(new Option('',''))
      for (const item of field.options) element.add(new Option(item.displayValue, item.exportValue))
    } else if (!field.multiLine) element.type = checkbox ? 'checkbox' : radio ? 'radio' : 'text'
    if (radio) { element.name = 'pdf-' + current.id + '-' + field.fieldName; element.value = field.buttonValue; element.setAttribute('aria-label', (field.alternativeText || field.fieldName) + ': ' + field.buttonValue) }
    else element.setAttribute('aria-label', field.alternativeText || field.fieldName)
    if (field.maxLen && element.tagName !== 'SELECT') element.maxLength = field.maxLen
    element.className = 'pdf-field'; element.dataset.field = field.fieldName
    const rect = [...viewport.convertToViewportPoint(field.rect[0], field.rect[1]), ...viewport.convertToViewportPoint(field.rect[2], field.rect[3])]
    Object.assign(element.style, {left:Math.min(rect[0],rect[2])+'px',top:Math.min(rect[1],rect[3])+'px',width:Math.abs(rect[2]-rect[0])+'px',height:Math.abs(rect[3]-rect[1])+'px'})
    const original = checkbox ? field.fieldValue !== 'Off' && Boolean(field.fieldValue) : choice && field.multiSelect ? (Array.isArray(field.fieldValue) ? field.fieldValue : field.fieldValue ? [field.fieldValue] : []) : (Array.isArray(field.fieldValue) ? field.fieldValue[0] : field.fieldValue) || ''
    element.originalValue = original
    element.lastCommitted = localValue(current.id,{kind:'field',name:field.fieldName}) ?? current.fields[field.fieldName] ?? original
    const documentId = current.id
    let timer
    const valueOf = () => checkbox ? element.checked : choice && element.multiple ? Array.from(element.selectedOptions,option=>option.value) : element.value
    const retain = () => inputDrafts.save(documentId,{kind:'field',name:field.fieldName,before:element.lastCommitted,value:valueOf()})
    const commit = () => {
      clearTimeout(timer)
      if (radio && !element.checked) return
      const value = valueOf()
      if (sameValue(value,element.lastCommitted)) { inputDrafts.acknowledge(documentId,{kind:'field',name:field.fieldName,value}); return }
      const before = element.lastCommitted
      const change = retain()
      for (const other of container.children) if (other.dataset.field === field.fieldName) other.lastCommitted = value
      void edit({...change,before,value})
    }
    element.addEventListener('change',commit)
    element.addEventListener('blur',commit)
    if (!checkbox && !radio && !choice) element.addEventListener('input',()=>{retain();layout();clearTimeout(timer);timer=setTimeout(commit,140)})
    container.append(element)
  }
  syncFields()
}
function syncFields() {
  for (const element of $['pdf-fields'].children) {
    if (document.activeElement === element) continue
    const value = localValue(current.id,{kind:'field',name:element.dataset.field}) ?? current.fields[element.dataset.field] ?? element.originalValue
    if (element.type === 'checkbox') element.checked = Boolean(value)
    else if (element.type === 'radio') element.checked = element.value === value
    else if (element.tagName === 'SELECT' && element.multiple) for (const option of element.options) option.selected = Array.isArray(value) && value.includes(option.value)
    else element.value = value
    element.lastCommitted = value
  }
}

function drawMarks() {
  if (!viewport || !current?.marks || draft) return
  const canvas = $["ink-canvas"]
  const context = canvas.getContext("2d")
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.scale(viewport.pixelRatio, viewport.pixelRatio)
  context.fillStyle = context.strokeStyle = "#093352"
  context.lineCap = "round"
  context.lineJoin = "round"
  context.lineWidth = 1.7 * viewport.scale
  for(const mark of current.marks)pendingInk.delete(mark.id)
  const marks = current.marks.filter(mark => mark.page === viewport.page)
  $.undo.disabled = marks.length === 0
  const pendingMarks = [...marks]
  for(const item of pendingInk.values())if(item.document===current.id&&item.mark.page===viewport.page&&!marks.some(mark=>mark.id===item.mark.id))pendingMarks.push(item.mark)
  if (remoteDraft?.document === current.id && remoteDraft?.page === viewport.page && !pendingMarks.some(mark=>mark.id===remoteDraft.id)) pendingMarks.push(remoteDraft)
  if (draft?.page === viewport.page) pendingMarks.push(draft)
  for (const mark of pendingMarks) {
    context.strokeStyle = mark.color || "#093352"
    context.lineWidth = (mark.width || 1.7) * viewport.scale
    context.globalAlpha = mark.opacity ?? 1
    const markId=mark.group||mark.id
    if(markId&&!localInkIds.has(markId)&&mark!==draft&&mark!==remoteDraft){if(!inkArrivals.has(markId))inkArrivals.set(markId,performance.now());const elapsed=performance.now()-inkArrivals.get(markId);if(elapsed<160&&!matchMedia('(prefers-reduced-motion: reduce)').matches){context.globalAlpha*=.2+.8*elapsed/160;if(!fadeFrame)fadeFrame=requestAnimationFrame(()=>{fadeFrame=undefined;drawMarks()})}}
    if (mark.kind === "text") {
      context.font = mark.size * viewport.scale + "px Arial, sans-serif"
      const at = viewport.convertToViewportPoint(...mark.at), angle = (mark.angle || 0) * Math.PI / 180
      const next = viewport.convertToViewportPoint(mark.at[0] + Math.cos(angle), mark.at[1] + Math.sin(angle))
      context.save(); context.translate(...at); context.rotate(Math.atan2(next[1] - at[1], next[0] - at[0])); context.fillText(mark.value, 0, 0); context.restore()
    } else {
      const points = mark.points.map(point => viewport.convertToViewportPoint(...point))
      strokePath(context,points)
    }
  }
  context.globalAlpha = 1
}

function go(number) {
  if (!pdf) return
  page = Math.max(1, Math.min(pdf.numPages, number || 1))
  $.stage.scrollTop = $.stage.scrollLeft = 0
  return renderPage()
}

async function renderWord() {
  if (!current?.lines) return
  const render = ++wordRender
  const source = current
  const sheet = $["word-sheet"]
  const scrollTop = $.stage.scrollTop, scrollLeft = $.stage.scrollLeft
  const selection = getSelection()
  const endpoint = (node, offset) => {
    const element = (node?.nodeType === 1 ? node : node?.parentElement)?.closest('[data-word-index]')
    if (!element || !sheet.contains(element)) return null
    const range = document.createRange(); range.selectNodeContents(element); range.setEnd(node, offset)
    return { index: element.dataset.wordIndex, offset: range.toString().length }
  }
  const anchor = endpoint(selection?.anchorNode, selection?.anchorOffset)
  const focus = endpoint(selection?.focusNode, selection?.focusOffset)
  const restore = () => {
    const locate = point => {
      const element = sheet.querySelector('[data-word-index="' + point.index + '"]')
      if (!element) return null
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let remaining = point.offset, node
      while ((node = walker.nextNode())) {
        if (remaining <= node.length) return [node, remaining]
        remaining -= node.length
      }
      return [element, element.childNodes.length]
    }
    if (anchor && focus) {
      const a = locate(anchor), f = locate(focus)
      if (a && f) {
        sheet.querySelector('[data-word-index="' + focus.index + '"]')?.focus({ preventScroll: true })
        getSelection().setBaseAndExtent(...a, ...f)
      }
    }
    $.stage.scrollTop = scrollTop; $.stage.scrollLeft = scrollLeft
    restorePosition()
  }
  const editable = (element, line, index) => {
    element.dataset.wordIndex = index
    if(remoteLineChanges.delete(index))element.classList.add('incoming-writing')
    element.classList.toggle("word-selected", selectedWordIndex === index)
    const select = () => {
      selectedWordIndex = index
      for (const paragraph of $["word-sheet"].querySelectorAll(".word-selected")) paragraph.classList.remove("word-selected")
      element.classList.add("word-selected")
      layout()
    }
    element.addEventListener("click", event=>{select();selectTappedWord(element,event)})
    element.contentEditable = mode === "word" && line.editable ? "plaintext-only" : "false"
    element.dataset.wordCanEdit = String(mode === 'word' && line.editable)
    if (mode !== "word" || !line.editable) return
    let timer
    let composing = false
    const structureVersion = source.structureVersion || 0
    let lastSynced = localValue(source.id, {kind:'word', index, structureVersion}) ?? line.text
    if (lastSynced !== line.text) element.textContent = lastSynced
    const flush = () => {
      clearTimeout(timer)
      if (composing || !element.isConnected) return
      const value = element.textContent.replace(/[\r\n]+/g, " ")
      if (value === lastSynced) { inputDrafts.acknowledge(source.id,{kind:'word',index,structureVersion,value}); return }
      const before = lastSynced
      lastSynced = value
      const change = inputDrafts.latest(source.id, {kind:'word', index, structureVersion}) || inputDrafts.save(source.id, {kind:'word', index, structureVersion, before, value})
      void edit({...change, before, value, structureVersion}).then(success => {
        if (!success) lastSynced = before
        const merged = current?.id === source.id && current.structureVersion === structureVersion && current.lines?.[index]?.text
        // Reflect a concurrent merge without replacing newer input typed while
        // this request was in flight. A blur will render the committed layout.
        if (success && typeof merged === "string" && merged !== value && merged !== before &&
            element.isConnected && element.textContent === value && lastSynced === value) {
          const selection = getSelection()
          let caret
          if (selection?.isCollapsed && element.contains(selection.anchorNode)) {
            const prefix = document.createRange()
            prefix.selectNodeContents(element)
            prefix.setEnd(selection.anchorNode, selection.anchorOffset)
            caret = prefix.toString().length
          }
          let start = 0
          while (start < Math.min(value.length, merged.length) && value[start] === merged[start]) start++
          element.textContent = lastSynced = merged
          if (caret !== undefined && element.firstChild) {
            const offset = Math.max(0, Math.min(merged.length, caret > start ? caret + merged.length - value.length : caret))
            selection.collapse(element.firstChild, offset)
          }
        }
        if (!editingWord && current?.id === source.id) void renderWord()
      })
    }
    element.addEventListener("focus", () => { editingWord = true; flushWord = flush; select() })
    element.addEventListener("compositionstart", () => { composing = true; clearTimeout(timer) })
    element.addEventListener("compositionend", () => { composing = false; flush() })
    element.addEventListener("input", () => {
      inputDrafts.save(source.id, {kind:'word', index, structureVersion, before:lastSynced, value:element.textContent.replace(/[\r\n]+/g, ' ')})
      layout()
      clearTimeout(timer)
      timer = setTimeout(flush, 350)
    })
    element.addEventListener("blur", () => {
      editingWord = false
      flush()
    })
    element.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault()
        const selection = getSelection(), range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null
        let offset = line.text.length
        if (range && element.contains(range.startContainer)) { const prefix = range.cloneRange(); prefix.selectNodeContents(element); prefix.setEnd(range.startContainer, range.startOffset); offset = prefix.toString().length }
        element.blur()
        void pendingEdit.then(() => tools.splitParagraph(index, offset)).catch(fail)
      }
    })
  }
  if (source.extension === "docx" && window.docx) {
    try {
      const cacheKey=source.id+':'+source.contentVersion
      const data = await sourceCache.load(cacheKey,async()=>await (await request('/api/source/'+source.id)).arrayBuffer())
      const container = document.createElement("div")
      const styles = document.createElement("div")
      await renderWordPages(data, container, styles)
      if (render !== wordRender || current?.id !== source.id || current.contentVersion !== source.contentVersion) return
      if(editingWord&&sheet.querySelector("[data-word-index]"))return
      const layoutSheet=document.createElement('div')
      layoutSheet.className='word-sheet word-rich'
      Object.assign(layoutSheet.style,{position:'fixed',left:'-20000px',top:'0',visibility:'hidden',width:sheet.style.width,zoom:sheet.style.zoom||'1'})
      layoutSheet.append(styles,container);document.body.append(layoutSheet)
      try{await shareWordLayout({sheet:layoutSheet,source,role,request})}finally{layoutSheet.remove()}
      while(wordInk.drawing&&render===wordRender)await new Promise(requestAnimationFrame)
      if(render!==wordRender||current?.id!==source.id||current.contentVersion!==source.contentVersion)return
      if(editingWord&&sheet.querySelector('[data-word-index]'))return
      $["word-sheet"].classList.add("word-rich")
      $["word-sheet"].replaceChildren(styles, container)
      if(layoutSheet.dataset.sharedLayout)sheet.dataset.sharedLayout=layoutSheet.dataset.sharedLayout
      wordPageSizing.fit()
      const paragraphs = Array.from(container.querySelectorAll("[data-word-source-index]"))
      let position = 0
      for (const element of paragraphs) {
        const index = source.lines.findIndex((line, index) => index >= position && line.text === element.textContent)
        if (index < 0) continue
        position = index + 1
        editable(element, source.lines[index], index)
      }
      positionAnchoredInk(sheet)
      restore()
      wordInk.attach(source)
      sheet.dataset.renderDocument=source.id
      return
    } catch (error) {
      fail(error)
    }
  }
  $["word-sheet"].classList.remove("word-rich")
  $["word-sheet"].style.width = ''; $["word-sheet"].style.zoom = ''
  const elements = current.lines.map((line, index) => {
    const element = document.createElement(/^heading|^title/i.test(line.style) ? "h2" : "p")
    element.textContent = line.text
    editable(element, line, index)
    return element
  })
  $["word-sheet"].replaceChildren(...elements)
  restore()
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
        replacementRuns = spans.slice(spans.indexOf(span))
        selectedSpan = { document: id, page: number, span: span.id, before: span.text, version }
        $["original-font"].textContent = span.font + " · " + Number(span.size.toFixed(2)) + " pt"
        $.replacement.value = span.text
        $["replacement-font"].value = ""
        $["replacement-paragraph"].checked = false
        $["replacement-lines"].value = "1"
        $["replacement-width"].value = ""
        $["replacement-height"].value = ""
        $["replacement-error"].textContent = ""
        $["replacement-preview"].hidden = true
        $["replace-dialog"].showModal()
        $.replacement.focus(); $.replacement.select()
      })
      return button
    })
    $["pdf-text"].replaceChildren(...buttons)
    $["pdf-text"].setAttribute('aria-label',spans.length?'Tap text to edit it':'Use Scan & OCR to recognize scanned text, or Add text to fill the page.')
  } catch (error) { fail(error) }
}

async function openFile() {
  document.activeElement?.blur()
  await pendingEdit
  if (window.desktopDocs) {
    const opened=await window.desktopDocs.open()
    if(opened?.picture)revision=-1
    await refresh()
    if(opened?.picture)status('Picture opened. Choose File > Save as PDF to export it.')
  } else $.file.click()
}
$.open.addEventListener("click", () => void openFile().catch(fail))
$.scan.addEventListener("click", () => $["scan-file"].click())
$["scan-file"].addEventListener("change", async () => {
  try { for (const selected of $["scan-file"].files) await tools.addScan(selected) }
  catch(error){fail(error)}
  finally{$["scan-file"].value=""}
})
$["scan-cancel"].addEventListener("click", () => { $["scan-dialog"].close(); $["scan-file"].value = ""; tools.clearScans() })
$["scan-angle"].addEventListener("input", () => {
  $["scan-preview"].style.transform = "rotate(" + $["scan-angle"].value + "deg)"
  $["scan-angle-value"].textContent = $["scan-angle"].value + "°"
})
$["scan-create"].addEventListener("click", async () => {
  try {
    document.activeElement?.blur()
    await pendingEdit
    status("Converting photo to PDF…")
    const pdf = await tools.createScan()
    await request("/api/open", {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(pdf.name) }, body: pdf
    })
    revision = -1
    $["scan-dialog"].close()
    await refresh()
    tools.clearScans(); $["scan-file"].value = ""
  } catch (error) { fail(error) }
  // Retain photos and crop settings when conversion or opening fails.
})
const appendScan = document.createElement("button")
appendScan.textContent = "Append scan to shared PDF"
appendScan.hidden = true
$["scan-create"].before(appendScan)
let captureTarget
new MutationObserver(() => {
  if (!$["scan-dialog"].open) return
  captureTarget ||= role === "phone" && current?.extension === "pdf" && location.hostname !== "appassets.androidplatform.net" ? { id: current.id, filename: current.filename, operation: editId() } : null
  appendScan.hidden = !captureTarget
}).observe($["scan-dialog"], { attributes: true, attributeFilter: ["open"] })
$["scan-dialog"].addEventListener("close", () => { captureTarget = null })
appendScan.onclick = async () => {
  const target = captureTarget
  if (!target || !confirm("Append these scanned pages to " + target.filename + "?")) return
  appendScan.disabled = true
  try {
    await ensureSynced()
    const scan = await tools.createScan()
    await request("/api/capture-pages/" + target.id, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Operation-Id": target.operation }, body: scan
    })
    revision = -1
    $["scan-dialog"].close()
    await refresh()
    tools.clearScans()
    status("Scanned pages added to " + target.filename)
  } catch (error) { fail(error) }
  finally { appendScan.disabled = false }
}
async function openSaved(id, version) {
  document.activeElement?.blur()
  await pendingEdit
  if (version && current?.libraryId === id && current.dirty && !confirm("Replace this tab with an earlier saved version? Unsaved work in this tab will be replaced.")) return
  await postJson("/api/library/" + id + "/open", { version })
  $["versions-dialog"].close()
  $["library-dialog"].close()
  revision = -1
  await refresh()
}
const librarySearch = document.createElement("form")
const tagDialog = document.createElement("dialog")
tagDialog.className = "document-suite"
tagDialog.innerHTML = '<h2>Document tags</h2><form><label>Comma-separated tags <input name="tags" maxlength="820"></label><p role="status"></p><button class="primary">Save tags</button><button type="button">Cancel</button></form>'
document.body.append(tagDialog)
tagDialog.querySelector('button[type="button"]').onclick = () => tagDialog.close()
librarySearch.setAttribute("role", "search")
librarySearch.className = "actions"
librarySearch.innerHTML = '<label>Search saved files <input type="search" name="query" maxlength="200"></label><label>Tag <select name="tag" aria-label="Filter by tag"></select></label><label>Type <select name="type"><option value="">All</option><option value="pdf">PDF</option><option value="docx">Word</option></select></label><label>Updated <select name="updated"><option value="0">Any time</option><option value="7">Past week</option><option value="30">Past month</option></select></label><button>Search</button>'
$["library-list"].before(librarySearch)
let libraryRender = 0
librarySearch.onsubmit = event => { event.preventDefault(); void showLibrary().catch(fail) }
for (const name of ["tag", "type", "updated"]) librarySearch.elements.namedItem(name).onchange = () => void showLibrary().catch(fail)
async function showLibrary() {
  const sequence = ++libraryRender
  const records = await (await request("/api/library")).json()
  if (sequence !== libraryRender) return
  const tag = librarySearch.elements.namedItem("tag")
  const selected = tag.value
  const tags = [...new Set(records.flatMap(record => record.tags || []))].sort()
  tag.replaceChildren(new Option("All tags", ""), ...tags.map(item => new Option(item, item)))
  if (tags.includes(selected)) tag.value = selected
  const type = librarySearch.elements.namedItem("type").value
  const updated = Number(librarySearch.elements.namedItem("updated").value)
  const query = librarySearch.elements.namedItem("query").value.trim()
  if (!$["library-dialog"].open) $["library-dialog"].showModal()
  if (query) $["library-list"].textContent = "Searching saved files…"
  const results = query ? await (await request("/api/library-search?q=" + encodeURIComponent(query))).json() : null
  if (sequence !== libraryRender || !$["library-dialog"].open) return
  const matches = new Map(results?.matches.map(match => [match.id, match]))
  const rows = records.filter(record => (!query || matches.has(record.id)) &&
    (!tag.value || record.tags?.includes(tag.value)) &&
    (!updated || record.updated >= Date.now() - updated * 86400000) &&
    (!type || (type === "docx" ? /\.docx?$/i.test(record.filename) : /\.pdf$/i.test(record.filename)))).map(record => {
    const row = document.createElement("div")
    row.className = "library-row"
    const open = document.createElement("button")
    open.textContent = record.filename
    const match = matches.get(record.id)
    open.addEventListener("click", () => void (async () => {
      await openSaved(record.id)
      if (match?.page && current?.libraryId === record.id) {
        if (!pdf) await loadPdf(current.id)
        if (current?.libraryId === record.id) await go(match.page)
      }
    })().catch(fail))
    const details = document.createElement("small")
    details.textContent = new Date(record.updated).toLocaleString() + " · " + record.versionCount + " saved version(s)"
    if (record.tags?.length) details.append(" · " + record.tags.join(", "))
    if (match) details.append((match.page ? " · Page " + match.page : "") + " · " + match.snippet)
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
          button.dataset.versionOpen = version.id
          button.textContent = new Date(version.date).toLocaleString() + " · " + version.filename
          button.addEventListener("click", () => void openSaved(record.id, version.id).catch(fail))
          const row = document.createElement("div"), remove = document.createElement("button")
          row.className = "actions"
          remove.textContent = "Delete version"
          remove.disabled = version.id === saved[0]?.id
          remove.addEventListener("click", async () => {
            try {
              if (!confirm("Delete this saved version?")) return
              await request("/api/library/" + record.id + "/versions/" + version.id, { method: "DELETE" }); row.remove()
            } catch (error) { fail(error) }
          })
          row.append(button, remove)
          return row
        }))
        $["versions-dialog"].showModal()
      } catch (error) { fail(error) }
    })
    const editTags = document.createElement("button")
    editTags.textContent = "Edit tags"
    editTags.onclick = () => {
      const form = tagDialog.querySelector("form"), input = form.elements.namedItem("tags")
      const status = tagDialog.querySelector("[role=status]")
      status.textContent = ""
      input.value = (record.tags || []).join(", ")
      form.onsubmit = async event => {
        event.preventDefault()
        event.submitter.disabled = true
        try {
          await postJson("/api/library/" + record.id + "/tags", { tags: input.value.split(",") })
          tagDialog.close()
          await showLibrary()
        } catch (error) { status.textContent = error.message }
        finally { event.submitter.disabled = false }
      }
      tagDialog.showModal()
    }
    actions.append(pin, versions, editTags)
    row.append(open, details, actions)
    return row
  })
  $["library-list"].replaceChildren(...rows)
  if (!rows.length) $["library-list"].textContent = records.length ? "No matching saved files." : "Open a document to add it to your files."
  if (results?.skipped) $["library-list"].append(" " + results.skipped + " files could not be indexed.")
  if (!$["library-dialog"].open) $["library-dialog"].showModal()
}
$.library.addEventListener("click", () => void showLibrary().catch(fail))
$["welcome-open"].addEventListener("click", () => void openFile().catch(fail))
async function importOpenedFile(selected){
  const picture=Boolean(pictureType(selected.name,selected.type))
  const file=picture?await openPictureAsPdf(selected):selected
  await request('/api/open',{method:'POST',headers:{
    'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(file.name)
  },body:file})
  revision=-1
  await refresh()
  if(picture)status('Picture opened. Choose File > Save as PDF to export it.')
  else if(current)window.EllesonAndroid?.rememberSource?.(current.id)
}
$.file.addEventListener("change", async () => {
  const selected = $.file.files[0]
  if (!selected) return
  try {
    status("Opening " + selected.name + "…")
    await importOpenedFile(selected)
  } catch (error) { if(error.status===422 && error.problem?.passwordRequired){lockedFile=selected;askPassword()}else fail(error) }
  finally { $.file.value = "" }
})

$.pair.addEventListener("submit", async event => {
  event.preventDefault()
  try {
    const result = await (await postJson("/api/pair", { code: $.code.value })).json()
    credential = result.token
    sessionStorage.setItem("elleson-session", credential)
    localStorage.setItem("elleson-session", credential)
    revision = -1
    layout()
    status("Connected")
    await refresh()
    await tools.acceptPendingHandoff()
  } catch (error) { fail(error) }
})
for (const [id, approve] of [["approve-phone", true], ["reject-phone", false]]) byId(id).onclick = async () => {
  try { await postJson("/api/pair-request/approve", { id: requestedPhone, approve }); $["approve-phone-dialog"].close() }
  catch (error) { fail(error) }
}
$["request-pair"].onclick = async () => {
  const button = $["request-pair"], label = $["pair-request-status"]
  button.disabled = true
  try {
    label.textContent = "Approve this connection on the PC."
    const pending = await (await postJson("/api/pair-request", {})).json()
    let result
    for (let attempt = 0; attempt < 118; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      if (credential) return
      result = await (await postJson("/api/pair-request/status", pending)).json()
      if (result.token) break
    }
    if (!result?.token) throw new Error("The connection request expired. Try again.")
    credential = result.token; sessionStorage.setItem("elleson-session", credential); localStorage.setItem("elleson-session", credential)
    revision = -1; layout(); await refresh(); await tools.acceptPendingHandoff()
    label.textContent = "Connected"
  } catch (error) { label.textContent = error.message }
  finally { button.disabled = false }
}
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
    await ensureSynced()
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
byId("zoom-in").addEventListener("click", () => { zoom *= 1.25; void renderPage() })
byId("zoom-out").addEventListener("click", () => { zoom /= 1.25; void renderPage() })
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
  renderOrganizer()
  $["pages-dialog"].showModal()
})
function renderOrganizer() {
  const order = $["page-order"].value.split(",").map(value => Number(value.trim())).filter(value => Number.isInteger(value) && value > 0 && value <= current.pages)
  const source = pdf
  $["page-organizer"].replaceChildren(...order.map((number, index) => {
    const card = document.createElement("div"), label = document.createElement("strong"), canvas = document.createElement("canvas")
    label.textContent = "Page " + number; card.append(canvas, label)
    if (source) void source.getPage(number).then(async page => {
      if (!card.isConnected) return
      const frame = page.getViewport({ scale: 80 / page.getViewport({scale:1}).width }); canvas.width = Math.ceil(frame.width); canvas.height = Math.ceil(frame.height)
      await page.render({ canvas, viewport: frame }).promise
    }).catch(() => {})
    for (const [text, offset] of [["Move earlier", -1], ["Move later", 1]]) {
      const button = document.createElement("button"); button.textContent = text; button.disabled = order[index + offset] === undefined
      button.onclick = () => { [order[index], order[index + offset]] = [order[index + offset], order[index]]; $["page-order"].value = order.join(", "); renderOrganizer() }; card.append(button)
    }
    return card
  }))
}
$["page-order"].addEventListener("change", renderOrganizer)
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
  if ($["combine-editable"].checked || confirm("Combine as a fixed PDF? Form fields and annotations in both documents will become part of the pages.")) $["combine-file"].click()
})
$["combine-file"].addEventListener("change", async () => {
  const selected = $["combine-file"].files[0]
  if (!selected) return
  try {
    $["pages-dialog"].close()
    await pendingEdit
    await request("/api/combine/" + current.id + ($["combine-editable"].checked ? "?editable=1" : ""), {
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
async function universalUndo(){
  if($['signature-dialog'].open){$['signature-undo'].click();return}
  if(draft){inputDrafts.acknowledge(current.id,draft);draft=null;inkTip.clear();drawMarks();streamInk(current.id,{});return}
  document.activeElement?.blur();flushWord();await pendingEdit
  if(current?.lines&&await wordInk.undoPending())return
  await edit({kind:'history-undo'});if(current?.lines)await renderWord()
}
byId('history-undo').addEventListener('click',()=>void universalUndo().catch(fail))
byId('history-redo').addEventListener('click',async()=>{try{document.activeElement?.blur();flushWord();await pendingEdit;await edit({kind:'history-redo'});if(current?.lines)await renderWord()}catch(error){fail(error)}})
document.addEventListener('keydown',event=>{
  if(!(event.ctrlKey||event.metaKey)||event.key.toLowerCase()!=='z'||event.shiftKey)return
  if(event.target.closest('input,textarea')&&!$['signature-dialog'].open)return
  event.preventDefault();void universalUndo().catch(fail)
})
for (const [button, dialog] of [["format-paragraph", "word-format-dialog"], ["insert-table", "table-dialog"]]) {
  byId(button).addEventListener("click", async () => {
    document.activeElement?.blur()
    await pendingEdit
    if (selectedWordIndex === null || !current?.lines) return
    wordTarget = { id: current.id, index: selectedWordIndex, version: current.contentVersion }
    wordTarget.selection = tools.selection()
    if (dialog === "word-format-dialog") $["word-format-form"].reset()
    if (dialog === "word-format-dialog") $["word-selection-only"].checked = wordTarget.selection?.index === selectedWordIndex && wordTarget.selection?.document === current.id
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
  if ($["word-selection-only"].checked) {
    const selection = wordTarget.selection
    if (!selection || selection.document !== current.id || selection.index !== wordTarget.index) { status("Select words inside one paragraph first."); return }
    if (await edit({ kind: "word-tools", action: "range", index: wordTarget.index, version: wordTarget.version, start: selection.start, end: selection.end, format })) await renderWord()
    $["word-format-dialog"].close()
    return
  }
  if (await edit({ kind: "word-format", index: wordTarget.index, version: wordTarget.version, format })) await renderWord()
  $["word-format-dialog"].close()
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
const inkTip=createStrokeTip(inkCanvas),streamInk=createInkStream(request),pendingInk=new Map()
setInterval(()=>{if(draft&&current)streamInk(current.id,draft)},800)
function paintTip(){if(draft&&viewport)inkTip.paint(draft.points,draft.width*viewport.scale*viewport.pixelRatio,draft.color,draft.opacity??1,p=>viewport.convertToViewportPoint(...p).map(v=>v*viewport.pixelRatio))}
$["drawing-done"].addEventListener("click", async () => {
  const button = $["drawing-done"]
  button.disabled = true
  try {
    if (draft) { const mark = draft; draft = null; if (mark.points.length > 1) await edit(mark) }
    const saved = await pendingEdit
    if (saved === false && !queuedChanges.length) { status("The last drawing could not be saved. Keep this document open and retry."); return }
    setMode("read")
    status(queuedChanges.length ? "Drawing retained on this device; waiting to sync. Keep the app open." : "Drawing kept in this document. Use Save to update your file.")
  } finally { button.disabled = false }
})
installDocumentGestures({ stage: $.stage, sheet: $["pdf-sheet"], isActive:()=>current?.extension==='pdf'&&!readingView.active, canPan:()=>drawingSettings.stylusOnly||!['pen','highlight','signature','erase','select','review','text'].includes(mode), getZoom: () => zoom,
  setZoom: value => { zoom = value }, render: renderPage,
  cancelStroke: () => { if (draft) inputDrafts.acknowledge(current.id, draft); draft = null; inkTip.clear(); drawMarks(); if (current) streamInk(current.id,{}) } })
function canvasPoint(event) {
  const rect = inkCanvas.getBoundingClientRect()
  return [(event.clientX - rect.left)*viewport.width/rect.width, (event.clientY - rect.top)*viewport.height/rect.height]
}
inkCanvas.addEventListener("pointerdown", event => {
  if (!viewport || viewport.page !== page || event.button !== 0 || draft || $.stage.dataset.navigating==='true') return
  if(event.pointerType==='touch'&&(drawingSettings.stylusOnly||event.width>48||event.height>48))return
  const actionMode=drawingSettings.eraser?'erase':mode

  const position = canvasPoint(event)
  const at = viewport.convertToPdfPoint(...position)
  if (pendingStamp && actionMode === 'text') {
    const value = pendingStamp; pendingStamp = null
    if (['check','cross','circle'].includes(value)) {
      const shapes = value === 'check' ? [[[0,10],[7,18],[24,0]]] : value === 'cross' ? [[[0,0],[18,18]],[[18,0],[0,18]]] : [Array.from({length:33},(_,i)=>[10+10*Math.cos(i*Math.PI/16),10+10*Math.sin(i*Math.PI/16)])]
      const strokes = shapes.map(shape=>shape.map(([x,y])=>viewport.convertToPdfPoint(position[0]+x,position[1]+y)))
      void edit({kind:'signature',page,strokes,color:$['ink-color'].value,width:2}).then(()=>setMode('read'))
    } else void edit({kind:'text',page,at,angle:0,value,size:14}).then(()=>setMode('read'))
    return
  }
  if (actionMode === "signature") {
    const docId = current.id, number = page, frame = viewport
    const strokes = structuredClone(signatureStrokes)
    const color = $['ink-color'].value, thickness = Number($['ink-width'].value)
    const size = Math.min(Number($['signature-width'].value)*frame.scale, frame.width, frame.height*3)
    previewSignature({sheet:$['pdf-sheet'], strokes,color,thickness,x:position[0]/frame.width,y:position[1]/frame.height,
      width:size/frame.width,height:size/(3*frame.height),fail,async commit(box) {
        if(current?.id!==docId || page!==number) throw Error('Return to the signing page.')
        const points=strokes.map(stroke=>stroke.map(([x,y])=>frame.convertToPdfPoint(
          (box.x+x*box.width)*frame.width,(box.y+y*box.height)*frame.height)))
        const accepted=await edit({kind:'signature',page:number,strokes:points,color,width:thickness})
        if(!accepted)throw Error('Signature could not be placed. Try again.')
        setMode('read')
      }})
  } else if (actionMode === "text") {
    const next = viewport.convertToPdfPoint(position[0] + 1, position[1])
    const angle = Math.atan2(next[1] - at[1], next[0] - at[0]) * 180 / Math.PI
    activeText = { kind: "text", page, at, angle, document: current.id }
    $.annotation.value = ""
    $["text-dialog"].showModal()
    $.annotation.focus()
  } else if (actionMode === "erase") {
    const hit = current.marks.findLast(mark => {
      if (mark.page !== page) return false
      if (mark.kind === "text") return at[0] >= mark.at[0] && at[0] <= mark.at[0] + mark.value.length * mark.size * .65 &&
        at[1] >= mark.at[1] - 4 && at[1] <= mark.at[1] + mark.size
      if(mark.points.length===1)return Math.hypot(at[0]-mark.points[0][0],at[1]-mark.points[0][1])<(mark.width||2)/2+7
      return mark.points.some((point, index) => {
        if (!index) return false
        const previous = mark.points[index - 1]
        const dx = point[0] - previous[0], dy = point[1] - previous[1]
        const fraction = Math.max(0, Math.min(1, ((at[0] - previous[0]) * dx + (at[1] - previous[1]) * dy) / (dx * dx + dy * dy || 1)))
        return Math.hypot(at[0] - previous[0] - fraction * dx, at[1] - previous[1] - fraction * dy) < (mark.width || 2) / 2 + 7
      })
    })
    if (hit) void edit({ kind: "undo", target: hit.id })
  } else if (actionMode === "pen" || actionMode === "highlight") {
    event.preventDefault()
    inkCanvas.setPointerCapture(event.pointerId)
    draft = { id: editId(), kind: "ink", page, pointer: event.pointerId, points: [at],
      color: actionMode === "highlight" ? "#f7ca42" : $["ink-color"].value,
      width: actionMode === "highlight" ? 12 : Number($["ink-width"].value), opacity: actionMode === "highlight" ? .25 : 1 }
    inputDrafts.save(current.id, draft)
    paintTip();streamInk(current.id,draft)
  }
})
inkCanvas.addEventListener("pointermove", event => {
  if (!draft || event.pointerId !== draft.pointer || draft.points.length >= 1200) return
  for(const sample of pointerSamples(event)){if(draft.points.length>=1200)break;appendPoint(draft.points,viewport.convertToPdfPoint(...canvasPoint(sample)))}
  if(Date.now()-inkJournalAt>150){inkJournalAt=Date.now();inputDrafts.save(current.id,draft)}
  localInkIds.add(draft.id)
  if(!inkFrame)inkFrame=requestAnimationFrame(()=>{inkFrame=null;if(!draft)return;const ctx=inkCanvas.getContext('2d');ctx.setTransform(viewport.pixelRatio,0,0,viewport.pixelRatio,0,0);ctx.lineCap=ctx.lineJoin='round';ctx.strokeStyle=draft.color;ctx.lineWidth=draft.width*viewport.scale;ctx.globalAlpha=draft.opacity??1;draft.painted=incrementalStroke(ctx,draft.points,draft.painted||1,false,p=>viewport.convertToViewportPoint(...p));ctx.globalAlpha=1;paintTip();streamInk(current.id,draft)})
})
inkCanvas.addEventListener("pointerup", event => {
  if (!draft || event.pointerId !== draft.pointer) return
  appendPoint(draft.points,viewport.convertToPdfPoint(...canvasPoint(event)))
  const mark = draft
  draft = null;inkTip.clear();pendingInk.set(mark.id,{document:current.id,mark});drawMarks();streamInk(current.id,mark)
  void edit(mark).then(saved=>{if(saved&&!queuedChanges.some(item=>item.change.id===mark.id))pendingInk.delete(mark.id)})
})
inkCanvas.addEventListener("pointercancel", () => {
  if (draft) inputDrafts.acknowledge(current.id, draft)
  draft = null
  inkTip.clear();drawMarks()
  if (current) streamInk(current.id,{})
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
  context.resetTransform()
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = $["ink-color"].value
  context.lineWidth = Number($["ink-width"].value)*2
  context.lineJoin = context.lineCap = "round"
  context.setTransform(signatureView.scale,0,0,signatureView.scale,signatureView.x*canvas.width,signatureView.y*canvas.height)
  for (const stroke of signatureDraft ? [...signatureStrokes, signatureDraft] : signatureStrokes) {
    strokePath(context,stroke.map(([x,y])=>[x*canvas.width,y*canvas.height]))
  }
  $['signature-undo'].disabled=signatureStrokes.length===0&&!signatureDraft
  canvas.dataset.strokeCount=String(signatureStrokes.length)
}
$.signature.addEventListener("click", () => {
  signatureView = {scale:1,x:0,y:0}
  signatureStrokes = []
  signatureDraft = null
  $["saved-signatures"].replaceChildren(new Option("New signature", ""), ...savedSignatures.map((item, index) => new Option(item.name, index)))
  $["signature-dialog"].showModal()
  $['signature-color'].value=$['ink-color'].value
  if(![...$['signature-thickness'].options].some(option=>option.value===$['ink-width'].value))$['signature-thickness'].add(new Option($['ink-width'].value,$['ink-width'].value))
  $['signature-thickness'].value=$['ink-width'].value
  drawSignature()
})
for(const [target,source] of [['signature-color','ink-color'],['signature-thickness','ink-width']])$[target].addEventListener('input',()=>{$[source].value=$[target].value;$[source].dispatchEvent(new Event('input',{bubbles:true}));drawSignature()})
const signaturePad = $["signature-pad"]
const signaturePoint = event => {
  const rect = signaturePad.getBoundingClientRect()
  return [Math.max(0,Math.min(1,((event.clientX - rect.left) / rect.width-signatureView.x)/signatureView.scale)),Math.max(0,Math.min(1,((event.clientY - rect.top) / rect.height-signatureView.y)/signatureView.scale))]
}
signaturePad.addEventListener("pointerdown", event => {
  if (signatureDraft || event.button !== 0 || signatureStrokes.length >= 100) return
  signaturePad.setPointerCapture(event.pointerId)
  signatureDraft = [signaturePoint(event)]
})
signaturePad.addEventListener("pointermove", event => {
  if (!signaturePad.hasPointerCapture(event.pointerId) || !signatureDraft || signatureDraft.length >= 1200) return
  for(const sample of pointerSamples(event)){if(signatureDraft.length>=1200)break;signatureDraft.push(signaturePoint(sample))}
  if(!signatureFrame)signatureFrame=requestAnimationFrame(()=>{signatureFrame=null;drawSignature()})
})
signaturePad.addEventListener("pointerup", event => {
  if (!signaturePad.hasPointerCapture(event.pointerId)) return
  if (signatureDraft?.length > 1) signatureStrokes.push(signatureDraft)
  signatureDraft = null
  drawSignature()
})
signaturePad.addEventListener("pointercancel", () => { signatureDraft = null; drawSignature() })
installSignatureGestures({canvas:signaturePad,getView:()=>signatureView,setView:view=>{signatureView=view;signaturePad.dataset.zoom=String(view.scale);drawSignature()},cancelStroke:()=>{signatureDraft=null;drawSignature()}})
$["signature-clear"].addEventListener("click", () => { signatureStrokes = []; drawSignature() })
$['signature-undo'].onclick=()=>{if(signatureDraft)signatureDraft=null;else signatureStrokes.pop();drawSignature()}
// A drawing gesture can suppress the next compatibility click on mobile browsers.
// Handle the completed Undo tap directly and suppress its duplicate mouse click.
$['signature-undo'].addEventListener('touchend',event=>{
  const touch=event.changedTouches[0],rect=event.currentTarget.getBoundingClientRect()
  if(event.touches.length||!touch||touch.clientX<rect.left||touch.clientX>rect.right||touch.clientY<rect.top||touch.clientY>rect.bottom)return
  event.preventDefault();event.currentTarget.click()
},{passive:false})
$["signature-cancel"].addEventListener("click", () => $["signature-dialog"].close())
$["saved-signatures"].addEventListener("change", () => {
  signatureStrokes = structuredClone(savedSignatures[$["saved-signatures"].value]?.strokes || [])
  drawSignature()
})
const signatureName=document.createElement('input');signatureName.id='signature-name';signatureName.placeholder='Signature or initials name';signatureName.setAttribute('aria-label','Signature name');$['saved-signatures'].after(signatureName)
const removeSignature=document.createElement('button');removeSignature.type='button';removeSignature.textContent='Remove saved signature';signatureName.after(removeSignature);removeSignature.onclick=()=>{const index=Number($['saved-signatures'].value);if($['saved-signatures'].value===''||!savedSignatures[index])return;savedSignatures.splice(index,1);documentStorage.setItem('elleson-signatures',JSON.stringify(savedSignatures));$['saved-signatures'].replaceChildren(new Option('New signature',''),...savedSignatures.map((item,index)=>new Option(item.name,index)))}
$["signature-insert"].addEventListener("click", async () => {
  if (!signatureStrokes.length) return
  let remembered = true
  if ($["signature-remember"].checked) {
    const next = [...savedSignatures, { name: signatureName.value.trim().slice(0,80)||new Date().toLocaleString(), strokes: structuredClone(signatureStrokes) }]
    try {
      documentStorage.setItem("elleson-signatures", JSON.stringify(next))
      savedSignatures = next
    } catch { remembered = false }
  }
  $["signature-dialog"].close()
  if(current?.lines){
    try {
      await suiteApp.pending()
      const doc=current
      const sheet=[...$['word-sheet'].querySelectorAll('section.docx')].find(el=>el.getBoundingClientRect().bottom>$.stage.getBoundingClientRect().top+40)
      const paragraph=sheet?.querySelector('[data-word-source-index]')
      if(!paragraph)throw Error('Choose a page containing text.')
      const strokes=structuredClone(signatureStrokes), color=$['ink-color'].value, thickness=Number($['ink-width'].value)
      const size=Math.min(Number($['signature-width'].value),sheet.offsetWidth)
      previewSignature({sheet,strokes,color,thickness,x:.08,y:.08,width:size/sheet.offsetWidth,height:size/(3*sheet.offsetHeight),fail,
        async commit(box) {
          if(current?.id!==doc.id)throw Error('Return to the signing document.')
          const width=box.width*sheet.offsetWidth,height=box.height*sheet.offsetHeight
          const ink={width,height,strokes:strokes.map(points=>({color,width:thickness,points:points.map(([x,y])=>[x*width,y*height])}))}
          const png=(await import('./ink-vectors.mjs')).inkPng(ink)
          await request('/api/word-image/'+doc.id,{method:'POST',headers:{'Content-Type':'application/json','X-Operation-Id':editId(),'X-Document-Version':String(doc.contentVersion),'X-Paragraph-Index':paragraph.dataset.wordSourceIndex},body:JSON.stringify({png,position:{x:box.x*sheet.offsetWidth,y:box.y*sheet.offsetHeight,width,height,ink}})})
          revision=-1
          await refresh()
        }})
    } catch(error){fail(error)}
  }else setMode("signature")
  if (!remembered) status("Tap to place the signature. Device storage could not retain it for reuse.")
})
$["replace-text"].addEventListener("submit", async event => {
  event.preventDefault()
  if (selectedSpan?.document === current?.id) {
    const success = await edit({ ...selectedSpan, kind: "replace", value: $.replacement.value, font: $["replacement-font"].value, layout: replacementLayout() })
    if (success) $["replace-dialog"].close()
    else $["replacement-error"].textContent = $.status.textContent
  }
})
$["preview-replacement"].addEventListener("click", async () => {
  try {
    const response = await postJson("/api/preview-text/" + current.id, { ...selectedSpan, value: $.replacement.value, font: $["replacement-font"].value, layout: replacementLayout() })
    const image = $["replacement-preview"]
    if (image.src.startsWith("blob:")) URL.revokeObjectURL(image.src)
    image.src = URL.createObjectURL(await response.blob())
    image.hidden = false
    $["replacement-error"].textContent = ""
  } catch (error) { $["replacement-error"].textContent = error.message }
})
function replacementLayout() {
  return { paragraph: $["replacement-paragraph"].checked, lines: Number($["replacement-lines"].value), width: Number($["replacement-width"].value) || undefined, height: Number($["replacement-height"].value) || undefined, spacing: Number($["replacement-spacing"].value), align: $["replacement-align"].value }
}
$["replacement-lines"].addEventListener("change", () => {
  if ($["replacement-paragraph"].checked) $.replacement.value = replacementRuns.slice(0, Number($["replacement-lines"].value)).map(span => span.text).join("\n")
})

let resizeTimer
new ResizeObserver(() => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => void renderPage(), 90)
}).observe($.stage)
const tools = installTools({ get: () => ({ current, page, zoom, viewport, mode, role, credential, selectedWordIndex, wordTarget, selectedSpan }),
  placeStamp: value => { pendingStamp = value; setMode('text'); status('Tap the PDF to place the selected mark.') },
  request, postJson, edit, editId, setMode, go, status, fail, refresh, renderWord,
  setView: (number, magnification) => { page = number || 1; zoom = magnification || 1 },
  pending: () => { flushWord(); return pendingEdit }, ensureSynced, invalidate: () => { revision = -1 },
  selectWord: index => { selectedWordIndex = index; layout() } })
$["share-as"].onclick = async () => {
  if (!current) return
  try {
    await pendingEdit
    const response = await request("/api/save/" + current.id + "?transfer=1"), blob = await response.blob()
    converter.open([new File([blob], current.filename.replace(/\.[^.]+$/, "." + (current.saveExtension || current.extension)), {type:blob.type})])
  } catch (error) { fail(error) }
}
const pdfDetail = installPdfDetail({stage:$.stage,sheet:$['pdf-sheet'],annotationMode:pdfjs.AnnotationMode.ENABLE_FORMS})
const readingView = installReadingView({ pdfjs, request, get: () => current, go, fail })
const wordPageSizing = installWordPageSizing($['word-sheet'], $.stage)
const wordInk = installWordInk({sheet:$['word-sheet'], toolbar:$['word-tools'], get:()=>current, request, editId, status, fail,
  pending:async()=>{document.activeElement?.blur();flushWord();await pendingEdit}, refresh:async(updated,defer)=>{localSequence++;if(updated&&current?.id===updated.id){current=updated;layout()}revision=-1;if(!defer)await renderWord()}, undoSaved:()=>edit({kind:'history-undo'}), sizing:wordPageSizing})
installDocumentGestures({stage:$.stage,sheet:$['word-sheet'],isActive:()=>Boolean(current?.lines)&&$.stage.dataset.filterPrint!=='true',canPan:()=>drawingSettings.stylusOnly||!$['word-sheet'].classList.contains('word-drawing'),cancelStroke:()=>wordInk.cancelStroke(),getZoom:wordPageSizing.getZoom,setZoom:wordPageSizing.setZoom,render:()=>wordPageSizing.fit()})
installWheelZoom({stage:$.stage,sheet:$['pdf-sheet'],isActive:()=>current?.extension==='pdf'&&!readingView.active&&!!viewport&&!draft,
  getZoom:()=>zoom,setZoom:value=>{zoom=value},render:renderPage,fail})
installWheelZoom({stage:$.stage,sheet:$['word-sheet'],isActive:()=>Boolean(current?.lines)&&!wordInk.drawing,
  getZoom:wordPageSizing.getZoom,setZoom:wordPageSizing.setZoom,render:wordPageSizing.fit,fail})
const sharedView = installSharedView({isDrawing:()=>Boolean(draft)||wordInk.drawing||editingWord,stage:$.stage, get:()=>current, request, editId, getParagraph:()=>selectedWordIndex,
  getReading:()=>readingView.active, pages:()=>readingView.active?readingView.pages():current?.extension==='pdf'?[$['pdf-sheet']]:[...$['word-sheet'].querySelectorAll('section.docx')],
  getPage:()=>page, getZoom:()=>readingView.active?readingView.getZoom():current?.extension==='pdf'?zoom:wordPageSizing.getZoom(),
  async setView(value){if(current?.extension==='pdf'){if(value.reading)return readingView.setView(value);if(readingView.active)await readingView.close();if(!pdf)return false;if(page!==value.page||Math.abs(zoom-value.zoom)>1e-6){page=Math.min(pdf.numPages,value.page);zoom=value.zoom;await renderPage()}}else{if(!$['word-sheet'].querySelector('section.docx'))return false;if(Math.abs(wordPageSizing.getZoom()-value.zoom)>1e-6)wordPageSizing.setZoom(value.zoom)}return true}
})
function receivePreview(state){
  if(state.previewSequence!==undefined&&state.previewSequence<remotePreviewSequence)return
  remotePreviewSequence=state.previewSequence??remotePreviewSequence
  remoteDraft=state.preview
  if(remoteDraft?.kind==='ink')inkArrivals.set(remoteDraft.id,performance.now()-160)
  wordInk.preview(remoteDraft,state.inkCommits)
  if(current?.extension==='pdf'&&JSON.stringify(remoteDraft)!==lastRemoteInk){lastRemoteInk=JSON.stringify(remoteDraft);drawMarks()}
}
installLiveInk({request,enabled:()=>Boolean(credential)&&location.hostname!=='appassets.androidplatform.net',receive:state=>{
  if(state.type==='preview')receivePreview(state)
  else if(state.type==='view')sharedView.receive(state.view)
  else if(state.type==='refresh')void refresh().then(()=>refresh())
}})
installUpdater()
installCompareView({pdfjs,app:{get:()=>({current}),request,pending:()=>pendingEdit,status}})
layout()
status(credential ? "Ready" : "Connecting to the PC…")
if (!credential && role !== "guest") setTimeout(() => { if (!credential) $["request-pair"].click() }, 600)
if (invitation) {
  sessionStorage.removeItem("elleson-collaboration")
  const join = document.createElement("dialog")
  join.className = "document-suite"
  join.innerHTML = '<h2>Join live collaboration</h2><form><label>Display name <input name="displayName" maxlength="60" required></label><p role="status"></p><button class="primary">Join document</button></form>'
  document.body.append(join)
  join.addEventListener("cancel", event => event.preventDefault())
  join.querySelector("form").onsubmit = async event => {
    event.preventDefault()
    event.submitter.disabled = true
    try {
      const result = await (await postJson("/api/collab-join", { invite: invitation, name: event.currentTarget.elements.namedItem("displayName").value.trim() })).json()
      credential = result.token
      sessionStorage.setItem("elleson-collaboration", credential)
      history.replaceState(null, "", "/")
      join.close()
      revision = -1
      await refresh()
    } catch (error) { join.querySelector("[role=status]").textContent = error.message }
    finally { event.submitter.disabled = false }
  }
  join.showModal()
}
window.addEventListener("elleson-open-file", event => void (async () => {
  if (location.hostname !== "appassets.androidplatform.net") return
  document.activeElement?.blur()
  await pendingEdit
  const bytes = Uint8Array.from(atob(event.detail.data), character => character.charCodeAt(0))
  const file=new File([bytes],event.detail.name,{type:event.detail.type||''})
  try{await importOpenedFile(file)}
  catch(error){if(error.status===422&&error.problem?.passwordRequired){lockedFile=file;askPassword();return}throw error}

})().catch(fail))
void refresh().then(async () => { window.EllesonAndroid?.ready?.(); await tools.acceptPendingHandoff() }).catch(fail)
setInterval(() => {if($.stage.dataset.navigating!=='true')void refresh()}, 500)
import { installCompactMenus } from './compact-menus.mjs'
installCompactMenus()
installDrawingSettings()
installDocumentFilters({get:()=>current,request,pdfjs,navigate:go,pending:async()=>{document.activeElement?.blur();flushWord();await pendingEdit},refresh:async()=>{revision=-1;await refresh()},fail})

installModernUI()
installSelectionTools($.stage)
installMobileNavigation({stage:$.stage,get:()=>current,getPage:()=>page,go,readingView})

installMobileShell({get:()=>current,stage:$.stage,getPage:()=>page,readingView})

installDocumentContext({get:()=>current,go,closeTab:id=>void closeTab(id).catch(fail),tools})

async function suiteEdit(change){const id=change.id||editId();const ok=await edit({...change,id});return ok&&queuedChanges.some(item=>item.change.id===id)?'queued':ok}
const suiteApp={get:()=>current,role:()=>role,viewport:()=>viewport,page:()=>page,request,edit:suiteEdit,editId,setMode,go,status,fail,pdfjs,renderWord,
 pending:async()=>{document.activeElement?.blur();flushWord();await pendingEdit},
 refresh:async()=>{revision=-1;await refresh()},
 open:async(name,bytes)=>{document.activeElement?.blur();flushWord();await pendingEdit;await request('/api/open',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(name)},body:bytes});revision=-1;await refresh()}}
const documentSuite=installDocumentSuite(suiteApp)
installPartialEraser({...suiteApp,pending:async()=>{await suiteApp.pending();if(current?.lines)await wordInk.pending()}})
const drawingSuite=installDrawingSuite(suiteApp,documentSuite)
installPdfFeatures(suiteApp,documentSuite,tools.download)
installCollaboration(suiteApp,documentSuite)
installCompanion({...suiteApp, selectedWord:()=>selectedWordIndex},documentSuite,drawingSuite)
installTapTools(suiteApp)
installWorkState({get:()=>current,mode:()=>mode})
document.body.append($.delivery)
const conflictHistory=installConflictHistory({get:()=>current,apply:edit,fail,storage:documentStorage})
restyleMoreMenu()

installQuickPen()

installPictures(suiteApp)
