let opening
let queue = Promise.resolve()
function database() {
  return opening ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('elleson-scan-drafts', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function readScanDraft() {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction('drafts').objectStore('drafts').get('scan')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export function storeScanDraft(value) {
  const snapshot = structuredClone(value)
  const operation = queue.catch(() => {}).then(async () => {
    const db = await database()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite')
      if (snapshot?.scans?.length) transaction.objectStore('drafts').put(snapshot, 'scan')
      else transaction.objectStore('drafts').delete('scan')
      transaction.oncomplete = resolve
      transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Could not retain the scan draft.'))
    })
  })
  queue = operation
  return operation
}
