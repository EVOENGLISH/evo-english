/* ==========================================================================
   PANEL DE CONTROL EVO — administración de alumnos y configuración
   ==========================================================================
   Archivo independiente: sólo se activa cuando inicia sesión la cuenta
   "admin" (ver loginOnboarding.js -> entrarComo). No toca el motor de
   Lecciones ni el de Aventura.

   ALUMNOS EN LA NUBE (Supabase): desde la integración con Supabase, la
   lista de alumnos y sus datos viven en la tabla "alumnos" de tu proyecto
   (ver supabaseRepo.js / StudentRepository), NO sólo en este navegador.
   Por eso todas las llamadas de este panel a LoginOnboarding.usuarios.*
   son asíncronas (usan async/await): tienen que esperar la respuesta de
   la nube (o, si no hay conexión, la última copia guardada localmente).
   Mientras se espera esa respuesta, la tabla muestra "Cargando…" en vez
   de quedar vacía o congelada.

   Estructura interna:
     1) RENDER — layout general del panel (secciones)
     2) SECCIÓN — Registrar nuevo alumno
     3) SECCIÓN — Tabla de alumnos + acciones (password/pausar/eliminar)
     4) SECCIÓN — Configuración del sistema (teléfono, voice id)
     5) API PÚBLICA (mostrar)
   ========================================================================== */
var PanelAdmin = (function () {
 "use strict";

 var cbs = { modoAlumno: function () {}, cerrarSesion: function () {} };

 function panel() {
  var el = document.getElementById("admin-overlay");
  if (!el) { el = document.createElement("div"); el.id = "admin-overlay"; document.body.appendChild(el); }
  return el;
 }

 /* ---------------------------------------------------------------------
  * 1) RENDER — layout general
  * --------------------------------------------------------------------- */
 // render() dibuja el panel de inmediato (con la tabla de alumnos en
 // estado "Cargando…") y luego, sin bloquear la pantalla, pide la lista
 // real a la nube y la pinta cuando llega (ver cargarTablaInicial()).
 function render() {
  var c = LoginOnboarding.config.leer();
  panel().innerHTML =
   '<div class="pa-wrap">'
   + '<header class="pa-top">'
   + '<div class="pa-brand">' + mascot(40) + '<b>Panel de Control EVO</b></div>'
   + '<div class="pa-topbtns">'
   + '<button type="button" class="pa-btn pa-btn-ghost" data-a="pa-modo-alumno">' + ic("play", 16) + ' Modo Alumno / Vista previa</button>'
   + '<button type="button" class="pa-btn pa-btn-ghost" data-a="pa-logout">' + ic("lock", 16) + ' Cerrar sesión</button>'
   + '</div></header>'
   + '<main class="pa-main">'
   + seccionRegistro()
   + seccionAlumnos()
   + seccionConfig(c)
   + '</main>'
   + '</div>';
  wireEventos();
  cargarTablaInicial();
 }

 /* ---------------------------------------------------------------------
  * 2) SECCIÓN — Registrar nuevo alumno
  * --------------------------------------------------------------------- */
 function seccionRegistro() {
  return '<section class="pa-card">'
   + '<h2>' + ic("users", 20) + ' Registrar nuevo alumno</h2>'
   + '<form id="pa-form-alta" class="pa-form-alta" novalidate>'
   + '<input class="pa-input" id="pa-nombre" placeholder="Nombre completo" required>'
   + '<input class="pa-input" id="pa-usuario" placeholder="Usuario" required autocomplete="off">'
   + '<input class="pa-input" id="pa-password" placeholder="Contraseña" required autocomplete="off">'
   + '<button type="submit" class="pa-btn pa-btn-primary">' + ic("check", 16) + ' Registrar alumno</button>'
   + '</form>'
   + '<p class="pa-err" id="pa-alta-err" hidden></p>'
   + '<p class="pa-ok" id="pa-alta-ok" hidden></p>'
   + '</section>';
 }

 /* ---------------------------------------------------------------------
  * 3) SECCIÓN — Tabla de alumnos
  * --------------------------------------------------------------------- */
 function filaAlumno(a) {
  return '<tr data-usuario="' + esc(a.usuario) + '">'
   + '<td><b>' + esc(a.nombre) + '</b><small>@' + esc(a.usuario) + '</small></td>'
   + '<td>' + (a.edad ? a.edad + ' años' : '—') + '</td>'
   + '<td>' + (a.metaMinutos ? a.metaMinutos + ' min' : '—') + '</td>'
   + '<td>' + a.xp + ' XP</td>'
   + '<td><span class="pa-pill ' + (a.activo ? 'on' : 'off') + '">' + (a.activo ? 'Activo' : 'Pausado') + '</span></td>'
   + '<td class="pa-acciones">'
   + '<button type="button" class="pa-icobtn" data-a="pa-passw" title="Cambiar contraseña">' + ic("pencil", 16) + '</button>'
   + '<button type="button" class="pa-icobtn" data-a="pa-toggle" title="' + (a.activo ? 'Pausar acceso' : 'Activar acceso') + '">' + ic(a.activo ? "lock" : "check", 16) + '</button>'
   + '<button type="button" class="pa-icobtn pa-icobtn-danger" data-a="pa-del" title="Eliminar alumno">' + ic("x", 16) + '</button>'
   + '</td></tr>';
 }
 // Fila especial mientras se espera la respuesta de la nube, y fila
 // "vacía" cuando ya llegó la respuesta pero no hay alumnos todavía.
 var FILA_CARGANDO = '<tr><td colspan="6" class="pa-vacio">Cargando alumnos desde la nube…</td></tr>';
 var FILA_VACIA = '<tr><td colspan="6" class="pa-vacio">Todavía no hay alumnos registrados. Usa el formulario de arriba para crear el primero.</td></tr>';
 function seccionAlumnos() {
  return '<section class="pa-card">'
   + '<h2>' + ic("book", 20) + ' Alumnos registrados</h2>'
   + '<div class="pa-tablewrap"><table class="pa-table"><thead><tr>'
   + '<th>Nombre</th><th>Edad</th><th>Meta diaria</th><th>XP</th><th>Estado</th><th></th>'
   + '</tr></thead><tbody id="pa-tbody">' + FILA_CARGANDO + '</tbody></table></div>'
   + '</section>';
 }

 /* ---------------------------------------------------------------------
  * 4) SECCIÓN — Configuración del sistema
  * --------------------------------------------------------------------- */
 function seccionConfig(c) {
  return '<section class="pa-card">'
   + '<h2>' + ic("layers", 20) + ' Configuración del sistema</h2>'
   + '<form id="pa-form-config" class="pa-form-config" novalidate>'
   + '<label class="pa-label">Teléfono de soporte (WhatsApp)</label>'
   + '<input class="pa-input" id="pa-cfg-tel" value="' + esc(c.telefonoSoporte) + '">'
   + '<label class="pa-label">Voice ID de ElevenLabs</label>'
   + '<input class="pa-input" id="pa-cfg-voice" value="' + esc(c.elevenlabsVoiceId) + '">'
   + '<p class="pa-hint">La voz de ElevenLabs sólo se usa si además configuras una API Key desde la consola del navegador (ver comentario en index.html, función setElevenLabsKey). Mientras tanto la app usa automáticamente la mejor voz nativa del dispositivo del alumno.</p>'
   + '<button type="submit" class="pa-btn pa-btn-primary">' + ic("check", 16) + ' Guardar configuración</button>'
   + '</form>'
   + '<p class="pa-ok" id="pa-cfg-ok" hidden>Configuración guardada.</p>'
   + '</section>';
 }

 /* ---------------------------------------------------------------------
  * Carga / refresco de la tabla (asíncronos: hablan con Supabase)
  * --------------------------------------------------------------------- */
 // Se llama una sola vez, justo después de dibujar el panel.
 async function cargarTablaInicial() {
  await refrescarTabla();
 }
 // Vuelve a pedir la lista de alumnos a StudentRepository (nube, con
 // respaldo local si no hay conexión) y repinta el <tbody>. Se usa tanto
 // al abrir el panel como después de cada alta/baja/cambio.
 // Devuelve la lista que acaba de pintar (además de repintar el <tbody>):
 // así, quien llama a refrescarTabla() puede reutilizar esa misma lista
 // (por ejemplo, para comprobar si un alumno recién registrado ya
 // aparece) sin tener que pedirla otra vez a la nube.
 async function refrescarTabla() {
  var tbody = document.getElementById("pa-tbody");
  if (!tbody) return []; // el panel pudo haberse cerrado mientras esperábamos la nube
  var alumnos = await LoginOnboarding.usuarios.listarAlumnos();
  // Volvemos a comprobar tras el "await": el admin pudo haber cerrado
  // sesión o el panel mientras esperábamos la respuesta de la nube.
  tbody = document.getElementById("pa-tbody");
  if (!tbody) return alumnos;
  tbody.innerHTML = alumnos.length ? alumnos.map(filaAlumno).join("") : FILA_VACIA;
  return alumnos;
 }

 function wireEventos() {
  document.getElementById("pa-form-alta").addEventListener("submit", async function (ev) {
   ev.preventDefault();
   var nombre = document.getElementById("pa-nombre").value;
   var usuario = document.getElementById("pa-usuario").value;
   var password = document.getElementById("pa-password").value;
   var claveUsuario = (usuario || "").trim().toLowerCase();
   var errEl = document.getElementById("pa-alta-err"), okEl = document.getElementById("pa-alta-ok");
   var btn = document.querySelector("#pa-form-alta button[type=submit]");
   var textoOriginal = btn.textContent;
   btn.disabled = true; btn.textContent = "Guardando…";
   errEl.hidden = true; okEl.hidden = true;
   var res;
   try { res = await LoginOnboarding.usuarios.registrarAlumno(nombre, usuario, password); }
   finally { btn.disabled = false; btn.textContent = textoOriginal; }

   // Blindaje: refrescamos la tabla SIEMPRE, haya ido bien o mal la
   // respuesta -- así, aunque la nube haya tardado en responder o el
   // aviso de error haya sido un falso negativo (la fila SÍ se guardó,
   // pero la respuesta llegó tarde o incompleta), la lista nunca se
   // queda desactualizada esperando un refresco manual de la página.
   var alumnosFrescos = await refrescarTabla();

   // Si la función RPC falló por un problema de TRANSPORTE (red, timeout,
   // etc. -- res.errorDeRed), confirmamos contra la lista recién pedida a
   // la nube: si el usuario YA aparece ahí, es que el registro sí se
   // guardó (el error fue sólo en el viaje de vuelta de la respuesta), así
   // que lo tratamos como éxito. Un rechazo de NEGOCIO real (por ejemplo
   // "ya existe un alumno con ese usuario", que llega con
   // res.errorDeRed=false) nunca pasa por esta comprobación -- si lo
   // hiciera, un intento de registrar un duplicado se mostraría como
   // "éxito" sólo porque el usuario YA existía de antes.
   var exito = !!(res && res.ok);
   if (!exito && res && res.errorDeRed && claveUsuario && alumnosFrescos) {
    exito = alumnosFrescos.some(function (a) { return (a.usuario || "").toLowerCase() === claveUsuario; });
   }

   if (!exito) {
    errEl.textContent = (res && res.error) || "No se pudo guardar en la nube. Intenta de nuevo.";
    errEl.hidden = false;
    return;
   }
   okEl.textContent = "¡Alumno \"" + nombre + "\" registrado con éxito en la nube! Ya puede iniciar sesión con su usuario y contraseña."; okEl.hidden = false;
   document.getElementById("pa-form-alta").reset();
  });

  document.getElementById("pa-form-config").addEventListener("submit", function (ev) {
   ev.preventDefault();
   // La configuración del sistema (teléfono, voice id) sigue siendo local
   // al dispositivo -- no depende de la nube, así que no necesita await.
   LoginOnboarding.config.guardar({
    telefonoSoporte: document.getElementById("pa-cfg-tel").value.trim(),
    paisSoporte: LoginOnboarding.config.leer().paisSoporte,
    elevenlabsVoiceId: document.getElementById("pa-cfg-voice").value.trim()
   });
   var ok = document.getElementById("pa-cfg-ok"); ok.hidden = false;
   setTimeout(function () { ok.hidden = true; }, 2500);
  });

  panel().addEventListener("click", async function (ev) {
   var top = ev.target.closest("[data-a]");
   if (!top) return;
   if (top.dataset.a === "pa-modo-alumno") { panel().remove(); cbs.modoAlumno(); return; }
   if (top.dataset.a === "pa-logout") { cbs.cerrarSesion(); return; }
   var fila = ev.target.closest("tr[data-usuario]");
   if (!fila) return;
   var usuario = fila.dataset.usuario;
   if (top.dataset.a === "pa-passw") {
    var np = window.prompt("Nueva contraseña para @" + usuario + ":");
    if (np && np.trim()) { top.disabled = true; await LoginOnboarding.usuarios.cambiarPassword(usuario, np.trim()); top.disabled = false; }
   } else if (top.dataset.a === "pa-toggle") {
    top.disabled = true;
    await LoginOnboarding.usuarios.alternarActivo(usuario);
    await refrescarTabla();
   } else if (top.dataset.a === "pa-del") {
    if (window.confirm("¿Eliminar a este alumno y todo su progreso guardado en la nube? Esta acción no se puede deshacer.")) {
     top.disabled = true;
     await LoginOnboarding.usuarios.eliminarAlumno(usuario);
     await refrescarTabla();
    }
   }
  });
 }

 /* ---------------------------------------------------------------------
  * 5) API PÚBLICA
  * --------------------------------------------------------------------- */
 function mostrar(callbacks) {
  cbs.modoAlumno = (callbacks && callbacks.modoAlumno) || cbs.modoAlumno;
  cbs.cerrarSesion = (callbacks && callbacks.cerrarSesion) || cbs.cerrarSesion;
  render();
 }

 return { mostrar: mostrar };
})();
