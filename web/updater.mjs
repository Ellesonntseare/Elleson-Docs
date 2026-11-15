const repository='Ellesonntseare/Elleson-Docs'
export function newerVersion(candidate,current){
  const parse=value=>{const match=/^v?(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/.exec(value);return match?[...match.slice(1,4).map(Number),match[4]?0:1,Number(match[5]||0)]:null}
  const a=parse(candidate),b=parse(current);if(!a||!b)return false
  for(let i=0;i<a.length;i++){if(a[i]!==b[i])return a[i]>b[i]}return false
}
export function updateAsset(release,platform){return release.assets?.find(asset=>asset.state==='uploaded'&&(platform==='android'?/\.apk$/i.test(asset.name):/windows.*\.zip$/i.test(asset.name))&&asset.browser_download_url?.startsWith('https://github.com/'+repository+'/releases/download/')&&/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))}
export function installUpdater(){
  const button=document.createElement('button');button.id='check-updates';button.textContent='Check for updates';document.getElementById('history-actions').append(button)
  const dialog=document.createElement('dialog');dialog.id='update-dialog';dialog.innerHTML='<h2>App updates</h2><p id="installed-version"></p><p id="offered-version" hidden></p><p role="status"></p><pre style="white-space:pre-wrap;max-height:35vh;overflow:auto"></pre><button id="update-check">Check now</button><button id="update-download" disabled>Download update</button><form method="dialog"><button>Close</button></form>';document.body.append(dialog)
  const status=dialog.querySelector('[role=status]'),download=dialog.querySelector('#update-download'),check=dialog.querySelector('#update-check');let selected,version
  const platform=window.EllesonAndroid?'android':'windows'
  button.onclick=async()=>{dialog.showModal();try{version=window.EllesonAndroid?.appVersion?.()||await window.desktopDocs?.appVersion?.()||(await(await fetch('/app-version.json')).json()).version;dialog.querySelector('#installed-version').textContent='Installed version: '+version;await checkNow()}catch(error){status.textContent=error.message}}
  async function checkNow(){selected=undefined;const offered=dialog.querySelector('#offered-version');offered.hidden=true;check.disabled=true;download.disabled=true;status.textContent='Checking for updates…';try{
    if(platform==='android' && location.protocol==='http:'){
      try {const local=await(await fetch('/api/local-update',{signal:AbortSignal.timeout(3000)})).json();if(local?.version){offered.textContent='PC offers: '+local.version;offered.hidden=false}if(local&&newerVersion(local.version,version)&&/^sha256:[a-f0-9]{64}$/.test(local.digest)){selected={release:{tag_name:local.version},asset:{browser_download_url:new URL(local.url,location.origin).href,digest:local.digest}};status.textContent='Version '+local.version+' is available from your PC over Wi-Fi.';download.disabled=false;return}}catch{}
    }
    const response=await fetch('https://api.github.com/repos/'+repository+'/releases?per_page=20',{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)})
    if(!response.ok)throw Error(response.status===404?'Updates have not been published yet.':'Could not check for updates. Try again when connected to the internet.')
    const releases=await response.json();selected=undefined
    for(const release of releases.filter(r=>!r.draft&&newerVersion(r.tag_name,version))){const asset=updateAsset(release,platform);if(asset&&(!selected||newerVersion(release.tag_name,selected.release.tag_name)))selected={release,asset}}
    if(!selected){status.textContent='No newer published update is available.';dialog.querySelector('pre').textContent='';return}
    status.textContent='Version '+selected.release.tag_name+' is available ('+Math.ceil(selected.asset.size/1048576)+' MB).';dialog.querySelector('pre').textContent=selected.release.body||'';download.disabled=false
  }catch(error){status.textContent=error.name==='TimeoutError'?'The update server did not respond. Check your internet connection and try again.':error instanceof TypeError?'Could not reach the update server. Check that this device has internet access, then tap Check now.':error.message}finally{check.disabled=false}}
  check.onclick=()=>void checkNow()
  download.onclick=async()=>{if(!selected)return;download.disabled=true;status.textContent='Downloading and checking update…';try{
    if(platform==='android'){window.EllesonAndroid.installUpdate(selected.asset.browser_download_url,selected.asset.digest);status.textContent='The update is downloading. Android will ask you to confirm installation.'}
    else if(window.desktopDocs?.downloadUpdate){const result=await window.desktopDocs.downloadUpdate(selected.asset.browser_download_url,selected.asset.digest);status.textContent='Update downloaded and verified. Extract the ZIP, close Elleson Docs, and run the new version. Saved documents are kept.'}
    else throw Error('Use the installed Windows or Android app to download updates.')
  }catch(error){status.textContent=error.message}finally{download.disabled=false}}
  window.addEventListener('elleson-update-status',event=>{status.textContent=event.detail;download.disabled=event.detail.startsWith('Downloading update:')})
}
