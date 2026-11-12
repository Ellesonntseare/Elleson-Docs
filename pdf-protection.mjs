import mupdf from 'mupdf'
export function protectPdf(bytes, password) {
  if (typeof password !== 'string' || password.length < 8 || new TextEncoder().encode(password).length > 127 || /[\u0000-\u001f]/.test(password)) throw new Error('Use at least 8 characters, at most 127 UTF-8 bytes, without control characters.')
  const document = mupdf.Document.openDocument(bytes, 'application/pdf')
  try {
    const random = new Uint8Array(32); crypto.getRandomValues(random)
    const owner = Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('')
    const buffer = document.saveToBuffer({ encrypt: 'aes-256', 'user-password': password, 'owner-password': owner, compress: true, garbage: 1 })
    try { return buffer.asUint8Array().slice() } finally { buffer.destroy() }
  } finally { document.destroy() }
}
