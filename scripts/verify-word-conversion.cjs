const { _electron } = require('playwright')
const { Document, Paragraph, TextRun, Packer, Table, TableRow, TableCell } = require('docx')
const {PDFDocument}=require('pdf-lib')
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict')
;(async()=>{
 const scratch=await fs.mkdtemp(path.resolve('.build/word-print-'))
 const bytes=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph({children:[new TextRun({text:'Layout conversion',bold:true,size:36})]}),new Table({rows:[new TableRow({children:[new TableCell({children:[new Paragraph('Left cell')]}),new TableCell({children:[new Paragraph('Right cell')]})]})]})]}]}))
 const app=await _electron.launch({...(process.argv[2]?{executablePath:path.resolve(process.argv[2]),args:[]}:{args:[path.resolve('.')]}),timeout:45000,env:{...process.env,ELLESON_DOCS_TEST:'1',ELLESON_DOCS_USER_DATA:scratch}})
 try{const page=await app.firstWindow();await page.waitForFunction(()=>!!window.desktopDocs);const result=await page.evaluate(bytes=>window.desktopDocs.wordToPdf(bytes),Array.from(bytes));const pdf=await PDFDocument.load(Uint8Array.from(result));assert.ok(pdf.getPageCount()>=1);await fs.writeFile(path.join(scratch,'converted.pdf'),Buffer.from(result));console.log('Native Word layout conversion produced a readable PDF:',path.join(scratch,'converted.pdf'))}finally{await app.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
