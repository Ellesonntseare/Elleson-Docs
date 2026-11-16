import {inkPng} from './ink-vectors.mjs'
export function drawingBounds(marks){
 let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity
 for(const mark of marks)for(const [x,y] of mark.points||[mark.at]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y)}
 return [left,top,right,bottom]
}
export function shapeStrokes(kind,a,b){
 const [x,y]=a,[u,v]=b
 if(kind==='rectangle')return [[[x,y],[u,y],[u,v],[x,v],[x,y]]]
 if(kind==='ellipse'){const cx=(x+u)/2,cy=(y+v)/2;return [Array.from({length:65},(_,i)=>[cx+Math.abs(u-x)/2*Math.cos(i*Math.PI/32),cy+Math.abs(v-y)/2*Math.sin(i*Math.PI/32)])]}
 if(kind==='arrow'){const t=Math.atan2(v-y,u-x),size=Math.min(18,Math.hypot(u-x,v-y)*.3);return [[a,b],[[u-size*Math.cos(t-.5),v-size*Math.sin(t-.5)],b,[u-size*Math.cos(t+.5),v-size*Math.sin(t+.5)]]]}
 return [[a,b]]
}
export function installDrawingSuite(app,hub){
 const $=id=>document.getElementById(id),safe=fn=>()=>Promise.resolve().then(fn).catch(app.fail)
 const panel=document.createElement('dialog');panel.id='drawing-workspace';panel.className='document-suite';panel.innerHTML='<h2>Drawing tools</h2><p>Select several drawings with a rectangle, or drag to add a shape.</p><div class="suite-actions" data-tools></div><label>Colour <input type="color" value="#185adb" aria-label="Drawing selection colour"></label><label>Pen size <input type="number" min="0.25" max="30" step="0.25" value="2" aria-label="Drawing selection pen size"></label><div class="suite-actions" data-edits></div><p role="status"></p><button data-close>Close</button>';document.body.append(panel)
 const tools=panel.querySelector('[data-tools]'),edits=panel.querySelector('[data-edits]'),message=panel.querySelector('[role=status]'),color=panel.querySelector('input[type=color]'),width=panel.querySelector('input[type=number]')
 const sharedColor=$('ink-color'),sharedWidth=$('ink-width')
 function syncSettings(){color.value=sharedColor.value;width.value=sharedWidth.value}
 const smoothing=document.createElement('label');smoothing.textContent='Smoothing ';const smooth=document.createElement('input');smooth.type='range';smooth.min=0;smooth.max=1;smooth.step=.1;smooth.value=$('ink-smoothing').value;smooth.setAttribute('aria-label','Shared drawing smoothing');smoothing.append(smooth);width.closest('label').after(smoothing);smooth.oninput=()=>{$('ink-smoothing').value=smooth.value;$('ink-smoothing').dispatchEvent(new Event('input',{bubbles:true}))};$('ink-smoothing').addEventListener('input',()=>{smooth.value=$('ink-smoothing').value})
 syncSettings();sharedColor.addEventListener('input',syncSettings);sharedWidth.addEventListener('input',syncSettings)
 color.addEventListener('input',()=>{sharedColor.value=color.value;sharedColor.dispatchEvent(new Event('input',{bubbles:true}))})
 width.addEventListener('input',()=>{const value=Number(width.value);if(!Number.isFinite(value)||value<.25||value>30)return;if(![...sharedWidth.options].some(o=>o.value===String(value)))sharedWidth.add(new Option(String(value),String(value)));sharedWidth.value=String(value);sharedWidth.dispatchEvent(new Event('input',{bubbles:true}))})
 let action=null,gesture=null,selection=[],selectedDoc,selectedVersion,selectedPage,selectedWordPage,wordSelection=[],overlay
 function button(label,fn,parent){return hub.button(label,fn,parent)}
 async function begin(mode){if(!app.get())throw Error('Open a document first.');action=mode;selection=[];wordSelection=[];app.setMode(app.get().extension==='pdf'?'select':'read');if(app.get().lines)await app.renderWord();panel.close();app.status(mode==='select'?'Drag a rectangle around drawings. Tap Drawing tools to edit the selection.':'Drag on the document to draw a '+mode+'.');$('stage').classList.add('suite-drawing-active')}
 button('Select drawings',()=>begin('select'),tools).id='suite-select-ink'
 for(const kind of ['line','arrow','rectangle','ellipse'])button(kind[0].toUpperCase()+kind.slice(1),()=>begin(kind),tools)
 button('Highlighter',()=>{if(app.get()?.extension==='pdf'){panel.close();action=null;$('stage').classList.remove('suite-drawing-active');app.setMode('highlight')}else begin('highlighter')},tools)
 async function transform(type,extra={}){
   if(!selection.length&&!wordSelection.length)throw Error('Select drawings first.')
   await app.pending();const doc=app.get();if(doc.id!==selectedDoc)throw Error('The active document changed. Select the drawings again.')
   if(wordSelection.length){
     if(doc.contentVersion!==selectedVersion)throw Error('The document changed. Select the drawings again.')
     const page=selectedWordPage,items=[],groupBounds=drawingBounds(wordSelection.map(item=>({points:[[item.position.x,item.position.y],[item.position.x+item.position.width,item.position.y+item.position.height]]}))),cx=(groupBounds[0]+groupBounds[2])/2,cy=(groupBounds[1]+groupBounds[3])/2
     for(const item of wordSelection){
       const box={...item.position},scale=extra.scale||1;box.x=cx+(box.x-cx)*scale+(extra.dx||0);box.y=cy+(box.y-cy)*scale+(extra.dy||0);box.width*=scale;box.height*=scale;if(box.paragraphY!==undefined)box.paragraphY+=box.y-item.position.y
       if(box.x<0||box.y<0||box.x+box.width>page.offsetWidth||box.y+box.height>page.offsetHeight)throw Error('Keep the drawings inside the page.')
       const entry={target:item.target,position:box}
       if(item.image.dataset.inkVectors){box.ink=JSON.parse(item.image.dataset.inkVectors);if(extra.color||extra.width){box.ink.strokes=box.ink.strokes.map(stroke=>({...stroke,color:extra.color||stroke.color,width:extra.width||stroke.width}));entry.png=inkPng(box.ink)}}else if(extra.width)throw Error('Older drawings are flat images. Resize them to change their thickness.');
       if(extra.color&&!box.ink){const image=item.image,canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);ctx.globalCompositeOperation='source-in';ctx.fillStyle=extra.color;ctx.fillRect(0,0,canvas.width,canvas.height);entry.png=canvas.toDataURL('image/png').split(',')[1]}
       items.push(entry)
     }
     await app.request('/api/word-ink-batch/'+doc.id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:app.editId(),version:doc.contentVersion,action:type,items})});await app.refresh();wordSelection=[]
   }else{const result=await app.edit({kind:'transform',targets:selection,target:selection[0],action:type,...extra});if(!result)throw Error('Drawing change was not saved. Select the drawings again and retry.');if(result==='queued'){message.textContent='Drawing change retained on this device until the connection returns.';return false}}
   if(type==='delete'||type==='duplicate'){selection=[];wordSelection=[];overlay?.remove()}
   message.textContent=type==='delete'?'Drawings deleted. Undo can restore them.':'Drawing changes saved.';return true
 }
 button('Apply colour',()=>transform('apply',{color:color.value}),edits)
 button('Apply pen size',()=>{return transform('apply',{width:Number(width.value)})},edits)
 button('Larger',()=>transform('apply',{scale:1.15}),edits);button('Smaller',()=>transform('apply',{scale:1/1.15}),edits)
 button('Duplicate',()=>transform('duplicate',{dx:12,dy:app.get()?.extension==='pdf'?-12:12}),edits);button('Delete',()=>transform('delete'),edits)
 for(const [label,dx,dy]of [['Move left',-5,0],['Move right',5,0],['Move up',0,-5],['Move down',0,5]])button(label,()=>transform('apply',{dx,dy:app.get()?.extension==='pdf'?-dy:dy}),edits)
 button('Move on page',()=>{if(!selection.length&&!wordSelection.length)throw Error('Select drawings first.');action='move';panel.close();app.status('Drag on the page to move the selected drawings.')},edits)
 button('Done drawing',()=>{action=null;gesture=null;overlay?.remove();$('stage').classList.remove('suite-drawing-active');panel.close();app.setMode('read')},tools)
 panel.querySelector('[data-close]').onclick=()=>panel.close()
 button('Drawing tools',()=>{message.textContent=(selection.length||wordSelection.length)+' drawings selected.';panel.showModal()},hub.tools).id='suite-drawing'
 const svgNS='http://www.w3.org/2000/svg'
 function showOverlay(sheet,strokes,box){overlay?.remove();overlay=document.createElementNS(svgNS,'svg');overlay.classList.add('suite-drawing-overlay');overlay.setAttribute('viewBox',`0 0 ${box.width} ${box.height}`);for(const points of strokes){const path=document.createElementNS(svgNS,'polyline');path.setAttribute('points',points.map(p=>p.join(',')).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke',color.value);path.setAttribute('stroke-width','2');path.setAttribute('stroke-dasharray','5 3');overlay.append(path)}sheet.append(overlay)}
 function coordinates(event,sheet,word){const r=sheet.getBoundingClientRect();return word?[(event.clientX-r.left)*sheet.offsetWidth/r.width,(event.clientY-r.top)*sheet.offsetHeight/r.height]:app.viewport().convertToPdfPoint((event.clientX-r.left)*app.viewport().width/r.width,(event.clientY-r.top)*app.viewport().height/r.height)}
 $('stage').addEventListener('pointerdown',event=>{
   if(!action||event.button!==0)return
   if(gesture){gesture=null;overlay?.remove();return}
   const word=app.get()?.extension!=='pdf',sheet=word?event.target.closest('#word-sheet section.docx'):$('pdf-sheet')
   if(!sheet||!sheet.contains(event.target))return
   event.preventDefault();event.stopImmediatePropagation();sheet.setPointerCapture(event.pointerId)
   gesture={id:event.pointerId,start:coordinates(event,sheet,word),sheet,word,document:app.get().id,mode:action}
 },true)
 $('stage').addEventListener('pointermove',event=>{
   if(!gesture||gesture.id!==event.pointerId)return
   event.preventDefault();event.stopImmediatePropagation();const g=gesture,end=coordinates(event,g.sheet,g.word),strokes=shapeStrokes(g.mode==='select'?'rectangle':g.mode,g.start,end)
   if(g.word)showOverlay(g.sheet,strokes,{width:g.sheet.offsetWidth,height:g.sheet.offsetHeight})
   else showOverlay(g.sheet,strokes.map(s=>s.map(p=>app.viewport().convertToViewportPoint(...p))),app.viewport())
 },true)
 $('stage').addEventListener('pointercancel',()=>{gesture=null;overlay?.remove()},true)
 $('stage').addEventListener('pointerup',event=>{
   if(!gesture||gesture.id!==event.pointerId)return
   const g=gesture;gesture=null;event.preventDefault();event.stopImmediatePropagation();const end=coordinates(event,g.sheet,g.word)
   if(app.get()?.id!==g.document){overlay?.remove();return}
   if(g.mode==='move'){void transform('apply',{dx:end[0]-g.start[0],dy:end[1]-g.start[1]}).then(saved=>{overlay?.remove();action='select';if(saved)app.status('Drawings moved. Undo restores their previous position.')}).catch(app.fail)}else if(g.mode==='select'){
     const rect=drawingBounds([{points:[g.start,end]}]);selectedDoc=g.document;selectedVersion=app.get().contentVersion;selectedPage=app.page()
     if(g.word){selectedWordPage=g.sheet;wordSelection=[...g.sheet.querySelectorAll('.word-saved-ink')].filter(image=>{const r={x:parseFloat(image.style.left),y:parseFloat(image.style.top),width:parseFloat(image.style.width),height:parseFloat(image.style.height)};return r.x+r.width>=rect[0]&&r.y+r.height>=rect[1]&&r.x<=rect[2]&&r.y<=rect[3]}).map(image=>({image,target:image.dataset.inkTarget,position:{x:parseFloat(image.style.left),y:parseFloat(image.style.top),width:parseFloat(image.style.width),height:parseFloat(image.style.height),...(image.dataset.inkParagraphY===undefined?{}:{paragraphY:Number(image.dataset.inkParagraphY)})}}))}
     else{selection=app.get().marks.filter(m=>m.kind==='ink'&&m.page===selectedPage).filter(m=>{const r=drawingBounds([m]);return r[2]>=rect[0]&&r[3]>=rect[1]&&r[0]<=rect[2]&&r[1]<=rect[3]}).map(m=>m.id)}
     const count=selection.length||wordSelection.length;app.status(count+' drawings selected.');message.textContent=count+' drawings selected.';panel.showModal()
   }else if(Math.hypot(end[0]-g.start[0],end[1]-g.start[1])>2){
     const strokes=shapeStrokes(g.mode,g.start,end)
     void(async()=>{
       if(!g.word){const result=await app.edit({kind:'signature',page:app.page(),strokes,color:color.value,width:Number(width.value)});if(!result)throw Error('Shape was not saved. Please retry.');if(result==='queued'){overlay?.remove();return}}
       else{
         await app.pending();const doc=app.get();if(doc.id!==g.document)throw Error('The document changed.')
         const bounds=drawingBounds(strokes.map(points=>({points}))),pad=(g.mode==='highlighter'?12:Number(width.value))+2,x=Math.max(0,bounds[0]-pad),y=Math.max(0,bounds[1]-pad),w=Math.min(g.sheet.offsetWidth-x,bounds[2]-x+pad),h=Math.min(g.sheet.offsetHeight-y,bounds[3]-y+pad),canvas=document.createElement('canvas');canvas.width=Math.ceil(w*2);canvas.height=Math.ceil(h*2);const ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.globalAlpha=g.mode==='highlighter'?.25:1;ctx.strokeStyle=color.value;ctx.lineWidth=g.mode==='highlighter'?12:Number(width.value);ctx.lineJoin=ctx.lineCap='round';for(const stroke of strokes){ctx.beginPath();stroke.forEach(([a,b],i)=>i?ctx.lineTo(a-x,b-y):ctx.moveTo(a-x,b-y));ctx.stroke()}
         const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))
         const paragraph=g.sheet.querySelector('[data-word-index]');if(!paragraph)throw Error('Select a page with an editable paragraph.')
         await app.request('/api/word-image/'+doc.id,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Operation-Id':app.editId(),'X-Document-Version':String(doc.contentVersion),'X-Paragraph-Index':paragraph.dataset.wordIndex,'X-Word-Ink':JSON.stringify({x,y,width:w,height:h})},body:blob});await app.refresh()
       }
       overlay?.remove();app.status('Shape saved. Undo removes it.')
     })().catch(app.fail)
   }else overlay?.remove()
 },true)
 $('stage').addEventListener('document-navigation-start',()=>{gesture=null;overlay?.remove()})
 document.addEventListener('click',event=>{if(event.target.closest('[data-mode],#word-draw')){action=null;gesture=null;overlay?.remove();$('stage').classList.remove('suite-drawing-active')}},true)
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){action=null;gesture=null;overlay?.remove();$('stage').classList.remove('suite-drawing-active')}})
 return {stop(){action=null;gesture=null;overlay?.remove();$('stage').classList.remove('suite-drawing-active')}}
}
