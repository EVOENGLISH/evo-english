/* ==========================================================================
   SUPABASE REPOSITORY — capa de datos en la nube para alumnos
   ==========================================================================
   Archivo independiente: es el ÚNICO lugar del proyecto que habla con
   Supabase. loginOnboarding.js y panelAdmin.js nunca llaman a Supabase
   directamente -- siempre pasan por StudentRepository.

   BLINDADO CON RLS + FUNCIONES RPC (ver el SQL "evo-english-supabase-
   seguridad.sql" que te entregué aparte, o el bloque grande de comentario
   que dejamos abajo con el mismo contenido, por si lo pierdes):
   la tabla "alumnos" tiene Row Level Security activado SIN políticas
   públicas, así que la Publishable Key (la que va en este archivo) NO
   puede leer ni escribir la tabla directo -- ni con
   "supabase.from('alumnos').select('*')" desde la consola del navegador.
   La ÚNICA forma de tocar la tabla es a través de las funciones (RPC) de
   abajo, cada una hecha a la medida de lo que la app necesita, y ninguna
   devuelve nunca una contraseña (ni en texto plano ni su hash). Las
   contraseñas se guardan con hash bcrypt (pgcrypto), no en texto plano.

   TABLA "alumnos" en Supabase: usuario (texto, PRIMARY KEY), nombre,
   password (hash bcrypt), activo, edad, meta_minutos, onboarding_completo,
   xp, racha, nivel. "usuario" es el "ID" del alumno en la nube.

   CONTROL DEFENSIVO (pedido explícitamente): ningún error de red o
   timeout debe borrar ni reiniciar los datos locales del alumno. Por eso
   getStudents()/adminListStudents() SIEMPRE devuelve algo usable: si
   Supabase no responde, devuelve la última copia guardada en localStorage
   ("evo-alumnos-cache"), nunca una lista vacía que borre lo que ya había
   en pantalla.

   Estructura interna:
     1) CONFIGURACIÓN Y CLIENTE
     2) NOTIFICACIONES DE ERROR (nunca silenciosas, nunca destructivas)
     3) CACHÉ LOCAL DE RESPALDO (para trabajar sin conexión)
     4) StudentRepository — la única API pública de este archivo:
        login, adminListStudents, adminRegisterStudent,
        adminChangePassword, adminToggleActive, adminDeleteStudent,
        completeOnboarding, updateProgress, buscarEnCache
   ========================================================================== */
var StudentRepository = (function () {
 "use strict";

 /* ---------------------------------------------------------------------
  * 1) CONFIGURACIÓN Y CLIENTE
  * --------------------------------------------------------------------- */
 var SUPABASE_URL = "https://djldztsatvzgemashunk.supabase.co";
 var SUPABASE_KEY = "sb_publishable_ioY719QrXjQ5d94lRzLTFA_77tgWj4A";

 // OJO: la variable se llama "cliente" (NO "supabase") a propósito. El
 // CDN de Supabase deja su SDK en window.supabase; si aquí declaráramos
 // "var supabase = window.supabase.createClient(...)" en el alcance
 // global, sobrescribiríamos ese mismo objeto global y romperíamos la
 // librería para cualquier otro código que la necesite después.
 var cliente = null;
 function obtenerCliente() {
  if (cliente) return cliente;
  if (window.supabase && typeof window.supabase.createClient === "function") {
   cliente = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return cliente;
 }

 /* ---------------------------------------------------------------------
  * 2) NOTIFICACIONES DE ERROR
  * --------------------------------------------------------------------- */
 function avisar(msg) {
  try { if (typeof window.toast === "function") window.toast(msg); else console.warn("[EVO Supabase] " + msg); }
  catch (_) {}
 }
 function mensajeDeError(err) {
  return err && err.message ? err.message : "No se pudo conectar con la nube.";
 }
 // Construye un texto con TODO lo que Supabase/Postgres nos dijo del
 // error (message, details, hint, code) -- para diagnosticar problemas
 // reales de la nube (RPC no encontrada, función SQL con un error interno,
 // etc.) en vez de mostrar siempre el mismo mensaje genérico. Se usa en
 // las acciones de administración, que sí las ve el admin en pantalla.
 function detalleError(err) {
  if (!err) return "Sin conexión con la nube (no se pudo cargar la librería de Supabase).";
  var partes = [];
  if (err.message) partes.push(err.message);
  if (err.details) partes.push("Detalles: " + err.details);
  if (err.hint) partes.push("Sugerencia: " + err.hint);
  if (err.code) partes.push("Código: " + err.code);
  return partes.length ? partes.join(" · ") : String(err);
 }

 /* ---------------------------------------------------------------------
  * 3) CACHÉ LOCAL DE RESPALDO (espejo de la última lista exitosa)
  *    Desde el blindaje con RPC, esta caché NUNCA contiene contraseñas
  *    -- admin_listar_alumnos() ya no las devuelve -- así que guardar
  *    esta copia en localStorage es más seguro que antes.
  * --------------------------------------------------------------------- */
 var CLAVE_CACHE = "evo-alumnos-cache";
 function leerCache() { try { return JSON.parse(localStorage.getItem(CLAVE_CACHE) || "[]"); } catch (_) { return []; } }
 function guardarCache(lista) { try { localStorage.setItem(CLAVE_CACHE, JSON.stringify(lista)); } catch (_) {} }
 // Búsqueda SÍNCRONA (sin red) en la caché -- la usa loginOnboarding.js
 // para poder entrar de inmediato con la sesión guardada sin tener que
 // esperar a la nube en cada arranque de la app (modo "sin conexión").
 function buscarEnCache(usuario) {
  var key = (usuario || "").trim().toLowerCase();
  var lista = leerCache();
  for (var i = 0; i < lista.length; i++) if ((lista[i].usuario || "").toLowerCase() === key) return lista[i];
  return null;
 }
 // Inserta o actualiza UNA fila dentro de la copia local, sin tocar las
 // demás. Se usa tras un login exitoso: así, aunque este dispositivo sea
 // el del propio alumno (y nunca haya abierto el Panel de Control, que es
 // lo que normalmente llena esta caché), su reingreso sin conexión sigue
 // funcionando la próxima vez.
 function mezclarEnCache(fila) {
  if (!fila || !fila.usuario) return;
  var lista = leerCache();
  var key = fila.usuario.toLowerCase();
  var idx = -1;
  for (var i = 0; i < lista.length; i++) if ((lista[i].usuario || "").toLowerCase() === key) { idx = i; break; }
  if (idx === -1) lista.push(fila); else lista[idx] = fila;
  guardarCache(lista);
 }

 // Envoltura común para llamar una función RPC de Supabase. Devuelve
 // {ok, data, error} de forma uniforme y nunca lanza.
 async function rpc(nombre, params) {
  var cli = obtenerCliente();
  if (!cli) return { ok: false, offline: true, error: null };
  try {
   var res = await cli.rpc(nombre, params);
   if (res.error) throw res.error;
   return { ok: true, data: res.data };
  } catch (err) {
   console.error("[EVO Supabase] " + nombre + ":", err);
   return { ok: false, error: err };
  }
 }

 /* ---------------------------------------------------------------------
  * 4) API PÚBLICA — StudentRepository
  * --------------------------------------------------------------------- */

 // LOGIN: intenta validar usuario+password contra la nube vía RPC
 // (nunca viaja ni se compara la contraseña en el cliente). Si no hay
 // red, cae a la copia local -- pero como esa copia nunca tuvo la
 // contraseña real (login_alumno tampoco la devuelve), en modo sin
 // conexión sólo puede reconocer un login que YA se validó antes en
 // este dispositivo (ver StudentRepository.buscarEnCache, que usa
 // loginOnboarding.js para el reingreso instantáneo -- no aquí).
 async function login(usuario, password) {
  var r = await rpc("login_alumno", { p_usuario: usuario, p_password: password });
  if (!r.ok) {
   avisar("No se pudo conectar con la nube (" + mensajeDeError(r.error) + "). Intenta de nuevo en un momento.");
   return null;
  }
  var fila = (r.data && r.data[0]) || null;
  if (fila) mezclarEnCache(fila); // permite reingresar sin conexión después
  return fila; // null si el usuario/contraseña no coinciden
 }

 // Lista de alumnos para el Panel de Control (sin contraseñas). Si la
 // nube no responde, devuelve la última copia guardada -- nunca vacía de
 // golpe -- para no borrarle al admin lo que ya estaba viendo.
 async function adminListStudents(adminPassword) {
  var r = await rpc("admin_listar_alumnos", { p_admin_password: adminPassword });
  if (!r.ok) {
   avisar("No se pudo conectar con la nube (" + mensajeDeError(r.error) + "). Mostrando la última copia guardada.");
   return leerCache();
  }
  var lista = r.data || [];
  guardarCache(lista);
  return lista;
 }

 async function adminRegisterStudent(adminPassword, usuario, nombre, password) {
  var r = await rpc("admin_registrar_alumno", { p_admin_password: adminPassword, p_usuario: usuario, p_nombre: nombre, p_password: password });
  if (!r.ok) {
   var detalle = detalleError(r.error);
   // DEBUG TEMPORAL (pedido explícitamente): mientras se diagnostica el
   // problema de conexión con Supabase, esto muestra en un alert() el
   // texto EXACTO que devolvió la nube (message/details/hint/código),
   // en vez de un mensaje genérico. Quitar este alert() una vez resuelto.
   try { window.alert("[EVO Supabase] admin_registrar_alumno falló:\n\n" + detalle); } catch (_) {}
   // "errorDeRed: true" distingue ESTE tipo de falla (la llamada RPC en sí
   // no volvió, por red/timeout/etc.) de un rechazo de negocio normal como
   // "Ya existe un alumno con ese usuario" (que sí es una respuesta válida
   // de la función SQL, con r.ok=true). panelAdmin.js usa esta bandera para
   // saber cuándo vale la pena volver a comprobar si el alumno, a pesar del
   // error de transporte, terminó guardándose de todas formas.
   return { ok: false, error: "No se pudo guardar en la nube: " + detalle, errorDeRed: true };
  }
  // Llegar aquí significa que Supabase NO devolvió ningún error (r.ok es
  // true) -- es decir, el registro SÍ se guardó en la tabla. El único
  // fallo real que puede reportar la propia función SQL es un rechazo de
  // NEGOCIO explícito, como {ok:false, error:"Ya existe..."}: sólo en ese
  // caso devolvemos ese objeto tal cual.
  //
  // OJO: ya NO exigimos que "r.data" venga con contenido para considerar
  // esto un éxito. Antes, si la respuesta de Supabase llegaba sin cuerpo
  // (por ejemplo un 204 "No Content", o el valor json vacío/null que a
  // veces devuelve PostgREST) "r.data" podía ser null/undefined, y como
  // este método simplemente devolvía "r.data" tal cual, el código que
  // llama a esto (registrarAlumno, en loginOnboarding.js) interpretaba
  // ese "null" como fallo -- aunque el alumno YA estuviera guardado. La
  // señal correcta de éxito/fallo es la ausencia/presencia de error
  // (r.ok), nunca la forma de "data".
  if (r.data && typeof r.data === "object" && r.data.ok === false) {
   return r.data; // rechazo de negocio real, ej. "Ya existe un alumno con ese usuario."
  }
  return { ok: true };
 }

 async function adminChangePassword(adminPassword, usuario, nuevaPassword) {
  var r = await rpc("admin_cambiar_password", { p_admin_password: adminPassword, p_usuario: usuario, p_nueva_password: nuevaPassword });
  if (!r.ok) { avisar("No se pudo cambiar la contraseña en la nube (" + detalleError(r.error) + ")."); return { ok: false }; }
  return r.data;
 }

 async function adminToggleActive(adminPassword, usuario) {
  var r = await rpc("admin_alternar_activo", { p_admin_password: adminPassword, p_usuario: usuario });
  if (!r.ok) { avisar("No se pudo actualizar el estado en la nube (" + detalleError(r.error) + ")."); return { ok: false }; }
  return r.data; // {ok, activo}
 }

 async function adminDeleteStudent(adminPassword, usuario) {
  var r = await rpc("admin_eliminar_alumno", { p_admin_password: adminPassword, p_usuario: usuario });
  if (!r.ok) { avisar("No se pudo eliminar en la nube (" + detalleError(r.error) + ")."); return { ok: false }; }
  return r.data;
 }

 // El propio alumno termina su asistente de bienvenida. Es "autoservicio"
 // (no pide contraseña de admin): sólo modifica su propia fila y son
 // datos de bajo riesgo (nombre confirmado, edad, meta diaria).
 async function completeOnboarding(usuario, datos) {
  var r = await rpc("completar_onboarding", {
   p_usuario: usuario, p_nombre: datos.nombre || null,
   p_edad: datos.edad != null ? datos.edad : null, p_meta_minutos: datos.metaMinutos != null ? datos.metaMinutos : null
  });
  if (!r.ok) { avisar("No se pudo guardar tu perfil en la nube (seguirás viéndolo en este dispositivo)."); return { ok: false }; }
  // Refleja el cambio también en la copia local, para que un reingreso
  // sin conexión ya no vuelva a mostrar el asistente de bienvenida.
  var actual = buscarEnCache(usuario) || { usuario: usuario };
  mezclarEnCache(Object.assign({}, actual, {
   nombre: datos.nombre != null ? datos.nombre : actual.nombre,
   edad: datos.edad != null ? datos.edad : actual.edad,
   meta_minutos: datos.metaMinutos != null ? datos.metaMinutos : actual.meta_minutos,
   onboarding_completo: true
  }));
  return r.data;
 }

 // Progreso (nivel, xp, racha) — se llama en segundo plano desde
 // savep() en index.html. NO muestra avisos visibles en cada error:
 // sería molesto interrumpir al alumno mientras estudia por un problema
 // de red pasajero. El progreso local sigue intacto de todas formas.
 async function updateProgress(usuario, progressData) {
  var r = await rpc("actualizar_progreso", {
   p_usuario: usuario,
   p_nivel: progressData.nivel != null ? progressData.nivel : null,
   p_xp: progressData.xp != null ? progressData.xp : null,
   p_racha: progressData.racha != null ? progressData.racha : null
  });
  if (r.ok) {
   var actual = buscarEnCache(usuario);
   if (actual) mezclarEnCache(Object.assign({}, actual, {
    nivel: progressData.nivel != null ? progressData.nivel : actual.nivel,
    xp: progressData.xp != null ? progressData.xp : actual.xp,
    racha: progressData.racha != null ? progressData.racha : actual.racha
   }));
  }
  return r.ok ? r.data : { ok: false };
 }

 return {
  login: login,
  adminListStudents: adminListStudents,
  adminRegisterStudent: adminRegisterStudent,
  adminChangePassword: adminChangePassword,
  adminToggleActive: adminToggleActive,
  adminDeleteStudent: adminDeleteStudent,
  completeOnboarding: completeOnboarding,
  updateProgress: updateProgress,
  buscarEnCache: buscarEnCache
 };
})();
