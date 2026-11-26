import {accentedQuotes, prayerLinks, sourcesForRow} from './siddur-sources.mjs?v=1'
import {readerIcon} from './reader-icons.mjs?v=1'
import {api, calendar, fingerprint, index, keys, localDate, read, remove, siddurTree, text, write} from './data.mjs?v=5'
import {addressFor, browserTasks, completeTask, connection, createReminder, disconnect, pair, queue, remote, studyId, syncedPrograms, syncedStudies, synchronize} from './sync.mjs?v=6'

import {applyDesign, defaults, fonts, readFields, readingAddress, readingText, searchText, watchSystemTheme} from './reader-ui.mjs?v=6'

import {commentaries, onkelos, passageRefs, selectCommentaries, syncedComposition, torahReferences} from './reader-content.mjs?v=7'

const $ = selector => document.querySelector(selector)
const view = $('#view')
const home = $('#home')
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
const travelNusach = new Map(nusach.map(([,name],i)=>[name,['ashkenaz','sefard','mizrach'][i]]))
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

function followingDay(day, delta = 1) {
  const date = new Date(day + 'T12:00:00Z')
  date.setUTCDate(date.getUTCDate() + delta)
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

async function calendarStudy(program, day) {
  if (['aliyah','tehillim'].includes(program)) return
  const calendarId = {mishnah:'Mishnah', 'Mishnah Yomit':'Mishnah'}[program] || program
  const items = (await calendar(day, preferences.region, zone())).calendar_items
  return items.find(item => item.ref && calendarProgram(item) === calendarId)
}

const isStudySource = item => item.tab.split('|',1)[0] === 'source'

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
    const [program, day, tab] = JSON.parse(decodeURIComponent(parameter))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('תאריך הלימוד אינו תקין.')
    const siblings = records.filter(item => item.program === program && item.date === day)
    const source = siblings.find(item => item.tab === tab && isStudySource(item)) ||
      siblings.filter(isStudySource).sort((a,b)=>b.updatedAt-a.updatedAt)[0]
    const requested = siblings.find(item => item.tab === tab)
    let record = source || requested || siblings[0]
    if (!record) {
      const previous = records.find(item => item.program === program && item.tab === tab &&
        item.nextRefs?.length && followingDay(item.date) === day)
      if (previous) record = {program, date:day, tab, refs:previous.nextRefs}
    }
    if (!record) {
      const item = await calendarStudy(program,day)
      if (item) record = {program, date:day, tab:'source', refs:[item.ref], title:item.title?.he}
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
      ...parts[0], rows: parts.flatMap(part => part.rows),
      title:source?.title || programs?.find(item=>item.id===program)?.name || parts[0].title,
      type:'daily', program, day, syncTab:source?.tab || 'source', sourceRefs:record.refs,
      ref:record.refs.join(' / '), region:preferences.region
    }
    const yesterday = followingDay(day,-1)
    entry.previousRefs = source?.previousRefs || records.find(item=>item.program===program &&
      item.date===yesterday && isStudySource(item))?.refs ||
      records.find(item=>item.program===program && item.date===yesterday)?.refs
    entry.phoneTabs = [...(source?.recipe?.components || []),...siblings
      .filter(item=>item.recipe?.layout==='commentary').flatMap(item=>item.recipe.components)]
    const combinations = siblings.filter(item=>item.recipe && !['source','commentary'].includes(item.recipe.layout))
      .sort((a,b)=>Number(b===requested)-Number(a===requested) || b.updatedAt-a.updatedAt)
    const editions = new Set()
    entry.syncedRecipes = combinations.filter(item=>{
      const id = item.tab.split('|',1)[0]
      if (editions.has(id)) return false
      editions.add(id)
      return true
    }).map(item=>[item.tab,{...item.recipe,title:item.title}])
    let failure
    if (requested?.recipe && requested.recipe.layout!=='source') {
      try {
        entry.syncedMode = await syncedComposition(requested.recipe,record.refs,entry.rows)
        entry.openingTab = requested.recipe.layout==='commentary'
          ? 'comment:'+requested.recipe.components[0].id : requested.tab
      }
      catch (error) { failure = error.message || 'טעינת הפירוש המסונכרן נכשלה.' }
    }
    if (ticket !== revision) return
    await renderReader(entry, ticket, true)
    if (failure && ticket === revision) status(failure)
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
    if (!latest.has(record.program)) latest.set(record.program, record)
  }
  if (!latest.size && !programs?.length) {
    view.append(node('p', 'הלימודים יופיעו כאן אחרי שגרסת קידומן המעודכנת בטלפון תשלח אותם. בטלפון פתח צימוד וסנכרון, לחץ על סנכרון עכשיו ואז לחץ כאן על סנכרון עם הטלפון.'))
    return
  }
  const grid = node('div', '', {className:'grid'})
  const seenPrograms = new Set()
  for (const record of latest.values()) {
    seenPrograms.add(record.program)
    const source = records.find(item=>item.program===record.program && item.date===record.date && isStudySource(item))
    const label = source?.title || programs?.find(item=>item.id===record.program)?.name ||
      (isStudySource(record) ? record.title : record.refs[0])
    grid.append(card(label || record.refs[0], record.date + ' · ' + record.refs.join(' · '),
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
  controls.append(label,link('תפילת הדרך','#prayer/travel='+travelNusach.get(selectedNusach)))
  view.append(controls)
  status('טוען תוכן עניינים…')
  const data = await index(selectedNusach)
  if (ticket !== revision) return
  status()
  view.append(...siddurTree(data.schema, [data.title]).map(entry => treeNode(entry)))
}

async function travelPrayer(nusachKey) {
  const response = await fetch('./travel-prayer.json')
  if (!response.ok) throw new Error('תפילת הדרך לא נטענה.')
  const prayer = (await response.json())[nusachKey]
  return {type:'prayer',title:'תפילת הדרך',ref:prayer.ref,
    version:prayer.version,license:prayer.license,rows:[{text:prayer.text}]}
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
  const openingSyncTab = entry.openingTab?.startsWith('comment:')
    ? 'commentary:'+entry.openingTab.slice(8) : entry.openingTab || entry.syncTab
  const synced = await remote(addressFor({...entry,syncTab:openingSyncTab}))
  if (ticket !== revision) return
  const available = !personal ? await read('saved:' + id) : null
  if (ticket !== revision) return
  const mark = synced?.updatedAt > (local?.updatedAt || 0)
    ? anchorOffset(raw, synced) ?? (entry.syncTab && synced.offset < raw.length ? synced.offset : local?.offset ?? 0) : local?.offset || 0
  const state = {entry, article, rows, raw, key, mark, viewed:false, page:0,
    refs:passageRefs(entry),mode:entry.syncedMode?.mode || 'source',extras:entry.syncedMode?.extras || new Map(),
    sourceStyle:entry.syncedMode?.sourceStyle,
    recipes:new Map(entry.syncedRecipes), edits:{}, layout:readerPanel,
    activeTab:entry.openingTab || 'source',
    phoneTabs:entry.phoneTabs || [], selectedCommentaries:[], tabsKey:'reader-tabs:' + id,
    bookmarkKey:'bookmarks:' + id, bookmarks:await read('bookmarks:' + id) || [],
    modeKey:'reading-mode:' + id}
  if (ticket !== revision) return
  reader = state
  document.body.classList.add('reading-view')
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
  state.toolbar = readerTools
  readerTools.append(state.progress, ...readingTools(state))
  const pages = node('div', '', {className:'reader-actions'})
  const previous = button('עמוד קודם', async () => { await pin(state, state.rows[(state.page - 1) * 80].offset); jumpTo(state, state.mark) })
  const next = button('עמוד הבא', async () => { await pin(state, state.rows[(state.page + 1) * 80].offset); jumpTo(state, state.mark) })
  state.pager = {previous, next}
  pages.append(previous, next)
  pages.hidden = rows.length <= 80
  state.tabs = node('div','',{className:'comment-tabs'})
  state.tabs.setAttribute('role','group')
  state.tabs.setAttribute('aria-label','מקור ופירושים')
  view.append(actions, readerTools, state.tabs, readerPanel, pages)
  if (entry.type==='daily') readerPanel.prepend(button('הצג סוף הלימוד הקודם',() => showPreviousStudy(state),'previous-study'))
  renderArrows(state)
  if (entry.type === 'library' && entry.next) view.append(button('הקטע הבא', () => openRef(entry.next)))
  if (entry.version) {
    const attribution = node('p', entry.version + (entry.license ? ' · ' + entry.license : '') + ' · ', {className:'meta'})
    attribution.append(link('ספריא', 'https://www.sefaria.org/' + encodeURIComponent(entry.ref)))
    view.append(attribution)
  }
  state.article.dataset.readingMode = state.mode
  renderPage(state, rowOffset(rows, mark))
  const [mode,savedTabs] = await Promise.all([read(state.modeKey),read(state.tabsKey)])
  if (ticket !== revision || reader !== state) return
  if (savedTabs) {
    state.recipe = savedTabs.recipe
    state.edits = savedTabs.edits || {}
    for (const [tab,recipe] of state.recipes) state.recipes.set(tab,state.edits[tab] || recipe)
    state.selectedCommentaries = savedTabs.selected || []
    if (savedTabs.overrideSelection) { state.phoneTabs=[];state.overrideSelection=true }
  } else if (mode?.commentaries) state.selectedCommentaries = mode.commentaries
  const savedTab=mode?.activeTab || (mode?.mode==='combined'?'combined':'source')
  const knownTab=savedTab==='source'
    || (savedTab==='all-commentaries' && state.selectedCommentaries.length > 0)
    || state.selectedCommentaries.some(name=>savedTab==='selected:'+name)
    || [...(state.recipe?.components || []),...state.phoneTabs].some(part=>savedTab==='comment:'+part.id)
    || state.recipes.has(savedTab)
    || (savedTab==='combined' && Boolean(state.recipe))
  if (mode && knownTab && !state.viewed) {
    state.mode = mode.mode
    state.extras = new Map(mode.extras)
    state.activeTab = savedTab
    state.sourceStyle = mode.sourceStyle
    state.article.dataset.readingMode = mode.mode
    renderPage(state,rowOffset(rows,mark))
  }
  refreshCommentTabs(state)
  if (mark && !state.viewed) requestAnimationFrame(() => { if (reader === state) jumpTo(state, mark) })
}

function displayReadingText(value,style) {
  return readingText(value,style?.stripNiqqud ? 'plain' : preferences.vocalization)
}

function applyComponentStyle(element,style) {
  if (!style) return
  const color = value => '#' + (value & 0xffffff).toString(16).padStart(6,'0')
  if (style.color) element.style.color = color(style.color)
  if (style.background) element.style.backgroundColor = color(style.background)
  else if (style.backgroundStep)
    element.style.backgroundColor = `color-mix(in srgb,var(--reader-paper),${style.backgroundStep>0?'white':'black'} ${Math.abs(style.backgroundStep)*12}%)`
  if (style.bold) element.style.fontWeight = 'bold'
  if (style.italic) element.style.fontStyle = 'italic'
  if (style.scale) element.style.fontSize = style.scale + 'em'
}

function renderPage(state, target) {
  state.page = Math.floor(target / 80)
  const start = state.page * 80
  state.article.replaceChildren()
  state.rows.slice(start, start + 80).forEach(row => {
    const paragraph = node('p', '')
    paragraph.dataset.offset = row.offset
    const prayerSource = state.entry.type==='prayer' && row.sourceRef
    const address = readingAddress(row.address, preferences.addressStyle)
    if (address) {
      const marker = row.sourceRef && state.refs.length
        ? button(address,() => passageCommentaries(state,row.offset),'address')
        : node('bdi',address,{className:'address'})
      if (marker.tagName==='BUTTON') marker.setAttribute('aria-label','פירושים · '+address)
      paragraph.append(marker,document.createTextNode(' '))
    }
    if (prayerSource) {
      const citation = iconTool('notes','מקורות ופירושים '+(address || row.address || ''),()=>siddurSources(state,row),'siddur-citation')
      paragraph.append(citation)
    }
    const visibleText = state.siddurAccents?.get(row.offset) || row.text
    const bookmark = state.bookmarks.find(item => item.offset === row.offset)
    if (row.offset === state.mark) paragraph.classList.add('last-position')
    if (bookmark) {
      paragraph.classList.add('bookmarked')
      paragraph.title = bookmark.name
    }
    const extras = state.extras.get(start + state.article.childElementCount) || []
    const source = value => {
      const span = node('span',displayReadingText(value,state.sourceStyle),{className:'reader-source'})
      span.dataset.speech=value
      applyComponentStyle(span,state.sourceStyle)
      paragraph.append(span)
    }
    const note = ([name,value,style]) => {
      const span = node('span','',{className:style?.inline ? 'reader-note inline-note' : 'reader-note'})
      if (style?.showName !== false) span.append(node('strong',name + ' · '))
      const body=node('span',displayReadingText(value,style),{className:'reader-note-body'})
      body.dataset.speech=value
      span.append(body)
      applyComponentStyle(span,style)
      paragraph.append(span)
    }
    const inline = extras.filter(item => item[3] !== undefined)
      .sort((left,right) => left[3] - right[3])
    let from = 0
    for (const item of inline) {
      source(row.text.slice(from,item[3]))
      note(item)
      from = item[3]
    }
    source(visibleText.slice(from) || '\u00a0')
    if (state.mode === 'shnayim') {
      const repeat=node('span',displayReadingText(row.text),{className:'reader-repeat'})
      repeat.dataset.speech=row.text
      paragraph.append(repeat)
    }
    for (const item of extras) if (item[3] === undefined) note(item)
    if (speaking?.state === state && speaking.index === start + state.article.childElementCount)
      paragraph.classList.add('speech-row')
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
  const syncTab = state.recipes.has(state.activeTab) ? state.activeTab
    : state.activeTab.startsWith('comment:') ? 'commentary:'+state.activeTab.slice(8)
    : state.entry.syncTab
  if (state.activeTab!=='combined') await queue(addressFor({...state.entry,syncTab}),offset,anchor)
  scheduleSync()
}

let scrollTimer
window.addEventListener('scroll', () => {
  if (!reader?.article?.childElementCount) return
  const state = reader
  positionArrows(state)
  clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    const edge = Math.max(0,state.toolbar.getBoundingClientRect().bottom)
    if (state !== reader || state.article.getBoundingClientRect().top > edge + 16) return
    const rows = [...state.article.children]
    const visible = rows.find(row => row.getBoundingClientRect().bottom > edge)
    if (visible && preferences.autoPosition) protect(() => pin(state, Number(visible.dataset.offset)))
  }, 240)
}, {passive:true})

async function show() {
  const ticket = ++revision
  stopSpeech()
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
  if (ticket !== revision) return
  reader = null
  document.body.classList.remove('reading-fullscreen','reading-view')
  status()
  const fragment = location.hash.slice(1)
  const splitAt = fragment.indexOf('/')
  const route = (splitAt < 0 ? fragment : fragment.slice(0, splitAt)) || 'home'
  const parameter = splitAt < 0 ? '' : fragment.slice(splitAt + 1)
  const current = ['read', 'prayer', 'personal'].includes(route)
    ? {read:'library', prayer:'siddur', personal:'saved'}[route] : route
  document.querySelectorAll('nav a').forEach(item => {
    if (item.hash === '#' + current) item.setAttribute('aria-current', 'page')
    else item.removeAttribute('aria-current')
  })
  window.scrollTo(0, 0)
  home.hidden = route !== 'home'
  view.hidden = route === 'home'
  if (route === 'home') return
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
    const travel = route==='prayer' ? new URLSearchParams(parameter).get('travel') : null
    if (['ashkenaz','sefard','mizrach'].includes(travel)) {
      entry = await travelPrayer(travel)
    } else if (route === 'read' || route === 'prayer') {
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
  const edge = Math.max(0,state.toolbar.getBoundingClientRect().bottom)
  const visible = [...state.article.children].find(row => row.getBoundingClientRect().bottom > edge)
  return Math.max(0, Number(visible?.dataset.offset ?? state.mark))
}

function updateReaderProgress(state) {
  const last = Math.max(1, state.rows.length - 1)
  state.progress.value = Math.round(rowOffset(state.rows,state.mark) / last * 100)
}

function readerDialog(title) {
  toolsDialog.classList.toggle('tool-menu',title==='כלי קריאה')
  $('#reader-dialog-exit').hidden = !document.body.classList.contains('reading-fullscreen')
  $('#reader-tool-title').textContent = title
  const content = $('#reader-tool-content')
  content.replaceChildren()
  if (!toolsDialog.open) toolsDialog.showModal()
  return content
}

async function showPreviousStudy(state) {
  const day = followingDay(state.entry.day,-1)
  const content = readerDialog('סוף הלימוד הקודם')
  const report = node('p','טוען את הלימוד הקודם…',{role:'status'})
  content.append(report)
  try {
    let refs = state.entry.previousRefs
    if (!refs?.length) {
      const item = await calendarStudy(state.entry.program,day)
      if (item) refs = [item.ref]
    }
    if (!refs?.length) {
      report.textContent = 'מראה המקום של הלימוד הקודם עדיין לא סונכרן מהטלפון.'
      return
    }
    const parts = await Promise.all(refs.map(text))
    const tail = parts.flatMap(part=>part.rows).slice(-8)
    if (!report.isConnected) return
    if (!tail.length) { report.textContent = 'לא נמצא טקסט ללימוד הקודם.'; return }
    const panel = node('div','',{className:'reader'})
    const article = node('article','')
    for (const row of tail) {
      const address = readingAddress(row.address,preferences.addressStyle)
      const paragraph = node('p',displayReadingText(row.text))
      if (address) paragraph.prepend(node('bdi',address+' ',{className:'address'}))
      article.append(paragraph)
    }
    panel.append(article)
    report.textContent = day + ' · ' + refs.join(' · ')
    content.append(panel)
  } catch (error) { report.textContent = error.message || 'טעינת הלימוד הקודם נכשלה.' }
}

async function toggleSiddurAccents(state) {
  if (state.siddurAccents) {
    state.siddurAccents=null
    renderPage(state,state.page*80)
    return
  }
  status('טוען את טעמי המקרא לציטוטים התואמים…')
  const links=await prayerLinks(state.entry.canonical || state.entry.ref)
  const overrides=await accentedQuotes(state.rows,links)
  if (reader!==state) return
  if (!overrides.size) { status('בקטע הזה אין ציטוטים עם התאמת טעמים ודאית.');return }
  state.siddurAccents=overrides
  renderPage(state,state.page*80)
  status()
}

async function siddurSources(state,selected) {
  const row=selected || state.rows[rowOffset(state.rows,currentOffset(state))]
  const content=readerDialog('מקורות ופירושים בסידור')
  content.append(node('p',displayReadingText(row.text)))
  const report=node('p','טוען מקורות…',{role:'status'})
  content.append(report)
  try {
    const anchor=row.sourceRef
    const links=await prayerLinks(anchor || state.entry.canonical || state.entry.ref)
    if (!report.isConnected) return
    const matches=sourcesForRow(links,row)
    report.textContent=matches.length?'':'ספריא אינה מחזירה מקור או פירוש למקום הזה.'
    const list=node('ul','',{className:'siddur-source-list'})
    for (const item of matches) {
      const line=node('li','')
      line.append(button(item.name,async()=>{
        const section=readerDialog(item.name)
        const feedback=node('p','טוען את המקור…',{role:'status'})
        section.append(feedback)
        const result=await text(item.ref)
        if (!feedback.isConnected) return
        feedback.remove()
        section.append(...result.rows.slice(0,12).map(item=>node('p',displayReadingText(item.text))))
        section.append(link('הצגת המקור המלא בספרייה','#read/'+encodeURIComponent(item.ref)))
        section.lastElementChild.onclick=()=>toolsDialog.close()
        if (result.rows.some(row=>row.sourceRef)) section.append(iconTool('notes','פירושים למקור',()=>passageCommentaries({
          ...state,rows:result.rows.map((row,index)=>({...row,offset:index})),
          refs:[item.ref]
        },0)))
        section.append(button('חזרה למקורות בסידור',()=>siddurSources(state,row)))
      }))
      list.append(line)
    }
    if (matches.length) content.append(list)
  } catch (error) { if (report.isConnected) report.textContent=error.message }
}

async function passageCommentaries(state, offset = currentOffset(state)) {
  const passages = state.rows.filter(row=>row.sourceRef)
  if (!passages.length) return
  const start = state.rows[rowOffset(state.rows,offset)]
  const content = readerDialog('פירושים לפי פסוק')
  const select = node('select','')
  select.setAttribute('aria-label','פסוק או קטע')
  select.append(...passages.map((row,i)=>node('option',
    readingAddress(row.address,preferences.addressStyle) || row.sourceRef,{value:String(i)})))
  select.value = String(Math.max(0,passages.indexOf(start)))
  const panel = node('div','',{className:'reader'})
  const article = node('article','')
  panel.append(article)
  const report = node('p','',{role:'status'})
  content.append(select,panel,report)
  let request = 0
  const load = async () => {
    const ticket = ++request
    const row = passages[Number(select.value)]
    article.replaceChildren(node('p',displayReadingText(row.text)))
    report.textContent = 'טוען פירושים…'
    try {
      const available = await commentaries([row.sourceRef],[row])
      const selectedNames = new Set([...state.selectedCommentaries,...state.phoneTabs.map(part=>part.name)])
      const ordered = [...available.keys()].sort((a,b)=>
        Number(selectedNames.has(b))-Number(selectedNames.has(a)) || a.localeCompare(b,'he'))
      if (ticket !== request || !report.isConnected) return
      report.textContent = ordered.length ? '' : 'אין פירושים זמינים לפסוק הזה.'
      for (const name of ordered) {
        const item = node('details','')
        item.append(node('summary',name))
        item.addEventListener('toggle',async () => {
          if (!item.open || item.childElementCount > 1) return
          const body = node('p','טוען…')
          item.append(body)
          try {
            const result = (await selectCommentaries(available,[name])).get(0)
            body.textContent = result?.map(([,value])=>displayReadingText(value)).join('\n\n') ||
              'לא התקבל טקסט לפירוש הזה.'
          } catch (error) { body.textContent = error.message }
        })
        content.insertBefore(item,report)
      }
    } catch (error) { if (ticket === request) report.textContent = error.message }
  }
  select.onchange = () => {
    for (const detail of content.querySelectorAll('details')) detail.remove()
    return load()
  }
  await load()
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
  const top = Math.max(0,state.toolbar.getBoundingClientRect().bottom)
  const bottom = window.visualViewport?.height || window.innerHeight
  const article = state.article.getBoundingClientRect()
  const height = Math.max(1,bottom-top)
  const lastPage = Math.floor((state.rows.length-1)/80)
  if (direction>0 && article.bottom <= bottom+1 && state.page<lastPage) {
    jumpTo(state,state.rows[(state.page+1)*80].offset)
  } else if (direction<0 && article.top >= top-1 && state.page>0) {
    renderPage(state,(state.page-1)*80)
    window.scrollBy({top:state.article.getBoundingClientRect().bottom-bottom,behavior:'instant'})
  } else {
    const left = direction>0 ? Math.max(0,article.bottom-bottom) : Math.max(0,top-article.top)
    window.scrollBy({top:direction*Math.min(height,left),behavior:'instant'})
  }
  const edge = Math.max(0,state.toolbar.getBoundingClientRect().bottom)
  state.article.querySelector('.revealed-line')?.remove()
  const range = document.createRange()
  for (const row of state.article.children) {
    const bounds = row.getBoundingClientRect()
    if (!bounds.height || bounds.bottom<=edge || bounds.top>=bottom) continue
    range.selectNodeContents(row)
    const lines = [...range.getClientRects()].filter(rect=>rect.height && rect.bottom>edge && rect.top<bottom)
    const line = lines.sort((a,b)=>a.top-b.top)[0]
    if (!line) continue
    const marker = node('span','',{className:'revealed-line'})
    marker.setAttribute('aria-hidden','true')
    marker.style.top = Math.max(0,line.top-bounds.top)+'px'
    marker.style.height = line.height+'px'
    row.append(marker)
    return pin(state,Number(row.dataset.offset))
  }
}

function positionArrows(state) {
  const group = state.arrows
  const edge = group.classList.contains('at-edge')
  const center = preferences[edge ? 'edgeArrowCenter' : 'toolbarArrowCenter']
  group.classList.toggle('docked',!edge && Number.isFinite(center))
  if (!edge && !group.classList.contains('docked')) return
  const rect = state.article.getBoundingClientRect()
  const {top,span,margin} = arrowSpace(state,edge)
  const shift = margin + (center ?? .5) * (span-2*margin)
  if (edge) {
    group.style.left = Math.max(2,rect.left-44)+'px'
    group.style.top = top+'px'
    group.style.setProperty('--arrow-center',shift+'px')
  } else {
    group.style.top = top+shift+'px'
  }
  group.style.right = Math.max(2,document.documentElement.clientWidth-rect.right-44)+'px'
}

function arrowSpace(state,edge) {
  const top = Math.max(0,state.toolbar.getBoundingClientRect().bottom)
  const span = Math.max(1,(window.visualViewport?.height || window.innerHeight)-top)
  return {top,span,margin:Math.min(edge?28:46,span/2)}
}

function bindArrowDrag(state,group) {
  let gesture
  let suppressClick = false
  group.addEventListener('pointerdown',event => {
    const button = event.target.closest('button')
    if (!button || event.button!==0 || !event.isPrimary) return
    const edge = group.classList.contains('at-edge')
    const key = edge ? 'edgeArrowCenter' : 'toolbarArrowCenter'
    const {top,span,margin} = arrowSpace(state,edge)
    const start = preferences[key]
    const initial = Number.isFinite(start)
      ? top+margin+start*(span-2*margin)
      : edge ? top+span/2 : group.getBoundingClientRect().top+group.offsetHeight/2
    gesture = {button,key,edge,start,initial,pointer:event.pointerId,y:event.clientY,moved:false}
    suppressClick = false
    button.setPointerCapture(event.pointerId)
  })
  group.addEventListener('pointermove',event => {
    if (!gesture || gesture.pointer!==event.pointerId) return
    const delta = event.clientY-gesture.y
    if (!gesture.moved && Math.abs(delta)<7) return
    gesture.moved = true
    const {top,span,margin} = arrowSpace(state,gesture.edge)
    preferences[gesture.key] = Math.max(0,Math.min(1,(gesture.initial+delta-top-margin)/Math.max(1,span-2*margin)))
    positionArrows(state)
  })
  const finish = (event,commit) => {
    if (!gesture || gesture.pointer!==event.pointerId) return
    const {key,start,moved} = gesture
    gesture = null
    if (!moved) return
    suppressClick = true
    if (commit) protect(() => write('preferences',preferences))
    else {
      preferences[key] = start
      positionArrows(state)
    }
  }
  group.addEventListener('pointerup',event=>finish(event,true))
  group.addEventListener('pointercancel',event=>finish(event,false))
  group.addEventListener('lostpointercapture',event=>finish(event,false))
  group.addEventListener('click',event=>{
    if (!suppressClick || event.detail===0) return
    suppressClick = false
    event.preventDefault()
    event.stopImmediatePropagation()
  },true)
}

window.addEventListener('resize',()=>{if (reader) positionArrows(reader)})

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
  if (preferences.arrows==='edge') {
    state.layout.prepend(group)
    positionArrows(state)
  } else {
    group.style.removeProperty('left')
    group.style.removeProperty('right')
    group.style.removeProperty('top')
    state.toolbar.append(group)
    positionArrows(state)
  }
  for (const control of group.querySelectorAll('button')) {
    control.setAttribute('aria-label',control.textContent === '↑' ? 'גלילה למעלה' : 'גלילה למטה')
    control.title = 'אפשר לגרור את שני החצים יחד למעלה או למטה'
    control.replaceChildren(node('span',control.textContent))
  }
}

let speaking = null

function stopSpeech() {
  if (!speaking) return
  const current = speaking
  speaking = null
  speechSynthesis.cancel()
  current.state.article.querySelector('.speech-row')?.classList.remove('speech-row')
  speechButton(current.control,false)
}

function speechButton(control, playing) {
  const label = playing ? 'עצירת הקראה' : 'הקראה'
  setToolLabel(control,playing?'stop':'audio',label)
}

function readAloud(state, control) {
  if (speaking?.state === state) { stopSpeech(); return }
  if (!('speechSynthesis' in window)) throw new Error('הדפדפן הזה לא תומך בהקראה.')
  stopSpeech()
  const voice = speechSynthesis.getVoices().find(voice => /^(he|iw)(-|$)/i.test(voice.lang))
  if (!voice && speechSynthesis.getVoices().length) throw new Error('אין קול עברי זמין בדפדפן הזה.')
  const session = {state, control, index:rowOffset(state.rows,currentOffset(state))}
  speaking = session
  speechButton(control,true)
  const speakNext = () => {
    if (speaking !== session) return
    if (session.index >= state.rows.length) { stopSpeech(); return }
    const row = state.rows[session.index]
    jumpTo(state,row.offset)
    const paragraph = state.article.children[session.index % 80]
    const selector = state.mode === 'commentaries' ? '.reader-note-body' : '.reader-source,.reader-repeat,.reader-note-body'
    const value = [...paragraph.querySelectorAll(selector)].map(part => part.dataset.speech).join(' ').trim()
    if (!value) { session.index++; queueMicrotask(speakNext); return }
    const speech = new SpeechSynthesisUtterance(preferences.speechIgnoreNiqqud ? readingText(value,'plain') : value)
    speech.lang = 'he-IL'
    if (voice) speech.voice = voice
    speech.rate = preferences.speechRate
    speech.onend = () => { session.index++; speakNext() }
    speech.onerror = () => {
      if (speaking !== session) return
      stopSpeech()
      status('לא ניתן להמשיך בהקראה. בדוק שקול עברי מותקן במכשיר.')
    }
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
    const selected = new Set([...state.selectedCommentaries,...state.phoneTabs.map(tab=>tab.name)])
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
        await saveCommentTabs(state)
        await setReadingMode(state,mode,result,'all-commentaries')
        toolsDialog.close()
      } finally {
        for (const control of buttons) control.disabled = false
      }
    }
    report.textContent = ''
    actions.append(button('שמור בחירה',async () => {
      state.selectedCommentaries=[...selected]
      state.phoneTabs=[]
      state.overrideSelection=true
      await saveCommentTabs(state)
      if ((state.activeTab.startsWith('selected:') && !selected.has(state.activeTab.slice(9)))
        || (state.activeTab==='all-commentaries' && !selected.size)
        || (state.activeTab.startsWith('comment:') && !state.recipe?.components.some(part=>state.activeTab==='comment:'+part.id)))
        await setReadingMode(state,'source',new Map())
      toolsDialog.close()
    }),button('הצג פירושים',() => apply('commentaries')),
      button('יצירת פירוש משולב',() => {
        state.selectedCommentaries=[...selected]
        toolsDialog.close()
        return editComposition(state,available)
      }))
    content.append(choices,actions)
  } catch (error) {
    report.textContent = error.name === 'TimeoutError' ? 'ספריא לא השיבה בזמן. נסה לפתוח קטע קצר יותר.' : error.message || 'טעינת הפירושים נכשלה.'
  }
}

async function saveCommentTabs(state) {
  await write(state.tabsKey,{selected:state.selectedCommentaries,recipe:state.recipe,edits:state.edits,
    overrideSelection:state.overrideSelection})
  refreshCommentTabs(state)
}

function combinedRecipe(state, tab = state.activeTab) {
  return tab==='combined' ? state.recipe : state.recipes.get(tab)
}

function refreshCommentTabs(state) {
  if (!state.tabs) return
  const add = (label,id,run) => {
    const tab=button(label,async () => {
      if (state.activeTab===id) return
      tab.disabled=true
      try { await run() } finally { tab.disabled=false }
    })
    tab.setAttribute('aria-pressed',String(id===state.activeTab))
    state.tabs.append(tab)
  }
  state.tabs.replaceChildren()
  state.article.style.fontFamily = fonts[combinedRecipe(state)?.font] || ''
  state.tabs.hidden = !state.selectedCommentaries.length && !state.recipe && !state.phoneTabs.length && !state.recipes.size
  if (state.tabs.hidden) return
  add('מקור','source',() => setReadingMode(state,'source',new Map()))
  for (const name of state.selectedCommentaries) {
    add(name,'selected:'+name,async () => {
      const result=await selectCommentaries(await commentaries(state.refs,state.rows),[name])
      if (!result.size) throw new Error('ספריא לא החזירה טקסט לפירוש הזה.')
      if (reader===state) await setReadingMode(state,'commentaries',result,'selected:'+name)
    })
  }
  if (state.selectedCommentaries.length) add('כל הפירושים','all-commentaries',async () => {
    const result=await selectCommentaries(await commentaries(state.refs,state.rows),state.selectedCommentaries)
    if (!result.size) throw new Error('ספריא לא החזירה טקסט לפירושים שנבחרו.')
    if (reader===state) await setReadingMode(state,'commentaries',result,'all-commentaries')
  })
  const shown=new Set(state.selectedCommentaries)
  const ids=new Set()
  const parts=[...(state.recipe?.components || []),...state.phoneTabs]
  for (const component of parts) {
    const id='comment:'+component.id
    if (ids.has(id) || (shown.has(component.name) && state.activeTab!==id)) continue
    ids.add(id)
    shown.add(component.name)
    add(component.name,id,async () => {
      const result=await syncedComposition({layout:'commentary',components:[component]},state.refs,state.rows)
      if (reader===state) await setReadingMode(state,result.mode,result.extras,id)
    })
  }
  const recipes = [...state.recipes]
  if (state.recipe && state.recipe.layout!=='commentary') recipes.push(['combined',state.recipe])
  for (const [id,recipe] of recipes) {
    add(recipe.title || 'פירוש משולב',id,async () => {
      const result=await syncedComposition(recipe,state.refs,state.rows)
      if (reader===state) await setReadingMode(state,result.mode,result.extras,id,result.sourceStyle)
    })
  }
  if (combinedRecipe(state)) state.tabs.append(button('עריכת משולב',() => editComposition(state,undefined,state.activeTab)))
}

async function editComposition(state,available, tab = 'combined') {
  const old = combinedRecipe(state,tab)
  const content=readerDialog(old?'עריכת פירוש משולב':'יצירת פירוש משולב')
  const feedback=node('p','טוען פירושים…',{role:'status'})
  content.append(feedback)
  try {
    available ||= await commentaries(state.refs,state.rows).catch(error=>{if (!old) throw error;return new Map()})
    if (reader!==state || !toolsDialog.open || !feedback.isConnected) return
    const candidates=new Map()
    for (const [name,byRow] of available) {
      const id=[...byRow.values()].flat().find(link=>link.id)?.id
      if (id && !candidates.has(id)) candidates.set(id,{id,name,style:{}})
    }
    if (torahReferences(state.refs) && !candidates.has('Onkelos'))
      candidates.set('Onkelos',{id:'Onkelos',name:'אונקלוס',style:{}})
    const ordered=(old?.components || []).map(part=>({...part,style:{...part.style}}))
    const sourceStyle={...old?.sourceStyle}
    if (!old) for (const name of [...new Set([...state.selectedCommentaries,...state.phoneTabs.map(part=>part.name)])]) {
      const part=[...candidates.values()].find(candidate=>candidate.name===name)
      if (part) ordered.push({...part,style:{}})
    }
    const labeled=(text,control) => {
      const label=node('label',text)
      label.append(control)
      return label
    }
    const select=(options,value)=>{
      const control=node('select','')
      control.append(...options.map(([key,label])=>node('option',label,{value:key})))
      control.value=value
      return control
    }
    const title=node('input','',{value:old?.title||'פירוש משולב',maxLength:100})
    const layout=select([['verse','אחרי הפסוק'],['quotes','לפי ציטוטים'],...(old?.layout==='whole'?[['whole','אחרי הפסוק במלואו']]:[])],old?.layout||'verse')
    const font=select([['','גופן הקריאה'],['system','גופן מערכת'],['serif','גופן ספרותי'],
      ['sans','ללא תגים'],['david_libre','דוד ליברה'],['semi_stam','שלמה סמי־סת״ם']],old?.font||'')
    const choice=select([['','בחר פירוש'],...[...candidates.values()].map(part=>[part.id,part.name])],'')
    const list=node('div','')
    const appearance=(field,style,commentary)=>{
        const options=[['bold','מודגש',false],['italic','נטוי',false],['stripNiqqud','הסר ניקוד',false]]
        if (commentary) options.push(['inline','באותה שורה',false],['showName','הצג שם',true])
        for (const [key,label,fallback] of options) {
          const box=node('input','',{type:'checkbox',checked:style[key]??fallback})
          box.onchange=()=>{style[key]=box.checked}
          const labelRow=labeled(label,box);labelRow.className='check';field.append(labelRow)
        }
        for (const [key,label] of [['color','צבע טקסט'],['background','צבע רקע']]) {
          const color=node('input','',{type:'color',value:'#'+((style[key] || 0) & 0xffffff).toString(16).padStart(6,'0')})
          color.onchange=()=>{style[key]=(0xff000000|parseInt(color.value.slice(1),16))}
          field.append(labeled(label,color),button('איפוס '+label,()=>{delete style[key];color.value='#000000'}))
        }
        const sizes=[.8,1,1.15,1.3,1.5]
        if (style.scale && !sizes.includes(style.scale)) sizes.push(style.scale)
        const scale=select(sizes.sort((a,b)=>a-b).map(value=>[value,Math.round(value*100)+'%']),style.scale||1)
        scale.onchange=()=>{style.scale=Number(scale.value)}
        field.append(labeled('גודל יחסי',scale))
        if (!commentary) return
        const detect=select([['auto','אוטומטי'],['pointed','לפי ניקוד'],['line','תחילת שורה'],['opening','דיבור מתחיל']],style.detect||'auto')
        detect.onchange=()=>{style.detect=detect.value}
        field.append(labeled('זיהוי ציטוט',detect))
    }
    const sourceAppearance=node('details','')
    sourceAppearance.append(node('summary','עיצוב המקור'))
    appearance(sourceAppearance,sourceStyle,false)
    const render=()=>{
      list.replaceChildren()
      ordered.forEach((part,index)=>{
        const field=node('fieldset','')
        field.append(node('legend',part.name))
        const row=node('div','',{className:'inline'})
        const move=(delta)=>{[ordered[index],ordered[index+delta]]=[ordered[index+delta],ordered[index]];render()}
        const up=button('העלה',()=>move(-1)), down=button('הורד',()=>move(1))
        up.disabled=index===0;down.disabled=index===ordered.length-1
        row.append(up,down,button('הסר',()=>{ordered.splice(index,1);render()}))
        field.append(row)
        appearance(field,part.style,true)
        list.append(field)
      })
    }
    const actions=node('div','',{className:'inline'})
    const perform=async (previewOnly) => {
      if (save.disabled) return
      if (!ordered.length || !title.value.trim()) { feedback.textContent='הזן שם ובחר לפחות פירוש אחד.';return }
      const recipe={title:title.value.trim(),layout:layout.value,font:font.value,sourceStyle,components:ordered}
      save.disabled=previewButton.disabled=true
      feedback.textContent='טוען את הטקסטים…'
      try {
        const result=await syncedComposition(recipe,state.refs,state.rows)
        if (reader!==state || !toolsDialog.open) return
        if (previewOnly) {
          const first=result.extras.entries().next().value
          const preview=node('div','',{className:'reader'})
          preview.style.fontFamily=fonts[recipe.font] || ''
          if (first) {
            const original=node('p',displayReadingText(state.rows[first[0]].text,sourceStyle))
            applyComponentStyle(original,sourceStyle)
            preview.append(original)
            for (const [name,value,style] of first[1]) {
              const note=node('p',(style?.showName===false?'':name+' · ')+displayReadingText(value,style))
              applyComponentStyle(note,style);preview.append(note)
            }
          }
          content.querySelector('.composition-preview')?.remove()
          preview.classList.add('composition-preview')
          content.append(preview);feedback.textContent='תצוגה מקדימה';preview.scrollIntoView({block:'nearest'})
          return
        }
        if (state.recipes.has(tab)) {
          state.edits[tab]=recipe
          state.recipes.set(tab,recipe)
        } else state.recipe=recipe
        await saveCommentTabs(state)
        await setReadingMode(state,result.mode,result.extras,tab,result.sourceStyle)
        toolsDialog.close()
      } catch(error) { feedback.textContent=error.message }
      finally { save.disabled=previewButton.disabled=false }
    }
    const save=button('שמור משולב',()=>perform(false),'primary')
    const previewButton=button('תצוגה מקדימה',()=>perform(true))
    actions.append(choice,button('הוסף פירוש',()=>{
      if (!choice.value || ordered.some(part=>part.id===choice.value)) return
      ordered.push({...candidates.get(choice.value),style:{}});choice.value='';render()
    }))
    feedback.textContent=''
    content.append(labeled('שם המשולב',title),labeled('אופן השילוב',layout),labeled('גופן המשולב',font),sourceAppearance,actions,list,previewButton,save)
    render()
  } catch(error) { feedback.textContent=error.message || 'טעינת הפירושים נכשלה.' }
}

async function setReadingMode(state, mode, extras, activeTab = 'source', sourceStyle) {
  const offset = currentOffset(state)
  stopSpeech()
  state.mode = mode
  state.activeTab = activeTab
  state.sourceStyle = sourceStyle
  state.extras = extras
  refreshCommentTabs(state)
  state.article.dataset.readingMode = mode
  jumpTo(state,offset)
  await write(state.modeKey,{mode,extras:[...extras],activeTab,sourceStyle,commentaries:state.selectedCommentaries || []})
}

function updateFullscreen(state, active) {
  document.body.classList.toggle('reading-fullscreen',active)
  positionArrows(state)
  setToolLabel(state.fullscreen,active?'exit':'fullscreen',active?'יציאה ממסך מלא':'מסך מלא')
  $('#reader-dialog-exit').hidden = !active
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

function setToolLabel(control, icon, label) {
  const caption = node('span',label,{className:'tool-label'})
  control.replaceChildren(readerIcon(icon),caption)
  control.setAttribute('aria-label',label)
  control.title = label
}

function iconTool(icon,label,action,className='') {
  const control = button('',action,'icon-tool '+className)
  setToolLabel(control,icon,label)
  return control
}

function readerHome() {
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close()
  location.hash = 'home'
}

async function shareContent(data) {
  if (navigator.share) {
    try { await navigator.share(data); return }
    catch (error) { if (error.name==='AbortError') return }
  }
  const value = [data.text,data.url].filter(Boolean).join('\n')
  try {
    await navigator.clipboard.writeText(value)
    status(data.url ? 'הקישור הועתק.' : 'הטקסט הועתק.')
  } catch {
    const content = readerDialog('שיתוף')
    const field = node('textarea',value,{readOnly:true,rows:5})
    field.setAttribute('aria-label','תוכן להעתקה')
    content.append(field)
    field.select()
  }
}

function movementTools(state) {
  const tabs = [...state.tabs.querySelectorAll('button[aria-pressed]')]
  const current = tabs.findIndex(tab=>tab.getAttribute('aria-pressed')==='true')
  const tools = []
  if (tabs.length) {
    const go = (index,icon,label)=>{
      const control = iconTool(icon,label,()=>tabs[index]?.click())
      control.disabled = !tabs[index] || index===current
      return control
    }
    tools.push(go(0,'source','חזרה למקור'),go(current-1,'previous','הפירוש הקודם'),go(current+1,'next','הפירוש הבא'))
  }
  return tools
}

function readingTools(state) {
  state.arrows = node('div','')
  bindArrowDrag(state,state.arrows)
  const appearance = () => readingSettings.showModal()
  const aloud = iconTool('audio','הקראה',()=>readAloud(state,aloud),'reader-speech')
  state.fullscreen = iconTool('fullscreen','מסך מלא',()=>toggleFullscreen(state),'reader-fullscreen')
  state.fullscreen.setAttribute('aria-pressed','false')
  const menu = iconTool('tools','כלי קריאה',() => {
    const controls = [
      iconTool('home','בית',readerHome),
      iconTool(document.body.classList.contains('reading-fullscreen')?'exit':'fullscreen',
        document.body.classList.contains('reading-fullscreen')?'יציאה ממסך מלא':'מסך מלא',()=>toggleFullscreen(state)),
      iconTool('tools','הגדרות קריאה',appearance),
      iconTool('search','חיפוש בטקסט',()=>findInReader(state)),
      iconTool('bookmark','סימניות',()=>showBookmarks(state)),
      iconTool('mark','סימון מיקום',async()=>{await pin(state,currentOffset(state));status('מיקום הקריאה סומן.')}),
      iconTool('history','המיקום האחרון',()=>jumpTo(state,state.mark)),
      iconTool('share','שיתוף הטקסט',()=>shareContent({title:state.entry.title,text:window.getSelection()?.toString()||state.raw})),
      iconTool(speaking?.state===state?'stop':'audio',speaking?.state===state?'עצירת הקראה':'הקראה',()=>readAloud(state,aloud)),
      iconTool('type',preferences.addressStyle==='hidden'?'הצגת מראי מקום':'הסתרת מראי מקום',()=>{
        preferences.addressStyle=preferences.addressStyle==='hidden'?'numbers':'hidden'
        return saveDesign('addressStyle')
      }),
      iconTool('type',preferences.vocalization==='all'?'הסתרת טעמים':'הצגת טעמים',()=>{
        preferences.vocalization=preferences.vocalization==='all'?'vowels':'all'
        return saveDesign('vocalization')
      }),
      iconTool('mark',preferences.autoPosition?'השהיית סימון אוטומטי':'הפעלת סימון אוטומטי',()=>{
        preferences.autoPosition=!preferences.autoPosition
        return saveDesign('autoPosition')
      }),
      iconTool('sync','סנכרון עכשיו',syncNow),
      ...movementTools(state)
    ]
    if (speaking?.state===state) for (const delta of [-.1,.1]) controls.push(
      iconTool(delta<0?'minus':'plus',delta<0?'האטת הקראה':'האצת הקראה',async()=>{
        preferences.speechRate=Math.round(Math.min(2,Math.max(.6,preferences.speechRate+delta))*10)/10
        await saveDesign('speechRate')
        status('הקטע הבא יוקרא במהירות ×'+preferences.speechRate)
      }))
    if (state.refs.length) controls.push(
      iconTool('list','בחירת פירושים לטאבים',()=>readingCommentaries(state)),
      iconTool('notes','פירושים לפי פסוק',()=>passageCommentaries(state)),
      iconTool('combined','פירוש משולב',()=>editComposition(state,undefined,combinedRecipe(state)?state.activeTab:'combined')))
    if (state.entry.type==='prayer' && state.rows.some(row=>row.sourceRef)) controls.push(
      iconTool('notes','מקורות ופירושים בסידור',()=>siddurSources(state)),
      iconTool('type',state.siddurAccents?'הסתרת טעמי המקור':'טעמי המקרא בציטוטים',()=>toggleSiddurAccents(state)))
    if (state.entry.type==='daily') controls.push(iconTool('previous','הצג סוף הלימוד הקודם',()=>showPreviousStudy(state)))
    if (torahReferences(state.refs)) controls.push(iconTool('source','שניים מקרא ואחד תרגום',async()=>{
      if (state.mode==='shnayim') { await setReadingMode(state,'source',new Map()); return }
      const translation=await onkelos(state.refs,state.rows)
      if (reader===state) await setReadingMode(state,'shnayim',new Map([...translation].map(([row,value])=>[row,[['אונקלוס',value]]])))
    }))
    const items = node('div','',{className:'reading-tool-grid'})
    items.append(...controls)
    controls.forEach(control=>control.addEventListener('click',()=>toolsDialog.close(),{capture:true}))
    readerDialog('כלי קריאה').append(items)
  })
  return [iconTool('home','בית',readerHome,'reader-home'),menu,state.fullscreen,state.arrows,aloud]
}

$('#reader-dialog-home').replaceChildren(readerIcon('home'))
$('#reader-dialog-home').onclick = readerHome
$('#reader-dialog-exit').replaceChildren(readerIcon('exit'))
$('#reader-dialog-exit').onclick = () => {
  toolsDialog.close()
  if (reader && document.body.classList.contains('reading-fullscreen')) protect(()=>toggleFullscreen(reader))
}
$('#share-site').onclick = () => protect(()=>shareContent({title:'קידומן',url:document.querySelector('link[rel=canonical]').href}))
$('.skip').onclick = event => {
  event.preventDefault()
  $('#main').focus()
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
  if (property==='width') positionArrows(reader)
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
