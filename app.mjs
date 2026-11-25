import {api, calendar, fingerprint, index, keys, localDate, read, remove, siddurTree, text, write} from './data.mjs?v=4'
import {addressFor, browserTasks, completeTask, connection, createReminder, disconnect, pair, queue, remote, studyId, syncedPrograms, syncedStudies, synchronize} from './sync.mjs?v=4'

import {applyDesign, defaults, readFields, readingAddress, readingText, searchText, watchSystemTheme} from './reader-ui.mjs?v=4'

import {commentaries, onkelos, passageRefs, selectCommentaries, torahReferences} from './reader-content.mjs?v=5'

const $ = selector => document.querySelector(selector)
const view = $('#view')
const settings = $('#settings')
const preferences = {...defaults, ...await read('preferences').catch(() => null)}
preferences.theme = {light:'blue_cream', dark:'blue_night'}[preferences.theme] || preferences.theme
const readingSettings = $('#reading-settings')
const toolsDialog = $('#reader-tool-dialog')
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
    if (task.kind === 'REMINDER') continue
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

const reminderPrefix = 'local-reminder:'
let reminderCheck

async function localReminders() {
  const stored = await keys(reminderPrefix,reminderPrefix + '\uffff')
  return (await Promise.all(stored.map(read))).filter(Boolean)
}

function reminderDate(at) {
  return new Intl.DateTimeFormat('he-IL',{dateStyle:'short',timeStyle:'short'}).format(at)
}

async function checkReminders() {
  if (reminderCheck) return reminderCheck
  reminderCheck = (async () => {
    for (const item of await localReminders()) {
      if (item.delivered || item.at > Date.now()) continue
      await write(reminderPrefix + item.id,{...item,delivered:true})
      status('תזכורת · ' + item.title)
      if ('Notification' in window && Notification.permission === 'granted') {
        const registration = await navigator.serviceWorker?.getRegistration()
        await registration?.showNotification(item.title,{tag:item.id,icon:'./kiduman.png'}).catch(() => {})
      }
    }
  })().finally(() => { reminderCheck = null })
  return reminderCheck
}

async function reminders(ticket) {
  heading('תזכורות')
  const form = node('form','',{className:'controls inline'})
  const subject = node('input','',{required:true,maxLength:120,placeholder:'כותרת לתזכורת'})
  subject.setAttribute('aria-label','כותרת לתזכורת')
  const when = node('input','',{required:true,type:'datetime-local'})
  when.setAttribute('aria-label','תאריך ושעת תזכורת')
  const submit = node('button','הוסף תזכורת',{className:'primary',type:'submit'})
  form.append(subject,when,submit)
  view.append(form)
  form.onsubmit = event => {
    event.preventDefault()
    protect(async () => {
      const at = new Date(when.value).getTime()
      const title = subject.value.trim()
      if (!title || !Number.isFinite(at) || at <= Date.now() || at > Date.now() + 366 * 86400000)
        throw new Error('בחר כותרת וזמן עתידי בטווח של שנה.')
      const linked = await connection()
      const item = {id:'web-reminder:' + crypto.randomUUID(),kind:'REMINDER',title,at,
        timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,channel:linked?.kind === 'browser' ? linked.channel : ''}
      submit.disabled = true
      try {
        await write(reminderPrefix + item.id,item)
        await show()
        status(item.channel ? 'התזכורת נשמרה וממתינה לסנכרון.' : 'התזכורת נשמרה בדפדפן.')
        if (item.channel) scheduleSync()
      } finally { submit.disabled = false }
    })
  }
  if ('Notification' in window && Notification.permission === 'default') view.append(button('הפעל התראות בדפדפן', async () => {
    if (await Notification.requestPermission() === 'granted') status('התראות הדפדפן הופעלו.')
  }))
  view.append(node('p','הדפדפן מציג תזכורות כשהאתר פתוח. תזכורות שסונכרנו לטלפון נשמרות גם באפליקציה.',{className:'meta'}))
  const items = await localReminders()
  const cloud = await browserTasks().catch(() => null)
  if (ticket !== revision) return
  const byId = new Map(items.map(item => [item.id,item]))
  for (const item of cloud || []) if (item.kind === 'REMINDER') byId.set(item.id,item)
  const list = node('div','',{className:'grid'})
  for (const item of [...byId.values()].sort((a,b) => a.at - b.at)) {
    const card = node('div','',{className:'card'})
    card.append(node('h2',item.title),node('p',item.at ? reminderDate(item.at) : '',{className:'meta'}))
    if (cloud?.some(other => other.id === item.id)) {
      const done = item.completions.find(record => record.occurrenceKey === 'once')?.completed ?? item.completed
      card.append(button(done ? 'ביטול ביצוע' : 'סימון ביצוע',async () => {
        await completeTask(item.id,'once',!done)
        await show()
      }))
    } else {
      card.append(button('הסר מהדפדפן',async () => {
        await remove(reminderPrefix + item.id)
        await show()
      }))
    }
    list.append(card)
  }
  view.append(list.childElementCount ? list : node('p','אין תזכורות להצגה.'))
}

async function syncBrowserReminders() {
  const paired = await connection()
  if (paired?.kind !== 'browser') return
  for (const item of await localReminders()) {
    if (item.channel !== paired.channel || item.synced || item.at <= Date.now()) continue
    if (await createReminder(item)) await write(reminderPrefix + item.id,{...item,synced:true})
  }
}

async function syncedStudy(ticket, parameter) {
  heading('הלימודים שלי')
  const connected = await connection()
  if (ticket !== revision) return
  if (!connected) {
    view.append(node('p', 'כדי לראות את הלימודים מהטלפון, פתח הגדרות וצמד את הדפדפן.'))
    view.append(button('צימוד וסנכרון', () => $('#prefs').click()), link('קטלוג הלימוד היומי של ספריא','#daily'))
    return
  }
  const [records, programs] = await Promise.all([syncedStudies(),syncedPrograms()])
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
      type:'daily', program:record.program, day:record.date, syncTab:record.tab, sourceRefs:record.refs,
      ref:record.refs.join(' / '), region:preferences.region
    }
    await renderReader(entry, ticket, true)
    return
  }
  view.append(button('סנכרון עם הטלפון', async () => {
    const linked = await synchronize()
    if (linked) await show()
  }), ' · ', link('קטלוג הלימוד היומי של ספריא','#daily'))
  const latest = new Map()
  const pinned = programs && new Set(programs.map(program => program.id))
  records.sort((a,b) => (b.position?.updatedAt ?? b.updatedAt) - (a.position?.updatedAt ?? a.updatedAt))
  for (const record of records) {
    if (pinned && !pinned.has(record.program)) continue
    const track = JSON.stringify([record.program, record.tab])
    if (!latest.has(track)) latest.set(track, record)
  }
  if (!latest.size && !programs?.length) {
    view.append(node('p', 'כדי להציג כאן לימוד, פתח אותו בקידומן בטלפון ובצע סנכרון.'))
    return
  }
  const grid = node('div', '', {className:'grid'})
  const seenPrograms = new Set()
  for (const record of latest.values()) {
    seenPrograms.add(record.program)
    grid.append(card(record.title || record.refs[0], record.date + ' · ' + record.refs.join(' · '),
      () => { location.hash = 'continue/' + encodeURIComponent(studyId(record)) }))
  }
  for (const program of programs || []) {
    if (seenPrograms.has(program.id)) continue
    const day = localDate(zone())
    const id = JSON.stringify([program.id,day,'source'])
    grid.append(card(program.name,day,() => { location.hash = 'continue/' + encodeURIComponent(id) }))
  }
  view.append(grid)
}

async function daily(ticket, date, program) {
  dailyDate = date || dailyDate
  heading('קטלוג הלימוד היומי של ספריא')
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
  const state = {entry, article, rows, raw, key, mark, viewed:false, page:0,
    refs:passageRefs(entry),mode:'source',extras:new Map(),
    bookmarkKey:'bookmarks:' + id, bookmarks:await read('bookmarks:' + id) || [],
    modeKey:'reading-mode:' + id}
  if (ticket !== revision) return
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
  state.progress = node('progress', '', {max:100, value:0})
  state.progress.setAttribute('aria-label', 'התקדמות בקריאה')
  const readerTools = node('div', '', {className:'reader-toolbar'})
  readerTools.append(state.progress, ...readingTools(state))
  const pages = node('div', '', {className:'reader-actions'})
  const previous = button('עמוד קודם', async () => { await pin(state, state.rows[(state.page - 1) * 80].offset); jumpTo(state, state.mark) })
  const next = button('עמוד הבא', async () => { await pin(state, state.rows[(state.page + 1) * 80].offset); jumpTo(state, state.mark) })
  state.pager = {previous, next}
  pages.append(previous, next)
  pages.hidden = rows.length <= 80
  view.append(actions, readerTools, readerPanel, pages)
  if (entry.type === 'library' && entry.next) view.append(button('הקטע הבא', () => openRef(entry.next)))
  if (entry.version) {
    const attribution = node('p', entry.version + (entry.license ? ' · ' + entry.license : '') + ' · ', {className:'meta'})
    attribution.append(link('ספריא', 'https://www.sefaria.org/' + encodeURIComponent(entry.ref)))
    view.append(attribution)
  }
  renderPage(state, rowOffset(rows, mark))
  const mode = await read(state.modeKey)
  if (ticket !== revision || reader !== state) return
  if (mode && !state.viewed) {
    state.mode = mode.mode
    state.extras = new Map(mode.extras)
    state.selectedCommentaries = mode.commentaries
    state.article.dataset.readingMode = mode.mode
    renderPage(state,rowOffset(rows,mark))
  }
  if (mark && !state.viewed) requestAnimationFrame(() => { if (reader === state) jumpTo(state, mark) })
}

function renderPage(state, target) {
  state.page = Math.floor(target / 80)
  const start = state.page * 80
  state.article.replaceChildren()
  state.rows.slice(start, start + 80).forEach(row => {
    const paragraph = node('p', '')
    paragraph.dataset.offset = row.offset
    const address = readingAddress(row.address, preferences.addressStyle)
    if (address) paragraph.append(node('bdi', address, {className:'address'}), document.createTextNode(' '))
    const source = node('span',readingText(row.text,preferences.vocalization) || '\u00a0',{className:'reader-source'})
    paragraph.append(source)
    const bookmark = state.bookmarks.find(item => item.offset === row.offset)
    if (row.offset === state.mark) paragraph.classList.add('last-position')
    if (bookmark) {
      paragraph.classList.add('bookmarked')
      paragraph.title = bookmark.name
    }
    if (state.mode === 'shnayim') {
      paragraph.append(node('span',readingText(row.text,preferences.vocalization),{className:'reader-repeat'}))
    }
    const extras = state.extras.get(start + state.article.childElementCount)
    for (const [name,value] of extras || []) {
      const note = node('span','',{className:'reader-note'})
      note.append(node('strong',name + ' · '),document.createTextNode(readingText(value,preferences.vocalization)))
      paragraph.append(note)
    }
    state.article.append(paragraph)
  })
  updateReaderProgress(state)
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
  for (const row of state.article.children) row.classList.toggle('last-position', Number(row.dataset.offset) === offset)
  state.jump.disabled = !offset
  updateReaderProgress(state)
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
    if (visible && preferences.autoPosition) protect(() => pin(state, Number(visible.dataset.offset)))
  }, 240)
}, {passive:true})

async function show() {
  const ticket = ++revision
  stopSpeech()
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
  if (ticket !== revision) return
  reader = null
  document.body.classList.remove('reading-fullscreen')
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
  if (route === 'reminders') return reminders(ticket)
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

function currentOffset(state) {
  const visible = [...state.article.children].find(row => row.getBoundingClientRect().bottom > 92)
  return Math.max(0, Number(visible?.dataset.offset ?? state.mark))
}

function updateReaderProgress(state) {
  const last = Math.max(1, state.rows.length - 1)
  state.progress.value = Math.round(rowOffset(state.rows,state.mark) / last * 100)
}

function readerDialog(title) {
  $('#reader-tool-title').textContent = title
  const content = $('#reader-tool-content')
  content.replaceChildren()
  toolsDialog.showModal()
  return content
}

function findInReader(state) {
  const content = readerDialog('חיפוש בטקסט')
  const field = node('input', '', {type:'search', required:true, placeholder:'מילה או ביטוי'})
  field.setAttribute('aria-label', 'מה לחפש')
  const form = node('form', '', {className:'inline'})
  const results = node('p', '', {role:'status'})
  let lastQuery = '', index = -1
  function search(direction) {
    const query = searchText(field.value)
    if (!query) return
    const matches = state.rows.filter(row => searchText(row.text).includes(query))
    if (query !== lastQuery) index = direction > 0 ? -1 : 0
    lastQuery = query
    if (!matches.length) { results.textContent = 'לא נמצאו התאמות.'; return }
    index = (index + direction + matches.length) % matches.length
    jumpTo(state,matches[index].offset)
    const match = matches[index]
    results.textContent = (index + 1) + ' מתוך ' + matches.length + ' · ' + match.text.slice(0,140)
  }
  form.onsubmit = event => { event.preventDefault(); search(1) }
  form.append(field, node('button','הבא',{type:'submit'}), button('הקודם', () => search(-1)))
  content.append(form,results)
  field.focus()
}

function showBookmarks(state) {
  const content = readerDialog('סימניות')
  const list = node('ul', '', {className:'bookmark-list'})
  const render = () => {
    list.replaceChildren()
    for (const item of state.bookmarks) {
      const row = node('li', '')
      row.append(button(item.name, () => { toolsDialog.close(); jumpTo(state,item.offset) }),
        button('הסרה', async () => {
          state.bookmarks = state.bookmarks.filter(bookmark => bookmark !== item)
          await write(state.bookmarkKey,state.bookmarks)
          renderPage(state, rowOffset(state.rows,currentOffset(state)))
          render()
        }))
      list.append(row)
    }
    if (!list.childElementCount) list.append(node('li','אין סימניות בקטע הזה.'))
  }
  const form = node('form', '', {className:'inline'})
  const name = node('input','',{type:'text',required:true,maxLength:80,placeholder:'שם לסימנייה'})
  name.setAttribute('aria-label','שם לסימנייה')
  form.append(name,node('button','הוספה במיקום הנוכחי',{type:'submit'}))
  form.onsubmit = event => {
    event.preventDefault()
    protect(async () => {
      const label = name.value.trim()
      if (!label) return
      const offset = currentOffset(state)
      state.bookmarks = [...state.bookmarks.filter(item => item.offset !== offset),{name:label,offset}]
        .sort((a,b) => a.offset - b.offset)
      await write(state.bookmarkKey,state.bookmarks)
      renderPage(state,rowOffset(state.rows,offset))
      name.value = ''
      render()
    })
  }
  content.append(form,list)
  render()
}

function pageScroll(state, direction) {
  const at = rowOffset(state.rows,currentOffset(state))
  const visible = [...state.article.children].filter(row => {
    const rect = row.getBoundingClientRect()
    return rect.bottom > 92 && rect.top < window.innerHeight
  }).length
  const target = Math.max(0,Math.min(at + direction * Math.max(1,visible),state.rows.length - 1))
  const offset = state.rows[target].offset
  jumpTo(state,offset)
  return pin(state,offset)
}

function renderArrows(state) {
  const group = state.arrows
  const arrows = {up:() => button('↑',() => pageScroll(state,-1)),
    down:() => button('↓',() => pageScroll(state,1))}
  const side = (name, directions) => {
    const container = node('div','',{className:name + (directions.length === 2 ? ' split' : '')})
    container.append(...directions.map(direction => arrows[direction]()))
    return container
  }
  const layout = preferences.arrowLayout
  const pairs = {
    split:[['up'],['down']], reverse:[['down'],['up']],
    right:[['up','down'],[]], left:[[],['up','down']], both:[['up','down'],['up','down']]
  }
  const [right,left] = pairs[layout] || pairs.both
  group.className = 'reader-arrows ' + (preferences.arrows === 'edge' ? 'at-edge' : 'inline')
  group.replaceChildren(...(preferences.arrows === 'toolbar'
    ? [arrows.up(),arrows.down()] : [side('right',right),side('left',left)]))
  for (const control of group.querySelectorAll('button')) {
    control.setAttribute('aria-label',control.textContent === '↑' ? 'גלילה למעלה' : 'גלילה למטה')
  }
}

let speaking = null

function stopSpeech() {
  if (!speaking) return
  const current = speaking
  speaking = null
  speechSynthesis.cancel()
  current.control.textContent = 'הקראה'
}

function readAloud(state, control) {
  if (speaking?.state === state) { stopSpeech(); return }
  if (!('speechSynthesis' in window)) throw new Error('הדפדפן הזה לא תומך בהקראה.')
  stopSpeech()
  const voice = speechSynthesis.getVoices().find(voice => /^(he|iw)(-|$)/i.test(voice.lang))
  if (!voice && speechSynthesis.getVoices().length) throw new Error('אין קול עברי זמין בדפדפן הזה.')
  const session = {state, control, index:rowOffset(state.rows,currentOffset(state))}
  speaking = session
  control.textContent = 'עצירת הקראה'
  const speakNext = () => {
    if (speaking !== session) return
    if (session.index >= state.rows.length) { stopSpeech(); return }
    const row = state.rows[session.index]
    const extras = (state.extras.get(session.index) || []).map(([,text]) => text)
    const value = [row.text, ...(state.mode === 'shnayim' ? [row.text] : []), ...extras].join(' ')
    const speech = new SpeechSynthesisUtterance(value)
    speech.lang = 'he-IL'
    if (voice) speech.voice = voice
    speech.rate = preferences.speechRate
    speech.onend = () => { session.index++; speakNext() }
    speech.onerror = () => {
      if (speaking !== session) return
      stopSpeech()
      status('לא ניתן להמשיך בהקראה. בדוק שקול עברי מותקן במכשיר.')
    }
    jumpTo(state,row.offset)
    protect(() => pin(state,row.offset))
    speechSynthesis.speak(speech)
  }
  status('הקראה במהירות ×' + preferences.speechRate)
  speakNext()
}

async function readingCommentaries(state) {
  const content = readerDialog('פירושים')
  const report = node('p','טוען פירושים…',{role:'status'})
  content.append(report)
  try {
    const available = await commentaries(state.refs,state.rows)
    if (reader !== state || !toolsDialog.open) return
    if (!available.size) { report.textContent = 'ספריא לא החזירה פירושים מתאימים לקטע הזה.'; return }
    const choices = node('div','',{className:'commentary-choices'})
    const selected = new Set(state.selectedCommentaries || [])
    const list = [...available.keys()].sort((a,b) => a.localeCompare(b,'he'))
    for (const name of list) {
      const check = node('input','',{type:'checkbox',checked:selected.has(name)})
      check.onchange = () => check.checked ? selected.add(name) : selected.delete(name)
      const label = node('label','',{className:'check'})
      label.append(check,document.createTextNode(name))
      choices.append(label)
    }
    const actions = node('div','',{className:'inline'})
    const apply = async (mode) => {
      if (mode !== 'source' && !selected.size) { report.textContent = 'בחר פירוש אחד לפחות.'; return }
      const buttons = [...actions.querySelectorAll('button')]
      for (const control of buttons) control.disabled = true
      report.textContent = mode === 'source' ? '' : 'טוען את הפירושים שבחרת…'
      try {
        const result = mode === 'source' ? new Map() : await selectCommentaries(available,selected)
        if (reader !== state || !toolsDialog.open) return
        if (mode !== 'source' && !result.size) { report.textContent = 'לא ניתן לטעון את הטקסט של הפירושים האלה.'; return }
        state.selectedCommentaries = [...selected]
        await setReadingMode(state,mode,result)
        toolsDialog.close()
      } finally {
        for (const control of buttons) control.disabled = false
      }
    }
    report.textContent = ''
    actions.append(button('הצג פירושים',() => apply('commentaries')),
      button('פירוש משולב',() => apply('combined')),button('חזרה למקור',() => apply('source')))
    content.append(choices,actions)
  } catch (error) {
    report.textContent = error.name === 'TimeoutError' ? 'ספריא לא השיבה בזמן. נסה לפתוח קטע קצר יותר.' : error.message || 'טעינת הפירושים נכשלה.'
  }
}

async function setReadingMode(state, mode, extras) {
  const offset = currentOffset(state)
  stopSpeech()
  state.mode = mode
  state.extras = extras
  state.article.dataset.readingMode = mode
  jumpTo(state,offset)
  if (mode === 'source') await remove(state.modeKey)
  else await write(state.modeKey,{mode,extras:[...extras],commentaries:state.selectedCommentaries || []})
}

function updateFullscreen(state, active) {
  document.body.classList.toggle('reading-fullscreen',active)
  state.fullscreen.textContent = active ? 'יציאה ממסך מלא' : 'מסך מלא'
  state.fullscreen.setAttribute('aria-pressed',String(active))
}

async function toggleFullscreen(state) {
  const active = !document.body.classList.contains('reading-fullscreen')
  if (active && document.documentElement.requestFullscreen) {
    await document.documentElement.requestFullscreen().catch(() => {})
  } else if (!active && document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {})
  }
  updateFullscreen(state,active)
}

document.addEventListener('fullscreenchange',() => {
  if (reader && !document.fullscreenElement) updateFullscreen(reader,false)
})

function readingTools(state) {
  state.arrows = node('div','')
  renderArrows(state)
  const controls = [
    button('הגדרות קריאה', () => readingSettings.showModal()),
    button('חיפוש בטקסט', () => findInReader(state)),
    button('סימניות', () => showBookmarks(state)),
    button('סימון מיקום', async () => { await pin(state,currentOffset(state)); status('מיקום הקריאה סומן.') })
  ]
  if (state.refs.length) controls.push(button('פירושים',() => readingCommentaries(state)))
  if (torahReferences(state.refs)) {
    const mikra = button('שניים מקרא ואחד תרגום', async () => {
      if (state.mode === 'shnayim') { await setReadingMode(state,'source',new Map()); return }
      mikra.disabled = true
      try {
        const translation = await onkelos(state.refs,state.rows)
        if (reader !== state) return
        await setReadingMode(state,'shnayim',new Map([...translation].map(([row,text]) => [row,[['אונקלוס',text]]])))
      } finally { mikra.disabled = false }
    })
    controls.push(mikra)
  }
  const aloud = button('הקראה', () => readAloud(state,aloud))
  state.fullscreen = button('מסך מלא', () => toggleFullscreen(state))
  state.fullscreen.setAttribute('aria-pressed','false')
  return [...controls,aloud,state.fullscreen,state.arrows]
}

window.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return
  if (document.body.classList.contains('reading-fullscreen')) {
    if (reader) protect(() => toggleFullscreen(reader))
  }
})

function applyPreferences() {
  applyDesign(preferences)
  $('#theme').value = preferences.theme
  $('#region').value = preferences.region
  for (const field of readFields) {
    const control = $('#' + field)
    if (control.type === 'checkbox') control.checked = preferences[field]
    else control.value = preferences[field]
  }
  $('#dayInk').value = preferences.dayInk || '#000000'
  $('#nightInk').value = preferences.nightInk || '#ffffff'
  $('#paper-preset').value = [...$('#paper-preset').options].some(option => option.value === preferences.dayPaper)
    ? preferences.dayPaper : ''
  $('#arrow-layout-field').hidden = preferences.arrows !== 'edge'
  $('#today').textContent = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {day:'numeric', month:'long', year:'numeric', timeZone:zone()}).format()
}

async function saveDesign(property) {
  const offset = reader && currentOffset(reader)
  await write('preferences',preferences)
  applyPreferences()
  if (!reader) return
  if (['addressStyle','vocalization'].includes(property)) jumpTo(reader,offset)
  if (['arrows','arrowLayout'].includes(property)) renderArrows(reader)
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
    if (synced) await syncBrowserReminders()
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
    if (location.hash === '#continue' || reader && !reader.viewed) await show()
  })
}
$('#sync-now').onclick = () => protect(async () => {
  await syncNow()
  if (location.hash === '#continue' || reader && !reader.viewed) await show()
})
$('#disconnect').onclick = () => protect(async () => { await disconnect(); await syncUI() })
$('#reading-prefs').onclick = () => { settings.close(); readingSettings.showModal() }
for (const field of [...readFields,'dayInk','nightInk']) {
  const input = $('#' + field)
  input.onchange = () => protect(async () => {
    preferences[field] = input.type === 'checkbox' ? input.checked
      : input.type === 'range' ? Number(input.value) : input.value
    await saveDesign(field)
  })
}
$('#paper-preset').onchange = () => protect(async () => {
  if (!$('#paper-preset').value) return
  preferences.dayPaper = $('#paper-preset').value
  preferences.readingTheme = 'day'
  await saveDesign('dayPaper')
})
$('#automatic-ink').onclick = () => protect(async () => {
  preferences.dayInk = ''
  preferences.nightInk = ''
  await saveDesign('ink')
})
watchSystemTheme(applyPreferences)
for (const [selector, property] of [['#theme', 'theme'], ['#region', 'region']]) {
  $(selector).onchange = () => protect(async () => {
    preferences[property] = $(selector).value
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
  if (document.visibilityState !== 'visible') return
  protect(checkReminders)
  if (navigator.onLine) scheduleSync()
})
navigator.serviceWorker?.register('./sw.js').catch(() => {})
applyPreferences()
setInterval(() => protect(checkReminders),15000)
await protect(show)
await protect(checkReminders)
if (await connection().catch(() => null) && navigator.onLine) scheduleSync()
