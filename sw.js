const prefix = 'kiduman-web:'
const version = prefix + 'shell-v7'
const shell = ['./', './index.html', './styles.css?v=5', './app.mjs?v=6', './reader-ui.mjs?v=4', './kiduman.png', './data.mjs?v=4', './sync.mjs?v=4', './reader-content.mjs?v=5', './DavidLibre-Regular.ttf', './ShlomoSemiStam.ttf']

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
    const response = await (event.request.mode === 'navigate' ? caches.match('./index.html') : caches.match(event.request))
    return response || Response.error()
  }))
})
