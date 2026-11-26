const prefix = 'kiduman-web:'
const version = prefix + 'shell-v22'
const shell = ['./', './index.html', './about.html', './siddur.html', './daily-study.html', './library.html', './reading-sync.html', './last-study.html', './styles.css?v=12', './styles.css?v=15', './tefilat-haderech.html', './siddur-sefard.html', './daf-yomi.html', './mishnah-yomit.html', './app.mjs?v=18', './reader-ui.mjs?v=6', './kiduman.png', './data.mjs?v=5', './sync.mjs?v=6', './reader-content.mjs?v=7', './DavidLibre-Regular.ttf', './ShlomoSemiStam.ttf', './travel-prayer.json', './reader-icons.mjs?v=3', './siddur-sources.mjs?v=2',
  './siddur-data/ashkenaz-sources.bin', './siddur-data/ashkenaz.bin', './siddur-data/calendar.bin', './siddur-data/mizrach-sources.bin', './siddur-data/mizrach.bin', './siddur-data/sefard-sources.bin', './siddur-data/sefard.bin', './siddur-data/travel.json', './siddur-day.mjs', './bundled-siddur.mjs']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(version).then(cache => cache.addAll(shell)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(prefix) && key !== version).map(key => caches.delete(key))
  )).then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return
  const path = url.href.slice(self.registration.scope.length)
  if (event.request.mode !== 'navigate' && !shell.includes('./' + path)) return
  event.respondWith(fetch(event.request).catch(async () => {
    const response = await caches.match(event.request) || (event.request.mode === 'navigate' && await caches.match('./index.html'))
    return response || Response.error()
  }))
})
