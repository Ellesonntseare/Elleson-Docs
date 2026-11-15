export function installDocumentFilters({get,request,pdfjs,pending,refresh,fail}){
 const button=document.createElement('button');button.id='document-filters';button.textContent='Scan filters';document.getElementById('toolbar').append(button)
 const dialog=document.createElement('dialog');dialog.id='document-filters-dialog';dialog.innerHTML='<h2>Scan filters</h2><p>Enhance an open PDF or scanned page. Create a filtered PDF copy; filtered pages become images.</p><label>Filter <select id="open-filter"><option value="document">Document enhancement</option><option value="colour">Colour enhancement</option><option value="grayscale">Grayscale</option><option value="bw">Black and white</option><option value="photo">Original</option></select></label><label>Pages <select id="filter-scope"><option value="current">Current page</option><option value="all">All pages</option></select></label><label>Brightness <input id="filter-brightness" type="range" min="-100" max="100" value="0"></label><label>Contrast <input id="filter-contrast" type="range" min="-80" max="100" value="0"></label><label>Preview page <input id="filter-page" type="number" min="1" value="1"></label><label><input id="filter-ocr" type="checkbox"> Make filtered pages searchable</label><div class="filter-comparison"><figure><figcaption>Original</figcaption><img id="filter-original" alt="Original page" class="filter-image"></figure><figure><figcaption>Filtered</figcaption><img id="filter-preview" alt="Filtered document preview" class="filter-image"></figure></div><p role="status"></p><div class="actions"><button id="filter-create" class="primary">Create filtered copy</button><button id="filter-close">Close</button></div>';document.body.append(dialog)
 let source,bytes,pdf,number,sequence=0
 const pageSettings=new Map()
 const settings=()=>({filter:dialog.querySelector('#open-filter').value,brightness:Number(dialog.querySelector('#filter-brightness').value),contrast:Number(dialog.querySelector('#filter-contrast').value)})
 async function pageImage(n,original=false,options=settings()){const page=await pdf.getPage(n),natural=page.getViewport({scale:1}),frame=page.getViewport({scale:Math.min(2,1800/Math.max(natural.width,natural.height))}),canvas=document.createElement('canvas');canvas.width=Math.ceil(frame.width);canvas.height=Math.ceil(frame.height);await page.render({canvas,viewport:frame}).promise;const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));return original?blob:(await import('./scan-runtime.mjs')).prepareImage(blob,options)}
 function showImage(id,blob){
   const image=dialog.querySelector(id)
   if(image.dataset.url)URL.revokeObjectURL(image.dataset.url)
   image.src=image.dataset.url=URL.createObjectURL(blob)
 }
 async function preview(){
   if(!pdf)return
   const own=++sequence
   try {
     const source=await pageImage(number,true)
     const result=await (await import('./scan-runtime.mjs')).prepareImage(source,settings())
     if(own!==sequence)return
     showImage('#filter-original',source)
     showImage('#filter-preview',result)
   } catch(error){dialog.querySelector('[role=status]').textContent=error.message}
 }

 button.onclick=async()=>{try{source=get();if(!source)return;pageSettings.clear();await pending();dialog.showModal();dialog.querySelector('[role=status]').textContent='Preparing pages…';bytes=new Uint8Array(await(await request('/api/filter-source/'+source.id)).arrayBuffer());pdf=await pdfjs.getDocument({data:bytes.slice()}).promise;number=Math.max(1,Math.min(pdf.numPages,Number(document.getElementById('page').value)||1));dialog.querySelector('#filter-page').max=pdf.numPages;dialog.querySelector('#filter-page').value=number;dialog.querySelector('#filter-create').disabled=false;dialog.querySelector('[role=status]').textContent='';await preview()}catch(error){fail(error)}}
 dialog.querySelector('#filter-close').onclick=()=>dialog.close();for(const input of dialog.querySelectorAll('select,input'))input.onchange=()=>{
   if(!pdf)return
   const pageInput=dialog.querySelector('#filter-page')
   if(input===pageInput){
     pageSettings.set(number,settings())
     number=Math.max(1,Math.min(pdf.numPages,Number(pageInput.value)||1))
     pageInput.value=number
     const saved=pageSettings.get(number)
     if(saved){
       dialog.querySelector('#open-filter').value=saved.filter
       dialog.querySelector('#filter-brightness').value=saved.brightness
       dialog.querySelector('#filter-contrast').value=saved.contrast
     }
   }
   void preview()
 }

 dialog.querySelector('#filter-create').onclick=async()=>{const create=dialog.querySelector('#filter-create');create.disabled=true;let worker;try{if(dialog.querySelector('#filter-ocr').checked)worker=await createOcrWorker();const images=[],numbers=dialog.querySelector('#filter-scope').value==='all'?Array.from({length:pdf.numPages},(_,i)=>i+1):[number];for(const n of numbers){dialog.querySelector('[role=status]').textContent='Filtering page '+n+' of '+pdf.numPages;const blob=await pageImage(n,false,n===number?settings():pageSettings.get(n)||settings());images.push({index:n-1,blob,ocr:worker?(await worker.recognize(blob,{},{blocks:true})).data:undefined})}const result=await(await import('./scan-runtime.mjs')).filteredPdf(bytes,images);await request('/api/open',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(source.filename.replace(/\.[^.]+$/i,'')+' - filtered.pdf')},body:result});dialog.close();await refresh()}catch(error){dialog.querySelector('[role=status]').textContent=error.message}finally{if(worker)await worker.terminate();create.disabled=false}}
}

async function createOcrWorker(){
 if(!window.Tesseract)await new Promise((resolve,reject)=>{
   const script=document.createElement('script')
   script.src='/vendor/tesseract/tesseract.min.js'
   script.onload=resolve;script.onerror=()=>reject(Error('Could not load OCR.'))
   document.head.append(script)
 })
 return window.Tesseract.createWorker(document.getElementById('ocr-language').value,1,{
   workerPath:'/vendor/tesseract/worker.min.js',workerBlobURL:false,
   corePath:'/vendor/tesseract-core/',langPath:'/vendor/ocr-data/',gzip:true,cacheMethod:'none'
 })
}
