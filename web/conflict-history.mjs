export function installConflictHistory({get,apply,fail,storage=localStorage}){
 const key='elleson-conflicting-text-v1';let records=[]
 try{records=JSON.parse(storage.getItem(key)||'[]');if(!Array.isArray(records))records=[]}catch{}
 const dialog=document.createElement('dialog');dialog.id='text-conflicts';dialog.innerHTML='<h2>Conflicting edits</h2><p>Both versions are retained here. Selecting a version applies it only if the document has not changed again.</p><div data-list></div><button data-close>Close</button>';document.body.append(dialog)
 dialog.querySelector('[data-close]').onclick=()=>dialog.close()
 const button=document.createElement('button');button.id='review-text-conflicts';button.textContent='Review conflicting text';document.getElementById('history-actions').append(button)
 function open(){
  const list=dialog.querySelector('[data-list]');list.replaceChildren()
  if(!records.length)list.textContent='No conflicting edits have been recorded.'
  for(const record of [...records].reverse()){
   const item=document.createElement('section'),heading=document.createElement('h3');heading.textContent=record.filename+' · '+new Date(record.time).toLocaleString();item.append(heading)
   for(const [name,value]of [['This device',record.local],['Other device',record.remote]]){
    const label=document.createElement('label');label.textContent=name;const text=document.createElement('textarea');text.readOnly=true;text.rows=3;text.value=typeof value==='string'?value:JSON.stringify(value);label.append(text);item.append(label)
    const use=document.createElement('button');use.textContent='Use '+name.toLowerCase()+' version';use.disabled=get()?.id!==record.document;use.onclick=async()=>{
     use.disabled=true
     try{const doc=get();if(doc?.id!==record.document)throw Error('Open the original document first.');if(record.change.kind==='word'&&(record.change.structureVersion||0)!==(doc.structureVersion||0))throw Error('Paragraphs have changed. Copy the retained text into the correct paragraph.');const actual=record.change.kind==='word'?doc.lines[record.change.index]?.text:doc.fields[record.change.name];if(actual===undefined)throw Error('Select this text in the document before applying a version.');const applied=await apply({...record.change,id:undefined,before:actual,value,structureVersion:doc.structureVersion||0});if(applied)dialog.close()}catch(error){fail(error)}finally{use.disabled=false}
    };item.append(use)
   }
   list.append(item)
  }
  dialog.showModal()
 }
 button.onclick=open
 return {open,remember(document,change,remote){
  const record={document,filename:get()?.filename||'Document',change:{...change},local:change.value,remote,time:Date.now()}
  if(!records.some(item=>item.change.id===change.id&&JSON.stringify(item.remote)===JSON.stringify(remote)))records.push(record)
  // Keep all unresolved text; never evict an older conflict to make space.
  try{storage.setItem(key,JSON.stringify(records))}catch{fail(Error('Conflicting versions are available in Review conflicting text for this session. Device storage is full; copy them before closing.'))}
 }}
}
