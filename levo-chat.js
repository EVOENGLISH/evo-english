/* ==========================================================================
   LEVO — chat de práctica con el lobo (EVO ENGLISH)
   Botón flotante + ventana de chat. Habla con /api/chat (Vercel), que es el
   proxy seguro hacia Gemini: la llave NUNCA está en este archivo.
   Se carga sola: no necesita nada más en index.html que el <script src>.
   ========================================================================== */
(function () {
 "use strict";

 var ENDPOINT = "/api/chat";
 var MAX_TURNOS = 10;      // mensajes que se mandan como contexto
 var MAX_CHARS = 400;      // largo máximo de lo que escribe el alumno

 var SISTEMA = [
  "You are LEVO, a friendly wolf English tutor inside the EVO ENGLISH app. Students are Spanish speakers, usually A1-A2 but some are advanced: adapt to the level they show.",
  "Only talk about learning English. Never ask for personal data (address, phone, passwords, payments).",
  "MODE A - the student asks how to say something, to translate, or what a word means. Answer EXACTLY in this format (explanations in Spanish, examples in English):",
  "## ¿Cómo se dice?",
  ">> <the English sentence>",
  "## Pronunciación aproximada",
  "<the sentence respelled for Spanish readers, e.g. Ai jav a buk>",
  "## Significado de cada palabra",
  "| Inglés | Español |",
  "| word | meaning | (one row per word)",
  "## Tu práctica",
  "<one short instruction in Spanish: repeat it or write a new sentence>",
  "MODE B - the student asks how to pronounce something: give '## Pronunciación aproximada' (respelling, stressed syllable in CAPITALS), the '>> sentence' line, and at most 2 short bullet tips in Spanish starting with '- '.",
  "MODE C - normal practice chat: reply in simple English, maximum 2 short sentences. If the student made a mistake, show the correct sentence in **bold**. Add a short Spanish meaning in parentheses only for new or difficult words. End with ONE simple question.",
  "Be warm and patient. Never translate everything. Keep answers short."
 ].join("\n");

 var estado = { abierto: false, enviando: false, historial: [] };
 var els = {};

 function nombreAlumno() {
  try {
   var u = window.LoginOnboarding && window.LoginOnboarding.usuarioActual && window.LoginOnboarding.usuarioActual();
   return u && u.nombre ? String(u.nombre).split(" ")[0] : "";
  } catch (e) { return ""; }
 }

 function inyectarCSS() {
  var css = [
   ".levo-fab{position:fixed;right:16px;bottom:calc(92px + env(safe-area-inset-bottom,0px));z-index:8;width:58px;height:58px;border-radius:50%;border:2px solid #fff;background:#0B2247;padding:0;cursor:pointer;box-shadow:0 8px 22px rgba(11,34,71,.35);display:grid;place-items:center;overflow:hidden;-webkit-tap-highlight-color:transparent}",
   ".levo-fab img{width:46px;height:46px;object-fit:contain}",
   ".levo-fab:active{transform:scale(.94)}",
   ".levo-fab:focus-visible,.levo-send:focus-visible,.levo-close:focus-visible,.levo-in:focus-visible{outline:3px solid #34D399;outline-offset:2px}",
   "body.modo-enfocado .levo-fab{display:none!important}",
   ".levo-panel{position:fixed;right:16px;bottom:calc(92px + env(safe-area-inset-bottom,0px));z-index:20;width:min(380px,calc(100vw - 32px));height:min(520px,calc(100dvh - 140px));background:#fff;color:#0B2247;border-radius:20px;border:1px solid #DCE6F8;box-shadow:0 18px 50px rgba(11,34,71,.35);display:none;flex-direction:column;overflow:hidden;font-family:'DM Sans',system-ui,sans-serif}",
   ".levo-panel.open{display:flex}",
   ".levo-head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#0B2247;color:#fff}",
   ".levo-head img{width:38px;height:38px;object-fit:contain}",
   ".levo-head b{display:block;font:700 15px 'Space Grotesk',Arial,sans-serif}",
   ".levo-head small{display:block;color:#9FB4D6;font-size:12px}",
   ".levo-close{margin-left:auto;width:36px;height:36px;border-radius:10px;border:0;background:rgba(255,255,255,.12);color:#fff;font-size:20px;cursor:pointer;line-height:1}",
   ".levo-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#F4F8FF}",
   ".levo-m{max-width:86%;padding:10px 13px;border-radius:16px;font-size:15px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}",
   ".levo-m.bot{align-self:flex-start;background:#fff;border:1px solid #DCE6F8;border-bottom-left-radius:5px}",
   ".levo-m.rich{white-space:normal;max-width:94%;padding:12px 14px}",
   ".levo-h{font:700 12px 'Space Grotesk',Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#4B6A9B;margin:12px 0 4px}",
   ".levo-h:first-child{margin-top:0}",
   ".levo-big{font:700 21px/1.3 'Space Grotesk',Arial,sans-serif;color:#0E8F54;margin:2px 0 6px}",
   ".levo-ear{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 12px;border-radius:999px;border:0;background:#0066FF;color:#fff;font:700 13px 'DM Sans',system-ui,sans-serif;cursor:pointer}",
   ".levo-ear:focus-visible{outline:3px solid #34D399;outline-offset:2px}",
   ".levo-m p{margin:0 0 6px}.levo-m p:last-child{margin-bottom:0}",
   ".levo-m ul{margin:4px 0 4px 18px;padding:0}.levo-m li{margin:2px 0}",
   ".levo-tbl{width:100%;border-collapse:collapse;font-size:14px;margin:2px 0}",
   ".levo-tbl th{text-align:left;font-weight:700;color:#4B6A9B;border-bottom:2px solid #DCE6F8;padding:4px 6px 4px 0}",
   ".levo-tbl td{border-bottom:1px solid #E7EEFA;padding:5px 6px 5px 0}",
   ".levo-m.me{align-self:flex-end;background:#0066FF;color:#fff;border-bottom-right-radius:5px}",
   ".levo-m.err{align-self:center;background:#FDEDEE;color:#8A1F24;font-size:13.5px;text-align:center}",
   ".levo-dots{align-self:flex-start;background:#fff;border:1px solid #DCE6F8;border-radius:16px;padding:12px 14px;display:flex;gap:5px}",
   ".levo-dots i{width:7px;height:7px;border-radius:50%;background:#9FB4D6;animation:levo-b 1s infinite}",
   ".levo-dots i:nth-child(2){animation-delay:.15s}.levo-dots i:nth-child(3){animation-delay:.3s}",
   "@keyframes levo-b{0%,60%,100%{opacity:.35;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}",
   ".levo-form{display:flex;gap:8px;padding:10px;border-top:1px solid #E1E9F7;background:#fff}",
   ".levo-in{flex:1;min-width:0;min-height:44px;border-radius:12px;border:2px solid #D3E4F7;padding:0 12px;font:500 15px 'DM Sans',system-ui,sans-serif;color:#0B2247}",
   ".levo-in:focus{outline:none;border-color:#0066FF}",
   ".levo-send{min-height:44px;padding:0 16px;border-radius:12px;border:0;background:#12A85F;color:#fff;font:700 14px 'Space Grotesk',Arial,sans-serif;cursor:pointer}",
   ".levo-send:disabled{opacity:.5;cursor:default}",
   "@media (max-width:480px){.levo-panel{right:8px;left:8px;width:auto;bottom:calc(84px + env(safe-area-inset-bottom,0px))}}",
   "@media (prefers-reduced-motion:reduce){.levo-dots i{animation:none}}"
  ].join("\n");
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);
 }

 function crearUI() {
  var fab = document.createElement("button");
  fab.type = "button"; fab.className = "levo-fab";
  fab.setAttribute("aria-label", "Hablar con LEVO");
  fab.innerHTML = '<img src="assets/mascot/evo_wolf_mentor.png" alt="" width="46" height="46">';

  var panel = document.createElement("div");
  panel.className = "levo-panel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Chat con LEVO");
  panel.innerHTML =
   '<div class="levo-head"><img src="assets/mascot/evo_wolf_mentor.png" alt="" width="38" height="38"><div><b>LEVO</b><small>Practica inglés conmigo</small></div><button type="button" class="levo-close" aria-label="Cerrar chat">×</button></div>' +
   '<div class="levo-msgs" id="levo-msgs" aria-live="polite"></div>' +
   '<form class="levo-form" id="levo-form"><input class="levo-in" id="levo-in" type="text" maxlength="' + MAX_CHARS + '" placeholder="Write in English or Spanish…" autocomplete="off" aria-label="Tu mensaje"><button class="levo-send" id="levo-send" type="submit">Send</button></form>';

  document.body.appendChild(fab);
  document.body.appendChild(panel);
  els = { fab: fab, panel: panel, msgs: panel.querySelector("#levo-msgs"), form: panel.querySelector("#levo-form"), input: panel.querySelector("#levo-in"), send: panel.querySelector("#levo-send"), close: panel.querySelector(".levo-close") };

  fab.addEventListener("click", function () { alternar(true); });
  els.close.addEventListener("click", function () { alternar(false); });
  els.form.addEventListener("submit", function (e) { e.preventDefault(); enviar(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && estado.abierto) alternar(false); });
 }

 function burbuja(texto, tipo) {
  var d = document.createElement("div");
  d.className = "levo-m " + tipo;
  d.textContent = texto;
  els.msgs.appendChild(d);
  els.msgs.scrollTop = els.msgs.scrollHeight;
  return d;
 }

 // El chat flotante sigue al guía elegido (LEVO o LEVA): imagen, nombre y personalidad.
 function guiaAct() {
  try {
   var id = window.EvoGuia && window.EvoGuia.get(), ps = window.ConversarEngine && window.ConversarEngine.personajes();
   var p = ps && ps.filter(function (q) { return q.id === id; })[0];
   if (p) return { nombre: p.nombre, img: p.poses.talk, fem: p.id === "leva" };
  } catch (e) {}
  return { nombre: "LEVO", img: "assets/mascot/evo_wolf_mentor.png", fem: false };
 }
 function aplicarGuia() {
  var g = guiaAct();
  try {
   els.fab.querySelector("img").src = g.img; els.fab.setAttribute("aria-label", "Hablar con " + g.nombre);
   var hi = els.panel.querySelector(".levo-head img"); if (hi) hi.src = g.img;
   var hb = els.panel.querySelector(".levo-head b"); if (hb) hb.textContent = g.nombre;
   els.panel.setAttribute("aria-label", "Chat con " + g.nombre);
  } catch (e) {}
  return g;
 }
 function alternar(abrir) {
  estado.abierto = abrir;
  els.panel.classList.toggle("open", abrir);
  els.fab.style.display = abrir ? "none" : "";
  if (abrir) {
   var g = aplicarGuia();
   if (!els.msgs.childNodes.length) {
    var n = nombreAlumno();
    burbuja("Hi" + (n ? ", " + n : "") + "! I'm " + g.nombre + ". Let's practice English together. How are you today?\n(¡Hola! Soy " + g.nombre + ". Practiquemos inglés juntos.)", "bot");
   }
   setTimeout(function () { els.input.focus(); }, 50);
  }
 }

 function mostrarEscribiendo(si) {
  var viejo = els.msgs.querySelector(".levo-dots");
  if (viejo) viejo.remove();
  if (si) {
   var d = document.createElement("div");
   d.className = "levo-dots"; d.innerHTML = "<i></i><i></i><i></i>";
   els.msgs.appendChild(d);
   els.msgs.scrollTop = els.msgs.scrollHeight;
  }
 }

 function inline(el, txt) {
  var partes = String(txt).split(/\*\*(.+?)\*\*/);
  partes.forEach(function (p, i) {
   if (!p) return;
   if (i % 2) { var b = document.createElement("strong"); b.textContent = p; el.appendChild(b); }
   else el.appendChild(document.createTextNode(p));
  });
 }

 function hablar(texto) {
  try {
   if (typeof window.say === "function") { window.say(texto, 0.95); return; }
   if (!window.speechSynthesis) return;
   window.speechSynthesis.cancel();
   var u = new SpeechSynthesisUtterance(texto);
   u.lang = "en-US"; u.rate = 0.85;
   window.speechSynthesis.speak(u);
  } catch (e) {}
 }

 // Convierte la respuesta de LEVO (mini-formato) en elementos seguros (sin innerHTML).
 function burbujaLevo(texto) {
  var d = document.createElement("div");
  d.className = "levo-m bot rich";
  var lineas = String(texto).replace(/\r/g, "").split("\n");
  var ul = null, tabla = null, tbody = null, primeraFila = true;
  function cerrar() { ul = null; tabla = null; tbody = null; primeraFila = true; }
  lineas.forEach(function (ln) {
   var t = ln.trim();
   if (!t) { cerrar(); return; }
   var m;
   if ((m = t.match(/^#{1,3}\s+(.*)$/))) { cerrar(); var h = document.createElement("div"); h.className = "levo-h"; h.textContent = m[1].replace(/\*\*/g, ""); d.appendChild(h); return; }
   if ((m = t.match(/^>>\s*(.*)$/))) {
    cerrar();
    var frase = m[1].replace(/\*\*/g, "").replace(/^["“]|["”]$/g, "");
    var g = document.createElement("div"); g.className = "levo-big"; g.textContent = frase; d.appendChild(g);
    var bt = document.createElement("button"); bt.type = "button"; bt.className = "levo-ear";
    bt.textContent = "🔊 Escuchar"; bt.setAttribute("aria-label", "Escuchar: " + frase);
    bt.addEventListener("click", function () { hablar(frase); });
    d.appendChild(bt);
    return;
   }
   if (t.charAt(0) === "|") {
    if (/^\|?[\s:|-]+\|?$/.test(t)) return; // fila separadora
    var celdas = t.replace(/^\|/, "").replace(/\|$/, "").split("|");
    if (!tabla) {
     ul = null;
     tabla = document.createElement("table"); tabla.className = "levo-tbl";
     tbody = document.createElement("tbody"); tabla.appendChild(tbody); d.appendChild(tabla); primeraFila = true;
    }
    var tr = document.createElement("tr");
    celdas.forEach(function (c) { var td = document.createElement(primeraFila ? "th" : "td"); inline(td, c.trim()); tr.appendChild(td); });
    primeraFila = false; tbody.appendChild(tr);
    return;
   }
   if ((m = t.match(/^[-*•]\s+(.*)$/))) {
    tabla = null;
    if (!ul) { ul = document.createElement("ul"); d.appendChild(ul); }
    var li = document.createElement("li"); inline(li, m[1]); ul.appendChild(li);
    return;
   }
   cerrar();
   var p = document.createElement("p"); inline(p, t); d.appendChild(p);
  });
  els.msgs.appendChild(d);
  els.msgs.scrollTop = els.msgs.scrollHeight;
  return d;
 }

 function textoDeRespuesta(data) {
  try {
   var partes = data.candidates[0].content.parts;
   return partes.map(function (p) { return p.text || ""; }).join("").trim();
  } catch (e) { return ""; }
 }

 async function enviar() {
  if (estado.enviando) return;
  var texto = els.input.value.trim();
  if (!texto) return;
  els.input.value = "";
  burbuja(texto, "me");
  estado.historial.push({ role: "user", parts: [{ text: texto }] });
  estado.enviando = true; els.send.disabled = true;
  mostrarEscribiendo(true);

  var contexto = estado.historial.slice(-MAX_TURNOS);
  var cuerpo = JSON.stringify({
   systemInstruction: { parts: [{ text: SISTEMA.replace("You are LEVO,", "You are " + guiaAct().nombre + (guiaAct().fem ? " (a female wolf)," : ",")) }] },
   contents: contexto,
   generationConfig: { maxOutputTokens: 800, temperature: 0.7 }
  });
  var resp = "", ultimo = 0;
  // Hasta 3 intentos automáticos y silenciosos: el alumno solo ve los puntitos.
  for (var i = 0; i < 2 && !resp; i++) {
   try {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 28000);
    var r;
    try { r = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: cuerpo, signal: ctl.signal }); }
    finally { clearTimeout(timer); }
    ultimo = r.status;
    var data = await r.json().catch(function () { return {}; });
    resp = r.ok ? textoDeRespuesta(data) : "";
    if (!resp && (r.status === 400 || r.status === 403 || r.status === 429)) break;
   } catch (e) { ultimo = 0; }
   if (!resp && i < 1) await new Promise(function (ok) { setTimeout(ok, 1200 * (i + 1)); });
  }
  mostrarEscribiendo(false);
  if (resp) {
   burbujaLevo(resp);
   estado.historial.push({ role: "model", parts: [{ text: resp }] });
  } else {
   estado.historial.pop();
   try { console.warn("LEVO error", ultimo); } catch (e) {}
   burbuja(ultimo === 429 ? "LEVO está atendiendo a muchos alumnos. Espera un momentito y vuelve a escribir."
    : ultimo === 0 ? "Sin conexión con LEVO. Revisa tu internet e intenta de nuevo."
    : "LEVO se está tomando un descanso corto. Vuelve a enviar tu mensaje en unos segundos.", "err");
  }
  estado.enviando = false; els.send.disabled = false;
  els.input.focus();
 }

 function iniciar() { inyectarCSS(); crearUI(); }
 if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
 else iniciar();
})();
