import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { booleano, entero, leerLote, reventar, texto, type Lote } from '@/lib/lectura'
import {
  comoRegistro,
  comoTextos,
  llamarRpc,
  mensajeDeError,
  type ResultadoAccion,
} from '@/lib/acciones'
import {
  armarIcs,
  diaLima,
  interpretarDatosAviso,
  type AvisoArmado,
  type DatosAviso,
  type PlantillaAviso,
} from '@/lib/aviso-visita'

/**
 * Visitas a la obra, videollamadas y citas en oficina — y el aviso al cliente.
 *
 * ===========================================================================
 * POR QUE LAS VISITAS SON UNA TABLA Y NO UNA TAREA MAS
 * ===========================================================================
 * Hasta el 29/09/2026 una visita era, como mucho, una tarea con el título
 * «Visita». Eso no deja saber si se confirmó, si vino, si se reprogramó ni
 * cuántas veces faltó; y la visita es el paso que más separa a un curioso de un
 * comprador (analisis/sales.md §4). La tabla `visitas` de
 * 13-seguimiento-comercial.sql lo guarda, y las dos funciones que la escriben
 * (`fn_agendar_visita`, `fn_actualizar_visita`) crean y cierran a la vez las
 * tareas de la visita: R6 (toda oportunidad activa con tarea abierta) sale
 * gratis, sin que la pantalla tenga que acordarse.
 *
 * Nada de esto se escribe con `insert`/`update` directo: la tabla no tiene
 * políticas de escritura. Solo las funciones, que comprueban quién puede
 * operar esa oportunidad (`puede_operar_oportunidad`).
 *
 * ===========================================================================
 * EL AVISO, EN DOS VELOCIDADES (decisión del dueño, 29/09/2026 — SPEC §1)
 * ===========================================================================
 *   Hoy, MANUAL: `mailto:` con el texto armado + `.ics` descargable + texto de
 *   WhatsApp. Sin proveedor nuevo, sin secretos, a costo cero.
 *   Después, AUTOMÁTICO: la Edge Function `aviso-visita` con Resend. Está
 *   desplegada inerte hasta que existan RESEND_API_KEY y CORREO_REMITENTE;
 *   `envioAutomaticoConfigurado` pregunta y la pantalla solo ofrece el botón si
 *   la respuesta es sí.
 *
 * El TEXTO de los dos caminos es el mismo archivo, src/lib/aviso-visita.ts
 * (copiado byte a byte en la función). Aquí solo se transporta.
 *
 * Este archivo no contiene ninguna cifra del negocio: la duración del bloque
 * de calendario y la antelación de la confirmación son parámetros 🔵 que lee
 * la base (`visita_duracion_min`, `visita_confirmar_horas_antes`).
 */

// ---------------------------------------------------------------------------
// Catálogos — los CHECK de 13-seguimiento-comercial.sql §4.3
// ---------------------------------------------------------------------------

export const TIPOS_VISITA = [
  { valor: 'obra', etiqueta: 'Visita a la obra' },
  { valor: 'videollamada', etiqueta: 'Videollamada' },
  { valor: 'oficina', etiqueta: 'En oficina' },
] as const

export type TipoVisita = (typeof TIPOS_VISITA)[number]['valor']

export const ESTADOS_VISITA = [
  { valor: 'agendada', etiqueta: 'Agendada' },
  { valor: 'confirmada', etiqueta: 'Confirmada' },
  { valor: 'realizada', etiqueta: 'Realizada' },
  { valor: 'no_asistio', etiqueta: 'No asistió' },
  { valor: 'reprogramada', etiqueta: 'Reprogramada' },
  { valor: 'cancelada', etiqueta: 'Cancelada' },
] as const

export type EstadoVisita = (typeof ESTADOS_VISITA)[number]['valor']

export const RESULTADOS_VISITA = [
  { valor: 'interesado', etiqueta: 'Interesado' },
  { valor: 'lo_piensa', etiqueta: 'Lo va a pensar' },
  { valor: 'no_interesa', etiqueta: 'No le interesa' },
  { valor: 'separo', etiqueta: 'Separó' },
] as const

export type ResultadoVisita = (typeof RESULTADOS_VISITA)[number]['valor']

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export type Visita = {
  id: string
  oportunidadId: string
  personaId: string
  responsableId: string | null
  tipo: string
  inicioEl: string
  duracionMin: number | null
  estado: string
  vieneCodecisor: boolean | null
  nota: string | null
  resultado: string | null
  resultadoNota: string | null
  icsUid: string
  icsSecuencia: number
  confirmadaEl: string | null
  realizadaEl: string | null
  avisoEnviadoEl: string | null
  avisoCanal: string | null
  creadoEl: string
}

export type VisitaProxima = Visita & { nombreCompleto: string; telefonoE164: string | null }

const COLUMNAS_VISITA =
  'id, oportunidad_id, persona_id, responsable_id, tipo, inicio_el, duracion_min, estado, ' +
  'viene_codecisor, nota, resultado, resultado_nota, ics_uid, ics_secuencia, confirmada_el, ' +
  'realizada_el, aviso_enviado_el, aviso_canal, creado_el'

/** Lee una fila cruda de `visitas`. Sin id, oportunidad, persona, inicio o UID, no es una visita. */
export function interpretarVisita(fila: unknown): Visita | null {
  const f = comoRegistro(fila)
  if (f === null) return null

  const id = texto(f['id'])
  const oportunidadId = texto(f['oportunidad_id'])
  const personaId = texto(f['persona_id'])
  const tipo = texto(f['tipo'])
  const inicioEl = texto(f['inicio_el'])
  const estado = texto(f['estado'])
  const icsUid = texto(f['ics_uid'])
  const icsSecuencia = entero(f['ics_secuencia'])
  const creadoEl = texto(f['creado_el'])
  if (
    id === null ||
    oportunidadId === null ||
    personaId === null ||
    tipo === null ||
    inicioEl === null ||
    estado === null ||
    icsUid === null ||
    icsSecuencia === null ||
    creadoEl === null
  ) {
    return null
  }

  return {
    id,
    oportunidadId,
    personaId,
    responsableId: texto(f['responsable_id']),
    tipo,
    inicioEl,
    duracionMin: entero(f['duracion_min']),
    estado,
    vieneCodecisor: booleano(f['viene_codecisor']),
    nota: texto(f['nota']),
    resultado: texto(f['resultado']),
    resultadoNota: texto(f['resultado_nota']),
    icsUid,
    icsSecuencia,
    confirmadaEl: texto(f['confirmada_el']),
    realizadaEl: texto(f['realizada_el']),
    avisoEnviadoEl: texto(f['aviso_enviado_el']),
    avisoCanal: texto(f['aviso_canal']),
    creadoEl,
  }
}

function interpretarVisitaProxima(fila: unknown): VisitaProxima | null {
  const visita = interpretarVisita(fila)
  if (visita === null) return null

  // PostgREST devuelve la relación muchos-a-uno como objeto (o null si RLS la
  // esconde). Sin nombre no se pinta: una visita de «alguien» en la pantalla
  // Hoy no le sirve a nadie, y la fila se CUENTA como descartada.
  const persona = comoRegistro(comoRegistro(fila)?.['personas'])
  const nombreCompleto = persona === null ? null : texto(persona['nombre_completo'])
  if (nombreCompleto === null) return null

  return { ...visita, nombreCompleto, telefonoE164: texto(persona?.['telefono_e164']) }
}

/**
 * Las visitas de una oportunidad, la más reciente primero (por fecha de la
 * visita; a igual hora, la creada después). Las archivadas no salen (R8: no se
 * borran, se archivan). Lanza si falla, para `useQuery`.
 */
export async function cargarVisitas(oportunidadId: string): Promise<Visita[]> {
  const { data, error } = await supabase
    .from('visitas')
    .select(COLUMNAS_VISITA)
    .eq('oportunidad_id', oportunidadId)
    .is('archivado_el', null)
    .order('inicio_el', { ascending: false })
    .order('creado_el', { ascending: false })

  reventar('No se pudieron leer las visitas', error)
  return leerLote(data, interpretarVisita).filas
}

/** Tope de la lista de próximas visitas. Es un límite de pantalla, no una cifra del negocio. */
const LIMITE_PROXIMAS = 100

/**
 * Visitas abiertas (agendada / confirmada) entre `desde` y `hasta`, la más
 * próxima primero, con el nombre y el teléfono de la persona. Para el bloque
 * «Visitas de hoy y mañana» de la pantalla Hoy.
 *
 * No se filtra por responsable: lo que cada rol ve lo decide la política de
 * RLS de `visitas` (ve la visita quien ve la oportunidad). Si la lista llega
 * justo al tope, la pantalla debe avisar de que puede haber más.
 */
export async function cargarVisitasProximas(desde: Date, hasta: Date): Promise<Lote<VisitaProxima>> {
  const { data, error } = await supabase
    .from('visitas')
    .select(`${COLUMNAS_VISITA}, personas(nombre_completo, telefono_e164)`)
    .in('estado', ['agendada', 'confirmada'])
    .is('archivado_el', null)
    .gte('inicio_el', desde.toISOString())
    .lte('inicio_el', hasta.toISOString())
    .order('inicio_el', { ascending: true })
    .limit(LIMITE_PROXIMAS)

  reventar('No se pudieron leer las próximas visitas', error)
  return leerLote(data, interpretarVisitaProxima)
}

// ---------------------------------------------------------------------------
// Escritura — solo por funciones de la base
// ---------------------------------------------------------------------------

/**
 * Agenda (o reprograma) una visita.
 *
 * Para REPROGRAMAR se pasa `reprogramaId`: la base marca la visita anterior
 * como `reprogramada`, cierra sus tareas y crea la nueva con el MISMO
 * `ics_uid` y la secuencia + 1 — así el `.ics` que se reenvíe mueve el evento
 * en el calendario del cliente en vez de duplicarlo. Sin `reprogramaId`, si ya
 * hay una visita abierta la base la rechaza (índice
 * `visitas_una_abierta_por_oportunidad`).
 *
 * La fecha futura se comprueba aquí para no gastar un viaje a la red, pero
 * quien lo impide es la función (`inicio must be > now()`).
 */
export async function agendarVisita(d: {
  oportunidadId: string
  tipo: TipoVisita
  inicioEl: string
  nota?: string | undefined
  vieneCodecisor?: boolean | null | undefined
  reprogramaId?: string | null | undefined
  canal?: string | undefined
}): Promise<ResultadoAccion<{ visitaId: string; inicioEl: string; avisos: string[] }>> {
  const inicio = new Date(d.inicioEl)
  if (Number.isNaN(inicio.getTime())) {
    return { ok: false, motivo: 'La fecha y hora de la visita no son válidas.' }
  }
  if (inicio.getTime() <= Date.now()) {
    return { ok: false, motivo: 'La visita tiene que ser en el futuro. Revisa el día y la hora.' }
  }

  const argumentos: Record<string, unknown> = {
    p_oportunidad_id: d.oportunidadId,
    p_tipo: d.tipo,
    p_inicio_el: inicio.toISOString(),
    p_nota: limpioONulo(d.nota),
    p_viene_codecisor: d.vieneCodecisor ?? null,
    p_reprograma_id: d.reprogramaId ?? null,
  }
  // Sin canal, que decida el `default` de la función ('whatsapp'): no se
  // repite aquí un valor por defecto que ya vive en la base.
  if (d.canal !== undefined) argumentos['p_canal'] = d.canal

  return llamarRpc('fn_agendar_visita', argumentos, (respuesta) => {
    const r = comoRegistro(respuesta)
    if (r === null) return null
    const visitaId = texto(r['visita_id'])
    const inicioEl = texto(r['inicio_el'])
    if (visitaId === null || inicioEl === null) return null
    return { visitaId, inicioEl, avisos: comoTextos(r['avisos']) }
  })
}

export type AccionVisita = 'confirmar' | 'realizada' | 'no_asistio' | 'cancelar'

/**
 * Confirma, cierra como realizada, marca «no asistió» o cancela una visita.
 * Cada acción deja su interacción, su evento (R9) y la siguiente tarea (R6) —
 * todo lo hace `fn_actualizar_visita`.
 *
 * 'realizada' exige resultado: una visita realizada sin saber cómo salió es
 * exactamente el dato que después no se puede reconstruir.
 */
export async function actualizarVisita(d: {
  visitaId: string
  accion: AccionVisita
  resultado?: ResultadoVisita | undefined
  nota?: string | undefined
  proximoEl?: string | null | undefined
}): Promise<ResultadoAccion<{ estado: string; noAsistioTotal: number; avisos: string[] }>> {
  if (d.accion === 'realizada' && d.resultado === undefined) {
    return { ok: false, motivo: 'Elige cómo salió la visita antes de marcarla como realizada.' }
  }

  return llamarRpc(
    'fn_actualizar_visita',
    {
      p_visita_id: d.visitaId,
      p_accion: d.accion,
      p_resultado: d.resultado ?? null,
      p_nota: limpioONulo(d.nota),
      p_proximo_el: d.proximoEl ?? null,
    },
    (respuesta) => {
      const r = comoRegistro(respuesta)
      if (r === null) return null
      const estado = texto(r['estado'])
      if (estado === null) return null
      return {
        estado,
        noAsistioTotal: entero(r['no_asistio_total']) ?? 0,
        avisos: comoTextos(r['avisos']),
      }
    },
  )
}

/**
 * Lo necesario para armar el aviso (visita, persona, agente, empresa y lugar).
 * Los datos de empresa y lugar llegan ya filtrados por la base: solo lo que
 * está en 🟢 verde (`parametro_publico`). Lo demás llega `null`.
 */
export async function cargarDatosAviso(visitaId: string): Promise<ResultadoAccion<DatosAviso>> {
  return llamarRpc('fn_datos_aviso_visita', { p_visita_id: visitaId }, interpretarDatosAviso)
}

/**
 * Deja constancia de un aviso: tabla `notificaciones`, `visitas.aviso_*` y una
 * interacción (R9 y la parte 1 del reporte de 7 partes).
 *
 * En el envío MANUAL el estado es 'preparada', no 'enviada', y es a propósito:
 * abrir el correo o WhatsApp con el texto listo no prueba que se haya enviado
 * — lo manda la persona, y el CRM no lo ve. Contarlo como enviado inflaría la
 * actividad con avisos que quizá nunca salieron.
 */
export async function registrarAviso(d: {
  visitaId: string
  canal: 'email' | 'whatsapp' | 'ics'
  modo: 'manual' | 'automatico'
  plantilla: PlantillaAviso
  destinatario: string | null
  estado?: 'preparada' | 'enviada' | 'error' | undefined
}): Promise<ResultadoAccion<string>> {
  return llamarRpc(
    'fn_registrar_aviso_visita',
    {
      p_visita_id: d.visitaId,
      p_canal: d.canal,
      p_modo: d.modo,
      p_plantilla: d.plantilla,
      p_destinatario: d.destinatario,
      p_estado: d.estado ?? 'preparada',
    },
    (respuesta) => texto(comoRegistro(respuesta)?.['notificacion_id']),
  )
}

// ---------------------------------------------------------------------------
// Envío manual — mailto y .ics
// ---------------------------------------------------------------------------

/**
 * Enlace `mailto:` con asunto y cuerpo ya escritos (RFC 6068), o `null`.
 *
 * `null` también cuando la persona pidió no ser contactada o no dio su
 * consentimiento, aunque tenga correo: la pantalla ya no ofrece el botón en
 * esos casos, pero un enlace que no se puede construir es una segunda
 * barrera que no depende de que la pantalla se acuerde (Ley 29733).
 *
 * El cuerpo lleva CRLF porque es lo que pide RFC 6068 para los saltos de
 * línea; con `\n` suelto algunos clientes de escritorio juntan las líneas.
 * El `@` no se codifica: algunos clientes no lo decodifican en la dirección.
 */
export function enlaceCorreo(d: DatosAviso, aviso: AvisoArmado): string | null {
  const correo = d.persona.email
  if (correo === null) return null
  if (d.persona.noContactar || !d.persona.consentimiento) return null

  const destino = encodeURIComponent(correo).replace(/%40/g, '@')
  const asunto = encodeURIComponent(aviso.asunto)
  const cuerpo = encodeURIComponent(aviso.texto.replace(/\r?\n/g, '\r\n'))
  return `mailto:${destino}?subject=${asunto}&body=${cuerpo}`
}

/** Cuánto se conserva el Blob del `.ics` tras el clic. Técnico, no del negocio. */
const MS_ANTES_DE_LIBERAR_ICS = 60_000

/**
 * Descarga la invitación `.ics` (REQUEST para agendar o reprogramar, CANCEL
 * para cancelar). El nombre del archivo lleva solo el día de la visita en
 * Lima: nada de nombres ni teléfonos en un nombre de archivo, que viaja por
 * WhatsApp y queda en la carpeta de descargas de cualquiera.
 *
 * Se llama desde un clic (los navegadores bloquean descargas sin gesto).
 */
export function descargarIcs(d: DatosAviso, metodo: 'REQUEST' | 'CANCEL'): void {
  const contenido = armarIcs(d, metodo)
  const blob = new Blob([contenido], {
    type: `text/calendar;charset=utf-8;method=${metodo}`,
  })
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = `visita-${diaLima(d.visita.inicioEl) ?? 'sin-fecha'}.ics`
  enlace.rel = 'noopener'
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  // Revocar enseguida cancela la descarga en algunos navegadores (Safari de
  // iOS abre la hoja de «Añadir al calendario» con retraso). Se libera después.
  window.setTimeout(() => URL.revokeObjectURL(url), MS_ANTES_DE_LIBERAR_ICS)
}

// ---------------------------------------------------------------------------
// Envío automático — Edge Function `aviso-visita`
// ---------------------------------------------------------------------------

const FUNCION_AVISO = 'aviso-visita'

/**
 * ¿Está activo el envío automático? Pregunta a la función (`accion:'estado'`),
 * que responde si existen RESEND_API_KEY y CORREO_REMITENTE en los secretos.
 *
 * CUALQUIER error cuenta como «no»: función sin desplegar, sin red, respuesta
 * rara. Es la respuesta segura — el vendedor sigue teniendo el envío manual,
 * y un botón «Enviar automático» que falla siempre es peor que no tenerlo.
 */
export async function envioAutomaticoConfigurado(): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke(FUNCION_AVISO, {
      body: { accion: 'estado' },
    })
    if (error !== null) return false
    const r = comoRegistro(data)
    return r !== null && r['ok'] === true && r['configurado'] === true
  } catch {
    return false
  }
}

/**
 * Pide a la función que envíe el correo (con el `.ics` adjunto) y lo registre.
 * Devuelve el id del proveedor. La función corre con el JWT del usuario —
 * nunca con `service_role` (07-crm/CLAUDE.md §5) — así que RLS y
 * `puede_operar_oportunidad` aplican igual que en el envío manual.
 *
 * Los rechazos esperables («sin configurar», «sin consentimiento») llegan como
 * `{ ok:false, motivo }` con HTTP 200 y se muestran tal cual.
 */
export async function enviarAvisoAutomatico(
  visitaId: string,
  plantilla: PlantillaAviso,
): Promise<ResultadoAccion<string>> {
  try {
    const { data, error } = await supabase.functions.invoke(FUNCION_AVISO, {
      body: { accion: 'enviar', visita_id: visitaId, plantilla },
    })
    // `error` viene tipado como `any` desde functions-js: se trata como
    // desconocido y se lee con cuidado.
    const fallo: unknown = error
    if (fallo !== null) return { ok: false, motivo: await motivoDeFuncion(fallo) }

    const r = comoRegistro(data)
    if (r === null) return { ok: false, motivo: 'La función de aviso respondió algo ilegible.' }
    if (r['ok'] !== true) {
      return { ok: false, motivo: texto(r['motivo']) ?? 'La función de aviso no envió el correo.' }
    }
    const id = texto(r['id'])
    if (id === null) {
      return { ok: false, motivo: 'La función dijo que envió, pero no devolvió el id del envío.' }
    }
    return { ok: true, datos: id }
  } catch (e) {
    return { ok: false, motivo: mensajeDeError(e instanceof Error ? e.message : String(e)) }
  }
}

/** El motivo legible de un fallo de la función. Si trae `{ motivo }` en el cuerpo, ese gana. */
async function motivoDeFuncion(fallo: unknown): Promise<string> {
  if (fallo instanceof FunctionsHttpError) {
    const respuesta: unknown = fallo.context
    if (respuesta instanceof Response) {
      try {
        const cuerpo = comoRegistro(await respuesta.json())
        const motivo = cuerpo === null ? null : texto(cuerpo['motivo'])
        if (motivo !== null) return motivo
      } catch {
        // cuerpo que no es JSON: se sigue con el mensaje genérico
      }
    }
    return 'La función de aviso devolvió un error. El envío manual sigue disponible.'
  }
  if (fallo instanceof Error) {
    if (/relay|fetch|failed to send/i.test(fallo.message)) {
      return (
        'No se pudo llegar a la función de aviso (¿está desplegada?). ' +
        'Usa el envío manual: correo, .ics o WhatsApp.'
      )
    }
    return mensajeDeError(fallo.message)
  }
  return 'La función de aviso falló sin decir por qué. El envío manual sigue disponible.'
}

// ---------------------------------------------------------------------------

/** Cadena recortada, o `null` si queda vacía. Un campo en blanco es «no hay dato». */
function limpioONulo(valor: string | undefined): string | null {
  if (valor === undefined) return null
  const limpio = valor.trim()
  return limpio === '' ? null : limpio
}
