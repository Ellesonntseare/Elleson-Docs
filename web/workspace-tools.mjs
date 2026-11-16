import { readScanDraft, storeScanDraft } from './scan-drafts.mjs'
import { installProductivity } from './productivity-tools.mjs'
import { installWordRibbon } from './word-ribbon.mjs'
export function installTools(app) {
  const $ = id => document.getElementById(id)
  const on = (id, event, handler) => $(id).addEventListener(event, (...args) => Promise.resolve(handler(...args)).catch(app.fail))
  const local = location.hostname === "appassets.androidplatform.net"
  on("new-document", "click", () => $("new-dialog").showModal())
  on("new-cancel", "click", () => $("new-dialog").close())
  on("new-form", "submit", async event => {
    event.preventDefault()
    const { wordBytes, textPdf } = await import("./conversion-runtime.mjs")
    const extension = $("new-type").value, text = $("new-text").value
    const name = $("new-name").value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\.(pdf|docx)$/i, "") || "Untitled"
    const bytes = extension === "pdf" ? await textPdf(text, {}) : await wordBytes(text)
    await app.request("/api/open", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(name + "." + extension) }, body: bytes })
    app.invalidate(); await app.refresh(); $("new-dialog").close()
    app.setMode(extension === "pdf" ? "text" : "word")
  })
  for (const id of ["save-original", "save-as", "share-as", "rename-document", "handoff", "print"]) $("history-actions").append($(id))
  on("save-as", "click", async () => {
    const state = app.get(); if (!state.current) { app.status("Open or create a document first."); return }
    await app.ensureSynced()
    if (window.desktopDocs) { const saved = await window.desktopDocs.save(state.current.id, { saveAs: true }); if (saved) { app.invalidate(); await app.refresh(); app.status("Copy saved") } else app.status("Save cancelled") }
    else $("save").click()
  })
  on("rename-document", "click", async () => {
    const state = app.get(); if (!state.current) return
    $("rename-name").value = state.current.filename; $("rename-error").textContent = ""
    $("rename-help").textContent = window.desktopDocs ? "Keep the current file extension. An existing file with this name will not be replaced." : "This changes the document name in Elleson Docs. Use Save As to create a file with this name."
    $("rename-dialog").dataset.document = state.current.id; $("rename-dialog").showModal()
  })
  on("rename-cancel", "click", () => $("rename-dialog").close())
  on("rename-form", "submit", async event => {
    event.preventDefault()
    const id = $("rename-dialog").dataset.document, name = $("rename-name").value.trim()
    if (app.get().current?.id !== id) { $("rename-error").textContent = "The active document changed. Close and try again."; return }
    try {
      await app.pending()
      if (window.desktopDocs?.rename) await window.desktopDocs.rename(id, name)
      else await app.postJson("/api/rename/" + id, { name })
      app.invalidate(); await app.refresh(); $("rename-dialog").close()
    } catch (error) { $("rename-error").textContent = error.message }
  })
  const compact = matchMedia("(max-width: 600px)")
  const extraActions = ["new-document", "convert-files", "open", "library", "connect", "find"].map(id => ({ element: $(id), marker: document.createComment(id) }))
  for (const item of extraActions) item.element.before(item.marker)
  const arrangeActions = () => { if (document.body.classList.contains("compact-menus")) return; for (const item of extraActions) { if (compact.matches) $("history-actions").append(item.element); else item.marker.after(item.element) } }
  compact.addEventListener("change", arrangeActions); arrangeActions()
  const welcomeActions = document.createElement("div"); welcomeActions.className = "welcome-actions"
  for (const [label, id] of [["New document", "new-document"], ["Scan document", "scan"], ["Convert files", "convert-files"], ["Recent documents", "library"]]) {
    const button = document.createElement("button"); button.textContent = label; button.onclick = () => $(id).click(); welcomeActions.append(button)
  }
  $("welcome").append(welcomeActions)
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); $(event.shiftKey ? "save" : "save-original").click() }
  })
  const readBase64 = blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(",")[1]); reader.onerror = reject; reader.readAsDataURL(blob) })
  on("protect-pdf", "click", () => { $("protect-form").reset(); $("protect-error").textContent = ""; $("protect-dialog").showModal() })
  on("protect-cancel", "click", () => { $("protect-form").reset(); $("protect-dialog").close() })
  on("protect-form", "submit", async event => {
    event.preventDefault()
    const password = $("protect-password").value, state = app.get()
    if (password !== $("protect-confirm").value) { $("protect-error").textContent = "Passwords do not match."; return }
    try {
      await app.pending()
      const response = await app.postJson("/api/protect/" + state.current.id, { password })
      const name = state.current.filename.replace(/\.pdf$/i, " - protected.pdf")
      if (window.desktopDocs?.saveConverted) await window.desktopDocs.saveConverted(name, Array.from(new Uint8Array(await response.arrayBuffer())))
      else await download(response, name)
      $("protect-form").reset(); $("protect-dialog").close()
    } catch (error) { $("protect-error").textContent = error.message }
  })
  const download = async (response, name) => {
    const blob = await response.blob()
    if (window.desktopDocs?.saveConverted) { await window.desktopDocs.saveConverted(name, Array.from(new Uint8Array(await blob.arrayBuffer()))); return }
    if (window.EllesonAndroid) { window.EllesonAndroid.saveData(await readBase64(blob), name, "", ""); return }
    const link = document.createElement("a"), url = URL.createObjectURL(blob)
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 3000)
  }
  installProductivity({ ...app, download })
  let selectedMark, pdfImages = [], reviewPlacement, reviewStart, comparisonId, wordSelection, accepting = false
  let scans = [], scanIndex = 0
  const resumeScan = document.createElement('button'); resumeScan.id = 'resume-scan'; resumeScan.textContent = 'Resume captured scan'; resumeScan.hidden = true; $('history-actions').append(resumeScan)
  let recoveredScan
  const scanReady = readScanDraft().then(saved => { recoveredScan = saved; resumeScan.hidden = !saved?.scans?.length }).catch(app.fail)
  const retainScan = () => { resumeScan.hidden = !scans.length; return storeScanDraft({scans,scanIndex}).catch(error => { app.status('Scan recovery storage is unavailable. Keep this window open.'); throw error }) }
  resumeScan.onclick = async () => { await scanReady; if (!scans.length && recoveredScan?.scans?.length) { scans = recoveredScan.scans; scanIndex = Math.min(recoveredScan.scanIndex || 0, scans.length - 1) }; await showScan() }

  const crop=document.createElement('div');crop.id='scan-crop';crop.innerHTML='<img alt="Original photo — drag corners to crop"><div class="crop-handles"></div>'
  $('scan-preview').before(crop)
  let cropUrl
  let replacingScan=false
  const retake=document.createElement('button');retake.textContent='Retake or replace this page';retake.onclick=()=>{replacingScan=true;$('scan-file').value='';$('scan-file').click()};$('scan-add').after(retake)
  const importScans=document.createElement('input');importScans.type='file';importScans.accept='image/*';importScans.multiple=true;importScans.hidden=true;const importButton=document.createElement('button');importButton.textContent='Add photos from gallery';importButton.onclick=()=>importScans.click();importScans.onchange=async()=>{try{saveScanSettings();for(const file of importScans.files)await addScanFile(file)}catch(error){app.fail(error)}finally{importScans.value=''}};$('scan-add').after(importButton,importScans)
  const scanQuality=document.createElement('p');scanQuality.setAttribute('role','status');$('scan-preview').after(scanQuality)
  async function checkPhoto(file){
    const bitmap=await createImageBitmap(file),canvas=document.createElement('canvas');canvas.width=200;canvas.height=Math.max(20,Math.round(200*bitmap.height/bitmap.width));const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close()
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let light=0,edges=0
    for(let i=0;i<pixels.length;i+=4){light+=(pixels[i]+pixels[i+1]+pixels[i+2])/3;if(i>=4)edges+=Math.abs(pixels[i]-pixels[i-4])}
    light/=pixels.length/4;edges/=pixels.length/4
    scanQuality.textContent=light<65?'This photo looks dark. Review the text or retake with more light.':edges<2?'This photo has little detail. Check focus and text clarity before saving.':'Review the crop and text clarity before creating the PDF.'
  }
  const drawCrop=()=>{
    const item=scans[scanIndex];if(!item)return
    crop.querySelector('.crop-handles').replaceChildren(...item.corners.map((point,index)=>{
      const handle=document.createElement('button');handle.type='button';handle.className='crop-handle';handle.textContent=String(index+1);handle.setAttribute('aria-label','Crop corner '+(index+1));handle.style.left=point[0]*100+'%';handle.style.top=point[1]*100+'%'
      handle.onpointerdown=event=>{event.preventDefault();handle.setPointerCapture(event.pointerId)}
      handle.onpointermove=event=>{if(!handle.hasPointerCapture(event.pointerId))return;const r=crop.getBoundingClientRect();item.corners[index]=[Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))];handle.style.left=item.corners[index][0]*100+'%';handle.style.top=item.corners[index][1]*100+'%'}
      handle.onpointerup=()=>void showScan().catch(app.fail)
      return handle
    }))
  }
  const handledHandoffs = new Set()
  const selected = () => {
    const state = app.get(), mark = state.current?.marks.find(mark => mark.id === selectedMark)
    return mark ? state.current.marks.filter(item => mark.group ? item.group === mark.group : item.id === mark.id) : []
  }
  const markBounds = marks => {
    const points = marks.flatMap(mark => {
      if (mark.kind !== "text") return mark.points
      const width = Math.max(mark.size, mark.value.length * mark.size * .55), angle = (mark.angle || 0) * Math.PI / 180
      return [[0, 0], [width, 0], [width, mark.size], [0, mark.size]].map(([x, y]) => [mark.at[0] + x * Math.cos(angle) - y * Math.sin(angle), mark.at[1] + x * Math.sin(angle) + y * Math.cos(angle)])
    })
    return [Math.min(...points.map(point => point[0])), Math.min(...points.map(point => point[1])), Math.max(...points.map(point => point[0])), Math.max(...points.map(point => point[1]))]
  }
  function updateSelection() {
    const state = app.get(), marks = selected(), box = $("selection-box")
    box.hidden = state.mode !== "select" || !state.viewport || !marks.length || marks[0].page !== state.page
    if (box.hidden) return
    const bounds = markBounds(marks), a = state.viewport.convertToViewportPoint(...bounds.slice(0, 2)), b = state.viewport.convertToViewportPoint(...bounds.slice(2))
    Object.assign(box.style, { left: Math.min(a[0], b[0]) - 5 + "px", top: Math.min(a[1], b[1]) - 5 + "px", width: Math.max(24, Math.abs(a[0] - b[0])) + 10 + "px", height: Math.max(24, Math.abs(a[1] - b[1])) + 10 + "px" })
  }
  // A tap on existing ink selects it directly in normal PDF reading and editing modes.
  const pdfSheet=$("pdf-sheet")
  let inkTap, suppressInkClick
  function inkAt(clientX,clientY){
    const state=app.get()
    if(!state.viewport||state.current?.extension!=="pdf")return
    const rect=$("ink-canvas").getBoundingClientRect()
    const viewport=state.viewport
    const x=clientX-rect.left,y=clientY-rect.top
    return state.current?.marks.findLast(mark=>{
      if(mark.kind!=="ink"||mark.page!==state.page)return false
      const radius=Math.max(12,(mark.width||1.7)*viewport.scale/2+6)
      return mark.points.some((point,index)=>{
        const [ax,ay]=viewport.convertToViewportPoint(...(mark.points[index-1]||point))
        const [bx,by]=viewport.convertToViewportPoint(...point)
        const dx=bx-ax,dy=by-ay,distance=dx*dx+dy*dy
        const t=distance?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/distance)):0
        return Math.hypot(x-ax-t*dx,y-ay-t*dy)<=radius
      })
    })
  }
  function selectInk(mark){
    selectedMark=mark.id
    app.setMode("select")
    updateSelection()
  }
  pdfSheet.addEventListener("pointerdown",event=>{
    if(event.isPrimary&&event.button===0)inkTap={id:event.pointerId,x:event.clientX,y:event.clientY}
  },true)
  pdfSheet.addEventListener("pointercancel",()=>{inkTap=null},true)
  pdfSheet.addEventListener("click",event=>{
    if(!suppressInkClick||performance.now()-suppressInkClick.time>650)return
    if(Math.hypot(event.clientX-suppressInkClick.x,event.clientY-suppressInkClick.y)>10)return
    suppressInkClick=null
    event.preventDefault()
    event.stopImmediatePropagation()
  },true)
  pdfSheet.addEventListener("pointerup",event=>{
    const tap=inkTap
    inkTap=null
    if(tap?.id!==event.pointerId||Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>8)return
    const state=app.get()
    if(!state.viewport||!["read","edit"].includes(state.mode))return
    if(event.target.closest("input,select,textarea,#selection-box"))return
    const hit=inkAt(event.clientX,event.clientY)
    if(!hit)return
    event.preventDefault()
    event.stopImmediatePropagation()
    suppressInkClick={x:event.clientX,y:event.clientY,time:performance.now()}
    selectInk(hit)
  },true)
  on("ink-canvas", "pointerdown", async event => {
    const state = app.get()
    if (!state.viewport) return
    const rect = $("ink-canvas").getBoundingClientRect(), point = state.viewport.convertToPdfPoint(event.clientX - rect.left, event.clientY - rect.top)
    if (state.mode === "select") {
      const hit = [...state.current.marks].reverse().find(mark => {
        if (mark.page !== state.page) return false
        const group = state.current.marks.filter(item => mark.group ? item.group === mark.group : item.id === mark.id), box = markBounds(group)
        return point[0] >= box[0] - 10 && point[0] <= box[2] + 10 && point[1] >= box[1] - 10 && point[1] <= box[3] + 10
      })
      selectedMark = hit?.id; updateSelection()
    } else if (state.mode === "review" && reviewPlacement) {
      reviewStart = point
      $("ink-canvas").setPointerCapture(event.pointerId)
    }
  })
  on("ink-canvas", "pointerup", async event => {
    if (!reviewStart || !reviewPlacement) return
    const state = app.get(), rect = $("ink-canvas").getBoundingClientRect(), end = state.viewport.convertToPdfPoint(event.clientX - rect.left, event.clientY - rect.top)
    const start = reviewStart; reviewStart = null
    const bounds = reviewPlacement.type === "Text" ? [start[0], start[1], start[0] + 22, start[1] + 22] : [Math.min(start[0], end[0]), Math.min(start[1], end[1]), Math.max(start[0], end[0]), Math.max(start[1], end[1])]
    if (bounds[2] - bounds[0] < 2 || bounds[3] - bounds[1] < 2) throw new Error("Drag across the words to mark up.")
    await app.edit({ kind: "review", page: state.page, version: state.current.contentVersion, ...reviewPlacement, rect: bounds })
    reviewPlacement = null; app.setMode("read")
  })
  on("selection-edit", "click", () => {
    const mark = selected()[0]
    if (!mark) return
    $("mark-x").value = "0"; $("mark-y").value = "0"; $("mark-scale").value = "1"; $("mark-angle").value = "0"
    $("mark-value").value = mark.value || ""; $("mark-value").disabled = mark.kind !== "text"
    $("mark-dialog").showModal()
  })
  for (const action of ["apply", "duplicate", "delete"]) on("mark-" + action, "click", async () => {
    await app.edit({ kind: "transform", target: selectedMark, action, dx: Number($("mark-x").value) + (action === "duplicate" ? 15 : 0), dy: Number($("mark-y").value), scale: Number($("mark-scale").value), angle: Number($("mark-angle").value), value: $("mark-value").disabled ? undefined : $("mark-value").value })
    $("mark-dialog").close(); updateSelection()
  })
  let dragging
  on("selection-box", "pointerdown", event => {
    if (event.target === $("selection-edit") || event.button!==0) return
    const box = $("selection-box")
    box.setPointerCapture(event.pointerId)
    dragging = { pointer: event.pointerId, x: event.clientX, y: event.clientY, resize: event.target === $("selection-resize"), width: box.getBoundingClientRect().width }
  })
  on("selection-box", "pointermove", event => {
    if (!dragging || event.pointerId !== dragging.pointer) return
    $("selection-box").style.transform = dragging.resize ? "scale(" + Math.max(.1, Math.min(10, 1 + (event.clientX - dragging.x) / dragging.width)) + ")" : "translate(" + (event.clientX - dragging.x) + "px," + (event.clientY - dragging.y) + "px)"
  })
  on("selection-box", "pointerup", async event => {
    if (!dragging || event.pointerId !== dragging.pointer) return
    const drag = dragging; dragging = null
    $("selection-box").style.transform = ""
    if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<3)return
    const viewport = app.get().viewport, a = viewport.convertToPdfPoint(drag.x, drag.y), b = viewport.convertToPdfPoint(event.clientX, event.clientY)
    await app.edit({ kind: "transform", target: selectedMark, action: "apply", dx: drag.resize ? 0 : b[0] - a[0], dy: drag.resize ? 0 : b[1] - a[1], scale: drag.resize ? Math.max(.1, Math.min(10, 1 + (event.clientX - drag.x) / drag.width)) : 1 })
    updateSelection()
  })
  on("selection-box", "pointercancel", () => { dragging = null; $("selection-box").style.transform = "" })

  on("handoff", "click", async () => {
    await app.pending()
    const state = app.get()
    if (window.EllesonAndroid) {
      const response = await app.request("/api/save/" + state.current.id + "?transfer=1")
      const name = state.current.filename.replace(/\.[^.]+$/, "") + "." + state.current.saveExtension
      window.EllesonAndroid.handoff(await readBase64(await response.blob()), name, state.page, state.zoom, local)
    } else {
      await app.postJson("/api/handoff", { target: "phone", page: state.page, zoom: state.zoom, standalone: true })
      app.status("Handoff sent to the paired phone. Keep the PC open until the phone receives it.")
    }
  })
  async function acceptPendingHandoff() {
    if (!window.EllesonAndroid?.pendingHandoff || accepting) return
    const raw = window.EllesonAndroid.pendingHandoff()
    if (!raw) return
    let packet
    try { packet = JSON.parse(raw) }
    catch { window.EllesonAndroid.finishHandoff(); throw new Error("The handoff was incomplete. Your original document is still available; try handoff again.") }
    if ((packet.target === "phone") !== local || !app.get().credential) return
    accepting = true
    try {
      const bytes = Uint8Array.from(atob(packet.data), char => char.charCodeAt(0))
      await app.request("/api/open", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(packet.name) }, body: new Blob([bytes]) })
      app.invalidate(); await app.refresh(); app.setView(packet.page, packet.zoom)
      if (!local) await app.postJson("/api/handoff", { target: "pc", page: packet.page, zoom: packet.zoom })
      window.EllesonAndroid.finishHandoff()
      app.status("Document received with its latest edits.")
    } finally { accepting = false }
  }
  async function receiveHandoff(packet) {
    if (handledHandoffs.has(packet.id) || packet.document !== app.get().current?.id) return
    handledHandoffs.add(packet.id)
    app.setView(packet.page, packet.zoom); app.go(packet.page)
    if (packet.standalone && window.EllesonAndroid) {
      await app.pending()
      const state = app.get(), response = await app.request("/api/save/" + state.current.id + "?transfer=1")
      window.EllesonAndroid.handoff(await readBase64(await response.blob()), state.current.filename.replace(/\.[^.]+$/, "") + "." + state.current.saveExtension, packet.page, packet.zoom, false)
    }
  }
  on("save-original", "click", async () => {
    document.activeElement?.blur(); await app.ensureSynced()
    const state = app.get()
    if (!state.current) return
    if (window.desktopDocs) {
      const result = await window.desktopDocs.saveOriginal(state.current.id)
      if (result?.chooseCopy) $("save").click()
      else if (result?.saved) app.status("Saved to " + result.destination)
      else app.status("Save cancelled")
      app.invalidate(); await app.refresh(); return
    }
    if (window.EllesonAndroid?.saveOriginalData) {
      const response = await app.request("/api/save/" + state.current.id + (local ? "?transfer=1" : "?ack=1"))
      const name = state.current.filename.replace(/\.[^.]+$/, "") + "." + state.current.saveExtension
      const accepted = window.EllesonAndroid.saveOriginalData(await readBase64(await response.blob()), name, state.current.id, response.headers.get("X-Elleson-Revision") || "0", response.headers.get("X-Elleson-Save-Receipt") || "")
      if (!accepted) $("save").click()
    } else $("save").click()
  })
  window.addEventListener("elleson-save-ack", event => void (async () => {
    if (local) window.dispatchEvent(new CustomEvent("elleson-local-saved", { detail: event.detail }))
    else if (event.detail.receipt) await app.postJson("/api/saved/" + event.detail.receipt, {})
    app.invalidate(); await app.refresh()
  })().catch(app.fail))

  on("storage", "click", async () => {
    const stats = await (await app.request("/api/storage")).json()
    $("storage-details").textContent = stats.documents + " documents · " + stats.versions + " versions · " + (stats.bytes / 1048576).toFixed(1) + " MB. " + (stats.warning || stats.recoveryWarning || "")
    $("version-limit").value = stats.limit; $("storage-dialog").showModal()
  })
  on("storage-apply", "click", async () => {
    if (!confirm("Remove older versions beyond this limit? Export a backup first if you need them.")) return
    await app.postJson("/api/storage", { limit: Number($("version-limit").value) }); $("storage-dialog").close(); app.status("Version retention updated.")
  })
  on("backup-export", "click", async () => download(await app.request("/api/backup"), "Elleson Docs backup.zip"))
  let libraryScheduled = false
  const observer = new MutationObserver(() => {
    if (libraryScheduled) return
    libraryScheduled = true
    void (async () => {
      const records = await (await app.request("/api/library")).json()
      const rows = [...$("library-list").children]
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index], record = records[index]
        if (!record || row.dataset.extended) continue
        row.dataset.extended = "true"
        const compare = document.createElement("button"); compare.textContent = "Compare versions"
        compare.disabled = record.versionCount < 2
        compare.onclick = () => void (async () => {
          comparisonId = record.id
          const versions = await (await app.request("/api/library/" + record.id + "/versions")).json()
          for (const id of ["compare-left", "compare-right"]) $(id).replaceChildren(...versions.map(version => new Option(new Date(version.date).toLocaleString() + " · " + version.filename, version.id)))
          $("compare-left").selectedIndex = Math.min(1, versions.length - 1); $("compare-result").replaceChildren(); $("compare-dialog").showModal()
        })().catch(app.fail)
        const remove = document.createElement("button"); remove.textContent = "Remove from library"
        remove.onclick = () => void (async () => {
          if (!confirm("Remove this document and its saved versions from the library? Exported original files are kept.")) return
          await app.request("/api/library/" + record.id, { method: "DELETE" }); row.remove()
        })().catch(app.fail)
        row.append(compare, remove)
      }
    })().catch(app.fail).finally(() => { libraryScheduled = false })
  })
  observer.observe($("library-list"), { childList: true })
  on("compare-run", "click", async () => {
    const result = await (await app.request("/api/library/" + comparisonId + "/compare?left=" + $("compare-left").value + "&right=" + $("compare-right").value)).json()
    const lines = result.map(side => side.text.split("\n")), output = []
    for (let side = 0; side < 2; side++) {
      const column = document.createElement("section"), title = document.createElement("h3")
      title.textContent = result[side].filename + (result[side].pages ? " · " + result[side].pages + " pages" : "")
      column.append(title)
      if (result[side].limited) column.append("Text comparison is limited to the first 200 pages.")
      lines[side].forEach((line, index) => { const paragraph = document.createElement("p"); paragraph.textContent = line || " "; if (line !== lines[1 - side][index]) paragraph.className = "changed"; column.append(paragraph) })
      output.push(column)
    }
    $("compare-result").replaceChildren(...output)
  })
  on("review", "click", async () => {
    const state = app.get(), comments = await (await app.request("/api/review/" + state.current.id + "/" + state.page)).json()
    $("review-parent").replaceChildren(new Option("New comment", ""), ...comments.map(comment => new Option(comment.text.slice(0, 70) || comment.type, comment.id)))
    $("review-list").replaceChildren(...comments.map(comment => {
      const item = document.createElement("p"), label=document.createElement('span'); label.textContent = (comment.replyTo ? "Reply · " : "") + comment.type + ": " + comment.text; item.append(label)
      const toggle = document.createElement('button'); toggle.textContent = comment.resolved ? 'Reopen comment' : 'Resolve comment'
      toggle.onclick = async () => { try { const latest=app.get(); await app.edit({kind:'review',action:'resolve',target:comment.id,resolved:!comment.resolved,page:state.page,version:latest.current.contentVersion}); $('review-dialog').close(); $('review').click() } catch(error) { app.fail(error) } }
      item.append(toggle); return item
    }))
    $("review-dialog").showModal()
  })
  on("review-place", "click", () => {
    reviewPlacement = { type: $("review-type").value, text: $("review-text").value, replyTo: $("review-parent").value || undefined }
    $("review-dialog").close(); app.setMode("review"); app.status("Tap to place a note, or drag a rectangle across the words for markup.")
  })
  on("pdf-image", "click", async () => {
    const state = app.get()
    pdfImages = await (await app.request("/api/pdf-images/" + state.current.id + "/" + state.page)).json()
    $("pdf-image-target").replaceChildren(new Option("Insert a new image", ""), ...pdfImages.map(image => new Option("Replace image " + (image.id + 1), image.id)))
    $("pdf-image-dialog").showModal()
  })
  on("pdf-image-target", "change", () => {
    if ($("pdf-image-target").value === "") return
    const image = pdfImages[Number($("pdf-image-target").value)]
    for (const [id, value] of [["x", image.rect[0]], ["y", image.rect[1]], ["width", image.rect[2] - image.rect[0]], ["height", image.rect[3] - image.rect[1]]]) $("pdf-image-" + id).value = Math.round(value)
  })
  on("pdf-image-pick", "click", () => $("pdf-image-file").click())
  on("pdf-image-file", "change", async () => {
    const file = $("pdf-image-file").files[0], state = app.get()
    if (!file) return
    const x = Number($("pdf-image-x").value), y = Number($("pdf-image-y").value)
    await app.request("/api/pdf-image/" + state.current.id, { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Image-Edit": JSON.stringify({ id: app.editId(), version: state.current.contentVersion, page: state.page,
      replace: $("pdf-image-target").value === "" ? undefined : Number($("pdf-image-target").value), rect: [x, y, x + Number($("pdf-image-width").value), y + Number($("pdf-image-height").value)] }) }, body: file })
    $("pdf-image-dialog").close(); $("pdf-image-file").value = ""; app.invalidate(); await app.refresh()
  })

  let selectionToolbar = false
  document.addEventListener('pointerdown', event => {
    selectionToolbar = Boolean(event.target.closest('#toolbar, .tool-menu, #word-format-dialog'))
    if (event.target.closest('#word-sheet')) { selectionToolbar = false; wordSelection = null }
  }, true)
  document.addEventListener('keydown', event => {
    if (event.target.closest('#word-sheet')) {
      if (event.key === 'Escape' || event.ctrlKey || event.metaKey || event.altKey) return
      selectionToolbar = event.key === 'Tab'
      if (!selectionToolbar) wordSelection = null
    }
  }, true)
  document.addEventListener("selectionchange", () => {
    const selection = getSelection()
    if (!selection.rangeCount || selection.isCollapsed) { if (!selectionToolbar) wordSelection = null; return }
    const range = selection.getRangeAt(0), node = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement
    const paragraph = node.closest("[data-word-index]")
    if (!paragraph || !$("word-sheet").contains(paragraph)) {
      if (!document.activeElement?.closest('#word-ribbon, #word-format-dialog, .tool-menu')) wordSelection = null
      return
    }
    const prefix = range.cloneRange(); prefix.selectNodeContents(paragraph); prefix.setEnd(range.startContainer, range.startOffset)
    wordSelection = { index: Number(paragraph.dataset.wordIndex), start: prefix.toString().length, end: prefix.toString().length + range.toString().length, document: app.get().current?.id, version: app.get().current?.contentVersion }
  })
  const wordAction = async change => {
    document.activeElement?.blur(); await app.pending()
    const state = app.get()
    if (state.selectedWordIndex === null) throw new Error("Select a paragraph first.")
    if (await app.edit({ kind: "word-tools", index: state.selectedWordIndex, version: state.current.contentVersion, ...change })) {
      $("word-tools-dialog").close(); await app.renderWord()
    }
  }
  on("word-more", "click", () => $("word-tools-dialog").showModal())
  document.querySelectorAll("[data-word-action]").forEach(button => button.addEventListener("click", () => void wordAction({ action: button.dataset.wordAction }).catch(app.fail)))
  on("word-image-resize", "click", () => wordAction({ action: "image-size", width: Number($("word-image-width").value) }))
  on("word-header-footer", "click", () => wordAction({ action: "header-footer", header: $("word-header").value, footer: $("word-footer").value, pageNumbers: $("word-page-numbers").checked }))

  document.querySelectorAll("[data-group]").forEach(button => button.addEventListener("click", () => {
    const group = button.dataset.group
    for (const other of document.querySelectorAll("[data-group]")) other.setAttribute("aria-pressed", other === button)
    const groups = {
      read: "view", edit: "edit", text: "fill", pen: "fill", highlight: "fill", erase: "fill", select: "fill", recognize: "scan", "ocr-language": "scan", signature: "fill", organize: "pages", "ink-color": "fill", "ink-width": "fill", undo: "fill", "pdf-image": "edit", review: "edit"
    }
    for (const control of $("pdf-tools").children) {
      if (control.id === "drawing-done") continue
      const key = control.dataset.mode || control.id || control.querySelector("[id]")?.id
      control.hidden = group !== "all" && (groups[key] || "view") !== group
    }
  }))
  let scanPreviewSequence = 0
  async function previewScan() {
    const item = scans[scanIndex], sequence = ++scanPreviewSequence
    if (!item) return
    const image = $("scan-preview")
    image.setAttribute('aria-busy', 'true')
    let replacement
    try {
      await checkPhoto(item.file)
      const { prepareImage } = await import("./scan-runtime.mjs")
      const blob = await prepareImage(item.file, item)
      replacement = URL.createObjectURL(blob)
      const decoded = new Image(); decoded.src = replacement; await decoded.decode()
      if (sequence !== scanPreviewSequence || item !== scans[scanIndex] || !$("scan-dialog").open) return
      const previous = image.src
      image.src = replacement; replacement = null; image.style.transform = "none"
      await image.decode()
      if (previous.startsWith('blob:')) URL.revokeObjectURL(previous)
    } finally {
      if (replacement) URL.revokeObjectURL(replacement)
      if (sequence === scanPreviewSequence) image.setAttribute('aria-busy', 'false')
    }
  }
  async function showScan() {
    await retainScan()
    const item = scans[scanIndex]
    if (!item) return
    if(cropUrl)URL.revokeObjectURL(cropUrl);cropUrl=URL.createObjectURL(item.file);crop.querySelector('img').src=cropUrl;drawCrop()
    const image = $("scan-preview")
    image.setAttribute('aria-busy', 'true')
    if (image.src.startsWith("blob:")) URL.revokeObjectURL(image.src)
    image.src = URL.createObjectURL(item.file); image.style.transform = "rotate(" + item.angle + "deg)"
    $("scan-angle").value = item.angle; $("scan-angle-value").textContent = item.angle + "°"; $("scan-filter").value = item.filter
    for (const key of ["brightness", "contrast", "sharpness", "whitening"]) $("scan-" + key).value = item[key] || 0
    $("scan-pages").replaceChildren(...scans.map((page, index) => {
      const button = document.createElement("button"); button.textContent = "Page " + (index + 1); button.setAttribute("aria-pressed", index === scanIndex)
      const thumbnail=document.createElement('img');thumbnail.alt='';thumbnail.src=URL.createObjectURL(page.file);thumbnail.onload=()=>URL.revokeObjectURL(thumbnail.src);thumbnail.style.cssText='width:52px;height:64px;object-fit:contain;display:block';button.prepend(thumbnail)
      button.draggable=true;button.ondragstart=event=>event.dataTransfer.setData('text/x-scan-index',String(index));button.ondragover=event=>event.preventDefault();button.ondrop=event=>{event.preventDefault();const value=event.dataTransfer.getData('text/x-scan-index');if(!/^\d+$/.test(value))return;const from=Number(value);if(from>=scans.length)return;saveScanSettings();const [moved]=scans.splice(from,1);scans.splice(index,0,moved);scanIndex=index;void showScan().catch(app.fail)}
      button.onclick = () => { saveScanSettings(); scanIndex = index; void showScan().catch(app.fail) }; return button
    }))
    const remove = document.createElement("button"); remove.textContent = "Remove page"; remove.disabled = scans.length <= 1
    remove.onclick = () => { scans.splice(scanIndex, 1); scanIndex = Math.min(scanIndex, scans.length - 1); void showScan().catch(app.fail) }
    $("scan-pages").append(remove)
    for(const [label,delta] of [['Move earlier',-1],['Move later',1]]){
      const b=document.createElement('button');b.textContent=label;b.disabled=!scans[scanIndex+delta];b.onclick=()=>{saveScanSettings();[scans[scanIndex],scans[scanIndex+delta]]=[scans[scanIndex+delta],scans[scanIndex]];scanIndex+=delta;void showScan().catch(app.fail)};$('scan-pages').append(b)
    }
    $("scan-corners").replaceChildren(...item.corners.map((point, index) => {
      const label = document.createElement("label"); label.textContent = ["Top left", "Top right", "Bottom right", "Bottom left"][index] + " (x%, y%)"
      const row = document.createElement("div"); row.className = "actions"
      for (let axis = 0; axis < 2; axis++) {
        const input = document.createElement("input"); input.type = "number"; input.min = 0; input.max = 100; input.step = .1; input.value = (point[axis] * 100).toFixed(1); input.setAttribute("aria-label", label.textContent + (axis ? " y" : " x"))
        input.oninput = () => { item.corners[index][axis] = Number(input.value) / 100; void retainScan().catch(app.fail) }; row.append(input)
      }
      label.append(row); return label
    }))
    if (!$("scan-dialog").open) $("scan-dialog").showModal()
    await previewScan()
  }
  function saveScanSettings() {
    const item = scans[scanIndex]
    if (item) { item.angle = Number($("scan-angle").value); item.filter = $("scan-filter").value }
    if (item) for (const key of ["brightness", "contrast", "sharpness", "whitening"]) item[key] = Number($("scan-" + key).value)
    if (item) void retainScan().catch(app.fail)
  }
  for (const key of ["filter", "angle", "brightness", "contrast", "sharpness", "whitening"]) on("scan-" + key, "change", async () => { saveScanSettings(); await previewScan() })
  on("scan-reset", "click", async () => { const item = scans[scanIndex]; Object.assign(item, { filter: "photo", angle: 0, brightness: 0, contrast: 0, sharpness: 0, whitening: 0, corners: [[0,0],[1,0],[1,1],[0,1]] }); await showScan() })
  on("scan-apply-all", "click", async () => { saveScanSettings(); const source = scans[scanIndex]; for (const item of scans) for (const key of ["filter", "brightness", "contrast", "sharpness", "whitening"]) item[key] = source[key]; app.status("Filter settings applied to all scan pages.") })
  on("scan-add", "click", () => { saveScanSettings(); $("scan-file").value = ""; $("scan-file").click() })
  on("scan-auto", "click", async () => {
    saveScanSettings(); const { detectCorners } = await import("./scan-runtime.mjs")
    scans[scanIndex].corners = await detectCorners(scans[scanIndex].file); await showScan()
    app.status("Page corners estimated. Review and adjust the crop before creating the PDF.")
  })
  async function addScanFile(file) { await scanReady; if (!$("scan-dialog").open && !scans.length && recoveredScan?.scans?.length) { scans = recoveredScan.scans; scanIndex = recoveredScan.scanIndex || 0; recoveredScan = null } if (!$("scan-dialog").open) {replacingScan=false} if (scans.length >= 30&&!replacingScan) throw new Error("Keep at most 30 scan pages."); const { detectCorners } = await import("./scan-runtime.mjs"); app.status("Detecting page edges…"); const item={file,angle:0,corners:await detectCorners(file),filter:'document'};if(replacingScan&&scans[scanIndex])scans[scanIndex]=item;else{scans.push(item);scanIndex=scans.length-1}replacingScan=false;await showScan() }
  installWordRibbon({...app,selection:()=>wordSelection})
  return { updated: updateSelection, inkAt, selectInk, receiveHandoff, acceptPendingHandoff,
    selection: () => wordSelection,
    splitParagraph: async (index, offset) => { await wordAction({ action: "split", index, offset }); app.selectWord(index + 1); await app.renderWord(); $("word-sheet").querySelector('[data-word-index="' + (index + 1) + '"]')?.focus() },
    addScan: addScanFile,
    clearScans: () => { scans = []; recoveredScan = null; void retainScan().catch(app.fail) },
    createScan: async () => { saveScanSettings(); await retainScan(); return (await import("./scan-runtime.mjs")).imagesToPdf(scans) } }
}
