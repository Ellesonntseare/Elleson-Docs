export function bounds(marks) {
  const points = marks.flatMap(mark => {
    if (mark.kind !== "text") return mark.points
    const width = Math.max(mark.size, mark.value.length * mark.size * .55), angle = (mark.angle || 0) * Math.PI / 180
    return [[0, 0], [width, 0], [width, mark.size], [0, mark.size]].map(([x, y]) => [mark.at[0] + x * Math.cos(angle) - y * Math.sin(angle), mark.at[1] + x * Math.sin(angle) + y * Math.cos(angle)])
  })
  if (!points.length) throw new Error("Choose an added mark.")
  return [Math.min(...points.map(point => point[0])), Math.min(...points.map(point => point[1])), Math.max(...points.map(point => point[0])), Math.max(...points.map(point => point[1]))]
}
export function changeMarks(marks, edit) {
  const selected = marks.find(mark => mark.id === edit.target)
  if (!selected) throw new Error("This mark changed. Select it again.")
  const group = marks.filter(mark => selected.group ? mark.group === selected.group : mark.id === selected.id)
  if (edit.action === "delete") return marks.filter(mark => !group.includes(mark))
  const dx = edit.dx ?? 0, dy = edit.dy ?? 0, scale = edit.scale ?? 1, angle = edit.angle ?? 0
  if (![dx, dy, scale, angle].every(Number.isFinite) || Math.abs(dx) > 20000 || Math.abs(dy) > 20000 || scale < .1 || scale > 10 || Math.abs(angle) > 360) throw new Error("Choose a valid move, scale or rotation.")
  const box = bounds(group), cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2, rad = angle * Math.PI / 180
  const point = ([x, y]) => [cx + dx + scale * ((x - cx) * Math.cos(rad) - (y - cy) * Math.sin(rad)), cy + dy + scale * ((x - cx) * Math.sin(rad) + (y - cy) * Math.cos(rad))]
  const copies = group.map((mark, index) => ({ ...mark, ...(edit.action === "duplicate" ? { id: edit.id + "-" + index, group: group.length > 1 ? edit.id : undefined } : {}),
    ...(mark.kind === "text" ? { at: point(mark.at), size: Math.max(4, Math.min(192, mark.size * scale)), angle: (mark.angle || 0) + angle,
      ...(typeof edit.value === "string" && edit.value.length <= 400 ? { value: edit.value } : {}) } : { points: mark.points.map(point), width: Math.max(.25, Math.min(30, (mark.width || 1.7) * scale)) }) }))
  if (edit.action === "duplicate") return [...marks, ...copies]
  return marks.map(mark => group.includes(mark) ? copies[group.indexOf(mark)] : mark)
}
