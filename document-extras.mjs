import * as mupdf from 'mupdf'
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'
import {zipSync} from 'fflate'
export function extractImages(bytes) {
 const pdf=new mupdf.PDFDocument(bytes),files={};let total=0,count=0
 try{
  for(let i=0;i<pdf.countPages();i++){
   const page=pdf.loadPage(i),text=page.toStructuredText('preserve-images')
   try{text.walk({onImageBlock(_rect,_transform,image){
    if(image.getWidth()*image.getHeight()>40000000)throw new Error('An image exceeds the extraction limit.')
    const pixmap=image.toPixmap()
    try{const data=pixmap.asPNG();total+=data.length;if(total>100*1024*1024||count>=200)throw new Error('Extract fewer pages: image output exceeds the limit.');files[`Page ${i+1} - image ${++count}.png`]=data.slice()}finally{pixmap.destroy()}
   }})}finally{text.destroy();page.destroy()}
  }
  if(!count)throw new Error('This PDF contains no extractable bitmap images.')
  return zipSync(files)
 }finally{pdf.destroy()}
}

export function unlockPdf(bytes, password) {
  const pdf = new mupdf.PDFDocument(bytes)
  try {
    if (pdf.needsPassword() && !pdf.authenticatePassword(password || '')) throw new Error('The PDF password is incorrect.')
    const buffer = pdf.saveToBuffer({ encrypt: 'none', garbage: 1, compress: true })
    try { return buffer.asUint8Array().slice() } finally { buffer.destroy() }
  } finally { pdf.destroy() }
}
export function needsPassword(bytes) {
  const pdf=new mupdf.PDFDocument(bytes)
  try{return pdf.needsPassword()}finally{pdf.destroy()}
}
export function redactPdf(bytes, options) {
  const pdf=new mupdf.PDFDocument(bytes)
  try {
    if(!Number.isInteger(options.page)||options.page<1||options.page>pdf.countPages())throw new Error('Choose a valid page.')
    const rect=options.rect
    if(!Array.isArray(rect)||rect.length!==4||!rect.every(Number.isFinite)||rect[2]<=rect[0]||rect[3]<=rect[1])throw new Error('Choose a nonempty redaction rectangle.')
    const page=pdf.loadPage(options.page-1)
    try {
      const bounds=page.getBounds()
      if(rect[0]<bounds[0]||rect[1]<bounds[1]||rect[2]>bounds[2]||rect[3]>bounds[3])throw new Error('Keep the redaction inside the page.')
      const annotation=page.createAnnotation('Redact');annotation.setRect(rect);annotation.update()
      annotation.applyRedaction(1,mupdf.PDFPage.REDACT_IMAGE_PIXELS,mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_TOUCHED,mupdf.PDFPage.REDACT_TEXT_REMOVE)
      const buffer=pdf.saveToBuffer('garbage=4,compress,clean')
      try{return buffer.asUint8Array().slice()}finally{buffer.destroy()}
    }finally{page.destroy()}
  }finally{pdf.destroy()}
}
export async function decoratePdf(bytes, options) {
  const pdf = await PDFDocument.load(bytes), font = await pdf.embedFont(StandardFonts.Helvetica)
  for (const [index,page] of pdf.getPages().entries()) {
    if (options.pages?.length && !options.pages.includes(index + 1)) continue
    const {width,height} = page.getSize()
    for (const [text,y] of [[options.header,height - 24],[options.footer,24],[options.numbers ? `Page ${index + 1} of ${pdf.getPageCount()}` : '',12]]) {
      if (text) page.drawText(text,{x:Math.max(8,(width-font.widthOfTextAtSize(text,10))/2),y,size:10,font,color:rgb(.2,.2,.2)})
    }
    if (options.watermark) page.drawText(options.watermark,{x:width*.16,y:height*.35,size:Math.min(46,width/Math.max(options.watermark.length,1)),font,color:rgb(.25,.4,.32),opacity:.22,rotate:degrees(35)})
  }
  return pdf.save()
}
export function documentInfo(bytes) {
  const pdf = new mupdf.PDFDocument(bytes)
  try {
    const pages = []
    for (let i=0;i<pdf.countPages();i++) {
      const page=pdf.loadPage(i), text=page.toStructuredText()
      try { pages.push({page:i+1,bounds:page.getBounds(),searchable:!!text.asText().trim()}) } finally {text.destroy();page.destroy()}
    }
    return {bytes:bytes.length,pages,title:pdf.getMetaData('info:Title') || '',encrypted:pdf.needsPassword()}
  } finally {pdf.destroy()}
}
