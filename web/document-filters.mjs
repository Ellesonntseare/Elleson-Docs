import {installDocumentGestures} from './document-gestures.mjs'
import {installFilterGallery} from './filter-gallery.mjs'
export function installDocumentFilters({get,request,pdfjs,pending,refresh,fail,navigate}){
 const button=document.createElement('button');button.id='document-filters';button.textContent='Scan filters';document.getElementById('toolbar').append(button)
 const dialog=document.createElement('section');dialog.id='document-filters-panel';dialog.hidden=true;dialog.setAttribute('aria-label','Document filters');dialog.innerHTML='<h2>Scan filters</h2><p>Enhance an open PDF or scanned page. Create a filtered PDF copy; filtered pages become images.</p><label>Filter <select id="open-filter"><option value="document">Document enhancement</option><option value="colour">Colour enhancement</option><option value="grayscale">Grayscale</option><option value="bw">Black and white</option><option value="photo">Original</option></select></label><label>Pages <select id="filter-scope"><option value="current">Current page</option><option value="all">All pages</option></select></label><label>Brightness <input id="filter-brightness" type="range" min="-100" max="100" value="0"></label><label>Contrast <input id="filter-contrast" type="range" min="-80" max="100" value="0"></label><label>Preview page <input id="filter-page" type="number" min="1" value="1"></label><label><input id="filter-ocr" type="checkbox"> Make filtered pages searchable</label><div class="filter-comparison"><figure><figcaption>Original</figcaption><img id="filter-original" alt="Original page" class="filter-image"></figure><figure><figcaption>Filtered</figcaption><img id="filter-preview" alt="Filtered document preview" class="filter-image"></figure></div><p role="status"></p><div class="actions"><button id="filter-create" class="primary">Apply</button><button id="filter-close">Cancel</button></div>';document.body.append(dialog)
 const comparison=dialog.querySelector('.filter-comparison');comparison.classList.add('filter-single-preview');comparison.querySelector('figure').hidden=true
 const galleryContainer=document.createElement('div');comparison.after(galleryContainer)
 const gallery=installFilterGallery({select:dialog.querySelector('#open-filter'),image:dialog.querySelector('#filter-preview'),container:galleryContainer,id:'document'})
 const frame=dialog.querySelector('.scan-compare-frame');frame.classList.add('document-filter-overlay');frame.hidden=true
 comparison.hidden=true
 const heading=dialog.querySelector('h2'),actions=dialog.querySelector('.actions'),collapse=document.createElement('button');collapse.textContent='Collapse';collapse.id='filter-collapse';collapse.setAttribute('aria-expanded','true');actions.prepend(collapse);heading.after(actions,galleryContainer)
 const adjustments=document.createElement('details');adjustments.className='filter-adjustments';const summary=document.createElement('summary');summary.textContent='Adjustments & pages';adjustments.append(summary);for(const label of [...dialog.children].filter(e=>e.tagName==='LABEL'))adjustments.append(label);galleryContainer.after(adjustments)
 const stage=document.getElementById('stage'),wordSheet=document.getElementById('word-sheet'),printSheet=document.createElement('section');printSheet.className='filter-print-sheet';printSheet.hidden=true;stage.append(printSheet)
 let printZoom=1,printSize,savedScroll,wordWasHidden
 const fitPrint=()=>{if(!printSize)return;const scale=Math.min((stage.clientWidth-32)/printSize.width,1)*printZoom;printSheet.style.width=printSize.width*scale+'px';printSheet.style.height=printSize.height*scale+'px'}
 installDocumentGestures({stage,sheet:printSheet,isActive:()=>!printSheet.hidden,canPan:()=>true,cancelStroke:()=>{},getZoom:()=>printZoom,setZoom:v=>printZoom=v,render:fitPrint})
 let watch
 dialog.showModal=()=>{dialog.hidden=false;document.body.classList.add('document-filter-active');document.querySelectorAll('.mobile-more-sheet[open]').forEach(el=>el.open=false)}
 dialog.close=()=>{if(!printSheet.hidden){printSheet.hidden=true;wordSheet.hidden=wordWasHidden;delete stage.dataset.filterPrint;if(savedScroll){stage.scrollTop=savedScroll.top;stage.scrollLeft=savedScroll.left}}dialog.hidden=true;frame.hidden=true;frame.remove();clearInterval(watch);document.body.classList.remove('document-filter-active');dialog.dispatchEvent(new Event('close'))}
 collapse.onclick=()=>{galleryContainer.hidden=!galleryContainer.hidden;adjustments.hidden=galleryContainer.hidden;collapse.textContent=galleryContainer.hidden?'Expand':'Collapse';collapse.setAttribute('aria-expanded',String(!galleryContainer.hidden));document.body.classList.toggle('filter-dock-collapsed',galleryContainer.hidden)}
 function attachPreview(){const target=source.extension==='pdf'?document.getElementById('pdf-sheet'):printSheet;if(!target)throw Error('Wait for this page to load before filtering.');target.append(frame);frame.hidden=false}


 let source,bytes,pdf,loadingTask,number,sequence=0
 const originals=new Map()
 const pageSettings=new Map()
 const settings=()=>({filter:dialog.querySelector('#open-filter').value,brightness:Number(dialog.querySelector('#filter-brightness').value),contrast:Number(dialog.querySelector('#filter-contrast').value)})
 async function pageImage(n,original=false,options=settings()){const page=await pdf.getPage(n),natural=page.getViewport({scale:1}),frame=page.getViewport({scale:Math.min(2,1800/Math.max(natural.width,natural.height))}),canvas=document.createElement('canvas');canvas.width=Math.ceil(frame.width);canvas.height=Math.ceil(frame.height);await page.render({canvas,viewport:frame}).promise;const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));return original?blob:(await import('./scan-runtime.mjs')).prepareImage(blob,options)}
 function showImage(id,blob){
   const image=id==='#filter-preview'?frame.querySelector(id):dialog.querySelector(id)
   if(image.dataset.url)URL.revokeObjectURL(image.dataset.url)
   image.src=image.dataset.url=URL.createObjectURL(blob)
 }
 const sourceDocumentIsWord=()=>source?.extension!=='pdf'
 async function preview(){
   if(!pdf||dialog.hidden)return
   const own=++sequence,n=number
   try {
     let source=originals.get(number);if(!source){source=await pageImage(n,true);if(own!==sequence)return;originals.set(n,source);while(originals.size>3)originals.delete(originals.keys().next().value)}
     void gallery.update(source,settings()).catch(error=>{dialog.querySelector('[role=status]').textContent=error.message})
     const result=await (await import('./scan-runtime.mjs')).prepareImage(source,{...settings(),maxDimension:1200})
     if(own!==sequence||dialog.hidden)return
     if(sourceDocumentIsWord()){const page=await pdf.getPage(number);printSize=page.getViewport({scale:1});if(printSheet.hidden){wordWasHidden=wordSheet.hidden;savedScroll={top:stage.scrollTop,left:stage.scrollLeft};printZoom=1;wordSheet.hidden=true;printSheet.hidden=false;stage.dataset.filterPrint='true';stage.scrollTop=stage.scrollLeft=0}fitPrint()}
     showImage('#filter-original',source)
     showImage('#filter-preview',result);attachPreview()
   } catch(error){dialog.querySelector('[role=status]').textContent=error.message}
 }

 button.onclick=async()=>{if(!dialog.hidden){dialog.close();return}try{source=get();if(!source)return;pageSettings.clear();originals.clear();await loadingTask?.destroy?.();pdf=null;await pending();dialog.showModal();dialog.querySelector('[role=status]').textContent='Preparing pages…';bytes=new Uint8Array(await(await request('/api/filter-source/'+source.id)).arrayBuffer());loadingTask=pdfjs.getDocument({data:bytes.slice()});pdf=await loadingTask.promise;number=Math.max(1,Math.min(pdf.numPages,Number(document.getElementById('page').value)||1));dialog.querySelector('#filter-page').max=pdf.numPages;dialog.querySelector('#filter-page').value=number;dialog.querySelector('#filter-create').disabled=false;dialog.querySelector('[role=status]').textContent='';await preview();watch=setInterval(()=>{if(dialog.hidden)return;if(get()?.id!==source.id||get()?.contentVersion!==source.contentVersion){dialog.close();return}if(source.extension!=='pdf')return;const next=Number(document.getElementById('page').value)||1;if(next!==number){pageSettings.set(number,settings());number=Math.min(pdf.numPages,next);dialog.querySelector('#filter-page').value=number;void preview()}},250)}catch(error){dialog.close();fail(error)}}
 dialog.addEventListener('close',()=>{sequence++;originals.clear();gallery.clear();for(const image of [frame.querySelector('#filter-preview'),dialog.querySelector('#filter-original')])if(image.dataset.url){URL.revokeObjectURL(image.dataset.url);delete image.dataset.url}})
 dialog.querySelector('#filter-close').onclick=()=>dialog.close();for(const input of dialog.querySelectorAll('select,input'))input.onchange=()=>{
   if(!pdf)return
   const pageInput=dialog.querySelector('#filter-page')
   if(input===pageInput){
     pageSettings.set(number,settings())
     number=Math.max(1,Math.min(pdf.numPages,Number(pageInput.value)||1))
     pageInput.value=number;if(source.extension==='pdf')navigate?.(number)
     const saved=pageSettings.get(number)
     if(saved){
       dialog.querySelector('#open-filter').value=saved.filter
       dialog.querySelector('#filter-brightness').value=saved.brightness
       dialog.querySelector('#filter-contrast').value=saved.contrast
     }
   }
   void preview()
 }

 dialog.querySelector('#filter-create').onclick=async()=>{clearInterval(watch);const create=dialog.querySelector('#filter-create');create.disabled=true;let worker;try{if(dialog.querySelector('#filter-ocr').checked)worker=await createOcrWorker();const images=[],numbers=dialog.querySelector('#filter-scope').value==='all'?Array.from({length:pdf.numPages},(_,i)=>i+1):[number];for(const n of numbers){dialog.querySelector('[role=status]').textContent='Filtering page '+n+' of '+pdf.numPages;const blob=await pageImage(n,false,n===number?settings():pageSettings.get(n)||settings());images.push({index:n-1,blob,ocr:worker?(await worker.recognize(blob,{},{blocks:true})).data:undefined})}const result=await(await import('./scan-runtime.mjs')).filteredPdf(bytes,images);if(get()?.id!==source.id||get()?.contentVersion!==source.contentVersion)throw Error('The document changed. Reopen filters before applying.');await request('/api/open',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(source.filename.replace(/\.[^.]+$/i,'')+' - filtered.pdf')},body:result});dialog.close();await refresh()}catch(error){dialog.querySelector('[role=status]').textContent=error.message}finally{if(worker)await worker.terminate();create.disabled=false}}
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
