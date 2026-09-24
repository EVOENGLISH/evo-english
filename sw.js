/* ==========================================================================
   EVO ENGLISH — SERVICE WORKER
   Cachea el "app shell" (index.html, manifest, íconos) para que la app
   abra al instante desde la pantalla de inicio, incluso con conexión
   lenta o intermitente. No cachea nada del chat con LEVO AI (esas
   respuestas siempre deben ser en vivo).
   ========================================================================== */
"use strict";

/* Sube este número cuando cambie el contenido cacheado (index.html,
   íconos, manifest) para forzar a los dispositivos a bajar la versión
   nueva en el siguiente arranque. */
var CACHE_VERSION = "evo-english-v1";
var APP_SHELL = [
 "./",
 "./index.html",
 "./manifest.json",
 "./icons/icon-192.png",
 "./icons/icon-512.png",
 "./icons/icon-maskable-192.png",
 "./icons/icon-maskable-512.png",
 "./icons/apple-touch-icon.png"
];

/* --- Instalación: precachea el app shell --- */
self.addEventListener("install", function (ev) {
 ev.waitUntil(
  caches.open(CACHE_VERSION).then(function (cache) {
   return cache.addAll(APP_SHELL);
  }).then(function () { return self.skipWaiting(); })
 );
});

/* --- Activación: borra cachés de versiones anteriores --- */
self.addEventListener("activate", function (ev) {
 ev.waitUntil(
  caches.keys().then(function (nombres) {
   return Promise.all(nombres.map(function (n) {
    if (n !== CACHE_VERSION) return caches.delete(n);
   }));
  }).then(function () { return self.clients.claim(); })
 );
});

/* --- Fetch: "network falling back to cache" para la app (para que
   siempre se sirva la versión más nueva cuando hay internet, pero
   la app siga abriendo sin conexión), y "cache first" para el resto
   de los recursos estáticos del mismo origen. --- */
self.addEventListener("fetch", function (ev) {
 var req = ev.request;
 if (req.method !== "GET") return;

 var url = new URL(req.url);
 if (url.origin !== self.location.origin) return; // fuentes externas: deja pasar (Google Fonts, etc.)

 var esNavegacion = req.mode === "navigate" ||
  (req.method === "GET" && req.headers.get("accept") && req.headers.get("accept").indexOf("text/html") !== -1);

 if (esNavegacion) {
  ev.respondWith(
   fetch(req).then(function (res) {
    var copia = res.clone();
    caches.open(CACHE_VERSION).then(function (cache) { cache.put("./index.html", copia); });
    return res;
   }).catch(function () {
    return caches.match("./index.html").then(function (r) { return r || caches.match(req); });
   })
  );
  return;
 }

 ev.respondWith(
  caches.match(req).then(function (cached) {
   if (cached) return cached;
   return fetch(req).then(function (res) {
    if (res && res.status === 200) {
     var copia = res.clone();
     caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, copia); });
    }
    return res;
   }).catch(function () { /* sin red y sin caché: deja que falle esa sub-petición */ });
  })
 );
});
