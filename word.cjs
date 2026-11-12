const { unzipSync, zipSync, strFromU8, strToU8 } = require("fflate")
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom")
const WordExtractor = require("word-extractor")
const { Document, Paragraph, Packer } = require("docx")
const { diffChars } = require("diff")

const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
const strictNamespace = "http://purl.oclc.org/ooxml/wordprocessingml/main"
const xmlNamespace = "http://www.w3.org/XML/1998/namespace"
const documentPart = "word/document.xml"

async function readWord(bytes, extension) {
  if (extension === "doc") {
    const source = await new WordExtractor().extract(bytes)
    return { lines: source.getBody().replace(/\r/g, "").split("\n").map(text => ({ text, style: "", editable: true })) }
  }
  let expandedBytes = 0
  const archive = unzipSync(bytes, { filter(entry) {
    expandedBytes += entry.originalSize
    if (expandedBytes > 120 * 1024 * 1024) throw new Error("This Word file is too large to expand.")
    return true
  } })
  if (!archive[documentPart]) throw new Error("This file does not contain a Word document.")
  const xml = strFromU8(archive[documentPart])
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported Word XML.")
  const document = new DOMParser().parseFromString(xml, "application/xml")
  const namespace = document.documentElement.namespaceURI
  if (![wordNamespace, strictNamespace].includes(namespace)) throw new Error("Unsupported Word format.")
  const paragraphs = Array.from(document.getElementsByTagNameNS(namespace, "p"))
  const runs = paragraphs.map(paragraph => Array.from(paragraph.getElementsByTagNameNS(namespace, "t")).filter(node => {
    let owner = node.parentNode
    while (owner && owner.localName !== "p") owner = owner.parentNode
    return owner === paragraph
  }))
  const lines = paragraphs.map((paragraph, index) => {
    const style = paragraph.getElementsByTagNameNS(namespace, "pStyle")[0]?.getAttributeNS(namespace, "val") || ""
    return { style, text: runs[index].map(node => node.textContent).join(""), editable: runs[index].length > 0 }
  })
  return { archive, document, runs, lines }
}

async function saveWord(source, edits, formats = {}, table, image) {
  if (!source.archive) {
    const children = source.lines.map((line, index) => new Paragraph(edits[index] ?? line.text))
    const converted = await Packer.toBuffer(new Document({ sections: [{ children }] }))
    if (!Object.keys(formats).length && !table && !image) return converted
    return saveWord(await readWord(converted, "docx"), {}, formats, table, image)
  }
  const cloned = source.document.cloneNode(true)
  const originalNodes = Array.from(source.document.getElementsByTagName("*")).filter(node => node.localName === "t")
  const clonedNodes = Array.from(cloned.getElementsByTagName("*")).filter(node => node.localName === "t")
  const nodeMap = new Map(originalNodes.map((node, index) => [node, clonedNodes[index]]))
  for (const [index, text] of Object.entries(edits)) {
    const nodes = source.runs[index].map(node => nodeMap.get(node))
    const ownership = nodes.flatMap((node, owner) => Array.from(node.textContent, () => owner))
    const replacement = nodes.map(() => "")
    const previous = nodes.map(node => node.textContent).join("")
    let offset = 0
    for (const part of diffChars(previous, text)) {
      const characters = Array.from(part.value)
      if (part.added) replacement[ownership[Math.min(offset, ownership.length - 1)] ?? 0] += part.value
      else {
        if (!part.removed) for (let character = 0; character < characters.length; character++) {
          replacement[ownership[offset + character] ?? 0] += characters[character]
        }
        offset += characters.length
      }
    }
    for (let run = 0; run < nodes.length; run++) {
      nodes[run].textContent = replacement[run]
      nodes[run].setAttributeNS(xmlNamespace, "xml:space", "preserve")
    }
  }
  const { applyFormatting, ensureListParts, insertTable, insertImage } = await import("./word-format.mjs")
  const archive = { ...source.archive }
  const hasLists = Object.values(formats).some(format => ["bullet", "decimal"].includes(format.list))
  const listIds = hasLists ? ensureListParts(archive, DOMParser, XMLSerializer, strFromU8, strToU8, cloned.documentElement.namespaceURI) : {}
  applyFormatting(cloned, formats, listIds)
  if (table) insertTable(cloned, table.index, table.rows, table.columns)
  if (image) insertImage(cloned, archive, image, DOMParser, XMLSerializer, strFromU8, strToU8)
  archive[documentPart] = strToU8(new XMLSerializer().serializeToString(cloned))
  return zipSync(archive, { level: 3 })
}

module.exports = { readWord, saveWord }
