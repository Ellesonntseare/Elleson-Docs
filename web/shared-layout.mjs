let cachedDocument, cachedParagraphs = new Map()

// Some Word font features make computedStyle.font an empty string. Copy the
// actual properties so a large heading cannot silently inherit body-text size.
const fontProperties=['fontFamily','fontSize','fontWeight','fontStyle','fontStretch','fontVariant','fontFeatureSettings','fontVariationSettings','letterSpacing','wordSpacing','textDecoration','textTransform','direction']
function fontStyle(style){return Object.fromEntries(fontProperties.map(name=>[name,style[name]]))}
export function layoutRuns(characters){
 const runs=[]
 for(const c of characters){
  const previous=runs.at(-1),key=JSON.stringify([c.font,c.style,c.color])
  if(previous&&previous.key===key&&Math.abs(previous.y-c.y)<.2&&Math.abs(previous.height-c.height)<.2&&Math.abs(previous.x+previous.width-c.x)<.3){
   previous.text+=c.text;previous.width=c.x+c.width-previous.x
  }else runs.push({...c,key})
 }
 return runs.map(({key,...run})=>run)
}

// Versioned PC geometry is the authority for connected Word clients.
export async function shareWordLayout({sheet,source,role,request}) {
 const pages=[...sheet.querySelectorAll('section.docx')]
 if(!pages.length||location.hostname==='appassets.androidplatform.net')return
 const url='/api/word-layout/'+source.id+'?version='+source.contentVersion
 if(role==='pc'){
  await document.fonts.ready
  if(cachedDocument!==source.id){cachedDocument=source.id;cachedParagraphs.clear()}
  const nextCache=new Map()
  const geometry=pages.map(page=>{const box=page.getBoundingClientRect(),scale=box.width/page.offsetWidth
   const paragraphs=[...page.querySelectorAll('[data-word-layout-index],[data-word-source-index]')].map(p=>{
    const r=p.getBoundingClientRect(),layoutIndex=p.dataset.wordLayoutIndex===undefined?undefined:Number(p.dataset.wordLayoutIndex),index=p.dataset.wordSourceIndex===undefined?-(layoutIndex+1):Number(p.dataset.wordSourceIndex)
    const key=[p.outerHTML,r.width/scale,r.height/scale,JSON.stringify(fontStyle(getComputedStyle(p)))].join('|')
    const cached=cachedParagraphs.get(index)
    const characters=cached?.key===key?cached.characters:[]
    const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT)
    let node;while(cached?.key!==key&&(node=walker.nextNode())){const s=getComputedStyle(node.parentElement),style=fontStyle(s);for(let i=0;i<node.length;i++){const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+1);const b=range.getBoundingClientRect();characters.push({text:node.textContent[i],x:(b.left-r.left)/scale,y:(b.top-r.top)/scale,width:b.width/scale,height:b.height/scale,font:s.font,style,color:s.color})}}
    nextCache.set(index,{key,characters})
    return {index,layoutIndex,x:(r.left-box.left)/scale,y:(r.top-box.top)/scale,width:r.width/scale,height:r.height/scale,characters:layoutRuns(characters)}
   });const objects=[...page.querySelectorAll('table,img:not(.word-saved-ink)')].map(el=>{const r=el.getBoundingClientRect();return {x:(r.left-box.left)/scale,y:(r.top-box.top)/scale,width:r.width/scale,height:r.height/scale}});return {width:page.offsetWidth,height:page.offsetHeight,paragraphs,objects}
  })
  cachedParagraphs=nextCache
  await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:source.contentVersion,pages:geometry})});return
 }
 let geometry
 for(let attempt=0;attempt<20;attempt++){const response=await request(url);geometry=await response.json();if(geometry)break;await new Promise(r=>setTimeout(r,150))}
 if(!geometry)return
 const glyphs=[]
 for(let i=0;i<geometry.pages.length;i++){
  const data=geometry.pages[i],page=pages[i];if(!page)continue
  page.style.width=data.width+'px';page.style.height=data.height+'px';page.style.minHeight=data.height+'px'
  const objects=[...page.querySelectorAll('table,img:not(.word-saved-ink)')];objects.forEach((el,index)=>{const r=data.objects?.[index];if(r){Object.assign(el.style,{position:'absolute',left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px',margin:'0'});page.append(el)}})
  for(const item of data.paragraphs){const p=sheet.querySelector(item.layoutIndex===undefined?'[data-word-source-index="'+item.index+'"]':'[data-word-layout-index="'+item.layoutIndex+'"]');if(!p)continue
   if(p.querySelector('img,svg,canvas'))continue
   const fragment=document.createDocumentFragment();p.replaceChildren();Object.assign(p.style,{position:'absolute',left:item.x+'px',top:item.y+'px',width:item.width+'px',height:item.height+'px',margin:'0',padding:'0'})
   const runs=layoutRuns(item.characters)
   for(const c of runs){const span=document.createElement('span');span.textContent=c.text;Object.assign(span.style,{position:'absolute',left:c.x+'px',top:c.y+'px',width:c.width+'px',height:c.height+'px',font:c.font,...c.style,color:c.color,whiteSpace:'pre',textIndent:'0'});fragment.append(span)}
   p.append(fragment)
   p.addEventListener('beforeinput',()=>{
    if(!p.querySelector('span[style]'))return
    const selection=getSelection(),offset=(node,end)=>{const range=document.createRange();range.selectNodeContents(p);range.setEnd(node,end);return range.toString().length}
    let anchor=0,focus=0;try{anchor=offset(selection.anchorNode,selection.anchorOffset);focus=offset(selection.focusNode,selection.focusOffset)}catch{}
    p.textContent=p.textContent
    if(p.firstChild)selection.setBaseAndExtent(p.firstChild,Math.min(anchor,p.textContent.length),p.firstChild,Math.min(focus,p.textContent.length))
   },{once:true})
   page.append(p)
   glyphs.push({p,page,data,item:{...item,characters:runs}})
  }
 }
 // Position the entire document before measuring glyphs. Yielding after each
 // paragraph exposed intermediate layouts, making the phone text fill upward.
 const corrections=[]
 for(const {p,page,data,item} of glyphs){
   const scale=page.getBoundingClientRect().width/data.width
   for(const [index,span] of [...p.children].entries()){
     const c=item.characters[index],range=document.createRange();range.selectNodeContents(span)
     const glyph=range.getBoundingClientRect(),box=span.getBoundingClientRect()
     corrections.push({span,top:c.y-(glyph.top-box.top)/scale})
   }
 }
 for(const {span,top} of corrections)span.style.top=top+'px'
 for(const page of pages){page.style.contentVisibility='auto';page.style.containIntrinsicSize=page.offsetWidth+'px '+page.offsetHeight+'px'}
 sheet.dataset.sharedLayout=String(source.contentVersion)
}
