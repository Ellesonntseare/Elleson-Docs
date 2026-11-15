const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

// Flush the completed replacement before publishing it. Keep the old target
// intact if writing or syncing fails.
async function durableWrite(target, bytes) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temporary = target + '.elleson-' + crypto.randomUUID() + '.tmp'
  let file
  try {
    file = await fs.open(temporary, 'wx')
    await file.writeFile(bytes)
    await file.sync()
    await file.close(); file = null
    await fs.rename(temporary, target)
  } catch (error) {
    if (file) await file.close().catch(() => {})
    await fs.unlink(temporary).catch(() => {})
    throw error
  }
}
module.exports = { durableWrite }
