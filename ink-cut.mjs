export function applyInkCut(marks,edit){
 if(!Number.isInteger(edit.page)||!Array.isArray(edit.items)||!edit.items.length||edit.items.length>200||new Set(edit.items.map(i=>i.target)).size!==edit.items.length)throw Error('Select valid ink to erase.')
 const replacements=new Map()
 for(const [index,item] of edit.items.entries()){
  const mark=marks.find(m=>m.id===item.target&&m.kind==='ink'&&m.page===edit.page)
  if(!mark||JSON.stringify(mark.points)!==JSON.stringify(item.before))throw Error('The drawing changed. Try erasing it again.')
  if(!Array.isArray(item.fragments)||item.fragments.length>500||item.fragments.reduce((n,p)=>n+p.length,0)>20000||!item.fragments.every(p=>Array.isArray(p)&&p.length&&p.every(q=>Array.isArray(q)&&q.length===2&&q.every(v=>Number.isFinite(v)&&Math.abs(v)<200000))))throw Error('The erased drawing is invalid.')
  replacements.set(mark.id,item.fragments.map((points,i)=>({...mark,id:edit.id+'-'+index+'-'+i,points})))
 }
 const result=marks.flatMap(m=>replacements.get(m.id)||[m]);if(result.length>4000)throw Error('Save a copy before adding more strokes.');return result
}
