import {applyScanFilter} from './scan-filters.mjs'
self.onmessage=async({data:{id,file,options}})=>{
 let bitmap
 try{
  bitmap=await createImageBitmap(file,{imageOrientation:'from-image'})
  const scale=Math.min(1,Math.max(80,Math.min(2000,Number(options.maxDimension)||2000))/Math.max(bitmap.width,bitmap.height))
  const canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale))),ctx=canvas.getContext('2d')
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();bitmap=null
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);applyScanFilter(pixels.data,canvas.width,canvas.height,options);ctx.putImageData(pixels,0,0)
  self.postMessage({id,blob:await canvas.convertToBlob({type:'image/png'})})
 }catch(error){bitmap?.close();self.postMessage({id,error:error.message})}
}
