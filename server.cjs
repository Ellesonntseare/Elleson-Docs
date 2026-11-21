const { durableWrite } = require('./durable-files.cjs')
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
  width: Number.isFinite(edit.width) && edit.width >= .25 && edit.width <= 30 ? edit.width : 1.7,
  opacity: edit.opacity === .25 ? .25 : 1
})
const latinFont = PDFDocument.create().then(document => document.embedFont(StandardFonts.Helvetica))
const downloadMime = {
  pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}

async function start(port = 0, recoveryDirectory, onRestore) {
  const { fieldValues, sameValue, validFieldValue, setFieldValue } = await import('./pdf-fields.mjs')
  const {drawPdfInk}=await import('./ink-export.mjs')
  const web = express()
  const owner = token()
  const library = new DocumentLibrary(recoveryDirectory ? path.join(recoveryDirectory, "library") : null)
  await library.load()
  const { createLibrarySearch, normalizedTags } = await import("./library-search.mjs")
  const searchLibrary = createLibrarySearch()
  let pairing
  let pairRequest
  let mobile
  let mobileUntil = 0
  let phoneReceipt
  let lastPhoneSeen = 0
  let document
  const documents = new Map()
  const { createCollaboration, isLanAddress, mergeParagraph } = require("./collaboration.cjs")
  const collaborationPath = recoveryDirectory && path.join(recoveryDirectory, "collaborators.json")
  let savedCollaborators = []
  if (collaborationPath) {
    try {
      const stored = JSON.parse(await fs.readFile(collaborationPath, "utf8"))
      if (Array.isArray(stored)) savedCollaborators = stored
    } catch {}
  }
  const collaboration = createCollaboration(savedCollaborators, async grants => {
    if (!collaborationPath) return
    await fs.mkdir(recoveryDirectory, { recursive: true })
    await durableWrite(collaborationPath, JSON.stringify(grants))
  })
  const guestEdits = new Set(["word", "word-format", "word-tools", "word-table", "field", "ink", "signature", "text", "replace", "review"])
  const guestReads = new Set(["source", "text", "word-layout", "form-fields", "word-styles", "review"])
  let recoveryWarning = ""
  const failedTabs = new Map()
  let openSequence = 0
  let revision = 0
  let restoringWorkspace = Boolean(recoveryDirectory)
  let recognizing = false
  let checkpointQueue = Promise.resolve()
  let editQueue = Promise.resolve()
  const wordLayouts = new Map()
  const previews = Object.create(null)
  const inkCommits=new Map()
  let previewSequence=0
  const liveClients=new Set()
  const peerPreview=role=>{const value=previews[role==='pc'?'phone':'pc'];return value?.until>Date.now()?value.mark:null}
  const publish=(type,role)=>{
    for(const client of liveClients){
      if(client.role==='phone'&&(client.token!==mobile||mobileUntil<=Date.now())){client.response.end();continue}
      if (client.role === "guest" && !collaboration.get(client.token)) { client.response.end(); continue }
      if (client.role === "guest" && type !== "refresh") continue
      if(role&&role===client.role)continue
      const payload=type==='preview'?{type,preview:peerPreview(client.role),previewSequence}:type==='view'?{type,view:sharedView}:{type}
      if(client.response.writableLength>256*1024){client.response.destroy();continue}
      client.response.write('data: '+JSON.stringify(payload)+'\n\n')
    }
  }
  const pendingExports = new Map()
  let sharedView = null, viewSequence = 0
  let wordRenderer
  let handoff
  const isLoopback = request => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress)
  if (recoveryDirectory) {
    try { const saved = JSON.parse(await fs.readFile(path.join(recoveryDirectory, "paired-device.json"), "utf8")); if (/^[A-Za-z0-9_-]{32}$/.test(saved.token) && saved.until > Date.now()) { mobile = saved.token; mobileUntil = saved.until } } catch {}
  }

  web.disable("x-powered-by")
  web.use((request, response, next) => {
    response.set({
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; font-src 'self' data: blob:; connect-src 'self' blob: https://api.github.com; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    })
    if (request.path.startsWith("/api/")) response.set("Cache-Control", "no-store")
    next()
  })
  const documentFonts = new Set(['arial.ttf','arialbd.ttf','ariali.ttf','arialbi.ttf','calibri.ttf','calibrib.ttf','calibrii.ttf','calibriz.ttf','cambria.ttc','cambriab.ttf','cambriai.ttf','cambriaz.ttf','times.ttf','timesbd.ttf','timesi.ttf','timesbi.ttf','cour.ttf','courbd.ttf','couri.ttf','courbi.ttf'])
  web.get('/document-fonts/:file',(request,response)=>{if(!documentFonts.has(request.params.file)||process.platform!=='win32')return response.sendStatus(404);response.sendFile(path.join(process.env.WINDIR||'C:\\Windows','Fonts',request.params.file))})
  web.use(express.static(path.join(__dirname, "web")))
  web.use("/vendor/docx", express.static(path.dirname(require.resolve("docx-preview"))))
  web.use("/vendor/jszip", express.static(path.join(path.dirname(require.resolve("jszip/package.json")), "dist")))
  web.use("/vendor/tesseract", express.static(path.join(path.dirname(require.resolve("tesseract.js/package.json")), "dist")))
  web.use("/vendor/tesseract-core", express.static(path.dirname(require.resolve("tesseract.js-core/package.json"))))
  for (const language of ["eng", "fra", "spa"]) web.use("/vendor/ocr-data", express.static(require("@tesseract.js-data/" + language).langPath))
  const pdfRoot = path.dirname(require.resolve("pdfjs-dist/package.json"))
  for (const folder of ["legacy/build", "cmaps", "standard_fonts", "wasm"]) {
    web.use("/pdfjs/" + folder, express.static(path.join(pdfRoot, folder)))
  }
  web.use(express.json({ limit: "8mb" }))
  // Only explicitly staged, checksum-described APKs are served to the local network.
  const updateDirectory = recoveryDirectory ? path.join(path.dirname(recoveryDirectory),'updates') : null
  web.get('/api/local-update',async(request,response)=>{
    try {if(!updateDirectory)return response.json(null);const manifest=JSON.parse(await fs.readFile(path.join(updateDirectory,'android.json'),'utf8'));if(!/^sha256:[a-f0-9]{64}$/.test(manifest.digest)||!/^\d+\.\d+\.\d+$/.test(manifest.version))throw Error();response.json({...manifest,url:'/api/local-update/android.apk'})}catch{response.json(null)}
  })
  web.get('/api/local-update/android.apk',async(request,response)=>{
    if(!updateDirectory)return response.sendStatus(404)
    response.sendFile(path.join(updateDirectory,'android.apk'))
  })
  web.post("/api/collab-join", async (request, response) => {
    if (!isLanAddress(request.socket.remoteAddress)) return response.sendStatus(403)
    response.json(await collaboration.join(request.body.invite, request.body.name, id => documents.has(id)))
  })
  web.post("/api/pair-request", (request, response) => {
    if (!isLanAddress(request.socket.remoteAddress)) return response.sendStatus(403)
    if (pairRequest && pairRequest.until > Date.now()) return response.status(409).json({ error: "Another connection request is pending. Try again shortly." })
    pairRequest = { id: token(), secret: token(), address: request.socket.remoteAddress, until: Date.now() + 120000, approved: false }
    response.json({ id: pairRequest.id, secret: pairRequest.secret })
  })
  web.post("/api/pair-request/status", (request, response) => {
    if (!isLanAddress(request.socket.remoteAddress)) return response.sendStatus(403)
    if (!pairRequest || pairRequest.until < Date.now() || request.body.id !== pairRequest.id || request.body.secret !== pairRequest.secret) return response.status(410).json({ error: "Connection request expired. Try again." })
    if (!pairRequest.approved) return response.json({ waiting: true })
    const credential = pairRequest.credential; pairRequest = undefined
    response.json({ token: credential })
  })

  web.post("/api/pair", async (request, response) => {
    if (!isLanAddress(request.socket.remoteAddress)) return response.sendStatus(403)
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
    const grant = !request.role && isLanAddress(request.socket.remoteAddress) ? collaboration.get(credential) : undefined
    if (grant) {
      if (restoringWorkspace) return response.status(503).json({ error: "The host is restoring its workspace. Reconnecting…" })
      if (!documents.has(grant.document)) return response.status(401).json({ error: "The shared document was closed." })
      const [action, id] = request.path.split("/").filter(Boolean)
      const room = request.method === "GET" && ["state", "live", "collab-room"].includes(action)
      const read = request.method === "GET" && id === grant.document && guestReads.has(action)
      const edit = request.method === "POST" && id === grant.document && (action === "view" || action === "edit" && guestEdits.has(request.body?.kind))
      if (!room && !read && !edit) return response.status(403).json({ error: "This command is only available on the host." })
      request.role = "guest"
      request.collaborator = grant
      request.collaboratorToken = credential
    }
    if (request.role === "phone") lastPhoneSeen = Date.now()
    if (!request.role) return response.status(401).json({ error: "Connect to Elleson Docs to continue." })
    next()
  })
  const requestDocument = request => request.collaborator ? documents.get(request.collaborator.document) : document
  web.post("/api/collab-invite/:id", (request, response) => {
    if (request.role !== "pc") return response.sendStatus(403)
    const target = documents.get(request.params.id)
    if (!target || !["pdf", "docx"].includes(target.extension)) return response.status(404).json({ error: "Open a PDF or DOCX to share." })
    const invite = collaboration.invite(target.id)
    const addresses = Object.values(os.networkInterfaces()).flat()
      .filter(item => item?.family === "IPv4" && !item.internal && isLanAddress(item.address))
      .map(item => "http://" + item.address + ":" + server.address().port + "/#collab=" + invite)
    response.json({ addresses, local: "http://127.0.0.1:" + server.address().port + "/#collab=" + invite })
  })
  web.get("/api/collab-room", (request, response) => {
    const target = requestDocument(request)
    if (!target) return response.json({ participants: [], activity: [] })
    const id = request.collaborator?.id || (request.role === "pc" ? "host" : "phone")
    response.json({ document: target.id, self: id, participants: collaboration.roster(target.id), activity: target.collaborationActivity || [] })
  })
  web.post("/api/collab-revoke/:id", async (request, response) => {
    if (request.role !== "pc") return response.sendStatus(403)
    const operation = editQueue.then(() => collaboration.revoke(request.params.id, typeof request.body.participant === "string" ? request.body.participant : null))
    editQueue = operation.catch(() => {})
    await operation
    publish("refresh")
    response.sendStatus(204)
  })

  web.post("/api/pairing", (request, response) => {
    if (request.role !== "pc") return response.sendStatus(403)
    pairing = { code: crypto.randomBytes(4).toString("hex").toUpperCase(), until: Date.now() + 180000, attempts: 0 }
    const interfaces = Object.values(os.networkInterfaces()).flat()
    const addresses = interfaces.filter(item => item && item.family === "IPv4" && !item.internal)
      .map(item => "http://" + item.address + ":" + server.address().port)
    response.json({ code: pairing.code, addresses })
  })
  web.post("/api/pair-request/approve", async (request, response) => {
    if (request.role !== "pc") return response.sendStatus(403)
    if (!pairRequest || pairRequest.until < Date.now() || pairRequest.id !== request.body.id) return response.status(410).json({ error: "Connection request expired." })
    if (!request.body.approve) { pairRequest = undefined; return response.sendStatus(204) }
    mobile = token(); mobileUntil = Date.now() + 30 * 86400000
    if (recoveryDirectory) { await fs.mkdir(recoveryDirectory, {recursive:true}); await fs.writeFile(path.join(recoveryDirectory,"paired-device.json"), JSON.stringify({token:mobile,until:mobileUntil})) }
    pairRequest.credential = mobile; pairRequest.approved = true
    response.sendStatus(204)
  })
  web.get("/api/library", (request, response) => response.json(library.list()))
  web.get("/api/library-search", async (request, response) => {
    const records = library.list().map(record => ({ ...record, latest: library.versions(record.id)[0] }))
    response.json(await searchLibrary(records, (id, version) => library.read(id, version), request.query.q))
  })
  web.post("/api/library/:id/tags", async (request, response) => {
    await library.updateDetails(request.params.id, { tags: normalizedTags(request.body.tags) })
    response.sendStatus(204)
  })
  web.get("/api/word-styles/:id", async (request, response) => {
    const current = documents.get(request.params.id)
    if (!current?.word) return response.sendStatus(404)
    const { paragraphStyles, standardParagraphStyles } = await import("./word-structure.mjs")
    const existing = paragraphStyles(current.word.archive, current.word.document?.documentElement.namespaceURI,
      require("@xmldom/xmldom").DOMParser, require("fflate").strFromU8)
    response.json([...new Map([...standardParagraphStyles, ...existing].map(style => [style.id, style])).values()])
  })
  web.get("/api/form-fields/:id", async (request, response) => {
    const current = documents.get(request.params.id)
    if (current?.extension !== "pdf") return response.sendStatus(404)
    response.json(await (await import("./form-authoring.mjs")).inspectForm(current.bytes, current.fields))
  })
  web.post("/api/pdf-copy/:id", async (request, response) => {
    const result = await exportFile(request.params.id)
    if (result.extension !== "pdf") throw new Error("Open a PDF first.")
    const { inspectPrivacy, cleanPdf, optimizePdf } = await import("./pdf-copy-tools.mjs")
    if (request.body.action === "inspect") return response.json(inspectPrivacy(result.bytes))
    if (!["clean", "optimize"].includes(request.body.action)) return response.sendStatus(400)
    const copy = request.body.action === "clean" ? cleanPdf(result.bytes, request.body.categories, request.body.verifyText) : optimizePdf(result.bytes, request.body.resize === true)
    response.set("X-Result-Report", JSON.stringify({ before: copy.before, after: copy.after, phraseChecked: copy.phraseChecked, originalBytes: result.bytes.length, bytes: copy.bytes.length, changedImages: copy.changedImages }))
    response.type("application/pdf").send(Buffer.from(copy.bytes))
  })
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
  web.get("/api/library/:id/preview/:version", async (request,response) => {
    const saved=await library.read(request.params.id,request.params.version)
    response.type(/\.pdf$/i.test(saved.filename)?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document').send(saved.bytes)
  })
  web.post('/api/restore-checkpoint/:id',(request,response,next)=>{
    const operation=editQueue.then(async()=>{
      const current=document
      if(current?.id!==request.params.id)return response.sendStatus(409)
      // Read first: saving current work can trim the oldest retained version.
      const saved=await library.read(current.libraryId,request.body.version)
      const exported=await exportFile(current.id)
      await library.save(current.filename.replace(/\.[^.]+$/,'.'+exported.extension),exported.bytes,current.libraryId)
      await openNow(saved.filename,saved.bytes,false,current.libraryId)
      response.json(snapshot(document))
    });editQueue=operation.catch(()=>{});operation.catch(next)
  })
  web.post("/api/checkpoint/:id", async (request,response) => {
    const operation=editQueue.then(async()=>{
      const current=documents.get(request.params.id)
      if(!current || current!==document)throw new Error('The open document changed.')
      const exported=await exportFile(current.id)
      current.libraryId=await library.save(current.filename.replace(/\.[^.]+$/,'.'+exported.extension),exported.bytes,current.libraryId)
      revision++;await checkpoint()
      return snapshot(current)
    })
    editQueue=operation.catch(()=>{})
    response.json(await operation)
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
    pairRequest = undefined
    pairing = undefined
    mobile = undefined
    if (recoveryDirectory) await fs.unlink(path.join(recoveryDirectory, "paired-device.json")).catch(error => { if (error.code !== "ENOENT") throw error })
    response.sendStatus(204)
  })
  web.get('/api/live',(request,response)=>{
    response.set({'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'})
    request.socket.setNoDelay(true)
    response.flushHeaders()
    const client={role:request.role,token:request.get('authorization')?.slice(7),response}
    liveClients.add(client)
    response.write('data: '+JSON.stringify({type:'preview',preview:peerPreview(client.role),previewSequence})+'\n\n')
    const heartbeat=setInterval(()=>{
      if(client.role==='phone'&&(client.token!==mobile||mobileUntil<=Date.now()))return response.end()
      if(client.role==='guest'&&!collaboration.get(client.token))return response.end()
      response.write(': keepalive\n\n')
    },15000)
    response.on('close',()=>{clearInterval(heartbeat);liveClients.delete(client)})
  })
  web.post("/api/sync/retry", (request, response) => {
    if (request.role !== "pc") return response.sendStatus(403)
    phoneReceipt = undefined
    publish("refresh", "pc")
    response.sendStatus(204)
  })
  web.get("/api/state", (request, response) => {
    const unchanged = Number(request.query.revision) === revision
    if (request.role === "phone" && unchanged) phoneReceipt = { token: mobile, revision }
    const target = requestDocument(request)
    if (target && request.role === "pc") collaboration.update(target.id, "host")
    if (request.collaborator) {
      collaboration.update(target.id, request.collaborator.id)
      return response.json({ role: "guest", revision, tabs: [],
        ...(unchanged ? {} : { document: snapshot(target) }) })
    }
    response.json({
      failedTabs: request.role === "pc" ? [...failedTabs.values()].map(({id,filename})=>({id,filename})) : [],
      phoneCurrent: Boolean(phoneReceipt && phoneReceipt.token === mobile && phoneReceipt.revision === revision),
      view: sharedView?.document === document?.id ? sharedView : null,
      revision, role: request.role, paired: Boolean(mobile) && mobileUntil > Date.now(), phoneOnline: Date.now() - lastPhoneSeen < 6000, recoveryWarning, handoff: handoff?.target === request.role ? handoff : null,
      pairRequest: request.role === "pc" && pairRequest && !pairRequest.approved && pairRequest.until > Date.now() ? { id: pairRequest.id, address: pairRequest.address } : null,
      tabs: [...documents.values()].map(item => ({ id: item.libraryId, documentId: item.id, filename: item.filename, dirty: item.changeNumber !== item.savedNumber })),
      previewSequence, preview: peerPreview(request.role), inkCommits:Object.fromEntries(inkCommits),
      ...(unchanged ? {} : { document: document ? snapshot(document) : null })
    })
  })
  web.post("/api/view/:id", (request, response) => {
    const target = requestDocument(request)
    if (target?.id !== request.params.id) return response.sendStatus(409)
    const {client, page, x, y, zoom} = request.body || {}
    if (typeof client !== 'string' || !/^[a-zA-Z0-9-]{12,80}$/.test(client) || !Number.isInteger(page) || page<1 || page>100000 || ![x,y].every(v=>Number.isFinite(v)&&v>=0&&v<=1) || !Number.isFinite(zoom) || zoom<=0) return response.sendStatus(400)
    const participant = request.collaborator?.id || (request.role === "pc" ? "host" : "phone")
    const paragraph = Number.isInteger(request.body.paragraph) && request.body.paragraph >= 0 && request.body.paragraph < (target.word?.lines.length || 0) ? request.body.paragraph + 1 : undefined
    collaboration.update(target.id, participant, { page, paragraph })
    if (request.collaborator) return response.sendStatus(204)
    sharedView = {document:document.id,client,page,x,y,zoom,reading:request.body.reading===true, color:/^#[a-f0-9]{6}$/i.test(request.body.color||'')?request.body.color:undefined, thickness:[1,2,4,8].includes(request.body.thickness)?request.body.thickness:undefined,sequence:++viewSequence}
    publish('view',request.role)
    response.sendStatus(204)
  })
  web.get('/api/word-layout/:id',(request,response)=>{const value=wordLayouts.get(request.params.id);response.json(value?.version===Number(request.query.version)?value:null)})
  web.post('/api/word-layout/:id',(request,response)=>{
    if(request.role!=='pc')return response.sendStatus(403)
    if(document?.id!==request.params.id||request.body.version!==document.contentVersion)return response.sendStatus(409)
    const pages=request.body.pages
    if(!Array.isArray(pages)||pages.length>1000||!pages.every(p=>Number.isFinite(p.width)&&Number.isFinite(p.height)&&Array.isArray(p.paragraphs)&&p.paragraphs.every(q=>Number.isInteger(q.index)&&Array.isArray(q.characters)&&q.characters.every(c=>typeof c.text==='string'&&c.text.length<=10000&&[c.x,c.y,c.width,c.height].every(Number.isFinite)))))return response.sendStatus(400)
    wordLayouts.clear();wordLayouts.set(document.id,request.body);response.sendStatus(204)
  })
  web.post("/api/handoff", (request, response) => {
    if (!document) return response.sendStatus(409)
    if (!["pc", "phone"].includes(request.body.target)) return response.sendStatus(400)
    handoff = { id: token(), document: document.id, target: request.body.target, page: Math.max(1, Math.min(document.pages || 1, Number(request.body.page) || 1)), zoom: Math.max(.25, Math.min(4, Number(request.body.zoom) || 1)), standalone: request.body.standalone === true }
    revision++
    response.sendStatus(204)
  })
  web.post("/api/preview/:id", (request, response) => {
    if (document?.id !== request.params.id) return response.sendStatus(409)
    const { page, points, id } = request.body || {}
    if (!points && request.body?.kind!=='word-ink') {
      delete previews[request.role]
    } else if (request.body.kind==='word-ink' && document.word && request.body.version===document.contentVersion && /^[a-zA-Z0-9-]{12,80}$/.test(id||'') && Number.isInteger(request.body.index) && document.word.lines[request.body.index] && Number.isInteger(page) && page>=0 && page<1000 && [request.body.width,request.body.height].every(v=>Number.isFinite(v)&&v>0&&v<=100000) && Array.isArray(request.body.strokes) && request.body.strokes.length<=100 && request.body.strokes.reduce((n,s)=>n+(s.points?.length||0),0)<=12000 && request.body.strokes.every(s=>Array.isArray(s.points)&&s.points.length>0&&s.points.every(isPoint))) {
      if(document.applied.has(id))return response.sendStatus(204)
      previews[request.role]={until:Date.now()+2200,mark:{...request.body,document:document.id}}
    } else if (document.extension==='pdf' && /^[a-zA-Z0-9-]{12,80}$/.test(id || "") && Number.isInteger(page) && page >= 1 && page <= document.pages && Array.isArray(points)
      && points.length >= 1 && points.length <= 1200 && points.every(isPoint)) {
      if(document.applied.has(id))return response.sendStatus(204)
      previews[request.role] = { until: Date.now() + 2200, mark: { id, document:document.id, kind: "ink", page, points, ...inkStyle(request.body) } }
    } else return response.sendStatus(400)
    previewSequence++;publish('preview',request.role)
    response.sendStatus(204)
  })
  web.get("/api/source/:id", async (request, response) => {
    const current = requestDocument(request)
    if (current?.id !== request.params.id) return response.sendStatus(404)
    const bytes = current.word && (Object.keys(current.wordEdits).length || Object.keys(current.wordFormats).length)
      ? await saveWord(current.word, { ...current.wordEdits }, structuredClone(current.wordFormats)) : current.bytes
    response.type(downloadMime[current.extension]).send(Buffer.from(bytes))
  })
  web.get("/api/text/:id/:page", async (request, response) => {
    const current = requestDocument(request)
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
  web.post('/api/convert-word',express.raw({type:'application/octet-stream',limit:maxBytes}),async(request,response)=>{
    if(!wordRenderer)return response.status(422).json({error:'Connect to the Windows app to convert Word files.'})
    const name=decodeURIComponent(request.get('X-Filename')||'Document.docx'),extension=/\.doc$/i.test(name)?'doc':'docx'
    const word=await readWord(request.body,extension)
    const bytes=extension==='doc'?await saveWord(word,{},{}):request.body
    response.type('application/pdf').send(Buffer.from(await wordRenderer(Array.from(bytes))))
  })
  web.post("/api/open", express.raw({ type: "application/octet-stream", limit: maxBytes }), async (request, response) => {
    if (!Buffer.isBuffer(request.body)) return response.status(400).json({ error: "Choose a document to open." })
    const name=decodeURIComponent(request.get("x-filename") || "")
    let bytes=request.body
    if (/\.pdf$/i.test(name)) {
      const engine=await import('./document-extras.mjs')
      if(engine.needsPassword(bytes)) {
        const password=request.get('x-pdf-password')
        if(!password)return response.status(422).json({error:'This PDF needs a password.',passwordRequired:true})
        try{bytes=Buffer.from(engine.unlockPdf(bytes,decodeURIComponent(password)))}catch(error){return response.status(422).json({error:error.message,passwordRequired:true})}
      }
    }
    await open(name, bytes)
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
  web.get('/api/filter-source/:id',async(request,response)=>{
    if(document?.id!==request.params.id)return response.sendStatus(404)
    const result=await exportFile(document.id,{flatten:true})
    if(document.word){if(!wordRenderer)return response.status(422).json({error:'Connect to the Windows app to filter Word pages.'});return response.type('application/pdf').send(Buffer.from(await wordRenderer(Array.from(result.bytes))))}
    response.type('application/pdf').send(Buffer.from(result.bytes))
  })
  web.get("/api/print/:id", async (request, response) => {
    const result = await exportFile(request.params.id, { flatten: true })
    response.type("application/pdf").send(Buffer.from(result.bytes))
  })
  web.post("/api/capture-pages/:id", express.raw({ type: "application/octet-stream", limit: maxBytes }), (request, response, next) => {
    if (request.role !== "phone") return response.sendStatus(403)
    const operation = editQueue.then(async () => {
      const current = documents.get(request.params.id)
      const operationId = request.get("X-Operation-Id")
      if (current?.extension !== "pdf" || !Buffer.isBuffer(request.body)) return response.sendStatus(409)
      if (!/^[a-zA-Z0-9-]{12,80}$/.test(operationId || "")) return response.sendStatus(400)
      if (current.applied.has(operationId)) return response.json(snapshot(current))
      if (document !== current) return response.status(409).json({ error: "The PC switched documents. Reopen the scan on the intended PDF." })
      if (current.applied.size >= 30000) throw new Error("Save a copy and reopen it to continue editing.")
      const target = await PDFDocument.load(current.bytes, { updateMetadata: false })
      const incoming = await PDFDocument.load(request.body, { updateMetadata: false })
      if (!incoming.getPageCount() || incoming.getPageCount() > 30 || target.getPageCount() + incoming.getPageCount() > 1000) throw new Error("Choose up to 30 scanned pages and keep the combined PDF below 1,000 pages.")
      if (incoming.getPages().some(page => page.node.Annots()?.size())) throw new Error("Only unannotated scan pages can be appended.")
      for (const page of await target.copyPages(incoming, incoming.getPageIndices())) target.addPage(page)
      const bytes = await target.save()
      if (bytes.length > maxBytes) throw new Error("The combined PDF exceeds the 40 MB document limit.")
      history.remember(current, history.capture(current), "phone scan")
      current.bytes = Buffer.from(bytes)
      current.pages = target.getPageCount()
      current.contentVersion++
      current.changeNumber++
      current.applied.add(operationId)
      revision++
      await checkpoint()
      publish("refresh")
      response.json(snapshot(current))
    })
    editQueue = operation.catch(() => {})
    operation.catch(next)
  })
  web.post("/api/combine/:id", express.raw({ type: "application/octet-stream", limit: maxBytes }), (request, response, next) => {
    const operation = editQueue.then(async () => {
      const current = document
      if (current?.id !== request.params.id || current.extension !== "pdf" || !Buffer.isBuffer(request.body)) return response.sendStatus(409)
      const operationId = request.get("X-Operation-Id")
      if (!/^[a-zA-Z0-9-]{12,80}$/.test(operationId || "")) return response.sendStatus(400)
      if (current.applied.has(operationId)) { await checkpoint(); return response.json(snapshot(current)) }
      const before = history.capture(current)
      const engine = await import("./pdf-edit.mjs")
      const exported = await exportFile(current.id)
      if (documents.get(current.id) !== current) return response.sendStatus(409)
      const result = request.query.editable === "1" ? await (await import("./pdf-tools.mjs")).combineEditable(exported.bytes, request.body) : engine.organize(exported.bytes, "combine", null, request.body)
      current.bytes = result.bytes
      current.pages = result.pages
      current.marks = []
      current.fields = Object.create(null)
      current.originalFields = fieldValues(await PDFDocument.load(current.bytes))
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
      if (current.applied.has(edit.id)) { await checkpoint(); return response.json(snapshot(current)) }
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
  async function applyWordBytes(current, bytes, structural = true) {
    const word = await readWord(bytes, "docx")
    if (documents.get(current.id) !== current) throw Object.assign(new Error("The open document changed."), { status: 409 })
    current.bytes = Buffer.from(bytes)
    if (structural) current.structureVersion = (current.structureVersion || 0) + 1
    current.word = word
    current.extension = "docx"
    current.filename = current.filename.replace(/\.doc$/i, ".docx")
    current.wordEdits = Object.create(null)
    current.wordFormats = Object.create(null)
    current.contentVersion++
  }
  web.post('/api/word-ink-batch/:id',(request,response,next)=>{
    const operation=editQueue.then(async()=>{
      const current=document,edit=request.body||{}
      if(current?.id!==request.params.id||!current.word)return response.sendStatus(409)
      if(current.applied.has(edit.id))return response.json(snapshot(current))
      if(edit.version!==current.contentVersion)return response.status(409).json({error:'The document changed. Select the drawings again.'})
      const before=history.capture(current)
      const bytes=(await import('./word-format.mjs')).changeWordInkBatch(await saveWord(current.word,current.wordEdits,current.wordFormats),edit)
      await applyWordBytes(current,bytes,false);history.remember(current,before,'drawing selection edit')
      current.changeNumber++;current.applied.add(edit.id);revision++;await checkpoint();response.json(snapshot(current))
    });editQueue=operation.catch(()=>{});operation.catch(next)
  })
  web.post(['/api/word-erase/:id','/api/word-ink-edit/:id'],(request,response,next)=>{
    const operation=editQueue.then(async()=>{
      const current=document,{id,version,target,position}=request.body||{}
      if(!/^[a-zA-Z0-9-]{12,80}$/.test(id||'')||typeof target!=='string')return response.sendStatus(400)
      if(current?.id!==request.params.id||!current.word)return response.sendStatus(409)
      if(current.applied.has(id)){await checkpoint();return response.json(snapshot(current))}
      if(version!==current.contentVersion)return response.status(409).json({error:'The document changed. Select the drawing again.'})
      const erase=request.path.startsWith('/api/word-erase/')
      const {changeWordInk,validInkPosition}=await import('./word-format.mjs')
      if(!erase&&!validInkPosition(position))return response.status(400).json({error:'The drawing position is invalid.'})
      const before=history.capture(current)
      const bytes=changeWordInk(await saveWord(current.word,current.wordEdits,current.wordFormats),target,erase?undefined:position)
      if(!bytes)return response.sendStatus(404)
      await applyWordBytes(current,bytes,false)
      history.remember(current,before,erase?'erased stroke':'drawing edit')
      current.changeNumber++;current.applied.add(id);revision++
      await checkpoint()
      response.json(snapshot(current))
    })
    editQueue=operation.catch(()=>{});operation.catch(next)
  })
  web.post("/api/word-image/:id", express.raw({ type: "application/octet-stream", limit: maxBytes }), (request, response, next) => {
    const operation = editQueue.then(async () => {
      const current = document
      const json=request.is('application/json')
      if(json&&(typeof request.body.png!=='string'||request.body.png.length>6*1024*1024))return response.sendStatus(400)
      const imageBytes=json?Buffer.from(request.body.png,'base64'):request.body
      const index = Number(request.get("X-Paragraph-Index"))
      const operationId = request.get("X-Operation-Id")
      if (current?.id !== request.params.id || !current.word || !Buffer.isBuffer(imageBytes)) return response.sendStatus(409)
      if (current.applied.has(operationId)) { await checkpoint(); return response.json(snapshot(current)) }
      if (!Number.isInteger(index) || !current.word.lines[index] || !/^[a-zA-Z0-9-]{12,80}$/.test(operationId || "") ||
        Number(request.get("X-Document-Version")) !== current.contentVersion) return response.status(409).json({ error: "Select the paragraph again." })
      const before = history.capture(current)
      const engine = await import("./pdf-edit.mjs")
      const position = json?request.body.position:request.get('X-Word-Ink') ? JSON.parse(request.get('X-Word-Ink')) : undefined
      const image = { ...engine.imageInfo(imageBytes), bytes: imageBytes, index, position }
      const bytes = await saveWord(current.word, current.wordEdits, current.wordFormats, undefined, image)
      await applyWordBytes(current, bytes, !position)
      for(const role of Object.keys(previews))if(previews[role].mark?.id===operationId){delete previews[role];previewSequence++}
      history.remember(current, before,position?'drawing stroke':'image insertion')
      current.changeNumber++
      current.applied.add(operationId)
      revision++
      await checkpoint()
      inkCommits.set(operationId,current.contentVersion)
      publish("refresh")
      while(inkCommits.size>128)inkCommits.delete(inkCommits.keys().next().value)
      publish('refresh')
      response.json(snapshot(current))
    })
    editQueue = operation.catch(() => {})
    operation.catch(next)
  })
  async function applyEdit(request, response) {
    const current = documents.get(request.params.id)
    if (!current || current.id !== request.params.id) return response.status(409).json({ error: "The open document changed." })
    if (request.collaborator && collaboration.get(request.collaboratorToken)?.id !== request.collaborator.id) return response.sendStatus(401)
    const edit = request.body
    if (!edit || !/^[a-zA-Z0-9-]{12,80}$/.test(edit.id ?? "")) return response.sendStatus(400)
    if (current.applied.has(edit.id)) { await checkpoint(); return response.json(snapshot(current)) }
    if (current.applied.size >= 30000) throw new Error("Save a copy and reopen it to continue editing.")
    const before = history.capture(current)
    if (edit.kind === "history-undo" || edit.kind === "history-redo") {
      if (collaboration.hasGuests(current.id)) return response.status(409).json({ error: "End the collaboration before restoring whole-document history." })
      history.restore(current, edit.kind === "history-undo" ? "undo" : "redo")
    } else if (edit.kind === "pages" && current.extension === "pdf" && edit.version === current.contentVersion) {
      const engine = await import("./pdf-edit.mjs")
      const version = current.contentVersion
      const exported = await exportFile(current.id, {excludeMarks:edit.action === "plan"})
      if (documents.get(current.id) !== current || version !== current.contentVersion) return response.sendStatus(409)
      const result = engine.organize(exported.bytes, edit.action, edit.pages)
      current.bytes = result.bytes
      current.pages = result.pages
      current.marks = edit.action === "plan" ? edit.pages.flatMap((item,index) => current.marks.filter(mark => mark.page === item.index+1).map(mark => ({...mark,id:edit.id+"-"+index+"-"+mark.id,group:mark.group?edit.id+"-"+index+"-"+mark.group:undefined,page:index+1}))) : []
      current.fields = Object.create(null)
      current.originalFields = fieldValues(await PDFDocument.load(current.bytes))
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
    } else if (edit.kind === "form-author" && current.extension === "pdf") {
      if (edit.version !== current.contentVersion) throw Object.assign(new Error("The PDF changed. Reopen the form tools."), { status: 409 })
      const bytes = await (await import("./form-authoring.mjs")).authorForm(current.bytes, edit.changes, current.fields)
      if (bytes.length > maxBytes) throw new Error("The updated PDF exceeds the document size limit.")
      const originalFields = fieldValues(await PDFDocument.load(bytes))
      current.bytes = Buffer.from(bytes)
      current.originalFields = originalFields
      current.fields = Object.create(null)
      current.contentVersion++
    } else if (edit.kind === "word-tools" && current.word) {
      if (edit.version !== current.contentVersion) throw Object.assign(new Error("The document changed. Select the text again."), { status: 409 })
      const parsed = await readWord(await saveWord(current.word, current.wordEdits, current.wordFormats), "docx")
      const { DOMParser, XMLSerializer } = require("@xmldom/xmldom")
      const { strFromU8, strToU8, zipSync } = require("fflate")
      ;(await import("./word-tools.mjs")).editWord(parsed.document, parsed.archive, edit, DOMParser, XMLSerializer, strFromU8, strToU8)
      parsed.archive["word/document.xml"] = strToU8(new XMLSerializer().serializeToString(parsed.document))
      const { nonStructuralWordAction } = await import("./word-advanced-structure.mjs")
      await applyWordBytes(current, Buffer.from(zipSync(parsed.archive)), !nonStructuralWordAction(edit.action))
    } else if (edit.kind === "review" && current.extension === "pdf") {
      if (edit.version !== current.contentVersion) throw Object.assign(new Error("The page changed. Review the latest page."), { status: 409 })
      current.bytes = (await import("./pdf-tools.mjs")).review(current.bytes, edit)
      current.contentVersion++
    } else if (edit.kind === "ink-cut" && current.extension === "pdf") {
      current.marks = (await import("./ink-cut.mjs")).applyInkCut(current.marks,edit)
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
      if ((edit.structureVersion ?? 0) !== (current.structureVersion || 0)) return response.status(409).json({ error: "The paragraph order changed. Your draft is retained; review it before applying to the latest document.", code: "STRUCTURE_CONFLICT" })
      const existing = current.wordEdits[edit.index] ?? current.word.lines[edit.index].text
      const proposed = existing === edit.before ? edit.value :
        collaboration.hasGuests(current.id) ? mergeParagraph(edit.before, existing, edit.value) : undefined
      if (proposed === undefined || proposed.length > 16000) return response.status(409).json({ error: "Another editor changed the same paragraph.", code: "EDIT_CONFLICT", actual: existing })
      current.wordEdits[edit.index] = proposed
      current.contentVersion++
    } else if (edit.kind === "field" && current.extension === "pdf" && typeof edit.name === "string" && edit.name.length <= 300 && validFieldValue(edit.value)) {
      const actual = current.fields[edit.name] ?? current.originalFields?.[edit.name] ?? ""
      if (Object.hasOwn(edit, "before") && !sameValue(edit.before, actual)) return response.status(409).json({ error: "This field changed on the other device.", code: "EDIT_CONFLICT", actual })
      const field = (await PDFDocument.load(current.bytes)).getForm().getFieldMaybe(edit.name)
      if (!field) throw new Error("This PDF field no longer exists.")
      setFieldValue(field, edit.value)
      if (field instanceof PDFTextField && typeof edit.value === "string") (await latinFont).encodeText(edit.value)
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
        if(previews[request.role]?.mark?.id===edit.id){delete previews[request.role];previewSequence++}
        current.marks.push({ id: edit.id, page: edit.page, kind: "ink", points: edit.points, ...inkStyle(edit) })
      } else if (edit.kind === "text" && typeof edit.value === "string" && edit.value.trim() && edit.value.length <= 400 && isPoint(edit.at) && Number.isFinite(edit.angle) && Math.abs(edit.angle) <= 360 && [10, 12, 14, 18, 24].includes(edit.size)) {
        (await latinFont).encodeText(edit.value)
        current.marks.push({ id: edit.id, page: edit.page, kind: "text", at: edit.at, angle: edit.angle, size: edit.size, value: edit.value })
      } else return response.status(400).json({ error: "This change could not be applied." })
    } else return response.status(400).json({ error: "This change could not be applied." })
    if (edit.kind !== "history-undo" && edit.kind !== "history-redo") {
      const labels={word:'text edit',replace:'text replacement',field:'form edit',ink:'drawing stroke',signature:'signature',undo:'erased mark',pages:'page change',text:'added text'}
      history.remember(current,before,labels[edit.kind]||'document edit')
    }
    if (["history-undo", "history-redo"].includes(edit.kind) && current.word) current.structureVersion = (current.structureVersion || 0) + 1
    current.applied.add(edit.id)
    if (request.collaborator || collaboration.hasGuests(current.id)) {
      const author = request.collaborator || { id: request.role === "pc" ? "host" : "phone", name: request.role === "pc" ? "Host" : "Paired phone" }
      current.collaborationActivity = [...(current.collaborationActivity || []), { author: author.name, participant: author.id, operation: edit.id, kind: edit.kind, at: Date.now() }].slice(-100)
    }
    current.changeNumber++
    revision++
    await checkpoint()
    publish('refresh')
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
  web.post("/api/protect/:id", async (request, response) => {
    try {
      const exported = await exportFile(request.params.id)
      if (exported.extension !== "pdf") throw new Error("Open a PDF to set its password.")
      const { protectPdf } = await import("./pdf-protection.mjs")
      response.type("application/pdf").send(Buffer.from(protectPdf(exported.bytes, request.body.password)))
    } catch (error) { response.status(400).json({ error: error.message }) }
  })
  web.post("/api/decorate/:id", async (request, response) => {
    try {
      const exported = await exportFile(request.params.id)
      if (exported.extension !== "pdf") throw new Error("Open a PDF first.")
      const options = request.body
      if (["header","footer","watermark"].some(key => options[key] && (typeof options[key] !== "string" || options[key].length > 120))) throw new Error("Keep each label under 120 characters.")
      response.type("application/pdf").send(Buffer.from(await (await import("./document-extras.mjs")).decoratePdf(exported.bytes, options)))
    } catch (error) { response.status(400).json({error:error.message}) }
  })
  web.get("/api/info/:id", async (request, response) => {
    const exported = await exportFile(request.params.id)
    response.json(exported.extension === "pdf" ? (await import("./document-extras.mjs")).documentInfo(exported.bytes) : {bytes:exported.bytes.length,type:exported.extension})
  })
  web.get('/api/extract-images/:id',async(request,response)=>{
    try{const exported=await exportFile(request.params.id);if(exported.extension!=='pdf')throw new Error('Open a PDF first.');response.type('application/zip').send(Buffer.from((await import('./document-extras.mjs')).extractImages(exported.bytes)))}catch(error){response.status(400).json({error:error.message})}
  })
  web.post('/api/redact/:id',async(request,response)=>{
    try{const exported=await exportFile(request.params.id);if(exported.extension!=='pdf')throw new Error('Open a PDF first.');response.type('application/pdf').send(Buffer.from((await import('./document-extras.mjs')).redactPdf(exported.bytes,request.body)))}catch(error){response.status(400).json({error:error.message})}
  })
  web.post("/api/rename/:id", async (request, response) => {
    try { await renameDocument(request.params.id, request.body.name); response.json(snapshot(document)) }
    catch (error) { response.status(400).json({ error: error.message }) }
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
    const listener = web.listen(port, "0.0.0.0", error => {
      if (error) reject(error)
      else resolve(listener)
    })
  })
  if (recoveryDirectory) require("./discovery.cjs").advertise(server)
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
      const tabs = workspace.documents || []
      const restoreOrder = [...tabs].sort((a,b) => Number(b.id === workspace.active) - Number(a.id === workspace.active))
      for (const [index, saved] of restoreOrder.entries()) {
        onRestore?.(index + 1, tabs.length, saved.filename)
        try {
          await restoreTab(saved)
        } catch { failedTabs.set(saved.id, saved) }
      }
      // Restore the original tab order after prioritizing the active document.
      for (const saved of tabs) {
        const tab = documents.get(saved.id)
        if (tab) { documents.delete(saved.id); documents.set(saved.id, tab) }
      }
      document = documents.get(workspace.active) || [...documents.values()].at(-1) || null
    } catch (error) {
      if (error.code !== "ENOENT") recoveryWarning = "The editing session could not be recovered. Your saved library is still available in Files."
    }
  }

  restoringWorkspace = false

  async function restoreTab(saved) {
    if (!/^[a-f0-9-]+\.bin$/.test(saved.source)) throw new Error("Invalid recovery source")
    await openNow(saved.filename, await fs.readFile(path.join(recoveryDirectory, saved.source)), true)
    documents.delete(document.id)
    Object.assign(document, saved, { bytes: document.bytes, word: document.word, applied: new Set(saved.applied),
      fields: Object.assign(Object.create(null), saved.fields), wordEdits: Object.assign(Object.create(null), saved.wordEdits),
      wordFormats: Object.assign(Object.create(null), saved.wordFormats), ocr: Object.assign(Object.create(null), saved.ocr),
      changeNumber: saved.changeNumber ?? saved.applied.length, savedNumber: saved.savedNumber ?? 0 })
    documents.set(document.id, document)
  }

  web.post("/api/recovery/retry/:id", async (request, response) => {
    if (request.role !== "pc") return response.sendStatus(403)
    const operation = editQueue.then(async () => {
      const saved = failedTabs.get(request.params.id)
      if (!saved) return
      await restoreTab(saved)
      failedTabs.delete(saved.id)
      await checkpoint()
      publish("refresh")
    })
    editQueue = operation.catch(() => {})
    try { await operation; response.sendStatus(204) }
    catch { response.status(422).json({error:"This tab still cannot be recovered. Its saved recovery entry is retained."}) }
  })

  async function checkpoint() {
    if (!recoveryDirectory) return
    const entries = [...documents.values()].map(current => ({ current, bytes: current.bytes, metadata: {
      id: current.id, filename: current.filename, source: current.id + "-" + current.contentVersion + ".bin", contentVersion: current.contentVersion, structureVersion: current.structureVersion || 0, libraryId: current.libraryId,
      fields: { ...current.fields }, wordEdits: { ...current.wordEdits }, wordFormats: structuredClone(current.wordFormats), marks: structuredClone(current.marks),
      ocr: structuredClone(current.ocr), applied: [...current.applied], collaborationActivity: current.collaborationActivity, changeNumber: current.changeNumber, savedNumber: current.savedNumber
    } }))
    const metadata = JSON.stringify({ active: document?.id, documents: [...entries.map(entry => entry.metadata), ...failedTabs.values()] })
    checkpointQueue = checkpointQueue.catch(() => {}).then(async () => {
      await fs.mkdir(recoveryDirectory, { recursive: true })
      for (const entry of entries) {
        const target = path.join(recoveryDirectory, entry.metadata.source)
        try { await fs.access(target) } catch {
          await durableWrite(target, entry.bytes)
        }
      }
      await durableWrite(path.join(recoveryDirectory, "workspace.pending.json"), metadata)
      await fs.copyFile(path.join(recoveryDirectory, "workspace.json"), path.join(recoveryDirectory, "workspace.backup.json")).catch(error => { if (error.code !== "ENOENT") throw error })
      await fs.rename(path.join(recoveryDirectory, "workspace.pending.json"), path.join(recoveryDirectory, "workspace.json"))
      // Retain the previous workspace's sources as well, so its recovery index remains usable.
      let backup = []
      try { backup = JSON.parse(await fs.readFile(path.join(recoveryDirectory, "workspace.backup.json"), "utf8")).documents || [] } catch {}
      const keep = new Set([...entries.map(entry => entry.metadata.source), ...[...failedTabs.values()].map(entry => entry.source), ...backup.map(entry => entry.source)])
      for (const file of await fs.readdir(recoveryDirectory)) if (/^[a-f0-9-]+\.bin$/.test(file) && !keep.has(file)) await fs.unlink(path.join(recoveryDirectory, file)).catch(() => {})
    })
    return checkpointQueue
  }

  function snapshot(current) {
    return {
      id: current.id, filename: current.filename, extension: current.extension, pages: current.pages, contentVersion: current.contentVersion, structureVersion: current.structureVersion || 0,
      saveExtension: current.extension === "doc" && (Object.keys(current.wordEdits).length || Object.keys(current.wordFormats).length) ? "docx" : current.extension,
      marks: current.marks, fields: current.fields, originalFields: current.originalFields || {},
      canUndo: current.undo.length > 0, canRedo: current.redo.length > 0,
      undoLabel:current.undo.at(-1)?.historyLabel,redoLabel:current.redo.at(-1)?.historyLabel,
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
      next.originalFields = fieldValues(pdf)
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
    const marks = options.excludeMarks ? [] : [...current.marks]
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
          if (!field) throw new Error("This PDF field no longer exists.")
          setFieldValue(field, value)
        }
        form.updateFieldAppearances(font)
      }
      for (const mark of marks) {
        const page = pdf.getPage(mark.page - 1)
        const inkColor = mark.color ? rgb(...[1, 3, 5].map(offset => parseInt(mark.color.slice(offset, offset + 2), 16) / 255)) : color
        if (mark.kind === "text") {
          page.drawText(mark.value, { x: mark.at[0], y: mark.at[1], size: mark.size, rotate: degrees(mark.angle), font, color })
        } else {
          drawPdfInk(page,mark,inkColor)
        }
      }
      if (options.flatten) (await import('./pdf-fields.mjs')).flattenPdfForm(pdf)
      bytes = await pdf.save({ updateFieldAppearances: false })
    }
    return { filename: stem + (options.flatten ? " - final." : " - copy.") + extension, bytes, extension, changeNumber }
  }

  async function renameDocument(id, name) {
    const current = [...documents.values()].find(item => item.id === id)
    if (!current || typeof name !== "string" || !name.trim() || name.length > 180 || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || path.extname(name).toLowerCase() !== "." + current.extension) throw new Error("Use a valid filename and keep its current extension.")
    current.filename = name.trim(); revision++; await checkpoint()
  }
  return { server, owner, address: "http://127.0.0.1:" + server.address().port, maxBytes, open, exportFile, markSaved, renameDocument,
    setWordRenderer: renderer=>{wordRenderer=renderer}, getDocument: () => document ? snapshot(document) : null }
}

module.exports = { start }
if (require.main === module) start().then(({ address, owner }) => console.log(address + "/#owner=" + owner))
