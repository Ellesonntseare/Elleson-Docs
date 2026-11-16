import {strokePath} from './smooth-ink.mjs'
export function validInk(ink){return ink&&[ink.width,ink.height].every(n=>Number.isFinite(n)&&n>0&&n<=5000)&&Array.isArray(ink.strokes)&&ink.strokes.length<=200&&ink.strokes.reduce((n,s)=>n+(s.points?.length||0),0)<=20000&&ink.strokes.every(s=>/^#[0-9a-f]{6}$/i.test(s.color)&&Number.isFinite(s.width)&&s.width>0&&s.width<=300&&Array.isArray(s.points)&&s.points.length>0&&s.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<=200000)))}
export function inkSvg(ink){
 if(!validInk(ink))return null
 const paths=ink.strokes.map(s=>{
  const p=s.points;if(p.length===1)return `<circle cx="${p[0][0]}" cy="${p[0][1]}" r="${s.width/2}" fill="${s.color}"/>`
  let d=`M${p[0].join(' ')}`;for(let i=1;i<p.length-1;i++)d+=`Q${p[i].join(' ')} ${(p[i][0]+p[i+1][0])/2} ${(p[i][1]+p[i+1][1])/2}`
  return `<path d="${d}L${p.at(-1).join(' ')}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"/>`
 }).join('')
 return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ink.width} ${ink.height}" width="${ink.width}" height="${ink.height}">${paths}</svg>`)
}
export function inkPng(ink){
 if(!validInk(ink))throw Error('The drawing strokes are invalid.')
 const scale=Math.min(4,4096/Math.max(ink.width,ink.height)),c=document.createElement('canvas');c.width=Math.ceil(ink.width*scale);c.height=Math.ceil(ink.height*scale)
 const ctx=c.getContext('2d');ctx.scale(scale,scale);ctx.lineCap=ctx.lineJoin='round'
 for(const s of ink.strokes){ctx.strokeStyle=s.color;ctx.lineWidth=s.width;strokePath(ctx,s.points)}
 return c.toDataURL('image/png').split(',')[1]
}
// Clip each line segment against the eraser disk, retaining outside fragments.
export function cutStroke(points,center,radius){
 if(points.length===1)return Math.hypot(points[0][0]-center[0],points[0][1]-center[1])>radius?[points]:[]
 const fragments=[];let run=[]
 const add=(a,b)=>{if(run.length&&Math.hypot(run.at(-1)[0]-a[0],run.at(-1)[1]-a[1])>1e-6){fragments.push(run);run=[]}if(!run.length)run.push(a);run.push(b)}
 const flush=()=>{if(run.length)fragments.push(run);run=[]}
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],x=a[0]-center[0],y=a[1]-center[1],aa=dx*dx+dy*dy,bb=2*(x*dx+y*dy),cc=x*x+y*y-radius*radius,disc=bb*bb-4*aa*cc
  const cuts=[0,1]
  if(aa>0&&disc>=0)for(const t of [(-bb-Math.sqrt(disc))/(2*aa),(-bb+Math.sqrt(disc))/(2*aa)])if(t>0&&t<1)cuts.push(t)
  cuts.sort((a,b)=>a-b)
  for(let j=1;j<cuts.length;j++){
   const u=cuts[j-1],v=cuts[j],mid=(u+v)/2
   if((x+dx*mid)**2+(y+dy*mid)**2>radius*radius)add([a[0]+dx*u,a[1]+dy*u],[a[0]+dx*v,a[1]+dy*v]);else flush()
  }
 }
 flush();return fragments
}
export function erasePath(points,path,radius){
 let parts=[points]
 for(let i=0;i<path.length;i++){
  const a=path[Math.max(0,i-1)],b=path[i],steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/Math.max(1,radius/2)))
  for(let n=1;n<=steps;n++){const c=[a[0]+(b[0]-a[0])*n/steps,a[1]+(b[1]-a[1])*n/steps];parts=parts.flatMap(p=>cutStroke(p,c,radius))}
 }
 return parts
}
