export function parsePageSelection(text,total){
 const pages=new Set()
 if(!text.trim())throw Error('Enter page numbers, for example 1, 3-5.')
 for(const part of text.split(',')){
  const match=/^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part)
  if(!match)throw Error('Use page numbers and ranges, for example 1, 3-5.')
  const a=Number(match[1]),b=Number(match[2]||match[1]);if(a<1||b<a||b>total)throw Error('Choose pages between 1 and '+total+'.')
  for(let n=a;n<=b;n++)pages.add(n)
 }
 return [...pages].sort((a,b)=>a-b)
}
