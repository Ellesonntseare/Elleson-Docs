export function pageCorners(pixels,width,height){
  // Segment paper from the background; keep a single connected sheet so bright
  // objects elsewhere in a camera frame cannot stretch the crop to the edges.
  const histogram=new Uint32Array(256),gray=new Uint8Array(width*height)
  for(let i=0;i<gray.length;i++){gray[i]=Math.round(.299*pixels[i*4]+.587*pixels[i*4+1]+.114*pixels[i*4+2]);histogram[gray[i]]++}
  let sum=0;for(let i=0;i<256;i++)sum+=i*histogram[i]
  let total=0,background=0,best=0,threshold=170
  for(let t=0;t<255;t++){
    total+=histogram[t];background+=t*histogram[t]
    if(!total||total===gray.length)continue
    const variance=total*(gray.length-total)*(background/total-(sum-background)/(gray.length-total))**2
    if(variance>best){best=variance;threshold=t}
  }
  threshold=Math.max(85,Math.min(220,threshold+8))
  const visited=new Uint8Array(gray.length),queue=new Int32Array(gray.length)
  let largest=null
  for(let start=0;start<gray.length;start++){
    if(visited[start]||gray[start]<threshold)continue
    let head=0,tail=1;queue[0]=start;visited[start]=1
    const extrema=[Infinity,-Infinity,-Infinity,Infinity],corners=[null,null,null,null]
    while(head<tail){
      const p=queue[head++],x=p%width,y=Math.floor(p/width),scores=[x+y,x-y,x+y,x-y]
      for(let j=0;j<4;j++)if(j===0||j===3?scores[j]<extrema[j]:scores[j]>extrema[j]){extrema[j]=scores[j];corners[j]=[x/(width-1),y/(height-1)]}
      for(const n of [x? p-1:-1,x<width-1?p+1:-1,y?p-width:-1,y<height-1?p+width:-1])if(n>=0&&!visited[n]&&gray[n]>=threshold){visited[n]=1;queue[tail++]=n}
    }
    if(!largest||tail>largest.size)largest={size:tail,corners}
  }
  const fallback=[[0,0],[1,0],[1,1],[0,1]]
  if(!largest||largest.size<gray.length*.12)return fallback
  const points=largest.corners
  if(!points.every((a,i)=>{const b=points[(i+1)%4],c=points[(i+2)%4];return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0])>.005}))return fallback
  // A small safety margin avoids clipping the paper edge and nearby lettering.
  const cx=points.reduce((s,p)=>s+p[0],0)/4,cy=points.reduce((s,p)=>s+p[1],0)/4
  return points.map(([x,y])=>[Math.max(0,Math.min(1,cx+(x-cx)*1.015)),Math.max(0,Math.min(1,cy+(y-cy)*1.015))])
}
