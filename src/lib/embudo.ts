import { supabase } from '@/lib/supabase'
import { booleano, entero, leerLote, texto, type Lote } from '@/lib/lectura'
import { ORIGENES } from '@/lib/registro-rapido'

/**
 * Datos del tablero del embudo.
 *
 * ---------------------------------------------------------------------------
 * QUIEN MANDA AQUI
 * ---------------------------------------------------------------------------
 * Los 10 estados son un tipo cerrado de la base (`create type estado_embudo`
 * en 01-schema.sql, seccion 0). Este archivo los ORDENA y los ETIQUETA para
 * pintarlos; no puede anadir, quitar ni renombrar ninguno. Si el enum de la
 * base cambia, esto se actualiza detras, citando la migracion — nunca al reves.
 *
 * Mover una tarjeta es un `update` de una sola columna. El historial NO se
 * escribe desde aqui: lo escribe el disparador `t_oportunidad_historial`
 * (R9). Si este archivo insertara en `estado_historial`, cada movimiento
 * quedaria registrado dos veces y la trazabilidad —que es la evidencia de la
 * parte 1 del reporte de 7 partes— empezaria a mentir.
 *
 * ---------------------------------------------------------------------------
 * NINGUNA CIFRA DE NEGOCIO VIVE AQUI
 * ---------------------------------------------------------------------------
 * El unico numero de este archivo es el umbral de dias sin contacto, declarado
 * abajo como 🔵 PROPUESTA con su procedencia. No hay precios, plazos ni cupos.
 */

// ---------------------------------------------------------------------------
// Los 10 estados
// ---------------------------------------------------------------------------

/**
 * Los 10 estados del embudo, en el orden del enum `estado_embudo`.
 *
 * `corta` es solo para la cabecera de la columna, donde no caben tres
 * palabras. El nombre completo se mantiene en `etiqueta` y es el que se usa en
 * cualquier sitio donde haya espacio.
 *
 * Fuente de la lista y de su orden:
 *   02-codigo\sql\01-schema.sql · `create type estado_embudo` (seccion 0)
 *   D:\SCPCMO\01-comercial\embudo-y-metricas.md §1 (estructura aprobada)
 */
export const ESTADOS = [
  { valor: '01_prospecto_captado', etiqueta: 'Prospecto captado', corta: 'Captado' },
  { valor: '02_contactado', etiqueta: 'Contactado', corta: 'Contactado' },
  { valor: '03_registrado', etiqueta: 'Registrado', corta: 'Registrado' },
  { valor: '04_asistente', etiqueta: 'Asistente', corta: 'Asistente' },
  { valor: '05_separacion', etiqueta: 'Separación', corta: 'Separación' },
  { valor: '06_calificado', etiqueta: 'Calificado', corta: 'Calificado' },
  { valor: '07_contrato', etiqueta: 'Contrato', corta: 'Contrato' },
  { valor: '08_inicial_cobrada', etiqueta: 'Inicial cobrada', corta: 'Inicial' },
  { valor: '09_pago_total', etiqueta: 'Pago total', corta: 'Pago total' },
  { valor: '10_posventa', etiqueta: 'Posventa', corta: 'Posventa' },
] as const

export type EstadoEmbudo = (typeof ESTADOS)[number]['valor']

export const ETIQUETA_ESTADO: Readonly<Record<string, string>> = Object.fromEntries(
  ESTADOS.map((e) => [e.valor, e.etiqueta]),
)

export function etiquetaEstado(estado: string): string {
  // Un estado que este cliente no conoce se muestra crudo, no se maquilla:
  // asi se ve que el enum de la base cambio y la interfaz no.
  return ETIQUETA_ESTADO[estado] ?? estado
}

/** Posicion en el embudo. `-1` si el estado no es de los 10 conocidos. */
export function ordenEstado(estado: string): number {
  return ESTADOS.findIndex((e) => e.valor === estado)
}

/** Indice de `06_calificado`, la frontera de R5. Se busca, no se escribe. */
const ORDEN_CALIFICADO = ordenEstado('06_calificado')

/**
 * ¿Este estado exige las 4 respuestas de cualificacion? (regla R5)
 *
 * La restriccion real es `calificado_requiere_las_4_respuestas` en
 * 01-schema.sql, y dice `estado < '06_calificado' or (las 4 no son nulas)`.
 * O sea: la exigencia no es solo del 06 — vale para el 06 y para todos los
 * posteriores. Esta funcion reproduce esa comparacion para poder AVISAR antes
 * de intentar el movimiento; quien lo impide sigue siendo la base.
 */
export function exigeCualificacion(estado: string): boolean {
  const orden = ordenEstado(estado)
  return orden >= 0 && orden >= ORDEN_CALIFICADO
}

/** Etiqueta de un origen de `personas.origen`, o el valor crudo si no se conoce. */
export function etiquetaOrigen(origen: string): string {
  return ORIGENES.find((o) => o.valor === origen)?.etiqueta ?? origen
}

// ---------------------------------------------------------------------------
// Umbrales de la pantalla
// ---------------------------------------------------------------------------

/**
 * 🔵 PROPUESTA — a partir de cuantos dias sin contacto se marca la tarjeta.
 *
 * Procedencia: encargo de Patriccio del 10/09/2026 («marca en rojo las que
 * llevan mas de 3 dias sin contacto»). Mismo criterio y mismo numero que la
 * ventana de vigilancia de la pantalla Hoy (`DIAS_VIGILANCIA_SEPARACION`).
 *
 * NO es un plazo comercial y por eso no vive en `parametros`: es cuanta
 * paciencia quiere el equipo antes de considerar que un prospecto se esta
 * enfriando. Una decision de operacion, no de contrato. Sigue sin ratificar
 * por Direccion; si Walter fija otro numero, se cambia aqui y no hay que
 * migrar nada.
 *
 * La comparacion es ESTRICTA (`> 3`), porque el encargo dice «mas de 3 dias».
 */
export const DIAS_SIN_CONTACTO_ALERTA = 3

export function estaEnfriada(diasSinContacto: number | null): boolean {
  return diasSinContacto !== null && diasSinContacto > DIAS_SIN_CONTACTO_ALERTA
}

/**
 * Tope de tarjetas que se traen de una vez.
 *
 * El tablero filtra en el navegador (ver `cargarTarjetas`), asi que si alguna
 * vez llegan justo este numero de filas la pantalla lo DICE en voz alta en vez
 * de mostrar un tablero incompleto con cara de completo.
 */
export const LIMITE_TARJETAS = 500

// ---------------------------------------------------------------------------
// La tarjeta
// ---------------------------------------------------------------------------

export type Tarjeta = {
  /** Id de la OPORTUNIDAD. */
  id: string
  personaId: string | null
  nombreCompleto: string
  telefono: string | null
  origen: string | null
  estado: string
  situacion: string
  lanzamiento: string | null
  responsableId: string | null
  /**
   * `null` puede significar dos cosas distintas y la pantalla las separa:
   * que la oportunidad no tenga responsable, o que RLS no deje leer esa fila
   * de `perfiles` (ver el encabezado de 08-vistas-embudo-e-inventario.sql).
   * Se distinguen por `responsableId`.
   */
  responsableNombre: string | null
  fechaUltimoContacto: string | null
  diasSinContacto: number | null
  cualificacionCompleta: boolean | null
  tieneTareaAbierta: boolean | null
}

const COLUMNAS_TARJETA =
  'id, persona_id, nombre_completo, telefono_e164, origen, estado, situacion, ' +
  'lanzamiento, responsable_id, responsable_nombre, fecha_ultimo_contacto, ' +
  'dias_sin_contacto, cualificacion_completa, tiene_tarea_abierta'

function interpretarTarjeta(fila: unknown): Tarjeta | null {
  if (typeof fila !== 'object' || fila === null) return null
  const f = fila as Record<string, unknown>

  const id = texto(f['id'])
  const nombreCompleto = texto(f['nombre_completo'])
  const estado = texto(f['estado'])
  const situacion = texto(f['situacion'])
  if (id === null || nombreCompleto === null || estado === null || situacion === null) {
    return null
  }

  return {
    id,
    personaId: texto(f['persona_id']),
    nombreCompleto,
    telefono: texto(f['telefono_e164']),
    origen: texto(f['origen']),
    estado,
    situacion,
    lanzamiento: texto(f['lanzamiento']),
    responsableId: texto(f['responsable_id']),
    responsableNombre: texto(f['responsable_nombre']),
    fechaUltimoContacto: texto(f['fecha_ultimo_contacto']),
    diasSinContacto: entero(f['dias_sin_contacto']),
    cualificacionCompleta: booleano(f['cualificacion_completa']),
    tieneTareaAbierta: booleano(f['tiene_tarea_abierta']),
  }
}

/**
 * Traduce el error de Postgres a algo accionable.
 *
 * Solo se reescribe lo que se conoce con certeza. Cualquier otro error se
 * muestra tal cual: preferimos un mensaje feo y cierto a uno bonito que oculte
 * lo que de verdad paso.
 */
function mensajeDeError(mensaje: string): string {
  if (mensaje.includes('v_embudo_tarjetas')) {
    return (
      'Falta ejecutar 02-codigo\\sql\\08-vistas-embudo-e-inventario.sql en Supabase. ' +
      'Sin esa vista el tablero no tiene de donde leer.'
    )
  }
  if (mensaje.includes('calificado_requiere_las_4_respuestas')) {
    return (
      'La base rechazó el movimiento: no se puede llegar a Calificado (ni más allá) sin ' +
      'las 4 respuestas de cualificación — operar o invertir · compró antes · forma de pago · ' +
      'decide solo. Regla R5. Complétalas en la ficha de la persona y vuelve a mover la tarjeta.'
    )
  }
  if (mensaje.includes('unidad_una_sola_asignacion_activa')) {
    return (
      'La base rechazó el movimiento: esa unidad ya tiene otra asignación activa (regla R1, ' +
      'doble asignación). Revisa el inventario antes de continuar.'
    )
  }
  if (mensaje.includes('row-level security') || mensaje.includes('violates row-level')) {
    return 'Tu rol no puede mover esta oportunidad (política oport_editar de RLS). Habla con Walter.'
  }
  if (mensaje.includes('JWT') || mensaje.includes('sesión activa')) {
    return 'Se cerró tu sesión. Vuelve a entrar al CRM.'
  }
  if (mensaje.includes('Failed to fetch') || mensaje.includes('NetworkError')) {
    return 'No hay conexión con el servidor. La tarjeta vuelve a su columna.'
  }
  return mensaje
}

/**
 * Las oportunidades que se ven en el tablero.
 *
 * Solo `situacion = 'activa'`: el tablero es la foto de lo que esta en juego.
 * Una oportunidad ganada, perdida o pausada no se arrastra entre columnas — se
 * consulta en la ficha de la persona y en los reportes. La cabecera de la
 * pantalla lo dice, para que nadie lea el conteo como «todo lo que existe».
 *
 * Los tres filtros (lanzamiento, responsable, origen) se aplican en el
 * navegador, no aqui, y a proposito: sus opciones se construyen con lo que hay
 * de verdad en el tablero. Si se filtrara en la consulta, elegir un
 * lanzamiento vaciaria la lista de los demas.
 */
export async function cargarTarjetas(): Promise<Lote<Tarjeta>> {
  const { data, error } = await supabase
    .from('v_embudo_tarjetas')
    .select(COLUMNAS_TARJETA)
    .eq('situacion', 'activa')
    // Lo mas frio primero: dentro de cada columna, arriba lo que lleva mas
    // tiempo sin que nadie lo toque.
    .order('dias_sin_contacto', { ascending: false })
    .limit(LIMITE_TARJETAS)

  if (error !== null) throw new Error(mensajeDeError(error.message))
  return leerLote(data, interpretarTarjeta)
}

// ---------------------------------------------------------------------------
// Mover una tarjeta
// ---------------------------------------------------------------------------

export type ResultadoMovimiento = { ok: true } | { ok: false; motivo: string }

/**
 * Cambia el estado de una oportunidad. Nada mas.
 *
 * Lo que este codigo NO hace, y es lo importante:
 *  · No escribe en `estado_historial` — eso es del disparador (R9).
 *  · No comprueba R5 por su cuenta para «ahorrarse» el viaje. Avisar antes
 *    esta bien; sustituir a la restriccion, no. Un formulario se esquiva; la
 *    restriccion de la base, no.
 *
 * El `.select()` final no es decoracion. Con RLS, un `update` que no encaja en
 * la politica NO devuelve error: afecta a cero filas y responde 200. Sin
 * comprobar que volvio una fila, la pantalla mostraria la tarjeta movida y la
 * base se habria quedado como estaba — la peor de las dos mentiras posibles.
 */
export async function moverOportunidad(
  id: string,
  nuevoEstado: EstadoEmbudo,
): Promise<ResultadoMovimiento> {
  const { data, error } = await supabase
    .from('oportunidades')
    .update({ estado: nuevoEstado })
    .eq('id', id)
    .select('id, estado')

  if (error !== null) {
    return { ok: false, motivo: mensajeDeError(error.message) }
  }

  if (!Array.isArray(data) || data.length === 0) {
    return {
      ok: false,
      motivo:
        'La base no aplicó el cambio y tampoco devolvió un error: tu rol no puede editar esta ' +
        'oportunidad (política oport_editar de RLS). La tarjeta vuelve a su columna.',
    }
  }

  const confirmado = texto((data[0] as Record<string, unknown>)['estado'])
  if (confirmado !== nuevoEstado) {
    return {
      ok: false,
      motivo:
        `La base guardó «${confirmado ?? 'desconocido'}» en vez de «${nuevoEstado}». ` +
        'No se muestra el movimiento hasta saber por qué.',
    }
  }

  return { ok: true }
}
