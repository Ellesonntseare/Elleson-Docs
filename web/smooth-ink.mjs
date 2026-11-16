export function strokePath(context,points) {
  if(!points.length)return
  if(points.length===1){context.beginPath();context.arc(...points[0],context.lineWidth/2,0,Math.PI*2);context.fillStyle=context.strokeStyle;context.fill();return}
  context.beginPath();context.moveTo(...points[0])
  for(let i=1;i<points.length-1;i++)context.quadraticCurveTo(...points[i],(points[i][0]+points[i+1][0])/2,(points[i][1]+points[i+1][1])/2)
  if(points.length>1)context.lineTo(...points.at(-1))
  context.stroke()
}

// A small temporary tail reaches the latest sample immediately. The main canvas
// retains finished curves, so long strokes do not need to be repainted each frame.
export function createStrokeTip(canvas) {
  const tip=document.createElement('canvas');tip.className='live-ink-tip'
  Object.assign(tip.style,{position:'absolute',pointerEvents:'none',zIndex:'5'})
  tip.hidden=true;canvas.after(tip)
  return {
    clear(){tip.hidden=true},
    paint(points,width,color,opacity=1,project=point=>point){
      if(!points.length)return
      const end=project(points.at(-1)),previous=points.length>1?project(points.at(-2)):end
      const start=points.length>2?[(previous[0]+end[0])/2,(previous[1]+end[1])/2]:previous
      const pad=width/2+2,x=Math.floor(Math.min(start[0],end[0])-pad),y=Math.floor(Math.min(start[1],end[1])-pad)
      tip.width=Math.ceil(Math.abs(end[0]-start[0])+pad*2);tip.height=Math.ceil(Math.abs(end[1]-start[1])+pad*2)
      Object.assign(tip.style,{left:x/canvas.width*100+'%',top:y/canvas.height*100+'%',width:tip.width/canvas.width*100+'%',height:tip.height/canvas.height*100+'%'})
      const ctx=tip.getContext('2d');ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.globalAlpha=opacity
      strokePath(ctx,points.length===1?[[end[0]-x,end[1]-y]]:[[start[0]-x,start[1]-y],[end[0]-x,end[1]-y]])
      tip.hidden=false
    }
  }
}
export function pointerSamples(event){const samples=event.getCoalescedEvents?.();return samples?.length?samples:[event]}

// Commit each curve segment once. Drawing cost depends on new samples, not stroke length.
export function incrementalStroke(context,points,from=1,finish=false,project=point=>point){
 if(points.length<2)return from
 context.beginPath()
 const start=from===1?points[0]:[(points[from-1][0]+points[from][0])/2,(points[from-1][1]+points[from][1])/2]
 context.moveTo(...project(start))
 for(;from<points.length-1;from++)context.quadraticCurveTo(...project(points[from]),...project([(points[from][0]+points[from+1][0])/2,(points[from][1]+points[from+1][1])/2]))
 if(finish)context.lineTo(...project(points.at(-1)))
 context.stroke();return from
}
