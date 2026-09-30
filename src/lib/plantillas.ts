import type { FilaCartera } from '@/lib/cartera'

/**
 * Plantillas de WhatsApp para el seguimiento de prospectos.
 *
 * ---------------------------------------------------------------------------
 * LAS REGLAS QUE CUMPLE CADA MENSAJE (SPEC 13 §2)
 * ---------------------------------------------------------------------------
 * Esto es texto que lee el CLIENTE. Por eso ningun mensaje:
 *  · nombra el distrito (esta en disputa; la regla es no nombrarlo nunca en
 *    material para el cliente — analisis/negocio.md §1, PENDIENTES S2-10);
 *  · promete precio, financiamiento, cuotas, rentabilidad, alquiler ni
 *    plusvalia (no hay modelo de renta que se pueda respaldar: la propia web
 *    lo dice, embudo.js:40);
 *  · da fechas de entrega ni porcentaje de avance, ni ninguna fecha;
 *  · usa escasez («ultimos cupos», «solo quedan…»);
 *  · dice «titulo de propiedad» (lo que se adquiere son acciones y derechos
 *    sobre el inmueble matriz, ficha-proyecto-mml.md:67-72);
 *  · pide dinero ni DNI.
 * Trato de usted, 2–3 lineas, y solo se rellena con datos que se conocen: si
 * falta el nombre, el mensaje se arma sin nombre en vez de inventar uno.
 *
 * Fuente de la redaccion: analisis/sales.md §2 (G1–G4, R1, respuesta a «no me
 * interesa», confirmacion de baja) y §3 (D0), ADAPTADA: se quitaron el video
 * de avance y el nombre del lugar de G2 (no hay video vigente verificado y el
 * lugar no se nombra), y el gancho «verificado» de R1 (no hay ninguno cargado:
 * no se inventa).
 *
 * `fechaIngreso` y `campana` llegan en los datos pero NUNCA se escriben
 * literales: el nombre de la campaña es interno (y suele llevar fecha,
 * «TikTok Live 28/09»), y el mensaje no lleva fechas. De la campaña solo se
 * deduce la red del live («en el live de TikTok»).
 *
 * Este archivo no contiene ninguna cifra ni ninguna condicion comercial.
 */

export const PLANTILLAS = [
  { id: 'primer_contacto_live', etiqueta: 'Primer contacto (live)' },
  { id: 'primer_contacto_web', etiqueta: 'Primer contacto (web)' },
  { id: 'seguimiento_1', etiqueta: 'Seguimiento suave' },
  { id: 'seguimiento_2', etiqueta: 'Seguimiento con valor (visita)' },
  { id: 'seguimiento_3', etiqueta: '¿Sigue interesado?' },
  { id: 'cierre_ciclo', etiqueta: 'Último mensaje por ahora' },
  { id: 'reactivacion', etiqueta: 'Reactivación' },
  { id: 'respuesta_no_interesa', etiqueta: 'Respuesta a "no me interesa"' },
  { id: 'confirmar_no_contacto', etiqueta: 'Confirmar que no le escribiremos' },
] as const

export type IdPlantilla = (typeof PLANTILLAS)[number]['id']

const IDS_PLANTILLA: readonly string[] = PLANTILLAS.map((p) => p.id)

export function esIdPlantilla(v: unknown): v is IdPlantilla {
  return typeof v === 'string' && IDS_PLANTILLA.includes(v)
}

export type DatosPlantilla = {
  nombre: string
  agente: string | null
  campana: string | null
  fechaIngreso: string | null
  tipoInteres: string | null
}

// ---------------------------------------------------------------------------
// Nombres
// ---------------------------------------------------------------------------

/** Tratamientos que a veces se escriben delante del nombre y que no son el nombre. */
const TRATAMIENTOS: readonly string[] = [
  'sr',
  'sra',
  'srta',
  'senor',
  'senora',
  'señor',
  'señora',
  'don',
  'dona',
  'doña',
  'dr',
  'dra',
  'ing',
  'lic',
]

/**
 * El primer nombre, listo para saludar: «JUAN CARLOS PÉREZ» → «Juan».
 *
 * Devuelve '' (y el mensaje se arma sin nombre) cuando lo primero no parece un
 * nombre: un @usuario, algo con digitos o guiones bajos («rosita_ventas»). Es
 * mejor «Hola, buenas» que saludar a alguien por su usuario de TikTok.
 */
export function primerNombre(nombreCompleto: string): string {
  const palabras = nombreCompleto.trim().split(/\s+/).filter((p) => p !== '')
  const primera = palabras.find(
    (p) => !TRATAMIENTOS.includes(p.toLowerCase().replace(/\.$/, '')),
  )
  if (primera === undefined) return ''

  // Un @usuario, o algo con digitos o guion bajo, no es un nombre de pila.
  if (/^@|[\d_]/u.test(primera)) return ''
  // Se quitan los signos de puntuacion pegados alrededor («Juan,», «(María)»).
  const limpia = primera.replace(/^[\s"'“”‘’¡!¿?(),.;:]+|[\s"'“”‘’¡!¿?(),.;:]+$/gu, '')
  if (limpia === '' || !/^[\p{L}][\p{L}'’-]*$/u.test(limpia)) return ''

  const todoIgual = limpia === limpia.toUpperCase() || limpia === limpia.toLowerCase()
  if (!todoIgual) return limpia
  return limpia.charAt(0).toUpperCase() + limpia.slice(1).toLowerCase()
}

function mayuscula(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

/** «lo del puesto», «lo de la tienda»… o `null` si no se sabe que busca. */
function loDelInteres(tipo: string | null): string | null {
  switch (tipo) {
    case 'puesto':
      return 'lo del puesto'
    case 'tienda':
      return 'lo de la tienda'
    case 'ambos':
      return 'lo del puesto o la tienda'
    default:
      return null
  }
}

/** «el puesto», «la tienda»… o `null`. */
function elInteres(tipo: string | null): string | null {
  switch (tipo) {
    case 'puesto':
      return 'el puesto'
    case 'tienda':
      return 'la tienda'
    case 'ambos':
      return 'el puesto o la tienda'
    default:
      return null
  }
}

/**
 * De que red era el live, deducido del nombre de la campaña. Si no se puede
 * deducir, «en nuestro live»: nunca se nombra una red que no consta.
 */
function enElLive(campana: string | null): string {
  const c = (campana ?? '').toLowerCase()
  if (c.includes('tiktok')) return 'en el live de TikTok'
  if (c.includes('instagram')) return 'en el live de Instagram'
  if (c.includes('facebook')) return 'en el live de Facebook'
  if (c.includes('youtube')) return 'en el live de YouTube'
  return 'en nuestro live'
}

/** Linea de consentimiento: la persona puede cortar aqui (Ley 29733; SPEC §6.A). */
const LINEA_BAJA = 'Si prefiere que no le escribamos, dígamelo y no insistimos.'

// ---------------------------------------------------------------------------
// Armar
// ---------------------------------------------------------------------------

/**
 * El texto listo para pegar o para abrir en WhatsApp (enlaceWhatsApp). La
 * pantalla lo muestra en un cuadro editable: el vendedor puede cambiarlo, y
 * lo que se registra como `plantilla` es el id de partida.
 */
export function armarMensaje(id: IdPlantilla, d: DatosPlantilla): string {
  const nombre = primerNombre(d.nombre)
  const agente = d.agente === null ? '' : primerNombre(d.agente)

  const saludo = nombre === '' ? 'Hola, buenas.' : `Hola, ${nombre}, buenas.`
  const presentacion =
    agente === '' ? 'Le escribimos de Mercado Media Luna' : `Le saluda ${agente}, de Mercado Media Luna`
  /** «Juan, no quiero…» o, sin nombre, «No quiero…». */
  const aNombre = (resto: string): string => (nombre === '' ? mayuscula(resto) : `${nombre}, ${resto}`)
  const loDe = loDelInteres(d.tipoInteres)
  const el = elInteres(d.tipoInteres)

  const lineas: string[] = []
  switch (id) {
    case 'primer_contacto_live':
      lineas.push(`${saludo} ${presentacion}: nos dejó sus datos ${enElLive(d.campana)}.`)
      lineas.push(
        loDe === null
          ? '¿Busca un puesto o una tienda? Le cuento por aquí o, si prefiere, en una llamada corta.'
          : `¿Le cuento ${loDe} por aquí o prefiere una llamada corta?`,
      )
      lineas.push(LINEA_BAJA)
      break

    case 'primer_contacto_web':
      lineas.push(`${saludo} ${presentacion}, por la información que nos pidió.`)
      lineas.push(
        loDe === null
          ? '¿Le cuento por aquí o prefiere una llamada corta?'
          : `¿Le cuento ${loDe} por aquí o prefiere una llamada corta?`,
      )
      lineas.push(LINEA_BAJA)
      break

    case 'seguimiento_1':
      lineas.push(
        agente === ''
          ? `${saludo} Le escribimos otra vez de Mercado Media Luna.`
          : `${saludo} Soy ${agente}, de Mercado Media Luna, otra vez por aquí.`,
      )
      lineas.push(
        `¿Le cuento ${loDe ?? 'lo que nos consultó'} por aquí o prefiere una llamada corta, a la hora que le acomode?`,
      )
      break

    case 'seguimiento_2':
      lineas.push(
        aNombre(
          'si le sirve, puede conocer el proyecto en persona o, si le queda lejos, por videollamada, sin compromiso.',
        ),
      )
      lineas.push('¿Le parece que coordinemos una visita?')
      break

    case 'seguimiento_3':
      lineas.push(
        `${aNombre('no quiero incomodarle.')} ¿Le sigue interesando ${loDe ?? 'lo de Mercado Media Luna'} o lo dejamos para más adelante?`,
      )
      lineas.push('Con un «sí» o un «más adelante» me basta.')
      break

    case 'cierre_ciclo':
      lineas.push(aNombre('es la última vez que le escribo por ahora; no quiero fastidiarle.'))
      lineas.push('Si más adelante le interesa, escríbame a este número y con gusto le atiendo.')
      break

    case 'reactivacion':
      lineas.push(`${saludo} ${presentacion}.`)
      lineas.push(
        `Hace un tiempo conversamos sobre ${el ?? 'Mercado Media Luna'}. ¿Le sigue interesando que le cuente, o prefiere que no le escriba más?`,
      )
      break

    case 'respuesta_no_interesa':
      lineas.push(
        `Entendido${nombre === '' ? '' : `, ${nombre}`}, gracias por avisarme. Lo anoto para no molestarle.`,
      )
      lineas.push(
        `Si más adelante busca ${d.tipoInteres === 'tienda' ? 'una tienda' : 'un puesto'} o conoce a alguien que lo necesite, aquí estamos.`,
      )
      break

    case 'confirmar_no_contacto':
      lineas.push(`Listo${nombre === '' ? '' : `, ${nombre}`}: no le volveremos a escribir. Disculpe la molestia.`)
      break
  }
  return lineas.join('\n')
}

/** Los datos de una plantilla a partir de una fila de la cartera y del nombre de quien escribe. */
export function datosDesdeCartera(f: FilaCartera, agente: string | null): DatosPlantilla {
  return {
    nombre: f.nombreCompleto,
    agente,
    campana: f.campanaNombre,
    fechaIngreso: f.fechaIngreso,
    tipoInteres: f.tipoInteres,
  }
}

// ---------------------------------------------------------------------------
// Sugerencia
// ---------------------------------------------------------------------------

/**
 * La escalera de seguimiento tras un primer contacto sin respuesta
 * (analisis/sales.md §3: G1 suave → G2 valor/visita → G3 salida facil → G4
 * cierre). El paso lo da el numero de intentos seguidos sin respuesta; no hay
 * aqui ningun plazo: CUANDO toca cada uno lo decide la cadencia de
 * `parametros` (cadencia_seguimiento_dias) al crear la tarea.
 */
const ESCALERA: readonly IdPlantilla[] = ['seguimiento_1', 'seguimiento_2', 'seguimiento_3', 'cierre_ciclo']

/**
 * Que plantilla proponer para esta oportunidad. Es una SUGERENCIA: el
 * vendedor elige otra si la conversacion va por otro lado.
 *
 *  · En frios o descartada → reactivacion (que tambien pide permiso otra vez).
 *  · Nadie la contacto todavia → primer contacto: 'live' si vino de un live
 *    registrado por el equipo; si no, el generico «por la informacion que nos
 *    pidio» (web, anuncios, referidos).
 *  · Respondio en el ultimo contacto → la de valor: proponer la visita, que es
 *    el siguiente paso una vez hay conversacion (sales.md §3).
 *  · Sin respuesta → la escalera. Si se conoce el umbral de frios
 *    (`frio_intentos_sin_respuesta`, leido de `parametros` por quien llama),
 *    el intento que lo alcanzaria es el «ultimo mensaje por ahora»: asi la
 *    persona recibe el cierre amable antes de pasar a frios, no despues.
 */
export function plantillaSugerida(f: {
  totalContactos: number
  intentosSinRespuesta: number
  situacion: string
  origen: string | null
  entroSolo: boolean
  umbralFrio?: number | null | undefined
}): IdPlantilla {
  if (f.situacion === 'pausada' || f.situacion === 'perdida') return 'reactivacion'

  if (f.totalContactos === 0) {
    return f.origen === 'live' && !f.entroSolo ? 'primer_contacto_live' : 'primer_contacto_web'
  }

  if (f.intentosSinRespuesta <= 0) return 'seguimiento_2'

  const umbral = f.umbralFrio
  if (umbral !== null && umbral !== undefined && umbral > 0 && f.intentosSinRespuesta >= umbral - 1) {
    return 'cierre_ciclo'
  }

  const paso = Math.min(f.intentosSinRespuesta, ESCALERA.length) - 1
  return ESCALERA[paso] ?? 'cierre_ciclo'
}
