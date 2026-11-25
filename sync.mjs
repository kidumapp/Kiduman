import {keys, read, remove, write} from './data.mjs'

const base = 'https://jewish-watch-sync.jewish-watch.workers.dev'
const pairing = 'reading-pairing'
let active

export const connection = () => read(pairing)

async function request(path, {token, body} = {}) {
  const headers = {Accept: 'application/json'}
  if (token) headers.Authorization = 'Bearer ' + token
  if (body) headers['Content-Type'] = 'application/json'
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET', headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store', signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) {
    const messages = {400: 'בדוק שהקוד נוצר במסך סנכרון הקריאה.', 401: 'החיבור פג. יש לצמד מחדש.', 404: 'הקוד לא נמצא, פג תוקפו או שהשרת טרם עודכן.'}
    throw new Error(messages[response.status] || 'שרת הסנכרון לא זמין כרגע.')
  }
  return response.json()
}

export async function pair(code) {
  const result = await request('/v1/pair/claim', {body: {pairingCode: code, name: 'קידומן בדפדפן', target: 'phone'}})
  if (result.kind !== 'reading' || !/^[a-f\d]{24}$/.test(result.channelId) || !result.deviceToken) {
    throw new Error('יש להזין קוד ייעודי לסנכרון קריאה.')
  }
  await write(pairing, {channel: result.channelId, token: result.deviceToken, device: result.clientId})
}

export async function disconnect() {
  await remove(pairing)
}

function id(row) {
  return JSON.stringify([row.program, row.date, row.tab])
}

export function addressFor(entry, completion = false) {
  if (completion && entry.program) return {program: entry.program, date: entry.day, tab: 'study', kind: 'completion'}
  if (entry.type === 'personal') return {program: 'personal:' + entry.hash, date: '1970-01-01', tab: 'book'}
  if (entry.rawSync && entry.program) return {program: entry.program, date: entry.day, tab: 'source'}
  return null
}

const key = (channel, row) => 'cloud:' + channel + ':' + id(row)
const newer = (a, b) => !b || a.updatedAt > b.updatedAt ||
  (a.updatedAt === b.updatedAt && a.deviceId > b.deviceId)

export async function queue(address, offset, anchor = '') {
  const current = await connection()
  if (!current || !address) return
  const row = {...address, offset, anchor, deviceId: current.device, updatedAt: Date.now()}
  await write(key(current.channel, row), row)
  await write('pending:' + current.channel + ':' + id(row), row)
}

export async function remote(address) {
  const current = await connection()
  return current && address ? read(key(current.channel, address)) : null
}

async function runSync() {
  const current = await connection()
  if (!current) return false
  const {channel, token} = current
  const path = '/v1/reading/' + channel
  const prefix = 'pending:' + channel + ':'
  const pending = await keys(prefix, prefix + '\uffff')
  for (let start = 0; start < pending.length; start += 100) {
    const batch = pending.slice(start, start + 100)
    const rows = (await Promise.all(batch.map(read))).filter(Boolean)
    if (!rows.length) continue
    const body = {positions: rows.filter(row => !row.kind)}
    const completion = rows.filter(row => row.kind === 'completion')
    if (completion.length) body.handoff = completion
    const result = await request(path, {token, body})
    for (const row of rows) {
      if (row.kind && result.handoff !== true) throw new Error('שרת הסנכרון דורש עדכון לסימון סיום לימוד.')
      const pendingKey = prefix + id(row)
      const saved = await read(pendingKey)
      if (saved?.updatedAt === row.updatedAt && saved.offset === row.offset) await remove(pendingKey)
    }
  }
  let cursor = ''
  do {
    const query = new URLSearchParams({handoff: '1'})
    if (cursor) query.set('cursor', cursor)
    const page = await request(path + '?' + query, {token})
    for (const row of [...page.positions, ...(page.handoff || []).filter(row => row.kind === 'completion')]) {
      const positionKey = key(channel, row)
      if (newer(row, await read(positionKey))) await write(positionKey, row)
    }
    if (page.next && page.next === cursor) throw new Error('השרת החזיר דף סנכרון כפול.')
    cursor = page.next
  } while (cursor)
  return true
}

export function synchronize() {
  if (!active) active = runSync().finally(() => { active = null })
  return active
}
