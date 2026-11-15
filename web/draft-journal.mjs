// A small synchronous journal closes the gap before typing reaches the host.
// Keep the latest input on this device until that exact value is acknowledged.
export function createDraftJournal(storage, warn) {
  const key = 'elleson-input-drafts-v1'
  let records = []
  let healthy = true
  try { records = JSON.parse(storage.getItem(key) || '[]'); if (!Array.isArray(records)) records = [] } catch {}
  const match = (record, document, change) => record.document === document && record.change.kind === change.kind && (change.kind === 'word' ? record.change.index === change.index && record.change.structureVersion === change.structureVersion : change.kind === 'field' ? record.change.name === change.name : record.change.id === change.id)
  const persist = () => { try { storage.setItem(key, JSON.stringify(records)); healthy = true } catch { healthy = false; warn('Recovery storage is unavailable. Keep this window open and save a copy.'); return false }; return true }
  return {
    get healthy() { return healthy },
    all: () => structuredClone(records),
    save(document, change) {
      // Paired phones use a local HTTP address, where randomUUID is unavailable.
      const id = change.id || Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2,'0')).join('')
      const record = { document, change: { ...change, id }, updated: Date.now() }
      records = records.filter(item => !match(item, document, change)); records.push(record); persist()
      return record.change
    },
    latest(document, change) { return records.findLast(item => match(item, document, change))?.change },
    acknowledge(document, change) {
      records = records.filter(item => !(match(item, document, change) && JSON.stringify(item.change.value) === JSON.stringify(change.value)))
      persist()
    }
  }
}
