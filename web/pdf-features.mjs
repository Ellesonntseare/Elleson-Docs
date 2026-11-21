const profileNames = {
  Name: /^(name|full\s*name|applicant\s*name|customer\s*name|your\s*name)$/i,
  Address: /^(address|street\s*address|postal\s*address|mailing\s*address)$/i,
  Email: /^(email|e\s*mail|email\s*address)$/i,
  Phone: /^(phone|telephone|mobile|cellphone|phone\s*number|contact\s*number)$/i
}

const element = (tag, label) => Object.assign(document.createElement(tag), label === undefined ? {} : { textContent: label })
function readProfile() {
  try { return JSON.parse(localStorage.getItem("elleson-profile")) || {} }
  catch { return {} }
}
const complete = value => Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim().length > 0 : value === true
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const json = (app, url, body) => app.request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

export function installPdfFeatures(app, hub, download) {
  const statusDialog = (id, title) => {
    const dialog = hub.dialog(id, title)
    const status = hub.message(dialog)
    return { dialog, status }
  }
  function activePdf() {
    const doc = app.get()
    if (doc?.extension !== "pdf") throw new Error("Open a PDF first.")
    return doc
  }
  const form = statusDialog("form-workspace", "PDF form tools")
  const panel = element("div")
  form.dialog.append(panel)
  let source, fields = []
  async function openForm() {
    await app.pending()
    source = activePdf()
    fields = await (await app.request("/api/form-fields/" + source.id)).json()
    if (app.get()?.id !== source.id) throw new Error("The active document changed.")
    showFields()
    if (!form.dialog.open) form.dialog.showModal()
  }
  async function change(changes) {
    await app.pending()
    if (app.get()?.id !== source.id || app.get().contentVersion !== source.contentVersion) throw new Error("The document changed. Reopen PDF form tools.")
    const result = await app.edit({ kind: "form-author", changes, version: source.contentVersion })
    if (result === "queued") { form.dialog.close(); return false }
    if (result) { await openForm(); return true }
    form.status.textContent = "The field changes were not applied. Reopen the form tools and try again."
    return false
  }
  function showFields() {
    panel.replaceChildren()
    const required = fields.filter(field => field.required && !field.readOnly && field.type !== "unsupported")
    const missing = required.filter(field => !complete(field.value))
    const invalid = fields.filter(field => field.type === "date" && complete(field.value) && !validDate(field.value))
    form.status.textContent = fields.length + " fields · " + (required.length - missing.length) + " of " + required.length + " required fields completed." +
      (invalid.length ? " " + invalid.length + " invalid date answers. Use YYYY-MM-DD." : "")
    if (missing.length || invalid.length) {
      const ordered = [...missing, ...invalid].sort((a, b) => (a.widgets[0]?.page || 0) - (b.widgets[0]?.page || 0))
      const next = ordered.find(field => (field.widgets[0]?.page || 0) >= app.page()) || ordered[0]
      hub.button("Go to next incomplete or invalid field", () => goToField(next), panel)
    }
    const list = element("ul")
    for (const field of fields.slice(0, 500)) {
      const entry = element("li", field.label || field.name)
      entry.append(" · " + field.type + (field.required ? complete(field.value) ? " · completed" : " · required" : "") + (invalid.includes(field) ? " · invalid date" : "") + " ")
      if (field.widgets.some(widget => widget.page)) hub.button("Go to field", () => goToField(field), entry)
      if (field.type !== "unsupported") {
        hub.button("Edit field", () => properties(field), entry)
        if (field.type !== "list" && field.widgets.length === 1 && field.widgets[0].page) hub.button("Duplicate", () => properties(field, true), entry)
      }
      list.append(entry)
    }
    if (list.children.length) panel.append(list)
    const actions = hub.actions(panel)
    hub.button("Add field on page " + app.page(), () => properties(), actions)
    hub.button("Suggest fields from this page", suggest, actions)
    hub.button("Preview profile autofill", previewProfile, actions)
    hub.button("Close", () => form.dialog.close(), actions)
  }
  async function goToField(field) {
    const widget = field.widgets.find(item => item.page)
    if (!widget) throw new Error("The PDF does not identify which page contains this field.")
    form.dialog.close()
    app.setMode("edit")
    await app.go(widget.page)
    const input = Array.from(document.querySelectorAll("#pdf-fields [data-field]")).find(control => control.dataset.field === field.name)
    if (input) { input.scrollIntoView({ block: "center", inline: "nearest" }); input.focus({ preventScroll: true }) }
  }
  function properties(field, duplicate = false) {
    const existing = field?.widgets[0], movable = !field || field.widgets.length === 1 && Boolean(existing?.page)
    const page = existing?.page ?? app.page()
    panel.replaceChildren()
    form.status.textContent = (field ? "Edit field" : "New field") + " · page " + page
    const controls = element("form")
    controls.innerHTML = `<label>Field name <input name="fieldName" maxlength="150" required></label>
      <label>Label for readers <input name="label" maxlength="150"></label>
      <label>Type <select name="type"><option value="text">Text</option><option value="date">Date (YYYY-MM-DD)</option><option value="checkbox">Checkbox</option><option value="dropdown">Dropdown</option><option value="radio">Radio group</option><option value="list">List</option></select></label>
      <label>Choices for dropdowns and radio groups, one per line <textarea name="options" rows="3"></textarea></label>
      <label><input name="required" type="checkbox"> Required</label>
      <p>Position in PDF points from the lower-left corner.</p>
      <div class="actions"><label>X <input name="x" type="number" step="0.01" required></label><label>Y <input name="y" type="number" step="0.01" required></label>
      <label>Width <input name="width" type="number" min="5" step="0.01" required></label><label>Height <input name="height" type="number" min="5" step="0.01" required></label></div>
      <button class="primary">Apply field</button>`
    panel.append(controls)
    const named = name => controls.elements.namedItem(name)
    const view = app.viewport()
    const bounds = view?.viewBox || [0, 0, 595, 842]
    const defaults = existing || { x: bounds[0] + 24, y: bounds[3] - 68, width: 120, height: 20 }
    for (const key of ["x", "y", "width", "height"]) {
      named(key).value = Number(defaults[key]).toFixed(2)
      named(key).disabled = !movable
    }
    named("fieldName").value = duplicate ? field.name + " copy" : field?.name || ""
    named("fieldName").readOnly = Boolean(field?.name.includes(".") && !duplicate)
    named("label").value = field?.label || ""
    named("type").value = field?.type || "text"
    named("type").disabled = Boolean(field)
    named("required").checked = Boolean(field?.required)
    named("options").value = field?.options?.join("\n") || ""
    named("options").disabled = Boolean(field && !duplicate)
    controls.onsubmit = async event => {
      event.preventDefault()
      event.submitter.disabled = true
      try {
        const inputName = named("fieldName").value.trim()
        await change([{ action: field && !duplicate ? "update" : "create", page, resize: movable,
          name: field && !duplicate ? field.name : inputName, newName: inputName, label: named("label").value, type: named("type").value,
          options: named("options").value.split(/\n/).map(line => line.trim()), required: named("required").checked,
          ...Object.fromEntries(["x", "y", "width", "height"].map(key => [key, named(key).valueAsNumber])) }])
      } catch (error) { form.status.textContent = error.message }
      finally { event.submitter.disabled = false }
    }
    const row = hub.actions(panel)
    if (movable && page === app.page() && app.viewport()) hub.button("Draw position on PDF", () => drawPosition(box => {
      for (const [key, value] of Object.entries(box)) named(key).value = value.toFixed(2)
    }), row)
    if (field && !duplicate) hub.button("Delete field", async () => {
      if (confirm("Delete the field and its saved answer?")) await change([{ action: "delete", name: field.name }])
    }, row)
    hub.button("Back", showFields, row)
  }

  function drawPosition(use) {
    const sheet = document.getElementById("pdf-sheet")
    if (sheet.hidden) throw new Error("Open a single PDF page to draw a field.")
    form.dialog.close()
    const layer = element("div"), selection = element("div")
    Object.assign(layer.style, { position: "absolute", inset: 0, zIndex: 90, touchAction: "none", cursor: "crosshair" })
    Object.assign(selection.style, { position: "absolute", pointerEvents: "none", border: "2px solid #087b5c", background: "#087b5c33" })
    layer.append(selection)
    sheet.append(layer)
    const capturedPage = app.page(), capturedView = app.viewport()
    let start, pointer
    const toPoint = event => {
      const box = layer.getBoundingClientRect()
      return [Math.max(0, Math.min(capturedView.width, (event.clientX - box.left) * capturedView.width / box.width)),
        Math.max(0, Math.min(capturedView.height, (event.clientY - box.top) * capturedView.height / box.height))]
    }
    const finish = () => {
      layer.remove()
      document.removeEventListener("keydown", cancel, true)
      form.dialog.showModal()
    }
    const cancel = event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish() } }
    document.addEventListener("keydown", cancel, true)
    layer.onpointerdown = event => { start = toPoint(event); pointer = event.pointerId; layer.setPointerCapture(pointer) }
    layer.onpointermove = event => {
      if (!start || event.pointerId !== pointer) return
      const [x, y] = toPoint(event)
      Object.assign(selection.style, {
        left: 100 * Math.min(start[0], x) / capturedView.width + "%",
        top: 100 * Math.min(start[1], y) / capturedView.height + "%",
        width: 100 * Math.abs(start[0] - x) / capturedView.width + "%",
        height: 100 * Math.abs(start[1] - y) / capturedView.height + "%"
      })
    }
    layer.onpointercancel = finish
    layer.onpointerup = event => {
      if (!start || event.pointerId !== pointer) return
      const [x, y] = capturedView.convertToPdfPoint(...start)
      const [endX, endY] = capturedView.convertToPdfPoint(...toPoint(event))
      if (app.get()?.id === source.id && capturedPage === app.page() && Math.abs(x - endX) >= 5 && Math.abs(y - endY) >= 5) {
        use({ x: Math.min(x, endX), y: Math.min(y, endY), width: Math.abs(x - endX), height: Math.abs(y - endY) })
      } else form.status.textContent = "Draw a larger box on the same page."
      finish()
    }
    app.status("Drag a field rectangle. Press Escape to cancel.")
  }

  function previewProfile() {
    const profile = readProfile()
    const candidates = fields.flatMap(field => {
      if (field.type !== "text" || field.readOnly || complete(field.value)) return []
      const targets = [field.label, field.name].filter(Boolean).map(label => label.replace(/[_.-]+/g, " ").trim())
      const key = Object.keys(profileNames).find(name => targets.some(target => profileNames[name].test(target)))
      return typeof profile[key] === "string" && profile[key].trim() ? [{ name: field.name, value: profile[key], before: field.value, action: "fill" }] : []
    })
    propose(candidates, "Review the matching empty fields before applying.", "No empty fields matched. Save your details under Document tools → Personal form profile.")
  }

  async function suggest() {
    const page = app.page(), view = app.viewport()
    if (!view) throw new Error("Open a single PDF page to detect fields.")
    form.status.textContent = "Reading the page locally…"
    let data = await (await app.request("/api/text/" + source.id + "/" + page)).json()
    if (!data.spans.some(span => span.text?.trim())) {
      await json(app, "/api/ocr/" + source.id + "/" + page, { lang: document.getElementById("ocr-language").value })
      await app.refresh()
      if (app.get()?.id !== source.id) throw new Error("The active document changed.")
      source = app.get()
      data = await (await app.request("/api/text/" + source.id + "/" + page)).json()
    }
    const [, bottom, right, top] = view.viewBox
    const used = new Set(fields.map(field => field.name))
    const candidates = []
    for (const span of data.spans) {
      const match = span.text?.trim().match(/^([^:：_]{2,45})(?:[:：]\s*[_\.\s]*|\s+_{2,})$/u)
      if (!match || !span.quad || span.confidence < 55) continue
      const label = match[1].trim()
      if (!label) continue
      const [[x0, y0], [x1, y1]] = span.quad
      const x = Math.min(x0, x1) + Math.abs(x1 - x0) * label.length / Math.max(label.length, span.text.trim().length) + 8
      const y = Math.min(y0, y1) - 3
      const width = Math.min(155, right - x - 8)
      const height = Math.min(30, Math.max(12, Math.abs(y1 - y0) + 5))
      if (width < 45 || y < bottom || y + height > top) continue
      let name = label.replace(/[.]/g, " ").trim()
      for (let suffix = 2; used.has(name); suffix++) name = label + " " + suffix
      used.add(name)
      candidates.push({ action: "create", name, label, page, x, y, width, height, type: "text", required: false })
      if (candidates.length >= 30) break
    }
    propose(candidates, "Review suggested text fields. Edit their positions after creating them.", "No clear labels with blanks were found on this page. You can add fields by drawing them.")
  }

  function propose(candidates, heading, empty) {
    panel.replaceChildren()
    form.status.textContent = candidates.length ? heading : empty
    const inputs = candidates.map(item => {
      const label = element("label"), checkbox = element("input")
      checkbox.type = "checkbox"
      checkbox.checked = true
      label.append(checkbox, " " + item.name + (item.action === "fill" ? " → " + item.value : " · page " + item.page + " · " + Math.round(item.x) + ", " + Math.round(item.y)))
      panel.append(label)
      return checkbox
    })
    const row = hub.actions(panel)
    if (candidates.length) hub.button("Apply selected fields", async () => {
      const chosen = candidates.filter((_, index) => inputs[index].checked)
      if (chosen.length) await change(chosen)
    }, row)
    hub.button("Back", showFields, row)
  }
  hub.button("PDF form tools", openForm, hub.tools).id = "suite-forms"

  const copy = statusDialog("pdf-copy-workspace", "Privacy Inspector and PDF compression")
  const privacy = { metadata: "Document metadata", comments: "Comments and markup", attachments: "Attachments", scripts: "JavaScript and automatic actions" }
  const inspector = element("div")
  const warning = element("p", "Inspect the exported copy for the listed categories. Review visible sensitive content separately. Saving a copy can invalidate existing certificate signatures.")
  const verification = element("label", "Check a redacted phrase (optional) ")
  const verifyText = element("input")
  verifyText.maxLength = 200
  verifyText.autocomplete = "off"
  verification.append(verifyText)
  copy.dialog.append(warning, inspector, verification)
  let copyDocument
  async function inspect() {
    await app.pending()
    copyDocument = activePdf()
    verifyText.value = ""
    const counts = await (await json(app, "/api/pdf-copy/" + copyDocument.id, { action: "inspect" })).json()
    inspector.replaceChildren()
    for (const [key, label] of Object.entries(privacy)) {
      const row = element("label"), input = element("input")
      input.type = "checkbox"; input.value = key; input.checked = counts[key] > 0
      row.append(input, " " + label + " (" + counts[key] + ")")
      inspector.append(row)
    }
    copy.status.textContent = counts.layers ? "Optional PDF layers detected. Inspect their content separately before sharing." : "Inspection complete."
  }
  const row = hub.actions(copy.dialog)
  async function makeCopy(action, extra) {
    await app.pending()
    const doc = activePdf()
    if (doc.id !== copyDocument?.id) throw new Error("The active PDF changed. Reopen this tool.")
    const output = await json(app, "/api/pdf-copy/" + doc.id, { action, ...extra })
    const report = JSON.parse(output.headers.get("X-Result-Report"))
    await download(output, doc.filename.replace(/\.pdf$/i, action === "clean" ? " - clean.pdf" : " - optimized.pdf"))
    if (action === "clean") copy.status.textContent = "Selected categories absent from the rechecked copy. " +
      (report.phraseChecked ? "The phrase was not found in the extractable page text. " : "") +
      Object.entries(report.after).filter(([key]) => privacy[key]).map(([key, count]) => privacy[key] + ": " + count).join(" · ")
    else copy.status.textContent = "Original " + Math.round(report.originalBytes / 1024) + " KB · Output " +
      Math.round(report.bytes / 1024) + " KB · " + report.changedImages + " images resized."
  }
  hub.button("Save clean copy", () => {
    const categories = Array.from(inspector.querySelectorAll("input:checked"), control => control.value)
    if (!categories.length) throw new Error("Select at least one cleanup category.")
    return makeCopy("clean", { categories, verifyText: verifyText.value.trim() }).catch(error => { copy.status.textContent = error.message })
  }, row)
  hub.button("Optimize PDF losslessly", () => makeCopy("optimize", { resize: false }), row)
  hub.button("Optimize and resize large JPEGs", () => makeCopy("optimize", { resize: true }), row)
  hub.button("Close", () => copy.dialog.close(), row)
  hub.button("Privacy Inspector / Compress PDF", async () => { await inspect(); copy.dialog.showModal() }, hub.tools).id = "suite-privacy"
}
