/* ==========================================================================
   RETOS REPOSITORY — capa de datos en la nube para el contenido del
   Mapa de Aventuras (200 retos / 10 zonas)
   ==========================================================================
   Archivo independiente, hermano de supabaseRepo.js (StudentRepository):
   ESTE archivo es el único lugar del proyecto que lee la tabla "retos" de
   Supabase. mapaAventuras.js nunca llama a Supabase directo -- siempre
   pasa por RetosRepository, igual que loginOnboarding.js/panelAdmin.js
   pasan por StudentRepository.

   BLINDADO CON RLS (ver "evo-english-200-retos-schema.sql" que se entrega
   aparte): la tabla "retos" permite lectura pública (el contenido de un
   reto no es información sensible) pero NINGUNA escritura directa -- sólo
   las funciones admin_guardar_reto()/admin_cargar_retos() pueden crear o
   editar un reto, y ambas piden la contraseña de admin.

   100% OFFLINE-FIRST, mismo patrón que StudentRepository: cada reto que
   llega de la nube se guarda en localStorage ("evo-retos-cache"), y
   AventuraEngine arranca leyendo esa caché de inmediato (síncrono, sin
   esperar a la red) mientras este módulo sincroniza con Supabase en
   segundo plano. Un error de red NUNCA borra la caché: si Supabase no
   responde, el mapa sigue mostrando los retos que ya se habían bajado la
   última vez.

   SI LA TABLA "retos" DE SUPABASE ESTÁ VACÍA (o la nube no responde y
   tampoco hay caché todavía): RetosRepository.listar() devuelve un
   arreglo vacío, y es AventuraEngine quien decide qué hacer con eso (hoy:
   usa como respaldo los 16 retos reales que ya traía escritos en su
   propio código -- ver RETOS_SEMILLA en mapaAventuras.js -- para que el
   Mapa de Aventuras nunca se quede vacío).
   ========================================================================== */
var RetosRepository = (function () {
 "use strict";

 /* ---------------------------------------------------------------------
  * 1) CONFIGURACIÓN Y CLIENTE
  *    Mismo proyecto/credenciales que StudentRepository (misma Publishable
  *    Key: es pública a propósito, y la tabla "retos" está blindada con
  *    RLS igual que "alumnos" -- ver el SQL).
  * --------------------------------------------------------------------- */
 var SUPABASE_URL = "https://djldztsatvzgemashunk.supabase.co";
 var SUPABASE_KEY = "sb_publishable_ioY719QrXjQ5d94lRzLTFA_77tgWj4A";

 var cliente = null;
 function obtenerCliente() {
  if (cliente) return cliente;
  if (window.supabase && typeof window.supabase.createClient === "function") {
   cliente = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return cliente;
 }

 function avisar(msg) {
  try { if (typeof window.toast === "function") window.toast(msg); else console.warn("[EVO Retos] " + msg); }
  catch (_) {}
 }
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
  * 2) CACHÉ LOCAL DE RESPALDO
  * --------------------------------------------------------------------- */
 var CLAVE_CACHE = "evo-retos-cache";
 function leerCache() { try { return JSON.parse(localStorage.getItem(CLAVE_CACHE) || "[]"); } catch (_) { return []; } }
 function guardarCache(lista) { try { localStorage.setItem(CLAVE_CACHE, JSON.stringify(lista)); } catch (_) {} }

 async function rpc(nombre, params) {
  var cli = obtenerCliente();
  if (!cli) return { ok: false, offline: true, error: null };
  try {
   var res = await cli.rpc(nombre, params);
   if (res.error) throw res.error;
   return { ok: true, data: res.data };
  } catch (err) {
   console.error("[EVO Retos] " + nombre + ":", err);
   return { ok: false, error: err };
  }
 }

 /* ---------------------------------------------------------------------
  * 3) API PÚBLICA — RetosRepository
  * --------------------------------------------------------------------- */

 // Lectura SÍNCRONA de la última copia guardada (sin red) -- la usa
 // AventuraEngine para construir el mapa de inmediato al arrancar, sin
 // esperar a la nube. Devuelve [] si todavía no se ha sincronizado nunca
 // en este dispositivo.
 function listar() { return leerCache(); }

 // Sincroniza con la nube (llamar una vez al arrancar la app, en segundo
 // plano) y actualiza la caché local. No hace falta esperar esta promesa
 // para pintar el mapa la primera vez -- se usa para que la PRÓXIMA vez
 // que se abra la app (o tras llamar a redibujar) ya traiga los retos
 // más nuevos que haya cargado el admin desde otro dispositivo.
 async function sincronizar() {
  var r = await rpc("listar_retos", {});
  if (!r.ok) {
   if (!r.offline) avisar("No se pudieron actualizar los retos desde la nube (" + detalleError(r.error) + "). Usando la última copia guardada.");
   return leerCache();
  }
  var lista = r.data || [];
  guardarCache(lista);
  return lista;
 }

 // Guarda/actualiza UN reto (lo usa un futuro editor en el Panel de
 // Control; hoy la carga masiva de abajo es la vía principal).
 async function adminGuardarReto(adminPassword, reto) {
  var r = await rpc("admin_guardar_reto", {
   p_admin_password: adminPassword, p_zona_id: reto.zona_id, p_reto_id: reto.reto_id,
   p_titulo: reto.titulo, p_descripcion: reto.descripcion || null,
   p_audios_urls: reto.audios_urls || [], p_ejercicios: reto.ejercicios
  });
  if (!r.ok) { avisar("No se pudo guardar el reto en la nube (" + detalleError(r.error) + ")."); return { ok: false }; }
  return r.data;
 }

 // Carga masiva: recibe un arreglo de retos (mismo formato que la tabla)
 // y los guarda todos de un jalón vía admin_cargar_retos(). Es lo que usa
 // el script de carga (ver evo-english-cargar-retos.py).
 async function adminCargarRetos(adminPassword, retos) {
  var r = await rpc("admin_cargar_retos", { p_admin_password: adminPassword, p_retos: retos });
  if (!r.ok) { avisar("No se pudieron cargar los retos en la nube (" + detalleError(r.error) + ")."); return { ok: false, error: detalleError(r.error) }; }
  return r.data; // {ok:true, cargados:N}
 }

 async function adminEliminarReto(adminPassword, retoId) {
  var r = await rpc("admin_eliminar_reto", { p_admin_password: adminPassword, p_reto_id: retoId });
  if (!r.ok) { avisar("No se pudo eliminar el reto en la nube (" + detalleError(r.error) + ")."); return { ok: false }; }
  return r.data;
 }

 return {
  listar: listar,
  sincronizar: sincronizar,
  adminGuardarReto: adminGuardarReto,
  adminCargarRetos: adminCargarRetos,
  adminEliminarReto: adminEliminarReto
 };
})();
