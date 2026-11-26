import {prayerClock, siddurDay} from './siddur-day.mjs'

export {prayerClock,siddurDay}
export const prayerNames = {
  shacharit:'שחרית', mincha:'מנחה', arvit:'ערבית', musaf:'מוסף',
  birkatHamazon:'ברכת המזון', meeinShalosh:'מעין שלוש', bedtimeShema:'קריאת שמע על המיטה',
  havdalah:'הבדלה ופיוטים', praiseBlessings:'ברכות השבח', mitzvahBlessings:'ברכות המצוות', travelPrayer:'תפילת הדרך'
}
export const weekdayPrayers = ['shacharit','mincha','arvit']
const requests = new Map()

function request(name, type) {
  if (!requests.has(name)) requests.set(name,(async()=>{
    const response = await fetch(new URL('./siddur-data/'+name,import.meta.url))
    if (!response.ok) throw new Error('נתוני הסידור לא נטענו.')
    if (name.endsWith('.json')) return response.json()
    const decoded = new Response(response.body.pipeThrough(new DecompressionStream('gzip')))
    return type==='binary' ? new DataView(await decoded.arrayBuffer()) : decoded.json()
  })().catch(error=>{requests.delete(name);throw error}))
  return requests.get(name)
}

export const loadSiddurCalendar = () => request('calendar.bin','binary')

const publicRow = condition => condition.split('&').includes('congregation')
const amidahNames = ['Amidah','Amida','Mussaf']
const accentMarks = /[\u0591-\u05af]/gu

function amidahCondition(prayer, nusach, slot, original) {
  if (prayer==='mincha') {
    const [start,end] = {ashkenaz:[60,62],sefard:[72,75],mizrach:[31,33]}[nusach]
    if (slot >= start && slot < end) return 'tishaBav'
    if (slot===end) return '!tishaBav'
    if (nusach==='ashkenaz' && slot>=65 && slot<=66) return 'fast'
    if (nusach==='sefard' && slot>=47 && slot<=48 || nusach==='mizrach' && slot>=17 && slot<=19) return 'fast&congregation'
    if (nusach==='ashkenaz' && slot===40) return 'never'
  }
  if (prayer==='shacharit') {
    if (nusach==='ashkenaz' && slot===39 || nusach==='sefard' && slot===47) return 'never'
    if (nusach==='mizrach' && slot>=18 && slot<=20) return 'fast&congregation'
  }
  if (prayer==='arvit' && nusach==='mizrach' && slot===31) return 'tishaBav'
  return original
}

export function projectPrayer(edition, nusach, prayer, day, options) {
  const result = []
  const service = prayer==='musaf' ? 'shacharit' : prayer
  const {publicPrayer,meal,expanded}=options
  const includes = condition => condition.split('&').every(value=>{
    if (value==='mealWedding') return meal==='wedding'
    if (value==='mealBrit') return meal==='brit'
    if (value==='mealSpecial') return meal==='wedding' || meal==='brit'
    if (value.startsWith('!meal')) return !includes(value.slice(1))
    return day.includes(value)
  })
  for (const [sectionIndex,[name,label,condition,optional,rows]] of edition[service].entries()) {
    if (prayer==='musaf' && name!=='Mussaf' || !includes(condition)) continue
    if (!publicPrayer && (name.includes('Kaddish') || name==='Barchu' || name.includes('Torah Reading') || name==='Returning Sefer Torah')) continue
    if (["Additions for Motza'ei Shabbat",'Motzaei Shabbat'].includes(name) && !day.includes('motzaeiShabbat')) continue
    let order = 0
    const position = () => sectionIndex * 2048 + order++
    const heading = (text,toggle) => result.push({text,heading:true,stable:position(),toggle})
    const append = (body, includePublic=publicPrayer, start=0) => body.forEach((row,index)=>{
      const stable=position()
      let [rule,text,noteRanges,wedding]=typeof row==='string'?['',row]:row
      if (meal==='wedding' && wedding!==undefined) {text=wedding;noteRanges=null}
      if (name==='Amidah' || name==='Amida') rule=amidahCondition(service,nusach,start+index,rule)
      if (!day.includes('repentance')) {
        const normalized=text.replace(/[\u0591-\u05bd\u05bf-\u05c7]/gu,'')
        if ((rule==='note' || ['אם ','בכל השנה','בעשי','בעשרת ימי תשובה'].some(prefix=>normalized.startsWith(prefix))) &&
            (normalized.includes('בעשי') || normalized.includes('עשרת ימי תשובה'))) return
        const ordinary=text.replace(/\s*\([^()]*בעש[י״"׳']+[^()]*\)/gu,'')
        if (ordinary!==text) {text=ordinary; noteRanges=null}
        if (publicRow(rule) && text.includes('בעשי')) {text=text.slice(0,text.indexOf('בעשי')).trim();noteRanges=null}
      }
      const note=rule==='note'
      if (!text || !note && !includes(rule) || publicRow(rule) && !includePublic) return
      result.push({text,stable,note,noteRanges,rain:rule==='mentionRain'||rule==='askRain'})
    })
    const part = (from,to,title,includePublic=publicPrayer)=>{
      heading(title)
      append(rows.slice(from,to),includePublic,from)
    }
    const expandable = optional || name.includes('Korbanot') || ['Offerings','Incense Offering'].includes(name) || name.startsWith('VeYir')
    const open = !expandable || expanded.has(name)
    heading(label,expandable ? name : undefined)
    if (service==='mincha' && ['Korbanot','Offerings'].includes(name)) {
      const sefard=nusach==='sefard', ashrei=sefard?22:11, kaddish=sefard?23:14
      if (rows.length<=kaddish) { if (open) append(rows); continue }
      if (open) {
        if (!sefard) { part(1,2,'לשם ייחוד');part(2,3,'למנצח על הגיתית') }
        part(sefard?0:3,sefard?3:4,'פרשת התמיד')
        part(sefard?3:4,sefard?13:ashrei,'פטום הקטורת')
        if (sefard) part(13,ashrei,'תפילת רבי נחוניא בן הקנה')
      } else order += sefard ? 25 : 14
      part(ashrei,kaddish,'אשרי')
      if (publicPrayer) part(kaddish,rows.length,'חצי קדיש')
      continue
    }
    if (!open) continue
    if (name==='Song of the Day' && rows.length>=4 && nusach==='sefard') {
      append(rows.slice(0,3))
      heading('הושיענו')
      const friday = edition.shacharit.find(section=>section[0]===name && section[2]==='!rosh&weekday6')
      append([Array.isArray(rows[3]) ? friday?.[4][3] ?? rows[3] : rows[3],...rows.slice(4)])
      continue
    }
    if (service==='shacharit' && name==='Korbanot (Israel)' && rows.length===19) {
      part(0,1,'קוה אל ה׳');part(1,2,'אין כאלהינו');part(2,5,'פטום הקטורת');part(5,7,'דברי חז״ל')
      if (publicPrayer) {part(7,15,'קדיש דרבנן');part(15,19,'ברכו')}
      continue
    }
    if (nusach==='sefard' && service==='shacharit' && ['Morning Prayer','Korbanot'].includes(name)) {
      const offerings=name==='Korbanot'
      const starts=offerings?[0,2,4,10,20,21,23,26]:[0,4,8,12]
      const titles=offerings?['פרשת הכיור','תרומת הדשן','פרשת התמיד','פטום הקטורת','סדר המערכה','תפילת רבי נחוניא בן הקנה','ריבון העולמים','איזהו מקומן']
        :['עקדת יצחק','לעולם יהא אדם','שמע ישראל','אתה הוא עד שלא נברא העולם']
      starts.forEach((start,index)=>{if(start<rows.length) part(start,starts[index+1]??rows.length,titles[index])})
      continue
    }
    const amidah=amidahNames.includes(name)
    append(rows,publicPrayer && (!amidah || service==='arvit'))
    if (amidah && publicPrayer && service!=='arvit' && rows.some(row=>Array.isArray(row)&&publicRow(row[0]))) {
      const key='repetition:'+name
      const repeat=expanded.has(key)
      heading(repeat?'חזרת הש״ץ':'להציג חזרת הש״ץ?',key)
      if (repeat) append(rows,true)
    }
  }
  return result
}

export function displayPrayerRow(row, accents) {
  let from=0, value=''
  if (accents) {
    for (const [position,mark] of row.accents || []) {
      value += row.text.slice(from,position)+mark
      from=position
    }
    return value+row.text.slice(from)
  }
  return row.text.replace(accents === false ? accentMarks : /$^/gu,'')
}

async function digest(value) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('')
}

export async function bundledPrayer(nusach, prayer, day, options) {
  const [edition,links,travel] = await Promise.all([request(nusach+'.bin'),request(nusach+'-sources.bin'),
    prayer==='travelPrayer'?request('travel.json'):null])
  const journey=travel?.[nusach]
  const rows=journey ? [{text:journey.text,stable:0}] : projectPrayer(edition,nusach,prayer,day,options)
  await Promise.all(rows.map(async row=>{
    if (row.heading || row.note) return
    const match=links[await digest(row.text)]
    if (match) [row.linkedSources,row.accents]=match
  }))
  return {rows, version:journey?.version || edition.source.versionTitle,license:journey?.license || edition.source.license,
    sourceRef:journey?.ref || edition.source.title,
    hasAccents:rows.some(row=>row.accents?.length || /[\u0591-\u05af]/u.test(row.text))}
}
