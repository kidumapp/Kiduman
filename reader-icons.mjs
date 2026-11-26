// 24-unit geometry from Android ReadingToolIcon and CantillationIconPaths.
const gear = Array.from({length:8},(_,i)=>{
  const angle=i*Math.PI/4
  return 'M'+(16+Math.cos(angle)*4)+' '+(16+Math.sin(angle)*4)+'L'+
    (16+Math.cos(angle)*6)+' '+(16+Math.sin(angle)*6)
}).join('')
const page = (left,right) => `M${left} 19V5Q${(left+right)/2} 3 ${right} 7V21Q${(left+right)/2} 18 ${left} 19`
const fullscreen = 'M8 3H3V8M16 3H21V8M8 21H3V16M16 21H21V16'
const close = 'M6 6L18 18M18 6L6 18'
const paths = {
  back:'M4 12H20L13 5M20 12L13 19',
  'day-previous':'M7 4L19 12 7 20Z',
  'day-next':'M17 4L5 12 17 20Z',
  home:'M2 11 12 2 22 11M5 9V22H10V15H14V22H19V9',
  tools:'M5 3V6M5 10V21M12 3V13M12 17V21M19 3V6M19 10V21M3 8a2 2 0 1 0 4 0a2 2 0 1 0-4 0M10 15a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 8a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  fullscreen,exit:fullscreen,close,
  help:'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M8 9.5A4 3.5 0 1 1 14.57 12.18M12 13V15M12 19h.01',
  search:'M3.5 10a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0M15 15L22 22',
  bookmark:'M6 3H18V22L12 17 6 22Z',
  mark:'M4 20 9 19 21 7 17 3 5 15ZM14 6L18 10',
  auto:'M20 4V20M5 6H16M5 11H16M5 17L9 21 16 13',
  source:page(3,12)+page(12,21)+'M12 5V21',
  list:'M5 3H16Q18 3 18 5V15Q18 17 16 17H5Q3 17 3 15V5Q3 3 5 3ZM6 7H15M6 11H15M7 21H21V7',
  combined:'M5 3H16Q18 3 18 5V15Q18 17 16 17H5Q3 17 3 15V5Q3 3 5 3ZM6 7H15M6 11H15M7 21H21V7',
  notes:'M5 3H16Q18 3 18 5V15Q18 17 16 17H5Q3 17 3 15V5Q3 3 5 3ZM6 7H15M6 11H15M7 21H21V7',
  next:'M19 12H5L12 5M5 12L12 19',
  previous:'M5 12H19L12 5M19 12L12 19',
  up:'M7 15L12 10 17 15',down:'M7 10L12 15 17 10',
  history:'M6 22V3H19L16 8 19 13H6',
  audio:'M3 21V3H12L16 7V11M12 3V7H16M6 9H11M6 12H9M3 21H10M11 15H14L17 12V22L14 19H11ZM21.51 12.9A3.5 5 0 0 1 21.51 21.1',
  stop:'M8 5V19M16 5V19',
  share:'M2.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M16.5 5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M16.5 19a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M7 11L17 6M7 13L17 18',
  minus:'M5 12H19',plus:'M5 12H19M12 5V19',
  sync:'M19.25 15.38A8 8 0 1 1 16.59 5.45M20 7V12H15',
  prayer:'M9.5 5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M3 5 7 12H17L21 5M12 12V18L8 22M12 18L16 22',
  appearance:'M3.5 2H12.5Q14 2 14 3.5V20.5Q14 22 12.5 22H3.5Q2 22 2 20.5V3.5Q2 2 3.5 2ZM5 6H11M5 10H9M12 16a4 4 0 1 0 8 0a4 4 0 1 0-8 0M14.6 16a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0'+gear,
  headings:'M3 5H21M3 11H21M3 16H21M3 21H15',
  footnotes:'M5 12H19M8.5 5.94L15.5 18.06M15.5 5.94L8.5 18.06'
}
const svgNS = 'http://www.w3.org/2000/svg'

export function readerIcon(name) {
  const svg = document.createElementNS(svgNS,'svg')
  svg.setAttribute('viewBox','0 0 24 24')
  svg.setAttribute('aria-hidden','true')
  svg.setAttribute('focusable','false')
  const element = (tag,properties)=>{
    const part=document.createElementNS(svgNS,tag)
    for (const [key,value] of Object.entries(properties)) part.setAttribute(key,value)
    svg.append(part)
    return part
  }
  if (name==='passage')
    element('text',{x:12,y:12,'dominant-baseline':'central','text-anchor':'middle','font-size':23,'font-family':'sans-serif','font-weight':'bold',class:'icon-fill'}).textContent='פ'
  else if (name==='type') {
    element('path',{d:'M47 -228 50 -179H150V-84L200 -81V-228Z',transform:'translate(17 16) scale(.054 -0.054) translate(-123.5 154.5)',class:'icon-fill'})
    element('path',{d:'M85 767Q48 767 48 810Q48 852 85 852Q123 852 123 810Q123 767 85 767ZM84 646Q46 646 46 689Q46 731 84 731Q122 731 122 689Q122 646 84 646Z',transform:'translate(7 7) scale(.0437 -0.0437) translate(-84.5 -749)',class:'icon-fill'})
  } else element('path',{d:paths[name],...(name.startsWith('day-')?{class:'icon-fill'}:{})})
  return svg
}
