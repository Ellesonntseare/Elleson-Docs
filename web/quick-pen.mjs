export function installQuickPen(){
 const bar=document.createElement('details');bar.id='quick-pen';bar.open=true;bar.innerHTML='<summary>Pen tools</summary><div></div>';document.body.append(bar);const row=bar.querySelector('div')
 const button=(name,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=name;b.onclick=fn;row.append(b)}
 for(const id of ['ink-color','ink-width']){const source=document.getElementById(id),label=document.createElement('label'),input=source.cloneNode(true);input.removeAttribute('id');input.setAttribute('aria-label',id==='ink-color'?'Quick pen colour':'Quick pen size');label.textContent=id==='ink-color'?'Colour ':'Size ';label.append(input);row.append(label);input.oninput=()=>{source.value=input.value;source.dispatchEvent(new Event('input',{bubbles:true}))};source.addEventListener('input',()=>input.value=source.value)}
 button('Eraser',()=>{const e=document.getElementById('drawing-eraser');e.checked=!e.checked;e.dispatchEvent(new Event('input',{bubbles:true}));row.querySelector('[data-eraser]').setAttribute('aria-pressed',String(e.checked))});row.lastChild.dataset.eraser='true'
 for(const [name,id]of [['Undo','history-undo'],['Redo','history-redo'],['Lasso','suite-lasso-ink'],['Signatures','signature']])button(name,()=>document.getElementById(id)?.click())
 const update=()=>{bar.hidden=!document.querySelector('#word-sheet.word-drawing,[data-mode="pen"][aria-pressed="true"],[data-mode="highlight"][aria-pressed="true"]')}
 new MutationObserver(update).observe(document.getElementById('word-sheet'),{attributes:true,attributeFilter:['class']});new MutationObserver(update).observe(document.getElementById('pdf-tools'),{subtree:true,attributes:true,attributeFilter:['aria-pressed']});update()
}
