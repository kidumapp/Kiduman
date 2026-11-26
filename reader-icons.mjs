const paths = {
  home:'M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5',
  tools:'M4 5h16M4 12h16M4 19h16M9 3v4m6 3v4m-7 3v4',
  fullscreen:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  exit:'M3 8h5V3m13 5h-5V3M8 21v-5H3m13 5v-5h5',
  close:'m5 5 14 14M19 5 5 19',
  search:'M16 16l5 5M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
  bookmark:'M6 3h12v18l-6-4-6 4Z',
  mark:'m4 14 4 4L20 6M4 21h16',
  source:'M12 6c-3-3-6-3-10-2v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-4-1-7-1-10 2v15',
  list:'M8 5h13M8 12h13M8 19h13M3 5h1m-1 7h1m-1 7h1',
  notes:'M3 4h18v13H10l-5 4v-4H3ZM7 8h10M7 12h7',
  combined:'M3 4h8v7H3Zm10 9h8v7h-8ZM17 4h4v5M3 16v4h5m-5-4h8m2-7h8',
  next:'m14 5-7 7 7 7',
  previous:'m10 5 7 7-7 7',
  history:'M3 12a9 9 0 1 1 2 6m-2-2v5h5m4-14v5l3 2',
  audio:'M3 9v6h4l5 4V5L7 9H3m13 0a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12',
  stop:'M6 6h12v12H6Z',
  share:'M12 16V3m-5 5 5-5 5 5M5 12H3v9h18v-9h-2',
  type:'M3 18 8 6l5 12M5 14h6m4 4h6m-3-9v9',
  minus:'M4 12h16',
  plus:'M4 12h16m-8-8v16',
  sync:'M20 10a8 8 0 0 0-14-4L3 9m0-6v6h6m-5 5a8 8 0 0 0 14 4l3-3m0 6v-6h-6'
}

export function readerIcon(name) {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns,'svg')
  svg.setAttribute('viewBox','0 0 24 24')
  svg.setAttribute('aria-hidden','true')
  svg.setAttribute('focusable','false')
  const path = document.createElementNS(ns,'path')
  path.setAttribute('d',paths[name])
  svg.append(path)
  return svg
}
