export function installTools(app) {
  const $ = id => document.getElementById(id)
  const on = (id, event, handler) => $(id).addEventListener(event, (...args) => Promise.resolve(handler(...args)).catch(app.fail))
  const local = location.hostname === "appassets.androidplatform.net"
  for (const id of ["save-original", "handoff", "print"]) $("history-actions").append($(id))
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); $(event.shiftKey ? "save" : "save-original").click() }
  })
  const readBase64 = blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(",")[1]); reader.onerror = reject; reader.readAsDataURL(blob) })
  const download = async (response, name) => {
    const blob = await response.blob()
    if (window.EllesonAndroid) { window.EllesonAndroid.saveData(await readBase64(blob), name, "", ""); return }
    const link = document.createElement("a"), url = URL.createObjectURL(blob)
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 3000)
  }
  let selectedMark, pdfImages = [], reviewPlacement, reviewStart, comparisonId, wordSelection, accepting = false
  let scans = [], scanIndex = 0
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
    if (event.target === $("selection-edit")) return
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
    document.activeElement?.blur(); await app.pending()
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
    $("review-list").replaceChildren(...comments.map(comment => { const item = document.createElement("p"); item.textContent = (comment.replyTo ? "Reply · " : "") + comment.type + ": " + comment.text; return item }))
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

  document.addEventListener("selectionchange", () => {
    const selection = getSelection()
    if (!selection.rangeCount || selection.isCollapsed) return
    const range = selection.getRangeAt(0), node = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement
    const paragraph = node.closest("[data-word-index]")
    if (!paragraph || !$("word-sheet").contains(paragraph)) return
    const prefix = range.cloneRange(); prefix.selectNodeContents(paragraph); prefix.setEnd(range.startContainer, range.startOffset)
    wordSelection = { index: Number(paragraph.dataset.wordIndex), start: prefix.toString().length, end: prefix.toString().length + range.toString().length, document: app.get().current?.id }
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
      const key = control.dataset.mode || control.id || control.querySelector("[id]")?.id
      control.hidden = group !== "all" && (groups[key] || "view") !== group
    }
  }))
  async function showScan() {
    const item = scans[scanIndex]
    if (!item) return
    const image = $("scan-preview")
    if (image.src.startsWith("blob:")) URL.revokeObjectURL(image.src)
    image.src = URL.createObjectURL(item.file); image.style.transform = "rotate(" + item.angle + "deg)"
    $("scan-angle").value = item.angle; $("scan-angle-value").textContent = item.angle + "°"; $("scan-filter").value = item.filter
    $("scan-pages").replaceChildren(...scans.map((page, index) => {
      const button = document.createElement("button"); button.textContent = "Page " + (index + 1); button.setAttribute("aria-pressed", index === scanIndex)
      button.onclick = () => { saveScanSettings(); scanIndex = index; void showScan().catch(app.fail) }; return button
    }))
    const remove = document.createElement("button"); remove.textContent = "Remove page"; remove.disabled = scans.length <= 1
    remove.onclick = () => { scans.splice(scanIndex, 1); scanIndex = Math.min(scanIndex, scans.length - 1); void showScan().catch(app.fail) }
    $("scan-pages").append(remove)
    $("scan-corners").replaceChildren(...item.corners.map((point, index) => {
      const label = document.createElement("label"); label.textContent = ["Top left", "Top right", "Bottom right", "Bottom left"][index] + " (x%, y%)"
      const row = document.createElement("div"); row.className = "actions"
      for (let axis = 0; axis < 2; axis++) {
        const input = document.createElement("input"); input.type = "number"; input.min = 0; input.max = 100; input.step = .1; input.value = (point[axis] * 100).toFixed(1); input.setAttribute("aria-label", label.textContent + (axis ? " y" : " x"))
        input.oninput = () => { item.corners[index][axis] = Number(input.value) / 100 }; row.append(input)
      }
      label.append(row); return label
    }))
    if (!$("scan-dialog").open) $("scan-dialog").showModal()
  }
  function saveScanSettings() {
    const item = scans[scanIndex]
    if (item) { item.angle = Number($("scan-angle").value); item.filter = $("scan-filter").value }
  }
  on("scan-add", "click", () => { saveScanSettings(); $("scan-file").value = ""; $("scan-file").click() })
  on("scan-auto", "click", async () => {
    saveScanSettings(); const { detectCorners } = await import("./scan-runtime.mjs")
    scans[scanIndex].corners = await detectCorners(scans[scanIndex].file); await showScan()
    app.status("Page corners estimated. Review and adjust the crop before creating the PDF.")
  })
  return { updated: updateSelection, receiveHandoff, acceptPendingHandoff,
    selection: () => wordSelection,
    splitParagraph: async (index, offset) => { await wordAction({ action: "split", index, offset }); app.selectWord(index + 1); await app.renderWord(); $("word-sheet").querySelector('[data-word-index="' + (index + 1) + '"]')?.focus() },
    addScan: async file => { if (!$("scan-dialog").open) scans = []; if (scans.length >= 30) throw new Error("Keep at most 30 scan pages."); const { defaultCorners } = await import("./scan-runtime.mjs"); scans.push({ file, angle: 0, corners: defaultCorners(), filter: "document" }); scanIndex = scans.length - 1; await showScan() },
    clearScans: () => { scans = [] },
    createScan: async () => { saveScanSettings(); return (await import("./scan-runtime.mjs")).imagesToPdf(scans) } }
}
