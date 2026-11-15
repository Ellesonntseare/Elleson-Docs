export function installWordRibbon(app) {
  const tools=document.getElementById('word-tools'), ribbon=document.createElement('div');ribbon.id='word-ribbon'
  ribbon.innerHTML='<nav aria-label="Word tabs"><button data-tab="home">Home</button><button data-tab="insert">Insert</button><button data-tab="layout">Layout</button><button data-tab="review">Review</button><button data-tab="view">View</button></nav><div id="word-ribbon-controls" class="actions"></div><p id="word-ribbon-status" role="status"></p>'
  tools.after(ribbon)
  const controls=ribbon.querySelector('#word-ribbon-controls'),status=ribbon.querySelector('p')
  const act=async format=>{
    await app.pending();const state=app.get();if(state.selectedWordIndex===null)throw new Error('Select a paragraph or words first.')
    const selection=app.selection?.()
    const paragraphFormat=Object.keys(format).some(key=>['align','list','spacing'].includes(key))
    const change=!paragraphFormat&&selection?.document===state.current.id&&selection.version===state.current.contentVersion&&selection.end>selection.start ? {kind:'word-tools',action:'range',index:selection.index,start:selection.start,end:selection.end,format} : {kind:'word-format',index:state.selectedWordIndex,format}
    await app.edit({...change,version:state.current.contentVersion});await app.renderWord()
  }
  const safely=fn=>()=>Promise.resolve().then(fn).catch(error=>status.textContent=error.message)
  function control(label,fn){const b=document.createElement('button');b.textContent=label;b.onpointerdown=e=>e.preventDefault();b.onclick=safely(fn);controls.append(b)}
  function select(label,values,fn){const input=document.createElement('select');input.setAttribute('aria-label',label);input.append(new Option(label,''),...values.map(([text,value])=>new Option(text,value)));input.onchange=safely(()=>{const v=input.value;if(v)return fn(v)});controls.append(input)}
  function tab(name){
    controls.replaceChildren();status.textContent=''
    for(const b of ribbon.querySelectorAll('[data-tab]'))b.setAttribute('aria-pressed',b.dataset.tab===name)
    if(name==='home'){
      select('Font',[['Arial','Arial'],['Calibri','Calibri'],['Georgia','Georgia'],['Times New Roman','Times New Roman']],font=>act({font}))
      select('Text size',[8,10,11,12,14,16,18,24,36,48].map(n=>[n,n]),size=>act({size:Number(size)}))
      for(const [label,key] of [['Bold','bold'],['Italic','italic'],['Underline','underline']])control(label,()=>act({[key]:true}))
      control('Clear emphasis',()=>act({bold:false,italic:false,underline:false}))
      const color=document.createElement('input');color.type='color';color.setAttribute('aria-label','Text colour');color.onchange=safely(()=>act({color:color.value}));controls.append(color)
      select('Alignment',[['Left','left'],['Centre','center'],['Right','right'],['Justify','both']],align=>act({align}))
      select('List style',[['Bullets','bullet'],['Numbers','decimal'],['No list','none']],list=>act({list}))
    } else if(name==='insert'){
      for(const [label,id] of [['Table','insert-table'],['Picture','insert-image'],['Paragraphs and page breaks','word-more']])control(label,()=>document.getElementById(id).click())
    } else if(name==='layout'){
      select('Line spacing',[1,1.15,1.5,2,2.5,3].map(n=>[n,n]),spacing=>act({spacing:Number(spacing)}))
      control('Headers and footers',()=>document.getElementById('word-more').click())
    } else if(name==='review')control('Find and replace',()=>document.getElementById('document-extras').click())
    else {control('Read',()=>app.setMode('read'));control('Edit',()=>app.setMode('word'));control('Viewing options',()=>document.getElementById('document-extras').click())}
  }
  ribbon.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));tab('home')
  const update=()=>{ribbon.hidden=tools.hidden};new MutationObserver(update).observe(tools,{attributes:true,attributeFilter:['hidden']});update()
}
