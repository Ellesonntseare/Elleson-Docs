export function inkTile(pageWidth,pageHeight,visibleTop,visibleHeight,screenScale=1,dpr=2){
 const density=Math.min(2,Math.max(.5,screenScale*dpr),2048/pageWidth)
 const height=Math.min(pageHeight,Math.max(128,Math.min(2048/density,visibleHeight+256)))
 const top=Math.max(0,Math.min(pageHeight-height,Math.floor(visibleTop-128)))
 return {top,height,width:pageWidth,density,pixelWidth:Math.ceil(pageWidth*density),pixelHeight:Math.ceil(height*density)}
}
