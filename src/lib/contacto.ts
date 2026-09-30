import { supabase } from '@/lib/supabase'
import {
  comoRegistro,
  comoTextos,
  llamarRpc,
  mensajeDeError,
  type ResultadoAccion,
} from '@/lib/acciones'
import { etiquetaEstado } from '@/lib/embudo'
import { booleano, entero, leerLote, texto } from '@/lib/lectura'
import {
  etiquetaMotivoDescarte,
  etiquetaSituacion,
  etiquetaTemperatura,
} from '@/lib/cartera'
import { CANALES } from '@/lib/hoy'

/**
 * Registrar un contacto y mover la situacion de una oportunidad.
 *
 * ---------------------------------------------------------------------------
 * POR QUE TODO ESTO ES UNA LLAMADA A LA BASE
 * ---------------------------------------------------------------------------
 * Un contacto no es «insertar una interaccion». Es, en una sola transaccion
 * (`fn_registrar_contacto`, 13-seguimiento-comercial.sql, SPEC §4.5):
 *   1 · la interaccion con su RESULTADO (no contesta, contesto, no le interesa…),
 *   2 · el paso 01 → 02 si la persona respondio (02 = «escribimos Y respondio»,
 *       04-MANUAL-DE-USO.md:28-57), con su motivo en estado_historial (R9),
 *   3 · cerrar la tarea de seguimiento que se acaba de cumplir,
 *   4 · abrir la SIGUIENTE (R6) segun la cadencia de `parametros`, o pasar a
 *       frios al llegar al umbral de intentos sin respuesta, o descartar.
 * Si eso se hiciera con cuatro peticiones desde el navegador, un corte de red
 * entre la 3 y la 4 dejaria una oportunidad activa sin tarea — R6 roto justo
 * en el acto de hacer seguimiento.
 *
 * ---------------------------------------------------------------------------
 * NINGUNA CIFRA DE NEGOCIO VIVE AQUI
 * ---------------------------------------------------------------------------
 * Ni la cadencia (1, 3, 7 dias), ni el umbral de frio, ni los dias de
 * reactivacion: todo eso son parametros 🔵 (SPEC §4.4) que lee la base. Los
 * `atajo` de abajo son teclas del teclado, no cantidades.
 */

// ---------------------------------------------------------------------------
// Resultados y canales
// ---------------------------------------------------------------------------

/**
 * Los resultados que puede registrar el vendedor (`interacciones.resultado`,
 * CHECK de SPEC §4.2). Agrupados como los usa el panel de contacto:
 *   intento   = no hubo respuesta (cuenta para el umbral de frios)
 *   respuesta = hubo conversacion
 *   cierre    = termina el ciclo (frio, descarte, no contactar)
 *   nota      = no es un contacto; no mueve nada
 * `agendo_visita` y `aviso_visita` tambien existen en la columna, pero los
 * escriben las funciones de visitas, no este panel.
 */
export const RESULTADOS_CONTACTO = [
  { valor: 'no_contesta', etiqueta: 'No contesta', grupo: 'intento', atajo: '1' },
  { valor: 'buzon', etiqueta: 'Buzón', grupo: 'intento', atajo: '2' },
  { valor: 'visto_sin_respuesta', etiqueta: 'Visto, sin respuesta', grupo: 'intento', atajo: '3' },
  { valor: 'contesto', etiqueta: 'Contestó', grupo: 'respuesta', atajo: '4' },
  { valor: 'respondio', etiqueta: 'Me escribió', grupo: 'respuesta', atajo: '5' },
  { valor: 'mas_adelante', etiqueta: 'Más adelante', grupo: 'cierre', atajo: '6' },
  { valor: 'no_interesa', etiqueta: 'No le interesa', grupo: 'cierre', atajo: '7' },
  { valor: 'pidio_no_contacto', etiqueta: 'No contactar más', grupo: 'cierre', atajo: '8' },
  { valor: 'numero_equivocado', etiqueta: 'Número equivocado', grupo: 'cierre', atajo: '9' },
  { valor: 'nota', etiqueta: 'Solo una nota', grupo: 'nota', atajo: '0' },
] as const

export type ResultadoContacto = (typeof RESULTADOS_CONTACTO)[number]['valor']
export type GrupoResultado = (typeof RESULTADOS_CONTACTO)[number]['grupo']

const VALORES_RESULTADO: readonly string[] = RESULTADOS_CONTACTO.map((r) => r.valor)

export function esResultadoContacto(v: unknown): v is ResultadoContacto {
  return typeof v === 'string' && VALORES_RESULTADO.includes(v)
}

/** Resultados que escriben otras funciones (visitas) y que la actividad tambien muestra. */
const OTROS_RESULTADOS: Readonly<Record<string, string>> = {
  agendo_visita: 'Agendó visita',
  aviso_visita: 'Aviso de visita',
}

/** Etiqueta de `interacciones.resultado`. Las interacciones antiguas (antes de 13) no tienen resultado. */
export function etiquetaResultado(r: string | null): string {
  if (r === null) return 'Sin resultado registrado'
  return RESULTADOS_CONTACTO.find((x) => x.valor === r)?.etiqueta ?? OTROS_RESULTADOS[r] ?? r
}

/**
 * Canales que ofrece el panel de contacto. Todos existen en el enum
 * `canal_interaccion` (01-schema.sql); 'live' y 'otro' no se ofrecen porque
 * no se «contacta» por un live ni por «otro»: son de registro.
 */
export const CANALES_CONTACTO = [
  { valor: 'whatsapp', etiqueta: 'WhatsApp' },
  { valor: 'llamada', etiqueta: 'Llamada' },
  { valor: 'tiktok', etiqueta: 'TikTok' },
  { valor: 'instagram', etiqueta: 'Instagram' },
  { valor: 'facebook', etiqueta: 'Facebook' },
  { valor: 'presencial', etiqueta: 'En persona' },
  { valor: 'email', etiqueta: 'Correo' },
] as const

export type CanalContacto = (typeof CANALES_CONTACTO)[number]['valor']

function etiquetaCanal(canal: string): string {
  return (
    CANALES_CONTACTO.find((c) => c.valor === canal)?.etiqueta ??
    CANALES.find((c) => c.valor === canal)?.etiqueta ??
    canal
  )
}

// ---------------------------------------------------------------------------
// Registrar un contacto
// ---------------------------------------------------------------------------

export type TareaCreada = { id: string; titulo: string; venceEl: string }

export type RespuestaContacto = {
  interaccionId: string
  estado: string
  situacion: string
  intentosSinRespuesta: number
  pasoAFrios: boolean
  descartada: boolean
  reactivada: boolean
  tarea: TareaCreada | null
  avisos: string[]
}

function interpretarTarea(valor: unknown): TareaCreada | null {
  const t = comoRegistro(valor)
  if (t === null) return null
  const id = texto(t['id'])
  const titulo = texto(t['titulo'])
  const venceEl = texto(t['vence_el'])
  if (id === null || titulo === null || venceEl === null) return null
  return { id, titulo, venceEl }
}

/**
 * `tarea` puede venir `null` a proposito (un descarte no abre tarea). Lo que
 * no puede venir es un objeto a medias: eso es una respuesta ilegible.
 * Devuelve `undefined` para «ilegible», que el lector convierte en fallo.
 */
function tareaDeRespuesta(valor: unknown): TareaCreada | null | undefined {
  if (valor === null || valor === undefined) return null
  return interpretarTarea(valor) ?? undefined
}

/**
 * Lee la respuesta de `fn_registrar_contacto`. Lo que decide la pantalla
 * (estado, situacion, id de la interaccion) es obligatorio. Los indicadores
 * `paso_a_frios` / `descartada` / `reactivada` solo cuentan si llegan en
 * `true`: su ausencia significa «no ocurrio», y la situacion devuelta —que si
 * es obligatoria— es la que manda.
 */
function interpretarRespuestaContacto(respuesta: unknown): RespuestaContacto | null {
  const r = comoRegistro(respuesta)
  if (r === null) return null

  const interaccionId = texto(r['interaccion_id'])
  const estado = texto(r['estado'])
  const situacion = texto(r['situacion'])
  if (interaccionId === null || estado === null || situacion === null) return null

  const tarea = tareaDeRespuesta(r['tarea'])
  if (tarea === undefined) return null

  // Tras una respuesta positiva el contador vuelve a cero; la base puede
  // mandarlo como 0 o no mandarlo. Un valor que no sea numero no se adivina.
  const intentosCrudo = r['intentos_sin_respuesta']
  const intentos = intentosCrudo === null || intentosCrudo === undefined ? 0 : entero(intentosCrudo)
  if (intentos === null) return null

  return {
    interaccionId,
    estado,
    situacion,
    intentosSinRespuesta: intentos,
    pasoAFrios: booleano(r['paso_a_frios']) === true,
    descartada: booleano(r['descartada']) === true,
    reactivada: booleano(r['reactivada']) === true,
    tarea,
    avisos: comoTextos(r['avisos']),
  }
}

/** Cadena recortada, o `null` si queda vacia: un texto en blanco no es un dato. */
function textoONulo(v: string | undefined): string | null {
  const t = v?.trim() ?? ''
  return t === '' ? null : t
}

/**
 * Registra el resultado de un contacto. `proximoEl` (ISO) fija a mano el
 * proximo paso; si no se da, lo calcula la base con la cadencia de
 * `parametros`. `plantilla` = id de la plantilla de WhatsApp usada
 * (plantillas.ts), para la auditoria de cumplimiento (SPEC §4.2).
 */
export async function registrarContacto(d: {
  oportunidadId: string
  resultado: ResultadoContacto
  canal: CanalContacto
  nota?: string | undefined
  proximoEl?: string | null | undefined
  proximoTitulo?: string | undefined
  plantilla?: string | undefined
}): Promise<ResultadoAccion<RespuestaContacto>> {
  const nota = textoONulo(d.nota)
  if (d.resultado === 'nota' && nota === null) {
    return { ok: false, motivo: 'Escribe la nota antes de guardarla.' }
  }

  return llamarRpc(
    'fn_registrar_contacto',
    {
      p_oportunidad_id: d.oportunidadId,
      p_resultado: d.resultado,
      p_canal: d.canal,
      p_nota: nota,
      p_proximo_el: d.proximoEl ?? null,
      p_proximo_titulo: textoONulo(d.proximoTitulo),
      p_plantilla: textoONulo(d.plantilla),
    },
    interpretarRespuestaContacto,
  )
}

// ---------------------------------------------------------------------------
// Situacion: enfriar, descartar, reactivar, no contactar
// ---------------------------------------------------------------------------

export type AccionSituacion = 'enfriar' | 'descartar' | 'reactivar' | 'no_contactar'

export type SituacionCambiada = { situacion: string; tarea: TareaCreada | null; avisos: string[] }

function interpretarSituacion(respuesta: unknown): SituacionCambiada | null {
  const r = comoRegistro(respuesta)
  if (r === null) return null
  const situacion = texto(r['situacion'])
  if (situacion === null) return null
  const tarea = tareaDeRespuesta(r['tarea'])
  if (tarea === undefined) return null
  return { situacion, tarea, avisos: comoTextos(r['avisos']) }
}

/**
 * Cambia la situacion de una oportunidad (`fn_cambiar_situacion`). Las
 * consecuencias las aplica la base: cerrar tareas, cancelar visitas, abrir la
 * tarea de reactivacion, marcar «no contactar» a la persona (SPEC §4.5).
 *
 * Descartar exige motivo (MANUAL:168: una perdida lleva motivo siempre); se
 * comprueba aqui solo para ahorrar el viaje.
 */
export async function cambiarSituacion(d: {
  oportunidadId: string
  accion: AccionSituacion
  motivo?: string | undefined
  nota?: string | undefined
  fecha?: string | null | undefined
}): Promise<ResultadoAccion<SituacionCambiada>> {
  const motivo = textoONulo(d.motivo)
  if (d.accion === 'descartar' && motivo === null) {
    return { ok: false, motivo: 'Elige el motivo del descarte.' }
  }

  return llamarRpc(
    'fn_cambiar_situacion',
    {
      p_oportunidad_id: d.oportunidadId,
      p_accion: d.accion,
      p_motivo: motivo,
      p_nota: textoONulo(d.nota),
      p_fecha: d.fecha ?? null,
    },
    interpretarSituacion,
  )
}

/**
 * Fija (o quita, con `null`) la temperatura a mano. Fijarla exige un motivo:
 * una temperatura puesta a ojo sin decir por que es exactamente el dato sin
 * fuente que 07-crm/CLAUDE.md §3 no deja rellenar.
 */
export async function fijarTemperatura(
  oportunidadId: string,
  temperatura: 'caliente' | 'tibio' | 'frio' | null,
  motivo: string | null,
): Promise<ResultadoAccion<true>> {
  const limpio = motivo?.trim() ?? ''
  if (temperatura !== null && limpio === '') {
    return { ok: false, motivo: 'Escribe por qué fijas la temperatura a mano.' }
  }

  return llamarRpc(
    'fn_fijar_temperatura',
    {
      p_oportunidad_id: oportunidadId,
      p_temperatura: temperatura,
      p_motivo: limpio === '' ? null : limpio,
    },
    (r) => (comoRegistro(r)?.['ok'] === true ? true : null),
  )
}

// ---------------------------------------------------------------------------
// Equipo y responsables
// ---------------------------------------------------------------------------

export type MiembroEquipo = { id: string; nombre: string; rol: string; telefono: string | null }

function interpretarMiembro(fila: unknown): MiembroEquipo | null {
  const f = comoRegistro(fila)
  if (f === null) return null
  const id = texto(f['id'])
  const nombre = texto(f['nombre'])
  const rol = texto(f['rol'])
  if (id === null || nombre === null || rol === null) return null
  return { id, nombre, rol, telefono: texto(f['telefono']) }
}

/**
 * Quien puede llevar una oportunidad: perfiles activos de direccion, comercial
 * o administracion (`fn_equipo`). Lanza error (para useQuery).
 *
 * Es una funcion y no un select a `perfiles` porque RLS no deja a un
 * comercial leer los perfiles de los demas — y para repartir un lote tiene
 * que ver a quien.
 */
export async function cargarEquipo(): Promise<MiembroEquipo[]> {
  const { data, error } = await supabase.rpc('fn_equipo')
  if (error !== null) throw new Error(mensajeDeError(error.message))
  return leerLote(data, interpretarMiembro).filas
}

/**
 * «Tomar» un lead sin dueño (bandeja web). El primero que lo toma se lo queda:
 * la base bloquea la fila y, si otro llego antes, responde «Ya la tomó X».
 */
export async function reclamarOportunidad(
  oportunidadId: string,
): Promise<ResultadoAccion<{ perfilWebAplicado: boolean }>> {
  return llamarRpc('fn_reclamar_oportunidad', { p_oportunidad_id: oportunidadId }, (respuesta) => {
    const r = comoRegistro(respuesta)
    if (r === null || texto(r['responsable_id']) === null) return null
    return { perfilWebAplicado: booleano(r['perfil_web_aplicado']) === true }
  })
}

export type Asignacion = { asignadas: number; omitidas: { id: string; motivo: string }[] }

function interpretarAsignacion(respuesta: unknown): Asignacion | null {
  const r = comoRegistro(respuesta)
  if (r === null) return null
  const asignadas = entero(r['asignadas'])
  if (asignadas === null) return null

  const omitidas: { id: string; motivo: string }[] = []
  const crudas = r['omitidas']
  if (Array.isArray(crudas)) {
    for (const cruda of crudas) {
      const o = comoRegistro(cruda)
      const id = o === null ? null : texto(o['id'])
      if (o === null || id === null) return null
      omitidas.push({ id, motivo: texto(o['motivo']) ?? 'Sin motivo' })
    }
  }
  return { asignadas, omitidas }
}

/**
 * Reasigna varias oportunidades (y sus tareas abiertas). Un comercial solo
 * puede mover las suyas o las sin dueño; las demas vuelven en `omitidas` con
 * su motivo, no se pierden en silencio.
 */
export async function asignarOportunidades(
  ids: readonly string[],
  responsableId: string,
): Promise<ResultadoAccion<Asignacion>> {
  if (ids.length === 0) return { ok: false, motivo: 'No elegiste ninguna oportunidad.' }
  if (responsableId.trim() === '') return { ok: false, motivo: 'Elige a quién se asignan.' }

  return llamarRpc(
    'fn_asignar_oportunidades',
    { p_ids: [...ids], p_responsable_id: responsableId },
    interpretarAsignacion,
  )
}

// ---------------------------------------------------------------------------
// Actividad (linea de tiempo de la ficha)
// ---------------------------------------------------------------------------

export type Interaccion = {
  id: string
  canal: string
  entrante: boolean
  resumen: string
  resultado: string | null
  ocurrioEl: string
  actorId: string | null
}

export type ItemActividad = {
  id: string
  tipo: 'interaccion' | 'estado' | 'evento' | 'tarea' | 'visita'
  ocurrioEl: string
  titulo: string
  detalle: string | null
  icono: 'mensaje' | 'llamada' | 'estado' | 'tarea' | 'visita' | 'evento' | 'nota'
}

function interpretarInteraccion(fila: unknown): Interaccion | null {
  const f = comoRegistro(fila)
  if (f === null) return null
  const id = texto(f['id'])
  const canal = texto(f['canal'])
  const entrante = booleano(f['entrante'])
  const resumen = texto(f['resumen'])
  const ocurrioEl = texto(f['ocurrio_el'])
  if (id === null || canal === null || entrante === null || resumen === null || ocurrioEl === null) {
    return null
  }
  return {
    id,
    canal,
    entrante,
    resumen,
    resultado: texto(f['resultado']),
    ocurrioEl,
    actorId: texto(f['actor_id']),
  }
}

function itemDeInteraccion(i: Interaccion): ItemActividad {
  const partes = [etiquetaCanal(i.canal), i.entrante ? 'recibido' : 'enviado']
  if (i.resultado !== null) partes.push(etiquetaResultado(i.resultado))
  const icono: ItemActividad['icono'] =
    i.resultado === 'nota' ? 'nota' : i.canal === 'llamada' ? 'llamada' : 'mensaje'
  // El resumen por defecto que escribe la base es la propia etiqueta del
  // resultado: repetirla debajo del titulo es ruido.
  const detalle = i.resumen.trim() === '' || i.resumen === etiquetaResultado(i.resultado) ? null : i.resumen
  return {
    id: `interaccion-${i.id}`,
    tipo: 'interaccion',
    ocurrioEl: i.ocurrioEl,
    titulo: partes.join(' · '),
    detalle,
    icono,
  }
}

function itemDeHistorial(fila: unknown): ItemActividad | null {
  const f = comoRegistro(fila)
  if (f === null) return null
  const id = f['id']
  const aEstado = texto(f['a_estado'])
  const ocurrioEl = texto(f['ocurrio_el'])
  if ((typeof id !== 'number' && typeof id !== 'string') || aEstado === null || ocurrioEl === null) {
    return null
  }
  const deEstado = texto(f['de_estado'])
  return {
    id: `estado-${String(id)}`,
    tipo: 'estado',
    ocurrioEl,
    titulo:
      deEstado === null
        ? `Entró al embudo en ${etiquetaEstado(aEstado)}`
        : `${etiquetaEstado(deEstado)} → ${etiquetaEstado(aEstado)}`,
    detalle: texto(f['motivo']),
    icono: 'estado',
  }
}

/** Traduce el `de`/`a` de un evento segun su tipo. Lo desconocido se muestra crudo. */
function valorDeEvento(tipo: string, v: string | null): string {
  if (v === null) {
    if (tipo === 'responsable') return 'sin dueño'
    if (tipo === 'temperatura') return 'automática'
    return '—'
  }
  if (tipo === 'situacion') return etiquetaSituacion(v)
  if (tipo === 'temperatura') return etiquetaTemperatura(v)
  if (tipo === 'motivo_perdida') return etiquetaMotivoDescarte(v)
  return v
}

const TITULO_EVENTO: Readonly<Record<string, string>> = {
  situacion: 'Situación',
  responsable: 'Responsable',
  motivo_perdida: 'Motivo del descarte',
  temperatura: 'Temperatura',
  perfil: 'Perfil actualizado',
  visita: 'Visita',
  documento: 'Documento',
  bandeja: 'Bandeja web',
  contacto: 'Contacto',
}

const TIPOS_SIN_ANTES: readonly string[] = ['visita', 'documento', 'contacto', 'bandeja']

function itemDeEvento(fila: unknown): ItemActividad | null {
  const f = comoRegistro(fila)
  if (f === null) return null
  const id = f['id']
  const tipo = texto(f['tipo'])
  const ocurrioEl = texto(f['ocurrio_el'])
  if ((typeof id !== 'number' && typeof id !== 'string') || tipo === null || ocurrioEl === null) {
    return null
  }
  const de = texto(f['de'])
  const a = texto(f['a'])
  const nombre = TITULO_EVENTO[tipo] ?? tipo

  // Los eventos «de un solo valor» (visita agendada, documento subido…) no
  // tienen un «antes»: se muestran como «Visita: agendada», no «— → agendada».
  const sinAntes = de === null && TIPOS_SIN_ANTES.includes(tipo)
  let titulo: string
  if (tipo === 'perfil') titulo = nombre
  else if (tipo === 'bandeja' && a === 'tomada') titulo = 'Tomada de la bandeja web'
  else if (sinAntes) titulo = `${nombre}: ${valorDeEvento(tipo, a)}`
  else titulo = `${nombre}: ${valorDeEvento(tipo, de)} → ${valorDeEvento(tipo, a)}`

  // En el evento de perfil, `a` es la lista de claves que cambiaron: va al detalle.
  const motivo = texto(f['motivo'])
  const detalle = tipo === 'perfil' ? [a, motivo].filter((x) => x !== null).join(' · ') || null : motivo

  return {
    id: `evento-${String(id)}`,
    tipo: 'evento',
    ocurrioEl,
    titulo,
    detalle,
    icono: tipo === 'visita' ? 'visita' : 'evento',
  }
}

function itemDeTarea(fila: unknown): ItemActividad | null {
  const f = comoRegistro(fila)
  if (f === null) return null
  const id = texto(f['id'])
  const titulo = texto(f['titulo'])
  const venceEl = texto(f['vence_el'])
  if (id === null || titulo === null || venceEl === null) return null
  const completadaEl = texto(f['completada_el'])

  // Hecha: en el momento en que se cerro, con el motivo de cierre.
  // Pendiente: en su vencimiento — si es futuro queda arriba, como «lo que viene».
  if (completadaEl !== null) {
    return {
      id: `tarea-${id}`,
      tipo: 'tarea',
      ocurrioEl: completadaEl,
      titulo: `Hecha: ${titulo}`,
      detalle: texto(f['cierre_motivo']) ?? texto(f['detalle']),
      icono: 'tarea',
    }
  }
  return {
    id: `tarea-${id}`,
    tipo: 'tarea',
    ocurrioEl: venceEl,
    titulo: `Pendiente: ${titulo}`,
    detalle: texto(f['detalle']),
    icono: 'tarea',
  }
}

/**
 * Etiquetas de visita. Son las mismas de TIPOS_VISITA / ESTADOS_VISITA /
 * RESULTADOS_VISITA de src/lib/visitas.ts (SPEC §6.B). No se importan de alli
 * para que la actividad no dependa del modulo de visitas; si alguna cambia,
 * se cambia en los dos sitios.
 */
const ETIQUETA_VISITA: Readonly<Record<string, string>> = {
  obra: 'Visita a la obra',
  videollamada: 'Videollamada',
  oficina: 'En oficina',
  agendada: 'agendada',
  confirmada: 'confirmada',
  realizada: 'realizada',
  no_asistio: 'no asistió',
  reprogramada: 'reprogramada',
  cancelada: 'cancelada',
  interesado: 'Interesado',
  lo_piensa: 'Lo va a pensar',
  no_interesa: 'No le interesa',
  separo: 'Separó',
}

function itemDeVisita(fila: unknown): ItemActividad | null {
  const f = comoRegistro(fila)
  if (f === null) return null
  const id = texto(f['id'])
  const tipo = texto(f['tipo'])
  const estado = texto(f['estado'])
  const inicioEl = texto(f['inicio_el'])
  if (id === null || tipo === null || estado === null || inicioEl === null) return null

  const resultado = texto(f['resultado'])
  const detalle = [
    resultado === null ? null : `Resultado: ${ETIQUETA_VISITA[resultado] ?? resultado}`,
    texto(f['resultado_nota']),
    texto(f['nota']),
  ]
    .filter((x): x is string => x !== null && x.trim() !== '')
    .join(' · ')

  return {
    id: `visita-${id}`,
    tipo: 'visita',
    ocurrioEl: inicioEl,
    titulo: `${ETIQUETA_VISITA[tipo] ?? tipo} · ${ETIQUETA_VISITA[estado] ?? estado}`,
    detalle: detalle === '' ? null : detalle,
    icono: 'visita',
  }
}

/** ¿El error dice que falta una tabla o una columna (migracion 13 sin aplicar)? */
function faltaEnLaBase(mensaje: string): boolean {
  const m = mensaje.toLowerCase()
  return m.includes('does not exist') || m.includes('schema cache') || m.includes('could not find')
}

type Consulta = { data: unknown; error: { message: string } | null }

/**
 * Lee una tabla con las columnas de 13 y, si la base todavia no las tiene,
 * repite con las columnas de siempre. Asi la ficha funciona tambien mientras
 * la migracion no esta aplicada (las pantallas se prueban antes).
 */
async function conRespaldo(
  completa: () => PromiseLike<Consulta>,
  basica: () => PromiseLike<Consulta>,
): Promise<Consulta> {
  const r = await completa()
  if (r.error !== null && faltaEnLaBase(r.error.message)) return basica()
  return r
}

const LIMITE_ACTIVIDAD = 100

function tiempo(iso: string): number {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

/**
 * La linea de tiempo de una oportunidad, de lo mas nuevo a lo mas viejo:
 * interacciones de la PERSONA (todas sus oportunidades: lo que se hablo en el
 * lanzamiento anterior tambien cuenta), cambios de estado (R9), eventos de
 * situacion/responsable/perfil, tareas (pendientes y hechas) y visitas.
 *
 * Tolera que falte una tabla o una columna nueva: devuelve lo que pudo leer y
 * UN aviso al principio diciendo que faltaba y cuantas filas ilegibles se
 * omitieron. Solo lanza error si no pudo leer NADA (para que useQuery ofrezca
 * reintentar en vez de pintar una ficha vacia con cara de «sin actividad»).
 */
export async function cargarActividad(oportunidadId: string, personaId: string): Promise<ItemActividad[]> {
  const [interacciones, historial, eventos, tareas, visitas] = await Promise.all([
    conRespaldo(
      () =>
        supabase
          .from('interacciones')
          .select('id, canal, entrante, resumen, resultado, ocurrio_el, actor_id')
          .eq('persona_id', personaId)
          .order('ocurrio_el', { ascending: false })
          .limit(LIMITE_ACTIVIDAD),
      () =>
        supabase
          .from('interacciones')
          .select('id, canal, entrante, resumen, ocurrio_el, actor_id')
          .eq('persona_id', personaId)
          .order('ocurrio_el', { ascending: false })
          .limit(LIMITE_ACTIVIDAD),
    ),
    supabase
      .from('estado_historial')
      .select('id, de_estado, a_estado, motivo, ocurrio_el')
      .eq('oportunidad_id', oportunidadId)
      .order('ocurrio_el', { ascending: false })
      .limit(LIMITE_ACTIVIDAD),
    supabase
      .from('oportunidad_eventos')
      .select('id, tipo, de, a, motivo, ocurrio_el')
      .eq('oportunidad_id', oportunidadId)
      .order('ocurrio_el', { ascending: false })
      .limit(LIMITE_ACTIVIDAD),
    conRespaldo(
      () =>
        supabase
          .from('tareas')
          .select('id, titulo, detalle, vence_el, completada_el, creado_el, tipo, cierre_motivo')
          .eq('oportunidad_id', oportunidadId)
          .order('creado_el', { ascending: false })
          .limit(LIMITE_ACTIVIDAD),
      () =>
        supabase
          .from('tareas')
          .select('id, titulo, detalle, vence_el, completada_el, creado_el')
          .eq('oportunidad_id', oportunidadId)
          .order('creado_el', { ascending: false })
          .limit(LIMITE_ACTIVIDAD),
    ),
    supabase
      .from('visitas')
      .select('id, tipo, estado, inicio_el, nota, resultado, resultado_nota')
      .eq('oportunidad_id', oportunidadId)
      .is('archivado_el', null)
      .order('inicio_el', { ascending: false })
      .limit(LIMITE_ACTIVIDAD),
  ])

  const fuentes: { nombre: string; consulta: Consulta; leer: (fila: unknown) => ItemActividad | null }[] = [
    {
      nombre: 'contactos',
      consulta: interacciones,
      leer: (fila) => {
        const i = interpretarInteraccion(fila)
        return i === null ? null : itemDeInteraccion(i)
      },
    },
    { nombre: 'cambios de estado', consulta: historial, leer: itemDeHistorial },
    { nombre: 'eventos', consulta: eventos, leer: itemDeEvento },
    { nombre: 'tareas', consulta: tareas, leer: itemDeTarea },
    { nombre: 'visitas', consulta: visitas, leer: itemDeVisita },
  ]

  const items: ItemActividad[] = []
  const fallos: string[] = []
  let descartadas = 0
  for (const fuente of fuentes) {
    if (fuente.consulta.error !== null) {
      const m = fuente.consulta.error.message
      fallos.push(
        faltaEnLaBase(m)
          ? `${fuente.nombre}: la base todavía no los tiene (falta sql/13-seguimiento-comercial.sql)`
          : `${fuente.nombre}: ${mensajeDeError(m)}`,
      )
      continue
    }
    const lote = leerLote(fuente.consulta.data, fuente.leer)
    items.push(...lote.filas)
    descartadas += lote.descartadas
  }

  if (fallos.length === fuentes.length) {
    throw new Error(`No se pudo leer la actividad. ${fallos.join(' · ')}`)
  }

  items.sort((a, b) => tiempo(b.ocurrioEl) - tiempo(a.ocurrioEl))

  if (fallos.length > 0 || descartadas > 0) {
    const detalle = [...fallos]
    if (descartadas > 0) {
      detalle.push(`${descartadas} registro(s) ilegible(s) se omitieron en vez de mostrarse a medias`)
    }
    items.unshift({
      id: 'aviso-actividad',
      tipo: 'evento',
      ocurrioEl: new Date().toISOString(),
      titulo: fallos.length > 0 ? 'Parte de la actividad no se pudo leer' : 'Algunos registros no se pudieron leer',
      detalle: detalle.join(' · '),
      icono: 'nota',
    })
  }

  return items
}
