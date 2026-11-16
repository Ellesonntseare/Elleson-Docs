import {strokePath} from './smooth-ink.mjs'
export const drawingSettings={smoothing:.2,stylusOnly:false,eraser:false,eraserType:'stroke',eraserSize:20,anchor:'page'}
export function installDrawingSettings(){
 const panel=document.getElementById('ink-color').closest('.tool-menu-panel')
 const controls=document.createElement('div');controls.className='actions';controls.innerHTML='<label>Smoothing <input id="ink-smoothing" type="range" min="0" max="1" step="0.1" value="0.2"></label><label><input id="stylus-only" type="checkbox"> Stylus writes, finger scrolls</label><label><input id="drawing-eraser" type="checkbox"> Eraser</label><label>Erase <select id="eraser-type"><option value="stroke">Whole stroke</option><option value="partial">Part of stroke</option></select></label><label>Eraser size <input id="eraser-size" type="range" min="4" max="100" value="20"></label><label>Word ink position <select id="ink-anchor"><option value="page">Fixed on page</option><option value="paragraph">Move with paragraph</option></select></label><canvas id="pen-preview" width="240" height="64" aria-label="Try your pen settings"></canvas>'
 panel.append(controls)
 for(const color of ['#093352','#000000','#cc2233','#1565c0','#167642','#8e24aa']){const button=document.createElement('button');button.type='button';button.style.background=color;button.style.width='36px';button.setAttribute('aria-label','Pen colour '+color);button.onclick=()=>{document.getElementById('ink-color').value=color;document.getElementById('ink-color').dispatchEvent(new Event('input',{bubbles:true}))};controls.append(button)}
 const draw=()=>{const c=document.getElementById('pen-preview'),ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.strokeStyle=document.getElementById('ink-color').value;ctx.lineWidth=Number(document.getElementById('ink-width').value);ctx.lineCap='round';ctx.beginPath();ctx.moveTo(10,18);ctx.lineTo(c.width-10,18);ctx.stroke();drawingSettings.smoothing=Number(document.getElementById('ink-smoothing').value);drawingSettings.stylusOnly=document.getElementById('stylus-only').checked;drawingSettings.eraser=document.getElementById('drawing-eraser').checked;drawingSettings.eraserType=document.getElementById('eraser-type').value;drawingSettings.eraserSize=Number(document.getElementById('eraser-size').value);drawingSettings.anchor=document.getElementById('ink-anchor').value;try{localStorage.setItem('elleson-drawing-settings',JSON.stringify(drawingSettings))}catch{}}
 try{const saved=JSON.parse(localStorage.getItem('elleson-drawing-settings'));if(saved){document.getElementById('eraser-type').value=saved.eraserType==='partial'?'partial':'stroke';document.getElementById('eraser-size').value=saved.eraserSize||20;document.getElementById('ink-smoothing').value=saved.smoothing??.2;document.getElementById('stylus-only').checked=!!saved.stylusOnly;document.getElementById('ink-anchor').value=saved.anchor||'page'}}catch{}
 panel.addEventListener('input',draw);draw()
 const canvas=document.getElementById('pen-preview'), context=canvas.getContext('2d')
 canvas.style.touchAction='none'
 let practice=[]
 const point=e=>{const b=canvas.getBoundingClientRect();return [(e.clientX-b.left)*canvas.width/b.width,(e.clientY-b.top)*canvas.height/b.height]}
 canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);practice=[point(e)];context.clearRect(0,0,canvas.width,canvas.height)}
 canvas.onpointermove=e=>{
   if(!canvas.hasPointerCapture(e.pointerId))return
   appendPoint(practice,point(e))
   context.clearRect(0,0,canvas.width,canvas.height)
   strokePath(context,practice)
 }
}
export function appendPoint(points,point){const previous=points.at(-1);if(previous&&Math.hypot(point[0]-previous[0],point[1]-previous[1])<.3)return;const amount=1-drawingSettings.smoothing*.55;points.push(previous?[previous[0]+(point[0]-previous[0])*amount,previous[1]+(point[1]-previous[1])*amount]:point)}
