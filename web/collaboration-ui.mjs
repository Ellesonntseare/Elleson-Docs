const send = (app, url, payload) => app.request(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
})

export function installCollaboration(app, hub) {
  const panel = hub.dialog("collaboration-workspace", "Live collaboration")
  const status = hub.message(panel)
  const roster = document.createElement("ul"), actions = hub.actions(panel)
  panel.append(roster)
  const links = document.createElement("div")
  links.className = "addresses"
  panel.append(links)
  const recent = document.createElement("details")
  const label = document.createElement("summary"), activity = document.createElement("ol")
  label.textContent = "Recent edits"
  recent.append(label, activity)
  panel.append(recent)
  let shared, roomKey
  async function refresh() {
    if (!panel.open) return
    const room = await (await app.request("/api/collab-room")).json()
    const key = JSON.stringify(room)
    if (!panel.open || key === roomKey) return
    roomKey = key
    if (room.document !== shared) links.replaceChildren()
    shared = room.document
    roster.replaceChildren(...room.participants.map(person => {
      const row = document.createElement("li")
      row.textContent = person.name + (room.self === person.id ? " (you)" : "") + " · " + (person.online ? "Online" : "Away") +
        (person.paragraph ? " · Paragraph " + person.paragraph : person.page ? " · Page " + person.page : "")
      if (app.role() === "pc" && person.id !== "host") hub.button("Remove", async () => {
        await send(app, "/api/collab-revoke/" + room.document, { participant: person.id })
        await refresh()
      }, row)
      return row
    }))
    activity.replaceChildren(...room.activity.slice().reverse().map(edit => {
      const entry = document.createElement("li")
      entry.textContent = edit.author + " · " + edit.kind.replaceAll("-", " ") + " · " + new Date(edit.at).toLocaleTimeString()
      return entry
    }))
    if (!room.document) status.textContent = "Open a PDF or DOCX to start."
    inviteButton.hidden = stopButton.hidden = app.role() !== "pc" || !room.document
  }
  const inviteButton = hub.button("Create invite link", async () => {
    const doc = app.get()
    if (!doc) throw new Error("Open a document first.")
    const invite = await (await send(app, "/api/collab-invite/" + doc.id, {})).json()
    const urls = invite.addresses.length ? invite.addresses : [invite.local]
    links.replaceChildren(...urls.map(url => {
      const input = document.createElement("input")
      input.readOnly = true
      input.value = url
      input.setAttribute("aria-label", "One-use invitation link")
      input.onclick = () => input.select()
      const row = document.createElement("div")
      row.append(input)
      hub.button("Copy invite", async () => {
        input.select()
        if (!document.execCommand("copy")) status.textContent = "Link selected. Copy it using your browser or keyboard."
        else status.textContent = "Invite copied. Share it with one person on the same trusted network."
      }, row)
      return row
    }))
    status.textContent = "Each link is single-use and expires in ten minutes. Share it only on a trusted local network."
  }, actions)
  const stopButton = hub.button("End sharing", async () => {
    if (!shared || !confirm("Remove all collaborators and revoke unused invites for this document?")) return
    await send(app, "/api/collab-revoke/" + shared, {})
    links.replaceChildren()
    status.textContent = "Sharing ended."
    await refresh()
  }, actions)
  hub.button("Close", () => panel.close(), actions)
  hub.button("Live collaboration", async () => {
    roomKey = undefined
    if (location.hostname === "appassets.androidplatform.net") throw new Error("Connect to the PC or open an invite in a browser on the same network.")
    status.textContent = "Collaborators edit this document on the same trusted local network."
    panel.showModal()
    await refresh()
  }, hub.tools).id = "suite-collaboration"
  setInterval(() => { if (panel.open) void refresh().catch(error => { status.textContent = error.message }) }, 1800)
}
