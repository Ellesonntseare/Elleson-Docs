// Keep one preview request in flight; slow Wi-Fi must not build a stale ink queue.
export function createInkStream(request) {
  let latest, sending=false, timer
  async function send() {
    timer=undefined
    if(sending||!latest)return
    const next=latest;latest=undefined;sending=true
    try {await request('/api/preview/'+next.document,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next.mark)})} catch {} finally {
      sending=false
      if(latest&&!timer)timer=setTimeout(send,0)
    }
  }
  return (document,mark)=>{
    latest={document,mark}
    if(!sending&&!timer)timer=setTimeout(send,16)
  }
}

// Authenticated fetch streaming keeps credentials out of URLs and works in WebView.
// The ordinary state poll remains available when streaming is unavailable.
export function installLiveInk({request,enabled,receive}) {
  let controller, stopped=false
  async function connect() {
    if(stopped)return
    if(!enabled()){setTimeout(connect,1000);return}
    controller=new AbortController()
    try {
      const response=await request('/api/live',{signal:controller.signal})
      const reader=response.body.getReader(),decoder=new TextDecoder()
      let buffer=''
      while(!stopped){
        const {done,value}=await reader.read();if(done)break
        buffer+=decoder.decode(value,{stream:true})
        let end
        while((end=buffer.indexOf('\n\n'))>=0){
          const message=buffer.slice(0,end);buffer=buffer.slice(end+2)
          if(message.startsWith('data: '))receive(JSON.parse(message.slice(6)))
        }
      }
    } catch {} finally {if(!stopped)setTimeout(connect,1000)}
  }
  window.addEventListener('pagehide',()=>{stopped=true;controller?.abort()})
  void connect()
}
