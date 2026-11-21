export function installWorkState({get,mode}){
 const stage=document.getElementById('stage'),badge=document.createElement('button'),saved=document.createElement('button')
 badge.id='writing-mode-badge';badge.type='button';badge.title='Change writing tools'
 saved.id='save-status-badge';saved.type='button';saved.title='Show save details'
 document.body.append(badge,saved)
 const details=document.createElement('dialog');details.id='save-details';details.innerHTML='<h2>Save status</h2><p role="status"></p><p>Synced means the PC has stored a recovery copy. Save writes your changes to the document file.</p><div class="actions"><button data-save>Save file</button><button data-pending>Review pending edits</button><button data-close>Close</button></div>';document.body.append(details)
 badge.onclick=()=>document.getElementById('drawing-workspace').showModal()
 saved.onclick=()=>{details.querySelector('[role=status]').textContent=saved.textContent+'. '+document.getElementById('save-state').textContent;details.showModal()}
 details.querySelector('[data-close]').onclick=()=>details.close()
 details.querySelector('[data-save]').onclick=()=>{details.close();document.getElementById('save-original').click()}
 details.querySelector('[data-pending]').onclick=()=>{details.close();document.getElementById('review-pending-edits').click()}
 function update(){
  const doc=get(),word=document.getElementById('word-sheet').classList.contains('word-drawing'),erase=document.getElementById('drawing-eraser')?.checked
  badge.hidden=saved.hidden=!doc
  const active=doc?.lines?(word?'pen':'word'):mode()
  const names={pen:'Draw / Sign',highlight:'Highlight',erase:'Erase',read:'Move / Read',edit:'Edit text',word:'Edit text',text:'Add text',select:'Select drawing',signature:'Place signature',review:'Review'}
  badge.textContent=(erase&&(word||active==='pen')?'Erase':names[active]||'Document')+((active==='pen'||word)&&!erase?' · '+document.getElementById('ink-width').value:'')
  badge.dataset.writing=String(word||['pen','highlight','signature'].includes(active));badge.setAttribute('aria-label','Writing tools');badge.setAttribute('aria-description','Current tool: '+badge.textContent)
  const inkPending=document.getElementById('word-sheet').dataset.pendingInk==='true';const text=document.getElementById('save-state').textContent;saved.textContent=inkPending?'Drawing retained · pending sync':text.includes('waiting')?'Saved here · pending sync':text.includes('unavailable')?'Save needs attention':text.includes('unsaved')?(location.hostname==='appassets.androidplatform.net'?'Saved on phone':'Synced · file not saved'):text || 'File saved'
  saved.dataset.pending=String(inkPending||text.includes('waiting')||text.includes('unavailable'))
 }
 new MutationObserver(update).observe(document.getElementById('save-state'),{childList:true,characterData:true,subtree:true})
 new MutationObserver(update).observe(document.getElementById('pdf-sheet'),{attributes:true,attributeFilter:['data-mode']})
 new MutationObserver(update).observe(document.getElementById('word-sheet'),{attributes:true,attributeFilter:['class','data-pending-ink']})
 document.addEventListener('input',event=>{if(['ink-width','drawing-eraser'].includes(event.target.id))update()})
 update()
}
