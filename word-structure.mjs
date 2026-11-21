const contentTypes = "http://schemas.openxmlformats.org/package/2006/content-types"
const relationships = "http://schemas.openxmlformats.org/package/2006/relationships"
const stylePart = "word/styles.xml"
const relationPart = "word/_rels/document.xml.rels"

const builtins = new Map([
  ["Normal", { name: "Normal" }],
  ["Title", { name: "Title", size: 52 }],
  ...Array.from({ length: 9 }, (_, index) => ["Heading" + (index + 1), { name: "Heading " + (index + 1), level: index, size: Math.max(22, 36 - index * 4) }])
])

function readPart(bytes, Parser, decode) {
  const xml = decode(bytes)
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported Word XML.")
  return new Parser().parseFromString(xml, "application/xml")
}

export function paragraphStyles(archive, namespace, Parser, decode) {
  if (!archive?.[stylePart]) return []
  const xml = readPart(archive[stylePart], Parser, decode)
  return Array.from(xml.getElementsByTagNameNS(namespace, "style")).filter(node => node.getAttributeNS(namespace, "type") === "paragraph")
    .map(node => ({
      id: node.getAttributeNS(namespace, "styleId"),
      name: node.getElementsByTagNameNS(namespace, "name")[0]?.getAttributeNS(namespace, "val"),
      level: node.getElementsByTagNameNS(namespace, "outlineLvl")[0]?.getAttributeNS(namespace, "val") ?? null
    })).filter(style => style.id && style.id.length <= 128)
}

export const standardParagraphStyles = [...builtins].map(([id, style]) => ({ id, ...style }))

export function applyParagraphStyle(paragraph, archive, id, Parser, Serializer, decode, encode) {
  if (typeof id !== "string" || !id || id.length > 128) throw new Error("Choose a paragraph style.")
  const namespace = paragraph.namespaceURI
  const create = (parent, name, values = {}, prepend = false) => {
    const element = parent.ownerDocument.createElementNS(namespace, "w:" + name)
    for (const [key, value] of Object.entries(values)) element.setAttributeNS(namespace, "w:" + key, String(value))
    if (prepend) parent.insertBefore(element, parent.firstChild)
    else parent.appendChild(element)
    return element
  }
  if (!paragraphStyles(archive, namespace, Parser, decode).some(style => style.id === id)) {
    const builtin = builtins.get(id)
    if (!builtin) throw new Error("This style is no longer in the document.")
    const styles = archive[stylePart] ? readPart(archive[stylePart], Parser, decode) :
      new Parser().parseFromString('<w:styles xmlns:w="' + namespace + '"/>', "application/xml")
    const style = create(styles.documentElement, "style", { type: "paragraph", styleId: id, ...(id === "Normal" ? { default: 1 } : {}) })
    create(style, "name", { val: builtin.name })
    if (id !== "Normal" && paragraphStyles(archive, namespace, Parser, decode).some(item => item.id === "Normal")) create(style, "basedOn", { val: "Normal" })
    if (builtin.level !== undefined) {
      const properties = create(style, "pPr")
      create(properties, "keepNext")
      create(properties, "outlineLvl", { val: builtin.level })
    }
    if (builtin.size) {
      const properties = create(style, "rPr")
      create(properties, "b")
      create(properties, "sz", { val: builtin.size })
    }
    const save = (name, xml) => { archive[name] = encode(new Serializer().serializeToString(xml)) }
    save(stylePart, styles)
    const types = readPart(archive["[Content_Types].xml"], Parser, decode)
    if (!Array.from(types.getElementsByTagNameNS(contentTypes, "Override")).some(node => node.getAttribute("PartName") === "/" + stylePart)) {
      const entry = types.createElementNS(contentTypes, "Override")
      entry.setAttribute("PartName", "/" + stylePart)
      entry.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml")
      types.documentElement.appendChild(entry)
      save("[Content_Types].xml", types)
    }
    const rels = archive[relationPart] ? readPart(archive[relationPart], Parser, decode) :
      new Parser().parseFromString('<Relationships xmlns="' + relationships + '"/>', "application/xml")
    const existing = Array.from(rels.getElementsByTagNameNS(relationships, "Relationship"))
    const current = existing.find(node => node.getAttribute("Type").endsWith("/styles"))
    if (current && current.getAttribute("Target") !== "styles.xml") throw new Error("This file stores its styles in a different package part.")
    if (!current) {
      const entry = rels.createElementNS(relationships, "Relationship")
      let sequence = 1
      while (existing.some(node => node.getAttribute("Id") === "EllesonStyles" + sequence)) sequence++
      entry.setAttribute("Id", "EllesonStyles" + sequence)
      entry.setAttribute("Type", (namespace.includes("purl.oclc.org") ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships") + "/styles")
      entry.setAttribute("Target", "styles.xml")
      rels.documentElement.appendChild(entry)
      save(relationPart, rels)
    }
  }
  const properties = Array.from(paragraph.childNodes).find(node => node.namespaceURI === namespace && node.localName === "pPr") || create(paragraph, "pPr", {}, true)
  const current = Array.from(properties.childNodes).find(node => node.namespaceURI === namespace && node.localName === "pStyle")
  if (current) current.setAttributeNS(namespace, "w:val", id)
  else create(properties, "pStyle", { val: id }, true)
}
