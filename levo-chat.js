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
  "You are LEVO, a friendly wolf who is an English tutor inside the EVO ENGLISH app.",
  "Your students are Spanish speakers at level A1 to A2 (beginners).",
  "Rules:",
  "- Reply in simple, short English (maximum 3 short sentences).",
  "- If the student seems lost, add a very short hint in Spanish inside parentheses.",
  "- If the student writes in Spanish, answer in simple English and give the Spanish meaning in parentheses.",
  "- If the student makes a mistake, gently show the correct sentence, then continue the conversation.",
  "- End most replies with ONE simple question to keep the student practicing.",
  "- Be warm, encouraging and patient. Never be rude.",
  "- Only talk about learning English and everyday conversation practice. If asked about something else, kindly bring the conversation back to English practice.",
  "- Never ask for personal data such as address, phone number, passwords or payment details."
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

 function alternar(abrir) {
  estado.abierto = abrir;
  els.panel.classList.toggle("open", abrir);
  els.fab.style.display = abrir ? "none" : "";
  if (abrir) {
   if (!els.msgs.childNodes.length) {
    var n = nombreAlumno();
    burbuja("Hi" + (n ? ", " + n : "") + "! I'm LEVO. Let's practice English together. How are you today?\n(¡Hola! Soy LEVO. Practiquemos inglés juntos.)", "bot");
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
  try {
   var r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
     systemInstruction: { parts: [{ text: SISTEMA }] },
     contents: contexto,
     generationConfig: { maxOutputTokens: 400, temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } }
    })
   });
   var data = await r.json().catch(function () { return {}; });
   mostrarEscribiendo(false);
   var resp = r.ok ? textoDeRespuesta(data) : "";
   if (resp) {
    burbuja(resp, "bot");
    estado.historial.push({ role: "model", parts: [{ text: resp }] });
   } else {
    estado.historial.pop(); // no dejar el mensaje sin respuesta en el contexto
    var msg = r.status === 429 ? "LEVO tiene muchos mensajes ahora. Espera un momento e intenta otra vez."
     : r.status === 500 || r.status === 403 ? "LEVO no está disponible por ahora. Avísale a tu maestro."
     : "LEVO no pudo responder. Intenta de nuevo.";
    burbuja(msg, "err");
   }
  } catch (e) {
   mostrarEscribiendo(false);
   estado.historial.pop();
   burbuja("Sin conexión con LEVO. Revisa tu internet e intenta de nuevo.", "err");
  }
  estado.enviando = false; els.send.disabled = false;
  els.input.focus();
 }

 function iniciar() { inyectarCSS(); crearUI(); }
 if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
 else iniciar();
})();
