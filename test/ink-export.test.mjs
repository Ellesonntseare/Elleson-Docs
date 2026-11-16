import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PDFDocument,rgb} from 'pdf-lib'
import * as mupdf from 'mupdf'
import {drawPdfInk} from '../ink-export.mjs'

test('saved ink retains a pen dot and smooth curves at the original PDF coordinates',async()=>{
  const pdf=await PDFDocument.create(),page=pdf.addPage([200,200])
  drawPdfInk(page,{points:[[40,160]],width:6},rgb(0,0,0))
  drawPdfInk(page,{points:[[80,120],[100,160],[120,120],[140,140]],width:3},rgb(0,0,0))
  const doc=mupdf.Document.openDocument(await pdf.save(),'application/pdf'),rendered=doc.loadPage(0),pix=rendered.toPixmap(mupdf.Matrix.scale(2,2),mupdf.ColorSpace.DeviceRGB,false,true)
  try{
    const pixels=pix.getPixels(),components=pix.getNumberOfComponents(),stride=pix.getStride()
    const dark=(x,y)=>pixels[Math.round(y*2)*stride+Math.round(x*2)*components]<80
    assert.ok(dark(40,40),'the saved dot is visible at x=40, y=160 in PDF units')
    assert.ok(!dark(40,160),'ink is not flipped vertically')
    assert.ok(dark(80,80),'curve starts where the user began writing')
    assert.ok(dark(140,60),'curve ends at the final pen position')
  }finally{pix.destroy();rendered.destroy();doc.destroy()}
})
