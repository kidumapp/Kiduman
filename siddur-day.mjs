const DAY = 86400000
const conditions = ['rosh','chol','pesach','sukkot','chanukah','hallel','fullHallel','fast',
  'tishaBav','mentionRain','askRain','repentance','tachanun','regularTorah','yaanecha','psalm27']
const bit = (flags, index) => Boolean(flags & (1 << index))
const weekday = day => ((day + 4) % 7 + 7) % 7

export function siddurDay(table, day, israel, prayer, purimDay, motzaei) {
  const first = table.getInt32(0), end = table.getInt32(4)
  if (day < first || day >= end) throw new Error('תאריך הסידור מחוץ לטווח הנתמך.')
  const flags = table.getUint32(8 + (day - first) * 8 + (israel ? 0 : 4))
  const values = Object.fromEntries(conditions.map((name,index)=>[name,bit(flags,index)]))
  const purim = purimDay === 14 && bit(flags,18) || purimDay === 15 && bit(flags,19)
  const omer = prayer === 'arvit' ? flags >>> 20 & 63 : 0
  const chanukahDay = flags >>> 26 & 15
  Object.assign(values,{
    '':true, congregation:true, purim,
    yaaleh:values.rosh || values.chol, miracles:values.chanukah || purim,
    avinu:values.repentance || values.fast, motzaeiShabbat:prayer === 'arvit' && motzaei,
    tachanun:prayer === 'mincha' ? bit(flags,17) : values.tachanun,
    regularTorah:values.regularTorah && !purim, yaanecha:values.yaanecha && !purim,
    ['weekday'+(weekday(day)+1)]:true
  })
  values.longTachanun = values.tachanun && [1,4].includes(weekday(day))
  values.omer = Boolean(omer)
  if (omer) values['omer'+omer] = true
  if (chanukahDay && !values.rosh) values['chanukah'+chanukahDay] = true
  return {closed:bit(flags,16), musaf:values.rosh || values.chol,
    needsPurimChoice:!purimDay && (bit(flags,18) || bit(flags,19)),
    includes: condition => condition.split('&').every(part=>part.startsWith('!') ? !values[part.slice(1)] : Boolean(values[part]))}
}

const degrees = Math.PI / 180
const sin = value => Math.sin(value * degrees)
const cos = value => Math.cos(value * degrees)
const normalize = value => (value % 360 + 360) % 360

// Solar transit and hour angle, with the same 8.5° nightfall threshold as Android.
function solarTimes(day, {lat, lon}) {
  const julian = day + 2440587.5
  const mean = Math.round(julian + .5 - 2451545 + lon / 360) + .0008 - lon / 360
  const anomaly = normalize(357.5291 + .98560028 * mean)
  const ecliptic = normalize(anomaly + 1.9148 * sin(anomaly) + .02 * sin(2*anomaly) + .0003 * sin(3*anomaly) + 282.9372)
  const transit = 2451545 + mean + .0053 * sin(anomaly) - .0069 * sin(2*ecliptic)
  const declination = Math.asin(sin(ecliptic)*sin(23.44))/degrees
  const angle = altitude => Math.acos((sin(altitude)-sin(lat)*sin(declination))/(cos(lat)*cos(declination))) / (2*Math.PI)
  const crossing = (altitude, evening) => (transit + (evening ? 1 : -1)*angle(altitude) - 2440587.5) * DAY
  return {nightfall:crossing(-8.5,true) || crossing(-.833,true), dawn:crossing(-.833,false) - 72*60000,
    mincha:(transit + angle(-.833)/12 - 2440587.5)*DAY}
}

export function prayerClock(region, location, now = new Date(), zone = location || region !== 'Israel'
  ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Asia/Jerusalem') {
  const format = new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'numeric',day:'numeric',
    hour:'numeric',minute:'numeric',hourCycle:'h23'})
  const {year,month,day,hour,minute} = Object.fromEntries(format.formatToParts(now).map(part=>[part.type,Number(part.value)]))
  const civil = Date.UTC(year,month-1,day)/DAY
  const coords = location || (region === 'Israel' ? {lat:31.78,lon:35.22} : null)
  const times = coords && solarTimes(civil,coords)
  const localMinutes = hour*60 + minute
  const afterNight = Number.isFinite(times?.nightfall) ? +now >= times.nightfall : localMinutes >= 18*60+45
  const beforeDawn = Number.isFinite(times?.dawn) ? +now < times.dawn : localMinutes < 5*60
  const afterMincha = Number.isFinite(times?.mincha) ? +now >= times.mincha : hour >= 13
  return {day:civil + Number(afterNight), suggested:afterNight || beforeDawn ? 2 : afterMincha ? 1 : 0,
    motzaei:weekday(civil) === 6 && afterNight || weekday(civil) === 0 && beforeDawn,
    approximate:!Number.isFinite(times?.nightfall)}
}
