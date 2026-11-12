import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import mupdf from 'mupdf'
import { unzipSync } from 'fflate'
import { pageSize, selectedPages, archive, textPdf, combinePdfs, extractPages, wordBytes } from '../conversion-engine.mjs'
import { applyScanFilter } from '../scan-filters.mjs'
import { protectPdf } from '../pdf-protection.mjs'

test('conversion preserves ordered pages, validates selection and gives duplicate outputs distinct names', async () => {
  const a = await textPdf('First page', { size: 'letter' }), b = await textPdf('Second page', { size: 'a4' })
  const bytes = await combinePdfs([a,b]), pdf = await PDFDocument.load(bytes)
  assert.equal(pdf.getPageCount(), 2); assert.equal(pdf.getPage(0).getWidth(), 612)
  const extracted = await PDFDocument.load(await extractPages(bytes, '2,1'))
  assert.equal(extracted.getPage(1).getWidth(), 612)
  assert.deepEqual(selectedPages('1,3-4,3', 4), [0,2,3])
  assert.throws(() => selectedPages('0,5', 4)); assert.throws(() => pageSize({size:'custom',width:0,height:297}))
  assert.equal(Object.keys(unzipSync(archive([{ name:'same.pdf',bytes:a },{ name:'same.pdf',bytes:b }]))).length, 2)
  assert.ok(unzipSync(await wordBytes('New document'))['word/document.xml'])
})
test('password-protected PDF requires the right password and leaves input unchanged', async () => {
  const original = await textPdf('Private document', {}), snapshot = original.slice()
  const secured = protectPdf(original, 'Test password 123!'), pdf = mupdf.Document.openDocument(secured, 'application/pdf')
  try { assert.equal(pdf.needsPassword(), true); assert.equal(pdf.authenticatePassword('wrong'), 0); assert.ok(pdf.authenticatePassword('Test password 123!')); assert.equal(pdf.countPages(), 1) } finally { pdf.destroy() }
  assert.deepEqual(original, snapshot)
  assert.throws(() => protectPdf(original, 'short'))
})
test('scanner original, grayscale, black-white and colour filters behave distinctly without changing alpha', () => {
  const pixels = new Uint8ClampedArray([200,80,30,255,240,230,210,255])
  assert.deepEqual(applyScanFilter(pixels.slice(), 2, 1, {filter:'photo'}), pixels)
  const gray = applyScanFilter(pixels.slice(),2,1,{filter:'grayscale'})
  assert.equal(gray[0], gray[1]); assert.equal(gray[1],gray[2])
  const bw = applyScanFilter(pixels.slice(),2,1,{filter:'bw'})
  assert.equal(bw[0],0); assert.equal(bw[4],255)
  const colour = applyScanFilter(pixels.slice(),2,1,{filter:'colour'})
  assert.notEqual(colour[0],colour[1]); assert.equal(colour[3],255)
})
