// Session-only, bounded cache. Keys include the host document ID and content
// version; edits and recovery versions can never reuse an older source.
export function createDocumentCache(maxBytes=48*1024*1024,maxEntries=6){
 const entries=new Map(),pending=new Map();let bytes=0
 const touch=key=>{const entry=entries.get(key);if(entry){entries.delete(key);entries.set(key,entry)}return entry?.value}
 function put(key,value,size){
  const old=entries.get(key);if(old){bytes-=old.size;entries.delete(key)}
  if(size>maxBytes)return value
  entries.set(key,{value,size});bytes+=size
  while(bytes>maxBytes||entries.size>maxEntries){const [id,entry]=entries.entries().next().value;entries.delete(id);bytes-=entry.size}
  return value
 }
 return {get:touch,put,async load(key,loader,size=value=>value.byteLength){
  const cached=touch(key);if(cached!==undefined)return cached
  if(pending.has(key))return pending.get(key)
  const promise=Promise.resolve().then(loader).then(value=>put(key,value,size(value))).finally(()=>pending.delete(key))
  pending.set(key,promise);return promise
 },clear(){entries.clear();bytes=0},get bytes(){return bytes}}
}
