// Zoom the writing surface without changing the stored signature coordinates.
export function installSignatureGestures({canvas,getView,setView,cancelStroke}) {
  const contacts=new Map();let gesture,suppressed=false
  const measure=()=>{const [a,b]=[...contacts.values()],rect=canvas.getBoundingClientRect();return {x:((a.x+b.x)/2-rect.left)/rect.width,y:((a.y+b.y)/2-rect.top)/rect.height,distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))}}
  canvas.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch')return;contacts.set(event.pointerId,{x:event.clientX,y:event.clientY});if(contacts.size<2&&!suppressed)return;cancelStroke();if(!gesture&&contacts.size>=2){const point=measure(),view=getView();gesture={...point,...view,anchorX:(point.x-view.x)/view.scale,anchorY:(point.y-view.y)/view.scale}}suppressed=true;canvas.setPointerCapture(event.pointerId);event.preventDefault();event.stopImmediatePropagation()},true)
  canvas.addEventListener('pointermove',event=>{if(!contacts.has(event.pointerId))return;contacts.set(event.pointerId,{x:event.clientX,y:event.clientY});if(!suppressed)return;event.preventDefault();event.stopImmediatePropagation();if(!gesture||contacts.size<2)return;const point=measure(),scale=gesture.scale*point.distance/gesture.distance;setView({scale,x:point.x-gesture.anchorX*scale,y:point.y-gesture.anchorY*scale})},true)
  const end=event=>{contacts.delete(event.pointerId);if(!suppressed)return;event.preventDefault();event.stopImmediatePropagation();if(contacts.size<2)gesture=null;if(!contacts.size)suppressed=false}
  canvas.addEventListener('pointerup',end,true);canvas.addEventListener('pointercancel',end,true)
}
