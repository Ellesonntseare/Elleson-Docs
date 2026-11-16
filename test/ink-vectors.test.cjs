const {test}=require('node:test'),assert=require('node:assert/strict'),{PDFDocument}=require('pdf-lib'),{start}=require('../server.cjs')
test('eraser clips crossing segments and dots without altering distant ink',async()=>{
 const {cutStroke,erasePath,validInk,inkSvg}=await import('../web/ink-vectors.mjs')
 assert.deepEqual(cutStroke([[0,0],[100,0]],[50,0],10),[[[0,0],[40,0]],[[60,0],[100,0]]])
 assert.deepEqual(cutStroke([[0,0],[10,0],[20,0]],[50,50],2),[[[0,0],[10,0],[20,0]]])
 assert.deepEqual(erasePath([[5,5]],[[0,5],[10,5]],2),[])
 const ink={width:100,height:20,strokes:[{color:'#123456',width:2,points:[[0,10],[100,10]]}]}
 assert.ok(validInk(ink));assert.match(decodeURIComponent(inkSvg(ink)),/viewBox="0 0 100 20"/)
 assert.equal(validInk({...ink,strokes:[{...ink.strokes[0],color:'" onload="alert(1)'}]}),false)
})
test('one partial eraser gesture supports undo and redo and rejects stale targets',async()=>{
 const host=await start();let n=0
 try{
 const pdf=await PDFDocument.create();pdf.addPage();await host.open('erase.pdf',await pdf.save())
 const headers={Authorization:'Bearer '+host.owner,'Content-Type':'application/json'}
 async function edit(change,code=200){const r=await fetch(host.address+'/api/edit/'+host.getDocument().id,{method:'POST',headers,body:JSON.stringify({...change,id:'partial-erase-test-'+(++n)})});assert.equal(r.status,code,await r.clone().text());return r.json()}
 let doc=await edit({kind:'ink',page:1,points:[[0,10],[100,10]],color:'#000000',width:2})
 const original=structuredClone(doc.marks)
 const items=[{target:original[0].id,before:original[0].points,fragments:[[[0,10],[40,10]],[[60,10],[100,10]]]}]
 doc=await edit({kind:'ink-cut',page:1,items});assert.equal(doc.marks.length,2)
 doc=await edit({kind:'history-undo'});assert.deepEqual(doc.marks,original)
 doc=await edit({kind:'history-redo'});assert.equal(doc.marks.length,2)
 const r=await fetch(host.address+'/api/edit/'+doc.id,{method:'POST',headers,body:JSON.stringify({kind:'ink-cut',page:1,items,id:'stale-partial-erase-test'})});assert.ok(r.status>=400);assert.equal(host.getDocument().marks.length,2)
 }finally{host.server.closeAllConnections();await new Promise(r=>host.server.close(r))}
})
test('source cache deduplicates loads, evicts least recently used and separates versions',async()=>{
 const {createDocumentCache}=await import('../web/document-cache.mjs'),cache=createDocumentCache(8,2);let loads=0
 const loader=async()=>{loads++;return new Uint8Array(4)}
 const [a,b]=await Promise.all([cache.load('a:1',loader),cache.load('a:1',loader)])
 assert.equal(a,b);assert.equal(loads,1);await cache.load('b:1',loader);cache.get('a:1');await cache.load('a:2',loader);assert.equal(cache.get('b:1'),undefined);assert.equal(cache.get('a:1'),a);assert.equal(cache.bytes,8)
})
