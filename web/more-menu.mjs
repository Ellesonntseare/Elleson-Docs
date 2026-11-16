export function restyleMoreMenu(){
 const menu=document.querySelector('.mobile-more-sheet'),panel=menu?.querySelector('.tool-menu-panel')
 if(!panel)return
 panel.classList.add('grouped-more-panel')
 const heading=panel.querySelector('.mobile-sheet-heading'),connection=panel.querySelector('.mobile-sync-card')
 const close=heading?.querySelector('button');if(close){close.textContent='×';close.setAttribute('aria-label','Close');close.classList.add('more-close')}
 const groups=new Map()
 for(const title of ['Device & Connection','Document & Editing','Viewing & Reading','System']){
  const section=document.createElement('section');section.className='more-group';const h=document.createElement('h3');h.textContent=title;const actions=document.createElement('div');actions.className='more-group-actions';section.append(h,actions);groups.set(title,{section,actions})
 }
 if(connection)groups.get('Device & Connection').section.querySelector('h3').after(connection)
 const buttons=[...panel.querySelectorAll('button')].filter(b=>b!==close)
 for(const b of buttons){
  const text=b.textContent.trim(),name=/connect phone|continue on phone|use on phone|phone companion/i.test(text)?'Device & Connection':/side by side|focus reading|find in document|scan filters/i.test(text)?'Viewing & Reading':/check for updates|recovery history/i.test(text)?'System':'Document & Editing'
  groups.get(name).actions.append(b)
 }
 panel.replaceChildren(...(heading?[heading]:[]),...[...groups.values()].map(g=>g.section))
}
