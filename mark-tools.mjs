export function bounds(marks) {
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity
  for(const mark of marks){
    let points=mark.points
    if(mark.kind==='text'){
      const width=Math.max(mark.size,mark.value.length*mark.size*.55),angle=(mark.angle||0)*Math.PI/180
      points=[[0,0],[width,0],[width,mark.size],[0,mark.size]].map(([x,y])=>[mark.at[0]+x*Math.cos(angle)-y*Math.sin(angle),mark.at[1]+x*Math.sin(angle)+y*Math.cos(angle)])
    }
    for(const [x,y] of points){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y)}
  }
  if(left===Infinity)throw Error('Choose an added mark.')
  return [left,top,right,bottom]
}
export function changeMarks(marks, edit) {
  if (!["apply", "duplicate", "delete"].includes(edit.action)) throw new Error("Choose a drawing action.")
  const targets = edit.targets || [edit.target]
  if (!Array.isArray(targets) || !targets.length || targets.length > 4000 || targets.some(id => typeof id !== "string" || !marks.some(mark => mark.id === id))) throw new Error("Select the drawings again.")
  const selected = marks.find(mark => mark.id === targets[0])
  if (!selected) throw new Error("This mark changed. Select it again.")
  const groups = new Set(marks.filter(mark => targets.includes(mark.id)).map(mark => mark.group).filter(Boolean))
  const group = marks.filter(mark => targets.includes(mark.id) || groups.has(mark.group))
  if (new Set(group.map(mark => mark.page)).size > 1) throw new Error("Select drawings on one page.")
  if (edit.color !== undefined && !/^#[a-f0-9]{6}$/i.test(edit.color)) throw new Error("Choose a valid colour.")
  if (edit.width !== undefined && (!Number.isFinite(edit.width) || edit.width < .25 || edit.width > 30)) throw new Error("Choose a pen size between 0.25 and 30.")
  if (edit.action === "delete") return marks.filter(mark => !group.includes(mark))
  const dx = edit.dx ?? 0, dy = edit.dy ?? 0, scale = edit.scale ?? 1, angle = edit.angle ?? 0
  if (![dx, dy, scale, angle].every(Number.isFinite) || Math.abs(dx) > 20000 || Math.abs(dy) > 20000 || scale < .1 || scale > 10 || Math.abs(angle) > 360) throw new Error("Choose a valid move, scale or rotation.")
  const box = bounds(group), cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2, rad = angle * Math.PI / 180
  const point = ([x, y]) => [cx + dx + scale * ((x - cx) * Math.cos(rad) - (y - cy) * Math.sin(rad)), cy + dy + scale * ((x - cx) * Math.sin(rad) + (y - cy) * Math.cos(rad))]
  const copies = group.map((mark, index) => ({ ...mark, ...(edit.color ? {color:edit.color} : {}), ...(edit.action === "duplicate" ? { id: edit.id + "-" + index, group: group.length > 1 ? edit.id : undefined } : {}),
    ...(mark.kind === "text" ? { at: point(mark.at), size: Math.max(4, Math.min(192, mark.size * scale)), angle: (mark.angle || 0) + angle,
      ...(typeof edit.value === "string" && edit.value.length <= 400 ? { value: edit.value } : {}) } : { points: mark.points.map(point), width: Math.max(.25, Math.min(30, (edit.width ?? mark.width ?? 1.7) * scale)) }) }))
  if (edit.action === "duplicate") { if (marks.length + copies.length > 4000) throw new Error("Too many drawings. Save a copy to continue."); return [...marks, ...copies] }
  return marks.map(mark => group.includes(mark) ? copies[group.indexOf(mark)] : mark)
}
