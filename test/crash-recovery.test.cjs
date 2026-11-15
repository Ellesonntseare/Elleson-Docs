const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs/promises')
const os=require('node:os')
const path=require('node:path')
const {spawn}=require('node:child_process')
const {once}=require('node:events')
const {PDFDocument}=require('pdf-lib')
const {start}=require('../server.cjs')
const {durableWrite}=require('../durable-files.cjs')

test('acknowledged PDF progress survives forced host termination', {timeout:20000},async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'elleson-crash-'))
  const script=`const {start}=require('./server.cjs'); const {PDFDocument}=require('pdf-lib'); (async()=>{const host=await start(0,process.argv[1]);const pdf=await PDFDocument.create();pdf.addPage();await host.open('crash.pdf',await pdf.save());process.send({address:host.address,owner:host.owner,id:host.getDocument().id})})().catch(e=>{process.send({error:e.message});process.exit(1)})`
  const child=spawn(process.execPath,['-e',script,directory],{cwd:path.resolve(__dirname,'..'),stdio:['ignore','ignore','pipe','ipc']})
  let restored
  try {
    const [ready]=await once(child,'message')
    assert.equal(ready.error,undefined)
    const response=await fetch(ready.address+'/api/edit/'+ready.id,{method:'POST',headers:{Authorization:'Bearer '+ready.owner,'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),kind:'text',page:1,value:'Recovered after termination',at:[30,400],size:12,angle:0})})
    assert.equal(response.status,200);await response.json()
    const exited=once(child,'exit');child.kill('SIGKILL');await exited
    restored=await start(0,directory)
    assert.equal(restored.getDocument().id,ready.id)
    assert.equal(restored.getDocument().marks[0].value,'Recovered after termination')
    assert.equal((await PDFDocument.load((await restored.exportFile(ready.id)).bytes)).getPageCount(),1)
  } finally {
    if (child.exitCode===null) child.kill('SIGKILL')
    if(restored)await new Promise(resolve=>restored.server.close(resolve))
    await fs.rm(directory,{recursive:true,force:true})
  }
})

test('failed replacement leaves the existing destination intact and cleans its temporary file',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'elleson-save-')),target=path.join(directory,'document.pdf')
  try {
    await durableWrite(target,Buffer.from('Original'))
    await assert.rejects(durableWrite(target,{}))
    assert.equal(await fs.readFile(target,'utf8'),'Original')
    assert.deepEqual(await fs.readdir(directory),['document.pdf'])
    await durableWrite(target,Buffer.from('Complete replacement'))
    assert.equal(await fs.readFile(target,'utf8'),'Complete replacement')
  } finally {await fs.rm(directory,{recursive:true,force:true})}
})

test('retrying an edit after recovery storage fails must persist it before acknowledging',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'elleson-storage-failure-'))
  let host=await start(0,directory)
  const originalOpen=fs.open
  try {
    const pdf=await PDFDocument.create();pdf.addPage();await host.open('storage.pdf',await pdf.save())
    const id=host.getDocument().id,payload={id:crypto.randomUUID(),kind:'text',page:1,value:'Retried safely',at:[30,400],size:12,angle:0}
    let failed=false
    fs.open=async function(target,...args){if(!failed&&String(target).includes('workspace.pending.json.elleson-')){failed=true;throw Object.assign(new Error('Simulated disk full'),{code:'ENOSPC'})};return originalOpen.call(this,target,...args)}
    const request=()=>fetch(host.address+'/api/edit/'+id,{method:'POST',headers:{Authorization:'Bearer '+host.owner,'Content-Type':'application/json'},body:JSON.stringify(payload)})
    assert.equal((await request()).status,422)
    fs.open=originalOpen
    assert.equal((await request()).status,200)
    await new Promise(resolve=>host.server.close(resolve));host=await start(0,directory)
    assert.equal(host.getDocument().marks[0].value,'Retried safely')
  } finally {fs.open=originalOpen;await new Promise(resolve=>host.server.close(resolve));await fs.rm(directory,{recursive:true,force:true})}
})
