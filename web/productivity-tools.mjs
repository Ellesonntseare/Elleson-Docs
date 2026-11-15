export function installProductivity(app) {
  const $ = id => document.getElementById(id)
  const button = document.createElement('button'); button.textContent='Document tools'; button.id='document-extras'; $('history-actions').append(button)
  const dialog=document.createElement('dialog'); dialog.id='extras-dialog'
  dialog.innerHTML=`<h2>Document tools</h2>
  <details open><summary>Fill and stamp</summary><p>Choose a mark, then tap the PDF to place it.</p><div class="actions" id="quick-stamps"></div>
  <label>Custom stamp or initials <input id="stamp-value" maxlength="80"></label><button id="stamp-place">Place stamp</button><button id="stamp-save">Save stamp</button><select id="saved-stamps" aria-label="Saved stamps"></select><button id="stamp-remove">Remove saved stamp</button></details>
  <details><summary>Personal form profile</summary><p>Stored on this device only. Choose a detail to insert; nothing fills automatically.</p><div id="profile-inputs"></div><button id="profile-save">Save profile on this device</button><button id="profile-clear">Delete profile</button></details>
  <details><summary>Find and replace in Word</summary><label>Find <input id="replace-find"></label><label>Replace with <input id="replace-with"></label><label><input id="replace-case" type="checkbox"> Match case</label><label><input id="replace-whole" type="checkbox"> Whole words</label><button id="replace-preview">Preview matches</button><p id="replace-count"></p><button id="replace-first">Replace first</button><button id="replace-all">Replace all</button></details>
  <details><summary>PDF header, footer and watermark</summary><label>Header <input id="extra-header" maxlength="120"></label><label>Footer <input id="extra-footer" maxlength="120"></label><label>Watermark <input id="extra-watermark" maxlength="120"></label><label><input id="extra-numbers" type="checkbox"> Number PDF pages</label><button id="extra-decorate">Save decorated copy</button></details>
  <details><summary>Viewing and document information</summary><div class="actions"><button id="extra-info">Document information</button><button id="extra-theme">Toggle dark interface</button><button id="extra-focus">Focus reading</button><button id="extra-fullscreen">Full screen</button></div><pre id="extra-information"></pre></details>
  <details><summary>Recovery and saved versions</summary><p>Open Files to restore a saved version. Unsaved tabs are recovered automatically after restarting. Export a backup before clearing device storage.</p><button id="extra-recovery">Open files and versions</button></details>
  <p id="extra-message" role="status"></p><form method="dialog"><button>Close</button></form>`
  document.body.append(dialog)
  const redaction=document.createElement('details');redaction.innerHTML='<summary>Redact PDF content</summary><p>Removes text, image pixels and line art within a rectangle from a new copy. Coordinates are PDF points from the top-left of the displayed page. Review the resulting copy before sharing; this does not remove matching text elsewhere or document metadata.</p><label>Page <input id="redact-page" type="number" value="1" min="1"></label><label>Rectangle: left, top, right, bottom <input id="redact-rect" placeholder="20, 20, 200, 60"></label><button id="redact-apply">Prepare redacted copy</button>';dialog.querySelector('[role=status]').before(redaction)
  const on=(id,fn)=>$(id).onclick=()=>Promise.resolve().then(fn).catch(error=>$('extra-message').textContent=error.message)
  const previewRedaction=document.createElement('button');previewRedaction.textContent='Preview redaction';const redactionCanvas=document.createElement('canvas');redactionCanvas.hidden=true;redactionCanvas.style.cssText='width:100%;height:auto;border:1px solid #ccc';$('redact-apply').before(previewRedaction,redactionCanvas)
  let redactionApproved=''
  previewRedaction.onclick=async()=>{
    try{const state=app.get(),number=Number($('redact-page').value),rect=$('redact-rect').value.split(',').map(Number)
      if(number!==state.page)throw new Error('Navigate to the selected page first, then preview it here.')
      if(rect.length!==4||!rect.every(Number.isFinite)||rect[2]<=rect[0]||rect[3]<=rect[1])throw new Error('Enter a valid rectangle.')
      const info=await(await app.request('/api/info/'+state.current.id)).json(),bounds=info.pages[number-1].bounds,source=document.getElementById('pdf-canvas')
      redactionCanvas.width=source.width;redactionCanvas.height=source.height;const ctx=redactionCanvas.getContext('2d');ctx.drawImage(source,0,0);ctx.fillStyle='rgba(0,0,0,.8)';ctx.fillRect(rect[0]/(bounds[2]-bounds[0])*source.width,rect[1]/(bounds[3]-bounds[1])*source.height,(rect[2]-rect[0])/(bounds[2]-bounds[0])*source.width,(rect[3]-rect[1])/(bounds[3]-bounds[1])*source.height);redactionCanvas.hidden=false
      redactionApproved=JSON.stringify([state.current.id,state.current.contentVersion,number,rect]);$('extra-message').textContent='Review the shaded region, then prepare the redacted copy.'
    }catch(error){$('extra-message').textContent=error.message}
  }
  const extract=document.createElement('button');extract.textContent='Extract PDF images';extract.onclick=async()=>{try{const state=app.get();if(state.current?.extension!=='pdf')throw new Error('Open a PDF first.');await app.pending();await app.download(await app.request('/api/extract-images/'+state.current.id),'Extracted images.zip')}catch(error){$('extra-message').textContent=error.message}};$('extra-info').after(extract)
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))||fallback}catch{return fallback}}
  const recent=document.createElement('section');recent.id='home-recent';recent.innerHTML='<h2>Recent documents</h2><div></div>';$('welcome').append(recent)
  let recentSignature=''
  const updateRecent=async()=>{
    if($('welcome').hidden)return
    try{
      const files=await(await app.request('/api/library')).json(),signature=JSON.stringify(files.map(f=>[f.id,f.filename,f.pinned]))
      if(signature===recentSignature)return;recentSignature=signature
      recent.querySelector('div').replaceChildren(...files.slice().sort((a,b)=>Number(b.pinned)-Number(a.pinned)).slice(0,8).map(file=>{
        const row=document.createElement('button');row.className='recent-document';row.textContent=(file.pinned?'★ ':'')+file.filename
        row.onclick=async()=>{try{await app.postJson('/api/library/'+file.id+'/open',{});app.invalidate();await app.refresh()}catch(error){app.fail(error)}};return row
      }))
      if(!files.length)recent.querySelector('div').textContent='Your opened documents will appear here.'
    }catch{}
  }
  new MutationObserver(()=>void updateRecent()).observe($('welcome'),{attributes:true,attributeFilter:['hidden']});void updateRecent()
  on('redact-apply',async()=>{const state=app.get();if(state.current?.extension!=='pdf')throw new Error('Open a PDF first.');const rect=$('redact-rect').value.split(',').map(Number);if(rect.length!==4||!rect.every(Number.isFinite))throw new Error('Enter four coordinates.');if(redactionApproved!==JSON.stringify([state.current.id,state.current.contentVersion,Number($('redact-page').value),rect]))throw new Error('Preview the current redaction before saving.');await app.pending();const response=await app.postJson('/api/redact/'+state.current.id,{page:Number($('redact-page').value),rect});await app.download(response,state.current.filename.replace(/\.pdf$/i,' - redacted.pdf'));$('extra-message').textContent='Redacted copy prepared. Open and review it before sharing.'})
  let stamps=read('elleson-stamps',[]), profile=read('elleson-profile',{})
  const stampList=()=>{$('saved-stamps').replaceChildren(new Option('Choose saved stamp',''),...stamps.map(s=>new Option(s,s)))}
  stampList(); $('saved-stamps').onchange=()=>$('stamp-value').value=$('saved-stamps').value
  on('stamp-save',()=>{const value=$('stamp-value').value.trim();if(value&&!stamps.includes(value))stamps.push(value);localStorage.setItem('elleson-stamps',JSON.stringify(stamps));stampList()})
  on('stamp-remove',()=>{stamps=stamps.filter(s=>s!==$('saved-stamps').value);localStorage.setItem('elleson-stamps',JSON.stringify(stamps));stampList()})
  function place(value) {
    if(app.get().current?.extension!=='pdf')throw new Error('Open a PDF to place this mark.')
    if(!value)throw new Error('Enter a value first.')
    dialog.close();app.placeStamp(value)
  }
  for(const [label,value] of [['Checkmark','check'],['Cross','cross'],['Circle','circle'],['Date',new Date().toLocaleDateString()],['Approved','APPROVED'],['Paid','PAID'],['Draft','DRAFT']]){
    const b=document.createElement('button');b.textContent=label;b.onclick=()=>{try{place(value)}catch(e){$('extra-message').textContent=e.message}};$('quick-stamps').append(b)
  }
  on('stamp-place',()=>place($('stamp-value').value.trim()))
  for(const key of ['Name','Address','Email','Phone']){
    const label=document.createElement('label');label.textContent=key;const input=document.createElement('input');input.id='profile-'+key;input.value=profile[key]||'';input.maxLength=200
    const b=document.createElement('button');b.textContent='Insert '+key;b.onclick=()=>{try{place(input.value)}catch(e){$('extra-message').textContent=e.message}};label.append(input,b);$('profile-inputs').append(label)
  }
  on('profile-save',()=>{profile=Object.fromEntries(['Name','Address','Email','Phone'].map(key=>[key,$('profile-'+key).value]));localStorage.setItem('elleson-profile',JSON.stringify(profile));$('extra-message').textContent='Profile saved on this device.'})
  on('profile-clear',()=>{localStorage.removeItem('elleson-profile');for(const key of ['Name','Address','Email','Phone'])$('profile-'+key).value='';$('extra-message').textContent='Profile removed.'})
  function matches() {
    const state=app.get();if(!state.current?.lines)throw new Error('Open a Word document first.')
    const find=$('replace-find').value;if(!find)throw new Error('Enter text to find.')
    const escaped=find.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), whole=$('replace-whole').checked
    const regex=new RegExp((whole?'(?<![\\p{L}\\p{N}_])':'')+escaped+(whole?'(?![\\p{L}\\p{N}_])':''),$('replace-case').checked?'gu':'giu')
    return state.current.lines.flatMap((line,index)=>line.editable===false?[]:[{index,before:line.text,count:[...line.text.matchAll(regex)].length,regex}]).filter(row=>row.count)
  }
  on('replace-preview',()=>{$('replace-count').textContent=matches().reduce((n,row)=>n+row.count,0)+' matches. Changes can be undone using Undo.'})
  async function replace(all) {
    await app.pending();const id=app.get().current?.id,rows=matches();let count=0
    for(const row of rows){if(app.get().current?.id!==id)throw new Error('The document changed.');let used=false
      const value=row.before.replace(row.regex,match=>{if(!all&&used)return match;used=true;count++;return $('replace-with').value})
      if(!await app.edit({kind:'word',index:row.index,before:row.before,value}))throw new Error('Replacement stopped. Review the latest document.')
      if(!all)break
    }
    await app.renderWord();$('replace-count').textContent=count+' replacement(s) applied.'
  }
  on('replace-first',()=>replace(false));on('replace-all',()=>replace(true))
  on('extra-decorate',async()=>{const state=app.get();if(state.current?.extension!=='pdf')throw new Error('Open a PDF first.');await app.pending();const response=await app.postJson('/api/decorate/'+state.current.id,{header:$('extra-header').value,footer:$('extra-footer').value,watermark:$('extra-watermark').value,numbers:$('extra-numbers').checked});await app.download(response,state.current.filename.replace(/\.pdf$/i,' - decorated.pdf'));$('extra-message').textContent='Decorated copy prepared.'})
  on('extra-info',async()=>{const state=app.get();if(!state.current)throw new Error('Open a document first.');const info=await(await app.request('/api/info/'+state.current.id)).json();$('extra-information').textContent=state.current.filename+'\n'+(info.bytes/1024).toFixed(1)+' KB\n'+(info.pages?info.pages.map(p=>'Page '+p.page+': '+Math.round(p.bounds[2]-p.bounds[0])+' × '+Math.round(p.bounds[3]-p.bounds[1])+' pt · '+(p.searchable?'contains text':'no searchable text')).join('\n'):'Word document')})
  if(read('elleson-dark',false))document.body.classList.add('dark-interface')
  on('extra-theme',()=>{const active=document.body.classList.toggle('dark-interface');localStorage.setItem('elleson-dark',JSON.stringify(active))})
  on('extra-focus',()=>{dialog.close();document.body.classList.add('focus-reading')})
  const exit=document.createElement('button');exit.id='exit-focus';exit.textContent='Exit focus';exit.onclick=()=>document.body.classList.remove('focus-reading');document.body.append(exit)
  on('extra-fullscreen',()=>{dialog.close();return document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()})
  document.addEventListener('keydown',event=>{if(event.key==='Escape')document.body.classList.remove('focus-reading')})
  on('extra-recovery',()=>{dialog.close();$('library').click()})
  button.onclick=()=>{ $('extra-message').textContent='';dialog.showModal() }
  const templates=document.createElement('select');templates.id='document-template';templates.setAttribute('aria-label','Document template')
  const builtins={'Blank':'','Letter':'[Your name]\n[Your address]\n[Date]\n\nDear [Recipient],\n\n[Write your letter here.]\n\nYours sincerely,\n[Your name]','Invoice':'INVOICE\nInvoice number: \nDate: \nFrom: \nBill to: \n\nDescription | Quantity | Price | Total\n\nSubtotal: \nTax: \nTotal due: \nPayment details: ','Quotation':'QUOTATION\nQuote number: \nDate: \nPrepared for: \n\nDescription | Quantity | Unit price | Total\n\nValid until: \nTerms: ','CV':'[Full name]\n[Email] | [Phone]\n\nPROFILE\n\nEXPERIENCE\n\nEDUCATION\n\nSKILLS','Meeting notes':'MEETING NOTES\nDate: \nAttendees: \n\nAGENDA\n\nDISCUSSION\n\nDECISIONS\n\nACTIONS\nOwner | Task | Due date','Form':'FORM\nName: __________________\nDate: __________________\nReference: ______________\n\nDetails:\n\nSignature: ______________'}
  let custom=read('elleson-templates',{})
  const populate=()=>templates.replaceChildren(...Object.keys({...builtins,...custom}).map(name=>new Option(name,name)))
  populate();templates.onchange=()=>$('new-text').value=({...builtins,...custom})[templates.value]||''
  $('new-form').prepend(templates)
  const saveTemplate=document.createElement('button');saveTemplate.type='button';saveTemplate.textContent='Save text as template';saveTemplate.onclick=()=>{const name=$('new-name').value.trim();if(!name)return;custom[name]=$('new-text').value;localStorage.setItem('elleson-templates',JSON.stringify(custom));populate();templates.value=name};$('new-form').append(saveTemplate)
}
