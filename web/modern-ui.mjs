export function installModernUI(){
 const paths={open:'M3 7h6l2 2h10l-3 11H3z M3 7V4h6l2 3',save:'M5 3h12l4 4v14H3V3z M7 3v6h10V3 M7 21v-8h10v8',undo:'M9 5L3 11l6 6 M3 11h11a7 7 0 0 1 7 7',redo:'M15 5l6 6-6 6 M21 11H10a7 7 0 0 0-7 7',draw:'M4 20l4-1L20 7l-4-4L4 15z M13 6l4 4',scan:'M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M4 12h16',file:'M5 3h9l5 5v13H5z M14 3v6h5',more:'M5 12h1 M11 12h1 M17 12h1',view:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0'}
 const icon=(node,key)=>{if(!node||node.querySelector('svg'))return;const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.classList.add('tool-icon');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',paths[key]);svg.append(p);node.prepend(svg)}
 for(const [id,key] of [['open','open'],['save-original','save'],['history-undo','undo'],['history-redo','redo'],['word-draw','draw'],['document-filters','scan'],['signature','draw']])icon(document.getElementById(id),key)
 for(const summary of document.querySelectorAll('.tool-menu>summary'))icon(summary,{'File':'file','More':'more','Drawing':'draw','Edit':'draw','Formatting':'file','View & pages':'view','PDF tools':'file'}[summary.textContent]||'more')
 document.body.classList.add('modern-interface')
}
