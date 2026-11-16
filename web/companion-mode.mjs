export function installCompanion(app,hub,drawing){
 const $=id=>document.getElementById(id),panel=document.createElement('dialog');panel.id='companion-workspace';panel.className='document-suite';panel.innerHTML='<h2>Phone companion</h2><p>Connect your phone to this PC over Wi-Fi, then choose how you want to work. Drawing and navigation use the same shared document.</p><p role="status"></p><div class="suite-actions" data-modes></div><button data-close>Close</button>';document.body.append(panel)
 const bar=document.createElement('nav');bar.id='companion-bar';bar.setAttribute('aria-label','Phone companion controls');bar.hidden=true;document.body.append(bar)
 const label=document.createElement('span');bar.append(label)
 bar.title='One finger writes / two fingers move and zoom'
 function closeMenus(){for(const menu of document.querySelectorAll('.tool-menu'))menu.open=false}
 async function choose(mode){
  if(mode!=='scan'&&!app.get())throw Error('Open a shared document first.')
  drawing.stop();closeMenus();panel.close();document.body.classList.add('phone-companion');bar.hidden=false;sessionStorage.setItem('elleson-companion-mode',mode);label.textContent=mode==='draw'?'Pen pad':mode==='sign'?'Sign document':mode==='scan'?'Scanner':'Document'
  for(const control of bar.querySelectorAll('[data-companion-mode]'))control.setAttribute('aria-pressed',String(control.dataset.companionMode===mode))
  if(mode==='draw'||mode==='sign'){
   if(app.get().extension==='pdf')app.setMode('pen')
   else if($('word-draw').getAttribute('aria-pressed')!=='true')$('word-draw').click()
   app.status('Write with one finger or a pen. Use two fingers to move and zoom, then continue writing.')
  }else if(mode==='scan')$('scan').click()
  else{if(app.get()?.lines&&$('word-draw').getAttribute('aria-pressed')==='true')$('word-draw').click();app.setMode('read')}
 }
 for(const [mode,name]of [['document','Document'],['draw','Pen pad'],['sign','Sign on page'],['scan','Scanner']]){hub.button(name,()=>choose(mode),panel.querySelector('[data-modes]'));hub.button(name,()=>choose(mode),bar).dataset.companionMode=mode}
 hub.button('Undo',()=>$('history-undo').click(),bar)
 hub.button('Drawing settings',()=>$('drawing-workspace').showModal(),bar)
 hub.button('Exit companion',()=>{drawing.stop();if(app.get()?.lines&&$('word-draw').getAttribute('aria-pressed')==='true')$('word-draw').click();document.body.classList.remove('phone-companion');bar.hidden=true;sessionStorage.removeItem('elleson-companion-mode');app.setMode('read')},bar)
 panel.querySelector('[data-close]').onclick=()=>panel.close()
 hub.button('Phone companion',()=>{panel.querySelector('[role=status]').textContent=$('connection').textContent;panel.showModal()},hub.tools).id='suite-companion'
}
