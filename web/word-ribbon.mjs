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
  const structure = document.createElement("dialog")
  structure.className = "document-suite"
  document.body.append(structure)
  const close = () => structure.close()
  function structureButton(label, run) {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = label
    button.onclick = async () => { try { await run() } catch (error) { structure.querySelector("[role=status]").textContent = error.message } }
    return button
  }
  function structurePanel(title) {
    const heading = document.createElement("h2")
    heading.textContent = title
    const feedback = document.createElement("p")
    feedback.setAttribute("role", "status")
    structure.replaceChildren(heading, feedback)
    if (!structure.open) structure.showModal()
    return feedback
  }
  async function structureAction(action, values, target = app.get()) {
    if (!Number.isInteger(target.selectedWordIndex)) throw new Error("Select a paragraph first.")
    await app.pending()
    const current = app.get().current
    if (current?.id !== target.current.id || current.structureVersion !== target.current.structureVersion) throw new Error("The document changed. Select the paragraph again.")
    if (await app.edit({ kind: "word-tools", action, index: target.selectedWordIndex, version: current.contentVersion, ...values })) {
      close()
      await app.renderWord()
    }
  }
  function askStructure(title, action, markup, values) {
    const target = app.get()
    if (!Number.isInteger(target.selectedWordIndex)) throw new Error("Select a paragraph first.")
    const feedback = structurePanel(title)
    const form = document.createElement("form")
    form.innerHTML = markup + '<button class="primary">Apply</button>'
    form.onsubmit = async event => {
      event.preventDefault()
      event.submitter.disabled = true
      try { await structureAction(action, values(new FormData(form)), target) }
      catch (error) { feedback.textContent = error.message }
      finally { event.submitter.disabled = false }
    }
    structure.append(form, structureButton("Close", close))
  }
  async function showStyles() {
    const state = app.get()
    if (!Number.isInteger(state.selectedWordIndex)) throw new Error("Select a paragraph first.")
    await app.pending()
    if (app.get().current?.id !== state.current.id) throw new Error("The active document changed.")
    const source = app.get().current
    const styles = await (await app.request("/api/word-styles/" + source.id)).json()
    structurePanel("Paragraph styles")
    const picker = document.createElement("select")
    picker.setAttribute("aria-label", "Paragraph style")
    picker.replaceChildren(...styles.map(style => new Option(style.name || style.id, style.id)))
    picker.value = source.lines[state.selectedWordIndex]?.style || "Normal"
    structure.append(picker, structureButton("Apply style", async () => {
      if (app.get().current?.id !== source.id) throw new Error("The active document changed.")
      if (await app.edit({ kind: "word-tools", action: "paragraph-style", style: picker.value, index: state.selectedWordIndex, version: source.contentVersion })) {
        close()
        await app.renderWord()
      }
    }), structureButton("Close", close))
  }
  async function showOutline() {
    const source = app.get().current
    const styles = await (await app.request("/api/word-styles/" + source.id)).json()
    const levels = new Map(styles.filter(style => style.level !== null && style.level !== undefined).map(style => [style.id, Number(style.level)]))
    const feedback = structurePanel("Document outline")
    const list = document.createElement("ol")
    source.lines.forEach((line, index) => {
      if (!levels.has(line.style) || !line.text.trim()) return
      const item = document.createElement("li")
      item.style.marginInlineStart = (Math.min(8, levels.get(line.style)) * 10) + "px"
      item.append(structureButton(line.text.slice(0, 120), () => {
        if (app.get().current?.id !== source.id) throw new Error("The active document changed.")
        close()
        document.querySelector('#word-sheet [data-word-source-index="' + index + '"]')?.scrollIntoView({ block: "start" })
      }))
      list.append(item)
    })
    if (!list.children.length) feedback.textContent = "Apply heading styles to show them here."
    structure.append(list, structureButton("Close", close))
  }
  function control(label,fn){const b=document.createElement('button');b.textContent=label;b.onpointerdown=e=>e.preventDefault();b.onclick=safely(fn);controls.append(b)}
  function select(label,values,fn){const input=document.createElement('select');input.setAttribute('aria-label',label);input.append(new Option(label,''),...values.map(([text,value])=>new Option(text,value)));input.onchange=safely(()=>{const v=input.value;if(v)return fn(v)});controls.append(input)}
  function tab(name){
    controls.replaceChildren();status.textContent=''
    for(const b of ribbon.querySelectorAll('[data-tab]'))b.setAttribute('aria-pressed',b.dataset.tab===name)
    if(name==='home'){
      control("Paragraph styles", showStyles)
      select('Font',[['Arial','Arial'],['Calibri','Calibri'],['Georgia','Georgia'],['Times New Roman','Times New Roman']],font=>act({font}))
      select('Text size',[8,10,11,12,14,16,18,24,36,48].map(n=>[n,n]),size=>act({size:Number(size)}))
      for(const [label,key] of [['Bold','bold'],['Italic','italic'],['Underline','underline']])control(label,()=>act({[key]:true}))
      control('Clear emphasis',()=>act({bold:false,italic:false,underline:false}))
      const color=document.createElement('input');color.type='color';color.setAttribute('aria-label','Text colour');color.onchange=safely(()=>act({color:color.value}));controls.append(color)
      select('Alignment',[['Left','left'],['Centre','center'],['Right','right'],['Justify','both']],align=>act({align}))
      select('List style',[['Bullets','bullet'],['Numbers','decimal'],['No list','none']],list=>act({list}))
    } else if(name==='insert'){
      for(const [label,id] of [['Table','insert-table'],['Picture','insert-image'],['Paragraphs and page breaks','word-more']])control(label,()=>document.getElementById(id).click())
      control("Hyperlink", () => askStructure("Append a hyperlink to this paragraph", "hyperlink",
        '<label>Link text <input name="label" maxlength="250" required></label><label>Web URL <input name="url" type="url" maxlength="2048" required></label>',
        data => Object.fromEntries(data)))
      control("Footnote", () => askStructure("Add a footnote to this paragraph", "footnote",
        '<label>Footnote text <textarea name="text" maxlength="2000" required></textarea></label>', data => Object.fromEntries(data)))
      control("Insert contents list", () => structureAction("table-of-contents", {}))
    } else if(name==='layout'){
      select('Line spacing',[1,1.15,1.5,2,2.5,3].map(n=>[n,n]),spacing=>act({spacing:Number(spacing)}))
      control('Headers and footers',()=>document.getElementById('word-more').click())
      control("Section page setup", () => askStructure("Page setup for this section", "section-settings",
        '<label>Paper size <select name="size"><option value="a4">A4</option><option value="letter">Letter</option></select></label><label>Orientation <select name="orientation"><option>portrait</option><option>landscape</option></select></label><label>Margins (mm) <input name="margin" type="number" min="8" max="50" value="25" required></label>',
        data => ({ ...Object.fromEntries(data), margin: Number(data.get("margin")) })))
      control("Merge with next table cell", () => structureAction("merge-next-cell", {}))
    } else if(name==='review')control('Find and replace',()=>document.getElementById('document-extras').click())
    else {control("Document outline", showOutline);control('Read',()=>app.setMode('read'));control('Edit',()=>app.setMode('word'));control('Viewing options',()=>document.getElementById('document-extras').click())}
  }
  ribbon.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));tab('home')
  const update=()=>{ribbon.hidden=tools.hidden};new MutationObserver(update).observe(tools,{attributes:true,attributeFilter:['hidden']});update()
}
