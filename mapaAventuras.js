/* ==========================================================================
   MAPA DE AVENTURAS — motor del mapa gamificado (AventuraEngine)
   ==========================================================================
   Archivo independiente: TODO el "Mapa de Aventuras" vive aquí, separado
   del motor de Lecciones formal de la escuela (UNITS, RUN, pkey, PROG.done
   — este archivo no los lee ni los escribe, así que nunca puede chocar con
   el plan de estudios).

   100% local: no hace ninguna llamada a servidores ni APIs externas. Todo
   su progreso se guarda en localStorage del propio navegador (ver
   progreso()/savep() más abajo).

   Dependencias: reutiliza solo utilidades GENÉRICAS ya definidas en
   index.html antes de que este archivo se cargue -- ic, esc, say,
   startMicWith, sfxOk, sfxNo, addXP, wolf, rostroLevo, RetoEngine, $ --
   nunca lógica propia de Lecciones. Por eso <script src="mapaAventuras.js">
   debe ir DESPUÉS de esas utilidades y ANTES del router que llama a
   AventuraEngine.vista()/accion() (ver el <script> que sigue en index.html).

   Estructura interna, en orden:
     1) CONFIGURACIÓN CENTRALIZADA (colores, iconos, XP, geometría del camino)
     2) CONTENIDO (mundos → misiones → 4 pasos cada una)
     3) ESTADO Y PERSISTENCIA (progreso propio, separado de Lecciones)
     4) LÓGICA (nivel de usuario, estado de cada nodo)
     5) RENDER — MAPA (camino fullscreen en "S", nodos 3D)
     6) RENDER — RETO (mini-runner de 4 pasos: Vocabulario/Listening/Speaking/Frase)
     7) API PÚBLICA + MANEJO DE ACCIONES (data-a="av-*")
   ========================================================================== */

/* ==========================================================================
   AVENTURA ENGINE (v2)
   Módulo aislado del "Mapa de Aventuras". Vive completamente separado del
   motor de Lecciones (UNITS, RUN, pkey, PROG.done): no lo lee ni lo escribe.
   Reutiliza solo utilidades genéricas de la app (ic, esc, say, startMicWith,
   sfxOk/sfxNo, addXP, savep) — nunca lógica propia de Lecciones.
   Estructura interna, en orden:
     1) CONFIGURACIÓN CENTRALIZADA (colores, iconos, XP, geometría del camino)
     2) CONTENIDO (mundos → misiones → 4 pasos cada una)
     3) ESTADO Y PERSISTENCIA (progreso propio, separado de Lecciones)
     4) LÓGICA (nivel de usuario, estado de cada nodo)
     5) RENDER — MAPA (camino fullscreen en "S", nodos 3D)
     6) RENDER — RETO (mini-runner de 4 pasos: Vocabulario/Listening/Speaking/Frase)
     7) API PÚBLICA + MANEJO DE ACCIONES (data-a="av-*")
   ========================================================================== */
var AventuraEngine = (function () {
 "use strict";

 /* ---------------------------------------------------------------------
  * 1) CONFIGURACIÓN CENTRALIZADA
  *    Todo lo "ajustable rápido" vive aquí, no repartido por el código.
  * --------------------------------------------------------------------- */
 var CONFIG = {
  colores: { azul: "#0066FF", oro: "#FFD60A", exito: "#12A85F", error: "#E5484D", fondoA: "#0B1F3A", fondoB: "#050B16" },
  // Un acento de color por zona (mundo), en el mismo orden que MUNDOS: azul,
  // verde, cian y dorado — variedad de paleta con significado, no arcoíris.
  coloresZona: ["#0066FF", "#12A85F", "#14C2F5", "#FFD60A"],
  xpPorMision: 15,
  xpPorNivel: 60,                                   // cuánto XP se necesita para subir de nivel
  curva: { pasoY: 132 }                              // separación vertical base entre pasos
 };
 // Cada zona "serpentea" distinto (amplitud/frecuencia propias) en vez de
 // una única onda repetida 16 veces: es lo que rompe la sensación de lista
 // vertical y le da personalidad propia a cada mundo del recorrido.
 var ZONA_AMPLITUD = [92, 114, 78, 100];
 var ZONA_FREC = [Math.PI / 3, Math.PI / 2.6, Math.PI / 2.2, Math.PI / 2.8];
 var OFFSET_X = 0; // se fija abajo, una vez conocida la amplitud máxima real
 for (var _za = 0; _za < ZONA_AMPLITUD.length; _za++) if (ZONA_AMPLITUD[_za] > OFFSET_X) OFFSET_X = ZONA_AMPLITUD[_za];
 // Tipo pedagógico de cada nodo, según su posición REAL dentro de su zona
 // (no inventa contenido: solo nombra el papel que ya cumple esa misión en
 // la progresión introducir → practicar → poner a prueba de cada mundo).
 // Iconos con variedad temática (no solo números): cada tipo de nodo se
 // lee de un vistazo por su forma/ícono, sin depender del texto debajo.
 // situación = libro (una escena/diálogo real que se "lee" primero),
 // práctica = audífonos (escuchar y repetir), desafío = cofre (la
 // recompensa grande de la zona, en forma de hexágono para distinguirlo).
 // Las estrellas/corona ya se usan aparte como medalla de completado
 // (ver av-medalla en nodoHTML) y no chocan con estos iconos de tipo.
 var TIPO_INFO = {
  situacion: { icono: "book", etiqueta: "Situación real", forma: "circulo" },
  practica: { icono: "headphones", etiqueta: "Práctica", forma: "circulo" },
  desafio: { icono: "gift", etiqueta: "Desafío de zona", forma: "hex" }
 };

 /* ---------------------------------------------------------------------
  * 2) CONTENIDO — MUNDOS Y MISIONES COTIDIANAS
  *    Estructura escalable sin límite: se pueden agregar más mundos o más
  *    misiones por mundo sin tocar ninguna otra parte del motor.
  *    Cada misión tiene SIEMPRE 4 pasos, en este orden fijo:
  *      1. vocabulario  → 3-4 palabras clave del tema
  *      2. listening    → audio + opción múltiple (oculta el texto)
  *      3. speaking     → práctica de pronunciación con micrófono
  *      4. final        → ordenar palabras para formar la frase real
  * --------------------------------------------------------------------- */
 // Cada misión ya NO trae sus pasos escritos a mano: trae un "banco" de
 // contenido (8 palabras + 6 frases del tema) y generarPasos() —más abajo—
 // lo expande en una lección completa de 12 a 15 ejercicios variados. Así
 // TODOS los nodos del mapa, presentes y futuros, cargan una lección
 // completa con solo agregar su banco aquí.
 var MUNDOS = [
  { id: "mundo1", titulo: "Café y Comida", misiones: [
   { id: "cafe", titulo: "Pedir un café", banco: {
     palabras: [{ en: "coffee", es: "café" }, { en: "tea", es: "té" }, { en: "small", es: "chico / pequeño" }, { en: "large", es: "grande" }, { en: "to go", es: "para llevar" }, { en: "please", es: "por favor" }, { en: "sugar", es: "azúcar" }, { en: "milk", es: "leche" }],
     frases: [
      { en: "Can I get a small coffee to go, please?", es: "¿Me da un café chico para llevar, por favor?" },
      { en: "I'll have a small coffee, please.", es: "Quiero un café chico, por favor." },
      { en: "Do you have sugar and milk?", es: "¿Tiene azúcar y leche?" },
      { en: "I'd like a large tea, please.", es: "Quisiera un té grande, por favor." },
      { en: "Can I get that to go?", es: "¿Me lo da para llevar?" },
      { en: "No sugar, just milk, please.", es: "Sin azúcar, solo leche, por favor." }
     ] } },
   { id: "pagar", titulo: "Pagar en una tienda", banco: {
     palabras: [{ en: "cash", es: "efectivo" }, { en: "card", es: "tarjeta" }, { en: "receipt", es: "recibo" }, { en: "total", es: "total" }, { en: "discount", es: "descuento" }, { en: "price", es: "precio" }, { en: "change", es: "cambio" }, { en: "tax", es: "impuesto" }],
     frases: [
      { en: "Do you take cards, or cash only?", es: "¿Aceptan tarjeta, o solo efectivo?" },
      { en: "Can I pay with a card?", es: "¿Puedo pagar con tarjeta?" },
      { en: "Can I have the receipt, please?", es: "¿Me da el recibo, por favor?" },
      { en: "What's the total, please?", es: "¿Cuál es el total, por favor?" },
      { en: "Is there a discount today?", es: "¿Hay descuento hoy?" },
      { en: "Here's your change.", es: "Aquí tiene su cambio." }
     ] } },
   { id: "numeros", titulo: "Números y precios", banco: {
     palabras: [{ en: "twelve", es: "doce" }, { en: "fifty", es: "cincuenta" }, { en: "total", es: "total" }, { en: "change", es: "cambio" }, { en: "expensive", es: "caro" }, { en: "cheap", es: "barato" }, { en: "dollar", es: "dólar" }, { en: "price", es: "precio" }],
     frases: [
      { en: "That'll be twelve fifty.", es: "Serían doce cincuenta." },
      { en: "How much is it?", es: "¿Cuánto es?" },
      { en: "That's too expensive for me.", es: "Eso es muy caro para mí." },
      { en: "It's cheap for the quality.", es: "Es barato por la calidad." },
      { en: "The price is fifty dollars.", es: "El precio es cincuenta dólares." },
      { en: "Here is your change.", es: "Aquí está su cambio." }
     ] } },
   { id: "hora", titulo: "Preguntar la hora", banco: {
     palabras: [{ en: "time", es: "hora" }, { en: "clock", es: "reloj" }, { en: "late", es: "tarde" }, { en: "early", es: "temprano" }, { en: "minute", es: "minuto" }, { en: "hour", es: "hora (tiempo)" }, { en: "noon", es: "mediodía" }, { en: "midnight", es: "medianoche" }],
     frases: [
      { en: "Excuse me, do you have the time?", es: "Disculpa, ¿tienes la hora?" },
      { en: "What time is it?", es: "¿Qué hora es?" },
      { en: "I'm running late.", es: "Voy tarde." },
      { en: "We arrived early.", es: "Llegamos temprano." },
      { en: "It's almost noon.", es: "Ya casi es mediodía." },
      { en: "See you at midnight.", es: "Nos vemos a medianoche." }
     ] } }
  ] },
  { id: "mundo2", titulo: "Viajes", misiones: [
   { id: "boleto", titulo: "Comprar un boleto de avión", banco: {
     palabras: [{ en: "ticket", es: "boleto" }, { en: "one-way", es: "de ida" }, { en: "round-trip", es: "ida y vuelta" }, { en: "flight", es: "vuelo" }, { en: "seat", es: "asiento" }, { en: "window", es: "ventana" }, { en: "aisle", es: "pasillo" }, { en: "luggage", es: "equipaje" }],
     frases: [
      { en: "I'd like a one-way ticket to Chicago, please.", es: "Quisiera un boleto sencillo a Chicago, por favor." },
      { en: "A one-way ticket, please.", es: "Un boleto de ida, por favor." },
      { en: "Can I get a window seat?", es: "¿Me da un asiento de ventana?" },
      { en: "I'd prefer an aisle seat.", es: "Prefiero un asiento de pasillo." },
      { en: "How much is a round-trip flight?", es: "¿Cuánto cuesta un vuelo de ida y vuelta?" },
      { en: "I only have one piece of luggage.", es: "Solo tengo una maleta." }
     ] } },
   { id: "aeropuerto", titulo: "En el aeropuerto", banco: {
     palabras: [{ en: "gate", es: "puerta de embarque" }, { en: "boarding", es: "abordaje" }, { en: "passport", es: "pasaporte" }, { en: "luggage", es: "equipaje" }, { en: "delay", es: "retraso" }, { en: "security", es: "seguridad" }, { en: "arrival", es: "llegada" }, { en: "departure", es: "salida" }],
     frases: [
      { en: "Flight 204 is now boarding at gate twelve.", es: "El vuelo 204 ya está abordando en la puerta doce." },
      { en: "Where is my gate?", es: "¿Dónde está mi puerta de embarque?" },
      { en: "Here's my passport.", es: "Aquí está mi pasaporte." },
      { en: "Is there a delay?", es: "¿Hay algún retraso?" },
      { en: "Where is security?", es: "¿Dónde está seguridad?" },
      { en: "What time is the departure?", es: "¿A qué hora es la salida?" }
     ] } },
   { id: "direcciones", titulo: "Pedir direcciones", banco: {
     palabras: [{ en: "straight", es: "derecho" }, { en: "left", es: "izquierda" }, { en: "right", es: "derecha" }, { en: "corner", es: "esquina" }, { en: "block", es: "cuadra" }, { en: "near", es: "cerca" }, { en: "far", es: "lejos" }, { en: "map", es: "mapa" }],
     frases: [
      { en: "Excuse me, how do I get to the station?", es: "Disculpa, ¿cómo llego a la estación?" },
      { en: "Go straight and turn left.", es: "Sigue derecho y da vuelta a la izquierda." },
      { en: "It's two blocks from here.", es: "Está a dos cuadras de aquí." },
      { en: "Is it near or far?", es: "¿Está cerca o lejos?" },
      { en: "Turn right at the corner.", es: "Da vuelta a la derecha en la esquina." },
      { en: "Can you show me on the map?", es: "¿Me lo puedes mostrar en el mapa?" }
     ] } },
   { id: "llamada", titulo: "Una llamada rápida", banco: {
     palabras: [{ en: "call back", es: "regresar la llamada" }, { en: "busy", es: "ocupado" }, { en: "minute", es: "minuto" }, { en: "hold on", es: "espera" }, { en: "voicemail", es: "buzón de voz" }, { en: "number", es: "número" }, { en: "later", es: "más tarde" }, { en: "message", es: "mensaje" }],
     frases: [
      { en: "Can I call you back in five minutes?", es: "¿Te puedo llamar de vuelta en cinco minutos?" },
      { en: "Can I call you back?", es: "¿Te puedo llamar de vuelta?" },
      { en: "I'm a little busy right now.", es: "Estoy un poco ocupado ahora." },
      { en: "Can you hold on a minute?", es: "¿Puedes esperar un minuto?" },
      { en: "Leave a message after the beep.", es: "Deja un mensaje después del tono." },
      { en: "I'll call you later.", es: "Te llamo más tarde." }
     ] } }
  ] },
  { id: "mundo3", titulo: "Vida diaria", misiones: [
   { id: "saludos", titulo: "Saludos rápidos", banco: {
     palabras: [{ en: "long time no see", es: "tanto tiempo" }, { en: "how's it going", es: "cómo te va" }, { en: "take care", es: "cuídate" }, { en: "see you", es: "nos vemos" }, { en: "hello", es: "hola" }, { en: "goodbye", es: "adiós" }, { en: "morning", es: "mañana" }, { en: "evening", es: "tarde / noche" }],
     frases: [
      { en: "Hey! Long time no see.", es: "¡Hey! Tanto tiempo sin verte." },
      { en: "How's it going?", es: "¿Cómo te va?" },
      { en: "Take care, see you soon!", es: "¡Cuídate, nos vemos pronto!" },
      { en: "Good morning, everyone.", es: "Buenos días a todos." },
      { en: "Good evening!", es: "¡Buenas tardes!" },
      { en: "See you tomorrow.", es: "Nos vemos mañana." }
     ] } },
   { id: "presentarte", titulo: "Presentarte", banco: {
     palabras: [{ en: "nice to meet you", es: "mucho gusto" }, { en: "I'm from", es: "soy de" }, { en: "what's your name", es: "cómo te llamas" }, { en: "this is", es: "te presento a" }, { en: "name", es: "nombre" }, { en: "friend", es: "amigo" }, { en: "work", es: "trabajo" }, { en: "live", es: "vivir" }],
     frases: [
      { en: "Hi, I'm {n}. Nice to meet you.", es: "Hola, soy {n}. Mucho gusto." },
      { en: "Nice to meet you.", es: "Mucho gusto." },
      { en: "What's your name?", es: "¿Cómo te llamas?" },
      { en: "I'm from Mexico.", es: "Soy de México." },
      { en: "This is my friend.", es: "Te presento a mi amigo." },
      { en: "Where do you live?", es: "¿Dónde vives?" }
     ] } },
   { id: "clima", titulo: "Hablar del clima", banco: {
     palabras: [{ en: "rain", es: "lluvia" }, { en: "cloudy", es: "nublado" }, { en: "sunny", es: "soleado" }, { en: "cold", es: "frío" }, { en: "hot", es: "caluroso" }, { en: "wind", es: "viento" }, { en: "snow", es: "nieve" }, { en: "umbrella", es: "paraguas" }],
     frases: [
      { en: "It looks like it's going to rain.", es: "Parece que va a llover." },
      { en: "It's going to rain.", es: "Va a llover." },
      { en: "It's very sunny today.", es: "Está muy soleado hoy." },
      { en: "It's cold outside.", es: "Hace frío afuera." },
      { en: "Don't forget your umbrella.", es: "No olvides tu paraguas." },
      { en: "It might snow tonight.", es: "Podría nevar esta noche." }
     ] } },
   { id: "smalltalk", titulo: "Small talk rápido", banco: {
     palabras: [{ en: "how have you been", es: "cómo has estado" }, { en: "same as always", es: "igual que siempre" }, { en: "anything new", es: "algo nuevo" }, { en: "not much", es: "no mucho" }, { en: "weekend", es: "fin de semana" }, { en: "busy", es: "ocupado" }, { en: "tired", es: "cansado" }, { en: "great", es: "genial" }],
     frases: [
      { en: "So, how have you been?", es: "Entonces, ¿cómo has estado?" },
      { en: "Not much, same as always.", es: "No mucho, igual que siempre." },
      { en: "Anything new with you?", es: "¿Algo nuevo contigo?" },
      { en: "How was your weekend?", es: "¿Cómo estuvo tu fin de semana?" },
      { en: "I've been a little tired.", es: "He estado un poco cansado." },
      { en: "That sounds great!", es: "¡Eso suena genial!" }
     ] } }
  ] },
  { id: "mundo4", titulo: "Trabajo", misiones: [
   { id: "reunion", titulo: "Reunión de trabajo", banco: {
     palabras: [{ en: "meeting", es: "reunión" }, { en: "deadline", es: "fecha límite" }, { en: "schedule", es: "agendar" }, { en: "teamwork", es: "trabajo en equipo" }, { en: "agenda", es: "agenda" }, { en: "minutes", es: "minuta" }, { en: "attend", es: "asistir" }, { en: "postpone", es: "posponer" }],
     frases: [
      { en: "Can we schedule a meeting for tomorrow?", es: "¿Podemos agendar una reunión para mañana?" },
      { en: "Can we postpone the meeting?", es: "¿Podemos posponer la reunión?" },
      { en: "What's on the agenda today?", es: "¿Qué hay en la agenda de hoy?" },
      { en: "I can't attend the meeting.", es: "No puedo asistir a la reunión." },
      { en: "The deadline is Friday.", es: "La fecha límite es el viernes." },
      { en: "Let's take the minutes.", es: "Tomemos la minuta." }
     ] } },
   { id: "correo", titulo: "Correo profesional", banco: {
     palabras: [{ en: "attach", es: "adjuntar" }, { en: "urgent", es: "urgente" }, { en: "regards", es: "saludos" }, { en: "reply", es: "responder" }, { en: "forward", es: "reenviar" }, { en: "inbox", es: "bandeja de entrada" }, { en: "subject", es: "asunto" }, { en: "sender", es: "remitente" }],
     frases: [
      { en: "I'll reply to your email by tomorrow.", es: "Responderé tu correo mañana." },
      { en: "I'll reply to your email.", es: "Responderé tu correo." },
      { en: "This is urgent, please reply soon.", es: "Esto es urgente, responde pronto." },
      { en: "Can you forward me the file?", es: "¿Me puedes reenviar el archivo?" },
      { en: "I attached the document.", es: "Adjunté el documento." },
      { en: "Best regards.", es: "Saludos cordiales." }
     ] } },
   { id: "entrevista", titulo: "Entrevista de trabajo", banco: {
     palabras: [{ en: "resume", es: "currículum" }, { en: "experience", es: "experiencia" }, { en: "strengths", es: "fortalezas" }, { en: "salary", es: "salario" }, { en: "weakness", es: "debilidad" }, { en: "available", es: "disponible" }, { en: "position", es: "puesto" }, { en: "hire", es: "contratar" }],
     frases: [
      { en: "Tell me about your work experience.", es: "Cuéntame sobre tu experiencia laboral." },
      { en: "I have three years of experience.", es: "Tengo tres años de experiencia." },
      { en: "What are your strengths?", es: "¿Cuáles son tus fortalezas?" },
      { en: "When are you available to start?", es: "¿Cuándo estás disponible para empezar?" },
      { en: "What salary are you expecting?", es: "¿Qué salario esperas?" },
      { en: "I sent my resume yesterday.", es: "Envié mi currículum ayer." }
     ] } },
   { id: "aumento", titulo: "Pedir un aumento", banco: {
     palabras: [{ en: "raise", es: "aumento" }, { en: "promotion", es: "ascenso" }, { en: "performance", es: "desempeño" }, { en: "deserve", es: "merecer" }, { en: "achievement", es: "logro" }, { en: "review", es: "evaluación" }, { en: "budget", es: "presupuesto" }, { en: "worth", es: "valer" }],
     frases: [
      { en: "I believe I deserve a raise this year.", es: "Creo que merezco un aumento este año." },
      { en: "I deserve a raise this year.", es: "Merezco un aumento este año." },
      { en: "My performance has improved a lot.", es: "Mi desempeño ha mejorado mucho." },
      { en: "I'd like to talk about a promotion.", es: "Me gustaría hablar sobre un ascenso." },
      { en: "Is there room in the budget?", es: "¿Hay espacio en el presupuesto?" },
      { en: "I'm proud of this achievement.", es: "Estoy orgulloso de este logro." }
     ] } }
  ] }
 ];

 /* ---------------------------------------------------------------------
  * 1.1) GENERADOR DE LECCIONES — expande el banco de cada misión (8
  *      palabras + 6 frases) en una lección completa de 13 pasos,
  *      intercalando los 5 tipos de dinámica que pide el diseño:
  *      vocabulario, traducción (mixta EN↔ES), completar la frase,
  *      armar la oración y comprensión auditiva. Es lo que permite que
  *      CUALQUIER nodo nuevo (con solo su banco) cargue una lección
  *      completa sin escribir los 13 pasos a mano.
  * --------------------------------------------------------------------- */
 var PALABRAS_VACIAS = { a: 1, an: 1, the: 1, is: 1, "it's": 1, to: 1, i: 1, "i'll": 1, it: 1, my: 1, your: 1, you: 1, me: 1, in: 1, on: 1, at: 1, for: 1, and: 1, do: 1, does: 1, can: 1, we: 1, of: 1, this: 1, that: 1, "i'd": 1, "can't": 1 };
 function limpiarToken(tok) { return tok.replace(/[^a-zA-Z']/g, "").toLowerCase(); }
 function elegirAlAzar(arr, n) { return shuffle(arr.slice()).slice(0, n); }
 // Toma n frases del banco distintas de "excluir" (para armar distractores).
 function otrasFrases(frases, excluirIdx, n) {
  var resto = frases.filter(function (f, i) { return i !== excluirIdx; });
  return elegirAlAzar(resto, Math.min(n, resto.length));
 }
 function pasoVocabularioGen(palabras, desde) { return { tipo: "vocabulario", palabras: palabras.slice(desde, desde + 4) }; }
 function pasoTraduccionGen(frases, idx, dir) {
  var f = frases[idx % frases.length];
  var campo = dir === "en-es" ? "es" : "en";
  var correcta = f[campo];
  var distractores = otrasFrases(frases, idx % frases.length, 2).map(function (o) { return o[campo]; });
  var opts = shuffle([correcta].concat(distractores));
  return { tipo: "traduccion", dir: dir, texto: dir === "en-es" ? f.en : f.es, opts: opts, a: opts.indexOf(correcta), frase: f };
 }
 // Elige la palabra "más importante" de la frase (la más larga que no sea
 // un artículo/pronombre/preposición) para dejarla en blanco.
 function palabraClave(en) {
  var tokens = en.split(" "), mejor = tokens[0], mejorLen = 0;
  tokens.forEach(function (tok) {
   var limpio = limpiarToken(tok);
   if (!PALABRAS_VACIAS[limpio] && limpio.length > mejorLen) { mejor = tok; mejorLen = limpio.length; }
  });
  return mejor;
 }
 function pasoHuecoGen(palabras, frases, idx) {
  var f = frases[idx % frases.length];
  var tokens = f.en.split(" "), clave = palabraClave(f.en), pos = tokens.indexOf(clave);
  var limpio = limpiarToken(clave);
  var distractores = elegirAlAzar(palabras.filter(function (w) { return w.en.toLowerCase() !== limpio; }), 2).map(function (w) { return w.en; });
  var opts = shuffle([clave].concat(distractores));
  var mostrar = tokens.slice(); mostrar[pos] = "____";
  return { tipo: "hueco", antes: mostrar.join(" "), opts: opts, a: opts.indexOf(clave), frase: f };
 }
 function pasoArmarGen(frases, idx) {
  var f = frases[idx % frases.length];
  return { tipo: "armar", frase: f.en, es: f.es, piezas: f.en.split(" ") };
 }
 function pasoEscuchaGen(frases, idx) {
  var f = frases[idx % frases.length];
  var distractores = otrasFrases(frases, idx % frases.length, 2).map(function (o) { return o.es; });
  var opts = shuffle([f.es].concat(distractores));
  return { tipo: "escucha", audio: f.en, opts: opts, a: opts.indexOf(f.es), frase: f };
 }
 // El "patrón" de 13 pasos: recorre las 6 frases y las 8 palabras del banco
 // varias veces, alternando siempre de tipo de dinámica.
 function generarPasos(m) {
  var palabras = m.banco.palabras, frases = m.banco.frases;
  return [
   pasoVocabularioGen(palabras, 0),
   pasoTraduccionGen(frases, 0, "en-es"),
   pasoVocabularioGen(palabras, 4),
   pasoHuecoGen(palabras, frases, 1),
   pasoTraduccionGen(frases, 2, "es-en"),
   pasoArmarGen(frases, 0),
   pasoEscuchaGen(frases, 1),
   pasoHuecoGen(palabras, frases, 3),
   pasoTraduccionGen(frases, 4, "en-es"),
   pasoArmarGen(frases, 2),
   pasoEscuchaGen(frases, 4),
   pasoTraduccionGen(frases, 5, "es-en"),
   pasoArmarGen(frases, 5)
  ];
 }

 // Lista plana de misiones en orden (lo que recorre el mapa), derivada de MUNDOS.
 // Agregar un mundo o una misión nueva arriba es todo lo que hace falta: esta
 // lista y el mapa crecen solos, sin tocar el resto del motor — su lección
 // de 13 pasos se genera sola a partir de su banco.
 var MISIONES = [];
 // El "tipo" de cada nodo sale de su posición real dentro de su zona: la
 // primera misión de cada mundo introduce el tema (situación), las de en
 // medio lo practican, y la última es el desafío que cierra la zona — un
 // arco pedagógico real, no una etiqueta inventada para tener variedad.
 MUNDOS.forEach(function (mundo) {
  mundo.misiones.forEach(function (m, k) {
   m.mundo = mundo.titulo; m.pasos = generarPasos(m);
   m.tipo = k === mundo.misiones.length - 1 ? "desafio" : (k === 0 ? "situacion" : "practica");
   MISIONES.push(m);
  });
 });

 /* ---------------------------------------------------------------------
  * 3) ESTADO Y PERSISTENCIA
  *    Progreso propio, guardado dentro de PROG bajo su propia llave
  *    ("aventura"), igual que ya se hace con PROG.videos. No toca
  *    PROG.done (eso es exclusivo de las lecciones).
  *    Guarda tres cosas reales (nada decorativo):
  *      completadas  → qué retos ya se superaron al menos una vez
  *      enProgreso   → en qué paso se quedó un reto empezado y no
  *                     terminado, para que "en progreso" sea un estado
  *                     de verdad (sobrevive a cerrar y reabrir la app)
  *      mejorPct     → mejor % de aciertos logrado en cada reto, para
  *                     poder distinguir "completado" de "dominado" (100%)
  * --------------------------------------------------------------------- */
 function progreso() {
  if (!PROG.aventura) PROG.aventura = { completadas: {}, xp: 0 };
  var p = PROG.aventura;
  if (!p.enProgreso) p.enProgreso = {};
  if (!p.mejorPct) p.mejorPct = {};
  return p;
 }
 function marcarCompletada(id, pct) {
  var p = progreso();
  if (!p.completadas[id]) { p.completadas[id] = true; p.xp += CONFIG.xpPorMision; addXP(CONFIG.xpPorMision); }
  p.mejorPct[id] = Math.max(p.mejorPct[id] || 0, pct || 0);
  delete p.enProgreso[id];
  savep();
 }
 // Guarda el paso donde va un reto empezado (se llama en cada avance real,
 // nunca en cada tecla): así "en progreso" refleja dónde se quedó de verdad
 // el estudiante, no solo mientras la pestaña sigue abierta.
 function guardarAvance() {
  if (!estado || estado.terminado) return;
  var p = progreso();
  if (estado.i > 0) { p.enProgreso[estado.misionId] = estado.i; savep(); }
 }
 function estaEnProgreso(id) { return !!progreso().enProgreso[id]; }
 function estaDominada(id) { return progreso().mejorPct[id] >= 100; }

 var estado = null; // reto en curso: {misionId, i, sel, resuelto, mic, piezas}

 /* ---------------------------------------------------------------------
  * 4) LÓGICA
  * --------------------------------------------------------------------- */
 function nivelUsuario() { return 1 + Math.floor(progreso().xp / CONFIG.xpPorNivel); }
 // Estado de cada nodo del camino: "hecho" (ya superado), "actual" (el
 // siguiente reto pendiente, el único abierto de entrada) o "bloqueado"
 // (retos futuros, que se destraban en orden al completar el anterior).
 // Este bloqueo secuencial es lo que convierte el mapa en un recorrido real
 // en vez de una lista donde todo está siempre disponible.
 function estadoNodo(i) {
  var p = progreso();
  if (p.completadas[MISIONES[i].id]) return "hecho";
  for (var k = 0; k < MISIONES.length; k++) if (!p.completadas[MISIONES[k].id]) return k === i ? "actual" : "bloqueado";
  return "hecho";
 }
 function misionPorId(id) { for (var i = 0; i < MISIONES.length; i++) if (MISIONES[i].id === id) return MISIONES[i]; return null; }
 function indiceDe(id) { for (var i = 0; i < MISIONES.length; i++) if (MISIONES[i].id === id) return i; return -1; }

 /* ---------------------------------------------------------------------
  * 5) RENDER — MAPA
  *    Camino orgánico: cada zona serpentea con su propia amplitud y
  *    frecuencia (ZONA_AMPLITUD/ZONA_FREC) más una ondulación secundaria
  *    de menor escala, en vez de repetir una sola onda 16 veces — y el
  *    desafío final de cada zona siempre cae al centro, como una pequeña
  *    plaza donde el camino se endereza antes de virar hacia la próxima.
  *    El icono del nodo "actual" es el rostro de LEVO; el resto usa el
  *    icono de su tipo pedagógico real (TIPO_INFO).
  * --------------------------------------------------------------------- */
 // El rostro de LEVO en 3D (con degradados) es la función global rostroLevo(),
 // compartida con RetoEngine y la pantalla de resultados — no se duplica aquí.

 function puntosCamino(n) {
  // Deja un hueco extra justo antes del primer nodo de cada zona nueva,
  // para que el separador/checkpoint de zona tenga aire y no se encime
  // con la etiqueta del nodo anterior.
  var pts = [], holgura = 0, mundoAnterior = null, idxMundo = -1;
  for (var i = 0; i < n; i++) {
   var mu = MISIONES[i] && MISIONES[i].mundo;
   if (mu !== mundoAnterior) { if (mundoAnterior !== null) holgura += 52; mundoAnterior = mu; idxMundo++; }
   var amp = ZONA_AMPLITUD[idxMundo % ZONA_AMPLITUD.length], frec = ZONA_FREC[idxMundo % ZONA_FREC.length];
   // El desafío que cierra la zona siempre aterriza al centro (x=0): es la
   // "plaza" del checkpoint. El resto ondula con la onda propia de su zona
   // más una segunda onda de menor amplitud/mayor frecuencia (organicidad
   // real: no es una sinusoide perfecta, pero sigue siendo determinista y
   // responsive, nunca posiciones al azar).
   var dx = MISIONES[i].tipo === "desafio" ? 0
    : amp * Math.sin(i * frec) + amp * .22 * Math.sin(i * frec * 2.7 + 1.3);
   pts.push([OFFSET_X + dx, i * CONFIG.curva.pasoY + 50 + holgura]);
  }
  return pts;
 }
 function trazoSVG(pts, hasta) {
  if (pts.length < 2) return "";
  var n = hasta == null ? pts.length : hasta + 1;
  if (n < 2) return "";
  var d = "M" + pts[0][0] + " " + pts[0][1];
  for (var i = 1; i < n; i++) {
   var a = pts[i - 1], b = pts[i], midY = (a[1] + b[1]) / 2;
   d += " C " + a[0] + " " + midY + " " + b[0] + " " + midY + " " + b[0] + " " + b[1];
  }
  return d;
 }
 // --- Decorado ambiental ligero (solo CSS/SVG, sin librerías ni imágenes) ---
 // Cada zona tiene su propio motivo, ligado a su tema REAL — no es una
 // alternancia genérica de "naturaleza/tecnología": la zona de café tiene
 // mesas y humo; la de viajes, camino y nube; la de vida diaria, casas; la
 // de trabajo, un panel tecnológico — así los 16 retos se sienten repartidos
 // en un mundo con identidad, no solo pintados con dos plantillas.
 function decoCafe(x, y) {
  return '<g transform="translate(' + x + ' ' + y + ')" opacity=".55" class="av-deco av-deco-a">'
   + '<rect x="-9" y="-4" width="18" height="9" rx="1.5" fill="#2C1B12"/><rect x="-9" y="-4" width="18" height="2.4" fill="#4B3A2A"/>'
   + '<path class="av-vapor" d="M-4-6c0-4 3-4 3-8M4-6c0-4-3-4-3-8" fill="none" stroke="#E9B67A" stroke-width="1.3" stroke-linecap="round"/></g>';
 }
 function decoViajes(x, y) {
  return '<g transform="translate(' + x + ' ' + y + ')" opacity=".5" class="av-deco av-deco-b">'
   + '<ellipse cx="-2" cy="-16" rx="9" ry="4" fill="#B9D4EA"/><ellipse cx="4" cy="-13" rx="6" ry="3" fill="#B9D4EA"/>'
   + '<path d="M-10 2h20" stroke="#324867" stroke-width="2" stroke-dasharray="3 4" stroke-linecap="round"/></g>';
 }
 function decoVidaDiaria(x, y) {
  return '<g transform="translate(' + x + ' ' + y + ')" opacity=".55" class="av-deco av-deco-a">'
   + '<path d="M-9 2V-6l9-7 9 7V2z" fill="#233754"/><rect x="-3.5" y="-5" width="4" height="7" fill="#FFD98A" opacity=".85"/></g>';
 }
 function decoTrabajo(x, y) {
  return '<g transform="translate(' + x + ' ' + y + ')" opacity=".5" class="av-deco av-deco-b">'
   + '<rect x="-7" y="-20" width="14" height="20" rx="2" fill="none" stroke="#14C2F5" stroke-width="1.4"/>'
   + '<path d="M-7-13h14M-4-9h8M-4-5h5" stroke="#14C2F5" stroke-width="1.2"/></g>';
 }
 var DECO_ZONA = [decoCafe, decoViajes, decoVidaDiaria, decoTrabajo];
 function decoradoDe(idxMundo, i, pt) {
  if (i === 0) return ""; // nada antes del primer nodo del camino
  var lado = i % 2 === 0 ? -32 : 32, x = pt[0] + lado, y = pt[1] - 44;
  return DECO_ZONA[idxMundo % DECO_ZONA.length](x, y);
 }
 function nodoHTML(m, i, pt) {
  var st = estadoNodo(i), left = pt[0], top = pt[1], tipo = TIPO_INFO[m.tipo];
  // Solo el reto actual y los ya superados se pueden abrir: los futuros
  // quedan bloqueados hasta llegar a ellos en orden (recorrido real, no
  // una lista donde todo está disponible desde el inicio).
  var clickable = st === "hecho" || st === "actual", tag = clickable ? "button" : "div";
  var extra = clickable ? ' data-a="av-abrir" data-mid="' + esc(m.id) + '"' : "";
  var enCurso = st === "actual" && estaEnProgreso(m.id), dominada = st === "hecho" && estaDominada(m.id);
  var iconoHTML = st === "actual" ? rostroLevo(40) : (st === "bloqueado" ? ic("lock", 22) : ic(tipo.icono, 26));
  var etiquetaAhora = enCurso ? "Continúa aquí" : "Ahora";
  return '<div class="av-node ' + st + " tipo-" + m.tipo + (dominada ? " dominada" : "") + '" style="left:' + left + 'px;top:' + top + 'px">'
   + (st === "actual" ? '<span class="av-ring" aria-hidden="true"></span>' : "")
   + '<' + tag + ' class="av-btn"' + extra + (clickable ? ' aria-label="' + esc(m.titulo) + '"' : ' aria-label="' + esc(m.titulo) + ' (bloqueado)" aria-disabled="true"') + '>' + iconoHTML
   + (st === "hecho" ? '<span class="av-medalla">' + ic(dominada ? "crown" : "star", 12) + "</span>" : "")
   + '</' + tag + '>'
   + '<span class="av-lbl">' + esc(m.titulo) + (st === "actual" ? "<em>" + etiquetaAhora + "</em>" : "") + '</span></div>';
 }
 // El separador de "mundo" ahora también hace de punto de control: muestra
 // cuántas misiones reales de esa zona ya se superaron y se ilumina en
 // dorado cuando la zona queda completa (checkpoint real, no decorativo).
 function separadorMundoHTML(mundo, idxMundo, top, hechas, total) {
  var color = CONFIG.coloresZona[idxMundo % CONFIG.coloresZona.length], completa = hechas === total;
  return '<div class="av-mundo' + (completa ? " listo" : "") + '" style="top:' + (top - 68) + 'px">'
   + '<span style="border-color:' + color + '">'
   + (completa ? ic("trophy", 13) + " " : "") + "Zona " + (idxMundo + 1) + " · " + esc(mundo)
   + '<em>' + hechas + "/" + total + "</em></span></div>";
 }
 function vistaMapa() {
  var pts = puntosCamino(MISIONES.length),
   anchoTotal = OFFSET_X * 2 + 90,
   altoTotal = pts[pts.length - 1][1] + 90,
   nivel = nivelUsuario(), p = progreso();
  var nodos = "", separadores = "", decorado = "", mundoAnterior = null, idxMundo = -1, iActual = -1;
  MISIONES.forEach(function (m, i) {
   if (estadoNodo(i) === "actual" && iActual === -1) iActual = i;
   if (m.mundo !== mundoAnterior) {
    idxMundo++;
    var deMundo = MUNDOS[idxMundo].misiones,
     hechas = deMundo.filter(function (mm) { return p.completadas[mm.id]; }).length;
    separadores += separadorMundoHTML(m.mundo, idxMundo, pts[i][1], hechas, deMundo.length);
    mundoAnterior = m.mundo;
   }
   decorado += decoradoDe(idxMundo, i, pts[i]);
   nodos += nodoHTML(m, i, pts[i]);
  });
  var totalHechas = MISIONES.filter(function (m) { return p.completadas[m.id]; }).length,
   pctMapa = Math.round(totalHechas / MISIONES.length * 100),
   trazoLuz = iActual === -1 ? pts.length - 1 : iActual,
   zonaActual = MUNDOS[Math.max(0, idxMundo0DeActual(iActual))].titulo;
  return '<div class="av-wrap av-fullscreen">'
   + '<div class="av-head">'
   + '<span class="av-pill">' + ic("trophy", 18) + " " + (PROG.streak || 0) + " " + ((PROG.streak || 0) === 1 ? "día" : "días") + "</span>"
   + '<span class="av-pill">' + ic("target", 18) + " Nivel " + nivel + "</span>"
   + '<span class="av-pill">' + ic("star", 18) + " " + p.xp + ' XP total</span>'
   + "</div>"
   + '<div class="av-prog" aria-hidden="true"><i style="width:' + pctMapa + '%"></i></div>'
   + '<p class="av-progtxt">' + totalHechas + ' / ' + MISIONES.length + ' retos superados · ' + esc(zonaActual) + '</p>'
   + '<div class="av-path" style="height:' + altoTotal + 'px;width:' + anchoTotal + 'px;margin:0 auto;position:relative">'
   + '<svg class="av-line" width="' + anchoTotal + '" height="' + altoTotal + '" viewBox="0 0 ' + anchoTotal + " " + altoTotal + '" aria-hidden="true">'
   + '<path d="' + trazoSVG(pts) + '" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="4" stroke-dasharray="2 14" stroke-linecap="round"/>'
   + '<path d="' + trazoSVG(pts, trazoLuz) + '" fill="none" stroke="rgba(0,102,255,.65)" stroke-width="4" stroke-dasharray="2 14" stroke-linecap="round" class="av-lineon"/>'
   + decorado + "</svg>" + separadores + nodos + "</div></div>";
 }
 // Índice del mundo (0-based) al que pertenece el reto actual — para que el
 // HUD pueda decir en qué zona está el estudiante ahora mismo (responde
 // "¿dónde estoy?" sin que el alumno tenga que hacer scroll para verlo).
 function idxMundo0DeActual(iActual) {
  if (iActual === -1) return MUNDOS.length - 1;
  return MUNDOS.reduce(function (acc, mundo, k) { return MISIONES[iActual].mundo === mundo.titulo ? k : acc; }, 0);
 }

 /* ---------------------------------------------------------------------
  * 6) RENDER — RETO (mini-runner de 4 pasos, propio contenedor #av-run)
  * --------------------------------------------------------------------- */
 function iniciarMision(id) {
  // Si no hay una sesión en memoria de este mismo reto, retoma desde el
  // paso guardado en PROG (real "en progreso"): así cerrar la app a medio
  // reto y volver más tarde continúa donde se quedó, no reinicia desde 0.
  if (!estado || estado.misionId !== id || estado.terminado) {
   var resumeAt = progreso().enProgreso[id] || 0;
   estado = { misionId: id, i: resumeAt, sel: null, resuelto: false, piezas: [], orden: null, terminado: false, aciertos: 0, totalPreguntas: 0, t0: Date.now() };
  }
 }
 function redraw() { var c = document.getElementById("av-run"); if (c) c.innerHTML = retoInner(); }
 function pasoActual() { var m = misionPorId(estado.misionId); return m.pasos[estado.i]; }
 function encabezadoReto(m) {
  return '<div class="rtop"><a class="rx" href="#/mapa" aria-label="Salir del reto">' + ic("x", 20) + "</a>"
   + '<div class="bar rbar"><i style="width:' + Math.round((estado.i / m.pasos.length) * 100) + '%"></i></div>'
   + '<span class="rc">' + (estado.i + 1) + "/" + m.pasos.length + "</span></div>";
 }
 // --- Paso 1: Vocabulario nuevo ---
 function pasoVocabulario(m, p) {
  return encabezadoReto(m) + RetoEngine.wolfDialogo("Aprende estas palabras clave:")
   + p.palabras.map(function (w) {
     return '<div class="av-frase"><button class="av-say" data-a="av-say" data-s="' + esc(w.en) + '" aria-label="Escuchar">' + ic("sound", 20) + "</button>"
      + '<div><b>' + esc(w.en) + '</b><br><span class="es2">' + esc(w.es) + "</span></div></div>";
   }).join("")
   + RetoEngine.botonFijo("Continuar", false, "av-cont");
 }
 // Los 3 tipos de opción múltiple (traducción, hueco, escucha) comparten la
 // misma tira de botones .av-op — esta función la dibuja una sola vez.
 function opcionesHTML(p) {
  return p.opts.map(function (o, i) {
   var c = "";
   if (estado.resuelto && i === p.a) c = " ok"; else if (estado.resuelto && i === estado.sel) c = " bad"; else if (estado.sel === i) c = " sel";
   return '<button class="av-op' + c + '" data-a="av-opt" data-i="' + i + '"' + (estado.resuelto ? " disabled" : "") + ">" + esc(T(o)) + "</button>";
  }).join("");
 }
 function pieCheckOMultiple(p, mensajeOk) {
  if (estado.resuelto) {
   var bien = estado.sel === p.a;
   return '<div class="av-fb ' + (bien ? "ok" : "no") + '"><b>' + (bien ? "Correcto." : "Casi.") + "</b> " + mensajeOk + "</div>"
    + RetoEngine.botonFijo("Continuar", false, "av-cont");
  }
  return RetoEngine.botonFijo("Comprobar", estado.sel === null, "av-cont");
 }
 // --- Traducción de selección múltiple (EN→ES o ES→EN) ---
 function pasoTraduccion(m, p) {
  var instruccion = p.dir === "en-es" ? "Traduce al español:" : "Traduce al inglés:";
  var html = encabezadoReto(m) + RetoEngine.wolfDialogo(instruccion)
   + '<div class="av-frase"><div><b>' + esc(T(p.texto)) + "</b></div></div>"
   + opcionesHTML(p)
   + pieCheckOMultiple(p, "“" + esc(T(p.frase.en)) + "” = “" + esc(T(p.frase.es)) + "”");
  return html;
 }
 // --- Completar la frase (fill in the blank) ---
 function pasoHueco(m, p) {
  var html = encabezadoReto(m) + RetoEngine.wolfDialogo("Completa la frase:")
   + '<div class="av-frase"><div class="av-hueco">' + esc(T(p.antes)) + "</div></div>"
   + opcionesHTML(p)
   + pieCheckOMultiple(p, "La frase completa es: “" + esc(T(p.frase.en)) + "”");
  return html;
 }
 // --- Comprensión auditiva (escucha el audio y elige lo que significa) ---
 function pasoEscucha(m, p) {
  var oculto = estado.sel === null && !estado.resuelto;
  var html = encabezadoReto(m) + RetoEngine.wolfDialogo(oculto ? "Escucha con atención…" : "¿Qué escuchaste?")
   + '<div class="av-frase"><button class="av-say" data-a="av-say" data-s="' + esc(T(p.audio)) + '" aria-label="Escuchar">' + ic("sound", 24) + "</button>"
   + '<div class="es2">' + (oculto ? "Toca para escuchar y luego responde." : esc(T(p.audio))) + "</div></div>"
   + opcionesHTML(p)
   + pieCheckOMultiple(p, "“" + esc(T(p.audio)) + "” = “" + esc(T(p.frase.es)) + "”");
  return html;
 }
 // --- Armar la oración (word bank / bloques de palabras en orden) ---
 function pasoArmar(m, p) {
  if (!estado.orden) estado.orden = shuffle(p.piezas.map(function (_, i) { return i; }));
  var usadas = estado.piezas, disponibles = estado.orden.filter(function (i) { return usadas.indexOf(i) === -1; });
  var armada = usadas.map(function (i) { return p.piezas[i]; }).join(" "), correcto = armada.trim() === p.frase.trim();
  var html = encabezadoReto(m) + RetoEngine.wolfDialogo("¡Arma la frase completa!")
   + '<div class="av-frase" style="min-height:52px;flex-wrap:wrap">' + (usadas.length ? usadas.map(function (i, pos) {
     return '<button class="av-op sel" style="display:inline-block;width:auto;margin:4px" data-a="av-unw" data-i="' + pos + '">' + esc(p.piezas[i]) + "</button>";
   }).join("") : '<span class="es2">Toca las palabras en orden…</span>') + "</div>"
   + '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">' + disponibles.map(function (i) {
     return '<button class="av-op" style="display:inline-block;width:auto" data-a="av-w" data-i="' + i + '">' + esc(p.piezas[i]) + "</button>";
   }).join("") + "</div>";
  if (estado.resuelto) {
   html += '<div class="av-fb ' + (correcto ? "ok" : "no") + '"><b>' + (correcto ? "¡Perfecto!" : "Casi.") + "</b> La frase es: “" + esc(p.frase) + "”</div>"
    + RetoEngine.botonFijo("Continuar", false, "av-cont");
  } else {
   html += RetoEngine.botonFijo("Comprobar", usadas.length < p.piezas.length, "av-cont");
  }
  return html;
 }
 function retoInner() {
  var m = misionPorId(estado.misionId); if (!m) return "";
  var p = pasoActual();
  if (p.tipo === "vocabulario") return pasoVocabulario(m, p);
  if (p.tipo === "traduccion") return pasoTraduccion(m, p);
  if (p.tipo === "hueco") return pasoHueco(m, p);
  if (p.tipo === "escucha") return pasoEscucha(m, p);
  return pasoArmar(m, p);
 }
 function retoResultadoHTML() {
  var m = misionPorId(estado.misionId);
  // % real de aciertos de este intento (0 preguntas de opción, como en un
  // reto de puro vocabulario, cuenta como 100%: no hubo nada que fallar).
  var pct = estado.totalPreguntas ? Math.round(estado.aciertos / estado.totalPreguntas * 100) : 100;
  marcarCompletada(m.id, pct);
  return RetoEngine.pantallaResultado({
   xp: CONFIG.xpPorMision,
   aciertos: estado.aciertos,
   totalPreguntas: estado.totalPreguntas,
   tiempoMs: Date.now() - (estado.t0 || Date.now()),
   titulo: "¡Reto completado!",
   subtitulo: "Practicaste “" + m.titulo + "”.",
   destino: "#/mapa",
   textoBoton: "Volver al mapa"
  });
 }
 function vistaMision(id) {
  var m = misionPorId(id);
  if (!m) return '<div class="card"><h3>Ese reto no existe</h3><a class="btn" href="#/mapa">Volver al mapa</a></div>';
  if (estado && estado.misionId === id && estado.terminado) return retoResultadoHTML();
  iniciarMision(id);
  return '<div class="av-run av-fullscreen" id="av-run">' + retoInner() + "</div>";
 }

 /* ---------------------------------------------------------------------
  * 7) API PÚBLICA + MANEJO DE ACCIONES (data-a="av-*")
  * --------------------------------------------------------------------- */
 function avanzarPaso() {
  var m = misionPorId(estado.misionId);
  if (estado.i < m.pasos.length - 1) { estado.i++; estado.sel = null; estado.resuelto = false; estado.piezas = []; estado.orden = null; guardarAvance(); redraw(); }
  else { estado.terminado = true; go(); } // último paso: pantalla de resultado, vía el router de la app
 }
 // Tipos que se resuelven eligiendo una opción de una lista (comparten la
 // misma lógica de comprobación: seleccionar, comprobar contra p.a).
 var TIPOS_OPCION = { traduccion: 1, hueco: 1, escucha: 1 };
 function accion(nombre, el) {
  // "av-abrir" no depende de un reto en curso: abre el panel de información
  // del nodo tocado en el mapa (capa de UI, resuelta por la app global).
  if (nombre === "av-abrir") { showAvPanel(el.dataset.mid); return; }
  if (!estado) return;
  var p = pasoActual();
  if (nombre === "av-say") { say(el.dataset.s); return; }
  if (nombre === "av-opt") { if (!estado.resuelto) { estado.sel = +el.dataset.i; redraw(); } return; }
  if (nombre === "av-w") { if (!estado.resuelto) { estado.piezas.push(+el.dataset.i); redraw(); } return; }
  if (nombre === "av-unw") { if (!estado.resuelto) { estado.piezas.splice(+el.dataset.i, 1); redraw(); } return; }
  if (nombre === "av-cont") {
   if (TIPOS_OPCION[p.tipo]) {
    if (!estado.resuelto) { if (estado.sel === null) return; estado.resuelto = true; estado.totalPreguntas++; if (estado.sel === p.a) { estado.aciertos++; sfxOk(); RetoEngine.celebrar(); } else sfxNo(); redraw(); return; }
    avanzarPaso(); return;
   }
   if (p.tipo === "armar") {
    if (!estado.resuelto) {
     if (estado.piezas.length < p.piezas.length) return;
     estado.resuelto = true;
     estado.totalPreguntas++;
     var armada = estado.piezas.map(function (i) { return p.piezas[i]; }).join(" ");
     if (armada.trim() === p.frase.trim()) { estado.aciertos++; sfxOk(); RetoEngine.celebrar(); } else sfxNo();
     redraw(); return;
    }
    avanzarPaso(); return;
   }
   avanzarPaso(); // vocabulario siempre puede continuar
  }
 }

 return {
  vista: function (seg) { return seg[0] ? vistaMision(seg[0]) : vistaMapa(); }, accion: accion,
  CONFIG: CONFIG, MUNDOS: MUNDOS, MISIONES: MISIONES, misionPorId: misionPorId,
  tipoInfo: function (tipo) { return TIPO_INFO[tipo]; },
  estaCompletada: function (id) { return !!progreso().completadas[id]; },
  estaEnProgreso: estaEnProgreso
 };
})();
