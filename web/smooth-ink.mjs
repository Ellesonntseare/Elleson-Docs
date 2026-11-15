export function strokePath(context,points) {
  if(!points.length)return
  context.beginPath();context.moveTo(...points[0])
  for(let i=1;i<points.length-1;i++)context.quadraticCurveTo(...points[i],(points[i][0]+points[i+1][0])/2,(points[i][1]+points[i+1][1])/2)
  if(points.length>1)context.lineTo(...points.at(-1))
  context.stroke()
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
