const CACHE_NAME = "echo-v5-local-voice";
const ASSETS = ["./index.html", "./style.css", "./script.js", "./features.css", "./features.js",
  "./recorder-worklet.js", "./manifest.json", "./icon-192.png", "./icon-512.png",
  "./fonts/nunito-cyrillic-wght-normal.woff2", "./fonts/nunito-cyrillic-ext-wght-normal.woff2",
  "./fonts/nunito-latin-wght-normal.woff2", "./fonts/nunito-latin-ext-wght-normal.woff2",
  "./fonts/nunito-vietnamese-wght-normal.woff2"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("echo-") && key !== CACHE_NAME)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  // Voice requests and personal data are never placed in the shared app cache.
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("./index.html")));
    return;
  }
  const asset = ASSETS.find(path => new URL(path, self.location.href).pathname === url.pathname);
  if (asset) event.respondWith(caches.match(asset).then(saved => saved || fetch(event.request)));
});
