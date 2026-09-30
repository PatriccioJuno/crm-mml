import { supabase } from '@/lib/supabase'
import { mensajeDeError } from '@/lib/acciones'
import { booleano, entero, leerLote, texto, type Lote } from '@/lib/lectura'

/**
 * La cartera: todas las oportunidades con su persona, su perfil, su proximo
 * paso, su visita y su TEMPERATURA, leidas de `v_cartera`
 * (13-seguimiento-comercial.sql, SPEC §4.6).
 *
 * ---------------------------------------------------------------------------
 * QUIEN CALCULA QUE
 * ---------------------------------------------------------------------------
 * La temperatura la calcula la BASE (`fn_temperatura`, una vez por fila, con
 * los umbrales leidos de `parametros` en una sola CTE). Este archivo no la
 * recalcula ni la «corrige»: si los umbrales no estan cargados, la vista dice
 * 'sin_clasificar' y la pantalla lo dice igual. Recalcularla aqui seria tener
 * dos criterios de «caliente» esperando a divergir — y el segundo sin fuente.
 *
 * La temperatura y los «frios» son una dimension APARTE del embudo: los 10
 * estados son cerrados (01-comercial/embudo-y-metricas.md §1; MANUAL:26 «No se
 * inventan estados nuevos»). Frio = `situacion 'pausada'` + `motivo_frio`;
 * descartado = `situacion 'perdida'` + `motivo_perdida_codigo` (SPEC §3).
 *
 * ---------------------------------------------------------------------------
 * NINGUNA CIFRA DE NEGOCIO VIVE AQUI
 * ---------------------------------------------------------------------------
 * Los unicos numeros son el orden de las temperaturas (para ordenar la lista,
 * no para clasificar a nadie) y el tope de filas por consulta, que es un
 * limite tecnico con aviso en pantalla, igual que LIMITE_TARJETAS en embudo.ts.
 */

// ---------------------------------------------------------------------------
// Temperaturas
// ---------------------------------------------------------------------------

/**
 * Los 8 valores que puede devolver `fn_temperatura` (SPEC §4.5). Las tres
 * primeras salen del puntaje; las demas son estados que ganan al puntaje
 * (no contactar, descartado, cliente, en frios, fijada a mano, sin contactar).
 */
export const TEMPERATURAS = [
  { valor: 'caliente', etiqueta: 'Caliente' },
  { valor: 'tibio', etiqueta: 'Tibio' },
  { valor: 'frio', etiqueta: 'Frío' },
  { valor: 'nuevo', etiqueta: 'Nuevo' },
  { valor: 'no_contactar', etiqueta: 'No contactar' },
  { valor: 'descartado', etiqueta: 'Descartado' },
  { valor: 'cliente', etiqueta: 'Cliente' },
  { valor: 'sin_clasificar', etiqueta: 'Sin clasificar' },
] as const

export type Temperatura = (typeof TEMPERATURAS)[number]['valor']

const VALORES_TEMPERATURA: readonly string[] = TEMPERATURAS.map((t) => t.valor)

export function esTemperatura(v: unknown): v is Temperatura {
  return typeof v === 'string' && VALORES_TEMPERATURA.includes(v)
}

/** Una temperatura que este cliente no conoce se muestra cruda: asi se ve que la base cambio. */
export function etiquetaTemperatura(t: string): string {
  return TEMPERATURAS.find((x) => x.valor === t)?.etiqueta ?? t
}

/**
 * Orden de trabajo, no de «importancia»: primero a quien hay que atender ya
 * (caliente), luego a quien nadie ha contactado todavia (nuevo — speed to lead,
 * analisis/sales.md §3), luego tibios y frios. Lo que no se trabaja hoy
 * (cliente, descartado, no contactar) va al final. Fuente del orden: SPEC §6.A.
 */
const RANGO_TEMPERATURA: Readonly<Record<Temperatura, number>> = {
  caliente: 0,
  nuevo: 1,
  tibio: 2,
  frio: 3,
  sin_clasificar: 4,
  cliente: 5,
  descartado: 6,
  no_contactar: 7,
}

export function rangoTemperatura(t: Temperatura): number {
  return RANGO_TEMPERATURA[t]
}

// ---------------------------------------------------------------------------
// Motivos de frio y de descarte
// ---------------------------------------------------------------------------

/**
 * `oportunidades.motivo_frio` (CHECK `oportunidades_motivo_frio_valido`,
 * SPEC §4.2). Las causas siguen las de re-engagement-sequencing
 * (analisis/sales.md §2): no responde, pidio mas adelante, no asistio.
 */
export const MOTIVOS_FRIO = [
  { valor: 'no_responde', etiqueta: 'No responde' },
  { valor: 'mas_adelante', etiqueta: 'Más adelante' },
  { valor: 'sin_capital_ahora', etiqueta: 'Sin capital por ahora' },
  { valor: 'no_asistio', etiqueta: 'No asistió a la visita' },
  { valor: 'otro', etiqueta: 'Otro' },
] as const

export type MotivoFrio = (typeof MOTIVOS_FRIO)[number]['valor']

/**
 * `oportunidades.motivo_perdida_codigo` (CHECK
 * `oportunidades_motivo_perdida_codigo_valido`, SPEC §4.2). Una oportunidad
 * perdida lleva SIEMPRE motivo (MANUAL:168); el texto libre va aparte, en
 * `motivo_perdida`.
 */
export const MOTIVOS_DESCARTE = [
  { valor: 'no_interesa', etiqueta: 'No le interesa' },
  { valor: 'numero_invalido', etiqueta: 'Número inválido' },
  { valor: 'pidio_no_contacto', etiqueta: 'Pidió no ser contactado' },
  { valor: 'sin_capital', etiqueta: 'Sin capital' },
  { valor: 'compro_otro', etiqueta: 'Compró en otro lado' },
  { valor: 'no_encaja', etiqueta: 'No encaja (busca otra cosa)' },
  { valor: 'duplicado', etiqueta: 'Duplicado' },
  { valor: 'spam', etiqueta: 'Spam / falso' },
  { valor: 'no_reconoce', etiqueta: 'No reconoce el registro' },
  { valor: 'otro', etiqueta: 'Otro' },
] as const

export type MotivoDescarte = (typeof MOTIVOS_DESCARTE)[number]['valor']

export function etiquetaMotivoFrio(v: string | null): string {
  if (v === null) return 'Sin motivo'
  return MOTIVOS_FRIO.find((m) => m.valor === v)?.etiqueta ?? v
}

export function etiquetaMotivoDescarte(v: string | null): string {
  if (v === null) return 'Sin motivo'
  return MOTIVOS_DESCARTE.find((m) => m.valor === v)?.etiqueta ?? v
}

/**
 * `estado_oportunidad` (01-schema.sql, seccion 0). Las etiquetas dicen lo que
 * significa cada situacion en ESTE flujo (SPEC §3): pausada = en frios,
 * perdida = descartada. No es un enum nuevo: son los cuatro de siempre.
 */
export const SITUACIONES = [
  { valor: 'activa', etiqueta: 'Activa' },
  { valor: 'pausada', etiqueta: 'En fríos' },
  { valor: 'perdida', etiqueta: 'Descartada' },
  { valor: 'ganada', etiqueta: 'Ganada' },
] as const

export function etiquetaSituacion(v: string | null): string {
  if (v === null) return 'Sin situación'
  return SITUACIONES.find((s) => s.valor === v)?.etiqueta ?? v
}

// ---------------------------------------------------------------------------
// La fila
// ---------------------------------------------------------------------------

export type FilaCartera = {
  /** Id de la OPORTUNIDAD. */
  id: string
  personaId: string
  nombreCompleto: string
  telefonoE164: string | null
  usuarioRed: string | null
  redSocial: string | null
  email: string | null
  origen: string | null
  campanaId: string | null
  campanaNombre: string | null
  lanzamiento: string | null
  estado: string
  situacion: string
  responsableId: string | null
  /**
   * `null` puede ser «sin responsable» o «RLS no deja leer ese perfil»; se
   * distinguen por `responsableId` (mismo caso que Tarjeta en embudo.ts).
   */
  responsableNombre: string | null
  sinDueno: boolean
  /** La persona entro sola (web): `personas.creado_por` es nulo. */
  entroSolo: boolean
  fechaIngreso: string
  fechaPrimerContacto: string | null
  fechaUltimoContacto: string | null
  diasSinContacto: number | null
  motivoFrio: string | null
  enfriadoEl: string | null
  motivoPerdidaCodigo: string | null
  motivoPerdida: string | null
  noContactar: boolean
  cualificacionCompleta: boolean
  faltanCualificacion: number
  tieneTareaAbierta: boolean
  /**
   * Perfil comercial. Llega `null` tambien cuando el rol no puede leer
   * `oportunidad_perfil` (lectura, contabilidad: el capital es dato sensible,
   * SPEC §4.3). `null` aqui es «no se», nunca «no».
   */
  tipoInteres: string | null
  interesDetalle: string | null
  proposito: string | null
  formaPago: string | null
  capitalCategoria: string | null
  horizonteCompra: string | null
  mesObjetivo: string | null
  intentosSinRespuesta: number
  ultimoInboundEl: string | null
  totalContactos: number
  proximaTareaId: string | null
  proximaTareaTitulo: string | null
  proximaTareaTipo: string | null
  proximaTareaVenceEl: string | null
  visitaId: string | null
  visitaTipo: string | null
  visitaEstado: string | null
  visitaInicioEl: string | null
  noAsistioTotal: number
  temperatura: Temperatura
  temperaturaMotivo: string | null
  /** Hay una temperatura fijada a mano vigente (gana al puntaje). */
  temperaturaManual: boolean
  puntaje: number | null
  creadoEl: string
}

/**
 * Las columnas de `v_cartera`, en el MISMO orden que la vista (SPEC §4.6).
 * Declarada como `string` a proposito: asi supabase-js no intenta deducir un
 * tipo del texto del select (no hay tipos generados, src/lib/tipos.ts vacio).
 */
export const COLUMNAS_CARTERA: string =
  'id, persona_id, nombre_completo, telefono_e164, usuario_red, red_social, email, origen, ' +
  'campana_id, campana_nombre, lanzamiento, estado, situacion, responsable_id, ' +
  'responsable_nombre, sin_dueno, entro_solo, fecha_ingreso, fecha_primer_contacto, ' +
  'fecha_ultimo_contacto, dias_sin_contacto, motivo_frio, enfriado_el, ' +
  'motivo_perdida_codigo, motivo_perdida, no_contactar, cualificacion_completa, ' +
  'faltan_cualificacion, tiene_tarea_abierta, tipo_interes, interes_detalle, proposito, ' +
  'forma_pago, capital_categoria, horizonte_compra, mes_objetivo, intentos_sin_respuesta, ' +
  'ultimo_inbound_el, total_contactos, proxima_tarea_id, proxima_tarea_titulo, ' +
  'proxima_tarea_tipo, proxima_tarea_vence_el, visita_id, visita_tipo, visita_estado, ' +
  'visita_inicio_el, no_asistio_total, temperatura, temperatura_motivo, temperatura_manual, ' +
  'puntaje, creado_el'

/**
 * Un CONTEO: numero finito ≥ 0. `null` en la columna se lee como 0 porque un
 * conteo de nada es cero (la vista los arma con subconsultas que pueden no
 * encontrar filas). Cualquier otra cosa —texto, negativo— es ilegible y hace
 * que la fila se descarte y se cuente, no que se adivine.
 */
function conteo(valor: unknown): number | null {
  if (valor === null || valor === undefined) return 0
  const n = entero(valor)
  return n !== null && n >= 0 ? n : null
}

/**
 * Lee una fila de `v_cartera`. Devuelve `null` (fila descartada y contada) si
 * falta cualquier dato que la pantalla necesita para no mentir: ids, nombre,
 * estado, situacion, fechas base, los booleanos y los conteos.
 *
 * La unica tolerancia es la temperatura: un valor que este cliente no conoce
 * se pinta como 'sin_clasificar' («no se»), no se descarta la fila. Descartarla
 * haria DESAPARECER al lead de la lista, que es peor que decir que no se sabe
 * clasificarlo.
 */
export function interpretarFilaCartera(fila: unknown): FilaCartera | null {
  if (typeof fila !== 'object' || fila === null) return null
  const f = fila as Record<string, unknown>

  const id = texto(f['id'])
  const personaId = texto(f['persona_id'])
  const nombreCompleto = texto(f['nombre_completo'])
  const estado = texto(f['estado'])
  const situacion = texto(f['situacion'])
  const fechaIngreso = texto(f['fecha_ingreso'])
  const creadoEl = texto(f['creado_el'])
  if (
    id === null ||
    personaId === null ||
    nombreCompleto === null ||
    estado === null ||
    situacion === null ||
    fechaIngreso === null ||
    creadoEl === null
  ) {
    return null
  }

  const responsableId = texto(f['responsable_id'])
  // `sin_dueno` ES `responsable_id is null` (SPEC §4.6): si la columna no
  // llega se usa su propia definicion, que no es adivinar.
  const sinDueno = booleano(f['sin_dueno']) ?? responsableId === null

  const entroSolo = booleano(f['entro_solo'])
  const noContactar = booleano(f['no_contactar'])
  const cualificacionCompleta = booleano(f['cualificacion_completa'])
  const tieneTareaAbierta = booleano(f['tiene_tarea_abierta'])
  const temperaturaManual = booleano(f['temperatura_manual'])
  if (
    entroSolo === null ||
    noContactar === null ||
    cualificacionCompleta === null ||
    tieneTareaAbierta === null ||
    temperaturaManual === null
  ) {
    return null
  }

  const faltanCualificacion = conteo(f['faltan_cualificacion'])
  const intentosSinRespuesta = conteo(f['intentos_sin_respuesta'])
  const totalContactos = conteo(f['total_contactos'])
  const noAsistioTotal = conteo(f['no_asistio_total'])
  if (
    faltanCualificacion === null ||
    intentosSinRespuesta === null ||
    totalContactos === null ||
    noAsistioTotal === null
  ) {
    return null
  }

  const temperaturaCruda = f['temperatura']

  return {
    id,
    personaId,
    nombreCompleto,
    telefonoE164: texto(f['telefono_e164']),
    usuarioRed: texto(f['usuario_red']),
    redSocial: texto(f['red_social']),
    email: texto(f['email']),
    origen: texto(f['origen']),
    campanaId: texto(f['campana_id']),
    campanaNombre: texto(f['campana_nombre']),
    lanzamiento: texto(f['lanzamiento']),
    estado,
    situacion,
    responsableId,
    responsableNombre: texto(f['responsable_nombre']),
    sinDueno,
    entroSolo,
    fechaIngreso,
    fechaPrimerContacto: texto(f['fecha_primer_contacto']),
    fechaUltimoContacto: texto(f['fecha_ultimo_contacto']),
    diasSinContacto: entero(f['dias_sin_contacto']),
    motivoFrio: texto(f['motivo_frio']),
    enfriadoEl: texto(f['enfriado_el']),
    motivoPerdidaCodigo: texto(f['motivo_perdida_codigo']),
    motivoPerdida: texto(f['motivo_perdida']),
    noContactar,
    cualificacionCompleta,
    faltanCualificacion,
    tieneTareaAbierta,
    tipoInteres: texto(f['tipo_interes']),
    interesDetalle: texto(f['interes_detalle']),
    proposito: texto(f['proposito']),
    formaPago: texto(f['forma_pago']),
    capitalCategoria: texto(f['capital_categoria']),
    horizonteCompra: texto(f['horizonte_compra']),
    mesObjetivo: texto(f['mes_objetivo']),
    intentosSinRespuesta,
    ultimoInboundEl: texto(f['ultimo_inbound_el']),
    totalContactos,
    proximaTareaId: texto(f['proxima_tarea_id']),
    proximaTareaTitulo: texto(f['proxima_tarea_titulo']),
    proximaTareaTipo: texto(f['proxima_tarea_tipo']),
    proximaTareaVenceEl: texto(f['proxima_tarea_vence_el']),
    visitaId: texto(f['visita_id']),
    visitaTipo: texto(f['visita_tipo']),
    visitaEstado: texto(f['visita_estado']),
    visitaInicioEl: texto(f['visita_inicio_el']),
    noAsistioTotal,
    temperatura: esTemperatura(temperaturaCruda) ? temperaturaCruda : 'sin_clasificar',
    temperaturaMotivo: texto(f['temperatura_motivo']),
    temperaturaManual,
    puntaje: entero(f['puntaje']),
    creadoEl,
  }
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export type VistaCartera = 'activos' | 'frios' | 'descartados' | 'todos'

export type FiltroCartera = {
  vista: VistaCartera
  /** 'mios' exige `yo`. Sin `responsable` = todas las que el rol puede ver (RLS). */
  responsable?: 'mios' | 'sin_dueno' | 'todos' | undefined
  /** Id del usuario actual (perfiles.id = auth.uid()). */
  yo?: string | undefined
  /** `undefined` = cualquier campaña; `null` = sin campaña; texto = esa campaña. */
  campanaId?: string | null | undefined
  busqueda?: string | undefined
  limite?: number | undefined
}

/**
 * Tope de filas por consulta. Limite tecnico, no de negocio: la pantalla DICE
 * cuando llega justo este numero («Mostrando 500 de más»), en vez de enseñar
 * una lista incompleta con cara de completa. Mismo criterio que
 * LIMITE_TARJETAS (embudo.ts).
 */
export const LIMITE_CARTERA = 500

/**
 * Lo que la busqueda del usuario le dice a la consulta.
 *
 *  · '@rosita'            → usuario_red contiene 'rosita'
 *  · '987 654', '+51 98…' → telefono_e164 contiene esos digitos
 *  · cualquier otra cosa  → nombre_completo contiene el texto (sin distinguir
 *                           mayusculas; las tildes SI cuentan: «maria» no
 *                           encuentra «María» — no hay `unaccent` en la base)
 *
 * `%` y `*` se quitan porque son comodines de LIKE / PostgREST: un «*» suelto
 * traeria la cartera entera con cara de haber buscado algo.
 */
function interpretarBusqueda(
  busqueda: string | undefined,
): { columna: 'usuario_red' | 'telefono_e164' | 'nombre_completo'; patron: string } | null {
  const limpia = (busqueda ?? '').replace(/[%*]/g, ' ').trim()
  if (limpia === '') return null

  if (limpia.startsWith('@')) {
    const usuario = limpia.replace(/^@+/, '').trim().toLowerCase()
    return usuario === '' ? null : { columna: 'usuario_red', patron: `%${usuario}%` }
  }

  if (/^[\d\s+\-().]+$/.test(limpia)) {
    const digitos = limpia.replace(/\D/g, '')
    if (digitos !== '') return { columna: 'telefono_e164', patron: `%${digitos}%` }
  }

  return { columna: 'nombre_completo', patron: `%${limpia.replace(/\s+/g, ' ')}%` }
}

/**
 * Arma la consulta con TODOS los filtros en el servidor. Se usa igual para
 * traer filas y para contar, de modo que el numero de la cabecera y la lista
 * nunca salgan de dos criterios distintos.
 */
function consultaCartera(filtro: FiltroCartera, soloConteo: boolean) {
  let q = supabase
    .from('v_cartera')
    .select(soloConteo ? 'id' : COLUMNAS_CARTERA, soloConteo ? { count: 'exact', head: true } : {})

  switch (filtro.vista) {
    case 'activos':
      q = q.eq('situacion', 'activa').eq('no_contactar', false)
      break
    case 'frios':
      q = q.eq('situacion', 'pausada').eq('no_contactar', false)
      break
    case 'descartados':
      // Descartados = perdidas, MAS cualquier oportunidad de una persona que
      // pidio no ser contactada (SPEC §6.A). Asi un «no contactar» nunca
      // aparece en Activos ni en Frios, aunque algo haya quedado a medias.
      q = q.or('situacion.eq.perdida,no_contactar.is.true')
      break
    case 'todos':
      break
  }

  if (filtro.responsable === 'mios') {
    if (filtro.yo === undefined || filtro.yo === '') {
      // Filtrar «mios» sin saber quien soy devolveria una lista que no es la
      // mia. Mejor un error que se ve que una lista que miente.
      throw new Error('No se sabe quién eres todavía: vuelve a cargar la sesión para ver «Míos».')
    }
    q = q.eq('responsable_id', filtro.yo)
  } else if (filtro.responsable === 'sin_dueno') {
    q = q.is('responsable_id', null)
  }

  if (filtro.campanaId === null) q = q.is('campana_id', null)
  else if (filtro.campanaId !== undefined) q = q.eq('campana_id', filtro.campanaId)

  const busqueda = interpretarBusqueda(filtro.busqueda)
  if (busqueda !== null) q = q.ilike(busqueda.columna, busqueda.patron)

  return q
}

function mensajeDeCartera(mensaje: string): string {
  if (mensaje.includes('v_cartera')) {
    return 'Falta ejecutar sql/13-seguimiento-comercial.sql en Supabase: sin la vista v_cartera no hay cartera que leer.'
  }
  return mensajeDeError(mensaje)
}

/** Milisegundos de una fecha ISO, o `null` si no es una fecha. */
function instante(iso: string | null): number | null {
  if (iso === null) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/**
 * El orden de trabajo de la cartera (SPEC §6.A): temperatura, luego la tarea
 * que vence antes (las que no tienen tarea al final — son R6 roto, pero se ven
 * en su propia alerta), luego quien entro antes (lleva mas esperando).
 * Devuelve una copia; no reordena el arreglo recibido.
 */
export function ordenarCartera(filas: readonly FilaCartera[]): FilaCartera[] {
  return [...filas].sort((a, b) => {
    const porTemperatura = rangoTemperatura(a.temperatura) - rangoTemperatura(b.temperatura)
    if (porTemperatura !== 0) return porTemperatura

    const ta = instante(a.proximaTareaVenceEl)
    const tb = instante(b.proximaTareaVenceEl)
    if (ta !== tb) {
      if (ta === null) return 1
      if (tb === null) return -1
      return ta - tb
    }

    return (instante(a.fechaIngreso) ?? 0) - (instante(b.fechaIngreso) ?? 0)
  })
}

/**
 * La cartera filtrada. Los filtros van al servidor; el orden de trabajo se
 * aplica aqui porque depende del rango de la temperatura, que no es una
 * columna ordenable en la vista.
 *
 * Del servidor se piden primero las que entraron mas recientemente: si algun
 * dia hay mas de LIMITE_CARTERA, lo que queda fuera es lo mas antiguo — y la
 * pantalla avisa.
 */
export async function cargarCartera(filtro: FiltroCartera): Promise<Lote<FilaCartera>> {
  const { data, error } = await consultaCartera(filtro, false)
    .order('fecha_ingreso', { ascending: false })
    .limit(filtro.limite ?? LIMITE_CARTERA)

  if (error !== null) throw new Error(mensajeDeCartera(error.message))

  const lote = leerLote(data, interpretarFilaCartera)
  return { filas: ordenarCartera(lote.filas), descartadas: lote.descartadas }
}

/** Todas las oportunidades de una persona (las que el rol puede ver), la mas nueva primero. */
export async function cargarOportunidadesDePersona(personaId: string): Promise<Lote<FilaCartera>> {
  const { data, error } = await supabase
    .from('v_cartera')
    .select(COLUMNAS_CARTERA)
    .eq('persona_id', personaId)
    .order('creado_el', { ascending: false })
    .limit(50)

  if (error !== null) throw new Error(mensajeDeCartera(error.message))
  return leerLote(data, interpretarFilaCartera)
}

/**
 * Cual de las oportunidades de una persona se abre por defecto en su ficha:
 * la activa mas nueva; si no hay, la pausada (en frios) mas nueva; si tampoco,
 * la mas nueva de todas. Una persona puede tener varias (una perdida del
 * lanzamiento anterior y una activa de este) y la ficha tiene que abrir la
 * que se esta trabajando, no la ultima que alguien toco.
 */
export function elegirOportunidadPrincipal(filas: readonly FilaCartera[]): FilaCartera | null {
  const masNueva = (lista: readonly FilaCartera[]): FilaCartera | null => {
    let mejor: FilaCartera | null = null
    for (const f of lista) {
      if (mejor === null || (instante(f.creadoEl) ?? 0) > (instante(mejor.creadoEl) ?? 0)) {
        mejor = f
      }
    }
    return mejor
  }

  return (
    masNueva(filas.filter((f) => f.situacion === 'activa')) ??
    masNueva(filas.filter((f) => f.situacion === 'pausada')) ??
    masNueva(filas)
  )
}

/**
 * Conteo EXACTO con los mismos filtros que la lista (cabecera de Personas,
 * llamada a la accion de Hoy). `soloNuevos` = nadie ha registrado todavia
 * ningun contacto (`total_contactos = 0`), que es la cola de primer contacto.
 */
export async function contarCartera(
  filtro: FiltroCartera & { soloNuevos?: boolean | undefined },
): Promise<number> {
  let q = consultaCartera(filtro, true)
  if (filtro.soloNuevos === true) q = q.eq('total_contactos', 0)

  const { count, error } = await q
  if (error !== null) throw new Error(mensajeDeCartera(error.message))
  if (count === null) {
    // Sin error pero sin conteo: no se inventa un cero.
    throw new Error('La base no devolvió el conteo de la cartera.')
  }
  return count
}
