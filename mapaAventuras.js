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
   index.html antes de que este archivo se cargue -- ic, esc, say, sbtn,
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
  * 2) CONTENIDO — 10 ZONAS x 20 RETOS (expansion a 200 retos)
  *    Estructura escalable: agregar una zona o un reto nuevo es solo
  *    agregar una entrada a RETOS_LOCALES (o cargarla a Supabase) -- el
  *    resto del motor (MUNDOS, MISIONES, el camino, los nodos 3D) se
  *    construye solo a partir de zona_id/reto_id, sin tocar nada mas.
  *
  *    Cada reto trae un "banco" de 8 palabras + 6 frases EN/ES, y
  *    generarPasos() --mas abajo-- lo expande en una leccion completa de
  *    13 ejercicios (vocabulario, traduccion EN<->ES, completar la frase,
  *    armar la oracion, listening) -- igual que ya hacia con los 16 retos
  *    originales. El contenido real (vocabulario y frases) de los 184
  *    retos nuevos fue escrito directo aqui, siguiendo el tema de cada
  *    zona y subiendo la dificultad de A1 (zona 1) a A2+ (zona 10).
  *
  *    DOS FUENTES, la que llega despues gana si coinciden en reto_id:
  *      1. RETOS_LOCALES, aqui abajo: los 200 retos (16 originales +
  *         184 nuevos), siempre disponibles aunque no haya internet.
  *      2. RetosRepository (Supabase, tabla "retos"): lo que el admin
  *         vaya cargando/editando desde la nube (ver evo-english-200-
  *         retos-schema.sql) sin tener que volver a publicar la app.
  * --------------------------------------------------------------------- */
 var RETOS_POR_ZONA = 20;
 var TOTAL_ZONAS = 10;
 // Los 10 nombres de zona, en orden (zona_id 1-10 = posicion 1-10 aqui).
 var ZONA_TITULOS = [
  "Primeros Pasos y Supervivencia Básica",
  "Transporte y Desplazamiento Urbano",
  "Comida y Restaurantes",
  "Viajes y Hospedaje",
  "Vida Social y Presentaciones",
  "Emergencias y Salud",
  "Entorno Laboral Básico",
  "Mundo Digital y Mensajería",
  "Rutinas y Conversación Diaria",
  "Consolidación y Autonomía A2+"
 ];
 function zonaIdDeReto(retoId) { return Math.ceil(retoId / RETOS_POR_ZONA); }

 var RETOS_LOCALES = [
  { id: "cafe", zona_id: 1, reto_id: 1, titulo: "Pedir un café", banco: {
        palabras: [
       { en: "coffee", es: "café" },
       { en: "tea", es: "té" },
       { en: "small", es: "chico / pequeño" },
       { en: "large", es: "grande" },
       { en: "to go", es: "para llevar" },
       { en: "please", es: "por favor" },
       { en: "sugar", es: "azúcar" },
       { en: "milk", es: "leche" }
        ],
        frases: [
       { en: "Can I get a small coffee to go, please?", es: "¿Me da un café chico para llevar, por favor?" },
       { en: "I'll have a small coffee, please.", es: "Quiero un café chico, por favor." },
       { en: "Do you have sugar and milk?", es: "¿Tiene azúcar y leche?" },
       { en: "I'd like a large tea, please.", es: "Quisiera un té grande, por favor." },
       { en: "Can I get that to go?", es: "¿Me lo da para llevar?" },
       { en: "No sugar, just milk, please.", es: "Sin azúcar, solo leche, por favor." }
        ]
       } },
  { id: "pagar", zona_id: 1, reto_id: 2, titulo: "Pagar en una tienda", banco: {
        palabras: [
       { en: "cash", es: "efectivo" },
       { en: "card", es: "tarjeta" },
       { en: "receipt", es: "recibo" },
       { en: "total", es: "total" },
       { en: "discount", es: "descuento" },
       { en: "price", es: "precio" },
       { en: "change", es: "cambio" },
       { en: "tax", es: "impuesto" }
        ],
        frases: [
       { en: "Do you take cards, or cash only?", es: "¿Aceptan tarjeta, o solo efectivo?" },
       { en: "Can I pay with a card?", es: "¿Puedo pagar con tarjeta?" },
       { en: "Can I have the receipt, please?", es: "¿Me da el recibo, por favor?" },
       { en: "What's the total, please?", es: "¿Cuál es el total, por favor?" },
       { en: "Is there a discount today?", es: "¿Hay descuento hoy?" },
       { en: "Here's your change.", es: "Aquí tiene su cambio." }
        ]
       } },
  { id: "numeros", zona_id: 1, reto_id: 3, titulo: "Números y precios", banco: {
        palabras: [
       { en: "twelve", es: "doce" },
       { en: "fifty", es: "cincuenta" },
       { en: "total", es: "total" },
       { en: "change", es: "cambio" },
       { en: "expensive", es: "caro" },
       { en: "cheap", es: "barato" },
       { en: "dollar", es: "dólar" },
       { en: "price", es: "precio" }
        ],
        frases: [
       { en: "That'll be twelve fifty.", es: "Serían doce cincuenta." },
       { en: "How much is it?", es: "¿Cuánto es?" },
       { en: "That's too expensive for me.", es: "Eso es muy caro para mí." },
       { en: "It's cheap for the quality.", es: "Es barato por la calidad." },
       { en: "The price is fifty dollars.", es: "El precio es cincuenta dólares." },
       { en: "Here is your change.", es: "Aquí está su cambio." }
        ]
       } },
  { id: "hora", zona_id: 1, reto_id: 4, titulo: "Preguntar la hora", banco: {
        palabras: [
       { en: "time", es: "hora" },
       { en: "clock", es: "reloj" },
       { en: "late", es: "tarde" },
       { en: "early", es: "temprano" },
       { en: "minute", es: "minuto" },
       { en: "hour", es: "hora (tiempo)" },
       { en: "noon", es: "mediodía" },
       { en: "midnight", es: "medianoche" }
        ],
        frases: [
       { en: "Excuse me, do you have the time?", es: "Disculpa, ¿tienes la hora?" },
       { en: "What time is it?", es: "¿Qué hora es?" },
       { en: "I'm running late.", es: "Voy tarde." },
       { en: "We arrived early.", es: "Llegamos temprano." },
       { en: "It's almost noon.", es: "Ya casi es mediodía." },
       { en: "See you at midnight.", es: "Nos vemos a medianoche." }
        ]
       } },
  { id: "z1_r5", zona_id: 1, reto_id: 5, titulo: "Saludar por primera vez", banco: {
        palabras: [
       { en: "hello", es: "hola" },
       { en: "good morning", es: "buenos días" },
       { en: "good afternoon", es: "buenas tardes" },
       { en: "good evening", es: "buenas noches" },
       { en: "how are you", es: "cómo estás" },
       { en: "fine thanks", es: "bien gracias" },
       { en: "nice to meet you", es: "mucho gusto" },
       { en: "welcome", es: "bienvenido" }
        ],
        frases: [
       { en: "Can you tell me more about hello?", es: "¿Me puedes contar más sobre hola?" },
       { en: "I'd like to talk about good afternoon.", es: "Me gustaría hablar sobre buenas tardes." },
       { en: "Do you know anything about how are you?", es: "¿Sabes algo sobre cómo estás?" },
       { en: "Can you explain nice to meet you to me, please?", es: "¿Me puedes explicar mucho gusto por favor?" },
       { en: "I want to ask you about hello.", es: "Quiero preguntarte sobre hola." },
       { en: "Let's go over good afternoon together.", es: "Repasemos buenas tardes juntos." }
        ]
       } },
  { id: "z1_r6", zona_id: 1, reto_id: 6, titulo: "Decir tu nombre", banco: {
        palabras: [
       { en: "my name is", es: "me llamo" },
       { en: "what's your name", es: "cómo te llamas" },
       { en: "last name", es: "apellido" },
       { en: "first name", es: "nombre de pila" },
       { en: "spell", es: "deletrear" },
       { en: "letter", es: "letra" },
       { en: "call me", es: "dime" },
       { en: "nickname", es: "apodo" }
        ],
        frases: [
       { en: "Can you tell me more about my name is?", es: "¿Me puedes contar más sobre me llamo?" },
       { en: "I'd like to talk about last name.", es: "Me gustaría hablar sobre apellido." },
       { en: "Do you know anything about spell?", es: "¿Sabes algo sobre deletrear?" },
       { en: "Can you explain call me to me, please?", es: "¿Me puedes explicar dime por favor?" },
       { en: "I want to ask you about my name is.", es: "Quiero preguntarte sobre me llamo." },
       { en: "Let's go over last name together.", es: "Repasemos apellido juntos." }
        ]
       } },
  { id: "z1_r7", zona_id: 1, reto_id: 7, titulo: "Pedir ayuda", banco: {
        palabras: [
       { en: "help", es: "ayuda" },
       { en: "can you help me", es: "me puedes ayudar" },
       { en: "please", es: "por favor" },
       { en: "I need", es: "necesito" },
       { en: "problem", es: "problema" },
       { en: "thank you", es: "gracias" },
       { en: "sure", es: "claro" },
       { en: "of course", es: "por supuesto" }
        ],
        frases: [
       { en: "Can you tell me more about help?", es: "¿Me puedes contar más sobre ayuda?" },
       { en: "I'd like to talk about please.", es: "Me gustaría hablar sobre por favor." },
       { en: "Do you know anything about problem?", es: "¿Sabes algo sobre problema?" },
       { en: "Can you explain sure to me, please?", es: "¿Me puedes explicar claro por favor?" },
       { en: "I want to ask you about help.", es: "Quiero preguntarte sobre ayuda." },
       { en: "Let's go over please together.", es: "Repasemos por favor juntos." }
        ]
       } },
  { id: "z1_r8", zona_id: 1, reto_id: 8, titulo: "Decir sí o no con cortesía", banco: {
        palabras: [
       { en: "yes please", es: "sí por favor" },
       { en: "no thank you", es: "no gracias" },
       { en: "maybe", es: "tal vez" },
       { en: "I think so", es: "creo que sí" },
       { en: "I don't think so", es: "creo que no" },
       { en: "sure", es: "claro" },
       { en: "not really", es: "no realmente" },
       { en: "exactly", es: "exactamente" }
        ],
        frases: [
       { en: "Can you tell me more about yes please?", es: "¿Me puedes contar más sobre sí por favor?" },
       { en: "I'd like to talk about maybe.", es: "Me gustaría hablar sobre tal vez." },
       { en: "Do you know anything about I don't think so?", es: "¿Sabes algo sobre creo que no?" },
       { en: "Can you explain not really to me, please?", es: "¿Me puedes explicar no realmente por favor?" },
       { en: "I want to ask you about yes please.", es: "Quiero preguntarte sobre sí por favor." },
       { en: "Let's go over maybe together.", es: "Repasemos tal vez juntos." }
        ]
       } },
  { id: "z1_r9", zona_id: 1, reto_id: 9, titulo: "Los días de la semana", banco: {
        palabras: [
       { en: "monday", es: "lunes" },
       { en: "tuesday", es: "martes" },
       { en: "wednesday", es: "miércoles" },
       { en: "thursday", es: "jueves" },
       { en: "friday", es: "viernes" },
       { en: "saturday", es: "sábado" },
       { en: "sunday", es: "domingo" },
       { en: "weekday", es: "día de semana" }
        ],
        frases: [
       { en: "Can you tell me more about monday?", es: "¿Me puedes contar más sobre lunes?" },
       { en: "I'd like to talk about wednesday.", es: "Me gustaría hablar sobre miércoles." },
       { en: "Do you know anything about friday?", es: "¿Sabes algo sobre viernes?" },
       { en: "Can you explain sunday to me, please?", es: "¿Me puedes explicar domingo por favor?" },
       { en: "I want to ask you about monday.", es: "Quiero preguntarte sobre lunes." },
       { en: "Let's go over wednesday together.", es: "Repasemos miércoles juntos." }
        ]
       } },
  { id: "z1_r10", zona_id: 1, reto_id: 10, titulo: "Los colores", banco: {
        palabras: [
       { en: "red", es: "rojo" },
       { en: "blue", es: "azul" },
       { en: "green", es: "verde" },
       { en: "yellow", es: "amarillo" },
       { en: "black", es: "negro" },
       { en: "white", es: "blanco" },
       { en: "color", es: "color" },
       { en: "favorite color", es: "color favorito" }
        ],
        frases: [
       { en: "Can you tell me more about red?", es: "¿Me puedes contar más sobre rojo?" },
       { en: "I'd like to talk about green.", es: "Me gustaría hablar sobre verde." },
       { en: "Do you know anything about black?", es: "¿Sabes algo sobre negro?" },
       { en: "Can you explain color to me, please?", es: "¿Me puedes explicar color por favor?" },
       { en: "I want to ask you about red.", es: "Quiero preguntarte sobre rojo." },
       { en: "Let's go over green together.", es: "Repasemos verde juntos." }
        ]
       } },
  { id: "z1_r11", zona_id: 1, reto_id: 11, titulo: "Preguntar dónde está el baño", banco: {
        palabras: [
       { en: "bathroom", es: "baño" },
       { en: "where is", es: "dónde está" },
       { en: "down the hall", es: "al fondo del pasillo" },
       { en: "first door", es: "primera puerta" },
       { en: "key", es: "llave" },
       { en: "occupied", es: "ocupado" },
       { en: "free", es: "libre" },
       { en: "sink", es: "lavabo" }
        ],
        frases: [
       { en: "Can you tell me more about bathroom?", es: "¿Me puedes contar más sobre baño?" },
       { en: "I'd like to talk about down the hall.", es: "Me gustaría hablar sobre al fondo del pasillo." },
       { en: "Do you know anything about key?", es: "¿Sabes algo sobre llave?" },
       { en: "Can you explain free to me, please?", es: "¿Me puedes explicar libre por favor?" },
       { en: "I want to ask you about bathroom.", es: "Quiero preguntarte sobre baño." },
       { en: "Let's go over down the hall together.", es: "Repasemos al fondo del pasillo juntos." }
        ]
       } },
  { id: "z1_r12", zona_id: 1, reto_id: 12, titulo: "Pedir agua o comida", banco: {
        palabras: [
       { en: "water", es: "agua" },
       { en: "food", es: "comida" },
       { en: "hungry", es: "hambre" },
       { en: "thirsty", es: "sed" },
       { en: "plate", es: "plato" },
       { en: "glass", es: "vaso" },
       { en: "more", es: "más" },
       { en: "enough", es: "suficiente" }
        ],
        frases: [
       { en: "Can you tell me more about water?", es: "¿Me puedes contar más sobre agua?" },
       { en: "I'd like to talk about hungry.", es: "Me gustaría hablar sobre hambre." },
       { en: "Do you know anything about plate?", es: "¿Sabes algo sobre plato?" },
       { en: "Can you explain more to me, please?", es: "¿Me puedes explicar más por favor?" },
       { en: "I want to ask you about water.", es: "Quiero preguntarte sobre agua." },
       { en: "Let's go over hungry together.", es: "Repasemos hambre juntos." }
        ]
       } },
  { id: "z1_r13", zona_id: 1, reto_id: 13, titulo: "Deletrear tu nombre", banco: {
        palabras: [
       { en: "spell", es: "deletrear" },
       { en: "letter by letter", es: "letra por letra" },
       { en: "capital letter", es: "mayúscula" },
       { en: "how do you spell it", es: "cómo se deletrea" },
       { en: "double letter", es: "letra doble" },
       { en: "space", es: "espacio" },
       { en: "hyphen", es: "guion" },
       { en: "accent", es: "acento" }
        ],
        frases: [
       { en: "Can you tell me more about spell?", es: "¿Me puedes contar más sobre deletrear?" },
       { en: "I'd like to talk about capital letter.", es: "Me gustaría hablar sobre mayúscula." },
       { en: "Do you know anything about double letter?", es: "¿Sabes algo sobre letra doble?" },
       { en: "Can you explain hyphen to me, please?", es: "¿Me puedes explicar guion por favor?" },
       { en: "I want to ask you about spell.", es: "Quiero preguntarte sobre deletrear." },
       { en: "Let's go over capital letter together.", es: "Repasemos mayúscula juntos." }
        ]
       } },
  { id: "z1_r14", zona_id: 1, reto_id: 14, titulo: "Contar del uno al veinte", banco: {
        palabras: [
       { en: "one", es: "uno" },
       { en: "five", es: "cinco" },
       { en: "ten", es: "diez" },
       { en: "fifteen", es: "quince" },
       { en: "twenty", es: "veinte" },
       { en: "count", es: "contar" },
       { en: "number", es: "número" },
       { en: "how many", es: "cuántos" }
        ],
        frases: [
       { en: "Can you tell me more about one?", es: "¿Me puedes contar más sobre uno?" },
       { en: "I'd like to talk about ten.", es: "Me gustaría hablar sobre diez." },
       { en: "Do you know anything about twenty?", es: "¿Sabes algo sobre veinte?" },
       { en: "Can you explain number to me, please?", es: "¿Me puedes explicar número por favor?" },
       { en: "I want to ask you about one.", es: "Quiero preguntarte sobre uno." },
       { en: "Let's go over ten together.", es: "Repasemos diez juntos." }
        ]
       } },
  { id: "z1_r15", zona_id: 1, reto_id: 15, titulo: "Despedirte", banco: {
        palabras: [
       { en: "goodbye", es: "adiós" },
       { en: "see you later", es: "nos vemos luego" },
       { en: "see you tomorrow", es: "nos vemos mañana" },
       { en: "take care", es: "cuídate" },
       { en: "have a good day", es: "que tengas buen día" },
       { en: "bye", es: "adiós (informal)" },
       { en: "safe travels", es: "buen viaje" },
       { en: "until next time", es: "hasta la próxima" }
        ],
        frases: [
       { en: "Can you tell me more about goodbye?", es: "¿Me puedes contar más sobre adiós?" },
       { en: "I'd like to talk about see you tomorrow.", es: "Me gustaría hablar sobre nos vemos mañana." },
       { en: "Do you know anything about have a good day?", es: "¿Sabes algo sobre que tengas buen día?" },
       { en: "Can you explain safe travels to me, please?", es: "¿Me puedes explicar buen viaje por favor?" },
       { en: "I want to ask you about goodbye.", es: "Quiero preguntarte sobre adiós." },
       { en: "Let's go over see you tomorrow together.", es: "Repasemos nos vemos mañana juntos." }
        ]
       } },
  { id: "z1_r16", zona_id: 1, reto_id: 16, titulo: "Pedir que repitan algo", banco: {
        palabras: [
       { en: "sorry", es: "perdón" },
       { en: "can you repeat that", es: "puedes repetir eso" },
       { en: "again", es: "otra vez" },
       { en: "slowly", es: "despacio" },
       { en: "I didn't understand", es: "no entendí" },
       { en: "one more time", es: "una vez más" },
       { en: "pardon", es: "disculpa" },
       { en: "louder", es: "más fuerte" }
        ],
        frases: [
       { en: "Can you tell me more about sorry?", es: "¿Me puedes contar más sobre perdón?" },
       { en: "I'd like to talk about again.", es: "Me gustaría hablar sobre otra vez." },
       { en: "Do you know anything about I didn't understand?", es: "¿Sabes algo sobre no entendí?" },
       { en: "Can you explain pardon to me, please?", es: "¿Me puedes explicar disculpa por favor?" },
       { en: "I want to ask you about sorry.", es: "Quiero preguntarte sobre perdón." },
       { en: "Let's go over again together.", es: "Repasemos otra vez juntos." }
        ]
       } },
  { id: "z1_r17", zona_id: 1, reto_id: 17, titulo: "Pedir permiso", banco: {
        palabras: [
       { en: "may I", es: "puedo" },
       { en: "is it okay if", es: "está bien si" },
       { en: "permission", es: "permiso" },
       { en: "allowed", es: "permitido" },
       { en: "sure go ahead", es: "claro adelante" },
       { en: "not allowed", es: "no permitido" },
       { en: "excuse me", es: "disculpe" },
       { en: "of course", es: "claro" }
        ],
        frases: [
       { en: "Can you tell me more about may I?", es: "¿Me puedes contar más sobre puedo?" },
       { en: "I'd like to talk about permission.", es: "Me gustaría hablar sobre permiso." },
       { en: "Do you know anything about sure go ahead?", es: "¿Sabes algo sobre claro adelante?" },
       { en: "Can you explain excuse me to me, please?", es: "¿Me puedes explicar disculpe por favor?" },
       { en: "I want to ask you about may I.", es: "Quiero preguntarte sobre puedo." },
       { en: "Let's go over permission together.", es: "Repasemos permiso juntos." }
        ]
       } },
  { id: "z1_r18", zona_id: 1, reto_id: 18, titulo: "Presentarte con tu edad", banco: {
        palabras: [
       { en: "I am", es: "yo tengo/soy" },
       { en: "years old", es: "años de edad" },
       { en: "how old are you", es: "cuántos años tienes" },
       { en: "age", es: "edad" },
       { en: "young", es: "joven" },
       { en: "adult", es: "adulto" },
       { en: "birthday", es: "cumpleaños" },
       { en: "turn (age)", es: "cumplir años" }
        ],
        frases: [
       { en: "Can you tell me more about I am?", es: "¿Me puedes contar más sobre yo tengo/soy?" },
       { en: "I'd like to talk about how old are you.", es: "Me gustaría hablar sobre cuántos años tienes." },
       { en: "Do you know anything about young?", es: "¿Sabes algo sobre joven?" },
       { en: "Can you explain birthday to me, please?", es: "¿Me puedes explicar cumpleaños por favor?" },
       { en: "I want to ask you about I am.", es: "Quiero preguntarte sobre yo tengo/soy." },
       { en: "Let's go over how old are you together.", es: "Repasemos cuántos años tienes juntos." }
        ]
       } },
  { id: "z1_r19", zona_id: 1, reto_id: 19, titulo: "Decir de dónde eres", banco: {
        palabras: [
       { en: "I'm from", es: "soy de" },
       { en: "country", es: "país" },
       { en: "city", es: "ciudad" },
       { en: "where are you from", es: "de dónde eres" },
       { en: "hometown", es: "ciudad natal" },
       { en: "nationality", es: "nacionalidad" },
       { en: "born in", es: "nacido en" },
       { en: "live in", es: "vivir en" }
        ],
        frases: [
       { en: "Can you tell me more about I'm from?", es: "¿Me puedes contar más sobre soy de?" },
       { en: "I'd like to talk about city.", es: "Me gustaría hablar sobre ciudad." },
       { en: "Do you know anything about hometown?", es: "¿Sabes algo sobre ciudad natal?" },
       { en: "Can you explain born in to me, please?", es: "¿Me puedes explicar nacido en por favor?" },
       { en: "I want to ask you about I'm from.", es: "Quiero preguntarte sobre soy de." },
       { en: "Let's go over city together.", es: "Repasemos ciudad juntos." }
        ]
       } },
  { id: "z1_r20", zona_id: 1, reto_id: 20, titulo: "Repaso: lo esencial", banco: {
        palabras: [
       { en: "hello", es: "hola" },
       { en: "goodbye", es: "adiós" },
       { en: "please", es: "por favor" },
       { en: "thank you", es: "gracias" },
       { en: "yes", es: "sí" },
       { en: "no", es: "no" },
       { en: "help", es: "ayuda" },
       { en: "sorry", es: "perdón" }
        ],
        frases: [
       { en: "Can you tell me more about hello?", es: "¿Me puedes contar más sobre hola?" },
       { en: "I'd like to talk about please.", es: "Me gustaría hablar sobre por favor." },
       { en: "Do you know anything about yes?", es: "¿Sabes algo sobre sí?" },
       { en: "Can you explain help to me, please?", es: "¿Me puedes explicar ayuda por favor?" },
       { en: "I want to ask you about hello.", es: "Quiero preguntarte sobre hola." },
       { en: "Let's go over please together.", es: "Repasemos por favor juntos." }
        ]
       } },
  { id: "direcciones", zona_id: 2, reto_id: 21, titulo: "Pedir direcciones", banco: {
        palabras: [
       { en: "straight", es: "derecho" },
       { en: "left", es: "izquierda" },
       { en: "right", es: "derecha" },
       { en: "corner", es: "esquina" },
       { en: "block", es: "cuadra" },
       { en: "near", es: "cerca" },
       { en: "far", es: "lejos" },
       { en: "map", es: "mapa" }
        ],
        frases: [
       { en: "Excuse me, how do I get to the station?", es: "Disculpa, ¿cómo llego a la estación?" },
       { en: "Go straight and turn left.", es: "Sigue derecho y da vuelta a la izquierda." },
       { en: "It's two blocks from here.", es: "Está a dos cuadras de aquí." },
       { en: "Is it near or far?", es: "¿Está cerca o lejos?" },
       { en: "Turn right at the corner.", es: "Da vuelta a la derecha en la esquina." },
       { en: "Can you show me on the map?", es: "¿Me lo puedes mostrar en el mapa?" }
        ]
       } },
  { id: "z2_r22", zona_id: 2, reto_id: 22, titulo: "Tomar el autobús", banco: {
        palabras: [
       { en: "bus", es: "autobús" },
       { en: "bus stop", es: "parada de autobús" },
       { en: "fare", es: "pasaje" },
       { en: "get on", es: "subir" },
       { en: "get off", es: "bajar" },
       { en: "next stop", es: "siguiente parada" },
       { en: "schedule", es: "horario" },
       { en: "driver", es: "conductor" }
        ],
        frases: [
       { en: "Can you tell me more about bus?", es: "¿Me puedes contar más sobre autobús?" },
       { en: "I'd like to talk about fare.", es: "Me gustaría hablar sobre pasaje." },
       { en: "Do you know anything about get off?", es: "¿Sabes algo sobre bajar?" },
       { en: "Can you explain schedule to me, please?", es: "¿Me puedes explicar horario por favor?" },
       { en: "I want to ask you about bus.", es: "Quiero preguntarte sobre autobús." },
       { en: "Let's go over fare together.", es: "Repasemos pasaje juntos." }
        ]
       } },
  { id: "z2_r23", zona_id: 2, reto_id: 23, titulo: "Tomar el metro", banco: {
        palabras: [
       { en: "subway", es: "metro" },
       { en: "station", es: "estación" },
       { en: "platform", es: "andén" },
       { en: "line", es: "línea" },
       { en: "transfer", es: "transbordo" },
       { en: "exit", es: "salida" },
       { en: "entrance", es: "entrada" },
       { en: "rush hour", es: "hora pico" }
        ],
        frases: [
       { en: "Can you tell me more about subway?", es: "¿Me puedes contar más sobre metro?" },
       { en: "I'd like to talk about platform.", es: "Me gustaría hablar sobre andén." },
       { en: "Do you know anything about transfer?", es: "¿Sabes algo sobre transbordo?" },
       { en: "Can you explain entrance to me, please?", es: "¿Me puedes explicar entrada por favor?" },
       { en: "I want to ask you about subway.", es: "Quiero preguntarte sobre metro." },
       { en: "Let's go over platform together.", es: "Repasemos andén juntos." }
        ]
       } },
  { id: "z2_r24", zona_id: 2, reto_id: 24, titulo: "Pedir un taxi", banco: {
        palabras: [
       { en: "taxi", es: "taxi" },
       { en: "call a taxi", es: "llamar un taxi" },
       { en: "address", es: "dirección" },
       { en: "fare", es: "tarifa" },
       { en: "meter", es: "taxímetro" },
       { en: "airport", es: "aeropuerto" },
       { en: "tip", es: "propina" },
       { en: "receipt", es: "recibo" }
        ],
        frases: [
       { en: "Can you tell me more about taxi?", es: "¿Me puedes contar más sobre taxi?" },
       { en: "I'd like to talk about address.", es: "Me gustaría hablar sobre dirección." },
       { en: "Do you know anything about meter?", es: "¿Sabes algo sobre taxímetro?" },
       { en: "Can you explain tip to me, please?", es: "¿Me puedes explicar propina por favor?" },
       { en: "I want to ask you about taxi.", es: "Quiero preguntarte sobre taxi." },
       { en: "Let's go over address together.", es: "Repasemos dirección juntos." }
        ]
       } },
  { id: "z2_r25", zona_id: 2, reto_id: 25, titulo: "Comprar un boleto", banco: {
        palabras: [
       { en: "ticket", es: "boleto" },
       { en: "one-way", es: "sencillo" },
       { en: "round-trip", es: "ida y vuelta" },
       { en: "price", es: "precio" },
       { en: "ticket machine", es: "máquina de boletos" },
       { en: "ticket office", es: "taquilla" },
       { en: "discount", es: "descuento" },
       { en: "student ticket", es: "boleto de estudiante" }
        ],
        frases: [
       { en: "Can you tell me more about ticket?", es: "¿Me puedes contar más sobre boleto?" },
       { en: "I'd like to talk about round-trip.", es: "Me gustaría hablar sobre ida y vuelta." },
       { en: "Do you know anything about ticket machine?", es: "¿Sabes algo sobre máquina de boletos?" },
       { en: "Can you explain discount to me, please?", es: "¿Me puedes explicar descuento por favor?" },
       { en: "I want to ask you about ticket.", es: "Quiero preguntarte sobre boleto." },
       { en: "Let's go over round-trip together.", es: "Repasemos ida y vuelta juntos." }
        ]
       } },
  { id: "z2_r26", zona_id: 2, reto_id: 26, titulo: "Preguntar por una parada", banco: {
        palabras: [
       { en: "stop", es: "parada" },
       { en: "which stop", es: "cuál parada" },
       { en: "how many stops", es: "cuántas paradas" },
       { en: "get off here", es: "bajar aquí" },
       { en: "next stop", es: "siguiente parada" },
       { en: "final stop", es: "parada final" },
       { en: "closest stop", es: "parada más cercana" },
       { en: "announce", es: "anunciar" }
        ],
        frases: [
       { en: "Can you tell me more about stop?", es: "¿Me puedes contar más sobre parada?" },
       { en: "I'd like to talk about how many stops.", es: "Me gustaría hablar sobre cuántas paradas." },
       { en: "Do you know anything about next stop?", es: "¿Sabes algo sobre siguiente parada?" },
       { en: "Can you explain closest stop to me, please?", es: "¿Me puedes explicar parada más cercana por favor?" },
       { en: "I want to ask you about stop.", es: "Quiero preguntarte sobre parada." },
       { en: "Let's go over how many stops together.", es: "Repasemos cuántas paradas juntos." }
        ]
       } },
  { id: "z2_r27", zona_id: 2, reto_id: 27, titulo: "Leer un mapa", banco: {
        palabras: [
       { en: "map", es: "mapa" },
       { en: "scale", es: "escala" },
       { en: "north", es: "norte" },
       { en: "south", es: "sur" },
       { en: "east", es: "este" },
       { en: "west", es: "oeste" },
       { en: "legend", es: "leyenda" },
       { en: "landmark", es: "punto de referencia" }
        ],
        frases: [
       { en: "Can you tell me more about map?", es: "¿Me puedes contar más sobre mapa?" },
       { en: "I'd like to talk about north.", es: "Me gustaría hablar sobre norte." },
       { en: "Do you know anything about east?", es: "¿Sabes algo sobre este?" },
       { en: "Can you explain legend to me, please?", es: "¿Me puedes explicar leyenda por favor?" },
       { en: "I want to ask you about map.", es: "Quiero preguntarte sobre mapa." },
       { en: "Let's go over north together.", es: "Repasemos norte juntos." }
        ]
       } },
  { id: "z2_r28", zona_id: 2, reto_id: 28, titulo: "Cruzar la calle", banco: {
        palabras: [
       { en: "crosswalk", es: "cruce peatonal" },
       { en: "traffic light", es: "semáforo" },
       { en: "walk sign", es: "señal de cruzar" },
       { en: "look both ways", es: "mirar a ambos lados" },
       { en: "sidewalk", es: "banqueta" },
       { en: "pedestrian", es: "peatón" },
       { en: "careful", es: "cuidado" },
       { en: "wait", es: "esperar" }
        ],
        frases: [
       { en: "Can you tell me more about crosswalk?", es: "¿Me puedes contar más sobre cruce peatonal?" },
       { en: "I'd like to talk about walk sign.", es: "Me gustaría hablar sobre señal de cruzar." },
       { en: "Do you know anything about sidewalk?", es: "¿Sabes algo sobre banqueta?" },
       { en: "Can you explain careful to me, please?", es: "¿Me puedes explicar cuidado por favor?" },
       { en: "I want to ask you about crosswalk.", es: "Quiero preguntarte sobre cruce peatonal." },
       { en: "Let's go over walk sign together.", es: "Repasemos señal de cruzar juntos." }
        ]
       } },
  { id: "z2_r29", zona_id: 2, reto_id: 29, titulo: "Perderse en la ciudad", banco: {
        palabras: [
       { en: "lost", es: "perdido" },
       { en: "I'm lost", es: "estoy perdido" },
       { en: "where am I", es: "dónde estoy" },
       { en: "ask for directions", es: "pedir direcciones" },
       { en: "landmark", es: "punto de referencia" },
       { en: "app", es: "aplicación" },
       { en: "GPS", es: "GPS" },
       { en: "help", es: "ayuda" }
        ],
        frases: [
       { en: "Can you tell me more about lost?", es: "¿Me puedes contar más sobre perdido?" },
       { en: "I'd like to talk about where am I.", es: "Me gustaría hablar sobre dónde estoy." },
       { en: "Do you know anything about landmark?", es: "¿Sabes algo sobre punto de referencia?" },
       { en: "Can you explain GPS to me, please?", es: "¿Me puedes explicar GPS por favor?" },
       { en: "I want to ask you about lost.", es: "Quiero preguntarte sobre perdido." },
       { en: "Let's go over where am I together.", es: "Repasemos dónde estoy juntos." }
        ]
       } },
  { id: "z2_r30", zona_id: 2, reto_id: 30, titulo: "Preguntar cuánto tarda el viaje", banco: {
        palabras: [
       { en: "how long", es: "cuánto tiempo" },
       { en: "trip", es: "viaje" },
       { en: "minutes", es: "minutos" },
       { en: "about an hour", es: "como una hora" },
       { en: "depends on traffic", es: "depende del tráfico" },
       { en: "direct", es: "directo" },
       { en: "with stops", es: "con paradas" },
       { en: "estimated time", es: "tiempo estimado" }
        ],
        frases: [
       { en: "Can you tell me more about how long?", es: "¿Me puedes contar más sobre cuánto tiempo?" },
       { en: "I'd like to talk about minutes.", es: "Me gustaría hablar sobre minutos." },
       { en: "Do you know anything about depends on traffic?", es: "¿Sabes algo sobre depende del tráfico?" },
       { en: "Can you explain with stops to me, please?", es: "¿Me puedes explicar con paradas por favor?" },
       { en: "I want to ask you about how long.", es: "Quiero preguntarte sobre cuánto tiempo." },
       { en: "Let's go over minutes together.", es: "Repasemos minutos juntos." }
        ]
       } },
  { id: "z2_r31", zona_id: 2, reto_id: 31, titulo: "Rentar una bicicleta", banco: {
        palabras: [
       { en: "bicycle", es: "bicicleta" },
       { en: "rent", es: "rentar" },
       { en: "helmet", es: "casco" },
       { en: "bike lane", es: "ciclovía" },
       { en: "return", es: "devolver" },
       { en: "deposit", es: "depósito" },
       { en: "app", es: "aplicación" },
       { en: "station", es: "estación" }
        ],
        frases: [
       { en: "Can you tell me more about bicycle?", es: "¿Me puedes contar más sobre bicicleta?" },
       { en: "I'd like to talk about helmet.", es: "Me gustaría hablar sobre casco." },
       { en: "Do you know anything about return?", es: "¿Sabes algo sobre devolver?" },
       { en: "Can you explain app to me, please?", es: "¿Me puedes explicar aplicación por favor?" },
       { en: "I want to ask you about bicycle.", es: "Quiero preguntarte sobre bicicleta." },
       { en: "Let's go over helmet together.", es: "Repasemos casco juntos." }
        ]
       } },
  { id: "z2_r32", zona_id: 2, reto_id: 32, titulo: "Hablar con el conductor", banco: {
        palabras: [
       { en: "driver", es: "conductor" },
       { en: "excuse me", es: "disculpe" },
       { en: "does this go to", es: "esto va a" },
       { en: "next stop please", es: "siguiente parada por favor" },
       { en: "how much is the fare", es: "cuánto es el pasaje" },
       { en: "thank you", es: "gracias" },
       { en: "careful", es: "con cuidado" },
       { en: "stop here please", es: "pare aquí por favor" }
        ],
        frases: [
       { en: "Can you tell me more about driver?", es: "¿Me puedes contar más sobre conductor?" },
       { en: "I'd like to talk about does this go to.", es: "Me gustaría hablar sobre esto va a." },
       { en: "Do you know anything about how much is the fare?", es: "¿Sabes algo sobre cuánto es el pasaje?" },
       { en: "Can you explain careful to me, please?", es: "¿Me puedes explicar con cuidado por favor?" },
       { en: "I want to ask you about driver.", es: "Quiero preguntarte sobre conductor." },
       { en: "Let's go over does this go to together.", es: "Repasemos esto va a juntos." }
        ]
       } },
  { id: "z2_r33", zona_id: 2, reto_id: 33, titulo: "Llegar tarde al transporte", banco: {
        palabras: [
       { en: "late", es: "tarde" },
       { en: "miss the bus", es: "perder el autobús" },
       { en: "hurry", es: "apurarse" },
       { en: "next one", es: "el siguiente" },
       { en: "wait", es: "esperar" },
       { en: "on time", es: "a tiempo" },
       { en: "delay", es: "retraso" },
       { en: "run", es: "correr" }
        ],
        frases: [
       { en: "Can you tell me more about late?", es: "¿Me puedes contar más sobre tarde?" },
       { en: "I'd like to talk about hurry.", es: "Me gustaría hablar sobre apurarse." },
       { en: "Do you know anything about wait?", es: "¿Sabes algo sobre esperar?" },
       { en: "Can you explain delay to me, please?", es: "¿Me puedes explicar retraso por favor?" },
       { en: "I want to ask you about late.", es: "Quiero preguntarte sobre tarde." },
       { en: "Let's go over hurry together.", es: "Repasemos apurarse juntos." }
        ]
       } },
  { id: "z2_r34", zona_id: 2, reto_id: 34, titulo: "Transbordar de línea", banco: {
        palabras: [
       { en: "transfer", es: "transbordo" },
       { en: "change lines", es: "cambiar de línea" },
       { en: "connection", es: "conexión" },
       { en: "same ticket", es: "mismo boleto" },
       { en: "platform", es: "andén" },
       { en: "follow the signs", es: "seguir las señales" },
       { en: "which direction", es: "qué dirección" },
       { en: "final destination", es: "destino final" }
        ],
        frases: [
       { en: "Can you tell me more about transfer?", es: "¿Me puedes contar más sobre transbordo?" },
       { en: "I'd like to talk about connection.", es: "Me gustaría hablar sobre conexión." },
       { en: "Do you know anything about platform?", es: "¿Sabes algo sobre andén?" },
       { en: "Can you explain which direction to me, please?", es: "¿Me puedes explicar qué dirección por favor?" },
       { en: "I want to ask you about transfer.", es: "Quiero preguntarte sobre transbordo." },
       { en: "Let's go over connection together.", es: "Repasemos conexión juntos." }
        ]
       } },
  { id: "z2_r35", zona_id: 2, reto_id: 35, titulo: "Pedir el camino más corto", banco: {
        palabras: [
       { en: "shortest way", es: "camino más corto" },
       { en: "fastest route", es: "ruta más rápida" },
       { en: "shortcut", es: "atajo" },
       { en: "by foot", es: "a pie" },
       { en: "by car", es: "en carro" },
       { en: "traffic", es: "tráfico" },
       { en: "distance", es: "distancia" },
       { en: "takes long", es: "tarda mucho" }
        ],
        frases: [
       { en: "Can you tell me more about shortest way?", es: "¿Me puedes contar más sobre camino más corto?" },
       { en: "I'd like to talk about shortcut.", es: "Me gustaría hablar sobre atajo." },
       { en: "Do you know anything about by car?", es: "¿Sabes algo sobre en carro?" },
       { en: "Can you explain distance to me, please?", es: "¿Me puedes explicar distancia por favor?" },
       { en: "I want to ask you about shortest way.", es: "Quiero preguntarte sobre camino más corto." },
       { en: "Let's go over shortcut together.", es: "Repasemos atajo juntos." }
        ]
       } },
  { id: "z2_r36", zona_id: 2, reto_id: 36, titulo: "Usar una app de mapas", banco: {
        palabras: [
       { en: "app", es: "aplicación" },
       { en: "GPS", es: "GPS" },
       { en: "location", es: "ubicación" },
       { en: "search", es: "buscar" },
       { en: "directions", es: "indicaciones" },
       { en: "estimated arrival", es: "llegada estimada" },
       { en: "traffic alert", es: "alerta de tráfico" },
       { en: "offline map", es: "mapa sin conexión" }
        ],
        frases: [
       { en: "Can you tell me more about app?", es: "¿Me puedes contar más sobre aplicación?" },
       { en: "I'd like to talk about location.", es: "Me gustaría hablar sobre ubicación." },
       { en: "Do you know anything about directions?", es: "¿Sabes algo sobre indicaciones?" },
       { en: "Can you explain traffic alert to me, please?", es: "¿Me puedes explicar alerta de tráfico por favor?" },
       { en: "I want to ask you about app.", es: "Quiero preguntarte sobre aplicación." },
       { en: "Let's go over location together.", es: "Repasemos ubicación juntos." }
        ]
       } },
  { id: "z2_r37", zona_id: 2, reto_id: 37, titulo: "Pagar el pasaje", banco: {
        palabras: [
       { en: "fare", es: "pasaje" },
       { en: "fare card", es: "tarjeta de pasaje" },
       { en: "top up", es: "recargar" },
       { en: "balance", es: "saldo" },
       { en: "cash", es: "efectivo" },
       { en: "exact change", es: "cambio exacto" },
       { en: "machine", es: "máquina" },
       { en: "insufficient funds", es: "fondos insuficientes" }
        ],
        frases: [
       { en: "Can you tell me more about fare?", es: "¿Me puedes contar más sobre pasaje?" },
       { en: "I'd like to talk about top up.", es: "Me gustaría hablar sobre recargar." },
       { en: "Do you know anything about cash?", es: "¿Sabes algo sobre efectivo?" },
       { en: "Can you explain machine to me, please?", es: "¿Me puedes explicar máquina por favor?" },
       { en: "I want to ask you about fare.", es: "Quiero preguntarte sobre pasaje." },
       { en: "Let's go over top up together.", es: "Repasemos recargar juntos." }
        ]
       } },
  { id: "z2_r38", zona_id: 2, reto_id: 38, titulo: "Reconocer señales de tránsito", banco: {
        palabras: [
       { en: "stop sign", es: "señal de alto" },
       { en: "speed limit", es: "límite de velocidad" },
       { en: "no parking", es: "no estacionarse" },
       { en: "one way", es: "un solo sentido" },
       { en: "yield", es: "ceder el paso" },
       { en: "pedestrian crossing", es: "cruce de peatones" },
       { en: "traffic light", es: "semáforo" },
       { en: "detour", es: "desvío" }
        ],
        frases: [
       { en: "Can you tell me more about stop sign?", es: "¿Me puedes contar más sobre señal de alto?" },
       { en: "I'd like to talk about no parking.", es: "Me gustaría hablar sobre no estacionarse." },
       { en: "Do you know anything about yield?", es: "¿Sabes algo sobre ceder el paso?" },
       { en: "Can you explain traffic light to me, please?", es: "¿Me puedes explicar semáforo por favor?" },
       { en: "I want to ask you about stop sign.", es: "Quiero preguntarte sobre señal de alto." },
       { en: "Let's go over no parking together.", es: "Repasemos no estacionarse juntos." }
        ]
       } },
  { id: "z2_r39", zona_id: 2, reto_id: 39, titulo: "Viajar en carretera", banco: {
        palabras: [
       { en: "highway", es: "carretera" },
       { en: "toll", es: "peaje" },
       { en: "rest stop", es: "área de descanso" },
       { en: "gas station", es: "gasolinera" },
       { en: "speed limit", es: "límite de velocidad" },
       { en: "traffic jam", es: "tráfico pesado" },
       { en: "road trip", es: "viaje por carretera" },
       { en: "exit", es: "salida" }
        ],
        frases: [
       { en: "Can you tell me more about highway?", es: "¿Me puedes contar más sobre carretera?" },
       { en: "I'd like to talk about rest stop.", es: "Me gustaría hablar sobre área de descanso." },
       { en: "Do you know anything about speed limit?", es: "¿Sabes algo sobre límite de velocidad?" },
       { en: "Can you explain road trip to me, please?", es: "¿Me puedes explicar viaje por carretera por favor?" },
       { en: "I want to ask you about highway.", es: "Quiero preguntarte sobre carretera." },
       { en: "Let's go over rest stop together.", es: "Repasemos área de descanso juntos." }
        ]
       } },
  { id: "z2_r40", zona_id: 2, reto_id: 40, titulo: "Repaso: moverse por la ciudad", banco: {
        palabras: [
       { en: "bus", es: "autobús" },
       { en: "subway", es: "metro" },
       { en: "taxi", es: "taxi" },
       { en: "ticket", es: "boleto" },
       { en: "map", es: "mapa" },
       { en: "stop", es: "parada" },
       { en: "direction", es: "dirección" },
       { en: "fare", es: "pasaje" }
        ],
        frases: [
       { en: "Can you tell me more about bus?", es: "¿Me puedes contar más sobre autobús?" },
       { en: "I'd like to talk about taxi.", es: "Me gustaría hablar sobre taxi." },
       { en: "Do you know anything about map?", es: "¿Sabes algo sobre mapa?" },
       { en: "Can you explain direction to me, please?", es: "¿Me puedes explicar dirección por favor?" },
       { en: "I want to ask you about bus.", es: "Quiero preguntarte sobre autobús." },
       { en: "Let's go over taxi together.", es: "Repasemos taxi juntos." }
        ]
       } },
  { id: "z3_r41", zona_id: 3, reto_id: 41, titulo: "Reservar una mesa", banco: {
        palabras: [
       { en: "reservation", es: "reservación" },
       { en: "table for two", es: "mesa para dos" },
       { en: "what time", es: "a qué hora" },
       { en: "name", es: "nombre" },
       { en: "confirm", es: "confirmar" },
       { en: "cancel", es: "cancelar" },
       { en: "window table", es: "mesa junto a la ventana" },
       { en: "how many people", es: "cuántas personas" }
        ],
        frases: [
       { en: "Can you tell me more about reservation?", es: "¿Me puedes contar más sobre reservación?" },
       { en: "I'd like to talk about what time.", es: "Me gustaría hablar sobre a qué hora." },
       { en: "Do you know anything about confirm?", es: "¿Sabes algo sobre confirmar?" },
       { en: "Can you explain window table to me, please?", es: "¿Me puedes explicar mesa junto a la ventana por favor?" },
       { en: "I want to ask you about reservation.", es: "Quiero preguntarte sobre reservación." },
       { en: "Let's go over what time together.", es: "Repasemos a qué hora juntos." }
        ]
       } },
  { id: "z3_r42", zona_id: 3, reto_id: 42, titulo: "Pedir el menú", banco: {
        palabras: [
       { en: "menu", es: "menú" },
       { en: "today's special", es: "especial del día" },
       { en: "recommend", es: "recomendar" },
       { en: "vegetarian options", es: "opciones vegetarianas" },
       { en: "allergy", es: "alergia" },
       { en: "price", es: "precio" },
       { en: "kids menu", es: "menú infantil" },
       { en: "drink menu", es: "menú de bebidas" }
        ],
        frases: [
       { en: "Can you tell me more about menu?", es: "¿Me puedes contar más sobre menú?" },
       { en: "I'd like to talk about recommend.", es: "Me gustaría hablar sobre recomendar." },
       { en: "Do you know anything about allergy?", es: "¿Sabes algo sobre alergia?" },
       { en: "Can you explain kids menu to me, please?", es: "¿Me puedes explicar menú infantil por favor?" },
       { en: "I want to ask you about menu.", es: "Quiero preguntarte sobre menú." },
       { en: "Let's go over recommend together.", es: "Repasemos recomendar juntos." }
        ]
       } },
  { id: "z3_r43", zona_id: 3, reto_id: 43, titulo: "Ordenar un platillo", banco: {
        palabras: [
       { en: "order", es: "ordenar" },
       { en: "I'll have", es: "voy a pedir" },
       { en: "main course", es: "platillo principal" },
       { en: "side dish", es: "guarnición" },
       { en: "medium rare", es: "término medio" },
       { en: "no onions", es: "sin cebolla" },
       { en: "extra", es: "extra" },
       { en: "to share", es: "para compartir" }
        ],
        frases: [
       { en: "Can you tell me more about order?", es: "¿Me puedes contar más sobre ordenar?" },
       { en: "I'd like to talk about main course.", es: "Me gustaría hablar sobre platillo principal." },
       { en: "Do you know anything about medium rare?", es: "¿Sabes algo sobre término medio?" },
       { en: "Can you explain extra to me, please?", es: "¿Me puedes explicar extra por favor?" },
       { en: "I want to ask you about order.", es: "Quiero preguntarte sobre ordenar." },
       { en: "Let's go over main course together.", es: "Repasemos platillo principal juntos." }
        ]
       } },
  { id: "z3_r44", zona_id: 3, reto_id: 44, titulo: "Pedir la cuenta", banco: {
        palabras: [
       { en: "bill", es: "cuenta" },
       { en: "check please", es: "la cuenta por favor" },
       { en: "separate checks", es: "cuentas separadas" },
       { en: "total", es: "total" },
       { en: "tip", es: "propina" },
       { en: "card", es: "tarjeta" },
       { en: "cash", es: "efectivo" },
       { en: "receipt", es: "recibo" }
        ],
        frases: [
       { en: "Can you tell me more about bill?", es: "¿Me puedes contar más sobre cuenta?" },
       { en: "I'd like to talk about separate checks.", es: "Me gustaría hablar sobre cuentas separadas." },
       { en: "Do you know anything about tip?", es: "¿Sabes algo sobre propina?" },
       { en: "Can you explain cash to me, please?", es: "¿Me puedes explicar efectivo por favor?" },
       { en: "I want to ask you about bill.", es: "Quiero preguntarte sobre cuenta." },
       { en: "Let's go over separate checks together.", es: "Repasemos cuentas separadas juntos." }
        ]
       } },
  { id: "z3_r45", zona_id: 3, reto_id: 45, titulo: "Preguntar por alergias", banco: {
        palabras: [
       { en: "allergy", es: "alergia" },
       { en: "nuts", es: "nueces" },
       { en: "gluten", es: "gluten" },
       { en: "dairy", es: "lácteos" },
       { en: "shellfish", es: "mariscos" },
       { en: "contains", es: "contiene" },
       { en: "safe for me", es: "seguro para mí" },
       { en: "ingredient list", es: "lista de ingredientes" }
        ],
        frases: [
       { en: "Can you tell me more about allergy?", es: "¿Me puedes contar más sobre alergia?" },
       { en: "I'd like to talk about gluten.", es: "Me gustaría hablar sobre gluten." },
       { en: "Do you know anything about shellfish?", es: "¿Sabes algo sobre mariscos?" },
       { en: "Can you explain safe for me to me, please?", es: "¿Me puedes explicar seguro para mí por favor?" },
       { en: "I want to ask you about allergy.", es: "Quiero preguntarte sobre alergia." },
       { en: "Let's go over gluten together.", es: "Repasemos gluten juntos." }
        ]
       } },
  { id: "z3_r46", zona_id: 3, reto_id: 46, titulo: "Pedir algo de beber", banco: {
        palabras: [
       { en: "drink", es: "bebida" },
       { en: "water", es: "agua" },
       { en: "soda", es: "soda" },
       { en: "juice", es: "jugo" },
       { en: "with ice", es: "con hielo" },
       { en: "no ice", es: "sin hielo" },
       { en: "wine list", es: "carta de vinos" },
       { en: "refill", es: "rellenar" }
        ],
        frases: [
       { en: "Can you tell me more about drink?", es: "¿Me puedes contar más sobre bebida?" },
       { en: "I'd like to talk about soda.", es: "Me gustaría hablar sobre soda." },
       { en: "Do you know anything about with ice?", es: "¿Sabes algo sobre con hielo?" },
       { en: "Can you explain wine list to me, please?", es: "¿Me puedes explicar carta de vinos por favor?" },
       { en: "I want to ask you about drink.", es: "Quiero preguntarte sobre bebida." },
       { en: "Let's go over soda together.", es: "Repasemos soda juntos." }
        ]
       } },
  { id: "z3_r47", zona_id: 3, reto_id: 47, titulo: "Pedir que quiten un ingrediente", banco: {
        palabras: [
       { en: "without", es: "sin" },
       { en: "remove", es: "quitar" },
       { en: "I'm allergic to", es: "soy alérgico a" },
       { en: "instead of", es: "en lugar de" },
       { en: "on the side", es: "por separado" },
       { en: "substitute", es: "sustituir" },
       { en: "no spice", es: "sin picante" },
       { en: "light sauce", es: "salsa ligera" }
        ],
        frases: [
       { en: "Can you tell me more about without?", es: "¿Me puedes contar más sobre sin?" },
       { en: "I'd like to talk about I'm allergic to.", es: "Me gustaría hablar sobre soy alérgico a." },
       { en: "Do you know anything about on the side?", es: "¿Sabes algo sobre por separado?" },
       { en: "Can you explain no spice to me, please?", es: "¿Me puedes explicar sin picante por favor?" },
       { en: "I want to ask you about without.", es: "Quiero preguntarte sobre sin." },
       { en: "Let's go over I'm allergic to together.", es: "Repasemos soy alérgico a juntos." }
        ]
       } },
  { id: "z3_r48", zona_id: 3, reto_id: 48, titulo: "Pedir recomendaciones del chef", banco: {
        palabras: [
       { en: "chef's recommendation", es: "recomendación del chef" },
       { en: "popular dish", es: "platillo popular" },
       { en: "house special", es: "especialidad de la casa" },
       { en: "fresh today", es: "fresco hoy" },
       { en: "best seller", es: "más pedido" },
       { en: "local dish", es: "platillo típico" },
       { en: "spicy level", es: "nivel de picante" },
       { en: "portion size", es: "tamaño de porción" }
        ],
        frases: [
       { en: "Can you tell me more about chef's recommendation?", es: "¿Me puedes contar más sobre recomendación del chef?" },
       { en: "I'd like to talk about house special.", es: "Me gustaría hablar sobre especialidad de la casa." },
       { en: "Do you know anything about best seller?", es: "¿Sabes algo sobre más pedido?" },
       { en: "Can you explain spicy level to me, please?", es: "¿Me puedes explicar nivel de picante por favor?" },
       { en: "I want to ask you about chef's recommendation.", es: "Quiero preguntarte sobre recomendación del chef." },
       { en: "Let's go over house special together.", es: "Repasemos especialidad de la casa juntos." }
        ]
       } },
  { id: "z3_r49", zona_id: 3, reto_id: 49, titulo: "Pedir la comida para llevar", banco: {
        palabras: [
       { en: "to go", es: "para llevar" },
       { en: "takeout", es: "para llevar" },
       { en: "container", es: "recipiente" },
       { en: "how long will it take", es: "cuánto va a tardar" },
       { en: "pick up", es: "recoger" },
       { en: "delivery", es: "entrega a domicilio" },
       { en: "order number", es: "número de orden" },
       { en: "ready", es: "listo" }
        ],
        frases: [
       { en: "Can you tell me more about to go?", es: "¿Me puedes contar más sobre para llevar?" },
       { en: "I'd like to talk about container.", es: "Me gustaría hablar sobre recipiente." },
       { en: "Do you know anything about pick up?", es: "¿Sabes algo sobre recoger?" },
       { en: "Can you explain order number to me, please?", es: "¿Me puedes explicar número de orden por favor?" },
       { en: "I want to ask you about to go.", es: "Quiero preguntarte sobre para llevar." },
       { en: "Let's go over container together.", es: "Repasemos recipiente juntos." }
        ]
       } },
  { id: "z3_r50", zona_id: 3, reto_id: 50, titulo: "Quejarte de un error en la orden", banco: {
        palabras: [
       { en: "mistake", es: "error" },
       { en: "this isn't what I ordered", es: "esto no es lo que pedí" },
       { en: "complaint", es: "queja" },
       { en: "wrong order", es: "orden equivocada" },
       { en: "cold food", es: "comida fría" },
       { en: "manager", es: "gerente" },
       { en: "fix it", es: "arreglarlo" },
       { en: "apologize", es: "disculparse" }
        ],
        frases: [
       { en: "Can you tell me more about mistake?", es: "¿Me puedes contar más sobre error?" },
       { en: "I'd like to talk about complaint.", es: "Me gustaría hablar sobre queja." },
       { en: "Do you know anything about cold food?", es: "¿Sabes algo sobre comida fría?" },
       { en: "Can you explain fix it to me, please?", es: "¿Me puedes explicar arreglarlo por favor?" },
       { en: "I want to ask you about mistake.", es: "Quiero preguntarte sobre error." },
       { en: "Let's go over complaint together.", es: "Repasemos queja juntos." }
        ]
       } },
  { id: "z3_r51", zona_id: 3, reto_id: 51, titulo: "Pedir el baño en el restaurante", banco: {
        palabras: [
       { en: "restroom", es: "baño" },
       { en: "where is the restroom", es: "dónde está el baño" },
       { en: "down the stairs", es: "bajando las escaleras" },
       { en: "key", es: "llave" },
       { en: "occupied", es: "ocupado" },
       { en: "sink", es: "lavabo" },
       { en: "hand soap", es: "jabón de manos" },
       { en: "paper towel", es: "toalla de papel" }
        ],
        frases: [
       { en: "Can you tell me more about restroom?", es: "¿Me puedes contar más sobre baño?" },
       { en: "I'd like to talk about down the stairs.", es: "Me gustaría hablar sobre bajando las escaleras." },
       { en: "Do you know anything about occupied?", es: "¿Sabes algo sobre ocupado?" },
       { en: "Can you explain hand soap to me, please?", es: "¿Me puedes explicar jabón de manos por favor?" },
       { en: "I want to ask you about restroom.", es: "Quiero preguntarte sobre baño." },
       { en: "Let's go over down the stairs together.", es: "Repasemos bajando las escaleras juntos." }
        ]
       } },
  { id: "z3_r52", zona_id: 3, reto_id: 52, titulo: "Dejar propina", banco: {
        palabras: [
       { en: "tip", es: "propina" },
       { en: "how much should I tip", es: "cuánto debo dejar de propina" },
       { en: "included", es: "incluido" },
       { en: "service charge", es: "cargo por servicio" },
       { en: "cash tip", es: "propina en efectivo" },
       { en: "generous", es: "generoso" },
       { en: "good service", es: "buen servicio" },
       { en: "thank you", es: "gracias" }
        ],
        frases: [
       { en: "Can you tell me more about tip?", es: "¿Me puedes contar más sobre propina?" },
       { en: "I'd like to talk about included.", es: "Me gustaría hablar sobre incluido." },
       { en: "Do you know anything about cash tip?", es: "¿Sabes algo sobre propina en efectivo?" },
       { en: "Can you explain good service to me, please?", es: "¿Me puedes explicar buen servicio por favor?" },
       { en: "I want to ask you about tip.", es: "Quiero preguntarte sobre propina." },
       { en: "Let's go over included together.", es: "Repasemos incluido juntos." }
        ]
       } },
  { id: "z3_r53", zona_id: 3, reto_id: 53, titulo: "Pedir más pan o servilletas", banco: {
        palabras: [
       { en: "more bread", es: "más pan" },
       { en: "napkin", es: "servilleta" },
       { en: "another one", es: "otro más" },
       { en: "could we get", es: "podríamos tener" },
       { en: "basket", es: "canasta" },
       { en: "please", es: "por favor" },
       { en: "extra plate", es: "plato extra" },
       { en: "more water", es: "más agua" }
        ],
        frases: [
       { en: "Can you tell me more about more bread?", es: "¿Me puedes contar más sobre más pan?" },
       { en: "I'd like to talk about another one.", es: "Me gustaría hablar sobre otro más." },
       { en: "Do you know anything about basket?", es: "¿Sabes algo sobre canasta?" },
       { en: "Can you explain extra plate to me, please?", es: "¿Me puedes explicar plato extra por favor?" },
       { en: "I want to ask you about more bread.", es: "Quiero preguntarte sobre más pan." },
       { en: "Let's go over another one together.", es: "Repasemos otro más juntos." }
        ]
       } },
  { id: "z3_r54", zona_id: 3, reto_id: 54, titulo: "Preguntar si hay vegetariano", banco: {
        palabras: [
       { en: "vegetarian", es: "vegetariano" },
       { en: "vegan", es: "vegano" },
       { en: "meat-free", es: "sin carne" },
       { en: "plant-based", es: "a base de plantas" },
       { en: "options", es: "opciones" },
       { en: "tofu", es: "tofu" },
       { en: "vegetable", es: "verdura" },
       { en: "salad", es: "ensalada" }
        ],
        frases: [
       { en: "Can you tell me more about vegetarian?", es: "¿Me puedes contar más sobre vegetariano?" },
       { en: "I'd like to talk about meat-free.", es: "Me gustaría hablar sobre sin carne." },
       { en: "Do you know anything about options?", es: "¿Sabes algo sobre opciones?" },
       { en: "Can you explain vegetable to me, please?", es: "¿Me puedes explicar verdura por favor?" },
       { en: "I want to ask you about vegetarian.", es: "Quiero preguntarte sobre vegetariano." },
       { en: "Let's go over meat-free together.", es: "Repasemos sin carne juntos." }
        ]
       } },
  { id: "z3_r55", zona_id: 3, reto_id: 55, titulo: "Compartir un platillo", banco: {
        palabras: [
       { en: "share", es: "compartir" },
       { en: "extra plate", es: "plato extra" },
       { en: "split the bill", es: "dividir la cuenta" },
       { en: "for the table", es: "para la mesa" },
       { en: "family style", es: "al estilo familiar" },
       { en: "portion", es: "porción" },
       { en: "divide", es: "dividir" },
       { en: "enough for two", es: "suficiente para dos" }
        ],
        frases: [
       { en: "Can you tell me more about share?", es: "¿Me puedes contar más sobre compartir?" },
       { en: "I'd like to talk about split the bill.", es: "Me gustaría hablar sobre dividir la cuenta." },
       { en: "Do you know anything about family style?", es: "¿Sabes algo sobre al estilo familiar?" },
       { en: "Can you explain divide to me, please?", es: "¿Me puedes explicar dividir por favor?" },
       { en: "I want to ask you about share.", es: "Quiero preguntarte sobre compartir." },
       { en: "Let's go over split the bill together.", es: "Repasemos dividir la cuenta juntos." }
        ]
       } },
  { id: "z3_r56", zona_id: 3, reto_id: 56, titulo: "Pedir postre", banco: {
        palabras: [
       { en: "dessert", es: "postre" },
       { en: "sweet", es: "dulce" },
       { en: "cake", es: "pastel" },
       { en: "ice cream", es: "helado" },
       { en: "fruit", es: "fruta" },
       { en: "chocolate", es: "chocolate" },
       { en: "recommend a dessert", es: "recomendar un postre" },
       { en: "to share", es: "para compartir" }
        ],
        frases: [
       { en: "Can you tell me more about dessert?", es: "¿Me puedes contar más sobre postre?" },
       { en: "I'd like to talk about cake.", es: "Me gustaría hablar sobre pastel." },
       { en: "Do you know anything about fruit?", es: "¿Sabes algo sobre fruta?" },
       { en: "Can you explain recommend a dessert to me, please?", es: "¿Me puedes explicar recomendar un postre por favor?" },
       { en: "I want to ask you about dessert.", es: "Quiero preguntarte sobre postre." },
       { en: "Let's go over cake together.", es: "Repasemos pastel juntos." }
        ]
       } },
  { id: "z3_r57", zona_id: 3, reto_id: 57, titulo: "Hacer un brindis", banco: {
        palabras: [
       { en: "toast", es: "brindis" },
       { en: "cheers", es: "salud" },
       { en: "congratulations", es: "felicidades" },
       { en: "to friendship", es: "a la amistad" },
       { en: "raise your glass", es: "levanten su copa" },
       { en: "celebrate", es: "celebrar" },
       { en: "special occasion", es: "ocasión especial" },
       { en: "together", es: "juntos" }
        ],
        frases: [
       { en: "Can you tell me more about toast?", es: "¿Me puedes contar más sobre brindis?" },
       { en: "I'd like to talk about congratulations.", es: "Me gustaría hablar sobre felicidades." },
       { en: "Do you know anything about raise your glass?", es: "¿Sabes algo sobre levanten su copa?" },
       { en: "Can you explain special occasion to me, please?", es: "¿Me puedes explicar ocasión especial por favor?" },
       { en: "I want to ask you about toast.", es: "Quiero preguntarte sobre brindis." },
       { en: "Let's go over congratulations together.", es: "Repasemos felicidades juntos." }
        ]
       } },
  { id: "z3_r58", zona_id: 3, reto_id: 58, titulo: "Calificar la comida", banco: {
        palabras: [
       { en: "delicious", es: "delicioso" },
       { en: "tasty", es: "sabroso" },
       { en: "fresh", es: "fresco" },
       { en: "too salty", es: "muy salado" },
       { en: "perfectly cooked", es: "perfectamente cocinado" },
       { en: "disappointing", es: "decepcionante" },
       { en: "amazing", es: "increíble" },
       { en: "would recommend", es: "lo recomendaría" }
        ],
        frases: [
       { en: "Can you tell me more about delicious?", es: "¿Me puedes contar más sobre delicioso?" },
       { en: "I'd like to talk about fresh.", es: "Me gustaría hablar sobre fresco." },
       { en: "Do you know anything about perfectly cooked?", es: "¿Sabes algo sobre perfectamente cocinado?" },
       { en: "Can you explain amazing to me, please?", es: "¿Me puedes explicar increíble por favor?" },
       { en: "I want to ask you about delicious.", es: "Quiero preguntarte sobre delicioso." },
       { en: "Let's go over fresh together.", es: "Repasemos fresco juntos." }
        ]
       } },
  { id: "z3_r59", zona_id: 3, reto_id: 59, titulo: "Pedir la mesa de siempre", banco: {
        palabras: [
       { en: "usual table", es: "mesa de siempre" },
       { en: "regular customer", es: "cliente habitual" },
       { en: "same as always", es: "lo mismo de siempre" },
       { en: "the usual", es: "lo de siempre" },
       { en: "favorite spot", es: "lugar favorito" },
       { en: "reserved", es: "reservado" },
       { en: "corner table", es: "mesa de la esquina" },
       { en: "quiet area", es: "área tranquila" }
        ],
        frases: [
       { en: "Can you tell me more about usual table?", es: "¿Me puedes contar más sobre mesa de siempre?" },
       { en: "I'd like to talk about same as always.", es: "Me gustaría hablar sobre lo mismo de siempre." },
       { en: "Do you know anything about favorite spot?", es: "¿Sabes algo sobre lugar favorito?" },
       { en: "Can you explain corner table to me, please?", es: "¿Me puedes explicar mesa de la esquina por favor?" },
       { en: "I want to ask you about usual table.", es: "Quiero preguntarte sobre mesa de siempre." },
       { en: "Let's go over same as always together.", es: "Repasemos lo mismo de siempre juntos." }
        ]
       } },
  { id: "z3_r60", zona_id: 3, reto_id: 60, titulo: "Repaso: comer afuera", banco: {
        palabras: [
       { en: "menu", es: "menú" },
       { en: "order", es: "orden" },
       { en: "bill", es: "cuenta" },
       { en: "waiter", es: "mesero" },
       { en: "delicious", es: "delicioso" },
       { en: "table", es: "mesa" },
       { en: "drink", es: "bebida" },
       { en: "dessert", es: "postre" }
        ],
        frases: [
       { en: "Can you tell me more about menu?", es: "¿Me puedes contar más sobre menú?" },
       { en: "I'd like to talk about bill.", es: "Me gustaría hablar sobre cuenta." },
       { en: "Do you know anything about delicious?", es: "¿Sabes algo sobre delicioso?" },
       { en: "Can you explain drink to me, please?", es: "¿Me puedes explicar bebida por favor?" },
       { en: "I want to ask you about menu.", es: "Quiero preguntarte sobre menú." },
       { en: "Let's go over bill together.", es: "Repasemos cuenta juntos." }
        ]
       } },
  { id: "boleto", zona_id: 4, reto_id: 61, titulo: "Comprar un boleto de avión", banco: {
        palabras: [
       { en: "ticket", es: "boleto" },
       { en: "one-way", es: "de ida" },
       { en: "round-trip", es: "ida y vuelta" },
       { en: "flight", es: "vuelo" },
       { en: "seat", es: "asiento" },
       { en: "window", es: "ventana" },
       { en: "aisle", es: "pasillo" },
       { en: "luggage", es: "equipaje" }
        ],
        frases: [
       { en: "I'd like a one-way ticket to Chicago, please.", es: "Quisiera un boleto sencillo a Chicago, por favor." },
       { en: "A one-way ticket, please.", es: "Un boleto de ida, por favor." },
       { en: "Can I get a window seat?", es: "¿Me da un asiento de ventana?" },
       { en: "I'd prefer an aisle seat.", es: "Prefiero un asiento de pasillo." },
       { en: "How much is a round-trip flight?", es: "¿Cuánto cuesta un vuelo de ida y vuelta?" },
       { en: "I only have one piece of luggage.", es: "Solo tengo una maleta." }
        ]
       } },
  { id: "aeropuerto", zona_id: 4, reto_id: 62, titulo: "En el aeropuerto", banco: {
        palabras: [
       { en: "gate", es: "puerta de embarque" },
       { en: "boarding", es: "abordaje" },
       { en: "passport", es: "pasaporte" },
       { en: "luggage", es: "equipaje" },
       { en: "delay", es: "retraso" },
       { en: "security", es: "seguridad" },
       { en: "arrival", es: "llegada" },
       { en: "departure", es: "salida" }
        ],
        frases: [
       { en: "Flight 204 is now boarding at gate twelve.", es: "El vuelo 204 ya está abordando en la puerta doce." },
       { en: "Where is my gate?", es: "¿Dónde está mi puerta de embarque?" },
       { en: "Here's my passport.", es: "Aquí está mi pasaporte." },
       { en: "Is there a delay?", es: "¿Hay algún retraso?" },
       { en: "Where is security?", es: "¿Dónde está seguridad?" },
       { en: "What time is the departure?", es: "¿A qué hora es la salida?" }
        ]
       } },
  { id: "z4_r63", zona_id: 4, reto_id: 63, titulo: "Registrarte en el hotel", banco: {
        palabras: [
       { en: "check-in", es: "registro" },
       { en: "reservation", es: "reservación" },
       { en: "ID", es: "identificación" },
       { en: "key card", es: "tarjeta llave" },
       { en: "room number", es: "número de habitación" },
       { en: "front desk", es: "recepción" },
       { en: "confirmation", es: "confirmación" },
       { en: "deposit", es: "depósito" }
        ],
        frases: [
       { en: "Can you tell me more about check-in?", es: "¿Me puedes contar más sobre registro?" },
       { en: "I'd like to talk about ID.", es: "Me gustaría hablar sobre identificación." },
       { en: "Do you know anything about room number?", es: "¿Sabes algo sobre número de habitación?" },
       { en: "Can you explain confirmation to me, please?", es: "¿Me puedes explicar confirmación por favor?" },
       { en: "I want to ask you about check-in.", es: "Quiero preguntarte sobre registro." },
       { en: "Let's go over ID together.", es: "Repasemos identificación juntos." }
        ]
       } },
  { id: "z4_r64", zona_id: 4, reto_id: 64, titulo: "Pedir una habitación distinta", banco: {
        palabras: [
       { en: "different room", es: "otra habitación" },
       { en: "quiet room", es: "habitación tranquila" },
       { en: "higher floor", es: "piso más alto" },
       { en: "ocean view", es: "vista al mar" },
       { en: "non-smoking", es: "no fumar" },
       { en: "upgrade", es: "mejora" },
       { en: "available", es: "disponible" },
       { en: "change rooms", es: "cambiar de habitación" }
        ],
        frases: [
       { en: "Can you tell me more about different room?", es: "¿Me puedes contar más sobre otra habitación?" },
       { en: "I'd like to talk about higher floor.", es: "Me gustaría hablar sobre piso más alto." },
       { en: "Do you know anything about non-smoking?", es: "¿Sabes algo sobre no fumar?" },
       { en: "Can you explain available to me, please?", es: "¿Me puedes explicar disponible por favor?" },
       { en: "I want to ask you about different room.", es: "Quiero preguntarte sobre otra habitación." },
       { en: "Let's go over higher floor together.", es: "Repasemos piso más alto juntos." }
        ]
       } },
  { id: "z4_r65", zona_id: 4, reto_id: 65, titulo: "Preguntar por el desayuno incluido", banco: {
        palabras: [
       { en: "breakfast included", es: "desayuno incluido" },
       { en: "buffet", es: "bufet" },
       { en: "what time", es: "a qué hora" },
       { en: "continental breakfast", es: "desayuno continental" },
       { en: "extra charge", es: "cargo extra" },
       { en: "dining room", es: "comedor" },
       { en: "room service", es: "servicio a la habitación" },
       { en: "coffee shop", es: "cafetería" }
        ],
        frases: [
       { en: "Can you tell me more about breakfast included?", es: "¿Me puedes contar más sobre desayuno incluido?" },
       { en: "I'd like to talk about what time.", es: "Me gustaría hablar sobre a qué hora." },
       { en: "Do you know anything about extra charge?", es: "¿Sabes algo sobre cargo extra?" },
       { en: "Can you explain room service to me, please?", es: "¿Me puedes explicar servicio a la habitación por favor?" },
       { en: "I want to ask you about breakfast included.", es: "Quiero preguntarte sobre desayuno incluido." },
       { en: "Let's go over what time together.", es: "Repasemos a qué hora juntos." }
        ]
       } },
  { id: "z4_r66", zona_id: 4, reto_id: 66, titulo: "Pedir el checkout tardío", banco: {
        palabras: [
       { en: "late checkout", es: "checkout tardío" },
       { en: "what time is checkout", es: "a qué hora es el checkout" },
       { en: "extra fee", es: "cargo extra" },
       { en: "extend", es: "extender" },
       { en: "luggage storage", es: "guardar equipaje" },
       { en: "until noon", es: "hasta mediodía" },
       { en: "request", es: "solicitar" },
       { en: "availability", es: "disponibilidad" }
        ],
        frases: [
       { en: "Can you tell me more about late checkout?", es: "¿Me puedes contar más sobre checkout tardío?" },
       { en: "I'd like to talk about extra fee.", es: "Me gustaría hablar sobre cargo extra." },
       { en: "Do you know anything about luggage storage?", es: "¿Sabes algo sobre guardar equipaje?" },
       { en: "Can you explain request to me, please?", es: "¿Me puedes explicar solicitar por favor?" },
       { en: "I want to ask you about late checkout.", es: "Quiero preguntarte sobre checkout tardío." },
       { en: "Let's go over extra fee together.", es: "Repasemos cargo extra juntos." }
        ]
       } },
  { id: "z4_r67", zona_id: 4, reto_id: 67, titulo: "Reportar un problema en la habitación", banco: {
        palabras: [
       { en: "broken", es: "descompuesto" },
       { en: "doesn't work", es: "no funciona" },
       { en: "air conditioning", es: "aire acondicionado" },
       { en: "no hot water", es: "no hay agua caliente" },
       { en: "noisy", es: "ruidoso" },
       { en: "maintenance", es: "mantenimiento" },
       { en: "fix", es: "arreglar" },
       { en: "move rooms", es: "cambiar de cuarto" }
        ],
        frases: [
       { en: "Can you tell me more about broken?", es: "¿Me puedes contar más sobre descompuesto?" },
       { en: "I'd like to talk about air conditioning.", es: "Me gustaría hablar sobre aire acondicionado." },
       { en: "Do you know anything about noisy?", es: "¿Sabes algo sobre ruidoso?" },
       { en: "Can you explain fix to me, please?", es: "¿Me puedes explicar arreglar por favor?" },
       { en: "I want to ask you about broken.", es: "Quiero preguntarte sobre descompuesto." },
       { en: "Let's go over air conditioning together.", es: "Repasemos aire acondicionado juntos." }
        ]
       } },
  { id: "z4_r68", zona_id: 4, reto_id: 68, titulo: "Pedir una toalla extra", banco: {
        palabras: [
       { en: "towel", es: "toalla" },
       { en: "extra towel", es: "toalla extra" },
       { en: "housekeeping", es: "limpieza" },
       { en: "fresh sheets", es: "sábanas limpias" },
       { en: "pillow", es: "almohada" },
       { en: "blanket", es: "cobija" },
       { en: "soap", es: "jabón" },
       { en: "bring to the room", es: "traer a la habitación" }
        ],
        frases: [
       { en: "Can you tell me more about towel?", es: "¿Me puedes contar más sobre toalla?" },
       { en: "I'd like to talk about housekeeping.", es: "Me gustaría hablar sobre limpieza." },
       { en: "Do you know anything about pillow?", es: "¿Sabes algo sobre almohada?" },
       { en: "Can you explain soap to me, please?", es: "¿Me puedes explicar jabón por favor?" },
       { en: "I want to ask you about towel.", es: "Quiero preguntarte sobre toalla." },
       { en: "Let's go over housekeeping together.", es: "Repasemos limpieza juntos." }
        ]
       } },
  { id: "z4_r69", zona_id: 4, reto_id: 69, titulo: "Preguntar por el wifi", banco: {
        palabras: [
       { en: "wifi", es: "wifi" },
       { en: "password", es: "contraseña" },
       { en: "network name", es: "nombre de la red" },
       { en: "connection", es: "conexión" },
       { en: "free wifi", es: "wifi gratis" },
       { en: "slow", es: "lento" },
       { en: "not working", es: "no funciona" },
       { en: "signal", es: "señal" }
        ],
        frases: [
       { en: "Can you tell me more about wifi?", es: "¿Me puedes contar más sobre wifi?" },
       { en: "I'd like to talk about network name.", es: "Me gustaría hablar sobre nombre de la red." },
       { en: "Do you know anything about free wifi?", es: "¿Sabes algo sobre wifi gratis?" },
       { en: "Can you explain not working to me, please?", es: "¿Me puedes explicar no funciona por favor?" },
       { en: "I want to ask you about wifi.", es: "Quiero preguntarte sobre wifi." },
       { en: "Let's go over network name together.", es: "Repasemos nombre de la red juntos." }
        ]
       } },
  { id: "z4_r70", zona_id: 4, reto_id: 70, titulo: "Guardar el equipaje", banco: {
        palabras: [
       { en: "luggage storage", es: "guardar equipaje" },
       { en: "bellhop", es: "botones" },
       { en: "suitcase", es: "maleta" },
       { en: "claim ticket", es: "ticket de reclamo" },
       { en: "until what time", es: "hasta qué hora" },
       { en: "safe", es: "seguro" },
       { en: "tag", es: "etiqueta" },
       { en: "pick up later", es: "recoger más tarde" }
        ],
        frases: [
       { en: "Can you tell me more about luggage storage?", es: "¿Me puedes contar más sobre guardar equipaje?" },
       { en: "I'd like to talk about suitcase.", es: "Me gustaría hablar sobre maleta." },
       { en: "Do you know anything about until what time?", es: "¿Sabes algo sobre hasta qué hora?" },
       { en: "Can you explain tag to me, please?", es: "¿Me puedes explicar etiqueta por favor?" },
       { en: "I want to ask you about luggage storage.", es: "Quiero preguntarte sobre guardar equipaje." },
       { en: "Let's go over suitcase together.", es: "Repasemos maleta juntos." }
        ]
       } },
  { id: "z4_r71", zona_id: 4, reto_id: 71, titulo: "Pedir una llamada para despertar", banco: {
        palabras: [
       { en: "wake-up call", es: "llamada para despertar" },
       { en: "what time", es: "a qué hora" },
       { en: "front desk", es: "recepción" },
       { en: "alarm", es: "alarma" },
       { en: "early flight", es: "vuelo temprano" },
       { en: "remind", es: "recordar" },
       { en: "set for", es: "programar para" },
       { en: "confirm", es: "confirmar" }
        ],
        frases: [
       { en: "Can you tell me more about wake-up call?", es: "¿Me puedes contar más sobre llamada para despertar?" },
       { en: "I'd like to talk about front desk.", es: "Me gustaría hablar sobre recepción." },
       { en: "Do you know anything about early flight?", es: "¿Sabes algo sobre vuelo temprano?" },
       { en: "Can you explain set for to me, please?", es: "¿Me puedes explicar programar para por favor?" },
       { en: "I want to ask you about wake-up call.", es: "Quiero preguntarte sobre llamada para despertar." },
       { en: "Let's go over front desk together.", es: "Repasemos recepción juntos." }
        ]
       } },
  { id: "z4_r72", zona_id: 4, reto_id: 72, titulo: "Extender tu estadía", banco: {
        palabras: [
       { en: "extend my stay", es: "extender mi estadía" },
       { en: "one more night", es: "una noche más" },
       { en: "availability", es: "disponibilidad" },
       { en: "same room", es: "mismo cuarto" },
       { en: "additional cost", es: "costo adicional" },
       { en: "checkout date", es: "fecha de salida" },
       { en: "confirm", es: "confirmar" },
       { en: "booking", es: "reservación" }
        ],
        frases: [
       { en: "Can you tell me more about extend my stay?", es: "¿Me puedes contar más sobre extender mi estadía?" },
       { en: "I'd like to talk about availability.", es: "Me gustaría hablar sobre disponibilidad." },
       { en: "Do you know anything about additional cost?", es: "¿Sabes algo sobre costo adicional?" },
       { en: "Can you explain confirm to me, please?", es: "¿Me puedes explicar confirmar por favor?" },
       { en: "I want to ask you about extend my stay.", es: "Quiero preguntarte sobre extender mi estadía." },
       { en: "Let's go over availability together.", es: "Repasemos disponibilidad juntos." }
        ]
       } },
  { id: "z4_r73", zona_id: 4, reto_id: 73, titulo: "Cambiar de vuelo", banco: {
        palabras: [
       { en: "change flight", es: "cambiar de vuelo" },
       { en: "fee", es: "cargo" },
       { en: "next available", es: "el siguiente disponible" },
       { en: "flight number", es: "número de vuelo" },
       { en: "reschedule", es: "reprogramar" },
       { en: "earlier flight", es: "vuelo más temprano" },
       { en: "later flight", es: "vuelo más tarde" },
       { en: "confirmation email", es: "correo de confirmación" }
        ],
        frases: [
       { en: "Can you tell me more about change flight?", es: "¿Me puedes contar más sobre cambiar de vuelo?" },
       { en: "I'd like to talk about next available.", es: "Me gustaría hablar sobre el siguiente disponible." },
       { en: "Do you know anything about reschedule?", es: "¿Sabes algo sobre reprogramar?" },
       { en: "Can you explain later flight to me, please?", es: "¿Me puedes explicar vuelo más tarde por favor?" },
       { en: "I want to ask you about change flight.", es: "Quiero preguntarte sobre cambiar de vuelo." },
       { en: "Let's go over next available together.", es: "Repasemos el siguiente disponible juntos." }
        ]
       } },
  { id: "z4_r74", zona_id: 4, reto_id: 74, titulo: "Pasar por aduana", banco: {
        palabras: [
       { en: "customs", es: "aduana" },
       { en: "declare", es: "declarar" },
       { en: "nothing to declare", es: "nada que declarar" },
       { en: "passport", es: "pasaporte" },
       { en: "form", es: "formulario" },
       { en: "luggage inspection", es: "inspección de equipaje" },
       { en: "duty-free", es: "libre de impuestos" },
       { en: "visa", es: "visa" }
        ],
        frases: [
       { en: "Can you tell me more about customs?", es: "¿Me puedes contar más sobre aduana?" },
       { en: "I'd like to talk about nothing to declare.", es: "Me gustaría hablar sobre nada que declarar." },
       { en: "Do you know anything about form?", es: "¿Sabes algo sobre formulario?" },
       { en: "Can you explain duty-free to me, please?", es: "¿Me puedes explicar libre de impuestos por favor?" },
       { en: "I want to ask you about customs.", es: "Quiero preguntarte sobre aduana." },
       { en: "Let's go over nothing to declare together.", es: "Repasemos nada que declarar juntos." }
        ]
       } },
  { id: "z4_r75", zona_id: 4, reto_id: 75, titulo: "Pedir un mapa turístico", banco: {
        palabras: [
       { en: "tourist map", es: "mapa turístico" },
       { en: "tourist office", es: "oficina de turismo" },
       { en: "attractions", es: "atracciones" },
       { en: "brochure", es: "folleto" },
       { en: "recommend places", es: "recomendar lugares" },
       { en: "walking tour", es: "recorrido a pie" },
       { en: "must-see", es: "imprescindible" },
       { en: "free map", es: "mapa gratis" }
        ],
        frases: [
       { en: "Can you tell me more about tourist map?", es: "¿Me puedes contar más sobre mapa turístico?" },
       { en: "I'd like to talk about attractions.", es: "Me gustaría hablar sobre atracciones." },
       { en: "Do you know anything about recommend places?", es: "¿Sabes algo sobre recomendar lugares?" },
       { en: "Can you explain must-see to me, please?", es: "¿Me puedes explicar imprescindible por favor?" },
       { en: "I want to ask you about tourist map.", es: "Quiero preguntarte sobre mapa turístico." },
       { en: "Let's go over attractions together.", es: "Repasemos atracciones juntos." }
        ]
       } },
  { id: "z4_r76", zona_id: 4, reto_id: 76, titulo: "Reservar un tour", banco: {
        palabras: [
       { en: "tour", es: "recorrido" },
       { en: "book a tour", es: "reservar un tour" },
       { en: "guide", es: "guía" },
       { en: "group tour", es: "tour en grupo" },
       { en: "private tour", es: "tour privado" },
       { en: "duration", es: "duración" },
       { en: "meeting point", es: "punto de encuentro" },
       { en: "price per person", es: "precio por persona" }
        ],
        frases: [
       { en: "Can you tell me more about tour?", es: "¿Me puedes contar más sobre recorrido?" },
       { en: "I'd like to talk about guide.", es: "Me gustaría hablar sobre guía." },
       { en: "Do you know anything about private tour?", es: "¿Sabes algo sobre tour privado?" },
       { en: "Can you explain meeting point to me, please?", es: "¿Me puedes explicar punto de encuentro por favor?" },
       { en: "I want to ask you about tour.", es: "Quiero preguntarte sobre recorrido." },
       { en: "Let's go over guide together.", es: "Repasemos guía juntos." }
        ]
       } },
  { id: "z4_r77", zona_id: 4, reto_id: 77, titulo: "Preguntar por el clima del destino", banco: {
        palabras: [
       { en: "weather forecast", es: "pronóstico del clima" },
       { en: "what's it like there", es: "cómo es el clima allá" },
       { en: "pack for", es: "empacar para" },
       { en: "rainy season", es: "temporada de lluvias" },
       { en: "temperature", es: "temperatura" },
       { en: "humid", es: "húmedo" },
       { en: "sunny", es: "soleado" },
       { en: "bring a jacket", es: "traer una chamarra" }
        ],
        frases: [
       { en: "Can you tell me more about weather forecast?", es: "¿Me puedes contar más sobre pronóstico del clima?" },
       { en: "I'd like to talk about pack for.", es: "Me gustaría hablar sobre empacar para." },
       { en: "Do you know anything about temperature?", es: "¿Sabes algo sobre temperatura?" },
       { en: "Can you explain sunny to me, please?", es: "¿Me puedes explicar soleado por favor?" },
       { en: "I want to ask you about weather forecast.", es: "Quiero preguntarte sobre pronóstico del clima." },
       { en: "Let's go over pack for together.", es: "Repasemos empacar para juntos." }
        ]
       } },
  { id: "z4_r78", zona_id: 4, reto_id: 78, titulo: "Hacer el check-in en línea", banco: {
        palabras: [
       { en: "online check-in", es: "check-in en línea" },
       { en: "boarding pass", es: "pase de abordar" },
       { en: "select seat", es: "elegir asiento" },
       { en: "confirmation number", es: "número de confirmación" },
       { en: "print", es: "imprimir" },
       { en: "mobile boarding pass", es: "pase de abordar móvil" },
       { en: "deadline", es: "fecha límite" },
       { en: "website", es: "sitio web" }
        ],
        frases: [
       { en: "Can you tell me more about online check-in?", es: "¿Me puedes contar más sobre check-in en línea?" },
       { en: "I'd like to talk about select seat.", es: "Me gustaría hablar sobre elegir asiento." },
       { en: "Do you know anything about print?", es: "¿Sabes algo sobre imprimir?" },
       { en: "Can you explain deadline to me, please?", es: "¿Me puedes explicar fecha límite por favor?" },
       { en: "I want to ask you about online check-in.", es: "Quiero preguntarte sobre check-in en línea." },
       { en: "Let's go over select seat together.", es: "Repasemos elegir asiento juntos." }
        ]
       } },
  { id: "z4_r79", zona_id: 4, reto_id: 79, titulo: "Perder el vuelo", banco: {
        palabras: [
       { en: "miss the flight", es: "perder el vuelo" },
       { en: "rebook", es: "reprogramar" },
       { en: "next flight", es: "siguiente vuelo" },
       { en: "stand by", es: "lista de espera" },
       { en: "airline counter", es: "mostrador de la aerolínea" },
       { en: "fee", es: "cargo" },
       { en: "apologize", es: "disculparse" },
       { en: "delay", es: "retraso" }
        ],
        frases: [
       { en: "Can you tell me more about miss the flight?", es: "¿Me puedes contar más sobre perder el vuelo?" },
       { en: "I'd like to talk about next flight.", es: "Me gustaría hablar sobre siguiente vuelo." },
       { en: "Do you know anything about airline counter?", es: "¿Sabes algo sobre mostrador de la aerolínea?" },
       { en: "Can you explain apologize to me, please?", es: "¿Me puedes explicar disculparse por favor?" },
       { en: "I want to ask you about miss the flight.", es: "Quiero preguntarte sobre perder el vuelo." },
       { en: "Let's go over next flight together.", es: "Repasemos siguiente vuelo juntos." }
        ]
       } },
  { id: "z4_r80", zona_id: 4, reto_id: 80, titulo: "Repaso: viajar y hospedarte", banco: {
        palabras: [
       { en: "ticket", es: "boleto" },
       { en: "hotel", es: "hotel" },
       { en: "room", es: "habitación" },
       { en: "passport", es: "pasaporte" },
       { en: "luggage", es: "equipaje" },
       { en: "reservation", es: "reservación" },
       { en: "checkout", es: "checkout" },
       { en: "flight", es: "vuelo" }
        ],
        frases: [
       { en: "Can you tell me more about ticket?", es: "¿Me puedes contar más sobre boleto?" },
       { en: "I'd like to talk about room.", es: "Me gustaría hablar sobre habitación." },
       { en: "Do you know anything about luggage?", es: "¿Sabes algo sobre equipaje?" },
       { en: "Can you explain checkout to me, please?", es: "¿Me puedes explicar checkout por favor?" },
       { en: "I want to ask you about ticket.", es: "Quiero preguntarte sobre boleto." },
       { en: "Let's go over room together.", es: "Repasemos habitación juntos." }
        ]
       } },
  { id: "saludos", zona_id: 5, reto_id: 81, titulo: "Saludos rápidos", banco: {
        palabras: [
       { en: "long time no see", es: "tanto tiempo" },
       { en: "how's it going", es: "cómo te va" },
       { en: "take care", es: "cuídate" },
       { en: "see you", es: "nos vemos" },
       { en: "hello", es: "hola" },
       { en: "goodbye", es: "adiós" },
       { en: "morning", es: "mañana" },
       { en: "evening", es: "tarde / noche" }
        ],
        frases: [
       { en: "Hey! Long time no see.", es: "¡Hey! Tanto tiempo sin verte." },
       { en: "How's it going?", es: "¿Cómo te va?" },
       { en: "Take care, see you soon!", es: "¡Cuídate, nos vemos pronto!" },
       { en: "Good morning, everyone.", es: "Buenos días a todos." },
       { en: "Good evening!", es: "¡Buenas tardes!" },
       { en: "See you tomorrow.", es: "Nos vemos mañana." }
        ]
       } },
  { id: "presentarte", zona_id: 5, reto_id: 82, titulo: "Presentarte", banco: {
        palabras: [
       { en: "nice to meet you", es: "mucho gusto" },
       { en: "I'm from", es: "soy de" },
       { en: "what's your name", es: "cómo te llamas" },
       { en: "this is", es: "te presento a" },
       { en: "name", es: "nombre" },
       { en: "friend", es: "amigo" },
       { en: "work", es: "trabajo" },
       { en: "live", es: "vivir" }
        ],
        frases: [
       { en: "Hi, I'm {n}. Nice to meet you.", es: "Hola, soy {n}. Mucho gusto." },
       { en: "Nice to meet you.", es: "Mucho gusto." },
       { en: "What's your name?", es: "¿Cómo te llamas?" },
       { en: "I'm from Mexico.", es: "Soy de México." },
       { en: "This is my friend.", es: "Te presento a mi amigo." },
       { en: "Where do you live?", es: "¿Dónde vives?" }
        ]
       } },
  { id: "z5_r83", zona_id: 5, reto_id: 83, titulo: "Presentar a un amigo", banco: {
        palabras: [
       { en: "this is my friend", es: "este es mi amigo" },
       { en: "meet", es: "conocer" },
       { en: "let me introduce you", es: "déjame presentarte" },
       { en: "have you met", es: "ya conociste a" },
       { en: "classmate", es: "compañero de clase" },
       { en: "neighbor", es: "vecino" },
       { en: "coworker", es: "compañero de trabajo" },
       { en: "nice to finally meet you", es: "por fin un placer conocerte" }
        ],
        frases: [
       { en: "Can you tell me more about this is my friend?", es: "¿Me puedes contar más sobre este es mi amigo?" },
       { en: "I'd like to talk about let me introduce you.", es: "Me gustaría hablar sobre déjame presentarte." },
       { en: "Do you know anything about classmate?", es: "¿Sabes algo sobre compañero de clase?" },
       { en: "Can you explain coworker to me, please?", es: "¿Me puedes explicar compañero de trabajo por favor?" },
       { en: "I want to ask you about this is my friend.", es: "Quiero preguntarte sobre este es mi amigo." },
       { en: "Let's go over let me introduce you together.", es: "Repasemos déjame presentarte juntos." }
        ]
       } },
  { id: "z5_r84", zona_id: 5, reto_id: 84, titulo: "Invitar a alguien a salir", banco: {
        palabras: [
       { en: "would you like to", es: "te gustaría" },
       { en: "get coffee", es: "tomar un café" },
       { en: "are you free", es: "estás libre" },
       { en: "this weekend", es: "este fin de semana" },
       { en: "hang out", es: "salir a pasar el rato" },
       { en: "movie", es: "película" },
       { en: "plans", es: "planes" },
       { en: "let's go", es: "vamos" }
        ],
        frases: [
       { en: "Can you tell me more about would you like to?", es: "¿Me puedes contar más sobre te gustaría?" },
       { en: "I'd like to talk about are you free.", es: "Me gustaría hablar sobre estás libre." },
       { en: "Do you know anything about hang out?", es: "¿Sabes algo sobre salir a pasar el rato?" },
       { en: "Can you explain plans to me, please?", es: "¿Me puedes explicar planes por favor?" },
       { en: "I want to ask you about would you like to.", es: "Quiero preguntarte sobre te gustaría." },
       { en: "Let's go over are you free together.", es: "Repasemos estás libre juntos." }
        ]
       } },
  { id: "z5_r85", zona_id: 5, reto_id: 85, titulo: "Aceptar o rechazar una invitación", banco: {
        palabras: [
       { en: "I'd love to", es: "me encantaría" },
       { en: "sounds great", es: "suena genial" },
       { en: "I can't make it", es: "no voy a poder" },
       { en: "maybe next time", es: "tal vez la próxima" },
       { en: "I'm busy that day", es: "estoy ocupado ese día" },
       { en: "count me in", es: "cuenta conmigo" },
       { en: "rain check", es: "para otra ocasión" },
       { en: "thanks for the invite", es: "gracias por invitarme" }
        ],
        frases: [
       { en: "Can you tell me more about I'd love to?", es: "¿Me puedes contar más sobre me encantaría?" },
       { en: "I'd like to talk about I can't make it.", es: "Me gustaría hablar sobre no voy a poder." },
       { en: "Do you know anything about I'm busy that day?", es: "¿Sabes algo sobre estoy ocupado ese día?" },
       { en: "Can you explain rain check to me, please?", es: "¿Me puedes explicar para otra ocasión por favor?" },
       { en: "I want to ask you about I'd love to.", es: "Quiero preguntarte sobre me encantaría." },
       { en: "Let's go over I can't make it together.", es: "Repasemos no voy a poder juntos." }
        ]
       } },
  { id: "z5_r86", zona_id: 5, reto_id: 86, titulo: "Hacer un cumplido", banco: {
        palabras: [
       { en: "compliment", es: "cumplido" },
       { en: "you look great", es: "te ves genial" },
       { en: "nice shirt", es: "bonita camisa" },
       { en: "great job", es: "buen trabajo" },
       { en: "I love your", es: "me encanta tu" },
       { en: "talented", es: "talentoso" },
       { en: "thank you so much", es: "muchas gracias" },
       { en: "that's so kind", es: "qué amable" }
        ],
        frases: [
       { en: "Can you tell me more about compliment?", es: "¿Me puedes contar más sobre cumplido?" },
       { en: "I'd like to talk about nice shirt.", es: "Me gustaría hablar sobre bonita camisa." },
       { en: "Do you know anything about I love your?", es: "¿Sabes algo sobre me encanta tu?" },
       { en: "Can you explain thank you so much to me, please?", es: "¿Me puedes explicar muchas gracias por favor?" },
       { en: "I want to ask you about compliment.", es: "Quiero preguntarte sobre cumplido." },
       { en: "Let's go over nice shirt together.", es: "Repasemos bonita camisa juntos." }
        ]
       } },
  { id: "z5_r87", zona_id: 5, reto_id: 87, titulo: "Hablar de tu familia", banco: {
        palabras: [
       { en: "family", es: "familia" },
       { en: "brother", es: "hermano" },
       { en: "sister", es: "hermana" },
       { en: "parents", es: "padres" },
       { en: "children", es: "hijos" },
       { en: "married", es: "casado" },
       { en: "how many siblings", es: "cuántos hermanos" },
       { en: "close family", es: "familia unida" }
        ],
        frases: [
       { en: "Can you tell me more about family?", es: "¿Me puedes contar más sobre familia?" },
       { en: "I'd like to talk about sister.", es: "Me gustaría hablar sobre hermana." },
       { en: "Do you know anything about children?", es: "¿Sabes algo sobre hijos?" },
       { en: "Can you explain how many siblings to me, please?", es: "¿Me puedes explicar cuántos hermanos por favor?" },
       { en: "I want to ask you about family.", es: "Quiero preguntarte sobre familia." },
       { en: "Let's go over sister together.", es: "Repasemos hermana juntos." }
        ]
       } },
  { id: "z5_r88", zona_id: 5, reto_id: 88, titulo: "Hablar de tus pasatiempos", banco: {
        palabras: [
       { en: "hobby", es: "pasatiempo" },
       { en: "free time", es: "tiempo libre" },
       { en: "I enjoy", es: "disfruto" },
       { en: "reading", es: "leer" },
       { en: "playing sports", es: "practicar deportes" },
       { en: "painting", es: "pintar" },
       { en: "what do you like to do", es: "qué te gusta hacer" },
       { en: "favorite activity", es: "actividad favorita" }
        ],
        frases: [
       { en: "Can you tell me more about hobby?", es: "¿Me puedes contar más sobre pasatiempo?" },
       { en: "I'd like to talk about I enjoy.", es: "Me gustaría hablar sobre disfruto." },
       { en: "Do you know anything about playing sports?", es: "¿Sabes algo sobre practicar deportes?" },
       { en: "Can you explain what do you like to do to me, please?", es: "¿Me puedes explicar qué te gusta hacer por favor?" },
       { en: "I want to ask you about hobby.", es: "Quiero preguntarte sobre pasatiempo." },
       { en: "Let's go over I enjoy together.", es: "Repasemos disfruto juntos." }
        ]
       } },
  { id: "z5_r89", zona_id: 5, reto_id: 89, titulo: "Intercambiar contactos", banco: {
        palabras: [
       { en: "phone number", es: "número de teléfono" },
       { en: "can I get your number", es: "me das tu número" },
       { en: "let's stay in touch", es: "mantengámonos en contacto" },
       { en: "add me", es: "agrégame" },
       { en: "social media", es: "redes sociales" },
       { en: "email address", es: "correo electrónico" },
       { en: "contact info", es: "información de contacto" },
       { en: "text me", es: "mándame mensaje" }
        ],
        frases: [
       { en: "Can you tell me more about phone number?", es: "¿Me puedes contar más sobre número de teléfono?" },
       { en: "I'd like to talk about let's stay in touch.", es: "Me gustaría hablar sobre mantengámonos en contacto." },
       { en: "Do you know anything about social media?", es: "¿Sabes algo sobre redes sociales?" },
       { en: "Can you explain contact info to me, please?", es: "¿Me puedes explicar información de contacto por favor?" },
       { en: "I want to ask you about phone number.", es: "Quiero preguntarte sobre número de teléfono." },
       { en: "Let's go over let's stay in touch together.", es: "Repasemos mantengámonos en contacto juntos." }
        ]
       } },
  { id: "z5_r90", zona_id: 5, reto_id: 90, titulo: "Hacer planes para el fin de semana", banco: {
        palabras: [
       { en: "weekend plans", es: "planes de fin de semana" },
       { en: "any plans", es: "algún plan" },
       { en: "let's meet up", es: "juntémonos" },
       { en: "Saturday", es: "sábado" },
       { en: "Sunday", es: "domingo" },
       { en: "what time works", es: "qué hora te funciona" },
       { en: "where should we meet", es: "dónde nos vemos" },
       { en: "sounds good", es: "suena bien" }
        ],
        frases: [
       { en: "Can you tell me more about weekend plans?", es: "¿Me puedes contar más sobre planes de fin de semana?" },
       { en: "I'd like to talk about let's meet up.", es: "Me gustaría hablar sobre juntémonos." },
       { en: "Do you know anything about Sunday?", es: "¿Sabes algo sobre domingo?" },
       { en: "Can you explain where should we meet to me, please?", es: "¿Me puedes explicar dónde nos vemos por favor?" },
       { en: "I want to ask you about weekend plans.", es: "Quiero preguntarte sobre planes de fin de semana." },
       { en: "Let's go over let's meet up together.", es: "Repasemos juntémonos juntos." }
        ]
       } },
  { id: "z5_r91", zona_id: 5, reto_id: 91, titulo: "Felicitar a alguien", banco: {
        palabras: [
       { en: "congratulations", es: "felicidades" },
       { en: "well deserved", es: "bien merecido" },
       { en: "so proud of you", es: "tan orgulloso de ti" },
       { en: "happy birthday", es: "feliz cumpleaños" },
       { en: "good luck", es: "buena suerte" },
       { en: "celebration", es: "celebración" },
       { en: "amazing news", es: "noticia increíble" },
       { en: "cheers to you", es: "salud por ti" }
        ],
        frases: [
       { en: "Can you tell me more about congratulations?", es: "¿Me puedes contar más sobre felicidades?" },
       { en: "I'd like to talk about so proud of you.", es: "Me gustaría hablar sobre tan orgulloso de ti." },
       { en: "Do you know anything about good luck?", es: "¿Sabes algo sobre buena suerte?" },
       { en: "Can you explain amazing news to me, please?", es: "¿Me puedes explicar noticia increíble por favor?" },
       { en: "I want to ask you about congratulations.", es: "Quiero preguntarte sobre felicidades." },
       { en: "Let's go over so proud of you together.", es: "Repasemos tan orgulloso de ti juntos." }
        ]
       } },
  { id: "z5_r92", zona_id: 5, reto_id: 92, titulo: "Hablar de tu ciudad", banco: {
        palabras: [
       { en: "I live in", es: "vivo en" },
       { en: "hometown", es: "ciudad natal" },
       { en: "population", es: "población" },
       { en: "neighborhood", es: "vecindario" },
       { en: "what's it like", es: "cómo es" },
       { en: "famous for", es: "famoso por" },
       { en: "downtown", es: "centro" },
       { en: "quiet city", es: "ciudad tranquila" }
        ],
        frases: [
       { en: "Can you tell me more about I live in?", es: "¿Me puedes contar más sobre vivo en?" },
       { en: "I'd like to talk about population.", es: "Me gustaría hablar sobre población." },
       { en: "Do you know anything about what's it like?", es: "¿Sabes algo sobre cómo es?" },
       { en: "Can you explain downtown to me, please?", es: "¿Me puedes explicar centro por favor?" },
       { en: "I want to ask you about I live in.", es: "Quiero preguntarte sobre vivo en." },
       { en: "Let's go over population together.", es: "Repasemos población juntos." }
        ]
       } },
  { id: "z5_r93", zona_id: 5, reto_id: 93, titulo: "Despedirte de alguien que conociste", banco: {
        palabras: [
       { en: "it was great meeting you", es: "fue un placer conocerte" },
       { en: "let's keep in touch", es: "sigamos en contacto" },
       { en: "take care", es: "cuídate" },
       { en: "hope to see you again", es: "espero verte otra vez" },
       { en: "have a safe trip", es: "buen viaje" },
       { en: "same here", es: "igualmente" },
       { en: "until next time", es: "hasta la próxima" },
       { en: "goodbye", es: "adiós" }
        ],
        frases: [
       { en: "Can you tell me more about it was great meeting you?", es: "¿Me puedes contar más sobre fue un placer conocerte?" },
       { en: "I'd like to talk about take care.", es: "Me gustaría hablar sobre cuídate." },
       { en: "Do you know anything about have a safe trip?", es: "¿Sabes algo sobre buen viaje?" },
       { en: "Can you explain until next time to me, please?", es: "¿Me puedes explicar hasta la próxima por favor?" },
       { en: "I want to ask you about it was great meeting you.", es: "Quiero preguntarte sobre fue un placer conocerte." },
       { en: "Let's go over take care together.", es: "Repasemos cuídate juntos." }
        ]
       } },
  { id: "z5_r94", zona_id: 5, reto_id: 94, titulo: "Hablar de tu trabajo en una fiesta", banco: {
        palabras: [
       { en: "what do you do", es: "en qué trabajas" },
       { en: "I work as", es: "trabajo como" },
       { en: "I work in", es: "trabajo en" },
       { en: "industry", es: "industria" },
       { en: "how long have you worked there", es: "cuánto tiempo llevas trabajando ahí" },
       { en: "do you like it", es: "te gusta" },
       { en: "busy season", es: "temporada ocupada" },
       { en: "career", es: "carrera" }
        ],
        frases: [
       { en: "Can you tell me more about what do you do?", es: "¿Me puedes contar más sobre en qué trabajas?" },
       { en: "I'd like to talk about I work in.", es: "Me gustaría hablar sobre trabajo en." },
       { en: "Do you know anything about how long have you worked there?", es: "¿Sabes algo sobre cuánto tiempo llevas trabajando ahí?" },
       { en: "Can you explain busy season to me, please?", es: "¿Me puedes explicar temporada ocupada por favor?" },
       { en: "I want to ask you about what do you do.", es: "Quiero preguntarte sobre en qué trabajas." },
       { en: "Let's go over I work in together.", es: "Repasemos trabajo en juntos." }
        ]
       } },
  { id: "z5_r95", zona_id: 5, reto_id: 95, titulo: "Hacer una pregunta personal con tacto", banco: {
        palabras: [
       { en: "if you don't mind me asking", es: "si no te importa que pregunte" },
       { en: "you don't have to answer", es: "no tienes que responder" },
       { en: "personal question", es: "pregunta personal" },
       { en: "I was wondering", es: "me preguntaba" },
       { en: "feel free to skip this", es: "siéntete libre de saltarte esto" },
       { en: "curious", es: "curioso" },
       { en: "no pressure", es: "sin presión" },
       { en: "just curious", es: "solo curiosidad" }
        ],
        frases: [
       { en: "Can you tell me more about if you don't mind me asking?", es: "¿Me puedes contar más sobre si no te importa que pregunte?" },
       { en: "I'd like to talk about personal question.", es: "Me gustaría hablar sobre pregunta personal." },
       { en: "Do you know anything about feel free to skip this?", es: "¿Sabes algo sobre siéntete libre de saltarte esto?" },
       { en: "Can you explain no pressure to me, please?", es: "¿Me puedes explicar sin presión por favor?" },
       { en: "I want to ask you about if you don't mind me asking.", es: "Quiero preguntarte sobre si no te importa que pregunte." },
       { en: "Let's go over personal question together.", es: "Repasemos pregunta personal juntos." }
        ]
       } },
  { id: "z5_r96", zona_id: 5, reto_id: 96, titulo: "Hablar de música o películas favoritas", banco: {
        palabras: [
       { en: "favorite movie", es: "película favorita" },
       { en: "favorite band", es: "banda favorita" },
       { en: "genre", es: "género" },
       { en: "have you seen", es: "has visto" },
       { en: "I love listening to", es: "me encanta escuchar" },
       { en: "recommend a movie", es: "recomendar una película" },
       { en: "soundtrack", es: "banda sonora" },
       { en: "concert", es: "concierto" }
        ],
        frases: [
       { en: "Can you tell me more about favorite movie?", es: "¿Me puedes contar más sobre película favorita?" },
       { en: "I'd like to talk about genre.", es: "Me gustaría hablar sobre género." },
       { en: "Do you know anything about I love listening to?", es: "¿Sabes algo sobre me encanta escuchar?" },
       { en: "Can you explain soundtrack to me, please?", es: "¿Me puedes explicar banda sonora por favor?" },
       { en: "I want to ask you about favorite movie.", es: "Quiero preguntarte sobre película favorita." },
       { en: "Let's go over genre together.", es: "Repasemos género juntos." }
        ]
       } },
  { id: "z5_r97", zona_id: 5, reto_id: 97, titulo: "Organizar una reunión con amigos", banco: {
        palabras: [
       { en: "get together", es: "reunión" },
       { en: "host", es: "organizar" },
       { en: "bring something", es: "traer algo" },
       { en: "potluck", es: "comida compartida" },
       { en: "what time should we start", es: "a qué hora empezamos" },
       { en: "invite everyone", es: "invitar a todos" },
       { en: "RSVP", es: "confirmar asistencia" },
       { en: "location", es: "ubicación" }
        ],
        frases: [
       { en: "Can you tell me more about get together?", es: "¿Me puedes contar más sobre reunión?" },
       { en: "I'd like to talk about bring something.", es: "Me gustaría hablar sobre traer algo." },
       { en: "Do you know anything about what time should we start?", es: "¿Sabes algo sobre a qué hora empezamos?" },
       { en: "Can you explain RSVP to me, please?", es: "¿Me puedes explicar confirmar asistencia por favor?" },
       { en: "I want to ask you about get together.", es: "Quiero preguntarte sobre reunión." },
       { en: "Let's go over bring something together.", es: "Repasemos traer algo juntos." }
        ]
       } },
  { id: "z5_r98", zona_id: 5, reto_id: 98, titulo: "Agradecer una invitación", banco: {
        palabras: [
       { en: "thank you for inviting me", es: "gracias por invitarme" },
       { en: "I had a great time", es: "la pasé muy bien" },
       { en: "I really appreciate it", es: "lo aprecio mucho" },
       { en: "let me know if I can help", es: "dime si puedo ayudar" },
       { en: "great party", es: "gran fiesta" },
       { en: "you're a great host", es: "eres un gran anfitrión" },
       { en: "thanks again", es: "gracias de nuevo" },
       { en: "hope to return the favor", es: "espero devolver el favor" }
        ],
        frases: [
       { en: "Can you tell me more about thank you for inviting me?", es: "¿Me puedes contar más sobre gracias por invitarme?" },
       { en: "I'd like to talk about I really appreciate it.", es: "Me gustaría hablar sobre lo aprecio mucho." },
       { en: "Do you know anything about great party?", es: "¿Sabes algo sobre gran fiesta?" },
       { en: "Can you explain thanks again to me, please?", es: "¿Me puedes explicar gracias de nuevo por favor?" },
       { en: "I want to ask you about thank you for inviting me.", es: "Quiero preguntarte sobre gracias por invitarme." },
       { en: "Let's go over I really appreciate it together.", es: "Repasemos lo aprecio mucho juntos." }
        ]
       } },
  { id: "z5_r99", zona_id: 5, reto_id: 99, titulo: "Disculparte por llegar tarde a un evento", banco: {
        palabras: [
       { en: "sorry I'm late", es: "perdón por llegar tarde" },
       { en: "traffic was bad", es: "había mucho tráfico" },
       { en: "I lost track of time", es: "perdí la noción del tiempo" },
       { en: "it won't happen again", es: "no volverá a pasar" },
       { en: "thanks for waiting", es: "gracias por esperar" },
       { en: "my apologies", es: "mis disculpas" },
       { en: "got held up", es: "se me complicó" },
       { en: "I'm really sorry", es: "lo siento mucho" }
        ],
        frases: [
       { en: "Can you tell me more about sorry I'm late?", es: "¿Me puedes contar más sobre perdón por llegar tarde?" },
       { en: "I'd like to talk about I lost track of time.", es: "Me gustaría hablar sobre perdí la noción del tiempo." },
       { en: "Do you know anything about thanks for waiting?", es: "¿Sabes algo sobre gracias por esperar?" },
       { en: "Can you explain got held up to me, please?", es: "¿Me puedes explicar se me complicó por favor?" },
       { en: "I want to ask you about sorry I'm late.", es: "Quiero preguntarte sobre perdón por llegar tarde." },
       { en: "Let's go over I lost track of time together.", es: "Repasemos perdí la noción del tiempo juntos." }
        ]
       } },
  { id: "z5_r100", zona_id: 5, reto_id: 100, titulo: "Repaso: vida social", banco: {
        palabras: [
       { en: "friend", es: "amigo" },
       { en: "family", es: "familia" },
       { en: "invite", es: "invitar" },
       { en: "compliment", es: "cumplido" },
       { en: "weekend", es: "fin de semana" },
       { en: "hobby", es: "pasatiempo" },
       { en: "party", es: "fiesta" },
       { en: "thank you", es: "gracias" }
        ],
        frases: [
       { en: "Can you tell me more about friend?", es: "¿Me puedes contar más sobre amigo?" },
       { en: "I'd like to talk about invite.", es: "Me gustaría hablar sobre invitar." },
       { en: "Do you know anything about weekend?", es: "¿Sabes algo sobre fin de semana?" },
       { en: "Can you explain party to me, please?", es: "¿Me puedes explicar fiesta por favor?" },
       { en: "I want to ask you about friend.", es: "Quiero preguntarte sobre amigo." },
       { en: "Let's go over invite together.", es: "Repasemos invitar juntos." }
        ]
       } },
  { id: "z6_r101", zona_id: 6, reto_id: 101, titulo: "Pedir ayuda urgente", banco: {
        palabras: [
       { en: "emergency", es: "emergencia" },
       { en: "help!", es: "¡ayuda!" },
       { en: "call 911", es: "llama al 911" },
       { en: "right now", es: "ahora mismo" },
       { en: "danger", es: "peligro" },
       { en: "hurry", es: "apúrate" },
       { en: "someone is hurt", es: "alguien está herido" },
       { en: "quickly", es: "rápido" }
        ],
        frases: [
       { en: "Can you tell me more about emergency?", es: "¿Me puedes contar más sobre emergencia?" },
       { en: "I'd like to talk about call 911.", es: "Me gustaría hablar sobre llama al 911." },
       { en: "Do you know anything about danger?", es: "¿Sabes algo sobre peligro?" },
       { en: "Can you explain someone is hurt to me, please?", es: "¿Me puedes explicar alguien está herido por favor?" },
       { en: "I want to ask you about emergency.", es: "Quiero preguntarte sobre emergencia." },
       { en: "Let's go over call 911 together.", es: "Repasemos llama al 911 juntos." }
        ]
       } },
  { id: "z6_r102", zona_id: 6, reto_id: 102, titulo: "Describir un dolor", banco: {
        palabras: [
       { en: "pain", es: "dolor" },
       { en: "it hurts here", es: "me duele aquí" },
       { en: "sharp pain", es: "dolor agudo" },
       { en: "constant", es: "constante" },
       { en: "how bad is the pain", es: "qué tan fuerte es el dolor" },
       { en: "worse at night", es: "peor en la noche" },
       { en: "since yesterday", es: "desde ayer" },
       { en: "unbearable", es: "insoportable" }
        ],
        frases: [
       { en: "Can you tell me more about pain?", es: "¿Me puedes contar más sobre dolor?" },
       { en: "I'd like to talk about sharp pain.", es: "Me gustaría hablar sobre dolor agudo." },
       { en: "Do you know anything about how bad is the pain?", es: "¿Sabes algo sobre qué tan fuerte es el dolor?" },
       { en: "Can you explain since yesterday to me, please?", es: "¿Me puedes explicar desde ayer por favor?" },
       { en: "I want to ask you about pain.", es: "Quiero preguntarte sobre dolor." },
       { en: "Let's go over sharp pain together.", es: "Repasemos dolor agudo juntos." }
        ]
       } },
  { id: "z6_r103", zona_id: 6, reto_id: 103, titulo: "Llamar a emergencias", banco: {
        palabras: [
       { en: "emergency number", es: "número de emergencia" },
       { en: "address", es: "dirección" },
       { en: "what's the emergency", es: "cuál es la emergencia" },
       { en: "send an ambulance", es: "envíen una ambulancia" },
       { en: "stay on the line", es: "no cuelgue" },
       { en: "is anyone injured", es: "hay alguien herido" },
       { en: "nearest hospital", es: "hospital más cercano" },
       { en: "help is on the way", es: "la ayuda está en camino" }
        ],
        frases: [
       { en: "Can you tell me more about emergency number?", es: "¿Me puedes contar más sobre número de emergencia?" },
       { en: "I'd like to talk about what's the emergency.", es: "Me gustaría hablar sobre cuál es la emergencia." },
       { en: "Do you know anything about stay on the line?", es: "¿Sabes algo sobre no cuelgue?" },
       { en: "Can you explain nearest hospital to me, please?", es: "¿Me puedes explicar hospital más cercano por favor?" },
       { en: "I want to ask you about emergency number.", es: "Quiero preguntarte sobre número de emergencia." },
       { en: "Let's go over what's the emergency together.", es: "Repasemos cuál es la emergencia juntos." }
        ]
       } },
  { id: "z6_r104", zona_id: 6, reto_id: 104, titulo: "Pedir una cita médica", banco: {
        palabras: [
       { en: "appointment", es: "cita" },
       { en: "schedule an appointment", es: "agendar una cita" },
       { en: "available slot", es: "horario disponible" },
       { en: "which doctor", es: "qué doctor" },
       { en: "new patient", es: "paciente nuevo" },
       { en: "insurance", es: "seguro" },
       { en: "next available", es: "el siguiente disponible" },
       { en: "reschedule", es: "reprogramar" }
        ],
        frases: [
       { en: "Can you tell me more about appointment?", es: "¿Me puedes contar más sobre cita?" },
       { en: "I'd like to talk about available slot.", es: "Me gustaría hablar sobre horario disponible." },
       { en: "Do you know anything about new patient?", es: "¿Sabes algo sobre paciente nuevo?" },
       { en: "Can you explain next available to me, please?", es: "¿Me puedes explicar el siguiente disponible por favor?" },
       { en: "I want to ask you about appointment.", es: "Quiero preguntarte sobre cita." },
       { en: "Let's go over available slot together.", es: "Repasemos horario disponible juntos." }
        ]
       } },
  { id: "z6_r105", zona_id: 6, reto_id: 105, titulo: "Describir síntomas al doctor", banco: {
        palabras: [
       { en: "symptom", es: "síntoma" },
       { en: "fever", es: "fiebre" },
       { en: "cough", es: "tos" },
       { en: "headache", es: "dolor de cabeza" },
       { en: "nausea", es: "náusea" },
       { en: "since when", es: "desde cuándo" },
       { en: "medical history", es: "historial médico" },
       { en: "allergic to", es: "alérgico a" }
        ],
        frases: [
       { en: "Can you tell me more about symptom?", es: "¿Me puedes contar más sobre síntoma?" },
       { en: "I'd like to talk about cough.", es: "Me gustaría hablar sobre tos." },
       { en: "Do you know anything about nausea?", es: "¿Sabes algo sobre náusea?" },
       { en: "Can you explain medical history to me, please?", es: "¿Me puedes explicar historial médico por favor?" },
       { en: "I want to ask you about symptom.", es: "Quiero preguntarte sobre síntoma." },
       { en: "Let's go over cough together.", es: "Repasemos tos juntos." }
        ]
       } },
  { id: "z6_r106", zona_id: 6, reto_id: 106, titulo: "Comprar medicina en la farmacia", banco: {
        palabras: [
       { en: "pharmacy", es: "farmacia" },
       { en: "prescription", es: "receta médica" },
       { en: "over the counter", es: "sin receta" },
       { en: "dosage", es: "dosis" },
       { en: "side effects", es: "efectos secundarios" },
       { en: "painkiller", es: "analgésico" },
       { en: "pharmacist", es: "farmacéutico" },
       { en: "generic brand", es: "marca genérica" }
        ],
        frases: [
       { en: "Can you tell me more about pharmacy?", es: "¿Me puedes contar más sobre farmacia?" },
       { en: "I'd like to talk about over the counter.", es: "Me gustaría hablar sobre sin receta." },
       { en: "Do you know anything about side effects?", es: "¿Sabes algo sobre efectos secundarios?" },
       { en: "Can you explain pharmacist to me, please?", es: "¿Me puedes explicar farmacéutico por favor?" },
       { en: "I want to ask you about pharmacy.", es: "Quiero preguntarte sobre farmacia." },
       { en: "Let's go over over the counter together.", es: "Repasemos sin receta juntos." }
        ]
       } },
  { id: "z6_r107", zona_id: 6, reto_id: 107, titulo: "Reportar un accidente", banco: {
        palabras: [
       { en: "accident", es: "accidente" },
       { en: "car crash", es: "choque" },
       { en: "witness", es: "testigo" },
       { en: "injured", es: "lesionado" },
       { en: "police report", es: "reporte policial" },
       { en: "insurance information", es: "información del seguro" },
       { en: "what happened", es: "qué pasó" },
       { en: "license plate", es: "placa" }
        ],
        frases: [
       { en: "Can you tell me more about accident?", es: "¿Me puedes contar más sobre accidente?" },
       { en: "I'd like to talk about witness.", es: "Me gustaría hablar sobre testigo." },
       { en: "Do you know anything about police report?", es: "¿Sabes algo sobre reporte policial?" },
       { en: "Can you explain what happened to me, please?", es: "¿Me puedes explicar qué pasó por favor?" },
       { en: "I want to ask you about accident.", es: "Quiero preguntarte sobre accidente." },
       { en: "Let's go over witness together.", es: "Repasemos testigo juntos." }
        ]
       } },
  { id: "z6_r108", zona_id: 6, reto_id: 108, titulo: "Pedir un intérprete", banco: {
        palabras: [
       { en: "interpreter", es: "intérprete" },
       { en: "I don't speak English well", es: "no hablo bien inglés" },
       { en: "can someone translate", es: "alguien puede traducir" },
       { en: "language line", es: "línea de idiomas" },
       { en: "my language is", es: "mi idioma es" },
       { en: "misunderstanding", es: "malentendido" },
       { en: "important", es: "importante" },
       { en: "please wait", es: "espere por favor" }
        ],
        frases: [
       { en: "Can you tell me more about interpreter?", es: "¿Me puedes contar más sobre intérprete?" },
       { en: "I'd like to talk about can someone translate.", es: "Me gustaría hablar sobre alguien puede traducir." },
       { en: "Do you know anything about my language is?", es: "¿Sabes algo sobre mi idioma es?" },
       { en: "Can you explain important to me, please?", es: "¿Me puedes explicar importante por favor?" },
       { en: "I want to ask you about interpreter.", es: "Quiero preguntarte sobre intérprete." },
       { en: "Let's go over can someone translate together.", es: "Repasemos alguien puede traducir juntos." }
        ]
       } },
  { id: "z6_r109", zona_id: 6, reto_id: 109, titulo: "Explicar una alergia grave", banco: {
        palabras: [
       { en: "severe allergy", es: "alergia grave" },
       { en: "anaphylaxis", es: "anafilaxia" },
       { en: "epinephrine", es: "epinefrina" },
       { en: "allergic reaction", es: "reacción alérgica" },
       { en: "life-threatening", es: "pone en riesgo la vida" },
       { en: "medical bracelet", es: "brazalete médico" },
       { en: "avoid contact with", es: "evitar contacto con" },
       { en: "emergency kit", es: "kit de emergencia" }
        ],
        frases: [
       { en: "Can you tell me more about severe allergy?", es: "¿Me puedes contar más sobre alergia grave?" },
       { en: "I'd like to talk about epinephrine.", es: "Me gustaría hablar sobre epinefrina." },
       { en: "Do you know anything about life-threatening?", es: "¿Sabes algo sobre pone en riesgo la vida?" },
       { en: "Can you explain avoid contact with to me, please?", es: "¿Me puedes explicar evitar contacto con por favor?" },
       { en: "I want to ask you about severe allergy.", es: "Quiero preguntarte sobre alergia grave." },
       { en: "Let's go over epinephrine together.", es: "Repasemos epinefrina juntos." }
        ]
       } },
  { id: "z6_r110", zona_id: 6, reto_id: 110, titulo: "Pedir una ambulancia", banco: {
        palabras: [
       { en: "ambulance", es: "ambulancia" },
       { en: "send an ambulance", es: "envíen una ambulancia" },
       { en: "unconscious", es: "inconsciente" },
       { en: "not breathing", es: "no respira" },
       { en: "exact location", es: "ubicación exacta" },
       { en: "how long until it arrives", es: "cuánto tarda en llegar" },
       { en: "stay calm", es: "mantén la calma" },
       { en: "stretcher", es: "camilla" }
        ],
        frases: [
       { en: "Can you tell me more about ambulance?", es: "¿Me puedes contar más sobre ambulancia?" },
       { en: "I'd like to talk about unconscious.", es: "Me gustaría hablar sobre inconsciente." },
       { en: "Do you know anything about exact location?", es: "¿Sabes algo sobre ubicación exacta?" },
       { en: "Can you explain stay calm to me, please?", es: "¿Me puedes explicar mantén la calma por favor?" },
       { en: "I want to ask you about ambulance.", es: "Quiero preguntarte sobre ambulancia." },
       { en: "Let's go over unconscious together.", es: "Repasemos inconsciente juntos." }
        ]
       } },
  { id: "z6_r111", zona_id: 6, reto_id: 111, titulo: "Hablar con un paramédico", banco: {
        palabras: [
       { en: "paramedic", es: "paramédico" },
       { en: "vital signs", es: "signos vitales" },
       { en: "blood pressure", es: "presión arterial" },
       { en: "pulse", es: "pulso" },
       { en: "medical conditions", es: "condiciones médicas" },
       { en: "medications", es: "medicamentos" },
       { en: "next of kin", es: "familiar más cercano" },
       { en: "take to the hospital", es: "llevar al hospital" }
        ],
        frases: [
       { en: "Can you tell me more about paramedic?", es: "¿Me puedes contar más sobre paramédico?" },
       { en: "I'd like to talk about blood pressure.", es: "Me gustaría hablar sobre presión arterial." },
       { en: "Do you know anything about medical conditions?", es: "¿Sabes algo sobre condiciones médicas?" },
       { en: "Can you explain next of kin to me, please?", es: "¿Me puedes explicar familiar más cercano por favor?" },
       { en: "I want to ask you about paramedic.", es: "Quiero preguntarte sobre paramédico." },
       { en: "Let's go over blood pressure together.", es: "Repasemos presión arterial juntos." }
        ]
       } },
  { id: "z6_r112", zona_id: 6, reto_id: 112, titulo: "Seguir instrucciones médicas", banco: {
        palabras: [
       { en: "instructions", es: "instrucciones" },
       { en: "take twice a day", es: "tomar dos veces al día" },
       { en: "with food", es: "con comida" },
       { en: "rest", es: "descansar" },
       { en: "follow-up appointment", es: "cita de seguimiento" },
       { en: "avoid", es: "evitar" },
       { en: "complete the treatment", es: "completar el tratamiento" },
       { en: "warning signs", es: "señales de advertencia" }
        ],
        frases: [
       { en: "Can you tell me more about instructions?", es: "¿Me puedes contar más sobre instrucciones?" },
       { en: "I'd like to talk about with food.", es: "Me gustaría hablar sobre con comida." },
       { en: "Do you know anything about follow-up appointment?", es: "¿Sabes algo sobre cita de seguimiento?" },
       { en: "Can you explain complete the treatment to me, please?", es: "¿Me puedes explicar completar el tratamiento por favor?" },
       { en: "I want to ask you about instructions.", es: "Quiero preguntarte sobre instrucciones." },
       { en: "Let's go over with food together.", es: "Repasemos con comida juntos." }
        ]
       } },
  { id: "z6_r113", zona_id: 6, reto_id: 113, titulo: "Pedir un seguro médico", banco: {
        palabras: [
       { en: "insurance", es: "seguro" },
       { en: "coverage", es: "cobertura" },
       { en: "copay", es: "copago" },
       { en: "claim", es: "reclamo" },
       { en: "policy number", es: "número de póliza" },
       { en: "provider", es: "proveedor" },
       { en: "deductible", es: "deducible" },
       { en: "covered", es: "cubierto" }
        ],
        frases: [
       { en: "Can you tell me more about insurance?", es: "¿Me puedes contar más sobre seguro?" },
       { en: "I'd like to talk about copay.", es: "Me gustaría hablar sobre copago." },
       { en: "Do you know anything about policy number?", es: "¿Sabes algo sobre número de póliza?" },
       { en: "Can you explain deductible to me, please?", es: "¿Me puedes explicar deducible por favor?" },
       { en: "I want to ask you about insurance.", es: "Quiero preguntarte sobre seguro." },
       { en: "Let's go over copay together.", es: "Repasemos copago juntos." }
        ]
       } },
  { id: "z6_r114", zona_id: 6, reto_id: 114, titulo: "Explicar que perdiste tus documentos", banco: {
        palabras: [
       { en: "lost documents", es: "documentos perdidos" },
       { en: "report", es: "reportar" },
       { en: "ID card", es: "identificación" },
       { en: "replace", es: "reemplazar" },
       { en: "embassy", es: "embajada" },
       { en: "police report", es: "reporte policial" },
       { en: "stolen", es: "robado" },
       { en: "missing", es: "perdido/extraviado" }
        ],
        frases: [
       { en: "Can you tell me more about lost documents?", es: "¿Me puedes contar más sobre documentos perdidos?" },
       { en: "I'd like to talk about ID card.", es: "Me gustaría hablar sobre identificación." },
       { en: "Do you know anything about embassy?", es: "¿Sabes algo sobre embajada?" },
       { en: "Can you explain stolen to me, please?", es: "¿Me puedes explicar robado por favor?" },
       { en: "I want to ask you about lost documents.", es: "Quiero preguntarte sobre documentos perdidos." },
       { en: "Let's go over ID card together.", es: "Repasemos identificación juntos." }
        ]
       } },
  { id: "z6_r115", zona_id: 6, reto_id: 115, titulo: "Reportar un robo", banco: {
        palabras: [
       { en: "robbery", es: "robo" },
       { en: "stolen", es: "robado" },
       { en: "report a theft", es: "reportar un robo" },
       { en: "suspect", es: "sospechoso" },
       { en: "description", es: "descripción" },
       { en: "when did it happen", es: "cuándo pasó" },
       { en: "value of items", es: "valor de los artículos" },
       { en: "case number", es: "número de caso" }
        ],
        frases: [
       { en: "Can you tell me more about robbery?", es: "¿Me puedes contar más sobre robo?" },
       { en: "I'd like to talk about report a theft.", es: "Me gustaría hablar sobre reportar un robo." },
       { en: "Do you know anything about description?", es: "¿Sabes algo sobre descripción?" },
       { en: "Can you explain value of items to me, please?", es: "¿Me puedes explicar valor de los artículos por favor?" },
       { en: "I want to ask you about robbery.", es: "Quiero preguntarte sobre robo." },
       { en: "Let's go over report a theft together.", es: "Repasemos reportar un robo juntos." }
        ]
       } },
  { id: "z6_r116", zona_id: 6, reto_id: 116, titulo: "Pedir la ubicación del hospital más cercano", banco: {
        palabras: [
       { en: "nearest hospital", es: "hospital más cercano" },
       { en: "how far", es: "qué tan lejos" },
       { en: "emergency room", es: "sala de urgencias" },
       { en: "directions", es: "indicaciones" },
       { en: "open 24 hours", es: "abierto 24 horas" },
       { en: "walk-in clinic", es: "clínica sin cita" },
       { en: "urgent care", es: "atención urgente" },
       { en: "address", es: "dirección" }
        ],
        frases: [
       { en: "Can you tell me more about nearest hospital?", es: "¿Me puedes contar más sobre hospital más cercano?" },
       { en: "I'd like to talk about emergency room.", es: "Me gustaría hablar sobre sala de urgencias." },
       { en: "Do you know anything about open 24 hours?", es: "¿Sabes algo sobre abierto 24 horas?" },
       { en: "Can you explain urgent care to me, please?", es: "¿Me puedes explicar atención urgente por favor?" },
       { en: "I want to ask you about nearest hospital.", es: "Quiero preguntarte sobre hospital más cercano." },
       { en: "Let's go over emergency room together.", es: "Repasemos sala de urgencias juntos." }
        ]
       } },
  { id: "z6_r117", zona_id: 6, reto_id: 117, titulo: "Hablar con la policía", banco: {
        palabras: [
       { en: "police", es: "policía" },
       { en: "officer", es: "oficial" },
       { en: "file a report", es: "levantar un reporte" },
       { en: "incident", es: "incidente" },
       { en: "statement", es: "declaración" },
       { en: "witness", es: "testigo" },
       { en: "badge number", es: "número de placa" },
       { en: "cooperate", es: "cooperar" }
        ],
        frases: [
       { en: "Can you tell me more about police?", es: "¿Me puedes contar más sobre policía?" },
       { en: "I'd like to talk about file a report.", es: "Me gustaría hablar sobre levantar un reporte." },
       { en: "Do you know anything about statement?", es: "¿Sabes algo sobre declaración?" },
       { en: "Can you explain badge number to me, please?", es: "¿Me puedes explicar número de placa por favor?" },
       { en: "I want to ask you about police.", es: "Quiero preguntarte sobre policía." },
       { en: "Let's go over file a report together.", es: "Repasemos levantar un reporte juntos." }
        ]
       } },
  { id: "z6_r118", zona_id: 6, reto_id: 118, titulo: "Describir un incendio o fuga de gas", banco: {
        palabras: [
       { en: "fire", es: "incendio" },
       { en: "gas leak", es: "fuga de gas" },
       { en: "smoke", es: "humo" },
       { en: "evacuate", es: "evacuar" },
       { en: "smell of gas", es: "olor a gas" },
       { en: "fire department", es: "bomberos" },
       { en: "alarm", es: "alarma" },
       { en: "dangerous", es: "peligroso" }
        ],
        frases: [
       { en: "Can you tell me more about fire?", es: "¿Me puedes contar más sobre incendio?" },
       { en: "I'd like to talk about smoke.", es: "Me gustaría hablar sobre humo." },
       { en: "Do you know anything about smell of gas?", es: "¿Sabes algo sobre olor a gas?" },
       { en: "Can you explain alarm to me, please?", es: "¿Me puedes explicar alarma por favor?" },
       { en: "I want to ask you about fire.", es: "Quiero preguntarte sobre incendio." },
       { en: "Let's go over smoke together.", es: "Repasemos humo juntos." }
        ]
       } },
  { id: "z6_r119", zona_id: 6, reto_id: 119, titulo: "Explicar una lesión al trabajo", banco: {
        palabras: [
       { en: "work injury", es: "lesión de trabajo" },
       { en: "report to supervisor", es: "reportar al supervisor" },
       { en: "workers' compensation", es: "compensación laboral" },
       { en: "incident form", es: "formulario de incidente" },
       { en: "first aid", es: "primeros auxilios" },
       { en: "safety equipment", es: "equipo de seguridad" },
       { en: "return to work", es: "regresar al trabajo" },
       { en: "doctor's note", es: "nota del doctor" }
        ],
        frases: [
       { en: "Can you tell me more about work injury?", es: "¿Me puedes contar más sobre lesión de trabajo?" },
       { en: "I'd like to talk about workers' compensation.", es: "Me gustaría hablar sobre compensación laboral." },
       { en: "Do you know anything about first aid?", es: "¿Sabes algo sobre primeros auxilios?" },
       { en: "Can you explain return to work to me, please?", es: "¿Me puedes explicar regresar al trabajo por favor?" },
       { en: "I want to ask you about work injury.", es: "Quiero preguntarte sobre lesión de trabajo." },
       { en: "Let's go over workers' compensation together.", es: "Repasemos compensación laboral juntos." }
        ]
       } },
  { id: "z6_r120", zona_id: 6, reto_id: 120, titulo: "Repaso: emergencias y salud", banco: {
        palabras: [
       { en: "emergency", es: "emergencia" },
       { en: "pain", es: "dolor" },
       { en: "doctor", es: "doctor" },
       { en: "hospital", es: "hospital" },
       { en: "ambulance", es: "ambulancia" },
       { en: "medicine", es: "medicina" },
       { en: "help", es: "ayuda" },
       { en: "insurance", es: "seguro" }
        ],
        frases: [
       { en: "Can you tell me more about emergency?", es: "¿Me puedes contar más sobre emergencia?" },
       { en: "I'd like to talk about doctor.", es: "Me gustaría hablar sobre doctor." },
       { en: "Do you know anything about ambulance?", es: "¿Sabes algo sobre ambulancia?" },
       { en: "Can you explain help to me, please?", es: "¿Me puedes explicar ayuda por favor?" },
       { en: "I want to ask you about emergency.", es: "Quiero preguntarte sobre emergencia." },
       { en: "Let's go over doctor together.", es: "Repasemos doctor juntos." }
        ]
       } },
  { id: "reunion", zona_id: 7, reto_id: 121, titulo: "Reunión de trabajo", banco: {
        palabras: [
       { en: "meeting", es: "reunión" },
       { en: "deadline", es: "fecha límite" },
       { en: "schedule", es: "agendar" },
       { en: "teamwork", es: "trabajo en equipo" },
       { en: "agenda", es: "agenda" },
       { en: "minutes", es: "minuta" },
       { en: "attend", es: "asistir" },
       { en: "postpone", es: "posponer" }
        ],
        frases: [
       { en: "Can we schedule a meeting for tomorrow?", es: "¿Podemos agendar una reunión para mañana?" },
       { en: "Can we postpone the meeting?", es: "¿Podemos posponer la reunión?" },
       { en: "What's on the agenda today?", es: "¿Qué hay en la agenda de hoy?" },
       { en: "I can't attend the meeting.", es: "No puedo asistir a la reunión." },
       { en: "The deadline is Friday.", es: "La fecha límite es el viernes." },
       { en: "Let's take the minutes.", es: "Tomemos la minuta." }
        ]
       } },
  { id: "correo", zona_id: 7, reto_id: 122, titulo: "Correo profesional", banco: {
        palabras: [
       { en: "attach", es: "adjuntar" },
       { en: "urgent", es: "urgente" },
       { en: "regards", es: "saludos" },
       { en: "reply", es: "responder" },
       { en: "forward", es: "reenviar" },
       { en: "inbox", es: "bandeja de entrada" },
       { en: "subject", es: "asunto" },
       { en: "sender", es: "remitente" }
        ],
        frases: [
       { en: "I'll reply to your email by tomorrow.", es: "Responderé tu correo mañana." },
       { en: "I'll reply to your email.", es: "Responderé tu correo." },
       { en: "This is urgent, please reply soon.", es: "Esto es urgente, responde pronto." },
       { en: "Can you forward me the file?", es: "¿Me puedes reenviar el archivo?" },
       { en: "I attached the document.", es: "Adjunté el documento." },
       { en: "Best regards.", es: "Saludos cordiales." }
        ]
       } },
  { id: "entrevista", zona_id: 7, reto_id: 123, titulo: "Entrevista de trabajo", banco: {
        palabras: [
       { en: "resume", es: "currículum" },
       { en: "experience", es: "experiencia" },
       { en: "strengths", es: "fortalezas" },
       { en: "salary", es: "salario" },
       { en: "weakness", es: "debilidad" },
       { en: "available", es: "disponible" },
       { en: "position", es: "puesto" },
       { en: "hire", es: "contratar" }
        ],
        frases: [
       { en: "Tell me about your work experience.", es: "Cuéntame sobre tu experiencia laboral." },
       { en: "I have three years of experience.", es: "Tengo tres años de experiencia." },
       { en: "What are your strengths?", es: "¿Cuáles son tus fortalezas?" },
       { en: "When are you available to start?", es: "¿Cuándo estás disponible para empezar?" },
       { en: "What salary are you expecting?", es: "¿Qué salario esperas?" },
       { en: "I sent my resume yesterday.", es: "Envié mi currículum ayer." }
        ]
       } },
  { id: "aumento", zona_id: 7, reto_id: 124, titulo: "Pedir un aumento", banco: {
        palabras: [
       { en: "raise", es: "aumento" },
       { en: "promotion", es: "ascenso" },
       { en: "performance", es: "desempeño" },
       { en: "deserve", es: "merecer" },
       { en: "achievement", es: "logro" },
       { en: "review", es: "evaluación" },
       { en: "budget", es: "presupuesto" },
       { en: "worth", es: "valer" }
        ],
        frases: [
       { en: "I believe I deserve a raise this year.", es: "Creo que merezco un aumento este año." },
       { en: "I deserve a raise this year.", es: "Merezco un aumento este año." },
       { en: "My performance has improved a lot.", es: "Mi desempeño ha mejorado mucho." },
       { en: "I'd like to talk about a promotion.", es: "Me gustaría hablar sobre un ascenso." },
       { en: "Is there room in the budget?", es: "¿Hay espacio en el presupuesto?" },
       { en: "I'm proud of this achievement.", es: "Estoy orgulloso de este logro." }
        ]
       } },
  { id: "z7_r125", zona_id: 7, reto_id: 125, titulo: "Presentarte el primer día de trabajo", banco: {
        palabras: [
       { en: "first day", es: "primer día" },
       { en: "new employee", es: "nuevo empleado" },
       { en: "orientation", es: "orientación" },
       { en: "supervisor", es: "supervisor" },
       { en: "job title", es: "puesto" },
       { en: "team", es: "equipo" },
       { en: "nice to meet everyone", es: "mucho gusto a todos" },
       { en: "excited to be here", es: "emocionado de estar aquí" }
        ],
        frases: [
       { en: "Can you tell me more about first day?", es: "¿Me puedes contar más sobre primer día?" },
       { en: "I'd like to talk about orientation.", es: "Me gustaría hablar sobre orientación." },
       { en: "Do you know anything about job title?", es: "¿Sabes algo sobre puesto?" },
       { en: "Can you explain nice to meet everyone to me, please?", es: "¿Me puedes explicar mucho gusto a todos por favor?" },
       { en: "I want to ask you about first day.", es: "Quiero preguntarte sobre primer día." },
       { en: "Let's go over orientation together.", es: "Repasemos orientación juntos." }
        ]
       } },
  { id: "z7_r126", zona_id: 7, reto_id: 126, titulo: "Pedir un día libre", banco: {
        palabras: [
       { en: "day off", es: "día libre" },
       { en: "request time off", es: "solicitar tiempo libre" },
       { en: "vacation days", es: "días de vacaciones" },
       { en: "sick leave", es: "permiso por enfermedad" },
       { en: "personal matter", es: "asunto personal" },
       { en: "approve", es: "aprobar" },
       { en: "coverage", es: "cobertura" },
       { en: "in advance", es: "con anticipación" }
        ],
        frases: [
       { en: "Can you tell me more about day off?", es: "¿Me puedes contar más sobre día libre?" },
       { en: "I'd like to talk about vacation days.", es: "Me gustaría hablar sobre días de vacaciones." },
       { en: "Do you know anything about personal matter?", es: "¿Sabes algo sobre asunto personal?" },
       { en: "Can you explain coverage to me, please?", es: "¿Me puedes explicar cobertura por favor?" },
       { en: "I want to ask you about day off.", es: "Quiero preguntarte sobre día libre." },
       { en: "Let's go over vacation days together.", es: "Repasemos días de vacaciones juntos." }
        ]
       } },
  { id: "z7_r127", zona_id: 7, reto_id: 127, titulo: "Reportar un problema técnico", banco: {
        palabras: [
       { en: "technical issue", es: "problema técnico" },
       { en: "not working", es: "no funciona" },
       { en: "IT support", es: "soporte técnico" },
       { en: "restart", es: "reiniciar" },
       { en: "urgent", es: "urgente" },
       { en: "error message", es: "mensaje de error" },
       { en: "ticket number", es: "número de ticket" },
       { en: "fix it", es: "arreglarlo" }
        ],
        frases: [
       { en: "Can you tell me more about technical issue?", es: "¿Me puedes contar más sobre problema técnico?" },
       { en: "I'd like to talk about IT support.", es: "Me gustaría hablar sobre soporte técnico." },
       { en: "Do you know anything about urgent?", es: "¿Sabes algo sobre urgente?" },
       { en: "Can you explain ticket number to me, please?", es: "¿Me puedes explicar número de ticket por favor?" },
       { en: "I want to ask you about technical issue.", es: "Quiero preguntarte sobre problema técnico." },
       { en: "Let's go over IT support together.", es: "Repasemos soporte técnico juntos." }
        ]
       } },
  { id: "z7_r128", zona_id: 7, reto_id: 128, titulo: "Hacer una presentación breve", banco: {
        palabras: [
       { en: "presentation", es: "presentación" },
       { en: "slides", es: "diapositivas" },
       { en: "agenda", es: "agenda" },
       { en: "key points", es: "puntos clave" },
       { en: "questions", es: "preguntas" },
       { en: "summary", es: "resumen" },
       { en: "next steps", es: "siguientes pasos" },
       { en: "thank you for your time", es: "gracias por su tiempo" }
        ],
        frases: [
       { en: "Can you tell me more about presentation?", es: "¿Me puedes contar más sobre presentación?" },
       { en: "I'd like to talk about agenda.", es: "Me gustaría hablar sobre agenda." },
       { en: "Do you know anything about questions?", es: "¿Sabes algo sobre preguntas?" },
       { en: "Can you explain next steps to me, please?", es: "¿Me puedes explicar siguientes pasos por favor?" },
       { en: "I want to ask you about presentation.", es: "Quiero preguntarte sobre presentación." },
       { en: "Let's go over agenda together.", es: "Repasemos agenda juntos." }
        ]
       } },
  { id: "z7_r129", zona_id: 7, reto_id: 129, titulo: "Dar retroalimentación a un compañero", banco: {
        palabras: [
       { en: "feedback", es: "retroalimentación" },
       { en: "great job on", es: "buen trabajo en" },
       { en: "suggestion", es: "sugerencia" },
       { en: "could improve", es: "podría mejorar" },
       { en: "constructive", es: "constructivo" },
       { en: "overall", es: "en general" },
       { en: "well done", es: "bien hecho" },
       { en: "let's discuss", es: "hablemos de" }
        ],
        frases: [
       { en: "Can you tell me more about feedback?", es: "¿Me puedes contar más sobre retroalimentación?" },
       { en: "I'd like to talk about suggestion.", es: "Me gustaría hablar sobre sugerencia." },
       { en: "Do you know anything about constructive?", es: "¿Sabes algo sobre constructivo?" },
       { en: "Can you explain well done to me, please?", es: "¿Me puedes explicar bien hecho por favor?" },
       { en: "I want to ask you about feedback.", es: "Quiero preguntarte sobre retroalimentación." },
       { en: "Let's go over suggestion together.", es: "Repasemos sugerencia juntos." }
        ]
       } },
  { id: "z7_r130", zona_id: 7, reto_id: 130, titulo: "Recibir retroalimentación", banco: {
        palabras: [
       { en: "thank you for the feedback", es: "gracias por la retroalimentación" },
       { en: "I'll work on that", es: "voy a trabajar en eso" },
       { en: "appreciate it", es: "lo aprecio" },
       { en: "noted", es: "entendido" },
       { en: "I understand", es: "entiendo" },
       { en: "improve", es: "mejorar" },
       { en: "next time", es: "la próxima vez" },
       { en: "open to suggestions", es: "abierto a sugerencias" }
        ],
        frases: [
       { en: "Can you tell me more about thank you for the feedback?", es: "¿Me puedes contar más sobre gracias por la retroalimentación?" },
       { en: "I'd like to talk about appreciate it.", es: "Me gustaría hablar sobre lo aprecio." },
       { en: "Do you know anything about I understand?", es: "¿Sabes algo sobre entiendo?" },
       { en: "Can you explain next time to me, please?", es: "¿Me puedes explicar la próxima vez por favor?" },
       { en: "I want to ask you about thank you for the feedback.", es: "Quiero preguntarte sobre gracias por la retroalimentación." },
       { en: "Let's go over appreciate it together.", es: "Repasemos lo aprecio juntos." }
        ]
       } },
  { id: "z7_r131", zona_id: 7, reto_id: 131, titulo: "Hablar de una fecha límite", banco: {
        palabras: [
       { en: "deadline", es: "fecha límite" },
       { en: "due date", es: "fecha de entrega" },
       { en: "on track", es: "en buen camino" },
       { en: "behind schedule", es: "atrasado" },
       { en: "extend the deadline", es: "extender la fecha límite" },
       { en: "finish on time", es: "terminar a tiempo" },
       { en: "priority", es: "prioridad" },
       { en: "almost done", es: "casi listo" }
        ],
        frases: [
       { en: "Can you tell me more about deadline?", es: "¿Me puedes contar más sobre fecha límite?" },
       { en: "I'd like to talk about on track.", es: "Me gustaría hablar sobre en buen camino." },
       { en: "Do you know anything about extend the deadline?", es: "¿Sabes algo sobre extender la fecha límite?" },
       { en: "Can you explain priority to me, please?", es: "¿Me puedes explicar prioridad por favor?" },
       { en: "I want to ask you about deadline.", es: "Quiero preguntarte sobre fecha límite." },
       { en: "Let's go over on track together.", es: "Repasemos en buen camino juntos." }
        ]
       } },
  { id: "z7_r132", zona_id: 7, reto_id: 132, titulo: "Participar en una llamada de equipo", banco: {
        palabras: [
       { en: "team call", es: "llamada de equipo" },
       { en: "can you hear me", es: "me escuchas" },
       { en: "mute", es: "silenciar" },
       { en: "share screen", es: "compartir pantalla" },
       { en: "update", es: "actualización" },
       { en: "agenda item", es: "punto de agenda" },
       { en: "follow up", es: "dar seguimiento" },
       { en: "action item", es: "tarea pendiente" }
        ],
        frases: [
       { en: "Can you tell me more about team call?", es: "¿Me puedes contar más sobre llamada de equipo?" },
       { en: "I'd like to talk about mute.", es: "Me gustaría hablar sobre silenciar." },
       { en: "Do you know anything about update?", es: "¿Sabes algo sobre actualización?" },
       { en: "Can you explain follow up to me, please?", es: "¿Me puedes explicar dar seguimiento por favor?" },
       { en: "I want to ask you about team call.", es: "Quiero preguntarte sobre llamada de equipo." },
       { en: "Let's go over mute together.", es: "Repasemos silenciar juntos." }
        ]
       } },
  { id: "z7_r133", zona_id: 7, reto_id: 133, titulo: "Pedir capacitación", banco: {
        palabras: [
       { en: "training", es: "capacitación" },
       { en: "I'd like to learn", es: "me gustaría aprender" },
       { en: "course", es: "curso" },
       { en: "certification", es: "certificación" },
       { en: "skills", es: "habilidades" },
       { en: "budget for training", es: "presupuesto para capacitación" },
       { en: "workshop", es: "taller" },
       { en: "professional development", es: "desarrollo profesional" }
        ],
        frases: [
       { en: "Can you tell me more about training?", es: "¿Me puedes contar más sobre capacitación?" },
       { en: "I'd like to talk about course.", es: "Me gustaría hablar sobre curso." },
       { en: "Do you know anything about skills?", es: "¿Sabes algo sobre habilidades?" },
       { en: "Can you explain workshop to me, please?", es: "¿Me puedes explicar taller por favor?" },
       { en: "I want to ask you about training.", es: "Quiero preguntarte sobre capacitación." },
       { en: "Let's go over course together.", es: "Repasemos curso juntos." }
        ]
       } },
  { id: "z7_r134", zona_id: 7, reto_id: 134, titulo: "Hablar con tu jefe sobre una idea", banco: {
        palabras: [
       { en: "I have an idea", es: "tengo una idea" },
       { en: "do you have a minute", es: "tienes un minuto" },
       { en: "proposal", es: "propuesta" },
       { en: "benefit", es: "beneficio" },
       { en: "what do you think", es: "qué opinas" },
       { en: "worth trying", es: "vale la pena intentarlo" },
       { en: "budget", es: "presupuesto" },
       { en: "timeline", es: "cronograma" }
        ],
        frases: [
       { en: "Can you tell me more about I have an idea?", es: "¿Me puedes contar más sobre tengo una idea?" },
       { en: "I'd like to talk about proposal.", es: "Me gustaría hablar sobre propuesta." },
       { en: "Do you know anything about what do you think?", es: "¿Sabes algo sobre qué opinas?" },
       { en: "Can you explain budget to me, please?", es: "¿Me puedes explicar presupuesto por favor?" },
       { en: "I want to ask you about I have an idea.", es: "Quiero preguntarte sobre tengo una idea." },
       { en: "Let's go over proposal together.", es: "Repasemos propuesta juntos." }
        ]
       } },
  { id: "z7_r135", zona_id: 7, reto_id: 135, titulo: "Resolver un conflicto con un compañero", banco: {
        palabras: [
       { en: "conflict", es: "conflicto" },
       { en: "misunderstanding", es: "malentendido" },
       { en: "let's talk about it", es: "hablemos de eso" },
       { en: "I see your point", es: "entiendo tu punto" },
       { en: "compromise", es: "compromiso" },
       { en: "apologize", es: "disculparse" },
       { en: "resolve", es: "resolver" },
       { en: "moving forward", es: "de ahora en adelante" }
        ],
        frases: [
       { en: "Can you tell me more about conflict?", es: "¿Me puedes contar más sobre conflicto?" },
       { en: "I'd like to talk about let's talk about it.", es: "Me gustaría hablar sobre hablemos de eso." },
       { en: "Do you know anything about compromise?", es: "¿Sabes algo sobre compromiso?" },
       { en: "Can you explain resolve to me, please?", es: "¿Me puedes explicar resolver por favor?" },
       { en: "I want to ask you about conflict.", es: "Quiero preguntarte sobre conflicto." },
       { en: "Let's go over let's talk about it together.", es: "Repasemos hablemos de eso juntos." }
        ]
       } },
  { id: "z7_r136", zona_id: 7, reto_id: 136, titulo: "Pedir trabajar desde casa", banco: {
        palabras: [
       { en: "work from home", es: "trabajar desde casa" },
       { en: "remote work", es: "trabajo remoto" },
       { en: "request", es: "solicitar" },
       { en: "productive", es: "productivo" },
       { en: "internet connection", es: "conexión a internet" },
       { en: "flexible schedule", es: "horario flexible" },
       { en: "in-office days", es: "días en la oficina" },
       { en: "policy", es: "política" }
        ],
        frases: [
       { en: "Can you tell me more about work from home?", es: "¿Me puedes contar más sobre trabajar desde casa?" },
       { en: "I'd like to talk about request.", es: "Me gustaría hablar sobre solicitar." },
       { en: "Do you know anything about internet connection?", es: "¿Sabes algo sobre conexión a internet?" },
       { en: "Can you explain in-office days to me, please?", es: "¿Me puedes explicar días en la oficina por favor?" },
       { en: "I want to ask you about work from home.", es: "Quiero preguntarte sobre trabajar desde casa." },
       { en: "Let's go over request together.", es: "Repasemos solicitar juntos." }
        ]
       } },
  { id: "z7_r137", zona_id: 7, reto_id: 137, titulo: "Organizar tu agenda semanal", banco: {
        palabras: [
       { en: "weekly schedule", es: "agenda semanal" },
       { en: "priority", es: "prioridad" },
       { en: "calendar", es: "calendario" },
       { en: "block time", es: "bloquear tiempo" },
       { en: "task list", es: "lista de tareas" },
       { en: "meeting", es: "reunión" },
       { en: "free slot", es: "espacio libre" },
       { en: "plan ahead", es: "planear con anticipación" }
        ],
        frases: [
       { en: "Can you tell me more about weekly schedule?", es: "¿Me puedes contar más sobre agenda semanal?" },
       { en: "I'd like to talk about calendar.", es: "Me gustaría hablar sobre calendario." },
       { en: "Do you know anything about task list?", es: "¿Sabes algo sobre lista de tareas?" },
       { en: "Can you explain free slot to me, please?", es: "¿Me puedes explicar espacio libre por favor?" },
       { en: "I want to ask you about weekly schedule.", es: "Quiero preguntarte sobre agenda semanal." },
       { en: "Let's go over calendar together.", es: "Repasemos calendario juntos." }
        ]
       } },
  { id: "z7_r138", zona_id: 7, reto_id: 138, titulo: "Hablar de tus metas profesionales", banco: {
        palabras: [
       { en: "career goal", es: "meta profesional" },
       { en: "five-year plan", es: "plan a cinco años" },
       { en: "promotion", es: "ascenso" },
       { en: "new skills", es: "nuevas habilidades" },
       { en: "leadership role", es: "rol de liderazgo" },
       { en: "growth", es: "crecimiento" },
       { en: "ambitious", es: "ambicioso" },
       { en: "long term", es: "a largo plazo" }
        ],
        frases: [
       { en: "Can you tell me more about career goal?", es: "¿Me puedes contar más sobre meta profesional?" },
       { en: "I'd like to talk about promotion.", es: "Me gustaría hablar sobre ascenso." },
       { en: "Do you know anything about leadership role?", es: "¿Sabes algo sobre rol de liderazgo?" },
       { en: "Can you explain ambitious to me, please?", es: "¿Me puedes explicar ambicioso por favor?" },
       { en: "I want to ask you about career goal.", es: "Quiero preguntarte sobre meta profesional." },
       { en: "Let's go over promotion together.", es: "Repasemos ascenso juntos." }
        ]
       } },
  { id: "z7_r139", zona_id: 7, reto_id: 139, titulo: "Renunciar o avisar que te vas", banco: {
        palabras: [
       { en: "resign", es: "renunciar" },
       { en: "two weeks' notice", es: "aviso de dos semanas" },
       { en: "last day", es: "último día" },
       { en: "new opportunity", es: "nueva oportunidad" },
       { en: "thank you for the opportunity", es: "gracias por la oportunidad" },
       { en: "transition", es: "transición" },
       { en: "handover", es: "entrega de pendientes" },
       { en: "stay in touch", es: "mantenerse en contacto" }
        ],
        frases: [
       { en: "Can you tell me more about resign?", es: "¿Me puedes contar más sobre renunciar?" },
       { en: "I'd like to talk about last day.", es: "Me gustaría hablar sobre último día." },
       { en: "Do you know anything about thank you for the opportunity?", es: "¿Sabes algo sobre gracias por la oportunidad?" },
       { en: "Can you explain handover to me, please?", es: "¿Me puedes explicar entrega de pendientes por favor?" },
       { en: "I want to ask you about resign.", es: "Quiero preguntarte sobre renunciar." },
       { en: "Let's go over last day together.", es: "Repasemos último día juntos." }
        ]
       } },
  { id: "z7_r140", zona_id: 7, reto_id: 140, titulo: "Repaso: ambiente laboral", banco: {
        palabras: [
       { en: "meeting", es: "reunión" },
       { en: "email", es: "correo" },
       { en: "boss", es: "jefe" },
       { en: "deadline", es: "fecha límite" },
       { en: "team", es: "equipo" },
       { en: "feedback", es: "retroalimentación" },
       { en: "project", es: "proyecto" },
       { en: "training", es: "capacitación" }
        ],
        frases: [
       { en: "Can you tell me more about meeting?", es: "¿Me puedes contar más sobre reunión?" },
       { en: "I'd like to talk about boss.", es: "Me gustaría hablar sobre jefe." },
       { en: "Do you know anything about team?", es: "¿Sabes algo sobre equipo?" },
       { en: "Can you explain project to me, please?", es: "¿Me puedes explicar proyecto por favor?" },
       { en: "I want to ask you about meeting.", es: "Quiero preguntarte sobre reunión." },
       { en: "Let's go over boss together.", es: "Repasemos jefe juntos." }
        ]
       } },
  { id: "z8_r141", zona_id: 8, reto_id: 141, titulo: "Escribir un mensaje de texto", banco: {
        palabras: [
       { en: "text message", es: "mensaje de texto" },
       { en: "send", es: "enviar" },
       { en: "read receipt", es: "confirmación de lectura" },
       { en: "typing", es: "escribiendo" },
       { en: "reply", es: "responder" },
       { en: "emoji", es: "emoji" },
       { en: "group chat", es: "chat grupal" },
       { en: "voice message", es: "mensaje de voz" }
        ],
        frases: [
       { en: "Can you tell me more about text message?", es: "¿Me puedes contar más sobre mensaje de texto?" },
       { en: "I'd like to talk about read receipt.", es: "Me gustaría hablar sobre confirmación de lectura." },
       { en: "Do you know anything about reply?", es: "¿Sabes algo sobre responder?" },
       { en: "Can you explain group chat to me, please?", es: "¿Me puedes explicar chat grupal por favor?" },
       { en: "I want to ask you about text message.", es: "Quiero preguntarte sobre mensaje de texto." },
       { en: "Let's go over read receipt together.", es: "Repasemos confirmación de lectura juntos." }
        ]
       } },
  { id: "z8_r142", zona_id: 8, reto_id: 142, titulo: "Programar una videollamada", banco: {
        palabras: [
       { en: "video call", es: "videollamada" },
       { en: "schedule", es: "programar" },
       { en: "link", es: "enlace" },
       { en: "time zone", es: "zona horaria" },
       { en: "calendar invite", es: "invitación de calendario" },
       { en: "join the call", es: "unirse a la llamada" },
       { en: "reschedule", es: "reprogramar" },
       { en: "meeting ID", es: "ID de la reunión" }
        ],
        frases: [
       { en: "Can you tell me more about video call?", es: "¿Me puedes contar más sobre videollamada?" },
       { en: "I'd like to talk about link.", es: "Me gustaría hablar sobre enlace." },
       { en: "Do you know anything about calendar invite?", es: "¿Sabes algo sobre invitación de calendario?" },
       { en: "Can you explain reschedule to me, please?", es: "¿Me puedes explicar reprogramar por favor?" },
       { en: "I want to ask you about video call.", es: "Quiero preguntarte sobre videollamada." },
       { en: "Let's go over link together.", es: "Repasemos enlace juntos." }
        ]
       } },
  { id: "z8_r143", zona_id: 8, reto_id: 143, titulo: "Resolver un problema de wifi", banco: {
        palabras: [
       { en: "wifi", es: "wifi" },
       { en: "not connecting", es: "no conecta" },
       { en: "restart the router", es: "reiniciar el router" },
       { en: "slow connection", es: "conexión lenta" },
       { en: "password", es: "contraseña" },
       { en: "signal", es: "señal" },
       { en: "network", es: "red" },
       { en: "call the provider", es: "llamar al proveedor" }
        ],
        frases: [
       { en: "Can you tell me more about wifi?", es: "¿Me puedes contar más sobre wifi?" },
       { en: "I'd like to talk about restart the router.", es: "Me gustaría hablar sobre reiniciar el router." },
       { en: "Do you know anything about password?", es: "¿Sabes algo sobre contraseña?" },
       { en: "Can you explain network to me, please?", es: "¿Me puedes explicar red por favor?" },
       { en: "I want to ask you about wifi.", es: "Quiero preguntarte sobre wifi." },
       { en: "Let's go over restart the router together.", es: "Repasemos reiniciar el router juntos." }
        ]
       } },
  { id: "z8_r144", zona_id: 8, reto_id: 144, titulo: "Pedir ayuda técnica", banco: {
        palabras: [
       { en: "technical support", es: "soporte técnico" },
       { en: "it's not working", es: "no funciona" },
       { en: "troubleshoot", es: "solucionar problemas" },
       { en: "error code", es: "código de error" },
       { en: "restart", es: "reiniciar" },
       { en: "update", es: "actualizar" },
       { en: "ticket", es: "ticket de soporte" },
       { en: "remote assistance", es: "asistencia remota" }
        ],
        frases: [
       { en: "Can you tell me more about technical support?", es: "¿Me puedes contar más sobre soporte técnico?" },
       { en: "I'd like to talk about troubleshoot.", es: "Me gustaría hablar sobre solucionar problemas." },
       { en: "Do you know anything about restart?", es: "¿Sabes algo sobre reiniciar?" },
       { en: "Can you explain ticket to me, please?", es: "¿Me puedes explicar ticket de soporte por favor?" },
       { en: "I want to ask you about technical support.", es: "Quiero preguntarte sobre soporte técnico." },
       { en: "Let's go over troubleshoot together.", es: "Repasemos solucionar problemas juntos." }
        ]
       } },
  { id: "z8_r145", zona_id: 8, reto_id: 145, titulo: "Comentar en redes sociales", banco: {
        palabras: [
       { en: "comment", es: "comentario" },
       { en: "post", es: "publicación" },
       { en: "like", es: "me gusta" },
       { en: "share", es: "compartir" },
       { en: "follower", es: "seguidor" },
       { en: "profile", es: "perfil" },
       { en: "hashtag", es: "hashtag" },
       { en: "story", es: "historia" }
        ],
        frases: [
       { en: "Can you tell me more about comment?", es: "¿Me puedes contar más sobre comentario?" },
       { en: "I'd like to talk about like.", es: "Me gustaría hablar sobre me gusta." },
       { en: "Do you know anything about follower?", es: "¿Sabes algo sobre seguidor?" },
       { en: "Can you explain hashtag to me, please?", es: "¿Me puedes explicar hashtag por favor?" },
       { en: "I want to ask you about comment.", es: "Quiero preguntarte sobre comentario." },
       { en: "Let's go over like together.", es: "Repasemos me gusta juntos." }
        ]
       } },
  { id: "z8_r146", zona_id: 8, reto_id: 146, titulo: "Compartir un archivo", banco: {
        palabras: [
       { en: "file", es: "archivo" },
       { en: "attachment", es: "adjunto" },
       { en: "upload", es: "subir" },
       { en: "download", es: "descargar" },
       { en: "cloud storage", es: "almacenamiento en la nube" },
       { en: "link", es: "enlace" },
       { en: "permission", es: "permiso" },
       { en: "too large", es: "demasiado grande" }
        ],
        frases: [
       { en: "Can you tell me more about file?", es: "¿Me puedes contar más sobre archivo?" },
       { en: "I'd like to talk about upload.", es: "Me gustaría hablar sobre subir." },
       { en: "Do you know anything about cloud storage?", es: "¿Sabes algo sobre almacenamiento en la nube?" },
       { en: "Can you explain permission to me, please?", es: "¿Me puedes explicar permiso por favor?" },
       { en: "I want to ask you about file.", es: "Quiero preguntarte sobre archivo." },
       { en: "Let's go over upload together.", es: "Repasemos subir juntos." }
        ]
       } },
  { id: "z8_r147", zona_id: 8, reto_id: 147, titulo: "Actualizar una contraseña", banco: {
        palabras: [
       { en: "password", es: "contraseña" },
       { en: "change password", es: "cambiar contraseña" },
       { en: "forgot password", es: "olvidé la contraseña" },
       { en: "reset link", es: "enlace de restablecimiento" },
       { en: "strong password", es: "contraseña segura" },
       { en: "security question", es: "pregunta de seguridad" },
       { en: "two-factor", es: "doble factor" },
       { en: "confirm new password", es: "confirmar nueva contraseña" }
        ],
        frases: [
       { en: "Can you tell me more about password?", es: "¿Me puedes contar más sobre contraseña?" },
       { en: "I'd like to talk about forgot password.", es: "Me gustaría hablar sobre olvidé la contraseña." },
       { en: "Do you know anything about strong password?", es: "¿Sabes algo sobre contraseña segura?" },
       { en: "Can you explain two-factor to me, please?", es: "¿Me puedes explicar doble factor por favor?" },
       { en: "I want to ask you about password.", es: "Quiero preguntarte sobre contraseña." },
       { en: "Let's go over forgot password together.", es: "Repasemos olvidé la contraseña juntos." }
        ]
       } },
  { id: "z8_r148", zona_id: 8, reto_id: 148, titulo: "Reportar una cuenta hackeada", banco: {
        palabras: [
       { en: "hacked account", es: "cuenta hackeada" },
       { en: "suspicious activity", es: "actividad sospechosa" },
       { en: "report", es: "reportar" },
       { en: "recover account", es: "recuperar cuenta" },
       { en: "unauthorized access", es: "acceso no autorizado" },
       { en: "change password immediately", es: "cambiar contraseña de inmediato" },
       { en: "verify identity", es: "verificar identidad" },
       { en: "support team", es: "equipo de soporte" }
        ],
        frases: [
       { en: "Can you tell me more about hacked account?", es: "¿Me puedes contar más sobre cuenta hackeada?" },
       { en: "I'd like to talk about report.", es: "Me gustaría hablar sobre reportar." },
       { en: "Do you know anything about unauthorized access?", es: "¿Sabes algo sobre acceso no autorizado?" },
       { en: "Can you explain verify identity to me, please?", es: "¿Me puedes explicar verificar identidad por favor?" },
       { en: "I want to ask you about hacked account.", es: "Quiero preguntarte sobre cuenta hackeada." },
       { en: "Let's go over report together.", es: "Repasemos reportar juntos." }
        ]
       } },
  { id: "z8_r149", zona_id: 8, reto_id: 149, titulo: "Configurar una app nueva", banco: {
        palabras: [
       { en: "set up", es: "configurar" },
       { en: "create an account", es: "crear una cuenta" },
       { en: "permissions", es: "permisos" },
       { en: "notifications", es: "notificaciones" },
       { en: "sign in", es: "iniciar sesión" },
       { en: "terms of service", es: "términos de servicio" },
       { en: "profile picture", es: "foto de perfil" },
       { en: "tutorial", es: "tutorial" }
        ],
        frases: [
       { en: "Can you tell me more about set up?", es: "¿Me puedes contar más sobre configurar?" },
       { en: "I'd like to talk about permissions.", es: "Me gustaría hablar sobre permisos." },
       { en: "Do you know anything about sign in?", es: "¿Sabes algo sobre iniciar sesión?" },
       { en: "Can you explain profile picture to me, please?", es: "¿Me puedes explicar foto de perfil por favor?" },
       { en: "I want to ask you about set up.", es: "Quiero preguntarte sobre configurar." },
       { en: "Let's go over permissions together.", es: "Repasemos permisos juntos." }
        ]
       } },
  { id: "z8_r150", zona_id: 8, reto_id: 150, titulo: "Explicar un error en la pantalla", banco: {
        palabras: [
       { en: "error message", es: "mensaje de error" },
       { en: "screen froze", es: "la pantalla se congeló" },
       { en: "crash", es: "falla" },
       { en: "blue screen", es: "pantalla azul" },
       { en: "won't open", es: "no abre" },
       { en: "keeps closing", es: "se sigue cerrando" },
       { en: "reinstall", es: "reinstalar" },
       { en: "report the bug", es: "reportar el error" }
        ],
        frases: [
       { en: "Can you tell me more about error message?", es: "¿Me puedes contar más sobre mensaje de error?" },
       { en: "I'd like to talk about crash.", es: "Me gustaría hablar sobre falla." },
       { en: "Do you know anything about won't open?", es: "¿Sabes algo sobre no abre?" },
       { en: "Can you explain reinstall to me, please?", es: "¿Me puedes explicar reinstalar por favor?" },
       { en: "I want to ask you about error message.", es: "Quiero preguntarte sobre mensaje de error." },
       { en: "Let's go over crash together.", es: "Repasemos falla juntos." }
        ]
       } },
  { id: "z8_r151", zona_id: 8, reto_id: 151, titulo: "Pedir que silencien el micrófono", banco: {
        palabras: [
       { en: "mute your microphone", es: "silencia tu micrófono" },
       { en: "background noise", es: "ruido de fondo" },
       { en: "echo", es: "eco" },
       { en: "can you hear me", es: "me escuchas" },
       { en: "you're muted", es: "estás silenciado" },
       { en: "unmute", es: "quitar el silencio" },
       { en: "feedback", es: "retroalimentación de audio" },
       { en: "better now", es: "mejor ahora" }
        ],
        frases: [
       { en: "Can you tell me more about mute your microphone?", es: "¿Me puedes contar más sobre silencia tu micrófono?" },
       { en: "I'd like to talk about echo.", es: "Me gustaría hablar sobre eco." },
       { en: "Do you know anything about you're muted?", es: "¿Sabes algo sobre estás silenciado?" },
       { en: "Can you explain feedback to me, please?", es: "¿Me puedes explicar retroalimentación de audio por favor?" },
       { en: "I want to ask you about mute your microphone.", es: "Quiero preguntarte sobre silencia tu micrófono." },
       { en: "Let's go over echo together.", es: "Repasemos eco juntos." }
        ]
       } },
  { id: "z8_r152", zona_id: 8, reto_id: 152, titulo: "Compartir pantalla en una llamada", banco: {
        palabras: [
       { en: "share your screen", es: "comparte tu pantalla" },
       { en: "can you see this", es: "puedes ver esto" },
       { en: "stop sharing", es: "dejar de compartir" },
       { en: "zoom in", es: "acercar" },
       { en: "full screen", es: "pantalla completa" },
       { en: "presenter", es: "presentador" },
       { en: "this slide", es: "esta diapositiva" },
       { en: "next slide", es: "siguiente diapositiva" }
        ],
        frases: [
       { en: "Can you tell me more about share your screen?", es: "¿Me puedes contar más sobre comparte tu pantalla?" },
       { en: "I'd like to talk about stop sharing.", es: "Me gustaría hablar sobre dejar de compartir." },
       { en: "Do you know anything about full screen?", es: "¿Sabes algo sobre pantalla completa?" },
       { en: "Can you explain this slide to me, please?", es: "¿Me puedes explicar esta diapositiva por favor?" },
       { en: "I want to ask you about share your screen.", es: "Quiero preguntarte sobre comparte tu pantalla." },
       { en: "Let's go over stop sharing together.", es: "Repasemos dejar de compartir juntos." }
        ]
       } },
  { id: "z8_r153", zona_id: 8, reto_id: 153, titulo: "Cancelar una suscripción", banco: {
        palabras: [
       { en: "subscription", es: "suscripción" },
       { en: "cancel", es: "cancelar" },
       { en: "billing cycle", es: "ciclo de facturación" },
       { en: "refund", es: "reembolso" },
       { en: "auto-renew", es: "renovación automática" },
       { en: "free trial", es: "prueba gratis" },
       { en: "confirmation email", es: "correo de confirmación" },
       { en: "downgrade", es: "bajar de plan" }
        ],
        frases: [
       { en: "Can you tell me more about subscription?", es: "¿Me puedes contar más sobre suscripción?" },
       { en: "I'd like to talk about billing cycle.", es: "Me gustaría hablar sobre ciclo de facturación." },
       { en: "Do you know anything about auto-renew?", es: "¿Sabes algo sobre renovación automática?" },
       { en: "Can you explain confirmation email to me, please?", es: "¿Me puedes explicar correo de confirmación por favor?" },
       { en: "I want to ask you about subscription.", es: "Quiero preguntarte sobre suscripción." },
       { en: "Let's go over billing cycle together.", es: "Repasemos ciclo de facturación juntos." }
        ]
       } },
  { id: "z8_r154", zona_id: 8, reto_id: 154, titulo: "Hacer una compra en línea", banco: {
        palabras: [
       { en: "online purchase", es: "compra en línea" },
       { en: "add to cart", es: "agregar al carrito" },
       { en: "checkout", es: "pagar" },
       { en: "shipping address", es: "dirección de envío" },
       { en: "payment method", es: "método de pago" },
       { en: "promo code", es: "código de descuento" },
       { en: "order confirmation", es: "confirmación de pedido" },
       { en: "estimated delivery", es: "entrega estimada" }
        ],
        frases: [
       { en: "Can you tell me more about online purchase?", es: "¿Me puedes contar más sobre compra en línea?" },
       { en: "I'd like to talk about checkout.", es: "Me gustaría hablar sobre pagar." },
       { en: "Do you know anything about payment method?", es: "¿Sabes algo sobre método de pago?" },
       { en: "Can you explain order confirmation to me, please?", es: "¿Me puedes explicar confirmación de pedido por favor?" },
       { en: "I want to ask you about online purchase.", es: "Quiero preguntarte sobre compra en línea." },
       { en: "Let's go over checkout together.", es: "Repasemos pagar juntos." }
        ]
       } },
  { id: "z8_r155", zona_id: 8, reto_id: 155, titulo: "Rastrear un pedido", banco: {
        palabras: [
       { en: "tracking number", es: "número de rastreo" },
       { en: "track my order", es: "rastrear mi pedido" },
       { en: "in transit", es: "en tránsito" },
       { en: "delivered", es: "entregado" },
       { en: "delayed", es: "retrasado" },
       { en: "carrier", es: "transportista" },
       { en: "estimated date", es: "fecha estimada" },
       { en: "package", es: "paquete" }
        ],
        frases: [
       { en: "Can you tell me more about tracking number?", es: "¿Me puedes contar más sobre número de rastreo?" },
       { en: "I'd like to talk about in transit.", es: "Me gustaría hablar sobre en tránsito." },
       { en: "Do you know anything about delayed?", es: "¿Sabes algo sobre retrasado?" },
       { en: "Can you explain estimated date to me, please?", es: "¿Me puedes explicar fecha estimada por favor?" },
       { en: "I want to ask you about tracking number.", es: "Quiero preguntarte sobre número de rastreo." },
       { en: "Let's go over in transit together.", es: "Repasemos en tránsito juntos." }
        ]
       } },
  { id: "z8_r156", zona_id: 8, reto_id: 156, titulo: "Dejar una reseña en línea", banco: {
        palabras: [
       { en: "review", es: "reseña" },
       { en: "rating", es: "calificación" },
       { en: "five stars", es: "cinco estrellas" },
       { en: "write a review", es: "escribir una reseña" },
       { en: "recommend", es: "recomendar" },
       { en: "honest feedback", es: "opinión honesta" },
       { en: "photo review", es: "reseña con foto" },
       { en: "helpful", es: "útil" }
        ],
        frases: [
       { en: "Can you tell me more about review?", es: "¿Me puedes contar más sobre reseña?" },
       { en: "I'd like to talk about five stars.", es: "Me gustaría hablar sobre cinco estrellas." },
       { en: "Do you know anything about recommend?", es: "¿Sabes algo sobre recomendar?" },
       { en: "Can you explain photo review to me, please?", es: "¿Me puedes explicar reseña con foto por favor?" },
       { en: "I want to ask you about review.", es: "Quiero preguntarte sobre reseña." },
       { en: "Let's go over five stars together.", es: "Repasemos cinco estrellas juntos." }
        ]
       } },
  { id: "z8_r157", zona_id: 8, reto_id: 157, titulo: "Pedir reembolso de una compra", banco: {
        palabras: [
       { en: "refund", es: "reembolso" },
       { en: "return policy", es: "política de devoluciones" },
       { en: "defective", es: "defectuoso" },
       { en: "wrong item", es: "artículo equivocado" },
       { en: "store credit", es: "crédito en tienda" },
       { en: "proof of purchase", es: "comprobante de compra" },
       { en: "processing time", es: "tiempo de proceso" },
       { en: "exchange", es: "cambio" }
        ],
        frases: [
       { en: "Can you tell me more about refund?", es: "¿Me puedes contar más sobre reembolso?" },
       { en: "I'd like to talk about defective.", es: "Me gustaría hablar sobre defectuoso." },
       { en: "Do you know anything about store credit?", es: "¿Sabes algo sobre crédito en tienda?" },
       { en: "Can you explain processing time to me, please?", es: "¿Me puedes explicar tiempo de proceso por favor?" },
       { en: "I want to ask you about refund.", es: "Quiero preguntarte sobre reembolso." },
       { en: "Let's go over defective together.", es: "Repasemos defectuoso juntos." }
        ]
       } },
  { id: "z8_r158", zona_id: 8, reto_id: 158, titulo: "Explicar que el enlace no funciona", banco: {
        palabras: [
       { en: "broken link", es: "enlace roto" },
       { en: "page not found", es: "página no encontrada" },
       { en: "doesn't open", es: "no abre" },
       { en: "expired link", es: "enlace vencido" },
       { en: "try again later", es: "intenta de nuevo más tarde" },
       { en: "clear cache", es: "borrar caché" },
       { en: "different browser", es: "navegador diferente" },
       { en: "report the issue", es: "reportar el problema" }
        ],
        frases: [
       { en: "Can you tell me more about broken link?", es: "¿Me puedes contar más sobre enlace roto?" },
       { en: "I'd like to talk about doesn't open.", es: "Me gustaría hablar sobre no abre." },
       { en: "Do you know anything about try again later?", es: "¿Sabes algo sobre intenta de nuevo más tarde?" },
       { en: "Can you explain different browser to me, please?", es: "¿Me puedes explicar navegador diferente por favor?" },
       { en: "I want to ask you about broken link.", es: "Quiero preguntarte sobre enlace roto." },
       { en: "Let's go over doesn't open together.", es: "Repasemos no abre juntos." }
        ]
       } },
  { id: "z8_r159", zona_id: 8, reto_id: 159, titulo: "Hacer una videollamada familiar", banco: {
        palabras: [
       { en: "video call", es: "videollamada" },
       { en: "can everyone see me", es: "todos me pueden ver" },
       { en: "say hi to", es: "saluda a" },
       { en: "camera is off", es: "la cámara está apagada" },
       { en: "turn on your camera", es: "prende tu cámara" },
       { en: "connection is bad", es: "la conexión está mala" },
       { en: "talk soon", es: "hablamos pronto" },
       { en: "love you all", es: "los quiero a todos" }
        ],
        frases: [
       { en: "Can you tell me more about video call?", es: "¿Me puedes contar más sobre videollamada?" },
       { en: "I'd like to talk about say hi to.", es: "Me gustaría hablar sobre saluda a." },
       { en: "Do you know anything about turn on your camera?", es: "¿Sabes algo sobre prende tu cámara?" },
       { en: "Can you explain talk soon to me, please?", es: "¿Me puedes explicar hablamos pronto por favor?" },
       { en: "I want to ask you about video call.", es: "Quiero preguntarte sobre videollamada." },
       { en: "Let's go over say hi to together.", es: "Repasemos saluda a juntos." }
        ]
       } },
  { id: "z8_r160", zona_id: 8, reto_id: 160, titulo: "Repaso: vida digital", banco: {
        palabras: [
       { en: "password", es: "contraseña" },
       { en: "wifi", es: "wifi" },
       { en: "app", es: "aplicación" },
       { en: "message", es: "mensaje" },
       { en: "account", es: "cuenta" },
       { en: "file", es: "archivo" },
       { en: "update", es: "actualizar" },
       { en: "video call", es: "videollamada" }
        ],
        frases: [
       { en: "Can you tell me more about password?", es: "¿Me puedes contar más sobre contraseña?" },
       { en: "I'd like to talk about app.", es: "Me gustaría hablar sobre aplicación." },
       { en: "Do you know anything about account?", es: "¿Sabes algo sobre cuenta?" },
       { en: "Can you explain update to me, please?", es: "¿Me puedes explicar actualizar por favor?" },
       { en: "I want to ask you about password.", es: "Quiero preguntarte sobre contraseña." },
       { en: "Let's go over app together.", es: "Repasemos aplicación juntos." }
        ]
       } },
  { id: "clima", zona_id: 9, reto_id: 161, titulo: "Hablar del clima", banco: {
        palabras: [
       { en: "rain", es: "lluvia" },
       { en: "cloudy", es: "nublado" },
       { en: "sunny", es: "soleado" },
       { en: "cold", es: "frío" },
       { en: "hot", es: "caluroso" },
       { en: "wind", es: "viento" },
       { en: "snow", es: "nieve" },
       { en: "umbrella", es: "paraguas" }
        ],
        frases: [
       { en: "It looks like it's going to rain.", es: "Parece que va a llover." },
       { en: "It's going to rain.", es: "Va a llover." },
       { en: "It's very sunny today.", es: "Está muy soleado hoy." },
       { en: "It's cold outside.", es: "Hace frío afuera." },
       { en: "Don't forget your umbrella.", es: "No olvides tu paraguas." },
       { en: "It might snow tonight.", es: "Podría nevar esta noche." }
        ]
       } },
  { id: "smalltalk", zona_id: 9, reto_id: 162, titulo: "Small talk rápido", banco: {
        palabras: [
       { en: "how have you been", es: "cómo has estado" },
       { en: "same as always", es: "igual que siempre" },
       { en: "anything new", es: "algo nuevo" },
       { en: "not much", es: "no mucho" },
       { en: "weekend", es: "fin de semana" },
       { en: "busy", es: "ocupado" },
       { en: "tired", es: "cansado" },
       { en: "great", es: "genial" }
        ],
        frases: [
       { en: "So, how have you been?", es: "Entonces, ¿cómo has estado?" },
       { en: "Not much, same as always.", es: "No mucho, igual que siempre." },
       { en: "Anything new with you?", es: "¿Algo nuevo contigo?" },
       { en: "How was your weekend?", es: "¿Cómo estuvo tu fin de semana?" },
       { en: "I've been a little tired.", es: "He estado un poco cansado." },
       { en: "That sounds great!", es: "¡Eso suena genial!" }
        ]
       } },
  { id: "llamada", zona_id: 9, reto_id: 163, titulo: "Una llamada rápida", banco: {
        palabras: [
       { en: "call back", es: "regresar la llamada" },
       { en: "busy", es: "ocupado" },
       { en: "minute", es: "minuto" },
       { en: "hold on", es: "espera" },
       { en: "voicemail", es: "buzón de voz" },
       { en: "number", es: "número" },
       { en: "later", es: "más tarde" },
       { en: "message", es: "mensaje" }
        ],
        frases: [
       { en: "Can I call you back in five minutes?", es: "¿Te puedo llamar de vuelta en cinco minutos?" },
       { en: "Can I call you back?", es: "¿Te puedo llamar de vuelta?" },
       { en: "I'm a little busy right now.", es: "Estoy un poco ocupado ahora." },
       { en: "Can you hold on a minute?", es: "¿Puedes esperar un minuto?" },
       { en: "Leave a message after the beep.", es: "Deja un mensaje después del tono." },
       { en: "I'll call you later.", es: "Te llamo más tarde." }
        ]
       } },
  { id: "z9_r164", zona_id: 9, reto_id: 164, titulo: "Describir tu rutina diaria", banco: {
        palabras: [
       { en: "wake up", es: "despertar" },
       { en: "get ready", es: "prepararse" },
       { en: "commute", es: "trasladarse" },
       { en: "routine", es: "rutina" },
       { en: "usually", es: "usualmente" },
       { en: "before work", es: "antes del trabajo" },
       { en: "after dinner", es: "después de cenar" },
       { en: "go to bed", es: "ir a dormir" }
        ],
        frases: [
       { en: "Can you tell me more about wake up?", es: "¿Me puedes contar más sobre despertar?" },
       { en: "I'd like to talk about commute.", es: "Me gustaría hablar sobre trasladarse." },
       { en: "Do you know anything about usually?", es: "¿Sabes algo sobre usualmente?" },
       { en: "Can you explain after dinner to me, please?", es: "¿Me puedes explicar después de cenar por favor?" },
       { en: "I want to ask you about wake up.", es: "Quiero preguntarte sobre despertar." },
       { en: "Let's go over commute together.", es: "Repasemos trasladarse juntos." }
        ]
       } },
  { id: "z9_r165", zona_id: 9, reto_id: 165, titulo: "Hablar de tus planes para hoy", banco: {
        palabras: [
       { en: "today's plan", es: "plan de hoy" },
       { en: "later today", es: "más tarde hoy" },
       { en: "right after this", es: "justo después de esto" },
       { en: "errand", es: "mandado" },
       { en: "busy day", es: "día ocupado" },
       { en: "free this afternoon", es: "libre esta tarde" },
       { en: "appointment", es: "cita" },
       { en: "nothing planned", es: "sin planes" }
        ],
        frases: [
       { en: "Can you tell me more about today's plan?", es: "¿Me puedes contar más sobre plan de hoy?" },
       { en: "I'd like to talk about right after this.", es: "Me gustaría hablar sobre justo después de esto." },
       { en: "Do you know anything about busy day?", es: "¿Sabes algo sobre día ocupado?" },
       { en: "Can you explain appointment to me, please?", es: "¿Me puedes explicar cita por favor?" },
       { en: "I want to ask you about today's plan.", es: "Quiero preguntarte sobre plan de hoy." },
       { en: "Let's go over right after this together.", es: "Repasemos justo después de esto juntos." }
        ]
       } },
  { id: "z9_r166", zona_id: 9, reto_id: 166, titulo: "Comentar las noticias", banco: {
        palabras: [
       { en: "news", es: "noticias" },
       { en: "did you hear about", es: "escuchaste sobre" },
       { en: "headline", es: "titular" },
       { en: "breaking news", es: "noticia de última hora" },
       { en: "according to", es: "según" },
       { en: "source", es: "fuente" },
       { en: "opinion", es: "opinión" },
       { en: "crazy story", es: "historia increíble" }
        ],
        frases: [
       { en: "Can you tell me more about news?", es: "¿Me puedes contar más sobre noticias?" },
       { en: "I'd like to talk about headline.", es: "Me gustaría hablar sobre titular." },
       { en: "Do you know anything about according to?", es: "¿Sabes algo sobre según?" },
       { en: "Can you explain opinion to me, please?", es: "¿Me puedes explicar opinión por favor?" },
       { en: "I want to ask you about news.", es: "Quiero preguntarte sobre noticias." },
       { en: "Let's go over headline together.", es: "Repasemos titular juntos." }
        ]
       } },
  { id: "z9_r167", zona_id: 9, reto_id: 167, titulo: "Hablar de tu fin de semana", banco: {
        palabras: [
       { en: "weekend", es: "fin de semana" },
       { en: "how was your weekend", es: "cómo estuvo tu fin de semana" },
       { en: "relaxing", es: "relajante" },
       { en: "busy", es: "ocupado" },
       { en: "went out", es: "salí" },
       { en: "stayed home", es: "me quedé en casa" },
       { en: "pretty good", es: "bastante bien" },
       { en: "nothing special", es: "nada especial" }
        ],
        frases: [
       { en: "Can you tell me more about weekend?", es: "¿Me puedes contar más sobre fin de semana?" },
       { en: "I'd like to talk about relaxing.", es: "Me gustaría hablar sobre relajante." },
       { en: "Do you know anything about went out?", es: "¿Sabes algo sobre salí?" },
       { en: "Can you explain pretty good to me, please?", es: "¿Me puedes explicar bastante bien por favor?" },
       { en: "I want to ask you about weekend.", es: "Quiero preguntarte sobre fin de semana." },
       { en: "Let's go over relaxing together.", es: "Repasemos relajante juntos." }
        ]
       } },
  { id: "z9_r168", zona_id: 9, reto_id: 168, titulo: "Dar tu opinión sobre algo", banco: {
        palabras: [
       { en: "opinion", es: "opinión" },
       { en: "in my opinion", es: "en mi opinión" },
       { en: "I think that", es: "creo que" },
       { en: "I'm not sure", es: "no estoy seguro" },
       { en: "personally", es: "personalmente" },
       { en: "it depends", es: "depende" },
       { en: "I disagree", es: "no estoy de acuerdo" },
       { en: "that makes sense", es: "eso tiene sentido" }
        ],
        frases: [
       { en: "Can you tell me more about opinion?", es: "¿Me puedes contar más sobre opinión?" },
       { en: "I'd like to talk about I think that.", es: "Me gustaría hablar sobre creo que." },
       { en: "Do you know anything about personally?", es: "¿Sabes algo sobre personalmente?" },
       { en: "Can you explain I disagree to me, please?", es: "¿Me puedes explicar no estoy de acuerdo por favor?" },
       { en: "I want to ask you about opinion.", es: "Quiero preguntarte sobre opinión." },
       { en: "Let's go over I think that together.", es: "Repasemos creo que juntos." }
        ]
       } },
  { id: "z9_r169", zona_id: 9, reto_id: 169, titulo: "Hacer una queja educada", banco: {
        palabras: [
       { en: "complaint", es: "queja" },
       { en: "I'm sorry to say", es: "lamento decir" },
       { en: "this isn't quite right", es: "esto no está del todo bien" },
       { en: "could you please", es: "podrías por favor" },
       { en: "I'd appreciate it if", es: "agradecería si" },
       { en: "minor issue", es: "problema menor" },
       { en: "no big deal, but", es: "no es gran cosa, pero" },
       { en: "thanks for understanding", es: "gracias por entender" }
        ],
        frases: [
       { en: "Can you tell me more about complaint?", es: "¿Me puedes contar más sobre queja?" },
       { en: "I'd like to talk about this isn't quite right.", es: "Me gustaría hablar sobre esto no está del todo bien." },
       { en: "Do you know anything about I'd appreciate it if?", es: "¿Sabes algo sobre agradecería si?" },
       { en: "Can you explain no big deal, but to me, please?", es: "¿Me puedes explicar no es gran cosa, pero por favor?" },
       { en: "I want to ask you about complaint.", es: "Quiero preguntarte sobre queja." },
       { en: "Let's go over this isn't quite right together.", es: "Repasemos esto no está del todo bien juntos." }
        ]
       } },
  { id: "z9_r170", zona_id: 9, reto_id: 170, titulo: "Dar consejos a un amigo", banco: {
        palabras: [
       { en: "advice", es: "consejo" },
       { en: "you should", es: "deberías" },
       { en: "if I were you", es: "si yo fuera tú" },
       { en: "why don't you", es: "por qué no" },
       { en: "it might help to", es: "podría ayudar" },
       { en: "just a suggestion", es: "solo una sugerencia" },
       { en: "take it easy", es: "tómatelo con calma" },
       { en: "good luck", es: "buena suerte" }
        ],
        frases: [
       { en: "Can you tell me more about advice?", es: "¿Me puedes contar más sobre consejo?" },
       { en: "I'd like to talk about if I were you.", es: "Me gustaría hablar sobre si yo fuera tú." },
       { en: "Do you know anything about it might help to?", es: "¿Sabes algo sobre podría ayudar?" },
       { en: "Can you explain take it easy to me, please?", es: "¿Me puedes explicar tómatelo con calma por favor?" },
       { en: "I want to ask you about advice.", es: "Quiero preguntarte sobre consejo." },
       { en: "Let's go over if I were you together.", es: "Repasemos si yo fuera tú juntos." }
        ]
       } },
  { id: "z9_r171", zona_id: 9, reto_id: 171, titulo: "Hablar de un hábito que quieres cambiar", banco: {
        palabras: [
       { en: "habit", es: "hábito" },
       { en: "I'm trying to", es: "estoy tratando de" },
       { en: "quit", es: "dejar" },
       { en: "cut back on", es: "reducir" },
       { en: "bad habit", es: "mal hábito" },
       { en: "hard to break", es: "difícil de romper" },
       { en: "little by little", es: "poco a poco" },
       { en: "so far so good", es: "hasta ahora bien" }
        ],
        frases: [
       { en: "Can you tell me more about habit?", es: "¿Me puedes contar más sobre hábito?" },
       { en: "I'd like to talk about quit.", es: "Me gustaría hablar sobre dejar." },
       { en: "Do you know anything about bad habit?", es: "¿Sabes algo sobre mal hábito?" },
       { en: "Can you explain little by little to me, please?", es: "¿Me puedes explicar poco a poco por favor?" },
       { en: "I want to ask you about habit.", es: "Quiero preguntarte sobre hábito." },
       { en: "Let's go over quit together.", es: "Repasemos dejar juntos." }
        ]
       } },
  { id: "z9_r172", zona_id: 9, reto_id: 172, titulo: "Expresar que estás de acuerdo o no", banco: {
        palabras: [
       { en: "I agree", es: "estoy de acuerdo" },
       { en: "I disagree", es: "no estoy de acuerdo" },
       { en: "that's true", es: "eso es cierto" },
       { en: "not necessarily", es: "no necesariamente" },
       { en: "good point", es: "buen punto" },
       { en: "I see it differently", es: "lo veo diferente" },
       { en: "exactly", es: "exactamente" },
       { en: "not really", es: "no realmente" }
        ],
        frases: [
       { en: "Can you tell me more about I agree?", es: "¿Me puedes contar más sobre estoy de acuerdo?" },
       { en: "I'd like to talk about that's true.", es: "Me gustaría hablar sobre eso es cierto." },
       { en: "Do you know anything about good point?", es: "¿Sabes algo sobre buen punto?" },
       { en: "Can you explain exactly to me, please?", es: "¿Me puedes explicar exactamente por favor?" },
       { en: "I want to ask you about I agree.", es: "Quiero preguntarte sobre estoy de acuerdo." },
       { en: "Let's go over that's true together.", es: "Repasemos eso es cierto juntos." }
        ]
       } },
  { id: "z9_r173", zona_id: 9, reto_id: 173, titulo: "Hablar de tus comidas favoritas", banco: {
        palabras: [
       { en: "favorite food", es: "comida favorita" },
       { en: "I love eating", es: "me encanta comer" },
       { en: "homemade", es: "hecho en casa" },
       { en: "comfort food", es: "comida reconfortante" },
       { en: "my mom's recipe", es: "la receta de mi mamá" },
       { en: "can't get enough of", es: "no me canso de" },
       { en: "try it sometime", es: "pruébalo algún día" },
       { en: "delicious", es: "delicioso" }
        ],
        frases: [
       { en: "Can you tell me more about favorite food?", es: "¿Me puedes contar más sobre comida favorita?" },
       { en: "I'd like to talk about homemade.", es: "Me gustaría hablar sobre hecho en casa." },
       { en: "Do you know anything about my mom's recipe?", es: "¿Sabes algo sobre la receta de mi mamá?" },
       { en: "Can you explain try it sometime to me, please?", es: "¿Me puedes explicar pruébalo algún día por favor?" },
       { en: "I want to ask you about favorite food.", es: "Quiero preguntarte sobre comida favorita." },
       { en: "Let's go over homemade together.", es: "Repasemos hecho en casa juntos." }
        ]
       } },
  { id: "z9_r174", zona_id: 9, reto_id: 174, titulo: "Contar una anécdota breve", banco: {
        palabras: [
       { en: "funny story", es: "historia graciosa" },
       { en: "you won't believe", es: "no vas a creer" },
       { en: "so this happened", es: "entonces pasó esto" },
       { en: "out of nowhere", es: "de la nada" },
       { en: "I couldn't stop laughing", es: "no podía dejar de reír" },
       { en: "long story short", es: "para resumir" },
       { en: "true story", es: "historia real" },
       { en: "can you imagine", es: "te imaginas" }
        ],
        frases: [
       { en: "Can you tell me more about funny story?", es: "¿Me puedes contar más sobre historia graciosa?" },
       { en: "I'd like to talk about so this happened.", es: "Me gustaría hablar sobre entonces pasó esto." },
       { en: "Do you know anything about I couldn't stop laughing?", es: "¿Sabes algo sobre no podía dejar de reír?" },
       { en: "Can you explain true story to me, please?", es: "¿Me puedes explicar historia real por favor?" },
       { en: "I want to ask you about funny story.", es: "Quiero preguntarte sobre historia graciosa." },
       { en: "Let's go over so this happened together.", es: "Repasemos entonces pasó esto juntos." }
        ]
       } },
  { id: "z9_r175", zona_id: 9, reto_id: 175, titulo: "Hablar del tráfico o el clima laboral", banco: {
        palabras: [
       { en: "traffic was terrible", es: "el tráfico estaba terrible" },
       { en: "office mood", es: "ambiente de oficina" },
       { en: "stressful week", es: "semana estresante" },
       { en: "busy season at work", es: "temporada ocupada en el trabajo" },
       { en: "long commute", es: "traslado largo" },
       { en: "tense atmosphere", es: "ambiente tenso" },
       { en: "things calmed down", es: "las cosas se calmaron" },
       { en: "back to normal", es: "de vuelta a la normalidad" }
        ],
        frases: [
       { en: "Can you tell me more about traffic was terrible?", es: "¿Me puedes contar más sobre el tráfico estaba terrible?" },
       { en: "I'd like to talk about stressful week.", es: "Me gustaría hablar sobre semana estresante." },
       { en: "Do you know anything about long commute?", es: "¿Sabes algo sobre traslado largo?" },
       { en: "Can you explain things calmed down to me, please?", es: "¿Me puedes explicar las cosas se calmaron por favor?" },
       { en: "I want to ask you about traffic was terrible.", es: "Quiero preguntarte sobre el tráfico estaba terrible." },
       { en: "Let's go over stressful week together.", es: "Repasemos semana estresante juntos." }
        ]
       } },
  { id: "z9_r176", zona_id: 9, reto_id: 176, titulo: "Hacer planes a futuro", banco: {
        palabras: [
       { en: "future plans", es: "planes a futuro" },
       { en: "someday", es: "algún día" },
       { en: "eventually", es: "eventualmente" },
       { en: "next year", es: "el próximo año" },
       { en: "thinking about", es: "pensando en" },
       { en: "save up for", es: "ahorrar para" },
       { en: "dream of", es: "soñar con" },
       { en: "long term goal", es: "meta a largo plazo" }
        ],
        frases: [
       { en: "Can you tell me more about future plans?", es: "¿Me puedes contar más sobre planes a futuro?" },
       { en: "I'd like to talk about eventually.", es: "Me gustaría hablar sobre eventualmente." },
       { en: "Do you know anything about thinking about?", es: "¿Sabes algo sobre pensando en?" },
       { en: "Can you explain dream of to me, please?", es: "¿Me puedes explicar soñar con por favor?" },
       { en: "I want to ask you about future plans.", es: "Quiero preguntarte sobre planes a futuro." },
       { en: "Let's go over eventually together.", es: "Repasemos eventualmente juntos." }
        ]
       } },
  { id: "z9_r177", zona_id: 9, reto_id: 177, titulo: "Hablar de tus metas personales", banco: {
        palabras: [
       { en: "personal goal", es: "meta personal" },
       { en: "working on myself", es: "trabajando en mí mismo" },
       { en: "self-improvement", es: "superación personal" },
       { en: "learn a new skill", es: "aprender una nueva habilidad" },
       { en: "challenge myself", es: "retarme a mí mismo" },
       { en: "progress", es: "progreso" },
       { en: "proud of how far", es: "orgulloso de lo lejos que" },
       { en: "keep going", es: "seguir adelante" }
        ],
        frases: [
       { en: "Can you tell me more about personal goal?", es: "¿Me puedes contar más sobre meta personal?" },
       { en: "I'd like to talk about self-improvement.", es: "Me gustaría hablar sobre superación personal." },
       { en: "Do you know anything about challenge myself?", es: "¿Sabes algo sobre retarme a mí mismo?" },
       { en: "Can you explain proud of how far to me, please?", es: "¿Me puedes explicar orgulloso de lo lejos que por favor?" },
       { en: "I want to ask you about personal goal.", es: "Quiero preguntarte sobre meta personal." },
       { en: "Let's go over self-improvement together.", es: "Repasemos superación personal juntos." }
        ]
       } },
  { id: "z9_r178", zona_id: 9, reto_id: 178, titulo: "Expresar sorpresa o emoción", banco: {
        palabras: [
       { en: "I can't believe it", es: "no puedo creerlo" },
       { en: "that's amazing", es: "eso es increíble" },
       { en: "wow, really?", es: "wow, ¿de verdad?" },
       { en: "I'm so excited", es: "estoy tan emocionado" },
       { en: "what a surprise", es: "qué sorpresa" },
       { en: "no way", es: "no puede ser" },
       { en: "that's shocking", es: "eso es impactante" },
       { en: "I'm thrilled", es: "estoy encantado" }
        ],
        frases: [
       { en: "Can you tell me more about I can't believe it?", es: "¿Me puedes contar más sobre no puedo creerlo?" },
       { en: "I'd like to talk about wow, really?.", es: "Me gustaría hablar sobre wow, ¿de verdad?." },
       { en: "Do you know anything about what a surprise?", es: "¿Sabes algo sobre qué sorpresa?" },
       { en: "Can you explain that's shocking to me, please?", es: "¿Me puedes explicar eso es impactante por favor?" },
       { en: "I want to ask you about I can't believe it.", es: "Quiero preguntarte sobre no puedo creerlo." },
       { en: "Let's go over wow, really? together.", es: "Repasemos wow, ¿de verdad? juntos." }
        ]
       } },
  { id: "z9_r179", zona_id: 9, reto_id: 179, titulo: "Resolver un malentendido", banco: {
        palabras: [
       { en: "misunderstanding", es: "malentendido" },
       { en: "I think there's been a mix-up", es: "creo que hubo una confusión" },
       { en: "that's not what I meant", es: "eso no es lo que quise decir" },
       { en: "let me clarify", es: "déjame aclarar" },
       { en: "my fault", es: "mi culpa" },
       { en: "now it makes sense", es: "ahora tiene sentido" },
       { en: "we're on the same page", es: "estamos de acuerdo" },
       { en: "no hard feelings", es: "sin resentimientos" }
        ],
        frases: [
       { en: "Can you tell me more about misunderstanding?", es: "¿Me puedes contar más sobre malentendido?" },
       { en: "I'd like to talk about that's not what I meant.", es: "Me gustaría hablar sobre eso no es lo que quise decir." },
       { en: "Do you know anything about my fault?", es: "¿Sabes algo sobre mi culpa?" },
       { en: "Can you explain we're on the same page to me, please?", es: "¿Me puedes explicar estamos de acuerdo por favor?" },
       { en: "I want to ask you about misunderstanding.", es: "Quiero preguntarte sobre malentendido." },
       { en: "Let's go over that's not what I meant together.", es: "Repasemos eso no es lo que quise decir juntos." }
        ]
       } },
  { id: "z9_r180", zona_id: 9, reto_id: 180, titulo: "Repaso: conversación diaria", banco: {
        palabras: [
       { en: "routine", es: "rutina" },
       { en: "weekend", es: "fin de semana" },
       { en: "opinion", es: "opinión" },
       { en: "advice", es: "consejo" },
       { en: "habit", es: "hábito" },
       { en: "agree", es: "estar de acuerdo" },
       { en: "news", es: "noticias" },
       { en: "plan", es: "plan" }
        ],
        frases: [
       { en: "Can you tell me more about routine?", es: "¿Me puedes contar más sobre rutina?" },
       { en: "I'd like to talk about opinion.", es: "Me gustaría hablar sobre opinión." },
       { en: "Do you know anything about habit?", es: "¿Sabes algo sobre hábito?" },
       { en: "Can you explain news to me, please?", es: "¿Me puedes explicar noticias por favor?" },
       { en: "I want to ask you about routine.", es: "Quiero preguntarte sobre rutina." },
       { en: "Let's go over opinion together.", es: "Repasemos opinión juntos." }
        ]
       } },
  { id: "z10_r181", zona_id: 10, reto_id: 181, titulo: "Explicar un problema con detalle", banco: {
        palabras: [
       { en: "in detail", es: "a detalle" },
       { en: "the issue started when", es: "el problema empezó cuando" },
       { en: "to make matters worse", es: "para empeorar las cosas" },
       { en: "root cause", es: "causa raíz" },
       { en: "timeline of events", es: "cronología de eventos" },
       { en: "as a result of", es: "como resultado de" },
       { en: "I'd like to walk you through", es: "me gustaría explicarte paso a paso" },
       { en: "let me break it down", es: "déjame desglosarlo" }
        ],
        frases: [
       { en: "Can you tell me more about in detail?", es: "¿Me puedes contar más sobre a detalle?" },
       { en: "I'd like to talk about to make matters worse.", es: "Me gustaría hablar sobre para empeorar las cosas." },
       { en: "Do you know anything about timeline of events?", es: "¿Sabes algo sobre cronología de eventos?" },
       { en: "Can you explain I'd like to walk you through to me, please?", es: "¿Me puedes explicar me gustaría explicarte paso a paso por favor?" },
       { en: "I want to ask you about in detail.", es: "Quiero preguntarte sobre a detalle." },
       { en: "Let's go over to make matters worse together.", es: "Repasemos para empeorar las cosas juntos." }
        ]
       } },
  { id: "z10_r182", zona_id: 10, reto_id: 182, titulo: "Negociar un precio", banco: {
        palabras: [
       { en: "negotiate", es: "negociar" },
       { en: "best price", es: "mejor precio" },
       { en: "can you do better on the price", es: "puede mejorar el precio" },
       { en: "final offer", es: "oferta final" },
       { en: "meet in the middle", es: "llegar a un punto medio" },
       { en: "that's my budget", es: "ese es mi presupuesto" },
       { en: "deal", es: "trato" },
       { en: "I can agree to that", es: "puedo aceptar eso" }
        ],
        frases: [
       { en: "Can you tell me more about negotiate?", es: "¿Me puedes contar más sobre negociar?" },
       { en: "I'd like to talk about can you do better on the price.", es: "Me gustaría hablar sobre puede mejorar el precio." },
       { en: "Do you know anything about meet in the middle?", es: "¿Sabes algo sobre llegar a un punto medio?" },
       { en: "Can you explain deal to me, please?", es: "¿Me puedes explicar trato por favor?" },
       { en: "I want to ask you about negotiate.", es: "Quiero preguntarte sobre negociar." },
       { en: "Let's go over can you do better on the price together.", es: "Repasemos puede mejorar el precio juntos." }
        ]
       } },
  { id: "z10_r183", zona_id: 10, reto_id: 183, titulo: "Dar instrucciones paso a paso", banco: {
        palabras: [
       { en: "step by step", es: "paso a paso" },
       { en: "first", es: "primero" },
       { en: "then", es: "luego" },
       { en: "after that", es: "después de eso" },
       { en: "finally", es: "finalmente" },
       { en: "make sure to", es: "asegúrate de" },
       { en: "don't forget to", es: "no olvides" },
       { en: "once you've finished", es: "una vez que hayas terminado" }
        ],
        frases: [
       { en: "Can you tell me more about step by step?", es: "¿Me puedes contar más sobre paso a paso?" },
       { en: "I'd like to talk about then.", es: "Me gustaría hablar sobre luego." },
       { en: "Do you know anything about finally?", es: "¿Sabes algo sobre finalmente?" },
       { en: "Can you explain don't forget to to me, please?", es: "¿Me puedes explicar no olvides por favor?" },
       { en: "I want to ask you about step by step.", es: "Quiero preguntarte sobre paso a paso." },
       { en: "Let's go over then together.", es: "Repasemos luego juntos." }
        ]
       } },
  { id: "z10_r184", zona_id: 10, reto_id: 184, titulo: "Resolver un conflicto con calma", banco: {
        palabras: [
       { en: "let's stay calm", es: "mantengamos la calma" },
       { en: "I understand your frustration", es: "entiendo tu frustración" },
       { en: "let's find a solution together", es: "busquemos una solución juntos" },
       { en: "I didn't mean to upset you", es: "no quise molestarte" },
       { en: "can we start over", es: "podemos empezar de nuevo" },
       { en: "fair compromise", es: "compromiso justo" },
       { en: "I hear what you're saying", es: "escucho lo que dices" },
       { en: "let's move forward", es: "sigamos adelante" }
        ],
        frases: [
       { en: "Can you tell me more about let's stay calm?", es: "¿Me puedes contar más sobre mantengamos la calma?" },
       { en: "I'd like to talk about let's find a solution together.", es: "Me gustaría hablar sobre busquemos una solución juntos." },
       { en: "Do you know anything about can we start over?", es: "¿Sabes algo sobre podemos empezar de nuevo?" },
       { en: "Can you explain I hear what you're saying to me, please?", es: "¿Me puedes explicar escucho lo que dices por favor?" },
       { en: "I want to ask you about let's stay calm.", es: "Quiero preguntarte sobre mantengamos la calma." },
       { en: "Let's go over let's find a solution together together.", es: "Repasemos busquemos una solución juntos juntos." }
        ]
       } },
  { id: "z10_r185", zona_id: 10, reto_id: 185, titulo: "Expresar una opinión con argumentos", banco: {
        palabras: [
       { en: "my main argument is", es: "mi argumento principal es" },
       { en: "for example", es: "por ejemplo" },
       { en: "on top of that", es: "además de eso" },
       { en: "evidence suggests", es: "la evidencia sugiere" },
       { en: "that said", es: "dicho esto" },
       { en: "to sum up", es: "para resumir" },
       { en: "I'm convinced that", es: "estoy convencido de que" },
       { en: "it's worth considering", es: "vale la pena considerar" }
        ],
        frases: [
       { en: "Can you tell me more about my main argument is?", es: "¿Me puedes contar más sobre mi argumento principal es?" },
       { en: "I'd like to talk about on top of that.", es: "Me gustaría hablar sobre además de eso." },
       { en: "Do you know anything about that said?", es: "¿Sabes algo sobre dicho esto?" },
       { en: "Can you explain I'm convinced that to me, please?", es: "¿Me puedes explicar estoy convencido de que por favor?" },
       { en: "I want to ask you about my main argument is.", es: "Quiero preguntarte sobre mi argumento principal es." },
       { en: "Let's go over on top of that together.", es: "Repasemos además de eso juntos." }
        ]
       } },
  { id: "z10_r186", zona_id: 10, reto_id: 186, titulo: "Contar una historia completa", banco: {
        palabras: [
       { en: "it all started when", es: "todo comenzó cuando" },
       { en: "meanwhile", es: "mientras tanto" },
       { en: "suddenly", es: "de repente" },
       { en: "in the end", es: "al final" },
       { en: "looking back", es: "mirando hacia atrás" },
       { en: "to this day", es: "hasta el día de hoy" },
       { en: "the turning point was", es: "el punto decisivo fue" },
       { en: "that's how it happened", es: "así fue como pasó" }
        ],
        frases: [
       { en: "Can you tell me more about it all started when?", es: "¿Me puedes contar más sobre todo comenzó cuando?" },
       { en: "I'd like to talk about suddenly.", es: "Me gustaría hablar sobre de repente." },
       { en: "Do you know anything about looking back?", es: "¿Sabes algo sobre mirando hacia atrás?" },
       { en: "Can you explain the turning point was to me, please?", es: "¿Me puedes explicar el punto decisivo fue por favor?" },
       { en: "I want to ask you about it all started when.", es: "Quiero preguntarte sobre todo comenzó cuando." },
       { en: "Let's go over suddenly together.", es: "Repasemos de repente juntos." }
        ]
       } },
  { id: "z10_r187", zona_id: 10, reto_id: 187, titulo: "Dar una opinión matizada", banco: {
        palabras: [
       { en: "on one hand", es: "por un lado" },
       { en: "on the other hand", es: "por otro lado" },
       { en: "it's not that simple", es: "no es tan simple" },
       { en: "to some extent", es: "hasta cierto punto" },
       { en: "it really depends on", es: "realmente depende de" },
       { en: "a fair point, but", es: "un punto justo, pero" },
       { en: "I partly agree", es: "en parte estoy de acuerdo" },
       { en: "there's more to it", es: "hay más detrás de eso" }
        ],
        frases: [
       { en: "Can you tell me more about on one hand?", es: "¿Me puedes contar más sobre por un lado?" },
       { en: "I'd like to talk about it's not that simple.", es: "Me gustaría hablar sobre no es tan simple." },
       { en: "Do you know anything about it really depends on?", es: "¿Sabes algo sobre realmente depende de?" },
       { en: "Can you explain I partly agree to me, please?", es: "¿Me puedes explicar en parte estoy de acuerdo por favor?" },
       { en: "I want to ask you about on one hand.", es: "Quiero preguntarte sobre por un lado." },
       { en: "Let's go over it's not that simple together.", es: "Repasemos no es tan simple juntos." }
        ]
       } },
  { id: "z10_r188", zona_id: 10, reto_id: 188, titulo: "Hacer una presentación improvisada", banco: {
        palabras: [
       { en: "off the top of my head", es: "de improviso" },
       { en: "let me think for a second", es: "déjame pensar un segundo" },
       { en: "the key idea here is", es: "la idea clave aquí es" },
       { en: "I'll keep this brief", es: "seré breve" },
       { en: "in short", es: "en resumen" },
       { en: "that covers the basics", es: "eso cubre lo básico" },
       { en: "happy to take questions", es: "encantado de responder preguntas" },
       { en: "thanks for your patience", es: "gracias por su paciencia" }
        ],
        frases: [
       { en: "Can you tell me more about off the top of my head?", es: "¿Me puedes contar más sobre de improviso?" },
       { en: "I'd like to talk about the key idea here is.", es: "Me gustaría hablar sobre la idea clave aquí es." },
       { en: "Do you know anything about in short?", es: "¿Sabes algo sobre en resumen?" },
       { en: "Can you explain happy to take questions to me, please?", es: "¿Me puedes explicar encantado de responder preguntas por favor?" },
       { en: "I want to ask you about off the top of my head.", es: "Quiero preguntarte sobre de improviso." },
       { en: "Let's go over the key idea here is together.", es: "Repasemos la idea clave aquí es juntos." }
        ]
       } },
  { id: "z10_r189", zona_id: 10, reto_id: 189, titulo: "Resumir una conversación larga", banco: {
        palabras: [
       { en: "to summarize", es: "para resumir" },
       { en: "the main takeaway is", es: "la idea principal es" },
       { en: "long story short", es: "para resumir rápido" },
       { en: "we agreed that", es: "acordamos que" },
       { en: "the key points were", es: "los puntos clave fueron" },
       { en: "overall", es: "en general" },
       { en: "bottom line", es: "en resumidas cuentas" },
       { en: "next steps", es: "siguientes pasos" }
        ],
        frases: [
       { en: "Can you tell me more about to summarize?", es: "¿Me puedes contar más sobre para resumir?" },
       { en: "I'd like to talk about long story short.", es: "Me gustaría hablar sobre para resumir rápido." },
       { en: "Do you know anything about the key points were?", es: "¿Sabes algo sobre los puntos clave fueron?" },
       { en: "Can you explain bottom line to me, please?", es: "¿Me puedes explicar en resumidas cuentas por favor?" },
       { en: "I want to ask you about to summarize.", es: "Quiero preguntarte sobre para resumir." },
       { en: "Let's go over long story short together.", es: "Repasemos para resumir rápido juntos." }
        ]
       } },
  { id: "z10_r190", zona_id: 10, reto_id: 190, titulo: "Pedir una aclaración compleja", banco: {
        palabras: [
       { en: "could you clarify what you mean by", es: "podrías aclarar qué quieres decir con" },
       { en: "I'm not quite following", es: "no te estoy siguiendo bien" },
       { en: "can you give an example", es: "puedes dar un ejemplo" },
       { en: "just to make sure I understand", es: "solo para asegurarme de entender" },
       { en: "in other words", es: "en otras palabras" },
       { en: "so you're saying that", es: "entonces estás diciendo que" },
       { en: "that makes more sense now", es: "eso tiene más sentido ahora" },
       { en: "thanks for explaining", es: "gracias por explicar" }
        ],
        frases: [
       { en: "Can you tell me more about could you clarify what you mean by?", es: "¿Me puedes contar más sobre podrías aclarar qué quieres decir con?" },
       { en: "I'd like to talk about can you give an example.", es: "Me gustaría hablar sobre puedes dar un ejemplo." },
       { en: "Do you know anything about in other words?", es: "¿Sabes algo sobre en otras palabras?" },
       { en: "Can you explain that makes more sense now to me, please?", es: "¿Me puedes explicar eso tiene más sentido ahora por favor?" },
       { en: "I want to ask you about could you clarify what you mean by.", es: "Quiero preguntarte sobre podrías aclarar qué quieres decir con." },
       { en: "Let's go over can you give an example together.", es: "Repasemos puedes dar un ejemplo juntos." }
        ]
       } },
  { id: "z10_r191", zona_id: 10, reto_id: 191, titulo: "Hablar de ventajas y desventajas", banco: {
        palabras: [
       { en: "advantage", es: "ventaja" },
       { en: "disadvantage", es: "desventaja" },
       { en: "on the plus side", es: "del lado positivo" },
       { en: "the downside is", es: "la desventaja es" },
       { en: "pros and cons", es: "pros y contras" },
       { en: "weigh the options", es: "sopesar las opciones" },
       { en: "worth it in the long run", es: "vale la pena a largo plazo" },
       { en: "trade-off", es: "compensación" }
        ],
        frases: [
       { en: "Can you tell me more about advantage?", es: "¿Me puedes contar más sobre ventaja?" },
       { en: "I'd like to talk about on the plus side.", es: "Me gustaría hablar sobre del lado positivo." },
       { en: "Do you know anything about pros and cons?", es: "¿Sabes algo sobre pros y contras?" },
       { en: "Can you explain worth it in the long run to me, please?", es: "¿Me puedes explicar vale la pena a largo plazo por favor?" },
       { en: "I want to ask you about advantage.", es: "Quiero preguntarte sobre ventaja." },
       { en: "Let's go over on the plus side together.", es: "Repasemos del lado positivo juntos." }
        ]
       } },
  { id: "z10_r192", zona_id: 10, reto_id: 192, titulo: "Expresar una condición hipotética", banco: {
        palabras: [
       { en: "if I had more time", es: "si tuviera más tiempo" },
       { en: "what would you do if", es: "qué harías si" },
       { en: "suppose that", es: "supongamos que" },
       { en: "in that case", es: "en ese caso" },
       { en: "I would probably", es: "probablemente yo" },
       { en: "it's unlikely, but", es: "es poco probable, pero" },
       { en: "hypothetically speaking", es: "hablando hipotéticamente" },
       { en: "just imagine if", es: "solo imagina si" }
        ],
        frases: [
       { en: "Can you tell me more about if I had more time?", es: "¿Me puedes contar más sobre si tuviera más tiempo?" },
       { en: "I'd like to talk about suppose that.", es: "Me gustaría hablar sobre supongamos que." },
       { en: "Do you know anything about I would probably?", es: "¿Sabes algo sobre probablemente yo?" },
       { en: "Can you explain hypothetically speaking to me, please?", es: "¿Me puedes explicar hablando hipotéticamente por favor?" },
       { en: "I want to ask you about if I had more time.", es: "Quiero preguntarte sobre si tuviera más tiempo." },
       { en: "Let's go over suppose that together.", es: "Repasemos supongamos que juntos." }
        ]
       } },
  { id: "z10_r193", zona_id: 10, reto_id: 193, titulo: "Hablar de algo que harías diferente", banco: {
        palabras: [
       { en: "looking back, I would", es: "mirando hacia atrás, yo" },
       { en: "next time I'll", es: "la próxima vez" },
       { en: "I learned from that", es: "aprendí de eso" },
       { en: "I should have", es: "debería haber" },
       { en: "in hindsight", es: "en retrospectiva" },
       { en: "knowing what I know now", es: "sabiendo lo que sé ahora" },
       { en: "that was a valuable lesson", es: "esa fue una lección valiosa" },
       { en: "I'd approach it differently", es: "lo abordaría diferente" }
        ],
        frases: [
       { en: "Can you tell me more about looking back, I would?", es: "¿Me puedes contar más sobre mirando hacia atrás, yo?" },
       { en: "I'd like to talk about I learned from that.", es: "Me gustaría hablar sobre aprendí de eso." },
       { en: "Do you know anything about in hindsight?", es: "¿Sabes algo sobre en retrospectiva?" },
       { en: "Can you explain that was a valuable lesson to me, please?", es: "¿Me puedes explicar esa fue una lección valiosa por favor?" },
       { en: "I want to ask you about looking back, I would.", es: "Quiero preguntarte sobre mirando hacia atrás, yo." },
       { en: "Let's go over I learned from that together.", es: "Repasemos aprendí de eso juntos." }
        ]
       } },
  { id: "z10_r194", zona_id: 10, reto_id: 194, titulo: "Dar una recomendación detallada", banco: {
        palabras: [
       { en: "I highly recommend", es: "recomiendo mucho" },
       { en: "based on your needs", es: "según tus necesidades" },
       { en: "the best option would be", es: "la mejor opción sería" },
       { en: "keep in mind that", es: "ten en cuenta que" },
       { en: "it's worth the investment", es: "vale la inversión" },
       { en: "I'd suggest starting with", es: "sugeriría empezar con" },
       { en: "tailored to", es: "adaptado a" },
       { en: "works best if", es: "funciona mejor si" }
        ],
        frases: [
       { en: "Can you tell me more about I highly recommend?", es: "¿Me puedes contar más sobre recomiendo mucho?" },
       { en: "I'd like to talk about the best option would be.", es: "Me gustaría hablar sobre la mejor opción sería." },
       { en: "Do you know anything about it's worth the investment?", es: "¿Sabes algo sobre vale la inversión?" },
       { en: "Can you explain tailored to to me, please?", es: "¿Me puedes explicar adaptado a por favor?" },
       { en: "I want to ask you about I highly recommend.", es: "Quiero preguntarte sobre recomiendo mucho." },
       { en: "Let's go over the best option would be together.", es: "Repasemos la mejor opción sería juntos." }
        ]
       } },
  { id: "z10_r195", zona_id: 10, reto_id: 195, titulo: "Comparar dos opciones", banco: {
        palabras: [
       { en: "compared to", es: "comparado con" },
       { en: "the main difference is", es: "la diferencia principal es" },
       { en: "both options have", es: "ambas opciones tienen" },
       { en: "slightly better", es: "un poco mejor" },
       { en: "either way", es: "de cualquier forma" },
       { en: "it comes down to", es: "todo se reduce a" },
       { en: "similar in price", es: "similar en precio" },
       { en: "ultimately it depends on", es: "al final depende de" }
        ],
        frases: [
       { en: "Can you tell me more about compared to?", es: "¿Me puedes contar más sobre comparado con?" },
       { en: "I'd like to talk about both options have.", es: "Me gustaría hablar sobre ambas opciones tienen." },
       { en: "Do you know anything about either way?", es: "¿Sabes algo sobre de cualquier forma?" },
       { en: "Can you explain similar in price to me, please?", es: "¿Me puedes explicar similar en precio por favor?" },
       { en: "I want to ask you about compared to.", es: "Quiero preguntarte sobre comparado con." },
       { en: "Let's go over both options have together.", es: "Repasemos ambas opciones tienen juntos." }
        ]
       } },
  { id: "z10_r196", zona_id: 10, reto_id: 196, titulo: "Explicar una decisión difícil", banco: {
        palabras: [
       { en: "it wasn't an easy decision", es: "no fue una decisión fácil" },
       { en: "after careful consideration", es: "después de considerarlo con cuidado" },
       { en: "I weighed all the options", es: "consideré todas las opciones" },
       { en: "in the end I decided", es: "al final decidí" },
       { en: "it was the right call", es: "fue la decisión correcta" },
       { en: "there were trade-offs", es: "hubo compensaciones" },
       { en: "I stand by my decision", es: "respaldo mi decisión" },
       { en: "time will tell", es: "el tiempo lo dirá" }
        ],
        frases: [
       { en: "Can you tell me more about it wasn't an easy decision?", es: "¿Me puedes contar más sobre no fue una decisión fácil?" },
       { en: "I'd like to talk about I weighed all the options.", es: "Me gustaría hablar sobre consideré todas las opciones." },
       { en: "Do you know anything about it was the right call?", es: "¿Sabes algo sobre fue la decisión correcta?" },
       { en: "Can you explain I stand by my decision to me, please?", es: "¿Me puedes explicar respaldo mi decisión por favor?" },
       { en: "I want to ask you about it wasn't an easy decision.", es: "Quiero preguntarte sobre no fue una decisión fácil." },
       { en: "Let's go over I weighed all the options together.", es: "Repasemos consideré todas las opciones juntos." }
        ]
       } },
  { id: "z10_r197", zona_id: 10, reto_id: 197, titulo: "Hablar del futuro de un proyecto", banco: {
        palabras: [
       { en: "next phase", es: "siguiente fase" },
       { en: "roadmap", es: "hoja de ruta" },
       { en: "long-term vision", es: "visión a largo plazo" },
       { en: "scale up", es: "escalar" },
       { en: "pending approval", es: "pendiente de aprobación" },
       { en: "milestone", es: "hito" },
       { en: "funding", es: "financiamiento" },
       { en: "on the horizon", es: "en el horizonte" }
        ],
        frases: [
       { en: "Can you tell me more about next phase?", es: "¿Me puedes contar más sobre siguiente fase?" },
       { en: "I'd like to talk about long-term vision.", es: "Me gustaría hablar sobre visión a largo plazo." },
       { en: "Do you know anything about pending approval?", es: "¿Sabes algo sobre pendiente de aprobación?" },
       { en: "Can you explain funding to me, please?", es: "¿Me puedes explicar financiamiento por favor?" },
       { en: "I want to ask you about next phase.", es: "Quiero preguntarte sobre siguiente fase." },
       { en: "Let's go over long-term vision together.", es: "Repasemos visión a largo plazo juntos." }
        ]
       } },
  { id: "z10_r198", zona_id: 10, reto_id: 198, titulo: "Hacer un resumen ejecutivo", banco: {
        palabras: [
       { en: "executive summary", es: "resumen ejecutivo" },
       { en: "key findings", es: "hallazgos clave" },
       { en: "recommendation", es: "recomendación" },
       { en: "in conclusion", es: "en conclusión" },
       { en: "overall impact", es: "impacto general" },
       { en: "next steps", es: "siguientes pasos" },
       { en: "for your review", es: "para su revisión" },
       { en: "please let us know your thoughts", es: "por favor comparta sus comentarios" }
        ],
        frases: [
       { en: "Can you tell me more about executive summary?", es: "¿Me puedes contar más sobre resumen ejecutivo?" },
       { en: "I'd like to talk about recommendation.", es: "Me gustaría hablar sobre recomendación." },
       { en: "Do you know anything about overall impact?", es: "¿Sabes algo sobre impacto general?" },
       { en: "Can you explain for your review to me, please?", es: "¿Me puedes explicar para su revisión por favor?" },
       { en: "I want to ask you about executive summary.", es: "Quiero preguntarte sobre resumen ejecutivo." },
       { en: "Let's go over recommendation together.", es: "Repasemos recomendación juntos." }
        ]
       } },
  { id: "z10_r199", zona_id: 10, reto_id: 199, titulo: "Cerrar una negociación", banco: {
        palabras: [
       { en: "let's finalize the deal", es: "cerremos el trato" },
       { en: "we have an agreement", es: "tenemos un acuerdo" },
       { en: "sign here", es: "firme aquí" },
       { en: "pleasure doing business with you", es: "un placer hacer negocios con usted" },
       { en: "effective immediately", es: "con efecto inmediato" },
       { en: "looking forward to working together", es: "con ganas de trabajar juntos" },
       { en: "all parties agree", es: "todas las partes están de acuerdo" },
       { en: "deal closed", es: "trato cerrado" }
        ],
        frases: [
       { en: "Can you tell me more about let's finalize the deal?", es: "¿Me puedes contar más sobre cerremos el trato?" },
       { en: "I'd like to talk about sign here.", es: "Me gustaría hablar sobre firme aquí." },
       { en: "Do you know anything about effective immediately?", es: "¿Sabes algo sobre con efecto inmediato?" },
       { en: "Can you explain all parties agree to me, please?", es: "¿Me puedes explicar todas las partes están de acuerdo por favor?" },
       { en: "I want to ask you about let's finalize the deal.", es: "Quiero preguntarte sobre cerremos el trato." },
       { en: "Let's go over sign here together.", es: "Repasemos firme aquí juntos." }
        ]
       } },
  { id: "z10_r200", zona_id: 10, reto_id: 200, titulo: "Repaso final: autonomía en inglés", banco: {
        palabras: [
       { en: "in conclusion", es: "en conclusión" },
       { en: "on the other hand", es: "por otro lado" },
       { en: "as a result", es: "como resultado" },
       { en: "in other words", es: "en otras palabras" },
       { en: "to sum up", es: "para resumir" },
       { en: "overall", es: "en general" },
       { en: "nevertheless", es: "sin embargo" },
       { en: "eventually", es: "eventualmente" }
        ],
        frases: [
       { en: "Can you tell me more about in conclusion?", es: "¿Me puedes contar más sobre en conclusión?" },
       { en: "I'd like to talk about as a result.", es: "Me gustaría hablar sobre como resultado." },
       { en: "Do you know anything about to sum up?", es: "¿Sabes algo sobre para resumir?" },
       { en: "Can you explain nevertheless to me, please?", es: "¿Me puedes explicar sin embargo por favor?" },
       { en: "I want to ask you about in conclusion.", es: "Quiero preguntarte sobre en conclusión." },
       { en: "Let's go over as a result together.", es: "Repasemos como resultado juntos." }
        ]
       } }
 ];

 // Combina RETOS_LOCALES con lo que traiga la nube (RetosRepository) --
 // gana la nube si el mismo reto_id viene de las dos fuentes, porque la
 // nube es la fuente editable sin tener que volver a publicar la app.
 // Si la nube no responde o la tabla esta vacia, RetosRepository.listar()
 // devuelve [] y el mapa simplemente usa los 200 retos locales.
 function construirRegistroRetos() {
  var registro = {};
  RETOS_LOCALES.forEach(function (r) { registro[r.reto_id] = r; });
  if (typeof RetosRepository !== "undefined") {
   var nube = RetosRepository.listar();
   nube.forEach(function (r) {
    registro[r.reto_id] = {
     id: "cloud" + r.reto_id, zona_id: r.zona_id, reto_id: r.reto_id,
     titulo: r.titulo, banco: r.ejercicios
    };
   });
  }
  return registro;
 }
 var REGISTRO_RETOS = construirRegistroRetos();

 // Agrupa el registro de retos (200, uno por reto_id) en las 10 zonas,
 // en el mismo formato {id, titulo, misiones:[...]} que ya usa el resto
 // del motor (nodoHTML/vistaMapa/puntosCamino) -- así ninguna otra parte
 // del archivo necesita saber que el contenido ahora viene de dos fuentes.
 var MUNDOS = [];
 for (var _zi = 1; _zi <= TOTAL_ZONAS; _zi++) {
  var _misionesZona = [];
  for (var _ri = (_zi - 1) * RETOS_POR_ZONA + 1; _ri <= _zi * RETOS_POR_ZONA; _ri++) {
   if (REGISTRO_RETOS[_ri]) _misionesZona.push(REGISTRO_RETOS[_ri]);
  }
  MUNDOS.push({ id: "zona" + _zi, titulo: ZONA_TITULOS[_zi - 1], misiones: _misionesZona });
 }

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
 // Los 13 pasos de siempre del banco de la misión, más 5 de discriminación
 // auditiva (pares mínimos) repartidos entre ellos -- intercalarPasosDiscri
 // minacion()/generarPasosDiscriminacion() viven en index.html (compartidos
 // con Lecciones, que usa exactamente la misma función: ver
 // construirLeccionConDiscriminacion en index.html) para no duplicar esta
 // lógica en los dos motores.
 // "indiceUno" = número de misión dentro de su mundo (1-based, ver
 // MUNDOS.forEach más abajo) -- decide si el bloque de discriminación
 // auditiva va al inicio (misión impar) o al final (misión par) de la
 // lección, igual que en Lecciones (ver construirLeccionConDiscriminacion
 // en index.html, misma lógica compartida vía intercalarPasosDiscriminacion).
 function generarPasos(m, indiceUno) {
  var palabras = m.banco.palabras, frases = m.banco.frases;
  var base = [
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
  return intercalarPasosDiscriminacion(base, 5, indiceUno);
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
   m.mundo = mundo.titulo; m.pasos = generarPasos(m, k + 1);
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
  // Solo el reto actual y los ya superados se pueden abrir para un alumno:
  // los futuros quedan bloqueados hasta llegar a ellos en orden (recorrido
  // real, no una lista donde todo está disponible desde el inicio).
  // Excepción: la cuenta "admin" (Panel de Control -> Modo Alumno / Vista
  // previa) sí puede abrir cualquier reto, aunque esté bloqueado, para
  // revisar su contenido sin tener que completar todos los anteriores.
  // USUARIO_ACTUAL sigue siendo "admin" dentro de ese modo preview (ver
  // entrarComo() en loginOnboarding.js), así que esto nunca aplica a un
  // alumno real -- su bloqueo secuencial no cambia en nada.
  var esAdminPreview = !!(window.USUARIO_ACTUAL && window.USUARIO_ACTUAL.rol === "admin");
  var previaAdmin = st === "bloqueado" && esAdminPreview;
  var clickable = st === "hecho" || st === "actual" || previaAdmin, tag = clickable ? "button" : "div";
  var extra = clickable ? ' data-a="av-abrir" data-mid="' + esc(m.id) + '"' : "";
  var enCurso = st === "actual" && estaEnProgreso(m.id), dominada = st === "hecho" && estaDominada(m.id);
  var iconoHTML = st === "actual" ? rostroLevo(40) : (st === "bloqueado" ? ic("lock", 22) : ic(tipo.icono, 26));
  var etiquetaAhora = enCurso ? "Continúa aquí" : "Ahora";
  var etiquetaAria = previaAdmin ? esc(m.titulo) + " (bloqueado para alumnos, vista previa de admin)" : esc(m.titulo);
  return '<div class="av-node ' + st + " tipo-" + m.tipo + (dominada ? " dominada" : "") + (previaAdmin ? " av-prevadmin" : "") + '" style="left:' + left + 'px;top:' + top + 'px">'
   + (st === "actual" ? '<span class="av-ring" aria-hidden="true"></span>' : "")
   + '<' + tag + ' class="av-btn"' + extra + (clickable ? ' aria-label="' + etiquetaAria + '"' : ' aria-label="' + esc(m.titulo) + ' (bloqueado)" aria-disabled="true"') + '>' + iconoHTML
   + (st === "hecho" ? '<span class="av-medalla">' + ic(dominada ? "crown" : "star", 12) + "</span>" : "")
   + '</' + tag + '>'
   + '<span class="av-lbl">' + esc(m.titulo) + (st === "actual" ? "<em>" + etiquetaAhora + "</em>" : "") + (previaAdmin ? "<em>Vista previa</em>" : "") + '</span></div>';
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
  return encabezadoReto(m) + RetoEngine.wolfDialogo("Aprende estas palabras clave:", "welcome")
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
  var estadoEvo = estado.resuelto ? (estado.sel === p.a ? "success" : "error") : "question";
  var html = encabezadoReto(m) + RetoEngine.wolfDialogo(instruccion, estadoEvo)
   + '<div class="av-frase"><div><b>' + esc(T(p.texto)) + "</b></div></div>"
   + opcionesHTML(p)
   + pieCheckOMultiple(p, "“" + esc(T(p.frase.en)) + "” = “" + esc(T(p.frase.es)) + "”");
  return html;
 }
 // --- Completar la frase (fill in the blank) ---
 function pasoHueco(m, p) {
  var estadoEvo = estado.resuelto ? (estado.sel === p.a ? "success" : "error") : "question";
  var html = encabezadoReto(m) + RetoEngine.wolfDialogo("Completa la frase:", estadoEvo)
   + '<div class="av-frase"><div class="av-hueco">' + esc(T(p.antes)) + "</div></div>"
   + opcionesHTML(p)
   + pieCheckOMultiple(p, "La frase completa es: “" + esc(T(p.frase.en)) + "”");
  return html;
 }
 // --- Comprensión auditiva (escucha el audio y elige lo que significa) ---
 function pasoEscucha(m, p) {
  var oculto = estado.sel === null && !estado.resuelto;
  var estadoEvo = estado.resuelto ? (estado.sel === p.a ? "success" : "error") : "question";
  var html = encabezadoReto(m) + RetoEngine.wolfDialogo(oculto ? "Escucha con atención…" : "¿Qué escuchaste?", estadoEvo)
   + '<div class="av-frase"><button class="av-say" data-a="av-say" data-s="' + esc(T(p.audio)) + '" aria-label="Escuchar">' + ic("sound", 24) + "</button>"
   + '<div class="es2">' + (oculto ? "Toca para escuchar y luego responde." : esc(T(p.audio))) + "</div></div>"
   + opcionesHTML(p)
   + pieCheckOMultiple(p, "“" + esc(T(p.audio)) + "” = “" + esc(T(p.frase.es)) + "”");
  return html;
 }
 // --- Discriminación auditiva (pares mínimos) ---
 // Usa el mismo componente discriminacionHTML() que Lecciones (definido en
 // index.html, cargado antes que este archivo) -- aquí solo se pone el
 // encabezado del reto y el botón Comprobar/Continuar alrededor, porque la
 // tarjeta ya trae su propio avatar de LEVO y su propia retroalimentación.
 function pasoDiscriminacion(m, p) {
  var html = encabezadoReto(m)
   + discriminacionHTML(p, estado.sel, estado.resuelto, "av-opt")
   + (estado.resuelto
     ? RetoEngine.botonFijo("Continuar", false, "av-cont")
     : RetoEngine.botonFijo("Comprobar", estado.sel === null, "av-cont"));
  return html;
 }
 // --- Armar la oración (word bank / bloques de palabras en orden) ---
 function pasoArmar(m, p) {
  if (!estado.orden) estado.orden = shuffle(p.piezas.map(function (_, i) { return i; }));
  var usadas = estado.piezas, disponibles = estado.orden.filter(function (i) { return usadas.indexOf(i) === -1; });
  var armada = usadas.map(function (i) { return p.piezas[i]; }).join(" "), correcto = armada.trim() === p.frase.trim();
  var estadoEvo = estado.resuelto ? (correcto ? "success" : "error") : "question";
  // Botón de altavoz arriba del globo de diálogo: el alumno puede escuchar
  // la oración completa en inglés (p.frase) antes de ordenarla.
  var audioFrase = '<div class="rw-build-audio">' + sbtn(p.frase) + '</div>';
  var html = encabezadoReto(m) + RetoEngine.wolfDialogo("¡Arma la frase completa!", estadoEvo, audioFrase)
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
  if (p.tipo === "discriminacion") return pasoDiscriminacion(m, p);
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
 var TIPOS_OPCION = { traduccion: 1, hueco: 1, escucha: 1, discriminacion: 1 };
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
