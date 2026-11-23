/* EVO ENGLISH · capa de "jugosidad" (v43)
   Solo apariencia y movimiento. No cambia la lógica de las lecciones.
   - Botones y fichas con grosor que se hunden al tocarlos
   - Barra de progreso con brillo y llenado suave
   - Acierto: la ficha rebota y suelta chispas / Error: la ficha se sacude
   - Pantallas que entran con movimiento
   - Sonido al tocar (usa el mismo interruptor de sonido del Perfil)
   Respeta "reducir movimiento" del celular. */
(function () {
 if (window.EvoJuice) return;
 var RM = false;
 try { RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

 /* ---------- Estilos ---------- */
 var CSS = [
  /* colores del grosor (la "sombra dura" de abajo) */
  ":root{--jz-blue:#0066FF;--jz-blue-lip:#0049B8;--jz-green:#12A85F;--jz-green-lip:#0B7A43;--jz-red:#E5484D;--jz-red-lip:#B02A2F;--jz-lip-soft:#C9D8EE}",

  /* BOTONES */
  ".btn{box-shadow:0 5px 0 var(--jz-blue-lip)!important;transition:transform .09s ease-out,box-shadow .09s ease-out,filter .15s;position:relative;-webkit-tap-highlight-color:transparent;touch-action:manipulation}",
  ".btn:not(:disabled):active,.btn.jz-down{transform:translateY(5px);box-shadow:0 0 0 var(--jz-blue-lip)!important}",
  ".btn.ghost{box-shadow:0 5px 0 var(--jz-lip-soft)!important}",
  ".btn.ghost:not(:disabled):active,.btn.ghost.jz-down{box-shadow:0 0 0 var(--jz-lip-soft)!important}",
  ".hot .btn,.card.hot .btn{box-shadow:0 5px 0 rgba(0,40,120,.55)!important}",
  ".hot .btn:not(:disabled):active,.card.hot .btn:not(:disabled):active{box-shadow:0 0 0 rgba(0,40,120,.55)!important}",
  ".btn:disabled{box-shadow:0 5px 0 rgba(15,23,42,.12)!important;transform:none}",
  ".btn::after{content:'';position:absolute;left:14px;right:14px;top:6px;height:5px;border-radius:99px;background:rgba(255,255,255,.28);pointer-events:none}",
  ".btn.ghost::after,.hot .btn::after{background:rgba(0,102,255,.07)}",
  ".btn.jz-pop{animation:jzPop .42s cubic-bezier(.2,1.6,.4,1)}",

  /* FICHAS DE RESPUESTA */
  ".op{border-bottom-width:5px!important;transition:transform .09s ease-out,border-color .15s,background .15s;-webkit-tap-highlight-color:transparent}",
  ".op:active{transform:translateY(3px) scale(.99)!important;border-bottom-width:2px!important;margin-bottom:13px}",
  ".op:hover{border-color:#B7CBEE}",
  ".op.sel{border-color:var(--jz-blue);background:#EAF2FF;box-shadow:0 0 0 3px rgba(0,102,255,.12)}",
  ".op.ok{border-color:var(--jz-green);background:#E3F7EC;animation:jzPop .5s cubic-bezier(.2,1.6,.4,1)}",
  ".op.bad{border-color:var(--jz-red);background:#FDECEC;animation:jzShake .45s ease-in-out}",
  ".op b{transition:background .15s,color .15s}",
  ".op.sel b{background:var(--jz-blue);color:#fff}",
  ".op.ok b{background:var(--jz-green);color:#fff}",
  ".op.bad b{background:var(--jz-red);color:#fff}",
  ".discrim-op{border-bottom-width:5px!important;transition:transform .09s ease-out,border-color .15s,background .15s}",
  ".discrim-op:active{transform:translateY(3px)}",
  ".discrim-op.ok{animation:jzPop .5s cubic-bezier(.2,1.6,.4,1)}",
  ".discrim-op.bad{animation:jzShake .45s ease-in-out}",

  /* PALABRAS PARA ARMAR FRASES */
  ".wd{border-bottom-width:5px!important;transition:transform .09s ease-out,background .15s;-webkit-tap-highlight-color:transparent}",
  ".wd:active{transform:translateY(3px);border-bottom-width:2px!important}",
  ".wd.on{border-bottom-color:var(--jz-blue-lip)!important}",

  /* MICRÓFONO */
  ".micbtn{box-shadow:0 5px 0 var(--jz-blue-lip)!important;transition:transform .09s ease-out,box-shadow .09s ease-out}",
  ".micbtn:active{transform:translateY(5px);box-shadow:0 0 0 var(--jz-blue-lip)!important}",
  ".micbtn.rec{box-shadow:0 5px 0 var(--jz-red-lip)!important}",

  /* REPRODUCTOR DE LECCION: sólido, vivo, con cuerpo */
  ".rcard{background:#fff!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;border:2px solid #D3E0F4!important;border-bottom-width:5px!important;border-radius:22px!important;box-shadow:0 10px 24px rgba(0,60,160,.10)!important}",
  ".rcard h2.q,.rcard h2{color:#0B1B33!important;font-weight:800}",
  ".op{background:#fff!important;border:2px solid #C3D4EE!important;border-bottom:5px solid #9DB6DC!important;font-weight:700;font-size:17px;color:#0B1B33}",
  ".op:hover{border-color:#6EA2FF!important;background:#F4F8FF!important}",
  ".op b{background:#E3ECFB;color:#0B3A8A;border-radius:10px;min-width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;font-weight:900}",
  ".op.sel{border-color:#0066FF!important;border-bottom-color:#0049B8!important;background:#E6F0FF!important}",
  ".op.ok{border-color:#12A85F!important;border-bottom-color:#0B7A43!important;background:#D8F5E5!important}",
  ".op.bad{border-color:#E5484D!important;border-bottom-color:#B02A2F!important;background:#FFE3E3!important}",
  ".rcheck{background:#4DA3FF!important;color:#06274D!important;border:0!important;border-radius:18px!important;min-height:64px!important;padding:20px 24px 22px!important;font-weight:900!important;font-size:19px!important;letter-spacing:.07em;text-transform:uppercase;box-shadow:0 6px 0 #2A72D6!important}",
  ".rcheck[data-jz=\"verde\"]{background:#3BE07F!important;color:#06301B!important;box-shadow:0 6px 0 #1FA85B!important}",
  ".rcheck[data-jz=\"naranja\"]{background:#FFB020!important;color:#3A2200!important;box-shadow:0 6px 0 #D98300!important}",
  ".rcheck:not(:disabled):active{transform:translateY(6px);box-shadow:0 0 0 transparent!important}",
  ".rcheck:disabled,.rcheck:disabled[data-jz]{background:#D5DDEA!important;color:#8896AD!important;box-shadow:0 6px 0 #B4C0D3!important}",
  ".rcheck::after{left:16px!important;right:16px!important;top:7px!important;height:6px!important;background:rgba(255,255,255,.38)!important}",
  ".rcheck-wrap{background:transparent!important}",
  "body.modo-enfocado .rcheck-wrap{background:var(--bg,#F8FAFC)!important;border-top:2px solid #D3E0F4;padding-top:14px}",
  ".rfoot .btn:not(.ghost){background:linear-gradient(180deg,#2F8BFF,#0066FF);color:#fff}",

  ".run:has(.op,.discrim-op,.wd,.micbtn)>.rw-wolf{display:none!important}",


  /* FONDO LIMPIO: sin foto ni patron. Claro: A/D alternados. Oscuro: B/C alternados */
  ".av-wrap,.av-run{background-image:none!important}",
  "body.modo-enfocado{background-image:none!important}",
  "html:not([data-tema=\"dark\"])[data-jzf=\"0\"] body.modo-enfocado,html:not([data-tema=\"dark\"])[data-jzf=\"0\"] .av-wrap,html:not([data-tema=\"dark\"])[data-jzf=\"0\"] .av-run{background:#F4F7FB!important;background-image:none!important}",
  "html:not([data-tema=\"dark\"])[data-jzf=\"1\"] body.modo-enfocado,html:not([data-tema=\"dark\"])[data-jzf=\"1\"] .av-wrap,html:not([data-tema=\"dark\"])[data-jzf=\"1\"] .av-run{background:#FFFFFF!important;background-image:none!important}",
  "html[data-tema=\"dark\"][data-jzf=\"0\"] body.modo-enfocado,html[data-tema=\"dark\"][data-jzf=\"0\"] .av-wrap,html[data-tema=\"dark\"][data-jzf=\"0\"] .av-run{background:#1B1F27!important;background-image:none!important}",
  "html[data-tema=\"dark\"][data-jzf=\"1\"] body.modo-enfocado,html[data-tema=\"dark\"][data-jzf=\"1\"] .av-wrap,html[data-tema=\"dark\"][data-jzf=\"1\"] .av-run{background:#0B1220!important;background-image:none!important}",
  ".av-run .rw-wolf::before,.av-run .rw-wolf::after,.av-run::before,.av-run::after{display:none!important;background:none!important}",
  "html:not([data-tema=\"dark\"]) .av-run,html:not([data-tema=\"dark\"]) .av-run h2,html:not([data-tema=\"dark\"]) .av-run .rx,html:not([data-tema=\"dark\"]) .av-frase b{color:#0B1B33!important}",
  "html:not([data-tema=\"dark\"]) .av-run .es2{color:#5B6B85!important}",
  "html:not([data-tema=\"dark\"]) .av-run .rw-bubble,html:not([data-tema=\"dark\"]) .av-run .av-frase{background:#fff!important;color:#0B1B33!important;border:2px solid #D3E0F4!important;box-shadow:0 4px 0 #D3E0F4}",

  /* TARJETAS Y HERRAMIENTAS QUE SE TOCAN */
  ".card[data-href],.tool,button.card{transition:transform .1s ease-out,box-shadow .1s ease-out;-webkit-tap-highlight-color:transparent}",
  ".card[data-href]:active,.tool:active,button.card:active{transform:translateY(3px) scale(.99)}",

  /* BARRA DE PROGRESO */
  ".bar{height:12px!important;background:#E3ECF8!important}",
  ".bar i{position:relative;transition:width .7s cubic-bezier(.2,.9,.3,1.1);background:linear-gradient(180deg,#2FD27F,#12A85F)!important;box-shadow:inset 0 -3px 0 rgba(0,0,0,.12)}",
  ".bar i::after{content:'';position:absolute;left:8px;right:8px;top:3px;height:3px;border-radius:99px;background:rgba(255,255,255,.55)}",
  ".bar i.jz-grow{animation:jzBar .6s ease-out}",

  /* MENSAJE DE RESPUESTA */
  ".fb{animation:jzFb .5s cubic-bezier(.2,1.4,.4,1)!important;border-bottom:4px solid rgba(0,0,0,.08)}",
  ".fb.ok{border-bottom-color:rgba(18,168,95,.35)}",
  ".fb.no{border-bottom-color:rgba(229,72,77,.3)}",

  /* ENTRADA DE PANTALLAS */
  "#app.jz-enter>*{animation:jzIn .4s cubic-bezier(.2,.9,.3,1) both}",
  "#app.jz-enter>*:nth-child(2){animation-delay:.04s}#app.jz-enter>*:nth-child(3){animation-delay:.08s}#app.jz-enter>*:nth-child(4){animation-delay:.12s}#app.jz-enter>*:nth-child(n+5){animation-delay:.16s}",

  /* PANTALLA DE INICIO: movimiento sutil y constante */
  ".hb-wolves img.a{animation:jzFloatA 4.6s ease-in-out infinite;transform-origin:50% 100%}",
  ".hb-wolves img.b{animation:jzFloatB 5.2s ease-in-out infinite;transform-origin:50% 100%}",
  ".hb-cta{position:relative;overflow:hidden;animation:jzCtaPulse 2.8s ease-in-out infinite}",
  ".hb-cta::after{content:'';position:absolute;top:0;bottom:0;width:36%;left:-50%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-18deg);animation:jzSheen 3.6s ease-in-out infinite}",
  ".hb{transition:transform .1s ease-out;-webkit-tap-highlight-color:transparent}.hb:active{transform:translateY(4px) scale(.985)}",
  ".adventure-banner{transition:transform .1s ease-out;-webkit-tap-highlight-color:transparent}.adventure-banner:active{transform:translateY(4px) scale(.985)}",
  ".ab-icon img{animation:jzBob 3.4s ease-in-out infinite}",
  ".ab-arrow{animation:jzNudge 1.8s ease-in-out infinite}",
  ".lim-photo{animation:jzZoom 14s ease-in-out infinite alternate}",
  ".lesson-card .btn.go{animation:jzGo 3.4s ease-in-out infinite}",
  ".home-header h1 .badge{position:relative;overflow:hidden}",
  ".home-header h1 .badge::after{content:'';position:absolute;top:0;bottom:0;width:40%;left:-60%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.5),transparent);transform:skewX(-18deg);animation:jzSheen 5s ease-in-out infinite 1s}",
  ".bar i::before{content:'';position:absolute;top:0;bottom:0;width:30%;left:-40%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.45),transparent);animation:jzSheen 3.2s ease-in-out infinite}",
  "nav a.on svg{animation:jzTab .45s cubic-bezier(.2,1.6,.4,1)}",
  "nav a{transition:transform .1s ease-out,background .2s,color .2s}nav a:active{transform:scale(.9)}",
  ".jz-ring{position:absolute;border-radius:50%;border:3px solid rgba(255,255,255,.75);box-shadow:0 0 0 1px rgba(0,102,255,.25)}",
  "@keyframes jzFloatA{0%,100%{transform:translateY(0) rotate(-.6deg)}50%{transform:translateY(-6px) rotate(.8deg)}}",
  "@keyframes jzFloatB{0%,100%{transform:translateY(-3px) rotate(.5deg)}50%{transform:translateY(4px) rotate(-.7deg)}}",
  "@keyframes jzCtaPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}",
  "@keyframes jzSheen{0%,55%{left:-60%}100%{left:130%}}",
  "@keyframes jzBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}",
  "@keyframes jzNudge{0%,100%{transform:translateX(0)}50%{transform:translateX(5px)}}",
  "@keyframes jzZoom{from{transform:scale(1)}to{transform:scale(1.07)}}",
  "@keyframes jzGo{0%,82%,100%{transform:scale(1)}90%{transform:scale(1.06)}}",
  "@keyframes jzTab{0%{transform:translateY(4px) scale(.8)}60%{transform:translateY(-4px) scale(1.18)}100%{transform:none}}",

  /* TIPOGRAFÍA Y ESPACIO (tono profesional) */
  ".goal{font-size:16.5px;line-height:1.55;max-width:62ch;margin-bottom:18px}",
  ".rcard h2,.rdone h2{letter-spacing:-.015em;line-height:1.18}",
  ".bigp{letter-spacing:-.01em;line-height:1.3}",
  ".op{padding:15px 16px!important;min-height:60px!important;margin-bottom:12px!important;font-size:16.5px;line-height:1.4;gap:14px!important}",
  ".op:active{margin-bottom:15px!important}",
  ".op b{width:30px!important;height:30px!important;font-size:14px!important}",
  ".wd{padding:10px 16px;font-size:16.5px}",
  ".dl{margin:14px 0}.bb{padding:12px 16px;line-height:1.45}",
  ".note{line-height:1.5;padding:14px 16px}",
  ".btn{letter-spacing:.01em}",

  /* CAPA DE EFECTOS */
  "#jz-fx{position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden}",
  "#jz-fx i{position:absolute;display:block;will-change:transform,opacity}",

  /* ANIMACIONES */
  "@keyframes jzPop{0%{transform:scale(.97)}55%{transform:scale(1.045)}100%{transform:scale(1)}}",
  "@keyframes jzShake{0%,100%{transform:translateX(0)}18%{transform:translateX(-8px)}36%{transform:translateX(7px)}54%{transform:translateX(-5px)}72%{transform:translateX(3px)}}",
  "@keyframes jzFb{0%{opacity:0;transform:translateY(18px) scale(.96)}60%{opacity:1;transform:translateY(-3px) scale(1.01)}100%{opacity:1;transform:none}}",
  "@keyframes jzIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}",
  ".wolf.jz-ok{animation:jzJump .7s cubic-bezier(.2,1.5,.4,1)}",
  ".wolf.jz-bad{animation:jzShake .5s ease-in-out}",
  "@keyframes jzJump{0%{transform:translateY(0) scale(1)}35%{transform:translateY(-22px) scale(1.1) rotate(-4deg)}65%{transform:translateY(0) scale(.96)}100%{transform:none}}",
  "@keyframes jzBar{0%{filter:brightness(1.5)}100%{filter:none}}",

  "@media (prefers-reduced-motion:reduce){.btn,.btn.jz-pop,.op,.op.ok,.op.bad,.discrim-op.ok,.discrim-op.bad,.wd,.wolf.jz-ok,.wolf.jz-bad,.bar i,.bar i::before,.hb-wolves img,.hb-cta,.hb-cta::after,.ab-icon img,.ab-arrow,.lim-photo,.lesson-card .btn.go,.home-header h1 .badge::after,nav a.on svg,.fb,#app.jz-enter>*{animation:none!important;transition:none!important}}"
 ].join("\n");

 function css() {
  if (document.getElementById("jz-css")) return;
  var s = document.createElement("style");
  s.id = "jz-css"; s.textContent = CSS;
  document.head.appendChild(s);
 }

 /* ---------- Capa de efectos ---------- */
 function fx() {
  var l = document.getElementById("jz-fx");
  if (!l) { l = document.createElement("div"); l.id = "jz-fx"; l.setAttribute("aria-hidden", "true"); document.body.appendChild(l); }
  return l;
 }
 var COL = ["#12A85F", "#2FD27F", "#14C2F5", "#0066FF", "#FFC83D", "#FF7AB6"];
 function burst(x, y, n, spread, cols) {
  if (RM || !document.body.animate) return;
  var l = fx(); cols = cols || COL;
  for (var i = 0; i < n; i++) {
   var p = document.createElement("i");
   var sz = 6 + Math.random() * 7, round = Math.random() > .5;
   p.style.cssText = "left:" + x + "px;top:" + y + "px;width:" + sz + "px;height:" + sz + "px;border-radius:" + (round ? "50%" : "3px") + ";background:" + cols[i % cols.length];
   l.appendChild(p);
   var a = Math.random() * Math.PI * 2, d = spread * (.45 + Math.random() * .55);
   var dx = Math.cos(a) * d, dy = Math.sin(a) * d - spread * .25, rot = (Math.random() - .5) * 720;
   var an = p.animate([
    { transform: "translate(-50%,-50%) scale(1) rotate(0)", opacity: 1 },
    { transform: "translate(calc(-50% + " + dx + "px),calc(-50% + " + (dy + 30) + "px)) scale(.3) rotate(" + rot + "deg)", opacity: 0 }
   ], { duration: 600 + Math.random() * 500, easing: "cubic-bezier(.15,.8,.3,1)" });
   an.onfinish = (function (el) { return function () { el.remove(); }; })(p);
  }
 }
 function confetti() {
  if (RM || !document.body.animate) return;
  var l = fx(), W = innerWidth;
  for (var i = 0; i < 70; i++) {
   var p = document.createElement("i");
   var w = 7 + Math.random() * 6, h = 10 + Math.random() * 8;
   p.style.cssText = "left:" + (Math.random() * W) + "px;top:-20px;width:" + w + "px;height:" + h + "px;border-radius:2px;background:" + COL[i % COL.length];
   l.appendChild(p);
   var drift = (Math.random() - .5) * 180, fall = innerHeight + 60, rot = (Math.random() - .5) * 900;
   var an = p.animate([
    { transform: "translate(0,0) rotate(0)", opacity: 1 },
    { transform: "translate(" + drift + "px," + fall + "px) rotate(" + rot + "deg)", opacity: 1 }
   ], { duration: 1500 + Math.random() * 1500, delay: Math.random() * 350, easing: "cubic-bezier(.3,.1,.6,1)", fill: "forwards" });
   an.onfinish = (function (el) { return function () { el.remove(); }; })(p);
  }
 }
 function centerOf(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; }

 /* ---------- El guía (LEVO o LEVA) reacciona ---------- */
 var POSE = { evo: { ok: "assets/mascot/evo_success.png", bad: "assets/mascot/evo_error.png" },
              leva: { ok: "assets/mascot/leva_success.png", bad: "assets/mascot/leva_thinking.png" } };
 var wolfTimer = null;
 function guiaReacciona(tipo) {
  var imgs = document.querySelectorAll("img.wolf"); if (!imgs.length) return;
  for (var i = 0; i < imgs.length; i++) (function (im) {
   var src = im.getAttribute("src") || "", quien = /leva/i.test(src) ? "leva" : (/evo/i.test(src) ? "evo" : "");
   if (!quien) return;
   if (!im.dataset.jzOrig) { im.dataset.jzOrig = src; im.dataset.jzH = im.getAttribute("height") || ""; }
   var w = parseFloat(im.getAttribute("width")) || im.clientWidth;
   if (w) im.setAttribute("height", Math.round(w * (quien === "leva" ? 900 / 672 : 1200 / 896)));
   im.src = POSE[quien][tipo];
   im.classList.remove("jz-ok", "jz-bad"); void im.offsetWidth; im.classList.add(tipo === "ok" ? "jz-ok" : "jz-bad");
   clearTimeout(im._jzT);
   im._jzT = setTimeout(function () { if (im.dataset.jzOrig) { im.src = im.dataset.jzOrig; if (im.dataset.jzH) im.setAttribute("height", im.dataset.jzH); } im.classList.remove("jz-ok", "jz-bad"); }, 1700);
  })(imgs[i]);
 }

 function ring(x, y) {
  if (RM || !document.body.animate) return;
  var l = fx(), r = document.createElement("i"); r.className = "jz-ring";
  r.style.cssText = "left:" + x + "px;top:" + y + "px;width:24px;height:24px";
  l.appendChild(r);
  r.animate([{ transform: "translate(-50%,-50%) scale(.3)", opacity: .9 }, { transform: "translate(-50%,-50%) scale(3.2)", opacity: 0 }], { duration: 480, easing: "ease-out" }).onfinish = function () { r.remove(); };
 }

 /* ---------- Sonido al tocar (mismo interruptor del Perfil) ---------- */
 var lastTap = 0;
 function tap() {
  var now = Date.now(); if (now - lastTap < 60) return; lastTap = now;
  try { if (typeof window.sfxTone === "function") window.sfxTone([420], .07, .05); } catch (e) {}
 }
 function vib(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }

 var TAPSEL = ".btn,.op,.wd,.discrim-op,.micbtn,button.card,.card[data-href],.tool";
 document.addEventListener("pointerdown", function (e) {
  var t = e.target && e.target.closest ? e.target.closest(TAPSEL) : null;
  if (!t || t.disabled) return;
  tap(); ring(e.clientX, e.clientY);
  if (t.classList.contains("btn")) {
   t.classList.add("jz-down");
   var up = function () { t.classList.remove("jz-down"); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
   window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  }
 }, { passive: true });
 document.addEventListener("click", function (e) {
  var b = e.target && e.target.closest ? e.target.closest(".btn") : null;
  if (!b || b.disabled || RM) return;
  b.classList.remove("jz-pop"); void b.offsetWidth; b.classList.add("jz-pop");
  setTimeout(function () { b.classList.remove("jz-pop"); }, 450);
 }, true);

 /* ---------- Vigilar cambios: acierto, error, barra, pantallas ---------- */
 var seen = typeof WeakSet === "function" ? new WeakSet() : null;
 function mark(el) { if (!seen) return true; if (seen.has(el)) return false; seen.add(el); return true; }
 var prevOk = typeof WeakMap === "function" ? new WeakMap() : null;

 function reactClass(el) {
  if (!el.classList) return;
  var isOpt = el.classList.contains("op") || el.classList.contains("discrim-op");
  if (isOpt) {
   var st = el.classList.contains("ok") ? "ok" : el.classList.contains("bad") ? "bad" : "";
   var before = prevOk ? prevOk.get(el) : "";
   if (prevOk) prevOk.set(el, st);
   if (st === before) return;
   if (st === "ok") { var c = centerOf(el); burst(c.x, c.y, 16, Math.min(150, c.w * .45)); vib([60, 40, 60]); guiaReacciona("ok"); }
   else if (st === "bad") { vib([120, 60, 120]); guiaReacciona("bad"); }
  }
  if (el.matches && el.matches(".bar i")) {
   el.classList.remove("jz-grow"); void el.offsetWidth; el.classList.add("jz-grow");
  }
 }

 var celebrated = typeof WeakSet === "function" ? new WeakSet() : null;
 function pantallaFinal(root) {
  var xp = root.querySelector ? root.querySelector(".rdone .xp,.xp") : null;
  var done = root.matches && root.matches(".rdone") ? root : (root.querySelector ? root.querySelector(".rdone") : null);
  if (!done || (celebrated && celebrated.has(done))) return;
  if (celebrated) celebrated.add(done);
  confetti();
  xp = done.querySelector(".xp");
  if (xp && !RM) {
   var m = (xp.textContent || "").match(/-?\d+/);
   if (m) {
    var target = parseInt(m[0], 10), pre = xp.textContent.slice(0, m.index), post = xp.textContent.slice(m.index + m[0].length), t0 = performance.now(), dur = 900;
    (function step(now) {
     var k = Math.min(1, (now - t0) / dur), v = Math.round(target * (1 - Math.pow(1 - k, 3)));
     xp.textContent = pre + v + post;
     if (k < 1) requestAnimationFrame(step);
    })(t0);
   }
  }
 }



 var _fw = null, _fn = 0;
 function fondo() {
  var i = document.querySelector(".rbar i"), w = i ? i.style.width : "";
  if (w !== _fw) { _fw = w; _fn++; }
  var v = String(_fn % 2), h = document.documentElement;
  if (h.getAttribute("data-jzf") !== v) h.setAttribute("data-jzf", v);
 }
 var COLS = ["", "verde", "naranja"];
 function colorBoton() {
  var b = document.querySelector(".rcheck"); if (!b) return;
  var i = document.querySelector(".rbar i"), w = i ? parseFloat(i.style.width) || 0 : 0;
  var v = COLS[Math.round(w / 6) % 3] || "";
  if (v) { if (b.getAttribute("data-jz") !== v) b.setAttribute("data-jz", v); }
  else if (b.hasAttribute("data-jz")) b.removeAttribute("data-jz");
 }
 function iniciar() {
  css();
  var mo = new MutationObserver(function (list) {
   colorBoton(); fondo();
   for (var i = 0; i < list.length; i++) {
    var m = list[i];
    if (m.type === "attributes") { reactClass(m.target); }
    else {
     for (var j = 0; j < m.addedNodes.length; j++) {
      var n = m.addedNodes[j];
      if (n.nodeType !== 1 || n.id === "jz-fx") continue;
      pantallaFinal(n);
      if (n.querySelectorAll) {
       var ops = n.querySelectorAll(".op.ok,.op.bad,.discrim-op.ok,.discrim-op.bad");
       for (var k = 0; k < ops.length; k++) reactClass(ops[k]);
      }
     }
    }
   }
  });
  /* las pantallas entran con movimiento solo al cambiar de sección, no en cada toque */
  addEventListener("hashchange", function () {
   var a = document.getElementById("app"); if (!a || RM) return;
   a.classList.remove("jz-enter"); void a.offsetWidth; a.classList.add("jz-enter");
   setTimeout(function () { a.classList.remove("jz-enter"); }, 700);
  });
  var a0 = document.getElementById("app");
  if (a0 && !RM) { a0.classList.add("jz-enter"); setTimeout(function () { a0.classList.remove("jz-enter"); }, 900); }
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
 }

 window.EvoJuice = { burst: burst, confetti: confetti, tap: tap };
 if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
