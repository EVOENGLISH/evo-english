/* ==========================================================================
   EVO ENGLISH — legal.js
   Permiso de voz (micrófono), participación opcional en la clasificación,
   enlaces legales en el Perfil y "Eliminar mi cuenta".
   ========================================================================== */
(function () {
 "use strict";
 var VER = "2026-11-22";
 var CORREO = "evoenglishsupport@gmail.com";

 function usuario() { var u = window.USUARIO_ACTUAL; return u && u.usuario ? String(u.usuario).toLowerCase() : ""; }
 function esAdmin() { var u = window.USUARIO_ACTUAL; return !!(u && u.rol === "admin"); }
 function esMenor() { var u = window.USUARIO_ACTUAL; return !!(u && u.edad && u.edad < 18); }
 function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
 function lget(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
 function lset(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
 function ldel(k) { try { localStorage.removeItem(k); } catch (_) {} }

 /* ---------- ventana emergente sencilla ---------- */
 function css() {
  if (document.getElementById("lg-css")) return;
  var st = document.createElement("style"); st.id = "lg-css";
  st.textContent = [
   ".lg-ov{position:fixed;inset:0;z-index:100000;background:rgba(6,16,30,.62);display:flex;align-items:center;justify-content:center;padding:16px;font-family:'DM Sans',system-ui,sans-serif}",
   ".lg-card{background:#fff;color:#0B2247;border-radius:20px;max-width:440px;width:100%;max-height:92vh;overflow:auto;padding:22px 20px;box-shadow:0 20px 60px rgba(0,0,0,.4)}",
   ".lg-card h3{margin:0 0 8px;font-size:20px;line-height:1.25}",
   ".lg-card p{margin:0 0 12px;font-size:15px;line-height:1.5}",
   ".lg-chk{display:flex;gap:10px;align-items:flex-start;margin:12px 0;font-size:14.5px;line-height:1.45;cursor:pointer}",
   ".lg-chk input{width:22px;height:22px;flex:none;margin-top:1px}",
   ".lg-in{width:100%;min-height:48px;border-radius:12px;border:2px solid #D3E4F7;padding:0 12px;font:500 16px 'DM Sans',system-ui,sans-serif;color:#0B2247;box-sizing:border-box}",
   ".lg-row{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}",
   ".lg-btn{flex:1;min-height:48px;border-radius:14px;border:0;font:700 15px 'DM Sans',system-ui,sans-serif;cursor:pointer;background:#0066FF;color:#fff;padding:0 14px}",
   ".lg-btn.sec{background:#EAF0FA;color:#0B2247}",
   ".lg-btn.red{background:#C62828;color:#fff}",
   ".lg-btn:disabled{opacity:.55}",
   ".lg-err{color:#B3261E;font-size:14px;margin:8px 0 0}",
   ".lg-link{color:#0052D6;text-decoration:underline}"
  ].join("\n");
  document.head.appendChild(st);
 }
 function abrir(html) {
  css();
  cerrar();
  var ov = document.createElement("div"); ov.className = "lg-ov"; ov.id = "lg-ov";
  ov.innerHTML = '<div class="lg-card" role="dialog" aria-modal="true">' + html + '</div>';
  document.body.appendChild(ov);
  return ov;
 }
 function cerrar() { var o = document.getElementById("lg-ov"); if (o) o.remove(); }

 /* ---------- permiso de voz ---------- */
 function vozOk() { return esAdmin() || lget("evoVoz:" + usuario()) === "1"; }
 function pedirVoz(cb) {
  if (vozOk()) { cb(); return; }
  var menor = esMenor();
  var ov = abrir('<h3>🎙️ Usar el micrófono</h3>'
   + '<p>Cuando tocas el micrófono, tu voz se envía por internet a servicios externos que la convierten en texto para que LEVO o LEVA te respondan. <b>EVO ENGLISH no guarda tus grabaciones</b>, y el micrófono solo se activa cuando tú lo tocas. También puedes practicar escribiendo.</p>'
   + (menor ? '<p><b>Eres menor de edad: pásale el teléfono a tu mamá, papá o tutor.</b></p>' : '')
   + '<label class="lg-chk"><input type="checkbox" id="lg-voz-ok"><span>' + (menor ? 'Soy el adulto responsable del menor y autorizo' : 'Autorizo') + ' el uso del micrófono en EVO ENGLISH. <a class="lg-link" href="privacidad.html" target="_blank" rel="noopener">Ver aviso de privacidad</a></span></label>'
   + '<p class="lg-err" id="lg-voz-err" hidden>Marca la casilla para activar el micrófono.</p>'
   + '<div class="lg-row"><button type="button" class="lg-btn sec" id="lg-voz-no">Ahora no</button><button type="button" class="lg-btn" id="lg-voz-si">Activar micrófono</button></div>');
  ov.querySelector("#lg-voz-no").onclick = cerrar;
  ov.querySelector("#lg-voz-si").onclick = function () {
   if (!ov.querySelector("#lg-voz-ok").checked) { ov.querySelector("#lg-voz-err").hidden = false; return; }
   lset("evoVoz:" + usuario(), "1");
   try { StudentRepository.guardarAceptaciones(usuario(), VER, { voz: true }); } catch (_) {}
   cerrar(); cb();
  };
 }

 /* ---------- clasificación opcional ---------- */
 function rankingActivo() { return lget("evoRank:" + usuario()) === "1"; }
 function alternarRanking(hecho) {
  if (esMenor()) { if (hecho) hecho(); return; }
  var nuevo = !rankingActivo();
  StudentRepository.fijarRanking(usuario(), nuevo).then(function (ok) {
   if (ok) lset("evoRank:" + usuario(), nuevo ? "1" : "0");
   else if (typeof window.toast === "function") window.toast("No se pudo guardar. Revisa tu internet.");
   if (hecho) hecho();
  });
 }

 /* ---------- Perfil: sección legal ---------- */
 function seccionPerfil() {
  var menor = esMenor();
  var rk = menor
   ? '<div class="set"><span>Aparecer en la clasificación</span><span class="kick">No disponible para menores</span></div>'
   : '<div class="set"><span>Aparecer en la clasificación</span><button type="button" class="pill-toggle' + (rankingActivo() ? ' on' : '') + '" data-a="ranking-toggle" aria-pressed="' + rankingActivo() + '">' + (rankingActivo() ? 'Sí' : 'No') + '</button></div>';
  return '<div class="card" style="margin-top:14px">' + (window.EvoTema ? window.EvoTema.filaPerfil() : '') + rk
   + '<div class="set"><span>Información legal</span><span class="kick"><a href="privacidad.html" target="_blank" rel="noopener">Privacidad</a> · <a href="terminos.html" target="_blank" rel="noopener">Términos</a> · <a href="autorizacion.html" target="_blank" rel="noopener">Menores</a></span></div>'
   + '<div class="set"><span>Soporte</span><span class="kick"><a href="mailto:' + CORREO + '">' + CORREO + '</a></span></div></div>';
 }
 function botonEliminar() {
  return '<button type="button" class="btn ghost" data-a="eliminar-cuenta" style="margin-top:12px;width:100%;color:#C62828;border-color:#E7B4B0">Eliminar mi cuenta</button>';
 }

 /* ---------- Eliminar mi cuenta ---------- */
 function abrirEliminar() {
  if (esAdmin()) { if (typeof window.toast === "function") window.toast("La cuenta de administrador no se elimina desde aquí."); return; }
  var ov = abrir('<h3>Eliminar mi cuenta</h3>'
   + '<p>Se borrarán tu cuenta, tu progreso, tus puntos e insignias, <b>y no se puede deshacer</b>. También se cancela cualquier suscripción que tengas. Solo conservamos el registro de aceptación y autorización, por obligaciones legales.</p>'
   + '<p>Para confirmar, escribe tu contraseña:</p>'
   + '<input class="lg-in" id="lg-del-pass" type="password" autocomplete="current-password" placeholder="Tu contraseña">'
   + '<p class="lg-err" id="lg-del-err" hidden></p>'
   + '<div class="lg-row"><button type="button" class="lg-btn sec" id="lg-del-no">Cancelar</button><button type="button" class="lg-btn red" id="lg-del-si">Eliminar definitivamente</button></div>');
  ov.querySelector("#lg-del-no").onclick = cerrar;
  ov.querySelector("#lg-del-si").onclick = function () {
   var pw = ov.querySelector("#lg-del-pass").value, er = ov.querySelector("#lg-del-err"), b = this;
   if (!pw) { er.textContent = "Escribe tu contraseña."; er.hidden = false; return; }
   b.disabled = true; b.textContent = "Eliminando…";
   var u = usuario();
   StudentRepository.eliminarMiCuenta(u, pw).then(function (ok) {
    if (!ok) { b.disabled = false; b.textContent = "Eliminar definitivamente"; er.textContent = "Contraseña incorrecta o sin conexión. Inténtalo de nuevo."; er.hidden = false; return; }
    ["evoVoz:", "evoRank:", "evoGuia:", "evoConsent:"].forEach(function (p) { ldel(p + u); });
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf("evoLegalOk:" + u) === 0) ldel(k); }); } catch (_) {}
    ov.querySelector(".lg-card").innerHTML = '<h3>Tu cuenta fue eliminada</h3><p>Gracias por haber practicado con EVO ENGLISH. Si cambias de opinión, puedes crear una cuenta nueva cuando quieras.</p><div class="lg-row"><button type="button" class="lg-btn" id="lg-del-fin">Aceptar</button></div>';
    ov.querySelector("#lg-del-fin").onclick = function () { cerrar(); window.LoginOnboarding.cerrarSesion(); };
   });
  };
 }

 window.EvoLegal = { VER: VER, vozOk: vozOk, pedirVoz: pedirVoz, rankingActivo: rankingActivo, alternarRanking: alternarRanking, seccionPerfil: seccionPerfil, botonEliminar: botonEliminar, abrirEliminar: abrirEliminar };
})();
