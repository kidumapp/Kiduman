import {api, read, text, write} from './data.mjs?v=5'

const norm = value=>String(value||'').trim().replace(/_/g,' ').replace(/\s+/g,' ')

export async function prayerLinks(ref) {
  const key = 'siddur-sources-v1:'+ref
  const cached = await read(key)
  if (cached) return cached
  const links = await api('links/'+encodeURIComponent(ref)+'?with_text=0')
  if (!Array.isArray(links)) throw new Error('ספריא לא החזירה מקורות לקטע הזה.')
  const result = links.filter(item=>item.category!=='Liturgy' && item.sourceRef && item.anchorRef)
    .map(item=>({anchor:norm(item.anchorRef),ref:norm(item.sourceRef),
      name:item.sourceHeRef || item.heTitle || item.sourceRef,category:item.category,type:item.type}))
  await write(key,result)
  return result
}

export function sourcesForRow(links, row) {
  const seen = new Set()
  return links.filter(link=>{
    if (link.anchor!==norm(row.sourceRef) || seen.has(link.ref)) return false
    seen.add(link.ref)
    return true
  }).sort((left,right)=>Number(right.category==='Tanakh')-Number(left.category==='Tanakh'))
}

const words = value=>[...value.matchAll(/[\u05d0-\u05ea][\u05d0-\u05ea\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7]*/gu)]
const letters = value=>value.replace(/[^\u05d0-\u05ea]/gu,'')
const cantillation = /[\u0591-\u05af]/gu

function transferAccents(word, verseWord) {
  const source = verseWord.split(/(?=[\u05d0-\u05ea])/u)
  return word.split(/(?=[\u05d0-\u05ea])/u).map((letter,index)=>
    letter.replace(cantillation,'')+(source[index].match(cantillation)||[]).join('')
  ).join('').normalize('NFC')
}

export function matchCantillation(passage,verse) {
  const source = words(verse)
  if (!/[\u0591-\u05af]/u.test(verse)) return []
  const target = words(passage)
  const a = source.map(word=>letters(word[0]))
  const b = target.map(word=>letters(word[0]))
  let best = 3, occurrence
  for (let i=0;i<b.length;i++) for (let j=0;j<a.length;j++) {
    let size=0
    while (i+size<b.length && j+size<a.length && b[i+size]===a[j+size]) size++
    if (size>best) { best=size; occurrence={i,j} }
    else if (size===best && best>=4) occurrence=undefined
  }
  if (!occurrence) return []
  const {i,j}=occurrence
  const start=target[i].index
  const end=target[i+best-1].index+target[i+best-1][0].length
  let value='', cursor=start
  for (let k=0;k<best;k++) {
    const word=target[i+k]
    value+=passage.slice(cursor,word.index)+transferAccents(word[0],source[j+k][0])
    cursor=word.index+word[0].length
  }
  return /[\u0591-\u05af]/u.test(value) ? [{start,end,value}] : []
}

export async function accentedQuotes(rows,links) {
  const candidates = [...new Set(links.filter(link=>link.category==='Tanakh' &&
    ['quotation','quotation_auto_tanakh'].includes(link.type)).map(link=>link.ref))].slice(0,36)
  const verses = new Map()
  for (let i=0;i<candidates.length;i+=4) {
    await Promise.all(candidates.slice(i,i+4).map(async ref=>{
      try { verses.set(ref,(await text(ref)).rows.map(row=>row.text)) }
      catch { /* An unavailable verse leaves the siddur text intact. */ }
    }))
  }
  const overrides = new Map()
  for (const row of rows) {
    const patches = sourcesForRow(links,row).flatMap(link=>
      (verses.get(link.ref)||[]).flatMap(verse=>matchCantillation(row.text,verse)))
    const ordered = patches.sort((a,b)=>a.start-b.start || b.end-a.end)
    let from=0, result=''
    for (const {start,end,value} of ordered) {
      if (start<from) continue
      result+=row.text.slice(from,start)+value
      from=end
    }
    if (from) overrides.set(row.offset,result+row.text.slice(from))
  }
  return overrides
}
