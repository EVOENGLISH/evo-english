/* ==========================================================================
   PRÁCTICA LIBRE — conversación con LEVO / LEVA (EVO ENGLISH)
   Ruta: #/conversar (inicio) y #/conversar/chat (conversación).
   - Habla con /api/chat (proxy seguro hacia la IA): ninguna llave vive aquí.
   - Voz: micrófono del navegador (SpeechRecognition) y voz de LEVO con el
     say() que ya usa la app (o la voz del navegador si no existe).
   - Cada personaje se define en PERSONAJES: para activar a LEVA solo hay que
     poner disponible:true y las rutas de sus imágenes.
   ========================================================================== */
(function () {
 "use strict";

 var ENDPOINT = "/api/chat";
 var MAX_TURNOS = 10;      // mensajes que se mandan como contexto
 var MAX_CHARS = 300;      // largo máximo de lo que escribe el alumno
 var MAX_DIA = 150;        // mensajes por día por dispositivo (límite suave)

 var PERSONAJES = [
  { id: "levo", nombre: "LEVO", rol: "Lobo tutor", disponible: true, jaw: true, voz: "Charon",
    poses: { idle: "assets/mascot/evo_welcome.png", think: "assets/mascot/evo_thinking.png", talk: "assets/mascot/evo_wolf_mentor.png", happy: "assets/mascot/evo_success.png" } },
  { id: "leva", nombre: "LEVA", rol: "Loba tutora", disponible: true, jaw: true, voz: "Aoede",
    frames: { closed: "assets/mascot/leva_idle.png", half: "assets/mascot/leva_half.png", open: "assets/mascot/leva_open.png" },
    poses: { idle: "assets/mascot/leva_idle.png", think: "assets/mascot/leva_thinking.png", talk: "assets/mascot/leva_mentor.png", happy: "assets/mascot/leva_success.png" } }
 ];

 var TEMAS = [
  { id: "restaurante", n: "Restaurante", open: "Welcome! Table for one? What would you like to drink?", es: "¡Bienvenido! ¿Mesa para uno? ¿Qué te gustaría tomar?", ctx: "Roleplay: friendly waiter at a U.S. restaurant. Move step by step over MANY turns: drinks, appetizer, main dish, special requests, dessert, the bill and tip." },
  { id: "viajes", n: "Viajes", open: "Hey! I love traveling. Where would you like to go on your next trip?", es: "¡Hola! Me encanta viajar. ¿A dónde te gustaría ir en tu próximo viaje?", ctx: "Talk about travel: dream destinations, past trips, planning, packing, hotels and transport. Keep asking natural follow-ups." },
  { id: "aeropuerto", n: "Aeropuerto", open: "Good morning! May I see your passport and boarding pass, please?", es: "¡Buenos días! ¿Puedo ver tu pasaporte y tu pase de abordar, por favor?", ctx: "Roleplay: airline check-in agent at a U.S. airport. Move step by step: passport, bags, seat, security, gate, boarding, a delay." },
  { id: "trabajo", n: "Trabajo", open: "Hi! Nice to meet you. What do you do for work?", es: "¡Hola! Mucho gusto. ¿A qué te dedicas?", ctx: "Talk about jobs and work life: duties, schedule, coworkers, meetings, goals. Keep asking natural follow-ups." },
  { id: "entrevista", n: "Entrevista", open: "Hello, thanks for coming in. Can you tell me a little about yourself?", es: "Hola, gracias por venir. ¿Puedes contarme un poco sobre ti?", ctx: "Roleplay: friendly job interviewer. Steps: introduction, experience, strengths, a weakness, a problem-solving question, expectations, then the student's questions." },
  { id: "compras", n: "Compras", open: "Hi there! Can I help you find something today?", es: "¡Hola! ¿Te ayudo a encontrar algo hoy?", ctx: "Roleplay: clothing store assistant. Steps: what they look for, size, color, fitting room, price, discount, payment, return policy." },
  { id: "doctor", n: "Doctor", open: "Hello! What brings you in today?", es: "¡Hola! ¿Qué te trae por aquí hoy?", ctx: "Roleplay: kind doctor in a clinic, simple and never alarming. Steps: symptoms, how long, pain level, advice, medicine, follow-up." },
  { id: "amigos", n: "Hacer amigos", open: "Hey, I don't think we've met! What's your name?", es: "¡Hola, creo que no nos conocemos! ¿Cómo te llamas?", ctx: "Casual small talk with a new friend: hobbies, music, food, weekend plans. Share a little about yourself too." }
 ];

 var S = { char: "levo", tema: null, msgs: [], hist: [], busy: false, rec: null, hablar: true, sugerencia: "", talkTimer: null, mem: "", estado: "idle", lang: (function () { try { return localStorage.getItem("evoConvLang") === "es" ? "es" : "en"; } catch (e) { return "en"; } })() };
 var els = {};
 var cssListo = false;

 /* ---------- utilidades ---------- */
 function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
 function pj() { return PERSONAJES.filter(function (p) { return p.id === S.char; })[0] || PERSONAJES[0]; }
 // Guía elegido por el alumno (se guarda por usuario). Lo leen guias.js y las pantallas de práctica.
 function claveGuia() { try { var u = window.LoginOnboarding && window.LoginOnboarding.usuarioActual && window.LoginOnboarding.usuarioActual(); return "evoGuia:" + (u && u.usuario || "anon"); } catch (e) { return "evoGuia:anon"; } }
 window.EvoGuia = {
  get: function () { try { return localStorage.getItem(claveGuia()) || ""; } catch (e) { return ""; } },
  set: function (id) { try { localStorage.setItem(claveGuia(), id); } catch (e) {} S.char = id; S.charTouched = false; }
 };
 function guiaInit() {
  if (S.charTouched) return;
  var g = window.EvoGuia.get();
  if (g && PERSONAJES.some(function (p) { return p.id === g && p.disponible; })) S.char = g;
 }
 function nombreAlumno() {
  try { var u = window.LoginOnboarding && window.LoginOnboarding.usuarioActual && window.LoginOnboarding.usuarioActual(); return u && u.nombre ? String(u.nombre).split(" ")[0] : ""; } catch (e) { return ""; }
 }
 function nivelAlumno() { try { return (typeof window.activeLevel === "function" && window.activeLevel()) || "A1"; } catch (e) { return "A1"; } }
 function hoyKey() { var d = new Date(); return "evoConvDia:" + d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
 function usadosHoy() { try { return parseInt(localStorage.getItem(hoyKey()) || "0", 10) || 0; } catch (e) { return 0; } }
 function sumarUso() { try { localStorage.setItem(hoyKey(), String(usadosHoy() + 1)); } catch (e) {} }

 var IC = {
  kb: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>',
  mic: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  send: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  sound: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
  tr: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h9M8.5 3v2M6 5c.6 3.6 3 6.4 6 8M12 5c-.7 3.7-3.4 6.6-7.5 8.5"/><path d="M12 20l4-9 4 9M13.5 17h5"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>'
 };

 /* ---------- estilos ---------- */
 function inyectarCSS() {
  if (cssListo) return; cssListo = true;
  var css = [
   ".hb{position:relative;display:block;width:100%;min-height:226px;overflow:hidden;border:0;border-radius:26px;padding:0;text-align:left;cursor:pointer;color:#fff;background:#07241C;box-shadow:0 14px 34px rgba(7,36,28,.35);font-family:'DM Sans',Arial,sans-serif;-webkit-tap-highlight-color:transparent}",
   ".hb:active{transform:scale(.99)}",
   ".hb-bg{position:absolute;inset:0;background:linear-gradient(100deg,rgba(5,30,23,.94) 28%,rgba(5,30,23,.55) 62%,rgba(5,30,23,.15)),url(assets/platform-bg.jpg) center/cover}",
   ".hb-fx i{position:absolute;width:6px;height:6px;border-radius:50%;background:#B8FF9E;box-shadow:0 0 10px #B8FF9E;opacity:.0;animation:hb-ff 5s ease-in-out infinite}",
   ".hb-fx i:nth-child(1){left:48%;top:22%}.hb-fx i:nth-child(2){left:58%;top:62%;animation-delay:1.3s}.hb-fx i:nth-child(3){left:40%;top:78%;animation-delay:2.4s}.hb-fx i:nth-child(4){left:70%;top:18%;animation-delay:3.1s}.hb-fx i:nth-child(5){left:86%;top:50%;animation-delay:.7s}",
   "@keyframes hb-ff{0%,100%{opacity:0;transform:translateY(0)}50%{opacity:.95;transform:translateY(-12px)}}",
   ".hb-txt{position:relative;z-index:2;display:flex;flex-direction:column;align-items:flex-start;gap:7px;padding:18px 14px 18px 18px;max-width:60%}",
   ".hb-kick{display:inline-flex;align-items:center;gap:7px;padding:4px 10px;border-radius:99px;background:rgba(52,211,153,.18);border:1px solid rgba(52,211,153,.5);color:#9CF2CB;font:800 11px 'DM Sans',sans-serif;letter-spacing:.08em}",
   ".hb-live{width:8px;height:8px;border-radius:50%;background:#34D399;box-shadow:0 0 8px #34D399;animation:hb-pulse 1.4s infinite}",
   "@keyframes hb-pulse{50%{transform:scale(1.5);opacity:.6}}",
   ".hb-txt b{font:700 22px/1.12 'Space Grotesk',Arial,sans-serif;letter-spacing:-.01em}",
   ".hb-txt small{font-size:13.5px;line-height:1.35;color:rgba(255,255,255,.88)}",
   ".hb-cta{display:inline-flex;align-items:center;gap:8px;margin-top:4px;padding:10px 14px;border-radius:99px;white-space:nowrap;background:linear-gradient(135deg,#22C37A,#12A85F);color:#fff;font:800 13.5px 'DM Sans',sans-serif;box-shadow:0 8px 18px rgba(18,168,95,.45)}",
   ".hb-cta svg{width:18px;height:18px}",
   ".hb-eq{display:inline-flex;align-items:flex-end;gap:2px;height:14px;margin-left:2px}",
   ".hb-eq i{width:3px;border-radius:2px;background:#fff;animation:hb-eq 1s ease-in-out infinite}",
   ".hb-eq i:nth-child(1){height:6px}.hb-eq i:nth-child(2){height:12px;animation-delay:.15s}.hb-eq i:nth-child(3){height:8px;animation-delay:.3s}.hb-eq i:nth-child(4){height:14px;animation-delay:.45s}",
   "@keyframes hb-eq{50%{transform:scaleY(.4)}}",
   ".hb-wolves{position:absolute;right:0;bottom:0;height:88%;width:44%;z-index:1;pointer-events:none}",
   ".hb-wolves img{position:absolute;bottom:0;height:100%;width:auto;max-width:none;filter:drop-shadow(0 6px 10px rgba(0,0,0,.5))}",
   ".hb-wolves img.a{right:34%;height:86%;opacity:.95}.hb-wolves img.b{right:-14%}",
   "@media (max-width:360px){.hb-txt b{font-size:19px}.hb-txt{max-width:68%}}",
   "@media (prefers-reduced-motion:reduce){.hb-fx i,.hb-live,.hb-eq i{animation:none!important}.hb-fx i{opacity:.6}}",
   ".hub-stage{position:relative;overflow:hidden;border-radius:26px;margin:0 0 18px;min-height:210px;background:#07241C url(assets/platform-bg.jpg) center/cover;box-shadow:0 14px 34px rgba(7,36,28,.3)}",
   ".hub-stage::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,30,23,.15),rgba(5,30,23,.72))}",
   ".hub-stage img{position:absolute;bottom:0;height:92%;width:auto;filter:drop-shadow(0 6px 10px rgba(0,0,0,.5))}",
   ".hub-stage img.l{left:50%;transform:translateX(-96%)}.hub-stage img.v{left:50%;transform:translateX(-4%)}",
   ".hub-stage p{position:absolute;left:0;right:0;bottom:12px;margin:0;text-align:center;color:#E3FFF1;font:700 14px 'DM Sans',sans-serif;z-index:2;text-shadow:0 2px 6px rgba(0,0,0,.6)}",
   ".hub-big{display:flex;align-items:center;gap:14px;width:100%;margin:0 0 12px;padding:18px;border-radius:22px;border:0;text-align:left;cursor:pointer;color:#fff;font-family:'DM Sans',Arial,sans-serif}",
   ".hub-big .ico{flex:none;width:56px;height:56px;border-radius:18px;display:grid;place-items:center;background:rgba(255,255,255,.2)}",
   ".hub-big .ico svg{width:30px;height:30px;color:#fff;stroke:#fff}",
   ".hub-big b{display:block;font:700 20px 'Space Grotesk',Arial,sans-serif;margin-bottom:2px}",
   ".hub-big small{display:block;font-size:14px;line-height:1.35;opacity:.92}",
   ".hub-big.free{background:linear-gradient(135deg,#12A85F,#0B7A5A);box-shadow:0 12px 26px rgba(18,168,95,.32)}",
   ".hub-big.guided{background:linear-gradient(135deg,#5B4FD6,#8B5CF6);opacity:.75;cursor:default}",
   ".hub-tag{display:inline-block;margin-left:8px;padding:2px 9px;border-radius:99px;background:rgba(255,255,255,.25);font:800 11px 'DM Sans',sans-serif;letter-spacing:.05em;vertical-align:middle}",
   ".cv-pair{display:grid;grid-template-columns:1fr;gap:12px;margin:0 0 18px}",
   "@media (min-width:640px){.cv-pair{grid-template-columns:1fr 1fr}}",
   ".cv-card{display:flex;align-items:center;gap:14px;text-align:left;width:100%;padding:16px;border-radius:20px;border:1px solid var(--line,#D3E4F7);background:#fff;color:var(--ink,#0B2247);font:inherit;cursor:pointer;min-height:84px}",
   ".cv-card b{display:block;font:700 18px 'Space Grotesk',Arial,sans-serif}",
   ".cv-card small{display:block;color:var(--mut,#516A8C);font-size:14px;line-height:1.35}",
   ".cv-card img{width:56px;height:56px;object-fit:contain;flex:none}",
   ".cv-card.main{background:linear-gradient(135deg,#0066FF,#14C2F5);color:#fff;border:0;box-shadow:0 12px 28px rgba(0,102,255,.28)}",
   ".cv-card.main small{color:rgba(255,255,255,.9)}",
   ".cv-card.off{opacity:.6;cursor:default}",
   ".cv-tag{display:inline-block;margin-left:6px;padding:2px 8px;border-radius:99px;background:#E5F0FF;color:#0B4FB3;font:700 11px 'DM Sans',sans-serif;vertical-align:middle}",
   ".cv-sec{margin:0 0 18px;padding:14px;border-radius:20px;background:rgba(255,255,255,.93)}",
   ".cv-sec h2{font:700 16px 'Space Grotesk',Arial,sans-serif;margin:0 0 4px}",
   ".cv-sec p{margin:0 0 10px;color:var(--mut,#516A8C);font-size:14px}",
   ".cv-pers{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
   ".cv-p{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 8px;border-radius:18px;border:2px solid var(--line,#D3E4F7);background:#fff;color:var(--ink,#0B2247);font:inherit;cursor:pointer;min-height:44px}",
   ".cv-p.on{border-color:#0066FF;background:#F0F6FF}",
   ".cv-p.off{opacity:.55;cursor:default}",
   ".cv-p img{width:64px;height:64px;object-fit:contain}",
   ".cv-p .ph{width:64px;height:64px;border-radius:50%;background:#E5F0FF;color:#0B4FB3;display:grid;place-items:center;font:700 26px 'Space Grotesk',sans-serif}",
   ".cv-p b{font:700 15px 'Space Grotesk',Arial,sans-serif}.cv-p small{color:var(--mut,#516A8C);font-size:12px}",
   ".cv-chips{display:flex;flex-wrap:wrap;gap:8px}",
   ".cv-chip{min-height:44px;padding:0 16px;border-radius:99px;border:1px solid var(--line,#D3E4F7);background:#fff;color:var(--ink,#0B2247);font:600 15px 'DM Sans',system-ui,sans-serif;cursor:pointer}",
   ".cv-card:focus-visible,.cv-p:focus-visible,.cv-chip:focus-visible,.cv-btn:focus-visible,.cv-in:focus-visible,.cv-mic:focus-visible,.cv-send:focus-visible{outline:3px solid #34D399;outline-offset:2px}",
   /* pantalla de conversación (a pantalla completa) */
   ".cv-chat{position:fixed;inset:0;z-index:40;background:#F4F8FF;color:#0B2247;display:flex;flex-direction:column;font-family:'DM Sans',system-ui,sans-serif}",
   ".cv-msgs{flex:1;overflow-y:auto;padding:14px max(14px,env(safe-area-inset-right,0px)) 10px max(14px,env(safe-area-inset-left,0px));display:flex;flex-direction:column;gap:10px;width:100%;max-width:760px;margin:0 auto;box-sizing:border-box}",
   ".cv-m{max-width:88%;padding:11px 14px;border-radius:18px;font-size:17px;line-height:1.5;word-wrap:break-word}",
   ".cv-m.bot{align-self:flex-start;background:#fff;border:1px solid #DCE6F8;border-bottom-left-radius:6px}",
   ".cv-m.me{align-self:flex-end;background:#0066FF;color:#fff;border-bottom-right-radius:6px}",
   ".cv-m.err{align-self:center;background:#FDEDEE;color:#8A1F24;font-size:14px;text-align:center}",
   ".cv-es{margin-top:8px;padding-top:8px;border-top:1px dashed #C9D8F0;color:#516A8C;font-size:15px}",
   ".cv-acts{display:flex;gap:8px;margin-top:8px}",
   ".cv-ab{width:40px;height:40px;border-radius:50%;border:0;background:#EAF1FF;color:#0B4FB3;display:grid;place-items:center;cursor:pointer}",
   ".cv-ab:focus-visible{outline:3px solid #34D399;outline-offset:2px}",
   ".cv-fix{align-self:flex-end;max-width:88%;padding:10px 13px;border-radius:14px;background:#E6F7EE;border:1px solid #BFE8D2;color:#0B5A33;font-size:15px;line-height:1.45}",
   ".cv-fix b{display:block;font:700 12px 'Space Grotesk',sans-serif;letter-spacing:.06em;text-transform:uppercase;margin-bottom:2px}",
   ".cv-dots{align-self:flex-start;background:#fff;border:1px solid #DCE6F8;border-radius:18px;padding:13px 15px;display:flex;gap:5px}",
   ".cv-dots i{width:8px;height:8px;border-radius:50%;background:#9FB4D6;animation:cv-d 1s infinite}",
   ".cv-dots i:nth-child(2){animation-delay:.15s}.cv-dots i:nth-child(3){animation-delay:.3s}",
   "@keyframes cv-d{0%,60%,100%{opacity:.35;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}",
   ".cv-foot{background:#fff;border-top:1px solid #E1E9F7;padding:8px max(12px,env(safe-area-inset-right,0px)) calc(10px + env(safe-area-inset-bottom,0px)) max(12px,env(safe-area-inset-left,0px))}",
   ".cv-foot>div{max-width:760px;margin:0 auto}",
   ".cv-sug{display:flex;align-items:center;gap:8px;width:100%;margin:0 0 8px;padding:8px 12px;min-height:44px;border-radius:14px;border:1px dashed #9B87F5;background:#F3F0FF;color:#4C2FBF;font:600 15px 'DM Sans',sans-serif;text-align:left;cursor:pointer}",
   ".cv-sug span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
   ".cv-row{display:flex;align-items:center;gap:8px}",
   ".cv-in{flex:1;min-width:0;min-height:48px;border-radius:24px;border:2px solid #D3E4F7;padding:0 16px;font:500 17px 'DM Sans',system-ui,sans-serif;color:#0B2247;background:#fff}",
   ".cv-in:focus{outline:none;border-color:#0066FF}",
   ".cv-mic,.cv-send{width:52px;height:52px;border-radius:50%;border:0;display:grid;place-items:center;cursor:pointer;flex:none;color:#fff}",
   ".cv-mic{background:#5B4FD6}.cv-mic.rec{background:#E5484D;animation:cv-pulse 1s infinite}",
   ".cv-send{background:#12A85F}.cv-send:disabled,.cv-mic:disabled{opacity:.5;cursor:default}",
   "@keyframes cv-pulse{0%,100%{box-shadow:0 0 0 0 rgba(229,72,77,.5)}50%{box-shadow:0 0 0 10px rgba(229,72,77,0)}}",
   ".cv-note{margin:6px 0 0;text-align:center;color:#516A8C;font-size:13px;min-height:18px}",
   ".cv-stage{position:relative;flex:none;height:clamp(190px,34dvh,300px);overflow:hidden;background:#0B2A22;border-bottom-left-radius:28px;border-bottom-right-radius:28px;box-shadow:0 10px 30px rgba(11,34,71,.25)}",
   ".cv-bg{position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,28,22,.15),rgba(6,28,22,.55)),url('assets/platform-bg.jpg') center 40%/cover;transform:scale(1.08);animation:cv-pan 24s ease-in-out infinite alternate}",
   ".cv-mist{position:absolute;inset:auto 0 0 0;height:55%;background:linear-gradient(0deg,rgba(11,42,34,.85),rgba(11,42,34,0))}",
   "@keyframes cv-pan{from{transform:scale(1.08) translateX(-1.5%)}to{transform:scale(1.08) translateX(1.5%)}}",
   ".cv-glow{position:absolute;left:50%;bottom:-10px;width:260px;height:120px;transform:translateX(-50%);border-radius:50%;background:radial-gradient(closest-side,rgba(110,255,190,.45),rgba(110,255,190,0));animation:cv-glow 4s ease-in-out infinite}",
   "@keyframes cv-glow{0%,100%{opacity:.7;transform:translateX(-50%) scale(1)}50%{opacity:1;transform:translateX(-50%) scale(1.12)}}",
   ".cv-wolf{position:absolute;left:50%;bottom:0;height:88%;aspect-ratio:1/1.1;transform:translateX(-50%);transform-origin:50% 100%;animation:cv-breath 4.2s ease-in-out infinite}",
   ".cv-w{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:50% 100%;opacity:0;transition:opacity .35s;filter:drop-shadow(0 8px 14px rgba(0,0,0,.45))}",
   ".cv-w.on{opacity:1}",
   ".cv-jaw,.cv-mouth{position:absolute;pointer-events:none;opacity:0;transition:opacity .2s}",
   ".cv-jaw{inset:0;transform:translateY(calc(var(--d,0)*1%));-webkit-mask-image:radial-gradient(ellipse 7.2% 3.4% at 51.1% 38%,#000 60%,transparent 100%);mask-image:radial-gradient(ellipse 7.2% 3.4% at 51.1% 38%,#000 60%,transparent 100%)}",
   ".cv-jaw img{width:100%;height:100%;object-fit:contain;object-position:50% 100%}",
   ".cv-mouth{left:51.1%;top:35%;width:7.4%;height:calc(var(--d,0)*1% + .25%);transform:translateX(-50%);border-radius:0 0 50% 50%/0 0 100% 100%;background:linear-gradient(#1A0407 0,#3A0A14 55%,#8E3345 85%,#B04A5C 100%)}",
   ".cv-fr{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .2s}",
   ".cv-fr img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:50% 100%;opacity:0;filter:drop-shadow(0 8px 14px rgba(0,0,0,.45))}",
   ".cv-fr img.on{opacity:1}",
   ".cv-stage[data-lip=on] .cv-fr{opacity:1}",
   ".cv-stage[data-lip=on] .cv-jaw,.cv-stage[data-lip=on] .cv-mouth{opacity:1}",
   "@keyframes cv-breath{0%,100%{transform:translateX(-50%) scale(1)}50%{transform:translateX(-50%) scale(1.025)}}",
   ".cv-stage[data-estado=talk] .cv-wolf{animation:cv-talk .5s ease-in-out infinite alternate}",
   "@keyframes cv-talk{from{transform:translateX(-50%) translateY(0) scale(1)}to{transform:translateX(-50%) translateY(-5px) scale(1.04)}}",
   ".cv-stage[data-estado=think] .cv-wolf{animation:cv-tilt 1.6s ease-in-out infinite}",
   "@keyframes cv-tilt{0%,100%{transform:translateX(-50%) rotate(-3deg)}50%{transform:translateX(-50%) rotate(3deg)}}",
   ".cv-stage[data-estado=listen] .cv-glow{background:radial-gradient(closest-side,rgba(120,200,255,.6),rgba(120,200,255,0))}",
   ".cv-rings{position:absolute;left:50%;bottom:18%;width:0;height:0;pointer-events:none}",
   ".cv-rings i{position:absolute;left:-60px;top:-60px;width:120px;height:120px;border-radius:50%;border:2px solid rgba(150,255,205,.7);opacity:0}",
   ".cv-stage[data-estado=talk] .cv-rings i{animation:cv-ring 1.8s ease-out infinite}",
   ".cv-stage[data-estado=listen] .cv-rings i{border-color:rgba(130,205,255,.8);animation:cv-ring 1.4s ease-out infinite}",
   ".cv-rings i:nth-child(2){animation-delay:.6s!important}.cv-rings i:nth-child(3){animation-delay:1.2s!important}",
   "@keyframes cv-ring{0%{transform:scale(.6);opacity:.8}100%{transform:scale(2.4);opacity:0}}",
   ".cv-fx{position:absolute;inset:0;pointer-events:none}",
   ".f{position:absolute;width:6px;height:6px;border-radius:50%;background:#C6FFB0;box-shadow:0 0 10px 3px rgba(198,255,176,.8);opacity:0;animation:cv-fly 7s ease-in-out infinite}",
   ".f1{left:12%;top:60%;animation-delay:0s}.f2{left:24%;top:35%;animation-delay:1.2s}.f3{left:78%;top:55%;animation-delay:2.4s}.f4{left:88%;top:30%;animation-delay:.7s}.f5{left:65%;top:70%;animation-delay:3.1s}.f6{left:38%;top:75%;animation-delay:4s}.f7{left:52%;top:25%;animation-delay:5s}",
   "@keyframes cv-fly{0%{opacity:0;transform:translate(0,0)}20%{opacity:1}50%{transform:translate(14px,-22px);opacity:.9}80%{opacity:1}100%{opacity:0;transform:translate(-10px,-46px)}}",
   ".lf{position:absolute;top:-24px;width:14px;height:20px;border-radius:0 90% 0 90%;background:linear-gradient(135deg,#34D399,#0C9450);opacity:.85;animation:cv-leaf 11s linear infinite}",
   ".lf1{left:18%;animation-delay:0s}.lf2{left:46%;animation-delay:3.5s;transform:scale(.8)}.lf3{left:72%;animation-delay:6s}.lf4{left:90%;animation-delay:8.5s;transform:scale(.7)}",
   "@keyframes cv-leaf{0%{transform:translate(0,0) rotate(0)}50%{transform:translate(-26px,150px) rotate(180deg)}100%{transform:translate(18px,320px) rotate(360deg)}}",
   ".cv-bar{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top,0px)) max(12px,env(safe-area-inset-right,0px)) 10px max(12px,env(safe-area-inset-left,0px));background:linear-gradient(180deg,rgba(6,28,22,.7),rgba(6,28,22,0));color:#fff}",
   ".cv-btn{width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.35);background:rgba(11,42,34,.55);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#fff;display:grid;place-items:center;cursor:pointer;flex:none}",
   ".cv-btn.on{background:#12A85F;border-color:#12A85F}",
   ".cv-who{min-width:0;flex:1;text-shadow:0 1px 6px rgba(0,0,0,.5)}",
   ".cv-who b{display:block;font:700 18px 'Space Grotesk',Arial,sans-serif}",
   ".cv-who small{display:block;color:#D6F5E4;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
   ".cv-state{position:absolute;left:14px;bottom:12px;padding:4px 12px;border-radius:99px;background:rgba(11,42,34,.6);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.25);color:#D6F5E4;font:700 12px 'DM Sans',sans-serif;letter-spacing:.04em}",
   ".cv-state::before{content:'';display:inline-block;width:8px;height:8px;margin-right:7px;border-radius:50%;background:#34D399;box-shadow:0 0 8px #34D399}",
   ".cv-cap{position:absolute;right:12px;bottom:12px;max-width:min(62%,420px);padding:8px 12px;border-radius:16px;background:rgba(255,255,255,.88);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);color:#0B2247;font:600 14px/1.35 'DM Sans',sans-serif;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}",
   "@media (max-width:480px){.cv-cap{left:12px;right:12px;max-width:none;bottom:46px;-webkit-line-clamp:2}.cv-state{bottom:12px}.cv-stage{height:clamp(220px,36dvh,320px)}}",
   ".cv-voice{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 4px 0}",
   ".cv-kb{width:48px;height:48px;border-radius:14px;border:1px solid #D3DEF2;background:#F4F7FD;color:#3A4F73;display:grid;place-items:center;cursor:pointer;flex:none}",
   ".cv-big{position:relative;width:84px;height:84px;border-radius:50%;border:0;background:linear-gradient(145deg,#12A85F,#0B7A5A);color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:0 8px 22px rgba(18,168,95,.4)}",
   ".cv-big svg{width:38px;height:38px}",
   ".cv-big.rec{background:linear-gradient(145deg,#F0585C,#C93238);box-shadow:0 0 0 0 rgba(229,72,77,.5);animation:cv-ring 1.3s infinite}",
   "@keyframes cv-ring{0%{box-shadow:0 0 0 0 rgba(229,72,77,.5)}100%{box-shadow:0 0 0 22px rgba(229,72,77,0)}}",
   ".cv-big:disabled{opacity:.45;cursor:default}",
   ".cv-spc{width:48px;flex:none}",
   ".cv-lang{width:48px;height:48px;border-radius:14px;border:1px solid #D3DEF2;background:#F4F7FD;color:#3A4F73;font:800 14px 'DM Sans',sans-serif;cursor:pointer;flex:none;line-height:1}",
   ".cv-lang small{display:block;font:600 9px 'DM Sans',sans-serif;margin-top:2px;color:#6B7FA3}",
   ".cv-lang.es{background:#FFF1D6;border-color:#F2C46A;color:#7A4B00}",
   ".cv-lbl{margin:6px 0 2px;text-align:center;font:700 15px 'DM Sans',sans-serif;color:#0B2247;min-height:22px}",
   ".cv-live{margin:0 0 8px;padding:10px 14px;border-radius:16px;background:#E8F7EF;border:1px solid #BFE8D2;color:#0B3B2B;font:600 16px/1.35 'DM Sans',sans-serif;max-height:96px;overflow:auto}",
   ".cv-live:empty{display:none}",
   "@media (prefers-reduced-motion:reduce){.cv-big.rec{animation:none!important}}",
   "@media (prefers-reduced-motion:reduce){.cv-bg,.cv-glow,.cv-wolf,.cv-rings i,.f,.lf,.cv-dots i,.cv-mic.rec{animation:none!important}.f{opacity:.7}}"
  ].join("\n");
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
 }

 /* ---------- instrucciones para la IA ---------- */
 function sistema(opener) {
  var p = pj(), t = S.tema;
  var op = opener ? String(opener).slice(0, 150) : "";
  return [
   "You are " + p.nombre + ", a friendly wolf: English conversation partner and tutor in the EVO ENGLISH app. Speak like a warm native from the U.S., natural everyday English.",
   "Student: " + (nombreAlumno() || "a student") + ", Spanish speaker, level " + nivelAlumno() + ". Match it with common words. A1-A2: max 2 short sentences. B1-B2: up to 3. C1-C2: natural, richer vocabulary, idioms ok.",
   "Topic: " + (t ? t.ctx : "anything the student wants; follow their lead and keep a long, natural chat going.") + (op ? " You opened with: \"" + op + "\"" : ""),
   (S.mem ? "Notes about the student so far: " + S.mem : ""),
   "Reply in EXACTLY this format, each tag on its own line:",
   "<say>your reply in English + ONE easy follow-up question</say>",
   "<fix>only if the student's last message had a real mistake: one short tip in Spanish with the correct English sentence; else empty</fix>",
   "<try>a natural sentence the student could say next, in English</try>",
   "<mem>updated short notes (max 180 chars): start with 'Level: <your CEFR estimate A1-C2>;' then interests/facts the student shared; keep earlier ones that matter</mem>",
   "Rules: if the student writes Spanish or seems lost, answer in simple English and add the Spanish meaning in parentheses inside <say>. If the student wrote in Spanish, put in <fix> a short line like: En inglés se dice: '...' (the English version of what they said), so they learn it. Be warm, never mock mistakes. Do not translate everything. Stay on English practice. Never ask for personal data (address, phone, passwords, payments)."
  ].filter(Boolean).join("\n");
 }

 function parsear(raw) {
  var txt = String(raw || "");
  function tag(n) { var m = txt.match(new RegExp("<" + n + ">([\\s\\S]*?)(?:</" + n + ">|$)", "i")); return m ? m[1].trim() : ""; }
  var say = tag("say"), fix = tag("fix"), tr = tag("try"), mem = tag("mem");
  if (!say) say = txt.replace(/<[^>]*>/g, "").trim();
  // Sin texto de corrección real (vacío o "none"): no se muestra.
  if (/^(none|n\/a|no mistakes?|ninguno|-)\.?$/i.test(fix)) fix = "";
  return { say: say, fix: fix, tr: tr.replace(/^["“]|["”]$/g, ""), mem: mem.replace(/<[^>]*>/g, "").slice(0, 200) };
 }

 async function pedir(payload) {
  var ult = 0;
  for (var i = 0; i < 2; i++) {
   try {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 28000), r;
    try { r = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ctl.signal }); }
    finally { clearTimeout(t); }
    ult = r.status;
    var d = await r.json().catch(function () { return {}; });
    var txt = r.ok ? ((d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts || []).map(function (p) { return p.text || ""; }).join("").trim()) : "";
    if (txt) return { ok: true, text: txt };
    if (r.status === 400 || r.status === 403 || r.status === 429) break;
   } catch (e) { ult = 0; }
   if (i < 1) await new Promise(function (ok) { setTimeout(ok, 1200); });
  }
  return { ok: false, status: ult };
 }

 /* ---------- vistas ---------- */
 function banner() {
  inyectarCSS();
  var lv = PERSONAJES[0], la = PERSONAJES[1];
  return '<section class="home-sec"><button type="button" class="hb" data-href="#/hablar" aria-label="Ir a Habla: practica conversando con LEVO o LEVA">'
   + '<span class="hb-bg"></span><span class="hb-fx" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>'
   + '<span class="hb-txt"><span class="hb-kick"><i class="hb-live"></i>NUEVO · HABLA</span>'
   + '<b>Habla inglés de verdad</b><small>Conversa con LEVO o LEVA y construye tu fluidez.</small>'
   + '<span class="hb-cta">' + IC.mic + 'Empezar a hablar<span class="hb-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span></span></span>'
   + '<span class="hb-wolves" aria-hidden="true"><img class="a" src="' + la.poses.idle + '" alt=""><img class="b" src="' + lv.poses.idle + '" alt=""></span>'
   + '</button></section>';
 }

 function vistaHub() {
  inyectarCSS(); guiaInit();
  var lv = PERSONAJES[0], la = PERSONAJES[1];
  var gid = window.EvoGuia.get(), gp = PERSONAJES.filter(function (p) { return p.id === gid; })[0];
  var chipGuia = gp ? '<button type="button" class="hub-guia" data-guia="cambiar"><img src="' + gp.poses.idle + '" alt=""><span>Tu guía: ' + esc(gp.nombre) + '<small>Toca para cambiar de guía</small></span><em>Cambiar</em></button>' : '';
  return '<div class="hero"><div><h1>Habla</h1><p class="sub">Construye tu fluidez conversando de verdad</p></div></div>'
   + chipGuia
   + '<div class="hub-stage"><img class="l" src="' + lv.poses.idle + '" alt=""><img class="v" src="' + la.poses.idle + '" alt=""><p>LEVO y LEVA te esperan para conversar</p></div>'
   + '<button type="button" class="hub-big free" data-href="#/conversar"><span class="ico">' + IC.mic + '</span><span><b>Práctica libre</b><small>Habla de lo que quieras con LEVO o LEVA. Ellos te corrigen y te ayudan a decirlo mejor.</small></span></button>'
   + '<button type="button" class="hub-big guided" aria-disabled="true" data-t="La práctica guiada llega muy pronto"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h12a4 4 0 0 1 4 4v10H8a4 4 0 0 1-4-4V5zM8 9h8M8 13h5"/></svg></span><span><b>Práctica guiada<span class="hub-tag">PRONTO</span></b><small>Lecciones habladas paso a paso, de A1 a C2, como con un profesor nativo.</small></span></button>';
 }

 function cta() {
  inyectarCSS();
  return '<div class="cv-pair">'
   + '<button type="button" class="cv-card main" data-href="#/conversar"><img src="assets/mascot/evo_welcome.png" alt="" width="56" height="56"><span><b>Práctica libre</b><small>Habla lo que quieras con LEVO para ganar fluidez</small></span></button>'
   + '<button type="button" class="cv-card off" aria-disabled="true" data-t="La práctica guiada llega muy pronto"><span style="font-size:0;width:56px;height:56px;border-radius:16px;background:#E5F0FF;display:grid;place-items:center;flex:none"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#0B4FB3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h12a4 4 0 0 1 4 4v10H8a4 4 0 0 1-4-4V5zM8 9h8M8 13h5"/></svg></span><span><b>Práctica guiada<span class="cv-tag">Pronto</span></b><small>Lecciones habladas de A1 a C2</small></span></button>'
   + '</div>';
 }

 function vistaInicio() {
  inyectarCSS(); guiaInit();
  var p = pj();
  var pers = PERSONAJES.map(function (c) {
   var img = c.poses ? '<img src="' + c.poses.idle + '" alt="" width="64" height="64">' : '<div class="ph" aria-hidden="true">' + esc(c.nombre.charAt(0)) + '</div>';
   return '<button type="button" class="cv-p' + (c.id === S.char ? " on" : "") + (c.disponible ? "" : " off") + '" data-cv="pers" data-id="' + c.id + '"' + (c.disponible ? ' aria-pressed="' + (c.id === S.char) + '"' : ' aria-disabled="true"') + '>' + img + '<b>' + esc(c.nombre) + '</b><small>' + (c.disponible ? esc(c.rol) : "Muy pronto") + '</small></button>';
  }).join("");
  var chips = TEMAS.map(function (t) { return '<button type="button" class="cv-chip" data-cv="start" data-tema="' + t.id + '">' + esc(t.n) + '</button>'; }).join("");
  return '<div class="hero"><div><h1>Práctica libre</h1><p class="sub">Conversa en inglés con tu tutor, a tu ritmo y sin pena</p></div></div>'
   + '<section class="cv-sec"><h2>Elige a tu tutor</h2><div class="cv-pers">' + pers + '</div></section>'
   + '<button type="button" class="cv-card main" data-cv="start" data-tema="" style="margin-bottom:20px"><img src="' + (p.poses ? p.poses.talk : "") + '" alt="" width="56" height="56"><span><b>Habla lo que quieras con ' + esc(p.nombre) + '</b><small>Para mejorar tu inglés y hablar con más fluidez</small></span></button>'
   + '<section class="cv-sec"><h2>¿Prefieres un tema? <span class="cv-tag">Opcional</span></h2><p>Toca uno y ' + esc(p.nombre) + ' empieza la conversación.</p><div class="cv-chips">' + chips + '</div></section>';
 }

 function vistaChat() {
  inyectarCSS(); guiaInit();
  var p = pj();
  var micOk = !!(window.SpeechRecognition || window.webkitSpeechRecognition || (window.EvoRec && window.EvoRec.ok()));
  setTimeout(montar, 0);
  var w = p.poses ? p.poses.idle : "";
  var lucis = "";
  for (var i = 1; i <= 7; i++) lucis += '<i class="f f' + i + '"></i>';
  var hojas = "";
  for (var j = 1; j <= 4; j++) hojas += '<i class="lf lf' + j + '"></i>';
  return '<div class="cv-chat" id="cv-chat" role="main">'
   + '<div class="cv-stage" id="cv-stage" data-estado="idle">'
   + '<div class="cv-bg"></div><div class="cv-mist"></div>'
   + '<div class="cv-fx" aria-hidden="true">' + lucis + hojas + '</div>'
   + '<div class="cv-glow" aria-hidden="true"></div>'
   + '<div class="cv-rings" aria-hidden="true"><i></i><i></i><i></i></div>'
   + '<div class="cv-wolf" aria-hidden="true"><img class="cv-w on" id="cv-wa" src="' + w + '" alt=""><img class="cv-w" id="cv-wb" src="' + w + '" alt="">' + (p.frames ? '<div class="cv-fr" id="cv-fr"><img class="on" data-f="closed" src="' + p.frames.closed + '" alt=""><img data-f="half" src="' + p.frames.half + '" alt=""><img data-f="open" src="' + p.frames.open + '" alt=""></div>' : p.jaw ? '<i class="cv-mouth" id="cv-mouth"></i><div class="cv-jaw" id="cv-jaw"><img src="' + w + '" alt=""></div>' : '') + '</div>'
   + '<div class="cv-bar">'
   + '<button type="button" class="cv-btn" data-cv="salir" aria-label="Salir de la conversación">' + IC.back + '</button>'
   + '<div class="cv-who"><b>' + esc(p.nombre) + '</b><small id="cv-sub">' + (S.tema ? esc(S.tema.n) : "Habla de lo que quieras") + '</small></div>'
   + '<button type="button" class="cv-btn' + (S.hablar ? " on" : "") + '" data-cv="voz" aria-pressed="' + S.hablar + '" aria-label="Voz de ' + esc(p.nombre) + '">' + IC.sound + '</button>'
   + '<button type="button" class="cv-btn" data-cv="nueva" aria-label="Nueva conversación">' + IC.refresh + '</button></div>'
   + '<div class="cv-state" id="cv-state" aria-live="polite">En línea</div>'
   + '<div class="cv-cap" id="cv-cap" hidden></div>'
   + '</div>'
   + '<div class="cv-msgs" id="cv-msgs" aria-live="polite"></div>'
   + '<div class="cv-foot"><div>'
   + '<button type="button" class="cv-sug" id="cv-sug" data-cv="sug" hidden>' + IC.bulb + '<span id="cv-sugt"></span></button>'
   + '<div class="cv-live" id="cv-live" aria-live="polite"></div>'
   + (micOk ? '<div class="cv-voice" id="cv-voice"><button type="button" class="cv-kb" data-cv="kb" aria-label="Escribir en vez de hablar">' + IC.kb + '</button><button type="button" class="cv-big" id="cv-mic" data-cv="mic" aria-label="Toca para hablar">' + IC.mic + '</button><button type="button" class="cv-lang' + (S.lang === "es" ? " es" : "") + '" id="cv-lang" data-cv="lang" aria-label="Idioma con el que hablas al micrófono">' + (S.lang === "es" ? "ES" : "EN") + '<small>' + (S.lang === "es" ? "español" : "inglés") + '</small></button></div>' : '')
   + '<p class="cv-lbl" id="cv-note">' + (micOk ? "Toca el micrófono para hablar" : "Tu navegador no permite hablar aquí. Escribe tu mensaje.") + '</p>'
   + '<form class="cv-row" id="cv-form" autocomplete="off"' + (micOk ? ' hidden' : '') + '>'
   + '<input class="cv-in" id="cv-in" type="text" maxlength="' + MAX_CHARS + '" placeholder="Write in English…" aria-label="Tu mensaje">'
   + '<button type="submit" class="cv-send" id="cv-send" aria-label="Enviar">' + IC.send + '</button></form>'
   + '</div></div></div>';
 }

 function vista(seg) {
  if (seg && seg[0] === "hub") return vistaHub();
  if (seg && seg[0] === "chat" && S.msgs.length) return vistaChat();
  return vistaInicio();
 }

 /* ---------- conversación ---------- */
 function montar() {
  els = { chat: document.getElementById("cv-chat") };
  if (!els.chat) return;
  // Se mueve al <body> para que quede a pantalla completa aunque #app tenga transformaciones.
  if (els.chat.parentNode !== document.body) document.body.appendChild(els.chat);
  els.msgs = document.getElementById("cv-msgs"); els.in = document.getElementById("cv-in");
  els.form = document.getElementById("cv-form"); els.send = document.getElementById("cv-send");
  els.mic = document.getElementById("cv-mic"); els.live = document.getElementById("cv-live"); els.note = document.getElementById("cv-note");
  els.stage = document.getElementById("cv-stage"); els.wa = document.getElementById("cv-wa"); els.wb = document.getElementById("cv-wb");
  els.state = document.getElementById("cv-state"); els.cap = document.getElementById("cv-cap");
  els.sug = document.getElementById("cv-sug"); els.sugt = document.getElementById("cv-sugt");
  els.form.addEventListener("submit", function (e) { e.preventDefault(); enviar(els.in.value); });
  S.msgs.forEach(function (m) { pintar(m); });
  var ult = S.msgs.filter(function (m) { return m.r === "bot"; }).pop(); if (ult) caption(ult.t);
  pose(S.estado === "talk" ? "idle" : S.estado);
  mostrarSug(S.sugerencia);
  els.msgs.scrollTop = els.msgs.scrollHeight;
 }

 var ETIQ = { idle: "En línea", think: "Pensando…", talk: "Hablando", listen: "Te escucho" };
 function pose(estado) {
  var p = pj(); S.estado = estado;
  if (els.stage) els.stage.setAttribute("data-estado", estado);
  if (els.state) els.state.textContent = ETIQ[estado] || "En línea";
  if (!p.poses || !els.wa) return;
  var img = p.poses[estado === "think" ? "think" : estado === "happy" ? "happy" : (estado === "talk" && !p.jaw) ? "talk" : "idle"];
  var on = els.wa.classList.contains("on") ? els.wa : els.wb, off = on === els.wa ? els.wb : els.wa;
  if (on.getAttribute("src") === img) return;
  off.src = img; off.classList.add("on"); on.classList.remove("on");
 }
 function caption(t) {
  return; // el texto ya se ve en la burbuja del chat; el escenario queda libre para el lobo
  if (!els.cap) return;
  var clean = String(t || "").replace(/\([^)]*\)/g, "").trim();
  els.cap.hidden = !clean; els.cap.textContent = clean;
 }

 function nota(t) { if (els.note) els.note.textContent = t || ""; }

 function pintar(m) {
  if (!els.msgs) return;
  var d = document.createElement("div");
  if (m.r === "me") { d.className = "cv-m me"; d.textContent = m.t; m.el = d; els.msgs.appendChild(d); if (m.fix) pintarFix(m); }
  else if (m.r === "err") { d.className = "cv-m err"; d.textContent = m.t; els.msgs.appendChild(d); }
  else {
   d.className = "cv-m bot";
   var t = document.createElement("div"); t.textContent = m.t; d.appendChild(t);
   var es = document.createElement("div"); es.className = "cv-es"; es.hidden = !m.es || !m.verEs; es.textContent = m.es || ""; d.appendChild(es);
   var a = document.createElement("div"); a.className = "cv-acts";
   var b1 = document.createElement("button"); b1.type = "button"; b1.className = "cv-ab"; b1.setAttribute("aria-label", "Escuchar"); b1.innerHTML = IC.sound;
   b1.addEventListener("click", function () { hablar(m.t); });
   var b2 = document.createElement("button"); b2.type = "button"; b2.className = "cv-ab"; b2.setAttribute("aria-label", "Traducir al español"); b2.innerHTML = IC.tr;
   b2.addEventListener("click", function () { traducir(m, es, b2); });
   a.appendChild(b1); a.appendChild(b2); d.appendChild(a);
   els.msgs.appendChild(d);
  }
  els.msgs.scrollTop = els.msgs.scrollHeight;
 }

 function pintarFix(m) {
  if (!m.el || !m.fix) return;
  var f = document.createElement("div"); f.className = "cv-fix";
  var b = document.createElement("b"); b.textContent = "Consejo"; f.appendChild(b);
  f.appendChild(document.createTextNode(m.fix));
  m.el.after(f);
 }

 function mostrarSug(t) {
  S.sugerencia = t || "";
  if (!els.sug) return;
  els.sug.hidden = !S.sugerencia;
  if (S.sugerencia) els.sugt.textContent = "¿Qué decir? Puedes decir: " + S.sugerencia;
 }

 function escribiendo(si) {
  var v = els.msgs && els.msgs.querySelector(".cv-dots"); if (v) v.remove();
  if (si && els.msgs) { var d = document.createElement("div"); d.className = "cv-dots"; d.innerHTML = "<i></i><i></i><i></i>"; els.msgs.appendChild(d); els.msgs.scrollTop = els.msgs.scrollHeight; }
 }

 /* ---------- labios sincronizados con la voz ---------- */
 var LIP = { raf: 0, an: null, buf: null, sim: false, t0: 0, d: 0, idleT: 0, ctx: null };
 function lipCtx() {
  try {
   if (!LIP.ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) LIP.ctx = new AC(); }
   if (LIP.ctx && LIP.ctx.state === "suspended") LIP.ctx.resume();
  } catch (e) {}
 }
 function lipFrame() {
  var jaw = document.getElementById("cv-jaw"), mo = document.getElementById("cv-mouth"), fr = document.getElementById("cv-fr"), st = els.stage;
  if ((!jaw && !fr) || !st) { LIP.raf = 0; return; }
  var target = 0, t = performance.now() - LIP.t0;
  if (LIP.an) {
   LIP.an.getByteTimeDomainData(LIP.buf);
   var sum = 0; for (var i = 0; i < LIP.buf.length; i++) { var v = (LIP.buf[i] - 128) / 128; sum += v * v; }
   target = Math.min(2.1, Math.sqrt(sum / LIP.buf.length) * 11);
  } else if (LIP.sim) {
   // sin audio medible: ritmo de sílabas simulado
   target = Math.max(0, 0.4 + 1.1 * Math.abs(Math.sin(t / 95)) * (0.6 + 0.4 * Math.sin(t / 430)) + 0.2 * Math.sin(t / 37));
  }
  LIP.d += (target - LIP.d) * (target > LIP.d ? 0.55 : 0.3);
  var d = LIP.d < 0.04 ? 0 : LIP.d;
  if (fr) {
   var f = d < 0.35 ? "closed" : d < 1.0 ? "half" : "open";
   if (f !== LIP.f) { LIP.f = f; var im = fr.children; for (var k = 0; k < im.length; k++) im[k].classList.toggle("on", im[k].getAttribute("data-f") === f); }
  } else { jaw.style.setProperty("--d", d.toFixed(3)); if (mo) mo.style.setProperty("--d", d.toFixed(3)); }
  LIP.raf = requestAnimationFrame(lipFrame);
 }
 function lipStart(audio) {
  var p = pj(); if (!p.jaw || !els.stage) return;
  clearTimeout(LIP.idleT);
  LIP.an = null; LIP.sim = true; LIP.t0 = performance.now();
  try {
   if (audio && LIP.ctx && LIP.ctx.state === "running") {
    var src = audio.__src || (audio.__src = LIP.ctx.createMediaElementSource(audio)), an = LIP.ctx.createAnalyser();
    try { src.disconnect(); } catch (e0) {}
    an.fftSize = 512; src.connect(an); an.connect(LIP.ctx.destination);
    LIP.an = an; LIP.buf = new Uint8Array(an.fftSize); LIP.sim = false;
   }
  } catch (e) { LIP.an = null; LIP.sim = true; }
  els.stage.setAttribute("data-lip", "on"); pose("talk");
  if (!LIP.raf) LIP.raf = requestAnimationFrame(lipFrame);
 }
 function lipStop() {
  clearTimeout(LIP.idleT);
  LIP.idleT = setTimeout(function () {
   LIP.sim = false; LIP.an = null; LIP.d = 0;
   if (LIP.raf) { cancelAnimationFrame(LIP.raf); LIP.raf = 0; }
   if (els.stage) els.stage.removeAttribute("data-lip");
   var jaw = document.getElementById("cv-jaw"), mo = document.getElementById("cv-mouth"), fr = document.getElementById("cv-fr");
   if (jaw) jaw.style.setProperty("--d", "0"); if (mo) mo.style.setProperty("--d", "0");
   LIP.f = "closed"; if (fr) for (var k = 0; k < fr.children.length; k++) fr.children[k].classList.toggle("on", fr.children[k].getAttribute("data-f") === "closed");
   if (S.estado === "talk") pose("idle");
  }, 380);
 }
 // playAudioUrl (index.html) avisa aquí cada vez que empieza un audio de voz.
 window.__evoLip = function (au) {
  if (!els.stage || !document.getElementById("cv-chat")) return;
  var on = function () { LIP.fired = true; lipStart(au); };
  au.addEventListener("playing", on, { once: true });
  ["ended", "pause", "error"].forEach(function (ev) { au.addEventListener(ev, lipStop, { once: true }); });
 };

 function hablar(texto) {
  window.__evoVoz = pj().voz || "";
  var clean = String(texto).replace(/\([^)]*\)/g, "").trim();   // sin la ayuda entre paréntesis
  if (!clean) return;
  lipCtx(); LIP.fired = false;
  var navegador = true;
  try { navegador = !(typeof window.ttsProvider === "function" && window.ttsProvider() !== "browser"); } catch (e) {}
  if (!navegador && els.state) { els.state.textContent = "Preparando voz…"; clearTimeout(S.waitT); S.waitT = setTimeout(function () { if (S.estado !== "talk" && els.state) els.state.textContent = ETIQ[S.estado] || "En línea"; }, 15000); }
  try { if (typeof window.say === "function") { var pr = window.say(clean); if (!navegador && pr && pr.then) pr.then(function () { if (!LIP.fired && els.stage && S.estado !== "talk") { lipStart(null); S.talkTimer = setTimeout(lipStop, Math.max(1500, clean.split(/\s+/).length * 420)); } }); } else if (window.speechSynthesis) { window.speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(clean); u.lang = "en-US"; u.rate = 0.92; window.speechSynthesis.speak(u); } } catch (e) {}
  caption(texto); clearTimeout(S.talkTimer);
  if (navegador) {
   // voz del navegador: no hay audio que medir, se mueve la boca durante lo que dura la frase
   lipStart(null);
   S.talkTimer = setTimeout(lipStop, Math.max(1500, clean.split(/\s+/).length * 420));
  }
 }

 async function traducir(m, el, btn) {
  if (m.es) { m.verEs = !m.verEs; el.hidden = !m.verEs; return; }
  btn.disabled = true;
  var r = await pedir({ systemInstruction: { parts: [{ text: "Translate the user's English text into natural Mexican Spanish. Output ONLY the translation, nothing else." }] }, contents: [{ role: "user", parts: [{ text: m.t.slice(0, 500) }] }] });
  btn.disabled = false;
  if (r.ok) { m.es = r.text.replace(/<[^>]*>/g, "").trim(); m.verEs = true; el.textContent = m.es; el.hidden = false; }
  else nota("No pude traducir ahora. Intenta de nuevo.");
 }

 async function enviar(texto) {
  texto = String(texto || "").trim();
  if (!texto || S.busy) return;
  if (usadosHoy() >= MAX_DIA) { nota("Llegaste al límite de mensajes de hoy. ¡Vuelve mañana!"); return; }
  try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
  els.in.value = ""; nota(""); mostrarSug("");
  var mine = { r: "me", t: texto.slice(0, MAX_CHARS) };
  S.msgs.push(mine); pintar(mine);
  S.hist.push({ role: "user", parts: [{ text: mine.t }] });
  S.busy = true; els.send.disabled = true; if (els.mic) els.mic.disabled = true;
  escribiendo(true); pose("think");
  var opener = S.msgs[0] && S.msgs[0].r === "bot" ? S.msgs[0].t : "";
  var r = await pedir({ systemInstruction: { parts: [{ text: sistema(opener) }] }, contents: S.hist.slice(-MAX_TURNOS), generationConfig: { maxOutputTokens: 600, temperature: 0.8 } });
  escribiendo(false);
  if (r.ok) {
    sumarUso();
    var p = parsear(r.text);
    if (p.mem) S.mem = p.mem;
    S.hist.push({ role: "model", parts: [{ text: ("<say>" + p.say + "</say>").slice(0, 560) }] });
    if (p.fix) { mine.fix = p.fix; pintarFix(mine); }
    var bot = { r: "bot", t: p.say, es: "", verEs: false };
    S.msgs.push(bot); pintar(bot); caption(p.say);
    mostrarSug(p.tr);
    if (S.hablar) hablar(p.say); else pose(p.fix ? "idle" : "happy");
  } else {
    S.hist.pop();
    pose("idle");
    var msg = r.status === 429 ? "Hay muchos alumnos practicando ahora. Espera un momentito y vuelve a escribir."
      : r.status === 0 ? "Sin conexión. Revisa tu internet e intenta de nuevo."
      : "Tu tutor se está tomando un descanso corto. Vuelve a enviar tu mensaje en unos segundos.";
    var e = { r: "err", t: msg }; pintar(e);
    els.in.value = mine.t;
  }
  S.busy = false; els.send.disabled = false; if (els.mic) els.mic.disabled = false;
  if (els.form && !els.form.hidden) els.in.focus();
  else if (els.mic) nota("Toca el micrófono para hablar");
 }

function recToggle() {
  if (S.recCtl) { S.recCtl.stop(); return; }   // 2.º toque: terminar y enviar
  try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
  try { if (window.__sayAu) { window.__sayAu.pause(); window.__sayAu = null; } window.__sayTok = (window.__sayTok || 0) + 1; } catch (e) {}
  function limpiar() {
   if (els.mic) { els.mic.classList.remove("rec"); els.mic.setAttribute("aria-label", "Toca para hablar"); }
   if (S.estado === "listen") pose("idle");
   if (els.live) els.live.textContent = "";
  }
  var ctl = window.EvoRec.start({
   lang: S.lang === "es" ? "es" : "en",
   onState: function (t) { if (S.recCtl === ctl && els.live) els.live.textContent = t; },
   onText: function (t) { if (S.recCtl !== ctl) return; S.recCtl = null; limpiar(); enviar(t); nota(""); },
   onError: function (m) { if (S.recCtl !== ctl) return; S.recCtl = null; limpiar(); nota(m); }
  });
  S.recCtl = ctl;
  if (els.mic) { els.mic.classList.add("rec"); els.mic.setAttribute("aria-label", "Toca para terminar"); }
  nota("Te escucho… toca otra vez cuando termines"); pose("listen"); if (els.live) els.live.textContent = "";
 }
 function micToggle() {
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (S.busy) return;
  if (window.EvoRec && window.EvoRec.ok() && (window.EvoRec.usar() || !SR)) { recToggle(); return; }
  if (!SR) { nota("Este navegador no puede grabar tu voz. Abre la app en Chrome o Safari."); return; }
  if (S.rec) { S.manual = true; try { S.rec.stop(); } catch (e) {} return; }   // 2.º toque: terminar y enviar
  try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
  try { if (window.__sayAu) { window.__sayAu.pause(); window.__sayAu = null; } window.__sayTok = (window.__sayTok || 0) + 1; } catch (e) {}
  var acumulado = "", t0 = Date.now(), fallos = 0;
  S.manual = false;
  function vivo(t) { if (els.live) els.live.textContent = t; if (els.in) els.in.value = t; }
  function terminar() {
   S.rec = null; clearTimeout(S.recTimer);
   if (els.mic) { els.mic.classList.remove("rec"); els.mic.setAttribute("aria-label", "Toca para hablar"); }
   if (S.estado === "listen") pose("idle");
   var t = acumulado.trim();
   if (t) { if (els.live) els.live.textContent = ""; enviar(t); nota(""); }
   else { if (els.live) els.live.textContent = ""; nota(fallos ? "No te escuché bien. Toca el micrófono e intenta de nuevo." : "No te escuché. Toca el micrófono y habla."); }
  }
  function iniciar() {
   var rec = new SR(), base = acumulado;
   rec.lang = S.lang === "es" ? "es-MX" : "en-US"; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
   S.rec = rec;
   rec.onresult = function (e) {
    var t = ""; for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript + " ";
    acumulado = (base + " " + t).replace(/\s+/g, " ").trim(); vivo(acumulado);
   };
   rec.onerror = function (e) {
    var er = e && e.error;
    if (er === "not-allowed" || er === "service-not-allowed") { S.manual = true; fallos = 2; nota("Permite el micrófono en tu navegador para poder hablar."); }
    else if (er !== "no-speech" && er !== "aborted") fallos++;
   };
   rec.onend = function () {
    // El navegador a veces corta solo (silencio): si el alumno no tocó para terminar, seguimos escuchando.
    if (!S.manual && Date.now() - t0 < 90000 && fallos < 2) { try { iniciar(); return; } catch (e) {} }
    terminar();
   };
   try { rec.start(); } catch (e) { S.rec = null; terminar(); nota("No pude abrir el micrófono."); }
  }
  if (els.mic) { els.mic.classList.add("rec"); els.mic.setAttribute("aria-label", "Toca para terminar"); }
  nota("Te escucho… toca otra vez cuando termines"); pose("listen"); vivo("");
  iniciar();
 }

  function empezar(temaId) {
  var tema = TEMAS.filter(function (t) { return t.id === temaId; })[0] || null;
  var p = pj(), n = nombreAlumno();
  S.tema = tema; S.hist = []; S.sugerencia = ""; S.busy = false; S.mem = "";
  var open = tema ? tema.open : "Hi" + (n ? ", " + n : "") + "! I'm " + p.nombre + ". What do you want to talk about today? Anything you like!";
  var es = tema ? tema.es : "¡Hola" + (n ? ", " + n : "") + "! Soy " + p.nombre + ". ¿De qué quieres hablar hoy? ¡Lo que quieras!";
  S.msgs = [{ r: "bot", t: open, es: es, verEs: false }];
  var viejo = document.getElementById("cv-chat"); if (viejo) viejo.remove();
  if (location.hash === "#/conversar/chat") window.dispatchEvent(new Event("hashchange")); else location.hash = "#/conversar/chat";
 }

 /* ---------- eventos ---------- */
 document.addEventListener("click", function (e) {
  var x = e.target.closest && e.target.closest("[data-cv]");
  if (!x) return;
  lipCtx();
  var a = x.dataset.cv;
  if (a === "pers") { var c = PERSONAJES.filter(function (q) { return q.id === x.dataset.id; })[0]; if (c && c.disponible) { S.char = c.id; S.charTouched = true; if (typeof window.go === "function") window.go(); else window.dispatchEvent(new Event("hashchange")); } }
  else if (a === "start") empezar(x.dataset.tema || "");
  else if (a === "salir") { try { S.manual = true; if (S.rec) S.rec.stop(); var rc = S.recCtl; S.recCtl = null; if (rc) rc.stop(); if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (er) {} location.hash = "#/conversar"; }
  else if (a === "nueva") { empezar(S.tema ? S.tema.id : ""); }
  else if (a === "voz") { S.hablar = !S.hablar; x.classList.toggle("on", S.hablar); x.setAttribute("aria-pressed", S.hablar); if (!S.hablar) { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (er) {} } }
  else if (a === "mic") micToggle();
  else if (a === "lang") {
   S.lang = S.lang === "es" ? "en" : "es"; try { localStorage.setItem("evoConvLang", S.lang); } catch (er) {}
   x.classList.toggle("es", S.lang === "es"); x.firstChild.nodeValue = S.lang === "es" ? "ES" : "EN"; x.querySelector("small").textContent = S.lang === "es" ? "español" : "inglés";
   nota(S.lang === "es" ? "Micrófono en español: háblale en español y LEVO te ayuda a decirlo en inglés." : "Micrófono en inglés: habla en inglés.");
  }
  else if (a === "kb") { if (els.form) { els.form.hidden = !els.form.hidden; if (!els.form.hidden && els.in) els.in.focus(); } }
  else if (a === "sug") { if (S.sugerencia && els.in) { els.in.value = S.sugerencia; hablar(S.sugerencia); els.in.focus(); } }
 });

 // Al salir de la ruta de conversación se quita la pantalla completa.
 window.addEventListener("hashchange", function () {
  if (location.hash !== "#/conversar/chat") {
   var c = document.getElementById("cv-chat"); if (c) c.remove();
   try { S.manual = true; if (S.rec) S.rec.stop(); var rc2 = S.recCtl; S.recCtl = null; if (rc2) rc2.stop(); } catch (e) {}
  }
 });

 window.ConversarEngine = { vista: vista, cta: cta, banner: banner, personajes: function () { return PERSONAJES; } };
})();
