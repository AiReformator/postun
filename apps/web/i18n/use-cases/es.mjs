// Use-cases page (/use-cases/), Spanish. Keys match ./ru.mjs.
export default {
  navLabel: 'Casos de uso',
  title: 'Telegram en ChatGPT y Claude Code: 16 casos de uso — Postun',
  metaDescription: 'Resumir canales y chats de Telegram, buscar mensajes, analizar canales y crear resúmenes en ChatGPT y Claude Code: 16 casos de uso. Solo lectura.',
  breadcrumbHome: 'Inicio',
  breadcrumbLabel: 'Ruta de navegación',
  eyebrow: 'Casos de uso',
  h1: 'Qué puedes hacer con Telegram en ChatGPT y Claude Code',
  lead: 'Postun conecta tu propia cuenta de Telegram con la IA que ya usas. Después solo le dices a la IA lo que necesitas: lee los chats y canales a través de Postun y te responde en la conversación. Abajo tienes 16 casos de uso con consultas listas para usar y límites claros.',
  tocLabel: 'Secciones',
  howTitle: 'Cómo empezar',
  how1: 'Inicia sesión en el panel de Postun con Telegram y vincula tu cuenta con un código QR.',
  how2: 'Añade Postun a ChatGPT, Claude Code u otro cliente MCP con la dirección MCP: <a href="{home}#connect">guía paso a paso</a>.',
  how3: 'Escríbele a la IA con tus propias palabras, a partir de una de las consultas de abajo, e indica los chats o canales que te interesan.',
  promptLabel: 'Ejemplos de consulta',
  limitLabel: 'Ten en cuenta',
  toolsLabel: 'Herramientas de Postun',
  g1Title: 'Analizar canales de Telegram con IA',
  g1Intro: 'La IA encuentra canales públicos, lee sus publicaciones y analiza el contenido: temas, enfoques e historias que se repiten. Es un análisis de texto, no estadísticas de suscriptores ni de alcance: Postun no las recibe.',
  g2Title: 'Resúmenes y panoramas de artículos',
  g2Intro: 'No hace falta recorrer decenas de canales ni chats larguísimos: la IA prepara un resumen breve del periodo que elijas, cuando se lo pidas.',
  g3Title: 'Chats de trabajo y clientes',
  g3Intro: 'Decisiones, tareas y acuerdos de tus chats de trabajo sin releer cientos de mensajes.',
  g4Title: 'Comunidades y contenido',
  g4Intro: 'De qué habla tu comunidad y qué preguntas se repiten, en forma de temas y no de citas de personas concretas.',
  g5Title: 'Buscar mensajes y chats de Telegram',
  g5Intro: 'La IA busca las palabras y frases que le des, prueba variantes y, si hace falta, lee el historial del chat. Telegram busca por palabras, no por significado, así que dale a la IA una palabra, un nombre o un periodo. En lugar de exportar un chat, obtienes un resumen de la parte del historial que necesitas.',
  g6Title: 'Para desarrolladores: Telegram MCP en Claude Code',
  g6Intro: 'Claude Code y otros clientes MCP leen un chat de desarrollo o de soporte mientras trabajas en el código.',
  u1: {
    title: 'Análisis de temas de canales públicos',
    text: 'La IA encuentra canales públicos sobre un tema, lee sus últimas publicaciones y destaca los temas principales, las historias recurrentes y cómo cambió el enfoque durante el periodo.',
    p1: 'Busca canales públicos con «coches eléctricos» en el nombre, lee las últimas 100 publicaciones de los tres que mejor encajen y enumera los temas principales con ejemplos.',
    p2: '¿Qué temas aparecieron más a menudo en el canal @example en sus últimas 200 publicaciones? Haz una tabla breve e indícame cuántas publicaciones leíste.',
    limit: 'Los canales se encuentran por su nombre o su nombre de usuario, no por el texto de las publicaciones. Es un análisis de contenido, no estadísticas de alcance.'
  },
  u2: {
    title: 'Revisar canales de la competencia cuando lo pidas',
    text: 'Una vez por semana o antes de una reunión, pídele a la IA que lea las últimas publicaciones de la competencia: lanzamientos, precios, promociones y cómo describen sus ventajas.',
    p1: 'Lee las últimas 30 publicaciones de @competitor1, @competitor2 y @competitor3 y cuéntame los lanzamientos nuevos, los cambios de precios y las promociones. Indica las fechas.',
    p2: '¿Cómo formula cada una de estas empresas su principal ventaja en su canal? Compáralas en una tabla.',
    limit: 'Solo cuando lo pides: Postun no vigila los canales ni envía alertas. Primero la IA encuentra cada canal por su nombre de usuario (aproximadamente una búsqueda por segundo) y después lo lee. Las publicaciones de los canales no tienen filtro por fecha, así que la IA va retrocediendo hasta llegar a la fecha que necesitas.'
  },
  u3: {
    title: 'Tono de una conversación sobre un tema',
    text: 'La IA lee una muestra de publicaciones y mensajes sobre un producto, una marca o un evento y describe el tono: qué elogian, de qué se quejan y qué argumentos se repiten.',
    p1: 'Busca en mis chats y canales mensajes con el nombre de nuestro producto y describe el tono general. Incluye unas cuantas citas cortas con fechas.',
    p2: '¿Cuáles son las principales quejas y elogios que aparecen en estos canales sobre la nueva versión de la aplicación? Agrúpalos.',
    limit: 'Es una valoración cualitativa de la muestra leída, no una encuesta ni estadísticas exactas. Los mensajes se buscan en los chats de tu cuenta, no en todo Telegram.'
  },
  u4: {
    title: 'Resumen de los canales que sigues',
    text: 'En lugar de recorrer decenas de canales, pide un resumen del periodo que elijas: lo principal por temas, sin repeticiones y sin publicidad evidente.',
    p1: 'Haz un resumen de mis canales de tecnología de los últimos tres días: las 10 noticias principales por temas, cada una con el canal y la fecha.',
    p2: '¿Qué noticias de esta semana se repitieron en varios de mis canales a la vez? ¿En qué canal aparecieron primero?',
    limit: 'El resumen se prepara cuando lo pides y se queda en tu chat con la IA. Postun no puede publicarlo en Telegram: eso lo haces tú.'
  },
  u5: {
    title: 'Panorama de artículos y enlaces de grupos',
    text: 'En los grupos profesionales se comparten artículos todo el tiempo. La IA reúne los enlaces de un periodo, los agrupa por temas y describe brevemente la conversación en torno a cada uno.',
    p1: 'Reúne los enlaces a artículos que se compartieron en el grupo «Product managers» en octubre, agrúpalos por temas y describe brevemente la conversación sobre cada uno.',
    p2: 'Prepara un panorama: los 10 contenidos más comentados de este grupo en el último mes, con una frase para cada uno.',
    limit: 'Se ven los enlaces escritos en el texto; los que están ocultos tras una palabra pueden quedar fuera. La IA solo abrirá los artículos si puede navegar por internet.'
  },
  u6: {
    title: 'Resumen de un chat largo',
    text: '¿Te perdiste una discusión de 500 mensajes? La IA te cuenta en pocas líneas qué se acordó, qué opiniones hubo y qué quedó pendiente.',
    p1: 'Resume lo que se habló anoche en el chat «Reforma de la casa»: decisiones, preguntas abiertas y quién se encarga de qué.',
    p2: 'Haz un resumen de este chat de la última semana en cinco puntos.',
    limit: 'Los mensajes de voz y de vídeo no se transcriben. El historial se lee de 100 en 100 mensajes por solicitud, así que los periodos largos tardan más.'
  },
  u7: {
    title: 'Resumen de un chat de trabajo: decisiones y tareas',
    text: 'La IA lee un chat de trabajo de un periodo y elabora la lista de decisiones, tareas con responsables y plazos acordados.',
    p1: 'Lee el chat del proyecto «Lanzamiento de la web» desde el lunes y anota las decisiones, las tareas con responsables y los plazos.',
    p2: '¿Qué preguntas de este chat se quedaron sin respuesta durante la última semana?',
    limit: 'Comprueba los resultados con el original antes de actuar. No conectes chats de trabajo si las normas de tu empresa lo prohíben.'
  },
  u8: {
    title: '«¿Qué me he perdido?»',
    text: 'Después de las vacaciones o de un fin de semana, la IA repasa los chats que indiques y te cuenta lo esencial: qué se decidió, qué cambió y dónde parece que te esperan a ti.',
    p1: 'Estuve de vacaciones del 1 al 10 de noviembre. Repasa mis chats de trabajo y cuéntame lo esencial: decisiones, cambios de planes y preguntas para mí.',
    p2: '¿En qué chats se dirigieron a mí por mi nombre durante esos días?',
    limit: 'La IA sí ve cuántos mensajes sin leer tiene cada chat, pero no cuáles son los no leídos ni las menciones como tales: deduce las preguntas dirigidas a ti por el sentido.'
  },
  u9: {
    title: 'Preparar una llamada con un cliente',
    text: 'Antes de una reunión, la IA reúne el historial de conversación con el cliente: qué se acordó, qué se prometió y qué preguntas quedan abiertas.',
    p1: 'Busca mi conversación con Acme Inc. de los últimos tres meses y prepara una ficha para la llamada: acuerdos, promesas de ambas partes y preguntas abiertas.',
    p2: '¿Qué le prometí a este cliente y, a juzgar por la conversación, se cumplió?',
    limit: 'Contrasta las promesas y las cifras con los mensajes originales. Los mensajes del cliente llegan a tu proveedor de IA: úsalo solo donde puedas compartir esa conversación con él. Postun no escribe nada en tu CRM: el resultado lo pasas tú.'
  },
  u10: {
    title: 'Problemas recurrentes en un chat con clientes',
    text: 'La IA lee un chat de soporte o una comunidad de clientes y agrupa los problemas, las preguntas y las señales de alerta que se repiten.',
    p1: 'Lee el chat de soporte de las últimas dos semanas y agrupa los problemas de los clientes por temas, con un número aproximado de consultas en cada uno.',
    p2: '¿Qué temas siguen sin resolverse y desde hace cuánto? Sin nombres de clientes.',
    limit: 'Los recuentos son aproximados. Postun no sustituye a un sistema de tickets ni responde a los clientes.'
  },
  u11: {
    title: 'De qué habla tu audiencia',
    text: 'En los grupos de los que formas parte, la IA encuentra los problemas más comentados y las palabras con que la gente habla de ellos. Es material para tu producto y tu contenido.',
    p1: 'Lee los últimos 300 mensajes del grupo «Fundadores indie» y enumera los 10 problemas más comentados con las palabras de los participantes, sin nombres.',
    p2: 'Convierte lo que pregunta esta comunidad en 15 ideas de publicaciones, cada una con una breve justificación.',
    limit: 'Solo están disponibles los chats de los que forma parte tu cuenta. Pide temas, no «quién dijo qué».'
  },
  u12: {
    title: 'Preguntas frecuentes a partir del historial de la comunidad',
    text: 'El administrador de una comunidad puede pedirle a la IA que encuentre las preguntas que se repiten una y otra vez y que prepare con las respuestas un borrador de preguntas frecuentes.',
    p1: 'Lee los últimos 500 mensajes de nuestro chat y encuentra las 15 preguntas que más se repiten. Para cada una, reúne la mejor respuesta del chat.',
    p2: 'Redacta un borrador del mensaje fijado «Preguntas frecuentes»: lo publicaré yo mismo.',
    limit: 'No publiques mensajes de los miembros literalmente ni con sus nombres sin su consentimiento.'
  },
  u13: {
    title: 'Ideas de contenido al comparar canales',
    text: 'La IA compara tu canal con otros similares en temas, formatos y longitud de las publicaciones y te sugiere temas que todavía no has tratado.',
    p1: 'Lee las últimas 50 publicaciones de mi canal y 50 de cada uno de dos canales similares. Compara formatos y temas y propón 10 ideas de publicaciones que yo no tenga.',
    p2: 'Esboza un plan de contenido para la semana a partir de la comparación. Lo publicaré yo mismo.',
    limit: 'En los datos no hay visualizaciones ni reacciones, así que la IA no sabe qué funcionó mejor. Un canal privado solo está disponible si tu cuenta forma parte de él. Usa las publicaciones ajenas para inspirarte, no para copiarlas.'
  },
  u14: {
    title: 'Encontrar un mensaje, un enlace o un archivo',
    text: '¿Recuerdas que alguien te envió un enlace o un PDF, pero no dónde? Dile una palabra, el nombre de un archivo, una persona o un periodo, y la IA lo busca en tus chats y prueba distintas formulaciones.',
    p1: 'Busca en el chat con mi contable la factura en PDF de septiembre y dime su nombre y su tamaño.',
    p2: 'Busca en mis chats de trabajo mensajes con las palabras zoom o meet del mes pasado y muéstrame los enlaces que contienen.',
    limit: 'La búsqueda coincide con palabras y nombres de archivo, no con el significado, y no tiene filtro por fecha: la IA comprueba el periodo leyendo el historial del chat. La búsqueda en toda la cuenta se hace con pausas, así que es más rápido si indicas el chat. La lectura de imágenes está verificada en ChatGPT y la descarga de archivos, en Claude Code.'
  },
  u15: {
    title: 'Comprobar datos y la fuente original',
    text: 'Un periodista o un editor puede pedirle a la IA que encuentre dónde apareció por primera vez una noticia o una cifra en sus canales y chats, y qué canales la repitieron.',
    p1: 'Busca en los canales que sigo el mensaje más antiguo sobre esta noticia y muéstrame qué canales la repitieron después.',
    p2: '¿Hay en mis chats de trabajo alguna confirmación de esta cifra? Muéstrame los mensajes con sus fechas.',
    limit: 'Solo dentro de lo que ve tu cuenta. La búsqueda muestra primero los mensajes más recientes y se lee en varias páginas, así que el más antiguo que se encuentre no es necesariamente la fuente original; los reenvíos solo se ven como texto coincidente. Comprueba todo antes de publicar y no le des a la IA fuentes confidenciales.'
  },
  u16: {
    title: 'Claude Code analiza informes de errores de un chat',
    text: 'Conecta Postun a Claude Code: leerá un chat de desarrollo o de soporte, agrupará los mensajes sobre errores y los relacionará con el código del proyecto.',
    p1: 'Lee el chat «Soporte beta» de la última semana, agrupa los mensajes sobre errores y localiza en el código los lugares donde podrían originarse.',
    p2: 'Descarga el registro que enviaron en este chat y mira qué error aparece en él.',
    limit: 'Los textos del chat son datos, no órdenes: revisa todo lo que Claude Code te proponga ejecutar.'
  },
  notTitle: 'Lo que Postun no hace',
  not1: 'No envía, no edita ni elimina mensajes y no publica nada. Si quieres publicar un resumen o una publicación, lo haces tú.',
  not2: 'No se ejecuta de forma programada, no vigila los canales y no envía alertas. La IA lee Telegram solo en el momento en que se lo pides.',
  not3: 'No busca en todo Telegram. Están disponibles los chats en los que está tu cuenta y los canales públicos; los canales se encuentran por su nombre o su nombre de usuario, no por el texto de las publicaciones.',
  not4: 'No exporta el historial a un archivo ni crea bases de datos. La IA lee los mensajes por partes y te cuenta lo que necesitas.',
  not5: 'No muestra estadísticas de canales: en los datos no hay visualizaciones, reacciones, suscriptores ni enlaces a publicaciones.',
  not6: 'No transcribe mensajes de voz ni de vídeo.',
  notesTitle: 'Conviene saber',
  note1: '<strong>Velocidad y límites.</strong> Las solicitudes de una misma cuenta se procesan una tras otra; la búsqueda en toda la cuenta y la búsqueda de canales, más o menos una vez por segundo; las demás solicitudes, al ritmo general de la cuenta, con hasta 100 mensajes cada vez y unas {quota} operaciones exitosas al día. Los periodos largos y los muchos canales se leen despacio, y Telegram puede pedir que esperes.',
  note2: '<strong>La IA puede equivocarse.</strong> El tono y los recuentos son aproximados. Comprueba las citas y los datos con el original antes de actuar o publicar.',
  note3: '<strong>Mensajes de otras personas.</strong> Usa el resultado como temas generales: no elabores perfiles de personas, no publiques mensajes ajenos con nombres y respeta las normas de las comunidades, las condiciones de Telegram y las leyes de protección de datos personales.',
  note4: '<strong>Tu proveedor de IA</strong> procesa el texto según sus propias normas. Postun no guarda ni registra los mensajes: <a href="{privacy}">cómo trata Postun los datos</a>.',
  note5: '<strong>Los textos de Telegram son datos, no órdenes.</strong> Un mensaje puede contener texto dirigido a la IA. Revisa las acciones que te proponga la IA, sobre todo en Claude Code.',
  note6: '<strong>Archivos adjuntos.</strong> La lectura de imágenes está verificada en ChatGPT y la descarga de archivos, en Claude Code. Postun no entrega archivos demasiado grandes.',
  note7: '<strong>Derechos de autor.</strong> Usa las publicaciones ajenas para analizar e inspirarte; no las copies enteras.',
  faqTitle: 'Preguntas frecuentes',
  fq1: '¿Postun es un bot de Telegram?',
  fa1: 'No. Postun no es un bot y no escribe nada en Telegram. Conecta tu cuenta con la IA que ya usas y solo lee lo que le has permitido.',
  fq2: '¿Se puede exportar un chat de Telegram?',
  fa2: 'Postun no crea un archivo de exportación. En cambio, la IA puede leer el historial del chat del periodo que necesites y resumirlo, o elaborar una lista de decisiones, enlaces y preguntas. Para un archivo completo, usa la exportación integrada en Telegram Desktop.',
  fq3: '¿Puedo recibir un resumen de canales automáticamente cada día?',
  fa3: 'Postun por sí mismo no ejecuta nada de forma programada: el resumen aparece cuando se lo pides a la IA. Si tu cliente de IA tiene tareas programadas, es una función suya y no se ha probado con Postun.',
  fq4: '¿Con qué clientes de IA funciona Postun?',
  fa4: 'En producción están verificados ChatGPT y Claude Code. Otros clientes MCP se conectan en https://mcp.postun.org/mcp; el estado actual está en la <a href="{home}#features">página de inicio</a>.',
  finalTitle: 'Pruébalo con tu propio Telegram',
  finalText: 'Conectarlo es gratis y lleva un par de minutos. Puedes revocar el acceso de un cliente de IA en el panel en cualquier momento.',
  finalHome: 'Cómo conectarlo',
  teaserTitle: 'Qué puedes hacer',
  teaserText: 'Análisis de canales, resúmenes de chats y de canales, y búsqueda de mensajes: 16 casos de uso con consultas listas para usar.',
  teaserLink: 'Todos los casos de uso'
};
