/* ==========================================================================
   LOGIN + ONBOARDING + ROLES — puerta de entrada a EVO English
   ==========================================================================
   Archivo independiente: controla quién puede entrar y qué ve cada quien
   (alumno -> mapa; admin -> Panel de Control), y el asistente de
   bienvenida guiado por LEVO para alumnos nuevos. No toca el motor de
   Lecciones ni el de Aventura -- solo decide CUÁNDO se les deja entrar y
   CON QUÉ perfil. Todo lo que toca a Supabase pasa por StudentRepository
   (ver supabaseRepo.js); este archivo nunca llama a Supabase directamente.

   ROLES:
     - "admin": cuenta fija (admin/evo123), NO vive en la nube -- es la
       llave maestra de la escuela y debe seguir funcionando aunque
       Supabase esté caído. Ver ADMIN_FIJO abajo.
     - "alumno": vive en la tabla "alumnos" de Supabase (StudentRepository)
       y se guarda además en una copia local ("evo-alumnos-cache", ver
       supabaseRepo.js) para poder entrar sin esperar a la red.

   MODELO DE DATOS:
     evo-sesion  -> { usuario } de quien tiene la sesión abierta en ESTE
                    dispositivo/navegador (esto sí es local a propósito:
                    cada dispositivo recuerda su propia sesión).
     evo-config  -> { telefonoSoporte, paisSoporte, elevenlabsVoiceId }
                    (config local del Panel de Control; no viaja a la
                    nube en esta versión -- fuera del alcance de esta
                    integración con Supabase).
     Tabla "alumnos" en Supabase (usuario, nombre, password, activo,
     edad, meta_minutos, onboarding_completo, xp, racha, nivel), BLINDADA
     con Row Level Security + funciones RPC (login_alumno, admin_*,
     completar_onboarding, actualizar_progreso) — ver la nota de
     seguridad y el SQL en supabaseRepo.js / evo-english-supabase-
     seguridad.sql. Ni este archivo ni el navegador leen la tabla directo,
     y la contraseña nunca viaja de vuelta al cliente.

   FLUJO:
     1) Si hay sesión guardada de "admin" -> Panel de Control (instantáneo,
        sin red).
     2) Si hay sesión guardada de un alumno -> se busca primero en la
        copia local (instantáneo, funciona sin conexión); si no está
        pausado, entra directo con esos datos.
     3) Si no hay sesión -> pantalla de login. Al validar, "admin" se
        compara localmente; cualquier otro usuario se valida contra la
        nube (StudentRepository.login(), que llama a login_alumno() —
        la contraseña nunca se compara en el navegador).
     4) Alumno sin onboarding completo -> asistente de 3 pasos con LEVO,
        que al terminar guarda su perfil en la nube (y localmente).

   Estructura interna:
     1) CONFIGURACIÓN Y UTILIDADES
     2) MAPEO DE FILAS (Supabase <-> forma que usa el resto de la app)
     3) SESIÓN ACTUAL
     4) API de ALUMNOS para el Panel de Control (usa StudentRepository)
     5) RENDER — pantalla de login
     6) RENDER — asistente de onboarding (3 pasos)
     7) API PÚBLICA (init, cerrarSesion, usuarios, config)
   ========================================================================== */
var LoginOnboarding = (function () {
 "use strict";

 /* ---------------------------------------------------------------------
  * 1) CONFIGURACIÓN Y UTILIDADES
  * --------------------------------------------------------------------- */
 // Cuenta de administrador: fija a propósito (no vive en Supabase) para
 // que la escuela SIEMPRE pueda entrar al Panel, incluso sin internet.
 var ADMIN_FIJO = { nombre: "Administrador", password: "evo123", rol: "admin", activo: true };
 var CLAVE_SESION = "evo-sesion";
 var CLAVE_CONFIG = "evo-config";
 var METAS_MIN = [5, 10, 15, 20];
 var CONFIG_DEFAULT = { telefonoSoporte: "916 341 6965", paisSoporte: "52", elevenlabsVoiceId: "bMxLr8fP6hzNRRi9nJxU" };

 function leerJSON(clave, porDefecto) {
  try { var v = JSON.parse(localStorage.getItem(clave) || "null"); return v == null ? porDefecto : v; }
  catch (_) { return porDefecto; }
 }
 function guardarJSON(clave, valor) { try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (_) {} }
 function normUser(u) { return (u || "").trim().toLowerCase(); }

 /* ---------------------------------------------------------------------
  * 2) MAPEO DE FILAS — Supabase usa snake_case (meta_minutos,
  *    onboarding_completo); el resto de la app (Perfil, onboarding, etc.)
  *    ya esperaba camelCase desde antes de esta integración. Este mapeo
  *    es el único lugar que conoce ambas formas, para no desparramar
  *    "meta_minutos" por todo el archivo.
  * --------------------------------------------------------------------- */
 // Nota: desde el blindaje con RPC, ninguna fila que llega del lado del
 // cliente trae "password" (ni en texto plano ni su hash) -- las
 // funciones login_alumno()/admin_listar_alumnos() ya no la devuelven.
 function filaAUsuario(f) {
  return { usuario: f.usuario, nombre: f.nombre, rol: "alumno",
   activo: f.activo !== false, edad: f.edad || null, metaMinutos: f.meta_minutos || null,
   onboardingCompleto: !!f.onboarding_completo, xp: f.xp || 0, racha: f.racha || 0, nivel: f.nivel || "A1" };
 }
 /* ---------------------------------------------------------------------
  * 3) SESIÓN ACTUAL (local al dispositivo, a propósito)
  * --------------------------------------------------------------------- */
 function leerSesion() { return leerJSON(CLAVE_SESION, null); }
 function guardarSesion(usuario) { guardarJSON(CLAVE_SESION, { usuario: normUser(usuario) }); }
 function borrarSesion() { try { localStorage.removeItem(CLAVE_SESION); } catch (_) {} }

 var USUARIO_ACTUAL = null; // {usuario, nombre, rol, edad, metaMinutos}
 function aplicarUsuarioActual(key, u) {
  USUARIO_ACTUAL = { usuario: key, nombre: u.nombre, rol: u.rol, edad: u.edad || null, metaMinutos: u.metaMinutos || null };
  window.USUARIO_ACTUAL = USUARIO_ACTUAL;
  if (typeof USER !== "undefined" && u.nombre) USER.name = u.nombre;
 }

 /* ---------------------------------------------------------------------
  * 4) API DE ALUMNOS para el Panel de Control — toda pasa por
  *    StudentRepository (Supabase), nunca por localStorage directo.
  *    Desde el blindaje con RLS+RPC, cada acción de administración exige
  *    la contraseña de admin (ADMIN_FIJO.password) como credencial ante
  *    Supabase -- estas funciones la agregan automáticamente, así que
  *    panelAdmin.js sigue llamando a estos métodos exactamente igual que
  *    antes, sin saber nada de contraseñas ni de Supabase.
  * --------------------------------------------------------------------- */
 async function listarAlumnos() {
  var filas = await StudentRepository.adminListStudents(ADMIN_FIJO.password);
  return filas.map(function (f) {
   // "racha" = días consecutivos activos (viene de la tabla "alumnos" en
   // Supabase, columna "racha", ya actualizada en vivo por
   // actualizar_progreso() cada vez que el alumno estudia -- ver
   // sincronizarProgresoNube() en index.html).
   return { usuario: f.usuario, nombre: f.nombre, edad: f.edad, metaMinutos: f.meta_minutos, activo: f.activo !== false, xp: f.xp || 0, racha: f.racha || 0 };
  });
 }

 async function registrarAlumno(nombre, usuario, password) {
  nombre = (nombre || "").trim(); var key = normUser(usuario); password = (password || "").trim();
  if (!nombre || !key || !password) return { ok: false, error: "Completa nombre, usuario y contraseña." };
  if (key === "admin") return { ok: false, error: "\"admin\" es una cuenta reservada; elige otro usuario." };
  // El duplicado ya no se revisa aquí: admin_registrar_alumno() lo hace
  // dentro de la misma función SQL (una sola consulta atómica en el
  // servidor), así que no hay ventana de tiempo entre "revisar" y
  // "guardar" en la que dos registros simultáneos pudieran chocar.
  var res = await StudentRepository.adminRegisterStudent(ADMIN_FIJO.password, key, nombre, password);
  if (!res || !res.ok) {
   // "errorDeRed" viaja tal cual desde supabaseRepo.js -- ver el comentario
   // ahí: le dice a panelAdmin.js si vale la pena revisar la lista fresca
   // antes de mostrar el aviso rojo (sólo aplica a fallas de transporte,
   // nunca a un rechazo de negocio real como "usuario ya existe").
   return { ok: false, error: (res && res.error) || "No se pudo guardar en la nube. Intenta de nuevo.", errorDeRed: !!(res && res.errorDeRed) };
  }
  return { ok: true };
 }
 async function cambiarPassword(usuario, nuevaPassword) {
  var key = normUser(usuario);
  if (!(nuevaPassword || "").trim()) return { ok: false };
  var res = await StudentRepository.adminChangePassword(ADMIN_FIJO.password, key, nuevaPassword.trim());
  return { ok: !!(res && res.ok) };
 }
 async function alternarActivo(usuario) {
  var key = normUser(usuario);
  var res = await StudentRepository.adminToggleActive(ADMIN_FIJO.password, key);
  return { ok: !!(res && res.ok), activo: res && res.activo };
 }
 async function eliminarAlumno(usuario) {
  var key = normUser(usuario);
  var res = await StudentRepository.adminDeleteStudent(ADMIN_FIJO.password, key);
  return { ok: !!(res && res.ok) };
 }

 /* ---------------------------------------------------------------------
  * 5) RENDER — PANTALLA DE LOGIN
  * --------------------------------------------------------------------- */
 function overlay() {
  var el = document.getElementById("auth-overlay");
  if (!el) { el = document.createElement("div"); el.id = "auth-overlay"; document.body.appendChild(el); }
  return el;
 }
 function quitarOverlay() { var el = document.getElementById("auth-overlay"); if (el) el.remove(); }
 function waLink() { var c = leerConfig(); return "https://wa.me/" + c.paisSoporte + soloDigitos(c.telefonoSoporte); }
 function soloDigitos(s) { return (s || "").replace(/\D/g, ""); }

 function pintarLogin(cont) {
  var c = leerConfig();
  overlay().innerHTML =
   '<div class="auth-card">'
   + '<div class="auth-mascota">' + mascot(84) + '<div class="auth-globo">¡Hola, futuro bilingüe!</div></div>'
   + '<h1 class="auth-h1">EVO English</h1>'
   + '<p class="auth-sub">Inicia sesión para continuar tu aventura</p>'
   + '<form id="login-screen" novalidate>'
   + '<label class="auth-label" for="login-user">Usuario</label>'
   + '<input class="auth-input" id="login-user" name="usuario" type="text" autocomplete="username" required placeholder="Tu usuario">'
   + '<label class="auth-label" for="login-pass">Contraseña</label>'
   + '<input class="auth-input" id="login-pass" name="password" type="password" autocomplete="current-password" required placeholder="Tu contraseña">'
   + '<p class="auth-err" id="login-err" hidden></p>'
   + '<button type="submit" class="auth-btn3d">Iniciar Sesión</button>'
   + '</form>'
   + '<p class="auth-ayuda">¿Necesitas ayuda o tu acceso? Contáctanos: '
   + '<a href="' + waLink() + '" target="_blank" rel="noopener">' + esc(c.telefonoSoporte) + '</a></p>'
   + '</div>';
  var form = document.getElementById("login-screen");
  form.addEventListener("submit", async function (ev) {
   ev.preventDefault();
   var key = normUser(document.getElementById("login-user").value);
   var pass = document.getElementById("login-pass").value;
   var errEl = document.getElementById("login-err"), boton = form.querySelector("button[type=submit]");
   if (!key || !pass) { errEl.textContent = "Escribe tu usuario y contraseña para continuar."; errEl.hidden = false; return; }
   errEl.hidden = true;

   if (key === "admin") {
    if (pass !== ADMIN_FIJO.password) { errEl.textContent = "Usuario o contraseña incorrectos."; errEl.hidden = false; return; }
    guardarSesion("admin");
    entrarComo("admin", ADMIN_FIJO, cont);
    return;
   }

   // Alumno: la validación de la contraseña ahora pasa por la función
   // login_alumno() en Supabase (nunca se compara en el navegador ni la
   // contraseña viaja de vuelta) -- muestra un estado de "Entrando…"
   // mientras se resuelve para que no se sienta como que el botón no
   // hizo nada.
   boton.disabled = true; var textoOriginal = boton.textContent; boton.textContent = "Entrando…";
   var fila = await StudentRepository.login(key, pass);
   boton.disabled = false; boton.textContent = textoOriginal;
   if (!fila) { errEl.textContent = "Usuario o contraseña incorrectos."; errEl.hidden = false; return; }
   var u = filaAUsuario(fila);
   if (u.activo === false) { errEl.textContent = "Tu acceso está pausado. Contacta a la escuela para reactivarlo."; errEl.hidden = false; return; }
   guardarSesion(key);
   entrarComo(key, u, cont);
  });
 }

 // Decide a dónde va cada quien después de validar sus credenciales.
 function entrarComo(key, u, cont) {
  aplicarUsuarioActual(key, u);
  if (u.rol === "admin") {
   quitarOverlay();
   // El admin nunca entra directo al mapa: primero ve el Panel de Control.
   PanelAdmin.mostrar({
    modoAlumno: function () { window.cargarProgParaUsuario(null); cont(); },
    cerrarSesion: cerrarSesion
   });
   return;
  }
  if (!u.onboardingCompleto) { pintarPaso1(key, u, cont); return; }
  quitarOverlay();
  window.cargarProgParaUsuario(key);
  cont();
 }

 /* ---------------------------------------------------------------------
  * 6) RENDER — ONBOARDING (3 pasos guiados por LEVO)
  * --------------------------------------------------------------------- */
 var datos = {}; // se va llenando nombre -> edad -> metaMinutos

 function marcoPaso(numero, tituloWolf, cuerpoHTML) {
  return '<div class="auth-card ob-card">'
   + '<div class="auth-mascota">' + rostroLevo(64) + '<div class="auth-globo">' + tituloWolf + '</div></div>'
   + '<div class="ob-progreso"><span class="' + (numero >= 1 ? "on" : "") + '"></span><span class="' + (numero >= 2 ? "on" : "") + '"></span><span class="' + (numero >= 3 ? "on" : "") + '"></span></div>'
   + cuerpoHTML
   + '</div>';
 }

 function pintarPaso1(key, u, cont) {
  datos = { key: key };
  overlay().innerHTML = marcoPaso(1, "¡Hola! ¿Cuál es tu nombre completo?",
   '<form id="ob-paso1" novalidate>'
   // Precargado con el nombre que el admin escribió al registrarlo; el
   // alumno lo puede confirmar o corregir (p.ej. si prefiere un apodo).
   + '<input class="auth-input" id="ob-nombre" type="text" required placeholder="Escribe tu nombre completo" value="' + esc(u.nombre || "") + '" autofocus>'
   + '<p class="auth-err" id="ob-err1" hidden>Escribe tu nombre para continuar.</p>'
   + '<button type="submit" class="auth-btn3d">Siguiente</button>'
   + '</form>');
  var inp = document.getElementById("ob-nombre"); inp.focus(); inp.select();
  document.getElementById("ob-paso1").addEventListener("submit", function (ev) {
   ev.preventDefault();
   var nombre = document.getElementById("ob-nombre").value.trim();
   if (!nombre) { document.getElementById("ob-err1").hidden = false; return; }
   datos.nombre = nombre;
   pintarPaso2(cont);
  });
 }

 function pintarPaso2(cont) {
  overlay().innerHTML = marcoPaso(2, "Mucho gusto, " + esc(datos.nombre) + ". ¿Cuántos años tienes?",
   '<form id="ob-paso2" novalidate>'
   + '<input class="auth-input" id="ob-edad" type="number" inputmode="numeric" min="3" max="99" required placeholder="Tu edad">'
   + '<p class="auth-err" id="ob-err2" hidden>Escribe una edad válida (entre 3 y 99).</p>'
   + '<button type="submit" class="auth-btn3d">Siguiente</button>'
   + '</form>');
  document.getElementById("ob-edad").focus();
  document.getElementById("ob-paso2").addEventListener("submit", function (ev) {
   ev.preventDefault();
   var edad = parseInt(document.getElementById("ob-edad").value, 10);
   if (!edad || edad < 3 || edad > 99) { document.getElementById("ob-err2").hidden = false; return; }
   datos.edad = edad;
   pintarPaso3(cont);
  });
 }

 function pintarPaso3(cont) {
  overlay().innerHTML = marcoPaso(3, "¿Cuántos minutos al día te comprometes a entrenar?",
   '<div class="ob-min-grid" id="ob-min-grid">'
   + METAS_MIN.map(function (m) { return '<button type="button" class="ob-min-btn" data-min="' + m + '">' + m + ' min</button>'; }).join("")
   + '</div>'
   + '<p class="auth-err" id="ob-err3" hidden>Elige una meta para continuar.</p>'
   + '<button type="button" class="auth-btn3d" id="ob-terminar">Empezar mi aventura</button>');
  var grid = document.getElementById("ob-min-grid");
  grid.addEventListener("click", function (ev) {
   var b = ev.target.closest(".ob-min-btn");
   if (!b) return;
   Array.prototype.forEach.call(grid.querySelectorAll(".ob-min-btn"), function (x) { x.classList.remove("sel"); });
   b.classList.add("sel");
   datos.metaMinutos = parseInt(b.getAttribute("data-min"), 10);
   document.getElementById("ob-err3").hidden = true;
  });
  document.getElementById("ob-terminar").addEventListener("click", async function () {
   if (!datos.metaMinutos) { document.getElementById("ob-err3").hidden = false; return; }
   var boton = document.getElementById("ob-terminar"); boton.disabled = true; boton.textContent = "Guardando…";
   var u = { usuario: datos.key, nombre: datos.nombre, edad: datos.edad, metaMinutos: datos.metaMinutos, onboardingCompleto: true, rol: "alumno" };
   // Guarda en la nube (autoservicio: sólo modifica su propia fila, ver
   // completar_onboarding() en el SQL); si falla (sin red, etc.) el
   // alumno entra IGUAL a la app con sus datos --
   // StudentRepository.completeOnboarding ya avisa con un toast del
   // problema, y no perdemos nada porque no había datos locales previos
   // que borrar (control defensivo pedido).
   await StudentRepository.completeOnboarding(datos.key, { nombre: datos.nombre, edad: datos.edad, metaMinutos: datos.metaMinutos });
   aplicarUsuarioActual(datos.key, u);
   window.cargarProgParaUsuario(datos.key);
   quitarOverlay();
   cont(); // arranca el router (go()) ya con el perfil y el progreso cargados
  });
 }

 /* ---------------------------------------------------------------------
  * 7) API PÚBLICA
  * --------------------------------------------------------------------- */
 function leerConfig() { var c = leerJSON(CLAVE_CONFIG, {}); return { telefonoSoporte: c.telefonoSoporte || CONFIG_DEFAULT.telefonoSoporte, paisSoporte: c.paisSoporte || CONFIG_DEFAULT.paisSoporte, elevenlabsVoiceId: c.elevenlabsVoiceId || CONFIG_DEFAULT.elevenlabsVoiceId }; }
 function guardarConfig(c) { guardarJSON(CLAVE_CONFIG, c); if (typeof window.aplicarConfigVoz === "function") window.aplicarConfigVoz(); }

 function init(continuarConLaApp) {
  if (typeof window.aplicarConfigVoz === "function") window.aplicarConfigVoz();
  var ses = leerSesion();
  if (ses && ses.usuario === "admin") { entrarComo("admin", ADMIN_FIJO, continuarConLaApp); return; }
  if (ses) {
   // Offline-first: si ya teníamos una copia local de este alumno (de la
   // última vez que se sincronizó en este dispositivo), entra directo
   // con esos datos sin esperar a la red. Así la app sigue funcionando
   // sin conexión para quien ya inició sesión antes aquí.
   var fila = StudentRepository.buscarEnCache(ses.usuario);
   if (fila && fila.activo !== false) { entrarComo(ses.usuario, filaAUsuario(fila), continuarConLaApp); return; }
  }
  pintarLogin(continuarConLaApp);
 }

 // Botón "Cerrar sesión" (Perfil de alumno y Panel de Control): sólo
 // cierra la sesión de ESTE dispositivo -- no borra la cuenta ni el
 // progreso de nadie en la nube.
 function cerrarSesion() {
  borrarSesion();
  window.location.hash = "";
  window.location.reload();
 }

 return {
  init: init,
  cerrarSesion: cerrarSesion,
  usuarioActual: function () { return USUARIO_ACTUAL; },
  usuarios: { listarAlumnos: listarAlumnos, registrarAlumno: registrarAlumno, cambiarPassword: cambiarPassword, alternarActivo: alternarActivo, eliminarAlumno: eliminarAlumno },
  config: { leer: leerConfig, guardar: guardarConfig }
 };
})();
