export function installCompareView({pdfjs,app}) {
 const button=document.createElement('button');button.textContent='View side by side';document.getElementById('history-actions').append(button)
 const dialog=document.createElement('dialog');dialog.id='side-by-side';dialog.innerHTML='<h2>View PDFs side by side</h2><p>Choose another PDF. Both panels show fixed copies of the selected documents.</p><input type="file" accept="application/pdf,.pdf"><label><input type="checkbox" checked> Link scrolling</label><div class="compare-panes"><section aria-label="Current PDF"></section><section aria-label="Comparison PDF"></section></div><p role="status"></p><form method="dialog"><button>Close</button></form>';document.body.append(dialog)
 const panes=[...dialog.querySelectorAll('section')],status=dialog.querySelector('[role=status]');let sequence=0,tasks=[],observers=[]
 const clear=()=>{sequence++;observers.forEach(o=>o.disconnect());observers=[];for(const task of tasks)void task.destroy().catch(()=>{});tasks=[];panes.forEach(p=>p.replaceChildren())}
 async function render(bytes,pane,own){
  const task=pdfjs.getDocument({data:bytes,standardFontDataUrl:'/pdfjs/standard_fonts/',wasmUrl:'/pdfjs/wasm/'});tasks.push(task);const pdf=await task.promise;if(sequence!==own)return
  const first=await pdf.getPage(1),natural=first.getViewport({scale:1}),width=Math.max(150,pane.clientWidth-20)
  const observer=new IntersectionObserver(entries=>{for(const entry of entries){const box=entry.target;if(!entry.isIntersecting||box.busy||box.loaded)continue;box.busy=true;void(async()=>{const page=await pdf.getPage(Number(box.dataset.page)),frame=page.getViewport({scale:width/page.getViewport({scale:1}).width}),canvas=document.createElement('canvas');canvas.width=Math.ceil(frame.width);canvas.height=Math.ceil(frame.height);await page.render({canvas,viewport:frame}).promise;if(own===sequence){box.style.height=frame.height+'px';box.replaceChildren(canvas);box.loaded=true}})().catch(error=>{if(own===sequence)status.textContent=error.message}).finally(()=>box.busy=false)}},{root:pane,rootMargin:'300px'});observers.push(observer)
  for(let n=1;n<=pdf.numPages;n++){const box=document.createElement('div');box.dataset.page=n;box.style.height=natural.height/natural.width*width+'px';pane.append(box);observer.observe(box)}
 }
 let synchronizing=false
 for(const [index,pane] of panes.entries())pane.onscroll=()=>{if(synchronizing||!dialog.querySelector('[type=checkbox]').checked)return;synchronizing=true;const other=panes[1-index];other.scrollTop=pane.scrollTop/Math.max(1,pane.scrollHeight-pane.clientHeight)*(other.scrollHeight-other.clientHeight);requestAnimationFrame(()=>synchronizing=false)}
 button.onclick=()=>{if(app.get().current?.extension!=='pdf'){app.status('Open a PDF first.');return}dialog.showModal()}
 dialog.querySelector('[type=file]').onchange=async event=>{
  const file=event.target.files[0];if(!file)return
  clear();const own=sequence;status.textContent='Preparing comparison…'
  try{if(file.size>40*1024*1024)throw new Error('Choose a PDF below 40 MB.');await app.pending();const bytes=new Uint8Array(await(await app.request('/api/print/'+app.get().current.id)).arrayBuffer());await Promise.all([render(bytes,panes[0],own),render(new Uint8Array(await file.arrayBuffer()),panes[1],own)]);status.textContent='Scroll either document to compare.'}catch(error){status.textContent=error.message}
 }
 dialog.addEventListener('close',clear)
}
