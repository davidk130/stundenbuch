// Stundenbuch – Service Worker
// Macht die Seite installierbar und lädt sie auch bei schlechtem Netz.
// Strategie: immer zuerst frisch aus dem Netz, bei Ausfall aus dem Zwischenspeicher.
const CACHE = "stundenbuch-v1";
const SHELL = ["./", "./index.html", "./app.js", "./config.js", "./supabase.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return; // Supabase-Anfragen nie zwischenspeichern
  e.respondWith(
    fetch(req)
      .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
  );
});
