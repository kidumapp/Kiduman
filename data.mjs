const base = 'https://www.sefaria.org/api/'
const db = new Promise((resolve, reject) => {
  const open = indexedDB.open('kiduman-web', 1)
  open.onupgradeneeded = () => open.result.createObjectStore('records')
  open.onsuccess = () => resolve(open.result)
  open.onerror = () => reject(open.error)
})

async function transaction(mode, work) {
  const connection = await db
  return new Promise((resolve, reject) => {
    const tx = connection.transaction('records', mode)
    const request = work(tx.objectStore('records'))
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = () => reject(tx.error)
    tx.onerror = () => reject(tx.error)
  })
}

export const read = key => transaction('readonly', store => store.get(key))
export const write = (key, value) => transaction('readwrite', store => store.put(value, key))
export const remove = key => transaction('readwrite', store => store.delete(key))
export const keys = (from, to) => transaction('readonly', store => store.getAllKeys(IDBKeyRange.bound(from, to)))

export async function api(path) {
  const response = await fetch(base + path, {signal: AbortSignal.timeout(15000)})
  if (!response.ok) throw new Error('ספריא לא החזירה תוכן. בדוק את מראה המקום או נסה שוב.')
  const data = await response.json()
  if (data.error) throw new Error('מראה המקום לא נמצא בספריא.')
  return data
}

export async function index(title) {
  const key = 'index:' + title
  return await read(key) || await save(key, await api('index/' + encodeURIComponent(title)))
}

export async function calendar(day, region, timezone) {
  const key = 'calendar:' + [day, region, timezone].join(':')
  const [year, month, date] = day.split('-')
  const query = new URLSearchParams({year, month, day: date, diaspora: region === 'Israel' ? '0' : '1', timezone})
  return await read(key) || await save(key, await api('calendars?' + query))
}

async function save(key, value) {
  await write(key, value)
  return value
}

export function plain(html) {
  const element = document.createElement('textarea')
  element.innerHTML = String(html).replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '')
  return element.value.trim().replace(/[ \t\n\r\v\f]+/g, ' ')
}

function rank(value) {
  return Array.isArray(value) ? 1 + value.reduce((max, item) => Math.max(max, rank(item)), 0) : 0
}

function addressAt(initial, delta) {
  const match = /^(\d+)([ab])$/.exec(initial)
  if (!match) return String(Number(initial) + delta)
  const position = Number(match[1]) * 2 + Number(match[2] === 'b') + delta
  return Math.floor(position / 2) + (position % 2 ? 'b' : 'a')
}

export function formatText(page, version) {
  const depth = rank(version.text)
  const sections = page.sections || []
  const fixed = Math.max(0, (page.textDepth ?? page.sectionNames?.length ?? depth) - depth)
  const rows = []
  function walk(value, path, first) {
    if (Array.isArray(value)) {
      const firstAddress = first ? String(sections[path.length] ?? 1) : '1'
      value.forEach((item, i) => walk(item, [...path, addressAt(firstAddress, i)], first && i === 0))
      return
    }
    if (typeof value !== 'string') return
    const text = plain(value)
    if (text) {
      const opening = /^\s*<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)>/i.exec(value)
      rows.push({address:path.join(':'),text,...(opening?{opening:plain(opening[1])}:{})})
    }
  }
  walk(version.text, sections.slice(0, fixed).map(String), true)
  return rows
}

export async function text(ref) {
  const key = 'passage-v2:' + ref
  const cached = await read(key)
  if (cached) return cached
  const page = await api('v3/texts/' + encodeURIComponent(ref) + '?version=hebrew').catch(async error => {
    const old = await read('passage:' + ref)
    if (old) return {cachedPassage:old}
    throw error
  })
  if (page.cachedPassage) return page.cachedPassage
  const version = page.versions?.find(item => item.text !== undefined)
  if (!version) throw new Error('לא נמצאה גרסה בעברית.')
  const rows = formatText(page, version)
  if (!rows.length) throw new Error('לא נמצא טקסט לקריאה.')
  const canonical = page.ref || ref
  const source = canonical.replace(/\s+\d+[ab]?(?::\d+)*(?:-[^ ]+)?$/, '')
  for (const row of rows) if (row.address) row.sourceRef = source + ' ' + row.address
  return save(key,{ref,canonical,title:page.heRef || canonical,rows,next:page.next,prev:page.prev,
    version:version.versionTitle,license:version.license})
}

export function siddurTree(schema, parts) {
  return (schema.nodes || []).map(node => {
    const title = node.title || node.key
    const path = node.default ? parts : [...parts, title]
    return {name: node.heTitle || title, ref: path.join(', '), children: siddurTree(node, path)}
  })
}

export function localDate(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts()
  const values = Object.fromEntries(parts.map(item => [item.type, item.value]))
  return [values.year, values.month, values.day].join('-')
}

export async function fingerprint(value) {
  const bytes = new Uint8Array(value.length * 2)
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    bytes[i * 2] = code & 255
    bytes[i * 2 + 1] = code >>> 8
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
