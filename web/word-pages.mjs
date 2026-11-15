// Preserve page geometry; scale the whole page rather than reflowing its contents.
export function installWordPageSizing(sheet, stage) {
  let magnification = 1
  const fit = () => {
    const pages = [...sheet.querySelectorAll('section.docx')]
    if (sheet.hidden || !pages.length) return
    const natural = Math.max(...pages.map(page => page.offsetWidth))
    const style = getComputedStyle(stage)
    const available = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2
    if(sheet.style.width!==natural+'px')sheet.style.width = natural + 'px'
    const next=Math.min(1, available / natural) * magnification
    if(Math.abs(parseFloat(sheet.style.zoom)-next)>1e-6||!sheet.style.zoom)sheet.style.zoom=next
  }
  new ResizeObserver(fit).observe(stage)
  return { fit, getZoom:()=>magnification, setZoom(value){magnification=(Number.isFinite(value)&&value>0?value:magnification);fit()}, zoom(factor) { magnification = magnification * factor; fit() }, reset() { magnification = 1; fit() } }
}

const seenInk=new Set()
export async function renderWordPages(bytes, container, styles) {
  const zip = await window.JSZip.loadAsync(bytes)
  const xml = new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'), 'application/xml')
  const ns = xml.documentElement.namespaceURI
  const paragraphs = [...xml.getElementsByTagNameNS(ns, 'p')]
  const directText = p => [...p.getElementsByTagNameNS(ns, 't')].filter(t => {let n=t.parentNode;while(n&&n.localName!=='p')n=n.parentNode;return n===p}).map(t=>t.textContent).join('')
  const lines = paragraphs.map(directText), ink = []
  const relations = new DOMParser().parseFromString(await zip.file('word/_rels/document.xml.rels').async('string'), 'application/xml')
  for (const p of paragraphs) for (const drawing of [...p.getElementsByTagNameNS(ns, 'drawing')]) {
    const property = [...drawing.getElementsByTagName('*')].find(n => n.localName === 'docPr' && n.getAttribute('name') === 'Elleson ink')
    if (!property) continue
    const description = JSON.parse(property.getAttribute('descr'))
    const blip = [...drawing.getElementsByTagName('*')].find(n=>n.localName==='blip')
    const relation = [...relations.documentElement.children].find(n=>n.getAttribute('Id')===[...blip.attributes].find(a=>a.localName==='embed')?.value)
    const target = relation?.getAttribute('Target')
    if (!target || target.includes('..')) continue
    const image = zip.file('word/'+target.replace(/^\//,''))
    if (!image) continue
    ink.push({...description,id:target,index:paragraphs.indexOf(p),data:'data:image/png;base64,'+await image.async('base64')})
    drawing.parentNode.removeChild(drawing)
  }
  let rendered = bytes
  if (ink.length) { zip.file('word/document.xml',new XMLSerializer().serializeToString(xml)); rendered=await zip.generateAsync({type:'uint8array'}) }
  await window.docx.renderAsync(rendered, container, styles, {inWrapper:true,useBase64URL:true,renderComments:false,renderFootnotes:true})
  // Use the PC's actual font bytes on both connected screens, instead of Android substitutes.
  if(location.hostname!=='appassets.androidplatform.net') {
    const containerParent=container.parentNode,containerNext=container.nextSibling,stylesParent=styles.parentNode,stylesNext=styles.nextSibling
    const measurement=document.createElement('div');Object.assign(measurement.style,{position:'fixed',left:'-20000px',visibility:'hidden'});document.body.append(measurement);measurement.append(styles,container)
    const faces=[['Arial',['arial.ttf','arialbd.ttf','ariali.ttf','arialbi.ttf']],['Calibri',['calibri.ttf','calibrib.ttf','calibrii.ttf','calibriz.ttf']],['Cambria',['cambria.ttc','cambriab.ttf','cambriai.ttf','cambriaz.ttf']],['Times New Roman',['times.ttf','timesbd.ttf','timesi.ttf','timesbi.ttf']],['Courier New',['cour.ttf','courbd.ttf','couri.ttf','courbi.ttf']]]
    const css=document.createElement('style')
    css.textContent=faces.flatMap(([family,files])=>files.map((file,i)=>`@font-face{font-family:"Elleson ${family}";src:url('/document-fonts/${file}');font-weight:${i%2?700:400};font-style:${i>=2?'italic':'normal'};font-display:block}`)).join('')
    styles.append(css)
    for(const element of container.querySelectorAll('section.docx,section.docx *')) {
      const family=getComputedStyle(element).fontFamily
      const match=faces.find(([name])=>family.toLowerCase().includes(name.toLowerCase()))
      if(match)element.style.fontFamily='"Elleson '+match[0]+'",'+family
    }
    container.getBoundingClientRect();await document.fonts.ready
    measurement.remove();container.remove();styles.remove()
    if(stylesParent)stylesParent.insertBefore(styles,stylesNext?.parentNode===stylesParent?stylesNext:null)
    if(containerParent)containerParent.insertBefore(container,containerNext?.parentNode===containerParent?containerNext:null)
  }
  let position = 0
  for (const p of container.querySelectorAll('article p')) {
    const index=lines.findIndex((text,index)=>index>=position&&text===p.textContent)
    if (index<0) continue
    p.dataset.wordSourceIndex=index;position=index+1
  }
  for (const item of ink) {
    const page=container.querySelector('[data-word-source-index="'+item.index+'"]')?.closest('section.docx')
    if (!page) continue
    const image=document.createElement('img');image.className='word-saved-ink';image.alt='Edit handwritten drawing';image.tabIndex=0;image.setAttribute('role','button');image.src=item.data;image.dataset.inkTarget=item.id;image.dataset.inkParagraph=String(item.index);if(Number.isFinite(item.paragraphY))image.dataset.inkParagraphY=String(item.paragraphY)
    if(!seenInk.has(item.id)){image.classList.add('incoming-writing');seenInk.add(item.id)}
    Object.assign(image.style,{left:item.x+'px',top:item.y+'px',width:item.width+'px',height:item.height+'px'})
    page.append(image)
  }
}

export function positionAnchoredInk(sheet) {
  for (const image of sheet.querySelectorAll('[data-ink-paragraph-y]')) {
    const paragraph = sheet.querySelector('[data-word-source-index="'+image.dataset.inkParagraph+'"]')
    const page=paragraph?.closest('section.docx')
    if(!page)continue
    const bounds=page.getBoundingClientRect()
    if(!bounds.height)continue
    page.append(image)
    image.style.top=((paragraph.getBoundingClientRect().top-bounds.top)*page.offsetHeight/bounds.height+Number(image.dataset.inkParagraphY))+'px'
  }
}
