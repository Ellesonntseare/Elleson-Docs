export const pictureTypes = Object.freeze({
  png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',bmp:'image/bmp'
})

export function pictureType(name,type){
  const extension=/\.([a-z0-9]+)$/i.exec(name||'')?.[1].toLowerCase()
  if(Object.hasOwn(pictureTypes,extension))return pictureTypes[extension]
  return Object.values(pictureTypes).includes(type)?type:''
}

export async function openPictureAsPdf(file){
  const mime=pictureType(file.name,file.type)
  if(!mime)throw Error('Choose a PNG, JPEG, WebP, GIF or BMP picture.')
  if(file.size>40*1024*1024)throw Error('Choose a picture smaller than 40 MB.')
  const {picturePagePdf}=await import('./conversion-runtime.mjs')
  const bytes=await picturePagePdf(new Blob([file],{type:mime}))
  const filename=(file.name.replace(/\.[^.]+$/,'')||'Picture')+'.pdf'
  return new File([bytes],filename,{type:'application/pdf'})
}
