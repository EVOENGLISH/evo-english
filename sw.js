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
var CACHE_VERSION = "evo-english-v37";
var APP_SHELL = [
 "./",
 "./index.html",
 "./manifest.json",
 "./estiloMapa.css",
 "./mapaAventuras.js",
 "./estiloLogin.css",
 "./loginOnboarding.js",
 "./estiloAdmin.css",
 "./panelAdmin.js",
 "./supabaseRepo.js",
 "./retosRepo.js",
 "./icons/icon-192.png",
 "./icons/icon-512.png",
 "./icons/icon-maskable-192.png",
 "./icons/icon-maskable-512.png",
 "./icons/apple-touch-icon.png",
 "./assets/mascot/evo_wolf_mentor.png",
 "./assets/mascot/evo_wolf_tech.png",
 "./assets/mascot/evo_welcome.png",
 "./assets/mascot/evo_thinking.png",
 "./assets/mascot/evo_success.png",
 "./assets/mascot/evo_error.png",
 "./assets/stories/little_bear_journey/scene_1.jpg",
 "./assets/stories/little_bear_journey/scene_2.jpg",
 "./assets/stories/little_bear_journey/scene_3.jpg",
 "./assets/stories/little_bear_journey/scene_4.jpg",
 "./assets/stories/little_bear_journey/scene_5.jpg",
 "./assets/stories/little_bear_journey/scene_6.jpg",
 "./assets/stories/concert_night/scene_1.jpg",
 "./assets/stories/concert_night/scene_2.jpg",
 "./assets/stories/concert_night/scene_3.jpg",
 "./assets/stories/concert_night/scene_4.jpg",
 "./assets/stories/concert_night/scene_5.jpg",
 "./assets/stories/story_temple.png",
 "./assets/stories/story_dino.png",
 "./assets/stories/story_minecraft.png",
 "./assets/stories/magic_forest/scene_1.png",
 "./assets/stories/magic_forest/scene_2.png",
 "./assets/stories/magic_forest/scene_3.png",
 "./assets/stories/magic_forest/scene_4.png",
 "./assets/stories/magic_forest/scene_5.png",
 "./assets/stories/mia_and_the_lost_cat/scene_1.png",
 "./assets/stories/mia_and_the_lost_cat/scene_2.png",
 "./assets/stories/mia_and_the_lost_cat/scene_3.png",
 "./assets/stories/mia_and_the_lost_cat/scene_4.png",
 "./assets/vocabulary/greetings/hello.png",
 "./assets/vocabulary/greetings/hi.png",
 "./assets/vocabulary/greetings/good_morning.png",
 "./assets/vocabulary/greetings/good_afternoon.png",
 "./assets/vocabulary/greetings/good_evening.png",
 "./assets/vocabulary/greetings/good_night.png",
 "./assets/vocabulary/greetings/good_bye.png",
 "./assets/vocabulary/greetings/see_you_later.png",
 "./assets/vocabulary/greetings/please.png",
 "./assets/vocabulary/greetings/thank_you.png",
 "./assets/vocabulary/greetings/youre_welcome.png",
 "./assets/vocabulary/greetings/excuse_me.png",
 "./assets/vocabulary/greetings/im_sorry.png",
 "./assets/vocabulary/greetings/nice_to_meet_you.png",
 "./assets/vocabulary/greetings/how_are_you.png",
 "./assets/vocabulary/greetings/take_care.png",
 "./assets/vocabulary/greetings/whats_your_name.png",
 "./assets/vocabulary/greetings/my_name_is.png",
 "./assets/vocabulary/greetings/where_are_you_from.png",
 "./assets/vocabulary/greetings/welcome.png",
 "./assets/vocabulary/greetings/congratulations.png",
 "./assets/vocabulary/greetings/have_a_nice_day.png",
 "./assets/platform-bg.jpg",
 "./assets/lecciones/first_contact_thumbnail.jpg"
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
