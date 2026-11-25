import {api, calendar, fingerprint, index, keys, localDate, read, remove, siddurTree, text, write} from './data.mjs'
import {addressFor, browserTasks, completeTask, connection, disconnect, pair, queue, remote, studyId, syncedStudies, synchronize} from './sync.mjs'

const $ = selector => document.querySelector(selector)
const view = $('#view')
const settings = $('#settings')
const preferences = await read('preferences').catch(() => null) || {theme: 'auto', font: 22, region: 'Israel'}
const zone = () => preferences.region === 'Israel' ? 'Asia/Jerusalem' : Intl.DateTimeFormat().resolvedOptions().timeZone
const books = [
  ['בראשית', 'Genesis 1', 'תורה'], ['שמות', 'Exodus 1', 'תורה'], ['ויקרא', 'Leviticus 1', 'תורה'],
  ['במדבר', 'Numbers 1', 'תורה'], ['דברים', 'Deuteronomy 1', 'תורה'], ['תהילים', 'Psalms 1', 'כתובים'],
  ['יהושע', 'Joshua 1', 'נביאים'], ['משלי', 'Proverbs 1', 'כתובים'],
  ['פרקי אבות', 'Pirkei Avot 1', 'משנה'], ['משנה ברכות', 'Mishnah Berakhot 1', 'משנה'],
  ['ברכות', 'Berakhot 2a', 'תלמוד'], ['משנה תורה', 'Mishneh Torah, Foundations of the Torah 1', 'הלכה']
]
const nusach = [['אשכנז', 'Siddur Ashkenaz'], ['ספרד', 'Siddur Sefard'], ['עדות המזרח', 'Siddur Edot HaMizrach']]
let revision = 0
let reader = null
let dailyDate = localDate(zone())
let selectedNusach = await read('nusach').catch(() => null) || nusach[0][1]
let syncTimer

function node(tag, value, properties = {}) {
  return Object.assign(document.createElement(tag), {textContent: value, ...properties})
}

function button(label, action, className = '') {
  const control = node('button', label, {type:'button', className})
  control.addEventListener('click', () => protect(action))
  return control
}

function link(label, href) {
  const item = node('a', label, {href})
  if (href.startsWith('https:')) Object.assign(item, {target:'_blank', rel:'noopener noreferrer'})
  return item
}

function status(message = '') {
  $('#notice').textContent = message
}

async function protect(work) {
  try { await work() } catch (error) {
    status(error instanceof TypeError || error.name === 'TimeoutError'
      ? 'אין חיבור למקור התוכן. ספרים שנשמרו זמינים בספרים שלי.'
      : error.message || 'הפעולה לא הושלמה.')
  }
}

function heading(title) {
  view.replaceChildren(node('h1', title, {id:'view-title', className:'heading', tabIndex:-1}))
}

function card(label, details, action) {
  const result = node('div', '', {className:'card'})
  const title = node('h2', '')
  title.append(button(label, action, 'link'))
  result.append(title, node('p', details, {className:'meta'}))
  return result
}

function openRef(ref) {
  location.hash = 'read/' + encodeURIComponent(ref)
}

function library() {
  heading('ספרייה')
  const search = node('form', '', {className:'controls inline', role:'search'})
  const input = node('input', '', {required:true, maxLength:180, placeholder:'למשל תהילים כג או בראשית א'})
  input.setAttribute('aria-label', 'מראה מקום')
  search.append(input, node('button', 'פתיחה', {className:'primary'}))
  search.onsubmit = event => {
    event.preventDefault()
    if (input.value.trim()) openRef(input.value.trim())
  }
  const grid = node('div', '', {className:'grid'})
  grid.append(...books.map(([label, ref, group]) => card(label, group, () => openRef(ref))))
  view.append(search, grid)
}

function dailyLink(program, day) {
  return '#daily/' + day + '/' + encodeURIComponent(program)
}

function calendarProgram(item) {
  return item.category === 'Mishnah' || ['Daily Mishnah', 'Mishnah Yomit'].includes(item.title?.en)
    ? 'Mishnah' : item.title?.en || item.category
}

function followingDay(day) {
  const date = new Date(day + 'T12:00:00Z')
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0,10)
}

function nextStudyDay(entry) {
  const day = followingDay(entry.day)
  if (!entry.syncTab) {
    location.hash = dailyLink(entry.program, day)
    return
  }
  location.hash = 'continue/' + encodeURIComponent(JSON.stringify([entry.program, day, entry.syncTab]))
}

async function tasks(ticket, date = localDate(zone())) {
  heading('משימות')
  const tasks = await browserTasks()
  if (ticket !== revision) return
  if (!tasks) {
    view.append(node('p', 'כדי לסמן ביצוע, צמד את הדפדפן עם קוד ממסך צימוד וסנכרון בטלפון.'))
    view.append(button('צימוד וסנכרון', () => $('#prefs').click()))
    return
  }
  const label = node('label', 'תאריך ביצוע')
  const dateInput = node('input', '', {type:'date',value:date})
  dateInput.onchange = () => { if (dateInput.value) location.hash = 'tasks/' + dateInput.value }
  label.append(dateInput)
  view.append(label)
  const grid = node('div', '', {className:'grid'})
  for (const task of tasks) {
    if (date < (task.date || task.startsOn || '')) continue
    const key = task.reset === 'NEVER' ? 'once' : date
    const completion = task.completions.find(record => record.occurrenceKey === key)
    let done = completion?.completed ?? (task.completed && (key === 'once' || task.completedOn === key))
    const control = button(done ? 'ביטול סימון ביצוע' : 'סימון ביצוע', async () => {
      control.disabled = true
      try {
        await completeTask(task.id, key, !done)
        done = !done
        control.textContent = done ? 'ביטול סימון ביצוע' : 'סימון ביצוע'
        status('סימון הביצוע נשמר.')
      } finally {
        control.disabled = false
      }
    })
    const item = node('div', '', {className:'card'})
    item.append(node('h2', task.title), control)
    grid.append(item)
  }
  if (!grid.childElementCount) view.append(node('p', 'אין משימות מסונכרנות לתאריך הזה.'))
  else view.append(grid)
}

async function syncedStudy(ticket, parameter) {
  heading('הלימודים שלי')
  const connected = await connection()
  if (ticket !== revision) return
  if (!connected) {
    view.append(node('p', 'כדי לראות את הלימודים מהטלפון, פתח הגדרות וצמד את הדפדפן.'))
    view.append(button('צימוד וסנכרון', () => $('#prefs').click()))
    return
  }
  const records = await syncedStudies()
  if (ticket !== revision) return
  if (parameter) {
    const id = decodeURIComponent(parameter)
    const [program, day, tab] = JSON.parse(id)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('תאריך הלימוד אינו תקין.')
    let record = records.find(item => studyId(item) === id)
    if (!record) {
      const previous = records.find(item => item.program === program && item.tab === tab &&
        item.nextRefs?.length && followingDay(item.date) === day)
      if (previous) record = {program, date:day, tab, refs:previous.nextRefs}
    }
    if (!record) {
      const calendarId = {mishnah:'Mishnah', 'Mishnah Yomit':'Mishnah'}[program] || program
      if (!['aliyah','tehillim'].includes(program)) {
        const items = (await calendar(day, preferences.region, zone())).calendar_items
        if (items.some(item => item.ref && calendarProgram(item) === calendarId)) {
          const item = items.find(item => item.ref && calendarProgram(item) === calendarId)
          record = {program, date:day, tab:'source', refs:[item.ref], title:item.title?.he}
        }
      }
      if (ticket !== revision) return
      if (!record) {
        view.append(node('p', 'מראה המקום ליום ' + day + ' עדיין לא סונכרן מהטלפון.'))
        view.append(link('לכל הלימודים בתאריך הזה', '#daily/' + day), ' · ', link('חזרה ללימודים שלי', '#continue'))
        return
      }
    }
    status('טוען את קטע הלימוד…')
    const parts = await Promise.all(record.refs.map(text))
    const entry = {
      ...parts[0], rows: parts.flatMap(part => part.rows), title: record.title || parts[0].title,
      type:'daily', program:record.program, day:record.date, syncTab:record.tab,
      ref:record.refs.join(' / '), region:preferences.region
    }
    await renderReader(entry, ticket, true)
    return
  }
  const latest = new Map()
  records.sort((a,b) => (b.position?.updatedAt ?? b.updatedAt) - (a.position?.updatedAt ?? a.updatedAt))
  for (const record of records) {
    const track = JSON.stringify([record.program, record.tab])
    if (!latest.has(track)) latest.set(track, record)
  }
  if (!latest.size) {
    view.append(node('p', 'כדי להציג כאן לימוד, פתח אותו בקידומן בטלפון ובצע סנכרון.'))
    return
  }
  const grid = node('div', '', {className:'grid'})
  for (const record of latest.values()) {
    grid.append(card(record.title || record.refs[0], record.date + ' · ' + record.refs.join(' · '),
      () => { location.hash = 'continue/' + encodeURIComponent(studyId(record)) }))
  }
  view.append(grid)
}

async function daily(ticket, date, program) {
  dailyDate = date || dailyDate
  heading('לימוד יומי')
  const dateLabel = node('label', 'תאריך לימוד')
  const dateInput = node('input', '', {type:'date', value:dailyDate})
  dateLabel.append(dateInput)
  const controls = node('div', '', {className:'controls inline'})
  controls.append(dateLabel, button('היום', () => {
    dailyDate = localDate(zone())
    location.hash === '#daily' ? show() : location.hash = 'daily'
  }))
  dateInput.onchange = () => {
    if (!dateInput.value) return
    dailyDate = dateInput.value
    location.hash === '#daily' ? protect(show) : location.hash = 'daily'
  }
  view.append(controls)
  status('טוען לוח לימוד…')
  const data = await calendar(dailyDate, preferences.region, zone())
  if (ticket !== revision) return
  status()
  const items = data.calendar_items.filter(item => item.ref && calendarProgram(item))
  if (program) {
    const item = items.find(entry => calendarProgram(entry) === program)
    if (!item) throw new Error('המסלול הזה אינו זמין בתאריך שנבחר.')
    const entry = {ref:item.ref, type:'daily', program, day:dailyDate, region:preferences.region,
      rawSync: !['Parashat Hashavua', 'Haftarah'].includes(program)}
    const passage = await read('saved:' + entryId(entry)) || await text(item.ref)
    if (ticket !== revision) return
    await renderReader({...passage, ...entry}, ticket, true)
    return
  }
  const grid = node('div', '', {className:'grid'})
  grid.append(...items.map(item => card(item.title?.he || item.category, item.displayValue?.he || item.heRef || item.ref,
    () => { location.hash = dailyLink(calendarProgram(item), dailyDate) })))
  view.append(grid)
}

function treeNode(entry) {
  if (!entry.children.length) {
    const query = new URLSearchParams({ref: entry.ref})
    const target = link(entry.name, '#prayer/' + query)
    return target
  }
  const branch = node('details', '')
  branch.append(node('summary', entry.name))
  const list = node('ul', '')
  for (const child of entry.children) {
    const row = node('li', '')
    row.append(treeNode(child))
    list.append(row)
  }
  branch.append(list)
  return branch
}

async function siddur(ticket) {
  heading('סידור')
  const label = node('label', 'נוסח')
  const select = node('select', '')
  for (const [name, value] of nusach) select.append(node('option', name, {value}))
  select.value = selectedNusach
  select.onchange = () => protect(async () => {
    selectedNusach = select.value
    await write('nusach', selectedNusach)
    await show()
  })
  const controls = node('div', '', {className:'controls inline'})
  label.append(select)
  controls.append(label)
  view.append(controls)
  status('טוען תוכן עניינים…')
  const data = await index(selectedNusach)
  if (ticket !== revision) return
  status()
  view.append(...siddurTree(data.schema, [data.title]).map(entry => treeNode(entry)))
}

async function saved(ticket) {
  heading('הספרים שלי')
  const tools = node('div', '', {className:'controls inline'})
  const fileInput = node('input', '', {type:'file', accept:'.txt,text/plain', hidden:true})
  fileInput.onchange = () => protect(async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    if (file.size > 4 * 1024 * 1024) throw new Error('בחר קובץ טקסט בנפח של עד 4 מגה־בייט.')
    const value = await file.text()
    if (!value.trim()) throw new Error('קובץ הטקסט ריק.')
    const hash = await fingerprint(value)
    await write('personal:' + hash, {hash, type:'personal', title:file.name.replace(/\.txt$/i, ''), text:value})
    location.hash = 'personal/' + hash
  })
  tools.append(button('פתיחת קובץ טקסט', () => fileInput.click()), fileInput)
  view.append(tools)
  const savedKeys = (await keys('saved:', 'saved:\uffff')).concat(await keys('personal:', 'personal:\uffff'))
  const records = await Promise.all(savedKeys.map(read))
  if (ticket !== revision) return
  if (!records.length) {
    view.append(node('p', 'ספרים וקטעים ששמרת לקריאה בלי אינטרנט יופיעו כאן.', {className:'empty'}))
    return
  }
  const grid = node('div', '', {className:'grid'})
  records.forEach((entry, i) => {
    if (!entry) return
    const type = entry.type === 'personal' ? 'קובץ אישי' : entry.type === 'daily' ? 'לימוד יומי' : entry.type === 'prayer' ? 'סידור' : 'ספרייה'
    const item = card(entry.title, type, () => {
      location.hash = entry.type === 'personal' ? 'personal/' + entry.hash : 'saved/' + encodeURIComponent(savedKeys[i])
    })
    item.append(button('הסרה מהרשימה', async () => {
      if (!confirm('להסיר את הטקסט מהספרים שלי?')) return
      await remove(savedKeys[i])
      await show()
    }))
    grid.append(item)
  })
  view.append(grid)
}

function entryId(entry) {
  if (entry.type === 'personal') return 'personal:' + entry.hash
  const key = [entry.type, entry.program, entry.day, entry.region, entry.ref]
  if (entry.syncTab) key.push(entry.syncTab)
  return JSON.stringify(key)
}

function rowOffset(rows, offset) {
  let lo = 0
  let hi = rows.length - 1
  while (lo < hi) {
    const middle = Math.ceil((lo + hi) / 2)
    if (rows[middle].offset <= offset) lo = middle
    else hi = middle - 1
  }
  return lo
}

function anchorOffset(raw, record) {
  if (!record) return null
  if (!record.anchor) return record.offset < raw.length ? record.offset : null
  const anchor = record.anchor.replace(/[\u0591-\u05c7]/g, '').trim().split(/\s+/)
  if (!anchor.some(Boolean)) return null
  const expression = anchor.map(word => Array.from(word, char =>
    char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\u0591-\u05c7]*'
  ).join('')).join('\\s+')
  const scope = Math.max(0, record.offset - 2000)
  const matches = raw.slice(scope, record.offset + 2000).matchAll(new RegExp(expression, 'g'))
  let closest = null
  for (const match of matches) {
    const offset = scope + match.index
    if (closest === null || Math.abs(offset - record.offset) < Math.abs(closest - record.offset)) closest = offset
  }
  return closest
}

async function renderReader(entry, ticket, keepHeading = false) {
  if (ticket !== revision) return
  if (!keepHeading) heading(entry.title)
  else view.append(node('h2', entry.title))
  status()
  let length = 0
  let raw = ''
  const personal = entry.type === 'personal'
  const lines = personal ? entry.text.split('\n').map(line => ({text:line})) : entry.rows
  const rows = lines.map(line => {
    const prefix = line.address ? line.address + '  ' : ''
    const row = {...line, offset:length}
    raw += prefix + line.text + '\n'
    length = raw.length
    return row
  })
  if (personal) raw = entry.text
  else raw = raw.trim()

  const actions = node('div', '', {className:'reader-actions'})
  const readerPanel = node('div', '', {className:'reader'})
  const article = node('article', '')
  const id = entryId(entry)
  const key = 'progress:' + id
  const local = await read(key)
  const synced = await remote(addressFor(entry))
  if (ticket !== revision) return
  const available = !personal ? await read('saved:' + id) : null
  if (ticket !== revision) return
  const mark = synced?.updatedAt > (local?.updatedAt || 0)
    ? anchorOffset(raw, synced) ?? (entry.syncTab && synced.offset < raw.length ? synced.offset : local?.offset ?? 0) : local?.offset || 0
  const state = {entry, article, rows, raw, key, mark, viewed:false, page:0}
  reader = state
  if (!personal) {
    const saveButton = button(available ? 'נשמר לקריאה בלי אינטרנט' : 'שמירה לקריאה בלי אינטרנט', async () => {
      await write('saved:' + id, entry)
      saveButton.disabled = true
      saveButton.textContent = 'נשמר לקריאה בלי אינטרנט'
      status('הטקסט זמין עכשיו בספרים שלי.')
    })
    saveButton.disabled = Boolean(available)
    actions.append(saveButton)
  }

  if (entry.type === 'daily') {
    const address = addressFor(entry, true)
    const doneKey = 'done:' + entry.program + ':' + entry.day
    const localDone = await read(doneKey)
    const remoteDone = await remote(address)
    if (ticket !== revision) return
    let done = Number(remoteDone?.updatedAt > (localDone?.updatedAt || 0) ? remoteDone.offset : localDone?.offset) === 1
    const setDone = async next => {
      await write(doneKey, {offset:Number(next),updatedAt:Date.now()})
      await queue(address, Number(next))
      done = next
      completion.textContent = done ? 'ביטול סימון סיום' : 'סיימתי'
      advance.textContent = done ? 'מעבר ליום הבא' : 'סיום ומעבר ליום הבא'
      scheduleSync()
    }
    const completion = button(done ? 'ביטול סימון סיום' : 'סיימתי', () => setDone(!done))
    const advance = button(done ? 'מעבר ליום הבא' : 'סיום ומעבר ליום הבא', async () => {
      advance.disabled = true
      try {
        if (!done) await setDone(true)
        nextStudyDay(entry)
      } finally {
        advance.disabled = false
      }
    }, 'primary')
    actions.append(completion, advance)
  }
  const jump = button('המשך מהמקום האחרון', () => jumpTo(state, state.mark))
  jump.disabled = !mark
  actions.prepend(jump)
  state.jump = jump
  const top = node('div', '', {className:'inline'})
  if (entry.type === 'prayer') top.append(link('תוכן עניינים', '#siddur'))
  if (entry.type === 'library' && entry.prev) top.append(button('הקטע הקודם', () => openRef(entry.prev)))
  if (entry.type === 'library' && entry.next) top.append(button('הקטע הבא', () => openRef(entry.next)))
  if (top.childElementCount) actions.prepend(top)
  readerPanel.append(article)
  const pages = node('div', '', {className:'reader-actions'})
  const previous = button('עמוד קודם', async () => { await pin(state, state.rows[(state.page - 1) * 80].offset); jumpTo(state, state.mark) })
  const next = button('עמוד הבא', async () => { await pin(state, state.rows[(state.page + 1) * 80].offset); jumpTo(state, state.mark) })
  state.pager = {previous, next}
  pages.append(previous, next)
  pages.hidden = rows.length <= 80
  view.append(actions, readerPanel, pages)
  if (entry.type === 'library' && entry.next) view.append(button('הקטע הבא', () => openRef(entry.next)))
  if (entry.version) {
    const attribution = node('p', entry.version + (entry.license ? ' · ' + entry.license : '') + ' · ', {className:'meta'})
    attribution.append(link('ספריא', 'https://www.sefaria.org/' + encodeURIComponent(entry.ref)))
    view.append(attribution)
  }
  renderPage(state, rowOffset(rows, mark))
  if (entry.syncTab && mark) requestAnimationFrame(() => { if (reader === state) jumpTo(state, mark) })
}

function renderPage(state, target) {
  state.page = Math.floor(target / 80)
  const start = state.page * 80
  state.article.replaceChildren()
  state.rows.slice(start, start + 80).forEach(row => {
    const paragraph = node('p', '')
    paragraph.dataset.offset = row.offset
    if (row.address) paragraph.append(node('bdi', row.address, {className:'address'}), document.createTextNode(' '))
    paragraph.append(document.createTextNode(row.text || '\u00a0'))
    state.article.append(paragraph)
  })
  state.pager.previous.disabled = state.page === 0
  state.pager.next.disabled = start + 80 >= state.rows.length
}

function jumpTo(state, offset) {
  const target = rowOffset(state.rows, offset)
  renderPage(state, target)
  state.article.children[target % 80]?.scrollIntoView({block:'start'})
}

async function pin(state, offset) {
  if (offset === state.mark && state.viewed) return
  state.mark = offset
  state.viewed = true
  state.jump.disabled = !offset
  await write(state.key, {offset, updatedAt:Date.now()})
  const anchor = state.entry.type === 'personal' ? '' : state.raw.slice(offset, offset + 100).replace(/[\u0591-\u05c7]/g, '').replace(/\s+/g, ' ').trim()
  await queue(addressFor(state.entry), offset, anchor)
  scheduleSync()
}

let scrollTimer
window.addEventListener('scroll', () => {
  if (!reader?.article?.childElementCount) return
  const state = reader
  clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    if (state !== reader || state.article.getBoundingClientRect().top > 100) return
    const rows = [...state.article.children]
    const visible = rows.find(row => row.getBoundingClientRect().bottom > 28)
    if (visible) protect(() => pin(state, Number(visible.dataset.offset)))
  }, 240)
}, {passive:true})

async function show() {
  const ticket = ++revision
  reader = null
  status()
  const fragment = location.hash.slice(1)
  const splitAt = fragment.indexOf('/')
  const route = (splitAt < 0 ? fragment : fragment.slice(0, splitAt)) || 'library'
  const parameter = splitAt < 0 ? '' : fragment.slice(splitAt + 1)
  const current = ['read', 'prayer', 'personal'].includes(route)
    ? {read:'library', prayer:'siddur', personal:'saved'}[route] : route
  document.querySelectorAll('nav a').forEach(item => {
    if (item.hash === '#' + current) item.setAttribute('aria-current', 'page')
    else item.removeAttribute('aria-current')
  })
  window.scrollTo(0, 0)
  if (route === 'daily') {
    const [date, program] = parameter.split('/')
    await daily(ticket, date, program && decodeURIComponent(program))
    return
  }
  if (route === 'tasks') return tasks(ticket, /^\d{4}-\d{2}-\d{2}$/.test(parameter) ? parameter : undefined)
  if (route === 'continue') return syncedStudy(ticket, parameter)
  if (route === 'siddur') return siddur(ticket)
  if (route === 'saved' && !parameter) return saved(ticket)
  if (['read','prayer','personal','saved'].includes(route)) {
    heading(route === 'prayer' ? 'סידור' : 'קריאה')
    status('טוען טקסט…')
    let entry
    if (route === 'read' || route === 'prayer') {
      const ref = route === 'read' ? decodeURIComponent(parameter) : new URLSearchParams(parameter).get('ref')
      if (!ref) throw new Error('בחר טקסט מהספרייה או מהסידור.')
      const existing = await read('saved:' + entryId({type:route === 'read' ? 'library' : 'prayer', ref}))
      entry = existing || {...await text(ref), type:route === 'read' ? 'library' : 'prayer'}
    } else {
      const ref = decodeURIComponent(parameter)
      entry = await read(route === 'personal' ? 'personal:' + ref : ref)
      if (!entry) throw new Error('הטקסט לא נמצא בספרים שלי.')
    }
    await renderReader(entry, ticket)
    return
  }
  library()
}

function applyPreferences() {
  if (preferences.theme === 'auto') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = preferences.theme
  document.documentElement.style.setProperty('--reader-size', preferences.font + 'px')
  $('#theme').value = preferences.theme
  $('#font-size').value = preferences.font
  $('#region').value = preferences.region
  $('#today').textContent = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {day:'numeric', month:'long', year:'numeric', timeZone:zone()}).format()
}

async function syncUI(message) {
  const linked = await connection()
  $('#pair-form').hidden = Boolean(linked)
  $('#sync-actions').hidden = !linked
  $('#sync-state').textContent = message || (linked ? 'הדפדפן מצומד לקידומן.' : 'חבר את הדפדפן כדי לסנכרן התקדמות בלימוד.')
}

async function syncNow() {
  await syncUI('מסנכרן…')
  try {
    const synced = await synchronize()
    await syncUI(synced ? 'הסנכרון הושלם.' : undefined)
    if (synced && (location.hash === '#continue' || location.hash.startsWith('#tasks'))) await show()
  } catch (error) {
    await syncUI(error.message || 'הסנכרון לא הושלם.')
  }
}

function scheduleSync() {
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => { if (navigator.onLine) protect(syncNow) }, 1400)
}

$('#prefs').onclick = () => {
  settings.showModal()
  protect(syncUI)
}
$('#pair-form').onsubmit = event => {
  event.preventDefault()
  protect(async () => {
    const input = $('#pair-code')
    const code = input.value.trim()
    const submit = event.currentTarget.querySelector('button')
    submit.disabled = true
    try { await pair(code); input.value = '' } catch (error) { await syncUI(error.message); return }
    finally { submit.disabled = false }
    await syncNow()
    if (reader && !reader.viewed) await show()
  })
}
$('#sync-now').onclick = () => protect(async () => {
  await syncNow()
  if (reader && !reader.viewed) await show()
})
$('#disconnect').onclick = () => protect(async () => { await disconnect(); await syncUI() })
for (const [selector, property] of [['#theme', 'theme'], ['#font-size', 'font'], ['#region', 'region']]) {
  $(selector).onchange = () => protect(async () => {
    preferences[property] = property === 'font' ? Number($(selector).value) : $(selector).value
    await write('preferences', preferences)
    applyPreferences()
    if (property === 'region') {
      dailyDate = localDate(zone())
      if (location.hash.startsWith('#daily')) {
        if (location.hash === '#daily') await show()
        else location.hash = 'daily'
      }
    }
  })
}
window.addEventListener('hashchange', () => protect(show))
window.addEventListener('online', scheduleSync)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && navigator.onLine) scheduleSync()
})
navigator.serviceWorker?.register('./sw.js').catch(() => {})
applyPreferences()
await protect(show)
if (await connection().catch(() => null) && navigator.onLine) scheduleSync()
