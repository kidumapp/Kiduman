const themes = {
  blue_cream: ['#fff7e6','#fffdf7','#173a5e','#516b84','#235a91'],
  blue_night: ['#081a2c','#173a5e','#fff7e6','#c8d8e8','#8ec5ff'],
  graphite: ['#17191d','#252930','#f5f5f5','#bbc1c9','#90caf9'],
  natural_green: ['#10231b','#1d3a2d','#f4f1e8','#c4d4c9','#8ed1a8'],
  soft_purple: ['#21182c','#382747','#fff5ff','#d8c3e2','#d0a8ff'],
  high_contrast: ['#000000','#151515','#ffffff','#ffffff','#ffff00']
}

export const defaults = {
  theme:'auto', font:22, region:'Israel',
  readingTheme:'auto', fontFace:'serif', width:45, spacing:1.85, justify:false,
  addressStyle:'numbers', vocalization:'all', dayPaper:'#fff7e6', nightPaper:'#081a2c',
  dayInk:'', nightInk:'', arrows:'edge', arrowLayout:'both', autoPosition:true, speechRate:1
}

export const readFields = [
  'readingTheme','font','fontFace','width','spacing','justify','addressStyle','vocalization',
  'dayPaper','nightPaper','arrows','arrowLayout','autoPosition','speechRate'
]

const systemDark = matchMedia('(prefers-color-scheme: dark)')
const brightness = color => {
  const components = color.slice(1).match(/../g).map(part => parseInt(part,16) / 255)
    .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  return components[0] * .2126 + components[1] * .7152 + components[2] * .0722
}
const controlInk = color => brightness(color) > .179 ? '#000000' : '#ffffff'
const paperColor = (color, fallback) => /^#[0-9a-f]{6}$/i.test(color) ? color : fallback
const fonts = {system:'system-ui,sans-serif', serif:'Georgia,"Times New Roman",serif', sans:'Arial,sans-serif', david_libre:'Kiduman David Libre,serif', semi_stam:'Kiduman SemiStam,serif'}

export function readerNight(prefs) {
  if (prefs.readingTheme === 'day') return false
  if (prefs.readingTheme === 'night') return true
  if (prefs.readingTheme === 'app') return themeId(prefs.theme) !== 'blue_cream'
  return systemDark.matches
}

function themeId(value) {
  if (themes[value]) return value
  return value === 'dark' || (value === 'auto' && systemDark.matches) ? 'blue_night' : 'blue_cream'
}

export function applyDesign(prefs, root = document.documentElement) {
  const theme = themeId(prefs.theme)
  const [bg, surface, ink, muted, accent] = themes[theme]
  const dark = theme !== 'blue_cream'
  const night = readerNight(prefs)
  const nightKey = night ? 'night' : 'day'
  const paper = prefs.readingTheme === 'app' ? bg : paperColor(prefs[nightKey + 'Paper'], defaults[nightKey + 'Paper'])
  const text = paperColor(prefs[nightKey + 'Ink'], controlInk(paper))
  root.style.colorScheme = dark ? 'dark' : 'light'
  const themeVars = {
    '--bg':bg,'--paper':surface,'--ink':ink,'--muted':muted,'--accent':accent,'--on-accent':controlInk(accent),
    '--line':`color-mix(in srgb, ${ink} 23%, ${surface})`, '--soft':`color-mix(in srgb, ${accent} 12%, ${surface})`,
    '--reader-paper':paper,'--reader-ink':text,'--reader-address':controlInk(paper),
    '--reader-size':prefs.font + 'px','--reader-width':prefs.width + 'rem',
    '--reader-spacing':prefs.spacing,'--reader-font':fonts[prefs.fontFace] || fonts.serif,
    '--reader-align':prefs.justify ? 'justify' : 'start'
  }
  for (const [name,value] of Object.entries(themeVars)) root.style.setProperty(name,value)
  document.querySelector('meta[name=theme-color]').content = bg
}

export function watchSystemTheme(refresh) {
  systemDark.addEventListener('change', refresh)
}

const letters = 'אבגדהוזחטיכלמנסעפצקרשת'
const values = [1,2,3,4,5,6,7,8,9,10,20,30,40,50,60,70,80,90,100,200,300,400]
function hebrewNumber(number) {
  if (number < 1 || number >= 1000) return String(number)
  let result = ''
  for (let i = values.length - 1; i >= 0; i--) {
    if (number === 15 || number === 16) return result + (number === 15 ? 'טו' : 'טז')
    while (number >= values[i]) {
      result += letters[i]
      number -= values[i]
    }
  }
  return result
}

export function readingAddress(value, style) {
  if (!value || style === 'hidden') return ''
  return style === 'hebrew' ? value.replace(/\b\d+\b/g, number => hebrewNumber(Number(number))) : value
}

export function readingText(value, vocalization) {
  if (vocalization === 'plain') return value.replace(/[\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7]/g, '')
  if (vocalization === 'vowels') return value.replace(/[\u0591-\u05af]/g, '')
  return value
}

export const searchText = value => readingText(value, 'plain').trim().toLocaleLowerCase()
