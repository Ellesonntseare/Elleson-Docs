const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const { Document, Paragraph, Packer } = require("docx")
const { readWord, saveWord } = require("../word.cjs")

test("Word formatting, lists, tables and images are saved without changing the source", async () => {
  const original = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("Original"), new Paragraph("Keep this paragraph")] }] }))
  const source = await readWord(original, "docx")
  const edited = await saveWord(source, { 0: "Edited" }, {
    0: { font: "Georgia", size: 18, bold: true, italic: true, align: "center", list: "bullet" }
  }, { index: 0, rows: 2, columns: 2 })
  const reopened = await readWord(edited, "docx")
  assert.equal(reopened.lines[0].text, "Edited")
  assert.ok(reopened.lines.some(line => line.text === "Keep this paragraph"))
  const namespace = reopened.document.documentElement.namespaceURI
  assert.equal(reopened.document.getElementsByTagNameNS(namespace, "tbl").length, 1)
  assert.equal(reopened.document.getElementsByTagNameNS(namespace, "b")[0].getAttributeNS(namespace, "val"), "1")
  assert.equal(reopened.document.getElementsByTagNameNS(namespace, "sz")[0].getAttributeNS(namespace, "val"), "36")
  assert.ok(reopened.archive["word/numbering.xml"])
  assert.equal(source.lines[0].text, "Original")
  assert.equal(source.document.getElementsByTagNameNS(namespace, "tbl").length, 0)
  const imageBytes = await fs.readFile(path.join(__dirname, "../web/logo.png"))
  const withImage = await saveWord(reopened, {}, {}, undefined, { index: 0, bytes: imageBytes, type: "png", width: 1254, height: 1254 })
  const imaged = await readWord(withImage, "docx")
  assert.equal(imaged.document.getElementsByTagNameNS(namespace, "drawing").length, 1)
  assert.equal(imaged.document.getElementsByTagNameNS(namespace, "tbl").length, 1)
  const images = Object.keys(imaged.archive).filter(name => name.startsWith("word/media/"))
  assert.equal(images.length, 1)
  assert.deepEqual(Buffer.from(imaged.archive[images[0]]), imageBytes)
})

test("text edits preserve real floating-image packages, sections, revisions and header parts", async () => {
  const { zipSync } = require("fflate")
  const { Header, TextRun, ImageRun, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom } = require("docx")
  const { XMLSerializer } = require("@xmldom/xmldom")
  const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  const image = await fs.readFile(path.join(__dirname,"../web/logo.png"))
  const bytes = await Packer.toBuffer(new Document({sections:[{
    headers:{default:new Header({children:[new Paragraph('Header')]})},
    children:[new Paragraph('Edit me'),new Paragraph({children:[
      new ImageRun({data:image,type:'png',transformation:{width:100,height:100},floating:{horizontalPosition:{relative:HorizontalPositionRelativeFrom.COLUMN,offset:0},verticalPosition:{relative:VerticalPositionRelativeFrom.PARAGRAPH,offset:0}}}),
      new TextRun('Tracked'),new TextRun(' tail')
    ]})]
  }]}))
  let source=await readWord(bytes,'docx')
  const document=source.document,paragraph=document.getElementsByTagNameNS(ns,'p')[1]
  const run=Array.from(paragraph.getElementsByTagNameNS(ns,'r')).find(run=>run.textContent==='Tracked')
  const insertion=document.createElementNS(ns,'w:ins');insertion.setAttributeNS(ns,'w:id','7');insertion.setAttributeNS(ns,'w:author','Reviewer');insertion.setAttributeNS(ns,'w:date','2026-11-15T10:00:00Z');run.parentNode.insertBefore(insertion,run);insertion.appendChild(run)
  const deletion=document.createElementNS(ns,'w:del');deletion.setAttributeNS(ns,'w:id','8');deletion.setAttributeNS(ns,'w:author','Reviewer');deletion.setAttributeNS(ns,'w:date','2026-11-15T10:00:00Z');const deletedRun=document.createElementNS(ns,'w:r'),deletedText=document.createElementNS(ns,'w:delText');deletedText.textContent='Deleted';deletedRun.appendChild(deletedText);deletion.appendChild(deletedRun);paragraph.appendChild(deletion)
  const serializer=new XMLSerializer()
  source.archive['word/document.xml']=Buffer.from(serializer.serializeToString(document))
  source=await readWord(zipSync(source.archive),'docx')
  const headerName=Object.keys(source.archive).find(name=>/^word\/header.*\.xml$/.test(name))
  assert.ok(headerName)
  const result=await readWord(await saveWord(source,{0:'Edited text',1:'Tracked edited tail'}),'docx')
  assert.equal(result.lines[0].text,'Edited text');assert.equal(result.lines[1].text,'Tracked edited tail')
  assert.deepEqual(result.archive[headerName],source.archive[headerName])
  assert.ok(result.archive['[Content_Types].xml']);assert.ok(result.archive['word/_rels/document.xml.rels'])
  for(const tag of ['drawing','ins','del','sectPr']) assert.deepEqual(Array.from(result.document.getElementsByTagNameNS(ns,tag),n=>serializer.serializeToString(n)),Array.from(source.document.getElementsByTagNameNS(ns,tag),n=>serializer.serializeToString(n)))
})
