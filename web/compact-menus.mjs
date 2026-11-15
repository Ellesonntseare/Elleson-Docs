export function installCompactMenus() {
  document.body.classList.add('compact-menus')
  const menus = []
  function menu(label, parent, nodes) {
    const details = document.createElement('details'); details.className = 'tool-menu'
    const summary = document.createElement('summary'); summary.textContent = label
    const panel = document.createElement('div'); panel.className = 'tool-menu-panel actions'
    details.append(summary, panel); parent.append(details)
    for (const node of nodes) if (node) panel.append(node)
    panel.addEventListener('click', event => {
      const button = event.target.closest('button')
      if (!button || button.closest('#word-ribbon, .mobile-ink-actions') || details.classList.contains('mobile-drawing-sheet')) return
      if (button.closest('#page-tools') && ['prev','next','zoom-in','zoom-out','fit'].includes(button.id)) return
      details.open = false
    })
    details.addEventListener('toggle', () => { if (details.open) for (const other of menus) if (other !== details) other.open = false })
    menus.push(details); return details
  }
  const byId = id => document.getElementById(id)
  const header = document.querySelector('.app-header > .actions')
  menu('File', header, ['new-document','library','convert-files','save','save-as','share-as','rename-document','print','scan','flatten-copy'].map(id => {const n=byId(id); return n?.closest('label') || n}))
  header.prepend(byId('open'), byId('save-original'))
  menu('More', header, [byId('history-actions'),byId('connect'),byId('handoff')]);header.append(byId('history-undo'),byId('history-redo'))
  byId('more-actions').hidden = true
  const toolbar = byId('toolbar')
  menu('Drawing', toolbar, [byId('ink-color')?.closest('label'),byId('ink-width')?.closest('label')])
  for(const id of ['ink-color','ink-width']) {
    const control=byId(id)
    try { const saved=localStorage.getItem('elleson-'+id);if(saved)control.value=saved } catch {}
    control.addEventListener('input',()=>{try{localStorage.setItem('elleson-'+id,control.value)}catch{}})
  }
  byId('tool-groups').hidden = true
  for (const [id, label] of [['pdf-tools','PDF tools'],['word-tools','Edit'],['word-ribbon','Formatting'],['page-tools','View & pages']]) {
    const content = byId(id)
    if (!content) continue
    const wrapper = menu(label, toolbar, [content])
    const sync = () => { wrapper.hidden = content.hidden }
    new MutationObserver(sync).observe(content, {attributes:true,attributeFilter:['hidden']}); sync()
  }
  // Finishing a drawing must remain reachable when its menu is collapsed.
  toolbar.append(byId('drawing-done'))
  document.addEventListener('pointerdown', event => {
    for (const menu of menus) {
      const drawingOnPage=menu.classList.contains('mobile-drawing-sheet') && event.target.closest('#stage')
      const fileTitle=menu.classList.contains('mobile-file-sheet')&&event.target.closest('#file-title')
      if (!drawingOnPage && !fileTitle && !menu.contains(event.target)) menu.open = false
    }
  })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') for (const menu of menus) if (menu.open) {menu.open=false;menu.querySelector('summary').focus()}
  })
}
