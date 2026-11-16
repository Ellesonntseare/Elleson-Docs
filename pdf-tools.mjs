import * as mupdf from "mupdf"
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString } from "pdf-lib"
const toBytes = value => typeof Buffer !== "undefined" ? Buffer.from(value) : Uint8Array.from(value)
const transform = ([x, y], m) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]]
const save = document => { const buffer = document.saveToBuffer("garbage=1,compress"); const bytes = toBytes(buffer.asUint8Array()); buffer.destroy(); return bytes }

export function reviewList(bytes, index) {
  const document = new mupdf.PDFDocument(bytes), page = document.loadPage(index)
  try { return page.getAnnotations().filter(annotation => ["Text", "Underline", "StrikeOut", "Highlight"].includes(annotation.getType())).map(annotation => ({
    id: annotation.getObject().get("NM").asString() || "ref-" + annotation.getObject().asIndirect(), type: annotation.getType(), text: annotation.getContents(), author: annotation.getAuthor(), resolved: annotation.getObject().get("State").asString() === "Accepted",
    replyTo: annotation.getObject().get("IRT").isNull() ? null : annotation.getObject().get("IRT").get("NM").asString() || "ref-" + annotation.getObject().get("IRT").asIndirect()
  })) } finally { page.destroy(); document.destroy() }
}
export function review(bytes, edit) {
  const document = new mupdf.PDFDocument(bytes), page = document.loadPage(edit.page - 1)
  try {
    if (edit.action === 'resolve') {
      const selected = page.getAnnotations().find(annotation => (annotation.getObject().get('NM').asString() || 'ref-' + annotation.getObject().asIndirect()) === edit.target)
      if (!selected) throw new Error('This comment is no longer available.')
      selected.getObject().put('StateModel',document.newString('Review'))
      selected.getObject().put('State',document.newString(edit.resolved ? 'Accepted' : 'None'))
      selected.update(); return save(document)
    }
    if (!["Text", "Underline", "StrikeOut", "Highlight"].includes(edit.type) || typeof edit.text !== "string" || edit.text.length > 4000 || !Array.isArray(edit.rect) || edit.rect.length !== 4 || !edit.rect.every(Number.isFinite)) throw new Error("Choose a valid annotation.")
    const parent = edit.replyTo ? page.getAnnotations().find(annotation => (annotation.getObject().get("NM").asString() || "ref-" + annotation.getObject().asIndirect()) === edit.replyTo) : null
    if (edit.replyTo && !parent) throw new Error("This comment is no longer available.")
    const annotation = page.createAnnotation(edit.type)
    annotation.getObject().put("NM", document.newString(edit.id))
    const m = page.getTransform(), points = [[edit.rect[0], edit.rect[1]], [edit.rect[2], edit.rect[3]]].map(point => transform(point, m))
    const rect = [Math.min(points[0][0], points[1][0]), Math.min(points[0][1], points[1][1]), Math.max(points[0][0], points[1][0]), Math.max(points[0][1], points[1][1])]
    if (edit.type === "Text") annotation.setRect(rect)
    else annotation.setQuadPoints([[rect[0], rect[1], rect[2], rect[1], rect[0], rect[3], rect[2], rect[3]]])
    annotation.setContents(edit.text)
    annotation.setAuthor("Elleson Docs")
    annotation.setCreationDate(new Date())
    annotation.setFlags(mupdf.PDFAnnotation.IS_PRINT)
    if (parent) annotation.getObject().put("IRT", parent.getObject())
    annotation.update()
    return save(document)
  } finally { page.destroy(); document.destroy() }
}
export function images(bytes, index) {
  const document = new mupdf.PDFDocument(bytes), page = document.loadPage(index), text = page.toStructuredText("preserve-images")
  const result = [], inverse = mupdf.Matrix.invert(page.getTransform())
  try {
    text.walk({ onImageBlock(rect) {
      const a = transform([rect[0], rect[1]], inverse), b = transform([rect[2], rect[3]], inverse)
      result.push({ id: result.length, rect: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] })
    } })
    for(const annotation of page.getAnnotations()){
      const object=annotation.getObject(),key=object.get('EllesonPicture').asString()
      if(!key)continue
      const rect=annotation.getRect(),a=transform(rect.slice(0,2),inverse),b=transform(rect.slice(2),inverse)
      result.push({id:key,managed:true,rect:[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])]})
    }
    return result
  } finally { text.destroy(); page.destroy(); document.destroy() }
}
export async function image(bytes, imageBytes, edit) {
  if(edit.managed)return managedPicture(bytes,imageBytes,edit)
  let source = bytes
  if (edit.replace !== undefined && edit.replace !== null) {
    const selected = images(bytes, edit.page - 1)[edit.replace]
    if (!selected) throw new Error("Select the PDF image again.")
    const document = new mupdf.PDFDocument(bytes), page = document.loadPage(edit.page - 1)
    try {
      const a = transform(selected.rect.slice(0, 2), page.getTransform()), b = transform(selected.rect.slice(2), page.getTransform())
      const redact = page.createAnnotation("Redact")
      redact.setRect([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])])
      redact.update()
      redact.applyRedaction(0, mupdf.PDFPage.REDACT_IMAGE_PIXELS, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_NONE)
      source = save(document)
    } finally { page.destroy(); document.destroy() }
  }
  const pdf = await PDFDocument.load(source), page = pdf.getPage(edit.page - 1)
  const png = imageBytes[0] === 137 && imageBytes[1] === 80
  const bitmap = png ? await pdf.embedPng(imageBytes) : await pdf.embedJpg(imageBytes)
  const rect = edit.rect
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite) || rect[2] <= rect[0] || rect[3] <= rect[1]) throw new Error("Choose a valid image rectangle.")
  const factor = Math.min((rect[2] - rect[0]) / bitmap.width, (rect[3] - rect[1]) / bitmap.height)
  page.drawImage(bitmap, { x: rect[0], y: rect[1], width: bitmap.width * factor, height: bitmap.height * factor })
  return toBytes(await pdf.save())
}

export async function combineEditable(bytes, extra) {
  const destination = await PDFDocument.load(bytes), incoming = await PDFDocument.load(extra)
  const sourceForm = incoming.getForm()
  const suffix = "Imported " + crypto.randomUUID().slice(0, 8) + " "
  // Fully qualified names must be unique in the combined field tree.
  for (const field of sourceForm.getFields()) field.acroField.setPartialName(suffix + field.getName().replaceAll(".", "_"))
  const prepared = await PDFDocument.load(await incoming.save())
  const copied = await destination.copyPages(prepared, prepared.getPageIndices())
  copied.forEach(page => destination.addPage(page))
  const root = destination.getForm().acroForm
  const seen = new Set()
  for (const page of copied) {
    const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray)
    for (const ref of annotations?.asArray() || []) {
      let object = destination.context.lookup(ref)
      if (!(object instanceof PDFDict) || object.get(PDFName.of("Subtype"))?.toString() !== "/Widget") continue
      let top = ref
      while (object.has(PDFName.of("Parent"))) { top = object.get(PDFName.of("Parent")); object = destination.context.lookup(top) }
      if (!seen.has(String(top))) { root.addField(top); seen.add(String(top)) }
    }
  }
  return { bytes: toBytes(await destination.save({ updateFieldAppearances: false })), pages: destination.getPageCount() }
}

async function managedPicture(bytes,imageBytes,edit){
 const pdf=await PDFDocument.load(bytes),page=pdf.getPage(edit.page-1),context=pdf.context
 const annots=page.node.lookupMaybe(PDFName.of('Annots'),PDFArray)||context.obj([])
 let previous,previousIndex=-1
 for(let i=0;i<annots.size();i++){const item=context.lookup(annots.get(i));if(item instanceof PDFDict&&item.lookupMaybe(PDFName.of('EllesonPicture'),PDFString)?.decodeText()===edit.target){previous=item;previousIndex=i;break}}
 if(edit.target&&!previous)throw Error('Select the picture again.')
 if(edit.action==='delete'){if(previousIndex<0)throw Error('Select the picture first.');annots.remove(previousIndex);page.node.set(PDFName.of('Annots'),annots);return toBytes(await pdf.save())}
 const data=imageBytes.length?toBytes(imageBytes):toBytes(Uint8Array.from(atob(previous.lookup(PDFName.of('EllesonData'),PDFString).asString()),c=>c.charCodeAt(0)))
 if(data.length>6*1024*1024)throw Error('Choose a picture below 6 MB.')
 const bitmap=data[0]===137?await pdf.embedPng(data):await pdf.embedJpg(data),r=edit.rect
 if(!Array.isArray(r)||r.length!==4||!r.every(Number.isFinite)||r[0]<0||r[1]<0||r[2]<=r[0]||r[3]<=r[1]||r[2]>page.getWidth()||r[3]>page.getHeight())throw Error('Keep the picture inside the page.')
 const appearance=context.register(context.flateStream('q 1 0 0 1 0 0 cm /Picture Do Q',{Type:'XObject',Subtype:'Form',BBox:[0,0,1,1],Resources:{XObject:{Picture:bitmap.ref}}}))
 const key=edit.target||edit.id,encoded=typeof Buffer!=='undefined'?Buffer.from(data).toString('base64'):btoa(Array.from(data,c=>String.fromCharCode(c)).join(''))
 const annotation=context.obj({Type:'Annot',Subtype:'Stamp',Rect:r,F:4,AP:{N:appearance},NM:PDFString.of(key),EllesonPicture:PDFString.of(key),EllesonData:PDFString.of(encoded)})
 if(previousIndex>=0)annots.remove(previousIndex)
 annots.push(context.register(annotation));page.node.set(PDFName.of('Annots'),annots)
 return toBytes(await pdf.save())
}
