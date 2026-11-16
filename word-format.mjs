import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate'
import {DOMParser,XMLSerializer} from '@xmldom/xmldom'
export const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

function child(parent, name) {
  return Array.from(parent.childNodes).find(node => node.namespaceURI === parent.namespaceURI && node.localName === name)
}
function ensure(parent, name, first = false) {
  let node = child(parent, name)
  if (!node) {
    node = parent.ownerDocument.createElementNS(parent.namespaceURI, "w:" + name)
    if (first) parent.insertBefore(node, parent.firstChild)
    else parent.appendChild(node)
  }
  return node
}
const set = (node, name, value) => node.setAttributeNS(node.namespaceURI, "w:" + name, String(value))

export function applyFormatting(document, formats, listIds = {}) {
  const namespace = document.documentElement.namespaceURI
  const paragraphs = Array.from(document.getElementsByTagNameNS(namespace, "p"))
  for (const [index, format] of Object.entries(formats)) {
    const paragraph = paragraphs[index]
    if (!paragraph) throw new Error("The selected paragraph changed.")
    const properties = ensure(paragraph, "pPr", true)
    if (format.align) set(ensure(properties, "jc"), "val", format.align)
    if (format.spacing) { set(ensure(properties,'spacing'),'line',Math.round(format.spacing*240)); set(ensure(properties,'spacing'),'lineRule','auto') }
    if (format.list) {
      if (format.list === "none") child(properties, "numPr")?.parentNode.removeChild(child(properties, "numPr"))
      else {
        const numbering = ensure(properties, "numPr")
        set(ensure(numbering, "ilvl"), "val", 0)
        set(ensure(numbering, "numId"), "val", listIds[format.list])
      }
    }
    for (const run of Array.from(paragraph.getElementsByTagNameNS(namespace, "r"))) {
      let owner = run.parentNode
      while (owner && !(owner.namespaceURI === namespace && owner.localName === "p")) owner = owner.parentNode
      if (owner !== paragraph) continue
      const runProperties = ensure(run, "rPr", true)
      if (format.font) {
        const fonts = ensure(runProperties, "rFonts")
        for (const attribute of ["ascii", "hAnsi", "eastAsia", "cs"]) set(fonts, attribute, format.font)
      }
      if (format.size) {
        set(ensure(runProperties, "sz"), "val", format.size * 2)
        set(ensure(runProperties, "szCs"), "val", format.size * 2)
      }
      if (typeof format.bold === "boolean") set(ensure(runProperties, "b"), "val", format.bold ? 1 : 0)
      if (typeof format.italic === "boolean") set(ensure(runProperties, "i"), "val", format.italic ? 1 : 0)
      if (typeof format.underline === 'boolean') set(ensure(runProperties,'u'),'val',format.underline?'single':'none')
      if (format.color) set(ensure(runProperties,'color'),'val',format.color.replace('#',''))
    }
  }
}

export function validFormat(format) {
  if (!format || typeof format !== "object") return false
  return Object.entries(format).every(([key, value]) =>
    key === "font" ? typeof value === "string" && value.length > 0 && value.length <= 80 :
    key === "size" ? Number.isFinite(value) && value >= 6 && value <= 96 && Number.isInteger(value * 2) :
    key === "bold" || key === "italic" || key === 'underline' ? typeof value === "boolean" :
    key === 'color' ? /^#[0-9a-f]{6}$/i.test(value) :
    key === 'spacing' ? Number.isFinite(value) && value >= 1 && value <= 3 :
    key === "align" ? ["left", "center", "right", "both"].includes(value) :
    key === "list" ? ["none", "bullet", "decimal"].includes(value) : false)
}

export function insertTable(document, index, rows, columns) {
  if (!Number.isInteger(rows) || rows < 1 || rows > 20 || !Number.isInteger(columns) || columns < 1 || columns > 10) throw new Error("Choose 1–20 rows and 1–10 columns.")
  const namespace = document.documentElement.namespaceURI
  const paragraph = document.getElementsByTagNameNS(namespace, "p")[index]
  if (!paragraph) throw new Error("Choose a paragraph for the table.")
  const table = document.createElementNS(namespace, "w:tbl")
  const properties = ensure(table, "tblPr")
  const width = ensure(properties, "tblW")
  set(width, "w", 5000)
  set(width, "type", "pct")
  const borders = ensure(properties, "tblBorders")
  for (const edge of ["top", "left", "bottom", "right", "insideH", "insideV"]) {
    const border = ensure(borders, edge)
    set(border, "val", "single")
    set(border, "sz", 4)
    set(border, "color", "A0A8A3")
  }
  const grid = ensure(table, "tblGrid")
  for (let column = 0; column < columns; column++) set(ensureNew(grid, "gridCol"), "w", Math.floor(9000 / columns))
  for (let row = 0; row < rows; row++) {
    const tr = ensureNew(table, "tr")
    for (let column = 0; column < columns; column++) {
      const cell = ensureNew(tr, "tc")
      const cellWidth = ensure(ensure(cell, "tcPr"), "tcW")
      set(cellWidth, "w", Math.floor(9000 / columns))
      set(cellWidth, "type", "dxa")
      ensure(ensure(ensure(cell, "p"), "r"), "t").textContent = " "
    }
  }
  paragraph.parentNode.insertBefore(table, paragraph.nextSibling)
}

function ensureNew(parent, name) {
  const node = parent.ownerDocument.createElementNS(parent.namespaceURI, "w:" + name)
  parent.appendChild(node)
  return node
}

export function ensureListParts(archive, Parser, Serializer, fromBytes, toBytes, namespace = wordNamespace) {
  const contentNamespace = "http://schemas.openxmlformats.org/package/2006/content-types"
  const relationNamespace = "http://schemas.openxmlformats.org/package/2006/relationships"
  const parse = text => new Parser().parseFromString(text, "application/xml")
  const serialize = document => toBytes(new Serializer().serializeToString(document))
  const numbering = parse(archive["word/numbering.xml"] ? fromBytes(archive["word/numbering.xml"])
    : '<w:numbering xmlns:w="' + namespace + '"/>')
  const root = numbering.documentElement
  let nextId = Math.max(0, ...Array.from(root.getElementsByTagNameNS(namespace, "num"), node => Number(node.getAttributeNS(namespace, "numId"))),
    ...Array.from(root.getElementsByTagNameNS(namespace, "abstractNum"), node => Number(node.getAttributeNS(namespace, "abstractNumId")))) + 1
  const ids = {}
  for (const [type, text] of [["bullet", "•"], ["decimal", "%1."]]) {
    const id = nextId++
    ids[type] = id
    const abstract = ensureNew(root, "abstractNum")
    set(abstract, "abstractNumId", id)
    const level = ensure(abstract, "lvl")
    set(level, "ilvl", 0)
    set(ensure(level, "start"), "val", 1)
    set(ensure(level, "numFmt"), "val", type)
    set(ensure(level, "lvlText"), "val", text)
    const indentation = ensure(ensure(level, "pPr"), "ind")
    set(indentation, "left", 420)
    set(indentation, "hanging", 240)
    const number = ensureNew(root, "num")
    set(number, "numId", id)
    set(ensure(number, "abstractNumId"), "val", id)
  }
  archive["word/numbering.xml"] = serialize(numbering)
  const types = parse(fromBytes(archive["[Content_Types].xml"]))
  if (!Array.from(types.getElementsByTagNameNS(contentNamespace, "Override")).some(node => node.getAttribute("PartName") === "/word/numbering.xml")) {
    const override = types.createElementNS(contentNamespace, "Override")
    override.setAttribute("PartName", "/word/numbering.xml")
    override.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml")
    types.documentElement.appendChild(override)
  }
  archive["[Content_Types].xml"] = serialize(types)
  const relationPath = "word/_rels/document.xml.rels"
  const relationships = parse(archive[relationPath] ? fromBytes(archive[relationPath]) : '<Relationships xmlns="' + relationNamespace + '"/>')
  if (!Array.from(relationships.getElementsByTagNameNS(relationNamespace, "Relationship")).some(node => node.getAttribute("Type").endsWith("/numbering"))) {
    const relationship = relationships.createElementNS(relationNamespace, "Relationship")
    relationship.setAttribute("Id", "EllesonNumbering" + root.childNodes.length)
    relationship.setAttribute("Type", namespace.includes("purl.oclc.org")
      ? "http://purl.oclc.org/ooxml/officeDocument/relationships/numbering"
      : "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering")
    relationship.setAttribute("Target", "numbering.xml")
    relationships.documentElement.appendChild(relationship)
  }
  archive[relationPath] = serialize(relationships)
  return ids
}

export function insertImage(document, archive, image, Parser, Serializer, fromBytes, toBytes) {
  if (image.position && !validInkPosition(image.position)) throw new Error('The drawing position is invalid. Reopen the Word page and try again.')
  const namespace = document.documentElement.namespaceURI
  const paragraph = document.getElementsByTagNameNS(namespace, "p")[image.index]
  if (!paragraph) throw new Error("Choose a paragraph for the image.")
  const relationNamespace = "http://schemas.openxmlformats.org/package/2006/relationships"
  const contentNamespace = "http://schemas.openxmlformats.org/package/2006/content-types"
  const id = "EllesonImage" + crypto.randomUUID().replaceAll("-", "")
  const name = id + "." + image.type
  archive["word/media/" + name] = image.bytes
  const parse = text => new Parser().parseFromString(text, "application/xml")
  const serialize = xml => toBytes(new Serializer().serializeToString(xml))
  const relationPath = "word/_rels/document.xml.rels"
  const relations = parse(archive[relationPath] ? fromBytes(archive[relationPath]) : '<Relationships xmlns="' + relationNamespace + '"/>')
  const relation = relations.createElementNS(relationNamespace, "Relationship")
  relation.setAttribute("Id", id)
  relation.setAttribute("Type", namespace.includes("purl.oclc.org")
    ? "http://purl.oclc.org/ooxml/officeDocument/relationships/image"
    : "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image")
  relation.setAttribute("Target", "media/" + name)
  relations.documentElement.appendChild(relation)
  archive[relationPath] = serialize(relations)
  const types = parse(fromBytes(archive["[Content_Types].xml"]))
  if (!Array.from(types.getElementsByTagNameNS(contentNamespace, "Default")).some(node => node.getAttribute("Extension") === image.type)) {
    const type = types.createElementNS(contentNamespace, "Default")
    type.setAttribute("Extension", image.type)
    type.setAttribute("ContentType", image.type === "png" ? "image/png" : "image/jpeg")
    types.documentElement.appendChild(type)
  }
  archive["[Content_Types].xml"] = serialize(types)
  const width = Math.round((image.position?.width ?? Math.min(480, image.width)) * 9525)
  const height = Math.round(image.position ? image.position.height * 9525 : width * image.height / image.width)
  const strict = namespace.includes("purl.oclc.org")
  const drawingBase = strict ? "http://purl.oclc.org/ooxml/drawingml/" : "http://schemas.openxmlformats.org/drawingml/2006/"
  const officeRelationships = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  const drawingNamespace = drawingBase + "wordprocessingDrawing"
  const drawingIds = Array.from(document.getElementsByTagNameNS(drawingNamespace, "docPr"), node => Number(node.getAttribute("id")) || 0)
  const drawingId = Math.max(0, ...drawingIds) + 1
  const imageParagraph = parse('<w:p xmlns:w="' + namespace + '" xmlns:r="' + officeRelationships + '" ' +
    'xmlns:wp="' + drawingNamespace + '" xmlns:a="' + drawingBase + 'main" ' +
    'xmlns:pic="' + drawingBase + 'picture">' +
    '<w:r><w:drawing><wp:inline><wp:extent cx="' + width + '" cy="' + height + '"/><wp:docPr id="' + drawingId + '" name="Document image"/>' +
    '<a:graphic><a:graphicData uri="' + drawingBase + 'picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + drawingId + '" name="Document image"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="' + id + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + width + '" cy="' + height + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>').documentElement
  if (image.position) {
    const inline = imageParagraph.getElementsByTagNameNS(drawingNamespace, 'inline')[0]
    const anchor = document.createElementNS(drawingNamespace, 'wp:anchor')
    for (const [key,value] of Object.entries({distT:0,distB:0,distL:0,distR:0,simplePos:0,relativeHeight:251658240+drawingId,behindDoc:0,locked:0,layoutInCell:1,allowOverlap:1})) anchor.setAttribute(key,String(value))
    const add = (name,attrs,text) => {const node=document.createElementNS(drawingNamespace,'wp:'+name);for(const [key,value]of Object.entries(attrs||{}))node.setAttribute(key,String(value));if(text!==undefined)node.textContent=String(text);return node}
    anchor.appendChild(add('simplePos',{x:0,y:0}))
    for (const [axis,value] of [['H',image.position.x],['V',image.position.paragraphY??image.position.y]]) {const node=add('position'+axis,{relativeFrom:axis==='V'&&Number.isFinite(image.position.paragraphY)?'paragraph':'page'});node.appendChild(add('posOffset',{},Math.round(value*9525)));anchor.appendChild(node)}
    anchor.appendChild(document.importNode(inline.firstChild,true))
    anchor.appendChild(add('wrapNone'))
    for (const node of Array.from(inline.childNodes).slice(1)) anchor.appendChild(document.importNode(node,true))
    const property=anchor.getElementsByTagNameNS(drawingNamespace,'docPr')[0];property.setAttribute('name','Elleson ink');property.setAttribute('descr',JSON.stringify(image.position))
    const drawing=document.createElementNS(namespace,'w:drawing');drawing.appendChild(anchor)
    const run=document.createElementNS(namespace,'w:r');run.appendChild(drawing);paragraph.appendChild(run)
  } else paragraph.parentNode.insertBefore(document.importNode(imageParagraph, true), paragraph.nextSibling)
}

export function validInkPosition(position) {
  return position && ['x','y','width','height'].every(key=>typeof position[key]==='number'&&Number.isFinite(position[key])) && (position.paragraphY===undefined||Number.isFinite(position.paragraphY)&&Math.abs(position.paragraphY)<=5000) && position.x>=0 && position.y>=0 && position.width>0 && position.height>0 && position.x+position.width<=5000 && position.y+position.height<=5000
}

export function eraseWordInk(bytes,target){return changeWordInk(bytes,target)}

export function changeWordInk(bytes,target,position){
  if(position!==undefined&&!validInkPosition(position))throw new Error("The drawing must fit on the page.")
  const archive=unzipSync(bytes)
  const part='word/document.xml',relations='word/_rels/document.xml.rels'
  if(!archive[part]||!archive[relations])return null
  const parser=new DOMParser()
  const xml=parser.parseFromString(strFromU8(archive[part]),'text/xml')
  const relationships=parser.parseFromString(strFromU8(archive[relations]),'text/xml')
  const relation=Array.from(relationships.getElementsByTagNameNS('*','Relationship')).find(node=>node.getAttribute('Target')===target)
  if(!relation)return null
  let changed=false
  for(const drawing of Array.from(xml.getElementsByTagNameNS('*','drawing'))){
    const children=Array.from(drawing.getElementsByTagName('*'))
    const isInk=children.some(node=>node.localName==='docPr'&&node.getAttribute('name')==='Elleson ink')
    const matches=children.some(node=>node.localName==='blip'&&node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','embed')===relation.getAttribute('Id'))
    if(!isInk||!matches)continue
    if(position===undefined)drawing.parentNode.removeChild(drawing)
    else {
      const anchor=children.find(node=>node.localName==='anchor')
      const property=children.find(node=>node.localName==='docPr')
      if(!anchor||!property)continue
      property.setAttribute('descr',JSON.stringify(position))
      for(const [axis,value] of [['H',position.x],['V',position.paragraphY??position.y]]){
        const placement=Array.from(anchor.childNodes).find(node=>node.localName==='position'+axis)
        if(placement){
          placement.setAttribute('relativeFrom',axis==='V'&&position.paragraphY!==undefined?'paragraph':'page')
          const offset=Array.from(placement.childNodes).find(node=>node.localName==='posOffset')
          if(offset)offset.textContent=String(Math.round(value*9525))
        }
      }
      for(const extent of children.filter(node=>node.localName==='extent'||node.localName==='ext'&&node.parentNode.localName==='xfrm')){
        extent.setAttribute('cx',String(Math.round(position.width*9525)))
        extent.setAttribute('cy',String(Math.round(position.height*9525)))
      }
    }
    changed=true
  }
  if(!changed)return null
  archive[part]=strToU8(new XMLSerializer().serializeToString(xml))
  return zipSync(archive)
}

export function changeWordInkBatch(bytes,edit){
  if(!['apply','duplicate','delete'].includes(edit.action)||!Array.isArray(edit.items)||!edit.items.length||edit.items.length>200||! /^[a-zA-Z0-9-]{12,80}$/.test(edit.id||''))throw Error('Select valid drawings and an action.')
  if(new Set(edit.items.map(item=>item.target)).size!==edit.items.length)throw Error('Select each drawing once.')
  let result=bytes
  for(const [index,item] of edit.items.entries()){
    if(typeof item.target!=='string'||edit.action!=='delete'&&!validInkPosition(item.position))throw Error('Choose a valid drawing position.')
    if(edit.action==='delete'){result=changeWordInk(result,item.target);if(!result)throw Error('The drawing changed. Select it again.');continue}
    const archive=unzipSync(result),part='word/document.xml',rels='word/_rels/document.xml.rels',parser=new DOMParser(),xml=parser.parseFromString(strFromU8(archive[part]),'text/xml'),relationships=parser.parseFromString(strFromU8(archive[rels]),'text/xml')
    const relation=Array.from(relationships.getElementsByTagNameNS('*','Relationship')).find(node=>node.getAttribute('Target')===item.target)
    if(!relation)throw Error('The drawing changed. Select it again.')
    const rid=relation.getAttribute('Id'),rns='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    const drawing=Array.from(xml.getElementsByTagNameNS('*','drawing')).find(d=>Array.from(d.getElementsByTagNameNS('*','docPr')).some(p=>p.getAttribute('name')==='Elleson ink')&&Array.from(d.getElementsByTagNameNS('*','blip')).some(b=>b.getAttributeNS(rns,'embed')===rid))
    if(!drawing)throw Error('Only drawings made in Elleson Docs can be edited here.')
    let target=item.target
    if(edit.action==='duplicate'){
      if(!/^media\/[A-Za-z0-9_.-]+\.png$/i.test(target)||!archive['word/'+target])throw Error('The drawing image is unavailable.')
      target='media/elleson-copy-'+edit.id+'-'+index+'.png'
      const newId='rIdElleson'+edit.id.replace(/-/g,'')+index,copy=drawing.cloneNode(true),newRelation=relation.cloneNode(true)
      newRelation.setAttribute('Id',newId);newRelation.setAttribute('Target',target);relationships.documentElement.appendChild(newRelation)
      for(const b of Array.from(copy.getElementsByTagNameNS('*','blip')))b.setAttributeNS(rns,'r:embed',newId)
      const next=Math.max(0,...Array.from(xml.getElementsByTagNameNS('*','docPr')).map(p=>Number(p.getAttribute('id'))||0))+1
      for(const p of Array.from(copy.getElementsByTagNameNS('*','docPr')))p.setAttribute('id',String(next))
      drawing.parentNode.appendChild(copy);archive['word/'+target]=archive['word/'+item.target]
    }
    if(item.png!==undefined){
      if(typeof item.png!=='string'||item.png.length>6*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(item.png)||!/^media\/[A-Za-z0-9_.-]+\.png$/i.test(target))throw Error('Choose a valid drawing image.')
      const data=Uint8Array.from(atob(item.png),c=>c.charCodeAt(0));if(data[0]!==137||data[1]!==80||data[2]!==78||data[3]!==71)throw Error('Choose a PNG drawing.')
      archive['word/'+target]=data
    }
    archive[part]=strToU8(new XMLSerializer().serializeToString(xml));archive[rels]=strToU8(new XMLSerializer().serializeToString(relationships))
    result=changeWordInk(zipSync(archive),target,item.position)
    if(!result)throw Error('The drawing changed. Select it again.')
  }
  return result
}
