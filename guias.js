/* ==========================================================================
   EVO ENGLISH · GUÍAS (LEVO y LEVA)
   - Presentación al entrar por primera vez (o si aún no tiene guía).
   - Selector de guía (tarjetas grandes, botón fijo abajo "Elegir a ...").
   - Saludo "Hey, ¿qué tal?" en la primera lección guiada de cada día.
   - La voz de la app sigue al guía elegido (LEVO = Charon, LEVA = Aoede).
   Módulo independiente: si se quita este archivo, la app sigue igual.
   ========================================================================== */
(function () {
 "use strict";
 var VISTO = false;                       // intro mostrada en esta sesión
 var INFO = {
  levo: { frase: "Voz seria y clara", rol: "Lobo tutor", color: "#1FA37A", fondo: "linear-gradient(160deg,#1B6B63 0%,#14403F 55%,#0B2420 100%)",
          dice: "Yo te explico con calma y claridad." },
  leva: { frase: "Voz cálida y cercana", rol: "Loba tutora", color: "#B05CE0", fondo: "linear-gradient(160deg,#6B3C9C 0%,#3E2466 55%,#1B1030 100%)",
          dice: "Yo te pongo a hablar y a divertirte." }
 };
 var SALUDOS = {
  levo: [
   ["Hoy avanzamos paso a paso. Respira, escucha bien y repite conmigo.", "Hey! Ready to learn?"],
   ["Lo importante es la constancia. Un poco cada día y verás el cambio.", "Hey! Let's get started."],
   ["Hoy practicamos con calma y con claridad. Yo te acompaño.", "Hello! Let's do this together."],
   ["Cada error es una pista. Vamos a convertirlos en aprendizaje.", "Hey there! Let's begin."]
  ],
  leva: [
   ["¡Hoy toca divertirse hablando inglés! No tengas pena, yo te ayudo.", "Hey! Ready to have fun?"],
   ["Tu voz importa. Hoy vamos a hacerla sonar con más confianza.", "Hey you! Let's go!"],
   ["¡Qué bueno verte por aquí! Vamos a ponerle ritmo a esta lección.", "Hey! Great to see you!"],
   ["Un pasito más cerca de hablar de verdad. ¿Empezamos?", "Hi! Shall we start?"]
  ]
 };
 function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
 function pers() { try { return window.ConversarEngine.personajes(); } catch (e) { return []; } }
 function pjDe(id) { return pers().filter(function (p) { return p.id === id; })[0] || null; }
 function usuario() { try { return window.LoginOnboarding && window.LoginOnboarding.usuarioActual && window.LoginOnboarding.usuarioActual(); } catch (e) { return null; } }
 function nombre() { var u = usuario(); return u && u.nombre ? String(u.nombre).split(" ")[0] : ""; }
 function clave(k) { var u = usuario(); return k + ":" + (u && u.usuario || "anon"); }
 function leer(k) { try { return localStorage.getItem(clave(k)) || ""; } catch (e) { return ""; } }
 function guardar(k, v) { try { localStorage.setItem(clave(k), v); } catch (e) {} }
 function hoy() { return new Date().toDateString(); }
 function guia() { var g = window.EvoGuia ? window.EvoGuia.get() : ""; return pjDe(g) ? g : ""; }
 function aplicarVoz() { var p = pjDe(guia()); if (p) window.__evoVoz = p.voz || ""; }

 var CSS = ''
  + '.gd-ov{position:fixed;inset:0;z-index:99990;display:flex;flex-direction:column;align-items:center;color:#fff;font-family:"DM Sans",system-ui,Arial,sans-serif;overflow:hidden;'
  + 'background:radial-gradient(ellipse 120% 60% at 50% -5%,rgba(255,176,86,.55) 0%,rgba(255,176,86,0) 60%),linear-gradient(180deg,#15414F 0%,#1B5B49 48%,#0A281E 100%);animation:gd-in .35s ease both}'
  + '@keyframes gd-in{from{opacity:0;transform:scale(1.03)}to{opacity:1;transform:none}}'
  + '.gd-in{width:min(100%,560px);flex:1;display:flex;flex-direction:column;padding:max(22px,env(safe-area-inset-top)) 20px max(22px,env(safe-area-inset-bottom));position:relative;z-index:2;min-height:0}'
  + '.gd-kick{align-self:center;font:800 12px "DM Sans",Arial,sans-serif;letter-spacing:.16em;color:#FFD66B;background:rgba(255,255,255,.1);border:1px solid rgba(255,214,107,.5);border-radius:99px;padding:7px 14px}'
  + '.gd-h{font:700 clamp(26px,7vw,34px)/1.12 "Space Grotesk","DM Sans",Arial,sans-serif;text-align:center;margin:14px 0 4px;text-wrap:balance;text-shadow:0 3px 14px rgba(0,0,0,.35)}'
  + '.gd-sub{text-align:center;color:#CFE8DA;font-size:15px;line-height:1.4;margin:0 0 6px}'
  + '.gd-stage{flex:1;min-height:0;position:relative;display:flex;justify-content:center;align-items:flex-end;gap:0;margin:6px 0}'
  + '.gd-who{position:relative;flex:1;max-width:54%;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;margin:0 -2%}'
  + '.gd-who img{width:100%;height:auto;max-height:calc(100% - 78px);object-fit:contain;object-position:bottom;filter:drop-shadow(0 14px 22px rgba(0,0,0,.45));animation:gd-bob 3.6s ease-in-out infinite;transform-origin:50% 100%}'
  + '.gd-who.b img{animation-delay:-1.8s}'
  + '@keyframes gd-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}'
  + '.gd-say{position:relative;flex:none;margin-bottom:12px;width:94%;background:#fff;color:#16283A;border-radius:16px;padding:9px 11px;font-size:13px;line-height:1.3;font-weight:600;box-shadow:0 8px 22px rgba(0,0,0,.3);text-align:center}'
  + '.gd-say b{display:block;font:800 11px "DM Sans",Arial,sans-serif;letter-spacing:.1em;margin-bottom:2px}'
  + '.gd-say::after{content:"";position:absolute;bottom:-7px;left:50%;margin-left:-7px;width:14px;height:14px;background:#fff;transform:rotate(45deg);border-radius:3px}'
  + '.gd-pills{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:10px 0 14px}'
  + '.gd-pill{font:700 12.5px "DM Sans",Arial,sans-serif;border-radius:99px;padding:7px 12px;color:#10241B}'
  + '.gd-cta{border:0;border-radius:18px;padding:17px 20px;font:800 17px "DM Sans",Arial,sans-serif;color:#fff;background:linear-gradient(180deg,#34D399,#12906A);box-shadow:0 6px 0 #0B6B4E,0 14px 26px rgba(0,0,0,.35);cursor:pointer;width:100%;transition:transform .08s}'
  + '.gd-cta:active{transform:translateY(3px);box-shadow:0 3px 0 #0B6B4E,0 8px 16px rgba(0,0,0,.35)}'
  + '.gd-cta:disabled{background:#4A5B55;box-shadow:0 6px 0 #34423D;color:#B8C7C0;cursor:not-allowed}'
  + '.gd-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:14px 0 16px;flex:1;min-height:0}'
  + '.gd-card{position:relative;border:0;padding:0;border-radius:24px;overflow:hidden;cursor:pointer;color:#fff;text-align:left;box-shadow:0 10px 24px rgba(0,0,0,.35);outline:3px solid transparent;transition:transform .15s,outline-color .15s;min-height:0;display:block}'
  + '.gd-card img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 12%}'
  + '.gd-card::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 48%,rgba(0,0,0,.78) 100%)}'
  + '.gd-card.on{outline-color:var(--c);transform:translateY(-4px) scale(1.02)}'
  + '.gd-chk{position:absolute;top:10px;right:10px;z-index:3;width:34px;height:34px;border-radius:50%;background:var(--c);display:none;place-items:center;box-shadow:0 4px 12px rgba(0,0,0,.4)}'
  + '.gd-card.on .gd-chk{display:grid;animation:gd-pop .25s ease both}'
  + '@keyframes gd-pop{from{transform:scale(.3)}to{transform:scale(1)}}'
  + '.gd-nm{position:absolute;left:12px;right:10px;bottom:12px;z-index:3}'
  + '.gd-nm b{display:block;font:700 24px "Space Grotesk","DM Sans",Arial,sans-serif;text-shadow:0 2px 8px rgba(0,0,0,.6)}'
  + '.gd-nm span{display:flex;align-items:center;gap:5px;font:700 12.5px "DM Sans",Arial,sans-serif;color:#E8F5EE;opacity:.95;margin-top:2px}'
  + '.gd-nm small{display:block;font-size:11.5px;color:#FFD66B;font-weight:700;margin-top:3px}'
  + '.gd-lf{position:absolute;z-index:1;pointer-events:none;border-radius:0 100% 0 100%;background:linear-gradient(135deg,#3DDC97,#12906A);opacity:.7;animation:gd-fall linear infinite}'
  + '@keyframes gd-fall{0%{transform:translateY(-12vh) rotate(0)}100%{transform:translateY(110vh) rotate(300deg)}}'
  + '.gd-ff{position:absolute;z-index:1;width:5px;height:5px;border-radius:50%;background:#C8FFB0;box-shadow:0 0 10px 2px rgba(200,255,176,.8);animation:gd-ff 5s ease-in-out infinite;pointer-events:none}'
  + '@keyframes gd-ff{0%,100%{opacity:0;transform:translateY(0)}50%{opacity:1;transform:translateY(-18px)}}'
  + '.gd-done{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}'
  + '.gd-done img{max-height:50vh;max-width:80%;object-fit:contain;filter:drop-shadow(0 14px 24px rgba(0,0,0,.45));animation:gd-pop .4s ease both}'
  + '.gd-sheet{position:fixed;inset:0;z-index:99990;display:flex;align-items:flex-end;justify-content:center;background:rgba(5,22,16,.62);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:gd-in .25s ease both}'
  + '.gd-hey{position:relative;width:min(100%,520px);border-radius:28px 28px 0 0;padding:20px 20px max(22px,env(safe-area-inset-bottom));color:#fff;overflow:hidden;box-shadow:0 -14px 40px rgba(0,0,0,.45)}'
  + '.gd-hey .tx{max-width:62%;position:relative;z-index:2}'
  + '.gd-hey .tx h3{font:700 clamp(26px,7.5vw,34px)/1.05 "Space Grotesk","DM Sans",Arial,sans-serif;margin:6px 0 8px}'
  + '.gd-hey .tx p{font-size:14.5px;line-height:1.4;margin:0 0 14px;color:#EAF6EF}'
  + '.gd-hey img.w{position:absolute;right:-6px;bottom:0;height:96%;max-width:52%;object-fit:contain;object-position:bottom right;z-index:1;filter:drop-shadow(0 10px 18px rgba(0,0,0,.4));animation:gd-bob 3.6s ease-in-out infinite}'
  + '.gd-row{display:flex;gap:10px;align-items:center;position:relative;z-index:2}'
  + '.gd-spk{flex:none;width:54px;height:54px;border-radius:50%;border:0;background:rgba(255,255,255,.18);border:2px solid rgba(255,255,255,.5);color:#fff;display:grid;place-items:center;cursor:pointer}'
  + '.gd-row .gd-cta{flex:1;padding:15px 16px;font-size:16px}'
  + '.hub-guia{display:flex;align-items:center;gap:10px;width:100%;margin:0 0 14px;padding:10px 14px;border-radius:18px;border:1.5px solid rgba(31,163,122,.45);background:rgba(8,36,26,.82);cursor:pointer;font:700 14px "DM Sans",Arial,sans-serif;color:#fff;text-align:left}'
  + '.hub-guia img{width:40px;height:40px;object-fit:cover;object-position:50% 10%;border-radius:50%;background:#1B5B49;flex:none}'
  + '.hub-guia small{display:block;font-weight:600;opacity:.7}.hub-guia em{margin-left:auto;font-style:normal;font-weight:800;color:#6FF0B8}'
  + '@media (prefers-reduced-motion:reduce){.gd-ov *,.gd-sheet *{animation:none!important}}';
 function css() { if (document.getElementById("gd-css")) return; var s = document.createElement("style"); s.id = "gd-css"; s.textContent = CSS; document.head.appendChild(s); }
 function ambiente() {
  var h = "";
  for (var i = 0; i < 7; i++) h += '<i class="gd-lf" style="left:' + ((i * 15 + 6) % 96) + '%;width:' + (10 + (i % 3) * 4) + 'px;height:' + (10 + (i % 3) * 4) + 'px;animation-duration:' + (9 + i * 1.7) + 's;animation-delay:-' + (i * 2.3) + 's"></i>';
  for (var j = 0; j < 8; j++) h += '<i class="gd-ff" style="left:' + ((j * 13 + 8) % 94) + '%;top:' + ((j * 31 + 12) % 80) + '%;animation-delay:' + (j * 0.7) + 's"></i>';
  return h;
 }
 function cerrar() { var e = document.querySelector(".gd-ov,.gd-sheet"); if (e) e.remove(); }
 function montarOv(html) { cerrar(); css(); var o = document.createElement("div"); o.className = "gd-ov"; o.setAttribute("role", "dialog"); o.setAttribute("aria-modal", "true"); o.innerHTML = ambiente() + '<div class="gd-in">' + html + '</div>'; document.body.appendChild(o); return o; }

 /* ---------- 1) PRESENTACIÓN ---------- */
 function presentar() {
  VISTO = true;
  var n = nombre(), lv = pjDe("levo"), la = pjDe("leva");
  if (!lv || !la) return;
  var o = montarOv(
   '<span class="gd-kick">BIENVENIDO A EVO ENGLISH</span>'
   + '<h1 class="gd-h">' + (n ? "¡Hola, " + esc(n) + "!" : "¡Hola!") + '<br>Somos tus guías</h1>'
   + '<p class="gd-sub">Vamos a acompañarte en cada lección para que hables inglés de verdad.</p>'
   + '<div class="gd-stage">'
   + '<div class="gd-who"><div class="gd-say"><b style="color:' + INFO.levo.color + '">LEVO</b>' + INFO.levo.dice + '</div><img src="' + lv.poses.idle + '" alt="LEVO"></div>'
   + '<div class="gd-who b"><div class="gd-say"><b style="color:' + INFO.leva.color + '">LEVA</b>' + INFO.leva.dice + '</div><img src="' + la.poses.idle + '" alt="LEVA"></div>'
   + '</div>'
   + '<div class="gd-pills"><span class="gd-pill" style="background:#FFD66B">Lecciones guiadas</span><span class="gd-pill" style="background:#7DE3B5">Habla sin pena</span><span class="gd-pill" style="background:#C9A6F2">Gana XP y sube de nivel</span></div>'
   + '<button type="button" class="gd-cta" id="gd-go">Elegir a mi guía</button>');
  o.querySelector("#gd-go").addEventListener("click", function () { elegir(); });
 }

 /* ---------- 2) SELECTOR (tarjetas grandes + botón fijo) ---------- */
 var CHECK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
 var SPK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>';
 function elegir() {
  var actual = guia(), sel = actual || "";
  var tarjetas = pers().filter(function (p) { return p.disponible && INFO[p.id]; }).map(function (p) {
   var inf = INFO[p.id];
   return '<button type="button" class="gd-card' + (p.id === sel ? " on" : "") + '" data-id="' + p.id + '" style="--c:' + inf.color + ';background:' + inf.fondo + '" aria-pressed="' + (p.id === sel) + '">'
    + '<img src="' + p.poses.idle + '" alt="">'
    + '<span class="gd-chk">' + CHECK + '</span>'
    + '<span class="gd-nm"><b>' + esc(p.nombre) + '</b><span>' + SPK + esc(inf.frase) + '</span><small>' + esc(inf.rol) + '</small></span></button>';
  }).join("");
  var o = montarOv(
   '<span class="gd-kick">TU GUÍA</span>'
   + '<h1 class="gd-h">Elige a tu guía</h1>'
   + '<p class="gd-sub">Te acompañará en tus lecciones y en tu práctica. Puedes cambiarlo cuando quieras.</p>'
   + '<div class="gd-grid">' + tarjetas + '</div>'
   + '<button type="button" class="gd-cta" id="gd-ok"' + (sel ? "" : " disabled") + '>' + (sel ? "Elegir a " + pjDe(sel).nombre : "Toca a tu guía") + '</button>');
  var btn = o.querySelector("#gd-ok");
  Array.prototype.forEach.call(o.querySelectorAll(".gd-card"), function (c) {
   c.addEventListener("click", function () {
    sel = c.getAttribute("data-id");
    Array.prototype.forEach.call(o.querySelectorAll(".gd-card"), function (x) { var on = x === c; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); });
    btn.disabled = false; btn.textContent = "Elegir a " + pjDe(sel).nombre;
   });
  });
  btn.addEventListener("click", function () {
   if (!sel) return;
   window.EvoGuia.set(sel); aplicarVoz(); listo(sel);
  });
 }
 function listo(id) {
  var p = pjDe(id), inf = INFO[id];
  montarOv('<div class="gd-done"><span class="gd-kick">¡LISTO!</span><h1 class="gd-h">' + esc(p.nombre) + ' será tu guía</h1><img src="' + p.poses.happy + '" alt=""><p class="gd-sub" style="margin-top:10px">' + esc(inf.dice) + '</p></div>');
  setTimeout(function () { cerrar(); try { if (typeof window.go === "function") window.go(); } catch (e) {} }, 1700);
 }

 /* ---------- 3) SALUDO "HEY, ¿QUÉ TAL?" (primera lección del día) ---------- */
 function saludar() {
  var id = guia(); var p = pjDe(id); if (!p) return;
  guardar("evoSaludo", hoy());
  var d = new Date(), idx = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000) % SALUDOS[id].length;
  var s = SALUDOS[id][idx], n = nombre(), inf = INFO[id];
  css(); cerrar();
  var o = document.createElement("div"); o.className = "gd-sheet"; o.setAttribute("role", "dialog"); o.setAttribute("aria-modal", "true");
  o.innerHTML = '<div class="gd-hey" style="background:' + inf.fondo + '"><img class="w" src="' + p.poses.talk + '" alt="">'
   + '<div class="tx"><span class="gd-kick" style="display:inline-block">' + esc(p.nombre) + '</span><h3>Hey' + (n ? ", " + esc(n) : "") + '!<br>¿Qué tal?</h3><p>' + esc(s[0]) + '</p></div>'
   + '<div class="gd-row"><button type="button" class="gd-spk" id="gd-spk" aria-label="Escuchar">' + SPK.replace(/15/g, "24") + '</button><button type="button" class="gd-cta" id="gd-vamos">¡Vamos!</button></div></div>';
  document.body.appendChild(o);
  o.querySelector("#gd-spk").addEventListener("click", function () { aplicarVoz(); try { window.say && window.say(s[1], 0.95); } catch (e) {} });
  o.querySelector("#gd-vamos").addEventListener("click", function () { try { if (window.__sayAu) window.__sayAu.pause(); window.__sayTok = (window.__sayTok || 0) + 1; } catch (e) {} o.remove(); });
 }

 /* ---------- control: cuándo mostrar qué ---------- */
 function sesionActiva() {
  if (document.getElementById("auth-overlay")) return false;
  var ad = document.getElementById("admin-overlay"); if (ad && ad.childNodes.length) return false;
  return !!usuario();
 }
 function revisar() {
  try {
   if (!sesionActiva() || document.querySelector(".gd-ov,.gd-sheet") || !window.ConversarEngine || !window.EvoGuia) return;
   if (!guia()) { if (!VISTO) presentar(); return; }
   aplicarVoz();
   if (/^#\/leccion\//.test(location.hash) && leer("evoSaludo") !== hoy()) saludar();
  } catch (e) {}
 }
 setInterval(revisar, 1200);
 window.addEventListener("hashchange", function () { setTimeout(revisar, 150); });
 document.addEventListener("click", function (e) {
  var b = e.target.closest && e.target.closest("[data-guia]");
  if (b && b.getAttribute("data-guia") === "cambiar") { e.preventDefault(); elegir(); }
 });
 window.GuiasEngine = { revisar: revisar, elegir: elegir, presentar: presentar, saludar: saludar };
})();
