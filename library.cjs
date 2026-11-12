const fs = require("node:fs/promises")
const path = require("node:path")
const crypto = require("node:crypto")

class DocumentLibrary {
  constructor(directory) {
    this.directory = directory
    this.records = []
    this.memory = new Map()
    this.queue = Promise.resolve()
    this.limit = 20
    this.warning = ""
  }
  async load() {
    if (!this.directory) return
    try {
      this.records = JSON.parse(await fs.readFile(path.join(this.directory, "index.json"), "utf8"))
      if (!Array.isArray(this.records)) throw new Error("Invalid document index")
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.warning = "The document index was damaged. A recovery index was used where available. Existing document files were retained."
        await fs.copyFile(path.join(this.directory, "index.json"), path.join(this.directory, "index-damaged-" + Date.now() + ".json")).catch(() => {})
        try { this.records = JSON.parse(await fs.readFile(path.join(this.directory, "index.backup.json"), "utf8")); if (!Array.isArray(this.records)) this.records = [] } catch { this.records = [] }
      }
    }
    try { this.limit = Math.max(1, Math.min(100, JSON.parse(await fs.readFile(path.join(this.directory, "settings.json"), "utf8")).limit || 20)) } catch {}
  }
  list() {
    return this.records.map(({ versions, ...record }) => ({ ...record, versionCount: versions.length }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated)
  }
  async writeIndex(records) {
    if (!this.directory) return
    await fs.mkdir(this.directory, { recursive: true })
    await fs.writeFile(path.join(this.directory, "index.tmp"), JSON.stringify(records))
    await fs.copyFile(path.join(this.directory, "index.json"), path.join(this.directory, "index.backup.json")).catch(error => { if (error.code !== "ENOENT") throw error })
    await fs.rename(path.join(this.directory, "index.tmp"), path.join(this.directory, "index.json"))
  }
  async save(filename, bytes, id = crypto.randomUUID()) {
    const operation = this.queue.then(async () => {
      const previous = this.records.find(record => record.id === id)
      const version = { id: crypto.randomUUID(), date: Date.now(), size: bytes.length, filename }
      const record = {
        id, filename, pinned: previous?.pinned || false, updated: Date.now(),
        versions: [...previous?.versions || [], version]
      }
      const records = [...this.records.filter(record => record.id !== id), record]
      if (this.directory) {
        await fs.mkdir(this.directory, { recursive: true })
        await fs.writeFile(path.join(this.directory, version.id + ".bin"), bytes)
      } else this.memory.set(version.id, Buffer.from(bytes))
      await this.writeIndex(records)
      this.records = records
      await this.trim()
      return id
    })
    this.queue = operation.catch(() => {})
    return operation
  }
  async pin(id, pinned) {
    const operation = this.queue.then(async () => {
      if (!this.records.some(record => record.id === id)) throw new Error("Document not found.")
      const records = this.records.map(record => record.id === id ? { ...record, pinned } : record)
      await this.writeIndex(records)
      this.records = records
    })
    this.queue = operation.catch(() => {})
    return operation
  }
  versions(id) {
    return [...(this.records.find(record => record.id === id)?.versions || [])].reverse()
  }
  async read(id, versionId) {
    await this.queue
    const record = this.records.find(record => record.id === id)
    const version = versionId ? record?.versions.find(item => item.id === versionId) : record?.versions.at(-1)
    if (!version) throw new Error("Saved version not found.")
    let bytes
    try { bytes = this.directory ? await fs.readFile(path.join(this.directory, version.id + ".bin")) : this.memory.get(version.id) }
    catch { throw new Error("This saved file is missing or unavailable. Try another version, restore a backup, or reopen the original file.") }
    if (!bytes) throw new Error("This saved file is unavailable.")
    return { bytes, filename: version.filename }
  }
  stats() {
    return { documents: this.records.length, versions: this.records.reduce((sum, item) => sum + item.versions.length, 0),
      bytes: this.records.reduce((sum, item) => sum + item.versions.reduce((size, version) => size + version.size, 0), 0), limit: this.limit, warning: this.warning }
  }
  async trim() {
    const removed = this.records.flatMap(record => record.versions.slice(0, -this.limit))
    const records = this.records.map(record => ({ ...record, versions: record.versions.slice(-this.limit) }))
    await this.writeIndex(records)
    this.records = records
    for (const version of removed) {
      if (this.directory) await fs.unlink(path.join(this.directory, version.id + ".bin")).catch(() => {})
      else this.memory.delete(version.id)
    }
  }
  async settings(limit) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Keep between 1 and 100 versions per document.")
    const operation = this.queue.then(async () => {
      this.limit = limit
      if (this.directory) await fs.writeFile(path.join(this.directory, "settings.json"), JSON.stringify({ limit }))
      await this.trim()
    })
    this.queue = operation.catch(() => {})
    return operation
  }
  async remove(id, versionId) {
    const operation = this.queue.then(async () => {
      const record = this.records.find(item => item.id === id)
      if (!record) throw new Error("Document not found.")
      if (versionId && record.versions.at(-1)?.id === versionId) throw new Error("Keep the latest saved version or remove the whole document from the library.")
      const removed = versionId ? record.versions.filter(version => version.id === versionId) : record.versions
      const records = versionId ? this.records.map(item => item.id === id ? { ...item, versions: item.versions.filter(version => version.id !== versionId) } : item) : this.records.filter(item => item.id !== id)
      await this.writeIndex(records)
      this.records = records
      for (const version of removed) {
        if (this.directory) await fs.unlink(path.join(this.directory, version.id + ".bin")).catch(() => {})
        else this.memory.delete(version.id)
      }
    })
    this.queue = operation.catch(() => {})
    return operation
  }
  async backup() {
    await this.queue
    if (this.stats().bytes > 500 * 1024 * 1024) throw new Error("This backup exceeds 500 MB. Remove unwanted versions before exporting.")
    const { zipSync, strToU8 } = require("fflate")
    const files = { "index.json": strToU8(JSON.stringify(this.records)), "README.txt": strToU8("Elleson Docs backup. Files in documents/ are standard PDF or Word documents. index.json records the document versions.") }
    for (const record of this.records) for (const version of record.versions) {
      const extension = path.extname(version.filename).toLowerCase()
      files["documents/" + version.id + extension] = (await this.read(record.id, version.id)).bytes
    }
    return Buffer.from(zipSync(files, { level: 1 }))
  }
}

module.exports = { DocumentLibrary }
