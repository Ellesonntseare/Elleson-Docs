import { paragraphStyles } from "./word-structure.mjs"

const relationshipPart = "word/_rels/document.xml.rels"
const relationNS = "http://schemas.openxmlformats.org/package/2006/relationships"
const supported = new Set(["hyperlink", "footnote", "section-settings", "table-of-contents", "merge-next-cell"])
export const isWordStructureAction = action => supported.has(action)
export const nonStructuralWordAction = action => ["range", "paragraph-style", "hyperlink", "footnote", "section-settings"].includes(action)

function children(node, localName) {
  return Array.from(node.childNodes).filter(child => child.namespaceURI === node.namespaceURI && (!localName || child.localName === localName))
}
function add(parent, localName, attributes = {}, before = null) {
  const ns = parent.namespaceURI
  const node = parent.ownerDocument.createElementNS(ns, "w:" + localName)
  for (const [key, value] of Object.entries(attributes)) node.setAttributeNS(ns, "w:" + key, String(value))
  parent.insertBefore(node, before)
  return node
}
function text(parent, value) {
  const node = add(add(parent, "r"), "t")
  node.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve")
  node.textContent = value
}
const partNS = namespace => namespace.includes("purl.oclc.org") ?
  "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

export function editWordStructure(paragraph, archive, edit, Parser, Serializer, decode, encode) {
  const doc = paragraph.ownerDocument, ns = paragraph.namespaceURI
  const xml = input => {
    if (/<!DOCTYPE|<!ENTITY/i.test(input)) throw new Error("Unsupported Word XML.")
    return new Parser().parseFromString(input, "application/xml")
  }
  const save = (path, document) => { archive[path] = encode(new Serializer().serializeToString(document)) }
  function relationship(type, target, external = false) {
    const rels = xml(archive[relationshipPart] ? decode(archive[relationshipPart]) : '<Relationships xmlns="' + relationNS + '"/>')
    const existing = Array.from(rels.getElementsByTagNameNS(relationNS, "Relationship"))
    const entry = existing.find(node => node.getAttribute("Type").endsWith("/" + type) && node.getAttribute("Target") === target &&
      (node.getAttribute("TargetMode") === "External") === external)
    if (entry) return entry.getAttribute("Id")
    let sequence = 1
    while (existing.some(node => node.getAttribute("Id") === "EllesonStructure" + sequence)) sequence++
    const id = "EllesonStructure" + sequence
    const node = rels.createElementNS(relationNS, "Relationship")
    node.setAttribute("Id", id)
    node.setAttribute("Type", partNS(ns) + "/" + type)
    node.setAttribute("Target", target)
    if (external) node.setAttribute("TargetMode", "External")
    rels.documentElement.appendChild(node)
    save(relationshipPart, rels)
    return id
  }
  if (edit.action === "hyperlink") {
    if (typeof edit.url !== "string" || edit.url.length > 2048) throw new Error("Enter a web address.")
    let url
    try { url = new URL(edit.url) } catch { throw new Error("Enter a complete web address beginning with https://.") }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Choose a web URL without embedded credentials.")
    if (typeof edit.label !== "string" || !edit.label.trim() || edit.label.length > 250) throw new Error("Enter a link label of up to 250 characters.")
    const link = add(paragraph, "hyperlink")
    link.setAttributeNS(partNS(ns), "r:id", relationship("hyperlink", url.href, true))
    const run = add(link, "r")
    const properties = add(run, "rPr")
    add(properties, "color", { val: "0563C1" })
    add(properties, "u", { val: "single" })
    add(run, "t").textContent = edit.label.trim()
  } else if (edit.action === "footnote") {
    if (typeof edit.text !== "string" || !edit.text.trim() || edit.text.length > 2000) throw new Error("Enter a footnote of up to 2,000 characters.")
    const path = "word/footnotes.xml"
    const relations = archive[relationshipPart] && xml(decode(archive[relationshipPart]))
    const existing = relations && Array.from(relations.getElementsByTagNameNS(relationNS, "Relationship"))
      .find(node => node.getAttribute("Type").endsWith("/footnotes"))
    if (existing && existing.getAttribute("Target") !== "footnotes.xml") throw new Error("This document uses a custom footnote part.")
    const footnotes = xml(archive[path] ? decode(archive[path]) : '<w:footnotes xmlns:w="' + ns + '"/>')
    if (footnotes.documentElement.namespaceURI !== ns) throw new Error("Unsupported footnote namespace.")
    const root = footnotes.documentElement
    if (!archive[path]) {
      for (const [type, id, element] of [["separator", -1, "separator"], ["continuationSeparator", 0, "continuationSeparator"]]) {
        add(add(add(add(root, "footnote", { type, id }), "p"), "r"), element)
      }
    }
    const id = Math.max(0, ...children(root, "footnote").map(node => Number(node.getAttributeNS(ns, "id")) || 0)) + 1
    const note = add(add(root, "footnote", { id }), "p")
    add(add(note, "r"), "footnoteRef")
    text(note, " " + edit.text.trim())
    save(path, footnotes)
    relationship("footnotes", "footnotes.xml")
    const types = xml(decode(archive["[Content_Types].xml"]))
    if (!Array.from(types.documentElement.childNodes).some(node => node.getAttribute?.("PartName") === "/" + path)) {
      const entry = types.createElementNS(types.documentElement.namespaceURI, "Override")
      entry.setAttribute("PartName", "/" + path)
      entry.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml")
      types.documentElement.appendChild(entry)
      save("[Content_Types].xml", types)
    }
    const run = add(paragraph, "r")
    add(add(run, "rPr"), "vertAlign", { val: "superscript" })
    add(run, "footnoteReference", { id })
  } else if (edit.action === "section-settings") {
    const { size, orientation, margin } = edit
    if (!["a4", "letter"].includes(size) || !["portrait", "landscape"].includes(orientation) || !Number.isFinite(margin) || margin < 8 || margin > 50) throw new Error("Choose a page size and margins from 8 to 50 mm.")
    const body = doc.getElementsByTagNameNS(ns, "body")[0]
    let block = paragraph
    while (block.parentNode && block.parentNode !== body) block = block.parentNode
    let section
    for (let next = block; next; next = next.nextSibling) {
      if (next.localName === "sectPr") { section = next; break }
      if (next.localName === "p") {
        const properties = children(next, "pPr")[0]
        section = properties && children(properties, "sectPr")[0]
        if (section) break
      }
    }
    if (!section) section = add(body, "sectPr")
    const dimensions = size === "letter" ? [12240, 15840] : [11906, 16838]
    if (orientation === "landscape") dimensions.reverse()
    const [width, height] = dimensions
    const page = children(section, "pgSz")[0] || add(section, "pgSz", {}, children(section).find(node => !["headerReference", "footerReference", "footnotePr", "endnotePr", "type"].includes(node.localName)) || null)
    for (const [k, v] of Object.entries({ w: width, h: height, orient: orientation })) page.setAttributeNS(ns, "w:" + k, String(v))
    const margins = children(section, "pgMar")[0] || add(section, "pgMar", {}, page.nextSibling)
    for (const edge of ["top", "bottom", "left", "right"]) margins.setAttributeNS(ns, "w:" + edge, String(Math.round(margin * 1440 / 25.4)))
    for (const key of ["header", "footer", "gutter"]) if (!margins.hasAttributeNS(ns, key)) margins.setAttributeNS(ns, "w:" + key, key === "gutter" ? "0" : "360")
  } else if (edit.action === "merge-next-cell") {
    let cell = paragraph.parentNode
    while (cell && cell.localName !== "tc") cell = cell.parentNode
    if (!cell || cell.parentNode.localName !== "tr") throw new Error("Select a table cell.")
    const next = children(cell.parentNode, "tc")[children(cell.parentNode, "tc").indexOf(cell) + 1]
    if (!next) throw new Error("There is no cell to the right.")
    if (Array.from([cell, next]).some(item => ["vMerge", "hMerge", "cellMerge", "bookmarkStart", "ins", "del"].some(tag => item.getElementsByTagNameNS(ns, tag).length))) {
      throw new Error("Editing cells that cross vertical merges or tracked revisions is unsupported.")
    }
    const props = children(cell, "tcPr")[0] || add(cell, "tcPr", {}, cell.firstChild)
    const rightProps = children(next, "tcPr")[0]
    const span = item => Number(item && children(item, "gridSpan")[0]?.getAttributeNS(ns, "val")) || 1
    const combined = span(props) + span(rightProps)
    const grid = children(props, "gridSpan")[0] || add(props, "gridSpan", {}, children(props, "tcW")[0]?.nextSibling || props.firstChild)
    grid.setAttributeNS(ns, "w:val", String(combined))
    const width = children(props, "tcW")[0], rightWidth = rightProps && children(rightProps, "tcW")[0]
    if (width && rightWidth && width.getAttributeNS(ns, "type") === rightWidth.getAttributeNS(ns, "type")) {
      width.setAttributeNS(ns, "w:w", String(Number(width.getAttributeNS(ns, "w")) + Number(rightWidth.getAttributeNS(ns, "w"))))
    }
    for (const node of children(next).filter(node => node.localName !== "tcPr")) cell.appendChild(node)
    next.parentNode.removeChild(next)
  } else {
    if (paragraph.parentNode.localName !== "body") throw new Error("Select a paragraph outside a table to insert the contents.")
    const headingLevels = new Map(paragraphStyles(archive, ns, Parser, decode).filter(style => style.level != null).map(style => [style.id, Number(style.level)]))
    const headings = children(paragraph.parentNode, "p").flatMap(node => {
      const properties = children(node, "pPr")[0]
      const style = properties && children(properties, "pStyle")[0]?.getAttributeNS(ns, "val")
      const fallback = /^Heading([1-9])$/i.exec(style || "")
      const level = headingLevels.get(style) ?? (fallback ? Number(fallback[1]) - 1 : undefined)
      const label = Array.from(node.getElementsByTagNameNS(ns, "t"), part => part.textContent).join("").trim()
      return level !== undefined && level >= 0 && level <= 8 && label ? [{ node, level, label }] : []
    }).slice(0, 200)
    if (!headings.length) throw new Error("Apply heading styles before inserting a contents list.")
    const ids = new Set(Array.from(doc.getElementsByTagNameNS(ns, "bookmarkStart"), node => Number(node.getAttributeNS(ns, "id"))))
    let id = 0
    const after = paragraph.nextSibling
    const title = add(paragraph.parentNode, "p", {}, after)
    text(title, "Contents")
    for (const heading of headings) {
      while (ids.has(id)) id++
      const key = "EllesonContents" + id
      const first = children(heading.node).find(child => child.localName !== "pPr")
      add(heading.node, "bookmarkStart", { id, name: key }, first || null)
      add(heading.node, "bookmarkEnd", { id })
      ids.add(id++)
      const line = add(paragraph.parentNode, "p", {}, after)
      add(add(line, "pPr"), "ind", { left: heading.level * 280 })
      text(add(line, "hyperlink", { anchor: key }), heading.label.slice(0, 250))
    }
  }
}
