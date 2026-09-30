/**
 * AVISO DE VISITA — el correo, el WhatsApp y la invitación de calendario que
 * recibe un PROSPECTO cuando agenda una visita.
 *
 * ===========================================================================
 * POR QUE ESTE ARCHIVO NO IMPORTA NADA
 * ===========================================================================
 * Se usa en dos sitios que no comparten nada más:
 *
 *   1. El navegador — envío MANUAL de hoy: el vendedor abre su propio correo
 *      con `mailto:`, descarga el `.ics` o copia el texto de WhatsApp
 *      (src/lib/visitas.ts).
 *   2. La Edge Function `supabase/functions/aviso-visita/` — envío AUTOMÁTICO
 *      por Resend, desplegada inerte hasta que existan los secretos
 *      RESEND_API_KEY y CORREO_REMITENTE (decisión del dueño, 29/09/2026).
 *
 * La función corre en Deno y no puede resolver `@/lib/...`, así que allí vive
 * una COPIA BYTE A BYTE de este archivo. Si esto importara algo, la copia se
 * rompería o —peor— divergiría, y el correo automático diría otra cosa que el
 * manual. Por eso aquí se repiten, en pequeño, dos o tres lectores que ya
 * existen en src/lib/lectura.ts: es el precio de que haya UN solo texto.
 *
 * ###########################################################################
 * #  SI CAMBIAS ESTE ARCHIVO, COPIALO TAL CUAL A                            #
 * #  supabase/functions/aviso-visita/aviso-visita.ts                        #
 * ###########################################################################
 *
 * ===========================================================================
 * LO QUE ESTE TEXTO NO PUEDE DECIR (SPEC §2 · 07-crm/CLAUDE.md §2)
 * ===========================================================================
 * Es texto para un CLIENTE. Aquí no aparece: el distrito; ningún precio,
 * cuota, financiamiento, rentabilidad, alquiler o plusvalía; fecha de entrega
 * ni % de avance; escasez («últimos cupos»); «título de propiedad» (lo que se
 * vende son acciones y derechos sobre el inmueble matriz). No se le pide
 * dinero ni DNI. Y tampoco la DURACIÓN de la visita: `visita_duracion_min` es
 * 🔵 propuesta y solo dimensiona el bloque del calendario (SPEC §4.4).
 *
 * `visita.nota` es una nota INTERNA del vendedor («viene con su hermano, quiere
 * ver la zona de abarrotes»). Nunca se copia al texto del cliente.
 *
 * Los datos de la empresa y del lugar llegan ya filtrados por
 * `parametro_publico` de 13-seguimiento-comercial.sql (solo 🟢 verde). Si falta
 * uno, el texto dice lo que se hará en su lugar («le enviaremos la ubicación
 * por WhatsApp») y el id del parámetro va a `faltantes`, para que la pantalla
 * le diga a Dirección qué cargar. Nunca se rellena el hueco.
 *
 * Este archivo no contiene ninguna cifra del negocio.
 */

// ---------------------------------------------------------------------------
// Constantes de presentación — ninguna es una cifra del negocio
// ---------------------------------------------------------------------------

/** El nombre comercial del proyecto. Es la marca, no la razón social (🔴, viene de parámetros). */
const PROYECTO = 'Mercado Media Luna'

/** Aviso de privacidad publicado en la web (08-web/privacidad.html). */
const URL_PRIVACIDAD = 'https://mercadomedialuna.com/privacidad.html'

/**
 * Dominio del UID del `.ics`. Tiene que ser estable y nuestro: el calendario
 * del cliente reconoce una reprogramación porque llega el MISMO UID con un
 * SEQUENCE mayor (RFC 5545 §3.8.4.7 y §3.8.7.4). Si cambiara, cada
 * reprogramación le dejaría un evento duplicado.
 */
const DOMINIO_UID = 'staff.mercadomedialuna.com'

/** Lima no tiene horario de verano: UTC−5 todo el año. Aun así no se escribe el desfase a mano. */
const ZONA_LIMA = 'America/Lima'
const IDIOMA = 'es-PE'

/** RFC 5545 §3.7.3. Sin la razón social: esa sigue 🔴 en parámetros. */
const PRODID = '-//Mercado Media Luna//CRM MML//ES'

// La paleta del correo: los tokens de marca de tailwind.config.js, escritos a
// mano porque un correo no tiene Tailwind. El ámbar NO está, a propósito: el
// fondo del correo es claro, y ámbar sobre claro da 1.79:1 (regla dura de
// marca, 07-crm/CLAUDE.md §6).
const AZUL = '#0F2A44'
const SUELO = '#14181C'
const SUELO_700 = '#3A424A'
const CAL = '#F6F2EA'
const CAL_300 = '#DED5C3'
const TARJETA = '#FDFCF9'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Lo que devuelve `fn_datos_aviso_visita`, ya comprobado y en camelCase. */
export type DatosAviso = {
  visita: {
    id: string
    tipo: string
    estado: string
    inicioEl: string
    duracionMin: number | null
    icsUid: string
    icsSecuencia: number
    nota: string | null
  }
  persona: {
    id: string
    nombre: string
    email: string | null
    telefonoE164: string | null
    consentimiento: boolean
    noContactar: boolean
  }
  agente: { nombre: string | null; telefono: string | null }
  empresa: {
    razonSocial: string | null
    ruc: string | null
    correoContacto: string | null
    whatsapp: string | null
  }
  lugar: { puntoEncuentro: string | null; mapaUrl: string | null; horario: string | null }
  avisoPrivacidadVersion: string | null
  puedeEnviarEmail: boolean
  motivoNoEnvio: string | null
}

export type PlantillaAviso = 'confirmacion' | 'recordatorio' | 'cancelacion'

/** `faltantes` = ids de `parametros` cuya ausencia cambió el texto (p. ej. 'visita_mapa_url'). */
export type AvisoArmado = {
  asunto: string
  texto: string
  html: string
  whatsapp: string
  faltantes: string[]
}

/** Los tres tipos de `visitas.tipo` (CHECK de 13-seguimiento-comercial.sql). */
const TIPOS_VISITA = ['obra', 'videollamada', 'oficina'] as const
type TipoVisita = (typeof TIPOS_VISITA)[number]

function esTipoVisita(valor: string): valor is TipoVisita {
  return (TIPOS_VISITA as readonly string[]).includes(valor)
}

// ---------------------------------------------------------------------------
// Lectura de la respuesta — falla cerrado
// ---------------------------------------------------------------------------

function registro(valor: unknown): Record<string, unknown> | null {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null
}

/** Cadena recortada, o `null` si no es cadena o queda vacía. */
function textoLimpio(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const limpio = valor.trim()
  return limpio === '' ? null : limpio
}

function enteroSeguro(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isInteger(valor) ? valor : null
}

function instanteValido(valor: unknown): string | null {
  const t = textoLimpio(valor)
  if (t === null) return null
  return Number.isNaN(new Date(t).getTime()) ? null : t
}

/**
 * Un correo que se puede poner en un `mailto:` y en un ORGANIZER/ATTENDEE sin
 * escaparlo. Es deliberadamente estricto: una dirección con comillas, comas o
 * espacios no se «arregla», se descarta — y entonces no se ofrece el correo.
 */
function correoValido(valor: unknown): string | null {
  const t = textoLimpio(valor)
  if (t === null) return null
  return /^[^\s@<>()"',;:\\[\]]+@[^\s@<>()"',;:\\[\]]+\.[^\s@<>()"',;:\\[\]]+$/.test(t) ? t : null
}

/**
 * Solo enlaces http(s) sin espacios ni comillas. Un `javascript:` o un texto
 * suelto en `visita_mapa_url` se trata como AUSENTE (y sale en `faltantes`):
 * es un enlace que va a pulsar un cliente.
 */
function urlSegura(valor: unknown): string | null {
  const t = textoLimpio(valor)
  if (t === null) return null
  return /^https?:\/\/[^\s"'<>\\]+$/i.test(t) ? t : null
}

/**
 * Lee la respuesta jsonb (snake_case) de `fn_datos_aviso_visita`.
 *
 * Devuelve `null` si falta algo sin lo que el aviso no se puede armar con
 * verdad (id, tipo conocido, inicio válido, UID del calendario). Y los
 * permisos fallan CERRADOS: `consentimiento` solo es `true` si llega `true`;
 * `noContactar` es `true` salvo que llegue exactamente `false`. Un «no sé» no
 * autoriza a escribirle a nadie (Ley 29733).
 */
export function interpretarDatosAviso(respuesta: unknown): DatosAviso | null {
  const r = registro(respuesta)
  if (r === null || r['ok'] === false) return null

  const v = registro(r['visita'])
  const p = registro(r['persona'])
  if (v === null || p === null) return null

  const id = textoLimpio(v['id'])
  const tipo = textoLimpio(v['tipo'])
  const estado = textoLimpio(v['estado'])
  const inicioEl = instanteValido(v['inicio_el'])
  const icsUid = textoLimpio(v['ics_uid'])
  const icsSecuencia = enteroSeguro(v['ics_secuencia'])
  const personaId = textoLimpio(p['id'])
  // El nombre puede venir vacío (un lead de TikTok sin nombre): se admite y el
  // saludo queda en «Hola:». Lo que no se admite es que no venga.
  const nombre = typeof p['nombre'] === 'string' ? p['nombre'].trim() : null

  if (
    id === null ||
    tipo === null ||
    !esTipoVisita(tipo) ||
    estado === null ||
    inicioEl === null ||
    icsUid === null ||
    icsSecuencia === null ||
    icsSecuencia < 0 ||
    personaId === null ||
    nombre === null
  ) {
    return null
  }

  const duracion = enteroSeguro(v['duracion_min'])
  const agente: Record<string, unknown> = registro(r['agente']) ?? {}
  const empresa: Record<string, unknown> = registro(r['empresa']) ?? {}
  const lugar: Record<string, unknown> = registro(r['lugar']) ?? {}

  return {
    visita: {
      id,
      tipo,
      estado,
      inicioEl,
      duracionMin: duracion !== null && duracion > 0 ? duracion : null,
      icsUid,
      icsSecuencia,
      nota: textoLimpio(v['nota']),
    },
    persona: {
      id: personaId,
      nombre,
      email: correoValido(p['email']),
      telefonoE164: textoLimpio(p['telefono_e164']),
      consentimiento: p['consentimiento'] === true,
      noContactar: p['no_contactar'] !== false,
    },
    agente: { nombre: textoLimpio(agente['nombre']), telefono: textoLimpio(agente['telefono']) },
    empresa: {
      razonSocial: textoLimpio(empresa['razon_social']),
      ruc: textoLimpio(empresa['ruc']),
      correoContacto: correoValido(empresa['correo_contacto']),
      whatsapp: textoLimpio(empresa['whatsapp']),
    },
    lugar: {
      puntoEncuentro: textoLimpio(lugar['punto_encuentro']),
      mapaUrl: urlSegura(lugar['mapa_url']),
      horario: textoLimpio(lugar['horario']),
    },
    avisoPrivacidadVersion: textoLimpio(r['aviso_privacidad_version']),
    puedeEnviarEmail: r['puede_enviar_email'] === true,
    motivoNoEnvio: textoLimpio(r['motivo_no_envio']),
  }
}

// ---------------------------------------------------------------------------
// Fechas en hora de Lima
// ---------------------------------------------------------------------------

/**
 * `Intl` en vez de date-fns (que usa src/lib/fechas.ts) por dos razones: este
 * archivo no puede importar nada, y date-fns formatea en la zona del
 * DISPOSITIVO. Un vendedor con el celular en otra zona, o el servidor de la
 * Edge Function (que corre en UTC), escribirían otra hora. Aquí la zona es
 * siempre America/Lima, la del cliente y la de la obra.
 */
function partesLima(
  fecha: Date,
  opciones: Intl.DateTimeFormatOptions,
  idioma: string,
): Partial<Record<Intl.DateTimeFormatPartTypes, string>> {
  const salida: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
  const formato = new Intl.DateTimeFormat(idioma, { ...opciones, timeZone: ZONA_LIMA })
  for (const parte of formato.formatToParts(fecha)) {
    if (parte.type !== 'literal') salida[parte.type] = parte.value
  }
  return salida
}

/**
 * Los motores de `Intl` separan «p. m.» con espacios de no separación
 * (U+00A0, U+202F) según la versión de ICU. En un correo de texto y en un
 * `.ics` eso se ve como basura en algunos clientes; se normaliza a espacio.
 */
function espaciosNormales(texto: string): string {
  return texto.replace(/[   ]/g, ' ')
}

/**
 * `'miércoles 30 de setiembre'`, `'7:30 p. m.'` y la frase completa
 * `'miércoles 30 de setiembre, 7:30 p. m. (hora de Lima)'`.
 *
 * El mes sale como lo escribe el español del Perú (es-PE usa «setiembre»):
 * es el cliente quien lo lee.
 */
export function fechaVisitaLima(iso: string): { dia: string; hora: string; completa: string } {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return { dia: '—', hora: '—', completa: '—' }

  const p = partesLima(fecha, { weekday: 'long', day: 'numeric', month: 'long' }, IDIOMA)
  const dia = `${p.weekday ?? ''} ${p.day ?? ''} de ${p.month ?? ''}`.trim()

  const hora = espaciosNormales(
    new Intl.DateTimeFormat(IDIOMA, {
      timeZone: ZONA_LIMA,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(fecha),
  )

  return { dia, hora, completa: `${dia}, ${hora} (hora de Lima)` }
}

/**
 * El día de calendario en Lima, `'2026-09-30'`, o `null` si la fecha no vale.
 * Lo usan el «de hoy / de mañana» del recordatorio y el nombre del `.ics`
 * (src/lib/visitas.ts): un solo criterio sobre qué día es en Lima.
 */
export function diaLima(iso: string): string | null {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return null
  const p = partesLima(fecha, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA')
  if (p.year === undefined || p.month === undefined || p.day === undefined) return null
  return `${p.year}-${p.month}-${p.day}`
}

/** Un día de calendario en milisegundos. Conversión de unidades, no cifra del negocio. */
const UN_DIA_MS = 24 * 60 * 60 * 1000

/**
 * 'hoy' / 'mañana' respecto de `ahora`, en días de calendario de Lima; si no
 * es ninguno de los dos, `null`. Lima no tiene horario de verano, así que
 * «ahora + 24 h» cae siempre en el día siguiente.
 */
function diaRelativo(inicioEl: string, ahora: Date): 'hoy' | 'mañana' | null {
  const dia = diaLima(inicioEl)
  if (dia === null) return null
  if (dia === diaLima(ahora.toISOString())) return 'hoy'
  if (dia === diaLima(new Date(ahora.getTime() + UN_DIA_MS).toISOString())) return 'mañana'
  return null
}

/** «a la 1:30 p. m.» pero «a las 7:30 p. m.»: con la una, el artículo es singular. */
function aLaHora(hora: string): string {
  return /^1:/.test(hora) ? `a la ${hora}` : `a las ${hora}`
}

/** Cierra la frase con punto, salvo que ya termine en uno («… 7:30 p. m.» no lleva dos). */
function conPunto(frase: string): string {
  return frase.endsWith('.') ? frase : `${frase}.`
}

// ---------------------------------------------------------------------------
// Pequeños formatos
// ---------------------------------------------------------------------------

/** Escapa lo que va dentro de HTML (texto y atributos entre comillas dobles). */
export function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * El primer nombre, con mayúscula inicial, para el saludo. Los nombres de un
 * live llegan como se escribieron («JUAN🔥», «maría josé»): se toma la primera
 * palabra, se quitan símbolos y se capitaliza. Sin nombre utilizable, `null`
 * — y el saludo queda en «Hola:», nunca en «Hola, cliente:».
 */
function nombreDeSaludo(nombreCompleto: string): string | null {
  const primero = nombreCompleto.trim().split(/\s+/)[0] ?? ''
  const limpio = primero.replace(/[^\p{L}\p{M}'-]/gu, '')
  if (limpio === '') return null
  const minusculas = limpio.toLocaleLowerCase('es')
  return minusculas.charAt(0).toLocaleUpperCase('es') + minusculas.slice(1)
}

/** '+51987654321' → '+51 987 654 321'. Cualquier otro formato se deja tal cual. */
function telefonoLegible(e164: string): string {
  const m = /^\+51(\d{3})(\d{3})(\d{3})$/.exec(e164)
  return m === null ? e164 : `+51 ${m[1] ?? ''} ${m[2] ?? ''} ${m[3] ?? ''}`
}

function agregarUnico(lista: string[], id: string): void {
  if (!lista.includes(id)) lista.push(id)
}

// ---------------------------------------------------------------------------
// El contenido, una sola vez — y de él salen el texto y el HTML
// ---------------------------------------------------------------------------

/**
 * El correo se arma primero como DATOS y luego se pinta dos veces (texto plano
 * y HTML). Escribir dos plantillas a mano garantiza que un día digan cosas
 * distintas; y la versión de texto es la que lee el filtro antispam y la que
 * viaja en el `mailto:`.
 */
type FilaDato = { rotulo: string; texto: string; enlace?: string | undefined }

type Contenido = {
  asunto: string
  titulo: string
  saludo: string
  parrafos: string[]
  datos: FilaDato[]
  cierre: string[]
  firma: string[]
  pie: string[]
  versionPrivacidad: string | null
}

/** Cómo se nombra cada tipo dentro de una frase. */
const FRASES: Record<TipoVisita, { su: string; con: string }> = {
  obra: { su: 'su visita', con: `a la obra de ${PROYECTO}` },
  videollamada: { su: 'su videollamada', con: `con el equipo de ${PROYECTO}` },
  oficina: { su: 'su cita', con: `en la oficina de ${PROYECTO}` },
}

/** Las filas «dónde / cómo» según el tipo. Anota en `faltantes` lo que no está. */
function filasDeLugar(d: DatosAviso, tipo: TipoVisita, faltantes: string[]): FilaDato[] {
  if (tipo === 'videollamada') {
    return [{ rotulo: 'Cómo', texto: 'Le enviaremos el enlace por WhatsApp antes de la hora.' }]
  }
  if (tipo === 'oficina') {
    // No existe un parámetro con la dirección de la oficina, y el punto de
    // encuentro de la OBRA no sirve: mandaría al cliente al sitio equivocado.
    return [{ rotulo: 'Dónde', texto: 'Le enviaremos la dirección exacta por WhatsApp.' }]
  }

  const filas: FilaDato[] = []
  if (d.lugar.puntoEncuentro !== null) {
    filas.push({ rotulo: 'Punto de encuentro', texto: d.lugar.puntoEncuentro })
  } else {
    agregarUnico(faltantes, 'visita_punto_encuentro')
  }
  if (d.lugar.mapaUrl !== null) {
    filas.push({ rotulo: 'Cómo llegar', texto: 'Abrir la ubicación en el mapa', enlace: d.lugar.mapaUrl })
  } else {
    agregarUnico(faltantes, 'visita_mapa_url')
    filas.push({ rotulo: 'Cómo llegar', texto: 'Le enviaremos la ubicación exacta por WhatsApp.' })
  }
  return filas
}

function filaAgente(d: DatosAviso): FilaDato[] {
  if (d.agente.nombre === null) return []
  const telefono = d.agente.telefono === null ? '' : ` · WhatsApp ${telefonoLegible(d.agente.telefono)}`
  return [{ rotulo: 'Le atenderá', texto: `${d.agente.nombre}${telefono}` }]
}

/**
 * El número al que el cliente puede escribir. El de la empresa si está en 🟢;
 * si no, el del vendedor que lo atiende. Si no hay ninguno, la frase queda sin
 * número («escríbanos por WhatsApp»): el cliente responde al chat donde ya
 * habla con nosotros.
 */
function numeroDeContacto(d: DatosAviso): string | null {
  const numero = d.empresa.whatsapp ?? d.agente.telefono
  return numero === null ? null : telefonoLegible(numero)
}

function alNumero(d: DatosAviso): string {
  const numero = numeroDeContacto(d)
  return numero === null ? '' : ` al ${numero}`
}

/** El pie legal. Anota en `faltantes` lo que falta de la empresa y del aviso de privacidad. */
function pieLegal(d: DatosAviso, faltantes: string[]): string[] {
  const pie: string[] = []

  if (d.empresa.razonSocial === null) agregarUnico(faltantes, 'razon_social')
  if (d.empresa.ruc === null) agregarUnico(faltantes, 'ruc')
  const empresa = [d.empresa.razonSocial, d.empresa.ruc === null ? null : `RUC ${d.empresa.ruc}`]
    .filter((x): x is string => x !== null)
    .join(' · ')
  if (empresa !== '') pie.push(empresa)

  if (d.empresa.correoContacto !== null) pie.push(`Contacto: ${d.empresa.correoContacto}`)
  else agregarUnico(faltantes, 'correo_contacto_publico')

  if (d.empresa.whatsapp === null) agregarUnico(faltantes, 'whatsapp_empresa')

  // Texto de compliance-handling (Sales-Skills, citado en analisis/sales.md §4).
  pie.push(
    'Recibe este correo porque agendó una visita con nosotros. ' +
      'Si no desea recibir más correos, responda BAJA.',
  )

  if (d.avisoPrivacidadVersion === null) agregarUnico(faltantes, 'aviso_privacidad_version')
  return pie
}

function firma(d: DatosAviso): string[] {
  return ['Atentamente,', ...(d.agente.nombre === null ? [] : [d.agente.nombre]), PROYECTO]
}

function contenidoConfirmacion(d: DatosAviso, tipo: TipoVisita, faltantes: string[]): Contenido {
  const f = fechaVisitaLima(d.visita.inicioEl)
  const frase = FRASES[tipo]

  const asunto =
    tipo === 'obra'
      ? `Confirmada su visita a ${PROYECTO} — ${f.dia}, ${f.hora}`
      : tipo === 'videollamada'
        ? `Confirmada su videollamada con ${PROYECTO} — ${f.dia}, ${f.hora}`
        : `Confirmada su cita con ${PROYECTO} — ${f.dia}, ${f.hora}`

  const titulo =
    tipo === 'obra'
      ? 'Su visita a la obra está agendada'
      : tipo === 'videollamada'
        ? 'Su videollamada está agendada'
        : 'Su cita en la oficina está agendada'

  const cierre: string[] = [
    tipo === 'videollamada'
      ? 'Si desea, conéctese junto con la persona con quien toma la decisión.'
      : 'Si desea, venga con la persona con quien toma la decisión.',
  ]
  if (tipo === 'obra') cierre.push('Es una obra en construcción: le recomendamos calzado cómodo.')
  cierre.push(`Para reprogramar, responda este correo o escríbanos por WhatsApp${alNumero(d)}.`)

  return {
    asunto,
    titulo,
    saludo: saludo(d),
    parrafos: [`Le confirmamos ${frase.su} ${frase.con}.`],
    datos: [
      { rotulo: 'Cuándo', texto: f.completa },
      ...filasDeLugar(d, tipo, faltantes),
      ...filaAgente(d),
    ],
    cierre,
    firma: firma(d),
    pie: pieLegal(d, faltantes),
    versionPrivacidad: d.avisoPrivacidadVersion,
  }
}

function contenidoRecordatorio(
  d: DatosAviso,
  tipo: TipoVisita,
  faltantes: string[],
  ahora: Date,
): Contenido {
  const f = fechaVisitaLima(d.visita.inicioEl)
  const frase = FRASES[tipo]
  const relativo = diaRelativo(d.visita.inicioEl, ahora)
  const deCuando = relativo === null ? `del ${f.dia}` : `de ${relativo}`
  const cuandoCorto = relativo ?? f.dia

  const asunto =
    tipo === 'obra'
      ? `Recordatorio: su visita a ${PROYECTO} — ${cuandoCorto}, ${f.hora}`
      : tipo === 'videollamada'
        ? `Recordatorio: su videollamada con ${PROYECTO} — ${cuandoCorto}, ${f.hora}`
        : `Recordatorio: su cita con ${PROYECTO} — ${cuandoCorto}, ${f.hora}`

  return {
    asunto,
    titulo: 'Le recordamos su cita',
    saludo: saludo(d),
    parrafos: [`Le recordamos ${frase.su} ${deCuando} ${frase.con}.`],
    datos: [
      { rotulo: 'Cuándo', texto: f.completa },
      ...filasDeLugar(d, tipo, faltantes),
      ...filaAgente(d),
    ],
    cierre: [
      `Si necesita reprogramar, responda este correo o escríbanos por WhatsApp${alNumero(d)}.`,
    ],
    firma: firma(d),
    pie: pieLegal(d, faltantes),
    versionPrivacidad: d.avisoPrivacidadVersion,
  }
}

function contenidoCancelacion(d: DatosAviso, tipo: TipoVisita, faltantes: string[]): Contenido {
  const f = fechaVisitaLima(d.visita.inicioEl)
  const frase = FRASES[tipo]

  const asunto =
    tipo === 'obra'
      ? `Cancelada su visita a ${PROYECTO} — ${f.dia}, ${f.hora}`
      : tipo === 'videollamada'
        ? `Cancelada su videollamada con ${PROYECTO} — ${f.dia}, ${f.hora}`
        : `Cancelada su cita con ${PROYECTO} — ${f.dia}, ${f.hora}`

  return {
    asunto,
    titulo:
      tipo === 'obra'
        ? 'Su visita quedó cancelada'
        : tipo === 'videollamada'
          ? 'Su videollamada quedó cancelada'
          : 'Su cita quedó cancelada',
    saludo: saludo(d),
    parrafos: [`Le confirmamos que ${frase.su} del ${f.completa} quedó cancelada.`],
    datos: [],
    cierre: [
      `Cuando guste, responda este correo o escríbanos por WhatsApp${alNumero(d)} ` +
        'y coordinamos una nueva fecha.',
    ],
    firma: firma(d),
    pie: pieLegal(d, faltantes),
    versionPrivacidad: d.avisoPrivacidadVersion,
  }
}

function saludo(d: DatosAviso): string {
  const nombre = nombreDeSaludo(d.persona.nombre)
  return nombre === null ? 'Hola:' : `Hola, ${nombre}:`
}

function lineaPrivacidad(version: string | null): string {
  return version === null
    ? `Aviso de privacidad: ${URL_PRIVACIDAD}`
    : `Aviso de privacidad (versión ${version}): ${URL_PRIVACIDAD}`
}

function pintarTexto(c: Contenido): string {
  const bloques: string[] = [c.saludo, ...c.parrafos]
  if (c.datos.length > 0) {
    bloques.push(c.datos.map((f) => `${f.rotulo}: ${f.enlace ?? f.texto}`).join('\n'))
  }
  bloques.push(...c.cierre, c.firma.join('\n'))
  bloques.push(['—', ...c.pie, lineaPrivacidad(c.versionPrivacidad)].join('\n'))
  return bloques.join('\n\n')
}

/**
 * HTML de correo: estilos en línea, sin imágenes ni hojas externas (un correo
 * con recursos externos avisa al remitente de cuándo se abrió, y eso es un
 * rastreo que nadie ha decidido). Una tabla para las filas de datos porque es
 * lo único que todos los clientes de correo alinean igual. TODO lo interpolado
 * pasa por `escaparHtml`, incluidos los enlaces.
 */
function pintarHtml(c: Contenido): string {
  const e = escaparHtml
  const parrafo = (t: string): string => `<p style="margin:0 0 16px;">${e(t)}</p>`

  const filas = c.datos
    .map((f) => {
      const valor =
        f.enlace === undefined
          ? e(f.texto)
          : `<a href="${e(f.enlace)}" style="color:${AZUL};font-weight:700;` +
            `text-decoration:underline;">${e(f.texto)}</a>`
      return (
        '<tr>' +
        `<td style="padding:6px 16px 6px 0;vertical-align:top;font-size:12px;font-weight:700;` +
        `letter-spacing:0.06em;text-transform:uppercase;color:${SUELO_700};">${e(f.rotulo)}</td>` +
        `<td style="padding:6px 0;vertical-align:top;font-weight:700;color:${SUELO};">${valor}</td>` +
        '</tr>'
      )
    })
    .join('')

  const tabla =
    c.datos.length === 0
      ? ''
      : '<table role="presentation" cellpadding="0" cellspacing="0" border="0" ' +
        `style="margin:0 0 16px;border-collapse:collapse;">${filas}</table>`

  const pie = c.pie.map((t) => `<p style="margin:0 0 8px;">${e(t)}</p>`).join('')
  const version = c.versionPrivacidad === null ? '' : ` (versión ${e(c.versionPrivacidad)})`
  const privacidad =
    `<p style="margin:0;">Aviso de privacidad${version}: ` +
    `<a href="${e(URL_PRIVACIDAD)}" style="color:${AZUL};text-decoration:underline;">` +
    `${e(URL_PRIVACIDAD)}</a></p>`

  return (
    '<!DOCTYPE html>' +
    '<html lang="es"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="color-scheme" content="light">' +
    `<title>${e(c.asunto)}</title></head>` +
    `<body style="margin:0;padding:0;background-color:${CAL};">` +
    '<div style="max-width:560px;margin:0 auto;padding:24px 16px;' +
    `font-family:Archivo,Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:${SUELO};">` +
    `<div style="background-color:${TARJETA};border:1px solid ${CAL_300};border-radius:12px;padding:24px;">` +
    '<p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.1em;' +
    `text-transform:uppercase;color:${AZUL};">${e(PROYECTO)}</p>` +
    `<h1 style="margin:0 0 20px;font-size:22px;line-height:1.25;font-weight:900;color:${AZUL};">` +
    `${e(c.titulo)}</h1>` +
    parrafo(c.saludo) +
    c.parrafos.map(parrafo).join('') +
    tabla +
    c.cierre.map(parrafo).join('') +
    `<p style="margin:0;">${c.firma.map(e).join('<br>')}</p>` +
    '</div>' +
    `<div style="padding:16px 8px 0;font-size:12px;line-height:1.5;color:${SUELO_700};">` +
    pie +
    privacidad +
    '</div></div></body></html>'
  )
}

// ---------------------------------------------------------------------------
// WhatsApp — 2 o 3 líneas, de usted, lo escribe el propio vendedor
// ---------------------------------------------------------------------------

function textoWhatsApp(
  d: DatosAviso,
  tipo: TipoVisita,
  plantilla: PlantillaAviso,
  ahora: Date,
): string {
  const f = fechaVisitaLima(d.visita.inicioEl)
  const nombre = nombreDeSaludo(d.persona.nombre)
  const hola = nombre === null ? 'Hola.' : `Hola, ${nombre}.`
  // Quien está lejos (videollamada) puede estar en otra zona horaria.
  const hora = tipo === 'videollamada' ? `${aLaHora(f.hora)} (hora de Lima)` : aLaHora(f.hora)
  const frase = FRASES[tipo]

  const comoLlegar =
    tipo === 'videollamada'
      ? 'Le enviaré el enlace por aquí antes de la hora.'
      : tipo === 'oficina'
        ? 'Le enviaré la dirección exacta por aquí.'
        : d.lugar.mapaUrl === null
          ? 'Le enviaré la ubicación exacta por aquí.'
          : `Ubicación: ${d.lugar.mapaUrl}`

  if (plantilla === 'cancelacion') {
    return [
      `${hola} Le confirmo que ${frase.su} del ${f.dia} ${hora} quedó cancelada.`,
      'Cuando guste, me escribe y coordinamos otra fecha.',
    ].join('\n')
  }

  if (plantilla === 'recordatorio') {
    const relativo = diaRelativo(d.visita.inicioEl, ahora)
    const deCuando = relativo === null ? `del ${f.dia}` : `de ${relativo}`
    return [
      `${hola} Le recuerdo ${frase.su} ${deCuando} ${frase.con}, ${conPunto(hora)}`,
      comoLlegar,
      '¿Sigue en pie?',
    ].join('\n')
  }

  const atiende = d.agente.nombre === null ? '' : ` Le atenderá ${conPunto(d.agente.nombre)}`
  return [
    `${hola} Le confirmo ${frase.su} ${frase.con} el ${f.dia} ${conPunto(hora)}${atiende}`,
    comoLlegar,
    'Si le surge algo, me escribe y la reprogramamos.',
  ].join('\n')
}

/**
 * Arma el aviso de una visita: asunto, texto plano, HTML, texto de WhatsApp y
 * la lista de parámetros que faltan.
 *
 * NO decide si se puede enviar: eso es `puedeEnviarEmail` / `noContactar` /
 * `consentimiento`, y lo hace cumplir quien envía (la pantalla y la Edge
 * Function). Aquí solo se escribe el texto.
 *
 * `ahora` existe para el «de hoy / de mañana» del recordatorio y para poder
 * probarlo; en uso normal se omite.
 */
export function armarAviso(
  d: DatosAviso,
  plantilla: PlantillaAviso,
  ahora: Date = new Date(),
): AvisoArmado {
  // `interpretarDatosAviso` ya descarta los tipos desconocidos; esto solo
  // protege a quien construya un DatosAviso a mano.
  const tipo: TipoVisita = esTipoVisita(d.visita.tipo) ? d.visita.tipo : 'obra'
  const faltantes: string[] = []

  const contenido =
    plantilla === 'confirmacion'
      ? contenidoConfirmacion(d, tipo, faltantes)
      : plantilla === 'recordatorio'
        ? contenidoRecordatorio(d, tipo, faltantes, ahora)
        : contenidoCancelacion(d, tipo, faltantes)

  return {
    asunto: contenido.asunto,
    texto: pintarTexto(contenido),
    html: pintarHtml(contenido),
    whatsapp: textoWhatsApp(d, tipo, plantilla, ahora),
    faltantes,
  }
}

// ---------------------------------------------------------------------------
// La invitación de calendario — RFC 5545
// ---------------------------------------------------------------------------

/** 'YYYYMMDDTHHMMSSZ' en UTC (RFC 5545 §3.3.5, forma 2). Sin VTIMEZONE que mantener. */
function instanteUtc(fecha: Date): string {
  const d2 = (n: number): string => String(n).padStart(2, '0')
  return (
    String(fecha.getUTCFullYear()).padStart(4, '0') +
    d2(fecha.getUTCMonth() + 1) +
    d2(fecha.getUTCDate()) +
    'T' +
    d2(fecha.getUTCHours()) +
    d2(fecha.getUTCMinutes()) +
    d2(fecha.getUTCSeconds()) +
    'Z'
  )
}

/**
 * Escapa un valor TEXT (RFC 5545 §3.3.11): barra invertida, punto y coma,
 * coma y saltos de línea. La barra va PRIMERO, o se escaparían las barras que
 * acaba de poner el resto. Los demás caracteres de control no están
 * permitidos en TEXT y se quitan.
 */
function escaparTextoIcs(texto: string): string {
  return texto
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
}

/**
 * Un valor de parámetro (p. ej. `CN=`) entre comillas (RFC 5545 §3.1): no
 * puede llevar comillas dobles ni caracteres de control, así que se quitan.
 */
function valorParametro(texto: string): string {
  return `"${texto.replace(/["\u0000-\u001f\u007f]/g, '')}"`
}

/** Octetos UTF-8 de un punto de código, sin TextEncoder (este archivo corre también en Deno). */
function octetosUtf8(caracter: string): number {
  const punto = caracter.codePointAt(0) ?? 0
  if (punto < 0x80) return 1
  if (punto < 0x800) return 2
  if (punto < 0x10000) return 3
  return 4
}

/** Longitud máxima de una línea de contenido, en octetos, sin contar el CRLF (RFC 5545 §3.1). */
const OCTETOS_POR_LINEA = 75

/**
 * Pliega una línea a 75 OCTETOS (no caracteres): «Dónde» o «miércoles» ocupan
 * más bytes que letras, y un cliente estricto rechaza la línea larga. Cada
 * continuación empieza con un espacio, que cuenta dentro de sus 75. Se corta
 * entre puntos de código, nunca a mitad de una secuencia UTF-8.
 */
function plegarLinea(linea: string): string {
  let salida = ''
  let actual = ''
  let octetos = 0
  for (const caracter of linea) {
    const n = octetosUtf8(caracter)
    if (octetos + n > OCTETOS_POR_LINEA) {
      salida += `${actual}\r\n `
      actual = ''
      octetos = 1 // el espacio inicial de la continuación
    }
    actual += caracter
    octetos += n
  }
  return salida + actual
}

/**
 * La invitación `.ics` de la visita (RFC 5545), lista para adjuntar.
 *
 *  - UID estable `<ics_uid>@staff.mercadomedialuna.com` y SEQUENCE de la base:
 *    al reprogramar, `fn_agendar_visita` conserva el UID y sube la secuencia,
 *    y el calendario del cliente MUEVE el evento en vez de duplicarlo.
 *  - CANCEL usa la secuencia + 1: una cancelación es un cambio posterior a la
 *    última invitación enviada, y un calendario ignora un CANCEL con una
 *    secuencia menor que la del evento que tiene guardado.
 *  - Horas en UTC con 'Z': no hay VTIMEZONE que mantener, y el calendario del
 *    cliente lo pinta en su zona.
 *  - DTEND solo si `visita_duracion_min` tiene valor. Sin él, el evento queda
 *    sin fin (un instante): es la verdad, no se inventa una duración.
 *  - ORGANIZER solo si hay correo de contacto 🟢; y ATTENDEE solo si además
 *    hay ORGANIZER (un invitado sin organizador es una invitación incoherente).
 *  - Alarmas 24 h y 2 h antes (SPEC §6.B; meeting-confirmation-reminder-logic).
 */
export function armarIcs(
  d: DatosAviso,
  metodo: 'REQUEST' | 'CANCEL',
  ahora: Date = new Date(),
): string {
  const tipo: TipoVisita = esTipoVisita(d.visita.tipo) ? d.visita.tipo : 'obra'
  const inicio = new Date(d.visita.inicioEl)
  const cancelar = metodo === 'CANCEL'
  const uid = `${d.visita.icsUid.replace(/[^A-Za-z0-9-]/g, '')}@${DOMINIO_UID}`
  const secuencia = cancelar ? d.visita.icsSecuencia + 1 : d.visita.icsSecuencia
  const resumen =
    tipo === 'videollamada' ? `Videollamada con ${PROYECTO}` : `Visita a ${PROYECTO}`

  const numero = numeroDeContacto(d)
  const escribanos = `escríbanos por WhatsApp${numero === null ? '' : ` al ${numero}`}`

  const descripcion: string[] = []
  if (cancelar) {
    descripcion.push(
      tipo === 'obra'
        ? 'Esta visita quedó cancelada.'
        : tipo === 'videollamada'
          ? 'Esta videollamada quedó cancelada.'
          : 'Esta cita quedó cancelada.',
      `Para coordinar otra fecha, ${escribanos}.`,
    )
  } else {
    if (tipo === 'videollamada') {
      descripcion.push('Le enviaremos el enlace por WhatsApp antes de la hora.')
    } else if (tipo === 'oficina') {
      descripcion.push('Le enviaremos la dirección exacta de la oficina por WhatsApp.')
    } else {
      if (d.lugar.puntoEncuentro !== null) {
        descripcion.push(`Punto de encuentro: ${d.lugar.puntoEncuentro}`)
      }
      descripcion.push(
        d.lugar.mapaUrl === null
          ? 'Le enviaremos la ubicación exacta por WhatsApp.'
          : `Mapa: ${d.lugar.mapaUrl}`,
      )
    }
    if (d.agente.nombre !== null) {
      const tel = d.agente.telefono === null ? '' : ` (WhatsApp ${telefonoLegible(d.agente.telefono)})`
      descripcion.push(`Le atenderá: ${d.agente.nombre}${tel}`)
    }
    descripcion.push(`Para reprogramar, ${escribanos}.`)
  }

  const lugar =
    tipo === 'videollamada'
      ? 'Videollamada (el enlace llega por WhatsApp)'
      : tipo === 'obra'
        ? d.lugar.puntoEncuentro
        : null

  const lineas: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    `METHOD:${metodo}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SEQUENCE:${secuencia}`,
    `DTSTAMP:${instanteUtc(ahora)}`,
    `DTSTART:${instanteUtc(inicio)}`,
  ]
  if (d.visita.duracionMin !== null) {
    lineas.push(`DTEND:${instanteUtc(new Date(inicio.getTime() + d.visita.duracionMin * 60_000))}`)
  }
  lineas.push(`SUMMARY:${escaparTextoIcs(resumen)}`)
  if (lugar !== null) lineas.push(`LOCATION:${escaparTextoIcs(lugar)}`)
  // URL es de tipo URI, no TEXT: no se escapa. `urlSegura` ya garantizó que no
  // lleva espacios, comillas ni saltos de línea.
  if (tipo === 'obra' && d.lugar.mapaUrl !== null) lineas.push(`URL:${d.lugar.mapaUrl}`)
  lineas.push(`DESCRIPTION:${escaparTextoIcs(descripcion.join('\n'))}`)

  if (d.empresa.correoContacto !== null) {
    lineas.push(`ORGANIZER;CN=${valorParametro(PROYECTO)}:mailto:${d.empresa.correoContacto}`)
    if (d.persona.email !== null) {
      const cn = d.persona.nombre === '' ? '' : `CN=${valorParametro(d.persona.nombre)};`
      lineas.push(
        `ATTENDEE;${cn}ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:` +
          `mailto:${d.persona.email}`,
      )
    }
  }

  lineas.push(`STATUS:${cancelar ? 'CANCELLED' : 'CONFIRMED'}`, 'TRANSP:OPAQUE')

  if (!cancelar) {
    for (const aviso of ['-PT24H', '-PT2H']) {
      lineas.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escaparTextoIcs(resumen)}`,
        `TRIGGER:${aviso}`,
        'END:VALARM',
      )
    }
  }

  lineas.push('END:VEVENT', 'END:VCALENDAR')

  // RFC 5545 §3.1: cada línea termina en CRLF, también la última.
  return lineas.map(plegarLinea).join('\r\n') + '\r\n'
}
