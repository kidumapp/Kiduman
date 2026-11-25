import {api, plain, read, text, write} from './data.mjs?v=4'

const normalized = ref => String(ref || '').trim().replace(/_/g,' ').replace(/\s+/g,' ')

function linkedText(value) {
  if (typeof value === 'string') return plain(value)
  return Array.isArray(value) ? value.map(linkedText).filter(Boolean).join('\n') : ''
}

export async function commentaries(refs, rows) {
  const replies = await Promise.all(refs.map(async ref => {
    const key = 'commentary-links:' + ref
    const existing = await read(key)
    if (existing) return existing
    const related = await api('links/' + encodeURIComponent(ref) + '?with_text=1')
    if (!Array.isArray(related)) throw new Error('ספריא לא החזירה רשימת פירושים.')
    const links = related.filter(item => ['Commentary','Targum'].includes(item.category) || item.type === 'commentary')
      .map(item => ({
        ref:item.ref, anchor:normalized(item.anchorRef), title:item.collectiveTitle?.he || item.index_title || item.ref,
        order:Number(item.commentaryNum ?? 0), text:linkedText(item.he)
      }))
      .filter(item => item.ref && item.anchor && item.text)
    await write(key,links)
    return links
  }))
  const byTitle = new Map()
  const sourceIndexes = new Map(rows.map((row,index) => [normalized(row.sourceRef),index]))
  const seen = new Set()
  for (const item of replies.flat()) {
    const index = sourceIndexes.get(item.anchor)
    if (index === undefined || seen.has(item.ref + '|' + index)) continue
    seen.add(item.ref + '|' + index)
    if (!byTitle.has(item.title)) byTitle.set(item.title,new Map())
    const byRow = byTitle.get(item.title)
    if (!byRow.has(index)) byRow.set(index,[])
    byRow.get(index).push(item)
  }
  for (const byRow of byTitle.values()) for (const links of byRow.values())
    links.sort((a,b) => a.order - b.order || a.ref.localeCompare(b.ref,'en',{numeric:true}))
  return byTitle
}

export function torahReferences(refs) {
  return refs.length > 0 && refs.every(ref => /^(Genesis|Exodus|Leviticus|Numbers|Deuteronomy)\s+\d/i.test(ref))
}

export async function onkelos(refs, rows) {
  const translations = new Map()
  for (const ref of refs) {
    const passage = await text('Onkelos ' + ref)
    for (const row of passage.rows) {
      if (row.address) translations.set(normalized(row.sourceRef.replace(/^Onkelos\s+/i,'')),row.text)
    }
  }
  const aligned = new Map()
  rows.forEach((row,index) => {
    const value = translations.get(normalized(row.sourceRef))
    if (value) aligned.set(index,value)
  })
  if (aligned.size !== rows.length) {
    throw new Error('תרגום אונקלוס לא נטען לכל פסוק בקטע הזה.')
  }
  return aligned
}

export function passageRefs(entry) {
  if (entry.type === 'personal' || entry.type === 'prayer') return []
  return (entry.sourceRefs || [entry.canonical || entry.ref]).filter(Boolean)
}
