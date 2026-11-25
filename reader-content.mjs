import {api, read, text, write} from './data.mjs?v=4'

const normalized = ref => String(ref || '').trim().replace(/_/g,' ').replace(/\s+/g,' ')
  .replace(/(\d[ab]?)\.(?=\d)/g,'$1:')

export async function commentaries(refs, rows) {
  const replies = await Promise.all(refs.map(async ref => {
    const key = 'commentary-index:' + ref
    const existing = await read(key)
    if (existing) return existing
    const query = new URLSearchParams({with_text:'0',categories:'Commentary|Targum|Quoting Commentary'})
    const related = await api('links/' + encodeURIComponent(ref) + '?' + query)
    if (!Array.isArray(related)) throw new Error('ספריא לא החזירה רשימת פירושים.')
    const links = related.map(item => ({
      ref:normalized(item.sourceRef || item.ref), anchor:normalized(item.anchorRef),
      title:item.collectiveTitle?.he || item.heCommentator || item.index_title || item.ref,
      order:Number(item.commentaryNum ?? 0)
    })).filter(item => item.ref && item.anchor)
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

async function commentaryText(links) {
  const groups = new Map()
  for (const ref of new Set(links.map(item => item.ref))) {
    const group = ref.match(/^(.*\s)(\d+[ab]?(?::\d+)*):\d+$/)?.slice(1,3).join('') || ref
    if (!groups.has(group)) groups.set(group,[])
    groups.get(group).push(ref)
  }
  const values = new Map()
  const pending = [...groups]
  for (let i = 0; i < pending.length; i += 4) {
    const passages = await Promise.allSettled(pending.slice(i,i+4).map(async ([group,refs]) => ({
      refs, rows:(await text(group)).rows
    })))
    for (const result of passages) {
      if (result.status !== 'fulfilled') continue
      const {refs,rows} = result.value
      const wanted = new Set(refs)
      for (const row of rows) {
        const key = normalized(row.sourceRef)
        if (wanted.has(key)) values.set(key,row.text)
      }
      for (const ref of refs) {
        if (values.has(ref)) continue
        const prefix = ref + ':'
        const nested = rows.filter(row => normalized(row.sourceRef).startsWith(prefix))
        if (nested.length) values.set(ref,nested.map(row => row.text).join('\n'))
      }
    }
  }
  return values
}

export async function selectCommentaries(available, selection) {
  const all = [...selection].flatMap(name => [...(available.get(name)?.values() || [])].flat())
  const values = await commentaryText(all)
  const result = new Map()
  for (const name of selection) {
    for (const [index,comments] of available.get(name) || []) {
      const lines = result.get(index) || []
      for (const item of comments) if (values.has(item.ref)) lines.push([name,values.get(item.ref)])
      if (lines.length) result.set(index,lines)
    }
  }
  return result
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
