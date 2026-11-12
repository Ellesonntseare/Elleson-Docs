const fs = require("node:fs/promises")
const path = require("node:path")
const crypto = require("node:crypto")

class DocumentLibrary {
  constructor(directory) {
    this.directory = directory
    this.records = []
    this.memory = new Map()
    this.queue = Promise.resolve()
  }
  async load() {
    if (!this.directory) return
    try { this.records = JSON.parse(await fs.readFile(path.join(this.directory, "index.json"), "utf8")) }
    catch (error) { if (error.code !== "ENOENT") throw error }
  }
  list() {
    return this.records.map(({ versions, ...record }) => ({ ...record, versionCount: versions.length }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated)
  }
  async writeIndex(records) {
    if (!this.directory) return
    await fs.mkdir(this.directory, { recursive: true })
    await fs.writeFile(path.join(this.directory, "index.tmp"), JSON.stringify(records))
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
    const bytes = this.directory
      ? await fs.readFile(path.join(this.directory, version.id + ".bin")) : this.memory.get(version.id)
    return { bytes, filename: version.filename }
  }
}

module.exports = { DocumentLibrary }
