const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto')
test('updater chooses newer versions and checksum-protected platform assets',async()=>{
  const {newerVersion,updateAsset}=await import('../web/updater.mjs')
  assert.equal(newerVersion('v0.4.0-preview.10','0.4.0-preview.3'),true);assert.equal(newerVersion('0.4.0','0.4.0-preview.3'),true);assert.equal(newerVersion('0.4.0-preview.3','0.4.0'),false);assert.equal(newerVersion('invalid','0.4.0'),false)
  const asset={state:'uploaded',name:'Elleson-Docs-Android.apk',digest:'sha256:'+'a'.repeat(64),browser_download_url:'https://github.com/Ellesonntseare/Elleson-Docs/releases/download/v0.4.0/app.apk'}
  assert.equal(updateAsset({assets:[asset]},'android'),asset);assert.equal(updateAsset({assets:[{...asset,digest:null}]},'android'),undefined);assert.equal(updateAsset({assets:[{...asset,browser_download_url:'https://example.com/app.apk'}]},'android'),undefined)
})
test('Windows updater verifies downloads before publishing them and removes failed partial files',async()=>{
  const {downloadUpdate}=require('../update-download.cjs'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'docs-update-')),original=global.fetch,bytes=Buffer.from('update-package'),digest='sha256:'+crypto.createHash('sha256').update(bytes).digest('hex'),url='https://github.com/Ellesonntseare/Elleson-Docs/releases/download/v0.4.0/Elleson-Docs-Windows-x64.zip'
  try{global.fetch=async()=>new Response(bytes);const result=await downloadUpdate(url,digest,directory);assert.deepEqual(await fs.readFile(result),bytes);await assert.rejects(downloadUpdate(url,'sha256:'+'0'.repeat(64),directory),/checksum/);assert.deepEqual(await fs.readdir(directory),['Elleson-Docs-Windows-x64.zip']);await assert.rejects(downloadUpdate('https://example.com/app.zip',digest,directory),/valid download/)}finally{global.fetch=original;await fs.rm(directory,{recursive:true,force:true})}
})
