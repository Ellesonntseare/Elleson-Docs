import * as mupdf from "mupdf"
import { PDFDocument } from "pdf-lib"
import { unzipSync, strFromU8 } from "fflate"
import { DOMParser } from "@xmldom/xmldom"
import { fieldValues } from "./pdf-fields.mjs"

export function normalizedTags(tags) {
  if (!Array.isArray(tags)) throw new Error("Enter comma-separated tags.")
  return [...new Set(tags.slice(0, 20).filter(tag => typeof tag === "string")
    .map(tag => tag.trim().slice(0, 40)).filter(Boolean))]
}

export function createLibrarySearch() {
  const index = new Map()
  return async function search(records, read, query) {
    const terms = String(query || "").trim().slice(0, 200).toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return { matches: [], skipped: 0 }
    const matches = []
    let skipped = 0
    for (const record of records) {
      if (matches.length >= 100) break
      const version = record.latest
      if (!version) continue
      const title = record.filename + " " + (record.tags || []).join(" ")
      const titleLower = title.toLowerCase()
      if (terms.every(term => titleLower.includes(term))) {
        matches.push({ id: record.id, filename: record.filename, snippet: title })
        continue
      }
      try {
        let sections = index.get(version.id)
        if (!sections) {
          await new Promise(resolve => setTimeout(resolve, 0))
          sections = await extractSearchText(await read(record.id, version.id))
          index.set(version.id, sections)
          if (index.size > 64) index.delete(index.keys().next().value)
        }
        const section = sections.find(item => {
          const content = item.text.toLowerCase()
          return terms.every(term => titleLower.includes(term) || content.includes(term))
        })
        if (!section) continue
        const offset = Math.max(0, section.text.toLowerCase().indexOf(terms.find(term => !titleLower.includes(term))) - 45)
        matches.push({ id: record.id, filename: record.filename, page: section.page, snippet: section.text.slice(offset, offset + 170) })
      } catch { skipped++ }
    }
    return { matches, skipped }
  }
}

async function extractSearchText({ filename, bytes }) {
  if (/\.pdf$/i.test(filename)) {
    const document = new mupdf.PDFDocument(bytes)
    try {
      const pages = []
      let remaining = 400000
      for (let index = 0; index < Math.min(200, document.countPages()) && remaining > 0; index++) {
        const page = document.loadPage(index)
        try {
          const text = page.toStructuredText()
          try {
            const content = text.asText().replace(/\s+/g, " ").slice(0, remaining)
            pages.push({ page: index + 1, text: content })
            remaining -= content.length
          } finally { text.destroy() }
        } finally { page.destroy() }
      }
      const pdf = await PDFDocument.load(bytes)
      pages.push({ text: Object.entries(fieldValues(pdf)).map(entry => entry.join(": ")).join(" ").slice(0, 40000) })
      return pages
    } finally { document.destroy() }
  }
  let size = 0
  const archive = unzipSync(bytes, { filter(entry) {
    if (entry.name !== "word/document.xml") return false
    size += entry.originalSize
    if (size > 24000000) throw new Error("Word document exceeds the search limit.")
    return true
  } })
  const xml = strFromU8(archive["word/document.xml"])
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported Word XML.")
  const document = new DOMParser().parseFromString(xml, "application/xml")
  return [{ text: Array.from(document.getElementsByTagNameNS(document.documentElement.namespaceURI, "t"), node => node.textContent).join(" ").slice(0, 400000) }]
}
