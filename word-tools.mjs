import { validFormat, applyFormatting } from "./word-format.mjs"

const directText = paragraph => Array.from(paragraph.getElementsByTagNameNS(paragraph.namespaceURI, "t")).filter(node => {
  let owner = node.parentNode
  while (owner && owner.localName !== "p") owner = owner.parentNode
  return owner === paragraph
})
const make = (document, name) => document.createElementNS(document.documentElement.namespaceURI, "w:" + name)
const attribute = (node, name, value) => node.setAttributeNS(node.namespaceURI, "w:" + name, String(value))
const blank = (document, text = " ") => {
  const p = make(document, "p"), r = make(document, "r"), t = make(document, "t")
  t.textContent = text
  t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve")
  r.appendChild(t); p.appendChild(r)
  return p
}
const ancestor = (node, name) => { while (node && node.localName !== name) node = node.parentNode; return node }

export function editWord(document, archive, edit, Parser, Serializer, fromBytes, toBytes) {
  const namespace = document.documentElement.namespaceURI
  const p = document.getElementsByTagNameNS(namespace, "p")[edit.index]
  if (!p) throw new Error("Select a paragraph again.")
  if (edit.action === "range") {
    if (!validFormat(edit.format) || !Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < 0 || edit.end <= edit.start) throw new Error("Select some text and choose valid formatting.")
    const nodes = directText(p)
    if (edit.end > nodes.reduce((sum, node) => sum + node.textContent.length, 0)) throw new Error("The selected text changed.")
    let offset = 0
    for (const node of nodes) {
      const text = node.textContent, start = Math.max(0, edit.start - offset), end = Math.min(text.length, edit.end - offset)
      offset += text.length
      if (start >= end) continue
      const run = node.parentNode
      if (run.localName !== "r" || Array.from(run.childNodes).some(child => child.nodeType === 1 && !["rPr", "t"].includes(child.localName)) || run.getElementsByTagNameNS(namespace, "t").length !== 1) throw new Error("This selection contains a complex Word object. Format its paragraph instead.")
      for (const [value, selected] of [[text.slice(0, start), false], [text.slice(start, end), true], [text.slice(end), false]]) {
        if (!value) continue
        const copy = run.cloneNode(true)
        const textNode = copy.getElementsByTagNameNS(namespace, "t")[0]
        textNode.textContent = value
        textNode.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve")
        if (selected) {
          const temporary = new Parser().parseFromString('<w:document xmlns:w="' + namespace + '"><w:body><w:p/></w:body></w:document>', "application/xml")
          const target = temporary.getElementsByTagNameNS(namespace, "p")[0]
          target.appendChild(temporary.importNode(copy, true))
          applyFormatting(temporary, { 0: Object.fromEntries(Object.entries(edit.format).filter(([key]) => !["align", "list"].includes(key))) })
          run.parentNode.insertBefore(document.importNode(target.getElementsByTagNameNS(namespace, "r")[0], true), run)
        } else run.parentNode.insertBefore(copy, run)
      }
      run.parentNode.removeChild(run)
    }
  } else if (edit.action === "paragraph" || edit.action === "split") {
    if (edit.action === "paragraph") p.parentNode.insertBefore(blank(document, String(edit.text || " ").slice(0, 16000)), p.nextSibling)
    else {
      const nodes = directText(p), text = nodes.map(node => node.textContent).join("")
      if (!Number.isInteger(edit.offset) || edit.offset < 0 || edit.offset > text.length) throw new Error("Choose a valid insertion point.")
      // Revision/field boundaries require a dedicated structural editor. Refuse
      // before changing anything rather than cloning identifiers or field state.
      if (['ins', 'del', 'moveFrom', 'moveTo', 'fldChar', 'fldSimple', 'sdt'].some(name => p.getElementsByTagNameNS(namespace, name).length)) throw new Error('This paragraph contains tracked changes or a Word field. Insert a paragraph after it using More Word tools instead.')
      const after = make(document, 'p')
      const properties = Array.from(p.childNodes).find(node => node.localName === 'pPr')
      if (properties) {
        after.appendChild(properties.cloneNode(true))
        // The section ends after the newly split paragraph, exactly once.
        for (const section of Array.from(properties.getElementsByTagNameNS(namespace, 'sectPr'))) section.parentNode.removeChild(section)
      }
      const textNodes = new Set(nodes)
      let remaining = edit.offset
      const divide = node => {
        if (textNodes.has(node)) {
          const value = node.textContent, cut = Math.min(remaining, value.length)
          remaining -= cut
          if (cut === value.length) return null
          if (cut === 0) return node
          const tail = node.cloneNode(false)
          node.textContent = value.slice(0, cut); tail.textContent = value.slice(cut)
          for (const part of [node, tail]) part.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
          return tail
        }
        // Drawings (including nested text boxes), bookmarks, tabs and breaks
        // are atomic: move them to one side, never copy them.
        const containsText = nodes.some(text => { let owner = text.parentNode; while (owner && owner !== node) owner = owner.parentNode; return owner === node })
        if (!containsText) return remaining === 0 ? node : null
        const tail = node.cloneNode(false)
        for (const item of Array.from(node.childNodes)) {
          if (item.localName === 'rPr') { tail.appendChild(item.cloneNode(true)); continue }
          const moved = divide(item)
          if (moved) tail.appendChild(moved)
        }
        return tail.childNodes.length ? tail : null
      }
      for (const node of Array.from(p.childNodes)) {
        if (node === properties) continue
        const moved = divide(node)
        if (moved) after.appendChild(moved)
      }
      for (const paragraph of [p, after]) if (!directText(paragraph).length) paragraph.appendChild(blank(document, '').firstChild)
      p.parentNode.insertBefore(after, p.nextSibling)
    }
  } else if (edit.action === "page-break") {
    const paragraph = blank(document)
    const br = make(document, "br")
    attribute(br, "type", "page")
    paragraph.firstChild.replaceChild(br, paragraph.firstChild.lastChild)
    p.parentNode.insertBefore(paragraph, p.nextSibling)
  } else if (["add-row", "delete-row", "add-column", "delete-column"].includes(edit.action)) {
    const cell = ancestor(p, "tc"), row = ancestor(p, "tr"), table = ancestor(p, "tbl")
    if (!cell || !row || !table) throw new Error("Select text in a table cell first.")
    const rows = Array.from(table.childNodes).filter(node => node.localName === "tr")
    const cells = target => Array.from(target.childNodes).filter(node => node.localName === "tc")
    const column = cells(row).indexOf(cell)
    if (rows.some(target => cells(target).length !== cells(row).length) || table.getElementsByTagNameNS(namespace, "gridSpan").length || table.getElementsByTagNameNS(namespace, "vMerge").length) throw new Error("Merged or irregular tables need a dedicated table editor.")
    const clear = target => {
      for (const child of Array.from(target.childNodes)) if (child.localName !== "tcPr") target.removeChild(child)
      target.appendChild(blank(document))
    }
    if (edit.action === "add-row") {
      if (rows.length >= 100) throw new Error("This table already has 100 rows.")
      const copy = row.cloneNode(true)
      cells(copy).forEach(clear)
      row.parentNode.insertBefore(copy, row.nextSibling)
    } else if (edit.action === "delete-row") {
      if (rows.length <= 1) throw new Error("Keep at least one row.")
      table.removeChild(row)
    } else {
      if (edit.action === "delete-column" && cells(row).length <= 1) throw new Error("Keep at least one column.")
      if (edit.action === "add-column" && cells(row).length >= 20) throw new Error("Keep at most 20 columns.")
      for (const target of rows) {
        const selected = cells(target)[column]
        if (edit.action === "delete-column") target.removeChild(selected)
        else { const copy = selected.cloneNode(true); clear(copy); target.insertBefore(copy, selected.nextSibling) }
      }
      const grid = table.getElementsByTagNameNS(namespace, "tblGrid")[0]
      const gridColumn = grid && Array.from(grid.childNodes).filter(node => node.localName === "gridCol")[column]
      if (gridColumn) {
        if (edit.action === "delete-column") grid.removeChild(gridColumn)
        else grid.insertBefore(gridColumn.cloneNode(true), gridColumn.nextSibling)
      }
    }
  } else if (edit.action === "image-size") {
    const drawing = p.getElementsByTagNameNS(namespace, "drawing")[edit.image || 0]
    if (!drawing || !Number.isFinite(edit.width) || edit.width < 20 || edit.width > 1000) throw new Error("Select a Word image and a width between 20 and 1000 pixels.")
    const extents = Array.from(drawing.getElementsByTagName("*")).filter(node => ["extent", "ext"].includes(node.localName) && node.hasAttribute("cx") && node.hasAttribute("cy"))
    for (const extent of extents) {
      const ratio = Number(extent.getAttribute("cy")) / Number(extent.getAttribute("cx"))
      extent.setAttribute("cx", String(Math.round(edit.width * 9525)))
      extent.setAttribute("cy", String(Math.round(edit.width * 9525 * ratio)))
    }
  } else if (edit.action === "header-footer") {
    const strict = namespace.includes("purl.oclc.org")
    const relationshipType = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships/" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
    const relationNS = "http://schemas.openxmlformats.org/package/2006/relationships"
    const parse = text => new Parser().parseFromString(text, "application/xml")
    const relationPath = "word/_rels/document.xml.rels"
    const relations = parse(archive[relationPath] ? fromBytes(archive[relationPath]) : '<Relationships xmlns="' + relationNS + '"/>')
    const types = parse(fromBytes(archive["[Content_Types].xml"]))
    for (const [type, value] of [["header", edit.header], ["footer", edit.footer]]) {
      if (typeof value !== "string" || value.length > 1000) throw new Error("Header and footer text must be at most 1000 characters.")
      const id = "Elleson" + type + crypto.randomUUID().replaceAll("-", ""), filename = id + ".xml"
      const part = parse('<w:' + (type === "header" ? "hdr" : "ftr") + ' xmlns:w="' + namespace + '"/>')
      part.documentElement.appendChild(part.importNode(blank(document, value || " "), true))
      if (type === "footer" && edit.pageNumbers) {
        const field = part.createElementNS(namespace, "w:fldSimple")
        attribute(field, "instr", "PAGE")
        const run = part.createElementNS(namespace, "w:r"), text = part.createElementNS(namespace, "w:t")
        text.textContent = "1"; run.appendChild(text); field.appendChild(run)
        part.documentElement.firstChild.appendChild(field)
      }
      archive["word/" + filename] = toBytes(new Serializer().serializeToString(part))
      const relation = relations.createElementNS(relationNS, "Relationship")
      relation.setAttribute("Id", id); relation.setAttribute("Type", relationshipType + type); relation.setAttribute("Target", filename)
      relations.documentElement.appendChild(relation)
      const override = types.createElementNS(types.documentElement.namespaceURI, "Override")
      override.setAttribute("PartName", "/word/" + filename)
      override.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.wordprocessingml." + type + "+xml")
      types.documentElement.appendChild(override)
      for (const section of Array.from(document.getElementsByTagNameNS(namespace, "sectPr"))) {
        for (const old of Array.from(section.childNodes)) if (old.localName === type + "Reference" && old.getAttributeNS(namespace, "type") === "default") section.removeChild(old)
        const reference = make(document, type + "Reference")
        attribute(reference, "type", "default")
        reference.setAttributeNS(relationshipType.slice(0, -1), "r:id", id)
        section.insertBefore(reference, section.firstChild)
      }
    }
    archive[relationPath] = toBytes(new Serializer().serializeToString(relations))
    archive["[Content_Types].xml"] = toBytes(new Serializer().serializeToString(types))
  } else throw new Error("Choose a Word editing action.")
}
