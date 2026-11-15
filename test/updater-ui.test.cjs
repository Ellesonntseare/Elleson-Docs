const {test}=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright'),{start}=require('../server.cjs'),{clickTool}=require('./menu-helper.cjs')
test('updater screen handles unpublished releases, shows a newer release and starts its verified download',{timeout:45000},async()=>{
  const host=await start(),browser=await chromium.launch({channel:'msedge'})
  try{const page=await browser.newPage();let releases=[]
    await page.route('https://api.github.com/repos/Ellesonntseare/Elleson-Docs/releases?per_page=20',route=>route.fulfill({json:releases}))
    await page.goto(host.address+'/#owner='+host.owner);await page.locator('#check-updates').waitFor({state:'attached'})
    await page.evaluate(()=>{window.desktopDocs={appVersion:async()=> '0.4.0-preview.3',downloadUpdate:async(url,digest)=>{window.updateRequest={url,digest};return 'downloaded.zip'}}})
    await clickTool(page,page.locator('#check-updates'));await page.getByText('No newer published update is available.',{exact:true}).waitFor()
    const digest='sha256:'+'a'.repeat(64),url='https://github.com/Ellesonntseare/Elleson-Docs/releases/download/v0.4.1/Elleson-Docs-Windows-x64.zip'
    releases=[{draft:false,tag_name:'v0.4.1',body:'Drawing improvements',assets:[{state:'uploaded',name:'Elleson-Docs-Windows-x64.zip',digest,browser_download_url:url,size:1048576}]}]
    await page.locator('#update-check').click();await page.getByText('Version v0.4.1 is available (1 MB).',{exact:true}).waitFor();await page.locator('#update-download').click()
    await page.getByText(/Update downloaded and verified/).waitFor();assert.deepEqual(await page.evaluate(()=>window.updateRequest),{url,digest})
  }finally{await browser.close();await new Promise(resolve=>host.server.close(resolve))}
})
