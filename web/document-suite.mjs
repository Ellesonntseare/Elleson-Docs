import {openPictureAsPdf,pictureType} from './picture-import.mjs'
import {renderWordPages} from './word-pages.mjs'

export function installDocumentSuite(app){
  const $=id=>document.getElementById(id)
  const safe=fn=>()=>Promise.resolve().then(fn).catch(app.fail)
  function button(label,fn,parent){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=safe(()=>{for(const menu of document.querySelectorAll('.tool-menu'))menu.open=false;return fn()});parent?.append(b);return b}
  function dialog(id,title){const d=document.createElement('dialog');d.id=id;d.className='document-suite';const h=document.createElement('h2');h.textContent=title;d.append(h);document.body.append(d);return d}
  function message(parent){const p=document.createElement('p');p.setAttribute('role','status');parent.append(p);return p}
  function actions(parent){const row=document.createElement('div');row.className='suite-actions';parent.append(row);return row}
  const tools=document.createElement('div');tools.className='suite-actions';tools.setAttribute('aria-label','Document workspace tools')
  const more=document.querySelector('.mobile-more-sheet .tool-menu-panel')||$('history-actions');more.append(tools)
  function requirePdf(){if(app.get()?.extension!=='pdf')throw Error('Open a PDF or a picture first. Convert Word to PDF to organise its pages.');return app.get()}
  async function loadPdf(bytes){const task=app.pdfjs.getDocument({data:new Uint8Array(bytes),standardFontDataUrl:'/pdfjs/standard_fonts/',wasmUrl:'/pdfjs/wasm/'});const pdf=await task.promise;pdf.dispose=()=>void task.destroy().catch(()=>{});return pdf}
  async function paint(pdf,index,canvas,width=140,rotation){const page=await pdf.getPage(index+1),natural=page.getViewport({scale:1,rotation:rotation??page.rotate}),view=page.getViewport({scale:width/natural.width,rotation:rotation??page.rotate});canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);await page.render({canvas,viewport:view}).promise}

  const organiser=dialog('page-workspace','Pages'),pageStatus=message(organiser),pageActions=actions(organiser)
  const grid=document.createElement('div');grid.className='suite-page-grid';organiser.append(grid)
  const apply=button('Apply page changes',async()=>{
    if(!plan.length)throw Error('Keep at least one page.')
    await app.pending();const doc=requirePdf();if(doc.id!==pageDoc.id||doc.contentVersion!==pageDoc.contentVersion)throw Error('The document changed. Close and reopen Pages before applying.')
    apply.disabled=true
    try{const ok=await app.edit({kind:'pages',action:'plan',pages:plan.map(({index,rotation})=>({index,rotation})),version:pageDoc.contentVersion});if(ok){organiser.close();if(ok!=='queued')app.status('Page changes saved. Undo restores the previous arrangement.')}}finally{apply.disabled=false}
  },pageActions)
  button('Close',()=>organiser.close(),pageActions)
  let plan=[],pagePdf,pageDoc,paintSequence=0
  function pageCards(){
    const sequence=++paintSequence
    grid.replaceChildren(...plan.map((item,index)=>{
      const card=document.createElement('article');card.className='suite-page-card';card.draggable=true
      card.ondragstart=e=>e.dataTransfer.setData('text/x-page-position',String(index))
      card.ondragover=e=>e.preventDefault();card.ondrop=e=>{e.preventDefault();const v=e.dataTransfer.getData('text/x-page-position');if(!/^\d+$/.test(v)||Number(v)>=plan.length)return;const [moved]=plan.splice(Number(v),1);plan.splice(index,0,moved);pageCards()}
      const canvas=document.createElement('canvas');canvas.setAttribute('aria-label','Preview of page '+(index+1));const label=document.createElement('strong');label.textContent='Page '+(index+1)+' · original '+(item.index+1)
      card.append(canvas,label);const row=actions(card)
      const jump=button('View',()=>{organiser.close();app.go(item.index+1)},row)
      for(const [name,delta] of [['Earlier',-1],['Later',1]]){const b=button(name,()=>{[plan[index],plan[index+delta]]=[plan[index+delta],plan[index]];pageCards()},row);b.disabled=!plan[index+delta]}
      button('Rotate',()=>{item.rotation=(item.rotation+90)%360;pageCards()},row)
      button('Duplicate',()=>{if(plan.length>=1000)throw Error('Keep at most 1000 pages.');plan.splice(index+1,0,{...item});pageCards()},row)
      const remove=button('Remove',()=>{plan.splice(index,1);pageCards()},row);remove.disabled=plan.length===1
      return card
    }))
    pageStatus.textContent=plan.length+' pages. Drag cards or use Earlier / Later. Changes apply together and can be undone.'
    // Render sequentially with cancellation; opening a large PDF does not allocate every thumbnail at once.
    void(async()=>{for(let i=0;i<plan.length&&sequence===paintSequence;i++){const canvas=grid.children[i]?.querySelector('canvas');if(!canvas)break;const page=await pagePdf.getPage(plan[i].index+1);await paint(pagePdf,plan[i].index,canvas,140,(page.rotate+plan[i].rotation)%360)}})().catch(error=>{if(sequence===paintSequence)pageStatus.textContent=error.message})
  }
  async function openPages(){await app.pending();pageDoc={...requirePdf()};pageStatus.textContent='Loading pages…';grid.replaceChildren();organiser.showModal();try{pagePdf?.dispose();pagePdf=await loadPdf(await(await app.request('/api/save/'+pageDoc.id+'?transfer=1')).arrayBuffer());plan=Array.from({length:pagePdf.numPages},(_,index)=>({index,rotation:0}));pageCards()}catch(e){pageStatus.textContent=e.message}}
  organiser.addEventListener('close',()=>{paintSequence++;pagePdf?.dispose();pagePdf=null})
  $('organize').addEventListener('click',event=>{event.stopImmediatePropagation();void openPages().catch(app.fail)},true)
  button('Pages',openPages,tools).id='suite-pages'

  const merge=dialog('merge-workspace','Combine documents'),mergeStatus=message(merge)
  const info=document.createElement('p');info.textContent='Add PDFs, pictures or Word files. Set the file order, preview the combined pages, then open the new PDF. Word conversion uses the connected PC. Form entries become printed content in the combined copy.';merge.append(info)
  const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif,.bmp';input.setAttribute('aria-label','Files to combine');merge.append(input)
  const list=document.createElement('ol');merge.append(list);const mergeActions=actions(merge),previewGrid=document.createElement('div');previewGrid.className='suite-page-grid';merge.append(previewGrid)
  let files=[],combined,combinedPdf,mergeBusy=false,mergeGeneration=0
  function invalidateMerge(){combined=null;openCombined.disabled=true;previewGrid.replaceChildren();combinedPdf?.dispose();combinedPdf=null;mergeGeneration++}
  function fileRows(){list.replaceChildren(...files.map((file,index)=>{const row=document.createElement('li'),name=document.createElement('span');name.textContent=file.name;row.append(name);for(const [label,delta] of [['Earlier',-1],['Later',1],['Remove',0]]){const b=button(label,()=>{if(!delta)files.splice(index,1);else [files[index],files[index+delta]]=[files[index+delta],files[index]];invalidateMerge();fileRows()},row);b.disabled=mergeBusy||!!delta&&!files[index+delta]}return row}))}
  input.onchange=()=>{const added=[...files,...input.files];input.value='';if(added.length>20||added.reduce((s,f)=>s+f.size,0)>100*1024*1024){mergeStatus.textContent='Choose at most 20 files and 100 MB total.';return}files=added;invalidateMerge();fileRows()}
  const prepare=button('Preview combined PDF',async()=>{
    if(!files.length)throw Error('Add files to combine.')
    mergeBusy=true;input.disabled=true;prepare.disabled=true;invalidateMerge();const generation=mergeGeneration;fileRows()
    try{
      const engine=await import('./conversion-runtime.mjs'),pdfs=[]
      for(const [index,file] of files.entries()){
        mergeStatus.textContent='Preparing '+(index+1)+' / '+files.length+': '+file.name
        if(pictureType(file.name,file.type))pdfs.push(new Uint8Array(await(await openPictureAsPdf(file)).arrayBuffer()))
        else if(/\.pdf$/i.test(file.name))pdfs.push(new Uint8Array(await file.arrayBuffer()))
        else if(/\.docx?$/i.test(file.name)){
          const bytes=new Uint8Array(await file.arrayBuffer())
          if(window.desktopDocs?.wordToPdf&&/\.docx$/i.test(file.name))pdfs.push(new Uint8Array(await window.desktopDocs.wordToPdf(Array.from(bytes))))
          else{const response=await app.request('/api/convert-word',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(file.name)},body:bytes});pdfs.push(new Uint8Array(await response.arrayBuffer()))}
        }else throw Error('Choose PDF, Word or supported pictures.')
      }
      const result=await engine.combinePdfs(pdfs)
      if(result.length>40*1024*1024)throw Error('The combined document exceeds 40 MB. Use fewer files.')
      if(generation!==mergeGeneration)return
      combined=result;combinedPdf=await loadPdf(result)
      mergeStatus.textContent=combinedPdf.numPages+' pages ready. Open the combined PDF, then use Pages to change individual page order.'
      for(let index=0;index<combinedPdf.numPages;index++){
        if(generation!==mergeGeneration)break
        const card=document.createElement('article');card.className='suite-page-card';const canvas=document.createElement('canvas'),label=document.createElement('span');label.textContent='Page '+(index+1);card.append(canvas,label);previewGrid.append(card);await paint(combinedPdf,index,canvas)
      }
      openCombined.disabled=false
    }catch(e){mergeStatus.textContent=e.message;combined=null}
    finally{mergeBusy=false;input.disabled=false;prepare.disabled=false;fileRows()}
  },mergeActions)
  const openCombined=button('Open combined PDF',async()=>{if(!combined)return;await app.open('Combined document.pdf',combined);merge.close();app.status('Combined PDF opened. Use Save as PDF to export it.')},mergeActions);openCombined.disabled=true
  button('Close',()=>{if(!mergeBusy)merge.close()},mergeActions)
  merge.addEventListener('cancel',event=>{if(mergeBusy)event.preventDefault()})
  button('Combine documents',()=>{merge.showModal();fileRows()},tools).id='suite-combine'

  const recovery=dialog('recovery-workspace','Recovery history'),historyStatus=message(recovery),historyActions=actions(recovery)
  const entries=document.createElement('div');entries.className='suite-history-list';recovery.append(entries)
  const preview=document.createElement('section');preview.className='suite-version-preview';preview.setAttribute('aria-label','Saved version preview');recovery.append(preview)

  let historyDoc,versions=[],selectedVersion,historyPdf,historyPage=0,historySequence=0
  async function historyRows(){versions=await(await app.request('/api/library/'+historyDoc.libraryId+'/versions')).json();entries.replaceChildren(...versions.map((v,index)=>button((index===0?'Latest · ':'')+new Date(v.date).toLocaleString()+' · '+v.filename,()=>showVersion(v),null)));for(const [index,node]of [...entries.children].entries())node.onclick=safe(()=>showVersion(versions[index]));historyStatus.textContent=versions.length+' saved checkpoints. Preview a version before restoring it.'}
  async function showVersion(v){
    const sequence=++historySequence;selectedVersion=null;restore.disabled=true;historyPdf?.dispose();historyPdf=null;preview.replaceChildren();historyStatus.textContent='Loading saved version…'
    const bytes=await(await app.request('/api/library/'+historyDoc.libraryId+'/preview/'+v.id)).arrayBuffer();if(sequence!==historySequence)return
    if(/\.pdf$/i.test(v.filename)){
      const loaded=await loadPdf(bytes);if(sequence!==historySequence){loaded.dispose();return}historyPdf=loaded;historyPage=0
      const row=actions(preview),canvas=document.createElement('canvas'),label=document.createElement('span')
      let busy=false
      const draw=async(delta=0)=>{if(busy||sequence!==historySequence)return;busy=true;previous.disabled=next.disabled=true;const number=Math.max(0,Math.min(loaded.numPages-1,historyPage+delta));try{await paint(loaded,number,canvas,Math.min(650,recovery.clientWidth-60));if(sequence===historySequence){historyPage=number;label.textContent='Page '+(number+1)+' / '+loaded.numPages}}finally{busy=false;if(sequence===historySequence){previous.disabled=historyPage===0;next.disabled=historyPage===loaded.numPages-1}}}
      const previous=button('Previous preview page',()=>draw(-1),row),next=button('Next preview page',()=>draw(1),row);row.append(label);preview.append(canvas);await draw()
    }else if(/\.docx$/i.test(v.filename)){const styles=document.createElement('div'),body=document.createElement('div');preview.append(styles,body);await renderWordPages(bytes,body,styles)}else preview.textContent='Visual preview is available for PDF and DOCX. Open this version to view legacy Word files.'
    if(sequence===historySequence){selectedVersion=v;historyStatus.textContent='Preview: '+v.filename+' · '+new Date(v.date).toLocaleString();restore.disabled=false}
  }
  button('Create checkpoint',async()=>{await app.pending();if(app.get()?.id!==historyDoc.id)throw Error('The active document changed. Reopen Recovery history.');await app.request('/api/checkpoint/'+historyDoc.id,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await app.refresh();historyDoc={...app.get()};await historyRows();app.status('Recovery checkpoint saved.')},historyActions)
  const restore=button('Restore selected version',async()=>{
    if(!selectedVersion||restore.disabled)return
    await app.pending();if(app.get()?.id!==historyDoc.id)throw Error('The active document changed. Reopen Recovery history.')
    // Save current work first so restoring an older file never discards today's edits.
    await app.request('/api/restore-checkpoint/'+historyDoc.id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:selectedVersion.id})})
    await app.refresh();recovery.close();app.status('Saved version restored. Your previous work is kept in Recovery history.')
  },historyActions);restore.disabled=true
  button('Close',()=>recovery.close(),historyActions)
  recovery.addEventListener('close',()=>{historySequence++;historyPdf?.dispose();historyPdf=null})
  button('Recovery history',async()=>{await app.pending();const doc=app.get();if(!doc?.libraryId)throw Error('Open a saved document first.');historyDoc={...doc};selectedVersion=null;restore.disabled=true;preview.replaceChildren();recovery.showModal();await historyRows()},tools).id='suite-recovery'
  let checkpointKey='',checkpointBusy=false
  setInterval(()=>{
    const doc=app.get();if(!doc?.dirty||checkpointBusy||app.role()==='phone')return
    const key=JSON.stringify([doc.id,doc.contentVersion,doc.marks,doc.fields,doc.lines])
    if(key===checkpointKey)return
    checkpointBusy=true
    void app.pending().then(()=>app.request('/api/checkpoint/'+doc.id,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).then(()=>{checkpointKey=key}).catch(()=>{}).finally(()=>{checkpointBusy=false})
  },60000)
  return {tools,button}
}
