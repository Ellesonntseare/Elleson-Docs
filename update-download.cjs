const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto')
const base='https://github.com/Ellesonntseare/Elleson-Docs/releases/download/'
async function downloadUpdate(url,digest,directory){
  if(typeof url!=='string'||!url.startsWith(base)||!/^sha256:[a-f0-9]{64}$/.test(digest||''))throw Error('This update does not have a valid download and checksum.')
  const parsed=new URL(url),name=decodeURIComponent(parsed.pathname.split('/').pop())
  if(!/^Elleson[- ]Docs.*Windows.*\.zip$/i.test(name)||/[\\/]/.test(name))throw Error('Choose the Windows update package.')
  const response=await fetch(url,{signal:AbortSignal.timeout(180000)})
  if(!response.ok)throw Error('The update download failed. Try again later.')
  const destination=path.join(directory,name),temporary=destination+'.'+crypto.randomUUID()+'.partial'
  await fs.mkdir(directory,{recursive:true})
  let file,total=0;const hash=crypto.createHash('sha256')
  try{file=await fs.open(temporary,'wx');for await(const chunk of response.body){total+=chunk.length;if(total>600*1024*1024)throw Error('Update exceeds the download limit.');hash.update(chunk);await file.writeFile(chunk)}
    if(hash.digest('hex')!==digest.slice(7))throw Error('The update checksum did not match. The download was discarded.')
    await file.sync();await file.close();file=null;await fs.rename(temporary,destination);return destination
  }catch(error){if(file)await file.close().catch(()=>{});await fs.unlink(temporary).catch(()=>{});throw error}
}
module.exports={downloadUpdate}
