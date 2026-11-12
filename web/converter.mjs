export function installConverter(pdfjs) {
  const button = document.createElement('button'); button.textContent = 'Convert files'; button.id = 'convert-files'
  document.querySelector('.app-header > .actions').prepend(button)
  const dialog = document.createElement('dialog'); dialog.id = 'converter-dialog'
  dialog.innerHTML = `<h2>Convert files</h2>
    <p>Your originals stay unchanged. Add up to 20 files (100 MB total). Use arrows to set the combined page order.</p>
    <input id="convert-input" type="file" multiple accept=".pdf,.docx,.txt,.md,.jpg,.jpeg,.png,.webp,.bmp">
    <ol id="convert-list"></ol>
    <label>Output <select id="convert-target"><option value="pdf">PDF — images or text layout</option><option value="combine">Combine into one PDF</option><option value="docx">Word — text or pictures</option><option value="txt">Extract text</option><option value="extract">Extract PDF pages</option><option value="jpg">PDF pages as JPG</option><option value="png">PDF pages as PNG</option><option value="compress">Smaller PDF — image-based copy</option></select></label>
    <p id="convert-warning">Word conversion uses text layout; tables, pictures and original formatting are not retained in text conversion. Combining PDF pages does not preserve interactive forms or document bookmarks. Use editable Combine in Organize Pages for forms.</p>
    <label>PDF pages (blank means all) <input id="convert-pages" placeholder="1,3-5"></label>
    <details><summary>Page and quality settings</summary>
    <label>Page size <select id="convert-size"><option value="a4">A4</option><option value="letter">Letter</option><option value="custom">Custom</option></select></label>
    <label>Width mm <input id="convert-width" type="number" value="210" min="26" max="1016"></label>
    <label>Height mm <input id="convert-height" type="number" value="297" min="26" max="1016"></label>
    <label><input id="convert-landscape" type="checkbox"> Landscape</label>
    <label>Margins mm <input id="convert-margin" type="number" value="12" min="0" max="100"></label>
    <label>Image placement <select id="convert-fit"><option value="fit">Fit entire image</option><option value="fill">Fill page (may crop)</option></select></label>
    <label>Resolution <select id="convert-dpi"><option value="96">96 DPI — smaller</option><option value="150" selected>150 DPI</option><option value="200">200 DPI — clearer</option></select></label>
    <label>JPEG quality <input id="convert-quality" type="range" min="0.3" max="0.95" step="0.05" value="0.75"></label></details>
    <label><input id="convert-ocr" type="checkbox"> Recognise text from images or scanned PDFs, then review</label>
    <label>OCR language <select id="convert-language"><option value="eng">English</option><option value="fra">French</option><option value="spa">Spanish</option></select></label>
    <p id="convert-progress" role="status"></p><progress id="convert-meter" max="1" value="0"></progress>
    <img id="convert-preview" alt="First converted page preview" hidden>
    <section id="convert-review" hidden><h3>Review recognised text</h3><p>Correct recognition errors before creating the output.</p><div id="convert-review-fields"></div><button id="convert-reviewed">Create from reviewed text</button></section>
    <div class="actions"><button id="convert-run" class="primary">Convert</button><button id="convert-cancel" disabled>Cancel conversion</button><button id="convert-close">Close</button></div>
    <div id="convert-results"></div>`
  document.body.append(dialog)
  const $ = id => document.getElementById('convert-' + id)
  let files = [], results = [], cancelled = false, busy = false, worker, previewUrl, reviewed = [], reviewOptions
  const status = text => $('progress').textContent = text
  const check = () => { if (cancelled) throw new Error('Conversion cancelled. Originals are unchanged.') }
  const engine = () => import('./conversion-runtime.mjs')
  const options = () => Object.fromEntries(['target','pages','size','width','height','margin','fit','dpi','quality','language'].map(key => [key, $(key).value]).concat([['landscape', $('landscape').checked]]))
  const base = name => name.replace(/\.[^.]+$/, '')
  function showFiles() {
    $('list').replaceChildren(...files.map((file, index) => {
      const row = document.createElement('li'), label = document.createElement('span'); label.textContent = file.name; row.append(label)
      for (const [name, direction] of [['Move up', -1], ['Move down', 1], ['Remove', 0]]) {
        const b = document.createElement('button'); b.textContent = name; b.disabled = busy || (direction !== 0 && !files[index + direction])
        b.onclick = () => { if (!direction) files.splice(index, 1); else [files[index], files[index + direction]] = [files[index + direction], files[index]]; showFiles() }; row.append(b)
      }
      return row
    }))
  }
  function setBusy(value) {
    busy = value
    for (const input of dialog.querySelectorAll('input,select')) input.disabled = value
    $('run').disabled = $('reviewed').disabled = value; $('cancel').disabled = !value; $('close').disabled = value
    showFiles()
  }
  function preview(blob) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    previewUrl = URL.createObjectURL(blob); $('preview').src = previewUrl; $('preview').hidden = false
  }
  const asBase64 = blob => new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(blob) })
  async function save(result, share = false) {
    const mime = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', zip: 'application/zip', png: 'image/png', jpg: 'image/jpeg' }[result.name.split('.').pop()] || 'application/octet-stream'
    const blob = new Blob([result.bytes], { type: mime }), file = new File([blob], result.name, { type: mime })
    if (share && window.EllesonAndroid?.shareData) { window.EllesonAndroid.shareData(await asBase64(blob), result.name, mime); return }
    if (share && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return }
    if (window.desktopDocs?.saveConverted) { await window.desktopDocs.saveConverted(result.name, Array.from(result.bytes)); return }
    if (window.EllesonAndroid?.saveData) { window.EllesonAndroid.saveData(await asBase64(blob), result.name, '', ''); return }
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = result.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000)
  }
  function showResults() {
    $('results').replaceChildren(...results.map(result => {
      const row = document.createElement('div'), label = document.createElement('p'); label.textContent = `${result.name} · ${(result.bytes.length / 1024).toFixed(1)} KB`; row.append(label)
      for (const [name, share] of [['Save As…', false], ['Share / save…', true]]) { const b = document.createElement('button'); b.textContent = name; b.onclick = () => save(result, share).catch(error => status(error.message)); row.append(b) }
      return row
    }))
    if (results.length > 1) { const b = document.createElement('button'); b.textContent = 'Save all as ZIP'; b.onclick = async () => { try { await save({ name: 'Converted documents.zip', bytes: (await engine()).archive(results) }) } catch (error) { status(error.message) } }; $('results').append(b) }
  }
  async function recognize(blob, opts) {
    if (!worker) {
      if (!window.Tesseract) await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = '/vendor/tesseract/tesseract.min.js'; script.onload = resolve; script.onerror = () => reject(new Error('Could not load OCR.')); document.head.append(script) })
      worker = await window.Tesseract.createWorker(opts.language, 1, { workerPath: location.origin + '/vendor/tesseract/worker.min.js', workerBlobURL: false, corePath: location.origin + '/vendor/tesseract-core/', langPath: location.origin + '/vendor/ocr-data/', gzip: true, cacheMethod: 'none' })
    }
    check(); return (await worker.recognize(blob)).data.text
  }
  async function textOf(file, opts, ocr) {
    const e = await engine(), ext = file.name.split('.').pop().toLowerCase(), bytes = new Uint8Array(await file.arrayBuffer())
    if (ext === 'docx') return e.wordText(bytes)
    if (['txt', 'md'].includes(ext)) return file.text()
    if (ext !== 'pdf') return ocr ? recognize(file, opts) : ''
    if (ocr) {
      const images = await e.rasterPdf(pdfjs, bytes, { ...opts, target: 'png' }, status, check)
      let text = ''
      for (let i = 0; i < images.length; i++) { check(); status(`Recognising ${file.name}: page ${i + 1} of ${images.length}`); text += await recognize(new Blob([images[i].bytes], { type: 'image/png' }), opts) + '\n' }
      return text
    }
    const task = pdfjs.getDocument({ data: bytes, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/' })
    try { const pdf = await task.promise; let text = ''; for (const index of e.selectedPages(opts.pages, pdf.numPages)) { check(); const content = await (await pdf.getPage(index + 1)).getTextContent(); text += content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('') + '\n' }; return text }
    finally { await task.destroy() }
  }
  async function run() {
    if (!files.length) { status('Choose files first.'); return }
    setBusy(true); cancelled = false; results = []; reviewed = []; $('review').hidden = true; $('preview').hidden = true; showResults()
    const opts = options(), e = await engine(), combined = [], ocr = $('ocr').checked
    try {
      if (ocr && !['docx', 'txt', 'pdf', 'combine'].includes(opts.target)) throw new Error('Choose Word, text, or PDF for OCR review.')
      for (let index = 0; index < files.length; index++) {
        check(); const file = files[index], ext = file.name.split('.').pop().toLowerCase(), bytes = new Uint8Array(await file.arrayBuffer())
        status(`File ${index + 1} of ${files.length}: ${file.name}`); $('meter').value = index / files.length
        if (ocr) { reviewed.push({ name: file.name, text: await textOf(file, opts, true) }); continue }
        let converted
        if (['jpg', 'png', 'compress', 'extract'].includes(opts.target)) {
          if (ext !== 'pdf') throw new Error(`${file.name}: this output requires a PDF.`)
          converted = opts.target === 'extract' ? await e.extractPages(bytes, opts.pages) : await e.rasterPdf(pdfjs, bytes, opts, status, check, preview)
          if (Array.isArray(converted)) { results.push(...converted.map(item => ({ ...item, name: base(file.name) + ' - ' + item.name }))); continue }
        } else if (opts.target === 'txt') converted = new TextEncoder().encode(await textOf(file, opts, false))
        else if (opts.target === 'docx') {
          if (['pdf', 'docx', 'txt', 'md'].includes(ext)) converted = await e.wordBytes(await textOf(file, opts, false))
          else { const image = await e.imageData(file), scale = Math.min(1, 600 / image.width); converted = await e.wordBytes('', [{ ...image, width: image.width * scale, height: image.height * scale }]) }
        } else if (ext === 'pdf') converted = opts.pages ? await e.extractPages(bytes, opts.pages) : bytes
        else if (['docx', 'txt', 'md'].includes(ext)) converted = await e.textPdf(await textOf(file, opts, false), opts)
        else converted = await e.imagePdf(file, opts)
        check()
        if (opts.target === 'combine') combined.push(converted)
        else results.push({ name: base(file.name) + ' - converted.' + (['compress', 'extract'].includes(opts.target) ? 'pdf' : opts.target), bytes: converted })
      }
      if (ocr) {
        reviewOptions = opts
        $('review-fields').replaceChildren(...reviewed.map(item => { const label = document.createElement('label'); label.textContent = item.name; const area = document.createElement('textarea'); area.value = item.text; area.rows = 8; area.oninput = () => item.text = area.value; label.append(area); return label }))
        $('review').hidden = false; status('Review the recognised text, then create the output.')
      } else {
        if (combined.length) results.push({ name: 'Combined document.pdf', bytes: await e.combinePdfs(combined, check) })
        check(); showResults(); $('meter').value = 1
        const originalSize = files.reduce((sum, file) => sum + file.size, 0), outputSize = results.reduce((sum, item) => sum + item.bytes.length, 0)
        status(`Ready to save. Original: ${(originalSize / 1024).toFixed(1)} KB. Output: ${(outputSize / 1024).toFixed(1)} KB.${opts.target === 'compress' ? ' This copy is image-based: text, forms, links and annotations are no longer interactive. If larger, keep your original.' : ''}`)
      }
    } catch (error) { status(error.message); if (cancelled) results = []; showResults() }
    finally { if (worker) { await worker.terminate(); worker = null }; setBusy(false) }
  }
  $('reviewed').onclick = async () => {
    setBusy(true); cancelled = false; results = []
    try {
      const e = await engine(), opts = reviewOptions, combined = []
      for (const item of reviewed) {
        check(); const bytes = opts.target === 'docx' ? await e.wordBytes(item.text) : opts.target === 'txt' ? new TextEncoder().encode(item.text) : await e.textPdf(item.text, opts)
        if (opts.target === 'combine') combined.push(bytes); else results.push({ name: base(item.name) + ' - reviewed.' + opts.target, bytes })
      }
      if (combined.length) results.push({ name: 'Reviewed document.pdf', bytes: await e.combinePdfs(combined, check) })
      check(); showResults(); status('Reviewed output ready to save.'); $('meter').value = 1
    } catch (error) { status(error.message) } finally { setBusy(false) }
  }
  $('input').onchange = () => {
    const selected = [...files, ...$('input').files]
    if (selected.length > 20 || selected.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) { status('Choose at most 20 files and 100 MB total.'); return }
    files = selected; showFiles(); $('input').value = ''
  }
  $('cancel').onclick = () => { cancelled = true; status('Cancelling…'); if (worker) void worker.terminate() }
  $('run').onclick = () => void run().catch(error => { status(error.message); setBusy(false) })
  $('close').onclick = () => dialog.close()
  dialog.addEventListener('cancel', event => { if (busy) { event.preventDefault(); $('cancel').click() } })
  button.onclick = () => dialog.showModal()
  return { open: selected => { if (busy) { status('Finish or cancel the current conversion first.'); dialog.showModal(); return }; files = selected; showFiles(); dialog.showModal() } }
}
