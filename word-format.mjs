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
    }
  }
}

export function validFormat(format) {
  if (!format || typeof format !== "object") return false
  return Object.entries(format).every(([key, value]) =>
    key === "font" ? typeof value === "string" && value.length > 0 && value.length <= 80 :
    key === "size" ? Number.isFinite(value) && value >= 6 && value <= 96 && Number.isInteger(value * 2) :
    key === "bold" || key === "italic" ? typeof value === "boolean" :
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
  const width = Math.round(Math.min(480, image.width) * 9525)
  const height = Math.round(width * image.height / image.width)
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
  paragraph.parentNode.insertBefore(document.importNode(imageParagraph, true), paragraph.nextSibling)
}
