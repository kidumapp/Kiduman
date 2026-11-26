const prefix = 'kiduman-web:'
const version = prefix + 'shell-v17'
const shell = ['./', './index.html', './about.html', './styles.css?v=12', './app.mjs?v=15', './reader-ui.mjs?v=6', './kiduman.png', './data.mjs?v=5', './sync.mjs?v=6', './reader-content.mjs?v=7', './DavidLibre-Regular.ttf', './ShlomoSemiStam.ttf', './travel-prayer.json', './reader-icons.mjs?v=1', './siddur-sources.mjs?v=2']

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
