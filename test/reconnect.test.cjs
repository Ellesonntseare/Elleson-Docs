const { test } = require("node:test")
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const { PDFDocument } = require("pdf-lib")
const { start } = require("../server.cjs")

test("phone queues edits through connection loss and resolves conflicting answers explicitly", { timeout: 90000 }, async () => {
  const host = await start(), browser = await chromium.launch({ channel: "msedge" })
  try {
    const headers = { Authorization: "Bearer " + host.owner, "Content-Type": "application/json" }
    const pdf = await PDFDocument.create(), page = pdf.addPage([400, 500])
    pdf.getForm().createTextField("Answer").addToPage(page, { x: 30, y: 350, width: 200, height: 25 })
    await host.open("reconnect.pdf", Buffer.from(await pdf.save()))
    const pc = await browser.newPage(), phone = await browser.newPage({ viewport: { width: 390, height: 780 } })
    const pairing = await (await fetch(host.address + "/api/pairing", { method: "POST", headers, body: "{}" })).json()
    await pc.goto(host.address + "/#owner=" + host.owner)
    await phone.goto(host.address)
    await phone.getByLabel("Pairing code").fill(pairing.code)
    await phone.getByRole("button", { name: "Connect", exact: true }).click()
    await phone.getByText("PDF ready", { exact: true }).waitFor()
    await pc.getByText("PDF ready", { exact: true }).waitFor()
    await phone.context().setOffline(true)
    await phone.getByRole("textbox", { name: "Answer", exact: true }).fill("Retained on phone")
    await phone.getByRole("textbox", { name: "Answer", exact: true }).blur()
    await phone.waitForFunction(() => JSON.parse(localStorage.getItem("elleson-pending-edits") || "[]").length === 1)
    await pc.getByRole("textbox", { name: "Answer", exact: true }).fill("Changed on PC")
    await pc.getByRole("textbox", { name: "Answer", exact: true }).blur()
    await pc.getByText("Change synced", { exact: true }).waitFor()
    let conflict = false
    phone.once("dialog", async dialog => { conflict = true; await dialog.accept() })
    await phone.context().setOffline(false)
    await pc.waitForFunction(() => document.querySelector('[aria-label="Answer"]').value === "Retained on phone")
    assert.ok(conflict)
    await phone.waitForFunction(() => JSON.parse(localStorage.getItem("elleson-pending-edits") || "[]").length === 0)
    await phone.reload()
    await phone.getByText("PDF ready", { exact: true }).waitFor()
    assert.equal(await phone.getByRole("textbox", { name: "Answer", exact: true }).inputValue(), "Retained on phone")
  } finally { await browser.close(); await new Promise(resolve => host.server.close(resolve)) }
})
test("native handoff packet imports edited bytes and transfers the requested view to the PC", { timeout: 60000 }, async () => {
  const host = await start(), browser = await chromium.launch({ channel: "msedge" })
  try {
    const pdf = await PDFDocument.create(); pdf.addPage([400, 500]); pdf.addPage([400, 500]).drawText("Phone handoff")
    const screen = await browser.newPage()
    await screen.addInitScript(packet => {
      window.EllesonAndroid = { ready() {}, pendingHandoff: () => window.handoffFinished ? "" : JSON.stringify(packet), finishHandoff: () => { window.handoffFinished = true } }
    }, { target: "pc", name: "from-phone.pdf", page: 2, zoom: 1.5, data: Buffer.from(await pdf.save()).toString("base64") })
    await screen.goto(host.address + "/#owner=" + host.owner)
    await screen.locator("#file-title").getByText("from-phone.pdf", { exact: true }).waitFor()
    await screen.waitForFunction(() => window.handoffFinished === true)
    await screen.waitForFunction(() => document.querySelector("#page").value === "2")
    const state = await (await fetch(host.address + "/api/state", { headers: { Authorization: "Bearer " + host.owner } })).json()
    assert.equal(state.handoff.page, 2); assert.equal(state.handoff.zoom, 1.5)
  } finally { await browser.close(); await new Promise(resolve => host.server.close(resolve)) }
})
