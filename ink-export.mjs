// Match the quadratic curves displayed by smooth-ink.mjs in saved PDFs.
// PDF uses an upward Y axis; drawSvgPath flips SVG's downward Y axis for us.
export function drawPdfInk(page,mark,color) {
  const points=mark.points,width=mark.width||1.7,opacity=mark.opacity??1
  if(!points?.length)return
  if(points.length===1){page.drawCircle({x:points[0][0],y:points[0][1],size:width/2,color,opacity});return}
  let path=`M ${points[0][0]} ${-points[0][1]}`
  for(let i=1;i<points.length-1;i++)path+=` Q ${points[i][0]} ${-points[i][1]} ${(points[i][0]+points[i+1][0])/2} ${-(points[i][1]+points[i+1][1])/2}`
  path+=` L ${points.at(-1)[0]} ${-points.at(-1)[1]}`
  page.drawSvgPath(path,{x:0,y:0,borderColor:color,borderWidth:width,borderOpacity:opacity,borderLineCap:1})
}
