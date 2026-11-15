// Exercise the same summaries a user opens before interacting with a tool.
async function showMobileControls(page) {
  if(!await page.evaluate(()=>(window.desktopDocs||matchMedia('(max-width:600px)').matches)&&!document.querySelector('dialog[open]')))return
  const controls=page.getByRole('button',{name:'All document controls',exact:true,includeHidden:true})
  const more=controls.locator('xpath=ancestor::details[1]/summary')
  if(await more.isVisible() && await page.evaluate(()=>!document.body.classList.contains('mobile-controls-open'))){
    if(!await controls.isVisible())await more.click()
    await controls.click()
  }
}
async function clickTool(page, locator, options) {
  if (await locator.count() > 1) {
    const visible = locator.filter({visible:true})
    if (await visible.count() === 1) locator = visible
    else {
      for (let index=0; index<await locator.count(); index++) {
        const candidate=locator.nth(index)
        if (await candidate.evaluate(node => !node.closest('[hidden]') && (!node.closest('dialog') || node.closest('dialog').open))) { locator=candidate; break }
      }
    }
  }
  const summary = locator.locator('xpath=ancestor::details[1]/summary')
  if (await summary.count() && !await locator.isVisible()) {
    await page.keyboard.press('Escape')
    if(!await summary.isVisible())await showMobileControls(page)
    await summary.click()
  }
  if(!await locator.isVisible() && !await summary.count())await showMobileControls(page)
  await locator.click(options)
}
// This Playwright runtime treats a Promise as truthy in waitForFunction.
// Await remote predicates in evaluate, then poll their resolved boolean here.
async function waitForAsync(page, predicate, argument, timeout = 30000) {
  const deadline=Date.now()+timeout
  while (Date.now()<deadline) {
    if (await page.evaluate(predicate, argument)) return
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  throw new Error('Timed out waiting for the asynchronous state check: '+predicate.toString())
}
module.exports = { clickTool, waitForAsync, showMobileControls }
