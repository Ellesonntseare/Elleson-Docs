export const scanFilterOptions=[['photo','Original'],['auto','Auto Enhance'],['colour','Colour'],['bw','B&W'],['grayscale','Grayscale'],['receipt','Receipt'],['clean','Clean Paper'],['document','Document'],['invert','Invert']]
export function installFilterGallery({select,image,beforeImage,container,id}){
 select.replaceChildren(...scanFilterOptions.map(([value,label])=>new Option(label,value)));select.value='document'
 const frame=document.createElement('div');frame.className='scan-compare-frame';image.before(frame);frame.append(image)
 const original=document.createElement('img');original.className='scan-before-image';original.alt='Before filtering';frame.append(original)
 const beforeLabel=document.createElement('span'),afterLabel=document.createElement('span');beforeLabel.className='scan-before-label';beforeLabel.textContent='Before';afterLabel.className='scan-after-label';afterLabel.textContent='After';frame.append(beforeLabel,afterLabel)
 const slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='100';slider.value='50';slider.className='scan-compare-slider';slider.setAttribute('aria-label','Before and after divider');frame.append(slider)
 const line=document.createElement('span');line.className='scan-compare-line';line.innerHTML='<span>↔</span>';frame.append(line)
 const controls=document.createElement('div');controls.className='scan-gallery-controls';container.append(controls)
 const compare=document.createElement('button');compare.type='button';compare.textContent='Compare';compare.id=id+'-compare';compare.setAttribute('aria-pressed','false');controls.append(compare)
 const strip=document.createElement('div');strip.className='scan-filter-strip';strip.id=id+'-filter-previews';strip.setAttribute('role','group');strip.setAttribute('aria-label','Filter previews');controls.append(strip)
 const cards=scanFilterOptions.map(([filter,label])=>{const b=document.createElement('button');b.type='button';b.className='scan-filter-card';b.dataset.filter=filter;b.setAttribute('aria-label',label);const thumb=document.createElement('img');thumb.alt='';const caption=document.createElement('span');caption.textContent=label;b.append(thumb,caption);b.onclick=()=>{select.value=filter;sync();select.dispatchEvent(new Event('change',{bubbles:true}))};strip.append(b);return b})
 let generation=0,urls=[],sourceKey,previousSettings
 const sync=()=>cards.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===select.value)))
 select.addEventListener('change',sync)
 slider.oninput=()=>frame.style.setProperty('--compare-position',slider.value+'%')
 compare.onclick=()=>{const active=compare.getAttribute('aria-pressed')!=='true';compare.setAttribute('aria-pressed',String(active));frame.classList.toggle('comparing',active)}
 function clear(){generation++;urls.forEach(url=>URL.revokeObjectURL(url));urls=[];sourceKey=null;original.removeAttribute('src');cards.forEach(b=>b.querySelector('img').removeAttribute('src'))}
 container.closest('dialog')?.addEventListener('close',clear)
 sync()
 return {sync,async update(blob,options={}){
  sync();const settings=JSON.stringify({...options,filter:undefined,maxDimension:160});if(blob===sourceKey&&settings===previousSettings)return
  sourceKey=blob;previousSettings=settings;const own=++generation,old=urls;urls=[];const {prepareImage}=await import('./scan-runtime.mjs')
  const before=await prepareImage(blob,{...options,filter:'photo',brightness:0,contrast:0,sharpness:0,whitening:0,maxDimension:1000});if(own!==generation)return
  const url=URL.createObjectURL(before);urls.push(url);original.src=url;if(beforeImage)beforeImage.src=url;old.forEach(u=>URL.revokeObjectURL(u))
  for(const card of cards){
   const filtered=await prepareImage(blob,{...options,filter:card.dataset.filter,maxDimension:160});if(own!==generation)return
   const thumb=URL.createObjectURL(filtered);urls.push(thumb);card.querySelector('img').src=thumb
   await new Promise(resolve=>setTimeout(resolve,0))
  }
 },clear}
}
