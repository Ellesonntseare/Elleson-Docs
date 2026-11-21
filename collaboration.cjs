const crypto = require("node:crypto")
const digest = token => crypto.createHash("sha256").update(token).digest("hex")
const random = () => crypto.randomBytes(24).toString("base64url")
const validToken = token => typeof token === "string" && /^[\w-]{32}$/.test(token)

function isLanAddress(address = "") {
  const ip = address.replace(/^::ffff:/, "")
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || ip === "::1"
}

function createCollaboration(saved = [], write = async () => {}) {
  let grants = new Map(saved.filter(item => item && typeof item.hash === "string" && typeof item.id === "string" && item.until > Date.now()).map(item => [item.hash, item]))
  const invites = new Map(), presence = new Map()
  let queue = Promise.resolve()
  const changeGrants = mutate => {
    const work = queue.then(async () => {
      const next = new Map(grants)
      const result = mutate(next)
      await write([...next.values()].filter(item => item.until > Date.now()))
      grants = next
      return result
    })
    queue = work.catch(() => {})
    return work
  }
  function invite(document) {
    for (const [key, value] of invites) if (value.until <= Date.now()) invites.delete(key)
    if (invites.size >= 40) throw new Error("Too many unused invites. Wait for older invites to expire.")
    const token = random()
    invites.set(digest(token), { document, until: Date.now() + 10 * 60000 })
    return token
  }
  async function join(token, name, hasDocument) {
    if (!validToken(token) || typeof name !== "string" || !name.trim() || name.length > 60) throw Object.assign(new Error("Enter a display name and open a valid invite."), { status: 400 })
    const inviteHash = digest(token)
    const entry = invites.get(inviteHash)
    if (!entry || entry.until <= Date.now() || !hasDocument(entry.document)) throw Object.assign(new Error("This invite expired or the document was closed."), { status: 410 })
    invites.delete(inviteHash)
    const credential = random(), hash = digest(credential)
    const person = { id: crypto.randomUUID(), name: name.trim(), document: entry.document, until: Date.now() + 24 * 3600000, hash }
    try {
      await changeGrants(next => {
        if ([...next.values()].filter(item => item.document === entry.document && item.until > Date.now()).length >= 12) throw new Error("This document already has 12 collaborator seats.")
        next.set(hash, person)
      })
    } catch (error) { if (entry.until > Date.now()) invites.set(inviteHash, entry); throw error }
    return { token: credential, name: person.name }
  }
  function get(token) {
    if (!validToken(token)) return undefined
    const grant = grants.get(digest(token))
    return grant?.until > Date.now() ? grant : undefined
  }
  function update(document, id, position) {
    const key = document + ":" + id
    presence.set(key, { position: position || presence.get(key)?.position, lastSeen: Date.now() })
    for (const [key, value] of presence) if (Date.now() - value.lastSeen > 60000) presence.delete(key)
  }
  function roster(document) {
    return [{ id: "host", name: "Host", document }, ...grants.values()]
      .filter(item => item.document === document && (item.id === "host" || item.until > Date.now()))
      .map(({ id, name }) => {
        const state = presence.get(document + ":" + id)
        return { id, name, online: Boolean(state && Date.now() - state.lastSeen < 12000), page: state?.position?.page, paragraph: state?.position?.paragraph }
      })
  }
  async function revoke(document, id = null) {
    await changeGrants(next => {
      for (const [key, grant] of next) if (grant.document === document && (id === null || grant.id === id)) next.delete(key)
    })
    if (id === null) for (const [key, invite] of invites) if (invite.document === document) invites.delete(key)
  }
  return { invite, join, get, update, roster, revoke, hasGuests: document => roster(document).length > 1 }
}

// Merge single changed ranges against the original paragraph when they do not overlap.
function mergeParagraph(base, latest, proposed) {
  if (typeof base !== "string" || base.length > 16000) return undefined
  if (proposed === latest || proposed === base) return latest
  function range(text) {
    let start = 0, oldEnd = base.length, newEnd = text.length
    while (start < Math.min(oldEnd, newEnd) && base[start] === text[start]) start++
    while (oldEnd > start && newEnd > start && base[oldEnd - 1] === text[newEnd - 1]) { oldEnd--; newEnd-- }
    return { start, end: oldEnd, text: text.slice(start, newEnd) }
  }
  const a = range(latest), b = range(proposed)
  if (a.start === b.start || a.end > b.start && b.end > a.start) return undefined
  const [first, second] = [a, b].sort((left, right) => left.start - right.start)
  if (first.end > second.start) return undefined
  return base.slice(0, first.start) + first.text + base.slice(first.end, second.start) + second.text + base.slice(second.end)
}
module.exports = { createCollaboration, isLanAddress, mergeParagraph }
