import { supabase } from '@/lib/supabase'
import { entero, leerLote, reventar, texto, type Lote } from '@/lib/lectura'
import {
  COLUMNAS_SEPARACION,
  interpretarSeparacion,
  type SeparacionVigilada,
} from '@/lib/separaciones'

/**
 * Datos de la pantalla Hoy.
 *
 * ---------------------------------------------------------------------------
 * POR QUE HAY LECTORES A MANO Y NO TIPOS DEL ESQUEMA
 * ---------------------------------------------------------------------------
 * `src/lib/tipos.ts` sigue vacio: los tipos generados desde la base todavia no
 * existen (README, seccion Tipos). Mientras tanto NO se escriben tipos del
 * esquema a mano y se dan por buenos — se sigue el patron ya establecido en
 * src/auth/tipos-sesion.ts: cada fila que llega de la base pasa por un lector
 * que la COMPRUEBA y devuelve `null` si no cumple. Una fila rara se descarta y
 * se cuenta; nunca se pinta un dato que no se pudo verificar.
 *
 * Las utilidades de esa comprobacion (`texto`, `entero`, `monto`, `leerLote`)
 * vivian aqui; el 10/09/2026 se mudaron a src/lib/lectura.ts, cuando el embudo
 * y el inventario iban a necesitar una segunda y una tercera copia. El tipo
 * `Lote` se re-exporta mas abajo para no romper a quien ya lo importaba de
 * este archivo.
 *
 * Cuando `npm run tipos` funcione, estos tipos pasan a derivarse de `Database`
 * y los lectores se quedan solo como validacion de frontera.
 *
 * ---------------------------------------------------------------------------
 * NINGUNA CIFRA DE NEGOCIO VIVE AQUI
 * ---------------------------------------------------------------------------
 * Este archivo no contiene precios, montos ni plazos comerciales. El unico
 * numero que aparece es la ventana de vigilancia de 3 dias, y esta declarado
 * abajo como 🔵 PROPUESTA con su procedencia exacta.
 */

/**
 * 🔵 PROPUESTA — Ventana de vigilancia del bloque 1 de la pantalla Hoy.
 *
 * Procedencia: encargo de Patriccio del 10/09/2026 («separaciones que vencen
 * en 3 dias o menos»), coherente con BRIEF-CLAUDE-DESIGN.md §3, pantalla 1.
 *
 * NO es un plazo comercial y por eso no vive en `parametros`: los plazos del
 * negocio son los dos relojes de la separacion, que si estan en la base
 * (`plazo_devolucion_separacion_dias` y `plazo_vigencia_precio_dias`). Esto es
 * solo cuanta antelacion quiere el equipo para que una separacion aparezca en
 * la lista de urgencias — una decision de operacion, no de contrato.
 *
 * Sigue sin ratificar por Direccion. Si Walter fija otro numero, se cambia
 * aqui y no hay que migrar nada.
 */
export const DIAS_VIGILANCIA_SEPARACION = 3

/**
 * Los 10 estados del embudo y sus etiquetas viven en src/lib/embudo.ts, que es
 * de quien son. Se re-exportan aqui porque esta pantalla ya los importaba de
 * este archivo, y porque tener dos mapas de etiquetas en dos modulos es como
 * empiezan a llamarse distinto en dos pantallas.
 */
export { ETIQUETA_ESTADO, etiquetaEstado } from '@/lib/embudo'

/** Se re-exporta para no romper a quien ya lo importaba de aqui. */
export type { Lote } from '@/lib/lectura'

// ---------------------------------------------------------------------------
// 1 · SEPARACIONES EN VIGILANCIA
// ---------------------------------------------------------------------------

/**
 * El tipo y el lector de una separacion vigilada viven en
 * src/lib/separaciones.ts, que es de quien son: los dos relojes son la regla
 * R4 y no puede haber dos criterios para leerlos. Se re-exporta el tipo porque
 * la pantalla Hoy ya lo importaba de aqui.
 *
 * Lo que si se queda en este archivo son las DOS CONSULTAS de abajo: son los
 * bloques 0 y 1 de la pantalla Hoy, con su ventana de vigilancia, y no tienen
 * nada que hacer en el modulo de separaciones.
 */
export type { SeparacionVigilada } from '@/lib/separaciones'

/**
 * Bloque 1 · separaciones cuyo plazo se acaba en `DIAS_VIGILANCIA_SEPARACION`
 * dias o menos.
 *
 * Entra la fila si CUALQUIERA de los dos relojes esta dentro de la ventana —
 * pero cada uno se muestra por separado en la pantalla, con su nombre. Filtrar
 * por uno solo dejaria fuera un riesgo real; fundirlos en un solo numero seria
 * romper R4. Tambien entran los ya vencidos (dias negativos): un plazo pasado
 * no deja de ser urgente, al contrario.
 */
export async function cargarSeparacionesEnRiesgo(): Promise<Lote<SeparacionVigilada>> {
  const { data, error } = await supabase
    .from('v_separaciones_vigilancia')
    .select(COLUMNAS_SEPARACION)
    .or(
      `dias_para_fin_devolucion.lte.${DIAS_VIGILANCIA_SEPARACION},` +
        `dias_para_fin_precio.lte.${DIAS_VIGILANCIA_SEPARACION}`,
    )
    .limit(50)

  reventar('No se pudieron leer las separaciones en vigilancia', error)
  return leerLote(data, interpretarSeparacion)
}

/**
 * Bloque 0 (solo rol `direccion`) · separaciones esperando la verificacion de
 * Walter. R2/R3: mientras `verificada_el` sea nulo no hay recibo ni constancia,
 * asi que esta lista es dinero parado.
 */
export async function cargarSeparacionesPorVerificar(): Promise<Lote<SeparacionVigilada>> {
  const { data, error } = await supabase
    .from('v_separaciones_vigilancia')
    .select(COLUMNAS_SEPARACION)
    .is('verificada_el', null)
    .eq('estado', 'pendiente_verificacion')
    .limit(50)

  reventar('No se pudieron leer las separaciones por verificar', error)
  return leerLote(data, interpretarSeparacion)
}

// ---------------------------------------------------------------------------
// 2 y 4 · TAREAS
// ---------------------------------------------------------------------------

export type TareaFila = {
  id: string
  titulo: string
  detalle: string | null
  venceEl: string
  prioridad: number | null
  oportunidadId: string | null
  personaId: string | null
  nombrePersona: string | null
  telefonoPersona: string | null
}

const COLUMNAS_TAREA =
  'id, titulo, detalle, vence_el, prioridad, oportunidad_id, persona_id, ' +
  'personas(nombre_completo, telefono_e164)'

function interpretarTarea(fila: unknown): TareaFila | null {
  if (typeof fila !== 'object' || fila === null) return null
  const f = fila as Record<string, unknown>

  const id = texto(f['id'])
  const titulo = texto(f['titulo'])
  const venceEl = texto(f['vence_el'])
  if (id === null || titulo === null || venceEl === null) return null

  // PostgREST devuelve la relacion muchos-a-uno como objeto (o null).
  const cruda = f['personas']
  const persona =
    typeof cruda === 'object' && cruda !== null && !Array.isArray(cruda)
      ? (cruda as Record<string, unknown>)
      : null

  return {
    id,
    titulo,
    detalle: texto(f['detalle']),
    venceEl,
    prioridad: entero(f['prioridad']),
    oportunidadId: texto(f['oportunidad_id']),
    personaId: texto(f['persona_id']),
    nombrePersona: persona ? texto(persona['nombre_completo']) : null,
    telefonoPersona: persona ? texto(persona['telefono_e164']) : null,
  }
}

/**
 * Bloque 2 · tareas del usuario actual que ya vencieron y siguen abiertas.
 *
 * `responsable_id` se filtra explicitamente aunque la politica `tareas_leer`
 * de RLS deje ver todas: el bloque dice «tus tareas vencidas» y tiene que
 * decir la verdad. El corte es `now()`, la hora real, no el inicio del dia.
 */
export async function cargarTareasVencidas(responsableId: string): Promise<Lote<TareaFila>> {
  const { data, error } = await supabase
    .from('tareas')
    .select(COLUMNAS_TAREA)
    .eq('responsable_id', responsableId)
    .is('completada_el', null)
    .lt('vence_el', new Date().toISOString())
    .order('vence_el', { ascending: true })
    .limit(50)

  reventar('No se pudieron leer tus tareas vencidas', error)
  return leerLote(data, interpretarTarea)
}

/**
 * Bloque 4 · tareas del usuario actual que vencen hoy y todavia no vencieron.
 *
 * El limite inferior es `now()` y no el inicio del dia, a proposito: lo que ya
 * paso de hora esta en el bloque 2. Asi ninguna tarea sale dos veces y los dos
 * conteos se pueden sumar sin mentir.
 */
export async function cargarTareasDeHoy(responsableId: string): Promise<Lote<TareaFila>> {
  const finDelDia = new Date()
  finDelDia.setHours(23, 59, 59, 999)

  const { data, error } = await supabase
    .from('tareas')
    .select(COLUMNAS_TAREA)
    .eq('responsable_id', responsableId)
    .is('completada_el', null)
    .gte('vence_el', new Date().toISOString())
    .lte('vence_el', finDelDia.toISOString())
    .order('vence_el', { ascending: true })
    .limit(50)

  reventar('No se pudieron leer las tareas de hoy', error)
  return leerLote(data, interpretarTarea)
}

// ---------------------------------------------------------------------------
// 3 · OPORTUNIDADES SIN SIGUIENTE PASO
// ---------------------------------------------------------------------------

export type SinSiguientePaso = {
  /** Id de la OPORTUNIDAD (asi se llama la columna en la vista). */
  id: string
  personaId: string | null
  nombreCompleto: string
  telefono: string | null
  estado: string
  lanzamiento: string | null
  fechaUltimoContacto: string | null
  diasSinContacto: number | null
}

function interpretarSinPaso(fila: unknown): SinSiguientePaso | null {
  if (typeof fila !== 'object' || fila === null) return null
  const f = fila as Record<string, unknown>

  const id = texto(f['id'])
  const nombreCompleto = texto(f['nombre_completo'])
  const estado = texto(f['estado'])
  if (id === null || nombreCompleto === null || estado === null) return null

  return {
    id,
    personaId: texto(f['persona_id']),
    nombreCompleto,
    telefono: texto(f['telefono_e164']),
    estado,
    lanzamiento: texto(f['lanzamiento']),
    fechaUltimoContacto: texto(f['fecha_ultimo_contacto']),
    diasSinContacto: entero(f['dias_sin_contacto']),
  }
}

/**
 * Bloque 3 · oportunidades activas sin ninguna tarea abierta.
 *
 * Es la lista de incumplimientos vivos de R6, y la razon por la que existe la
 * pantalla: «hay semanas, incluso meses, en los que no hacemos seguimiento»
 * (Walter, 07-crm\CLAUDE.md §4).
 */
export async function cargarSinSiguientePaso(): Promise<Lote<SinSiguientePaso>> {
  const { data, error } = await supabase
    .from('v_sin_siguiente_paso')
    .select(
      'id, persona_id, nombre_completo, telefono_e164, estado, lanzamiento, ' +
        'fecha_ultimo_contacto, dias_sin_contacto',
    )
    .limit(50)

  reventar('No se pudieron leer las oportunidades sin siguiente paso', error)
  return leerLote(data, interpretarSinPaso)
}

// ---------------------------------------------------------------------------
// Acciones directas de cada fila
// ---------------------------------------------------------------------------

/**
 * Canales de interaccion. Fuente: `create type canal_interaccion` en
 * 01-schema.sql (seccion 0). El orden es el de uso real, no el del enum.
 */
export const CANALES = [
  { valor: 'whatsapp', etiqueta: 'WhatsApp' },
  { valor: 'llamada', etiqueta: 'Llamada' },
  { valor: 'presencial', etiqueta: 'Presencial' },
  { valor: 'live', etiqueta: 'Live' },
  { valor: 'instagram', etiqueta: 'Instagram' },
  { valor: 'facebook', etiqueta: 'Facebook' },
  { valor: 'tiktok', etiqueta: 'TikTok' },
  { valor: 'email', etiqueta: 'Correo' },
  { valor: 'otro', etiqueta: 'Otro' },
] as const

export type Canal = (typeof CANALES)[number]['valor']

export type NuevaInteraccion = {
  personaId: string
  oportunidadId: string | null
  canal: Canal
  resumen: string
  entrante: boolean
  actorId: string
}

/**
 * Registra una interaccion y, si va atada a una oportunidad, adelanta sus
 * fechas de contacto.
 *
 * `fecha_primer_contacto` solo se escribe si estaba vacia — es lo que mide el
 * SLA de primera respuesta (`v_sla_primera_respuesta`), y pisarlo cada vez
 * convertiria ese indicador en ruido.
 */
export async function registrarInteraccion(datos: NuevaInteraccion): Promise<void> {
  const ahora = new Date().toISOString()

  const { error } = await supabase.from('interacciones').insert({
    persona_id: datos.personaId,
    oportunidad_id: datos.oportunidadId,
    canal: datos.canal,
    entrante: datos.entrante,
    resumen: datos.resumen.trim(),
    ocurrio_el: ahora,
    actor_id: datos.actorId,
  })
  reventar('No se pudo registrar la interacción', error)

  if (datos.oportunidadId === null) return

  const { data: previa, error: errorLectura } = await supabase
    .from('oportunidades')
    .select('fecha_primer_contacto')
    .eq('id', datos.oportunidadId)
    .maybeSingle()
  reventar('La interacción se guardó, pero no se pudo leer la oportunidad', errorLectura)

  const yaTuvoPrimerContacto =
    typeof previa === 'object' &&
    previa !== null &&
    texto((previa as Record<string, unknown>)['fecha_primer_contacto']) !== null

  const cambios: Record<string, string> = { fecha_ultimo_contacto: ahora }
  if (!yaTuvoPrimerContacto) cambios['fecha_primer_contacto'] = ahora

  const { error: errorUpd } = await supabase
    .from('oportunidades')
    .update(cambios)
    .eq('id', datos.oportunidadId)
  reventar('La interacción se guardó, pero no se pudo actualizar la oportunidad', errorUpd)
}

export type NuevaTarea = {
  titulo: string
  detalle: string | null
  /** Fecha y hora locales en formato `datetime-local` (YYYY-MM-DDTHH:mm). */
  venceEl: string
  oportunidadId: string | null
  personaId: string | null
  responsableId: string
}

/** Crea una tarea abierta. Es la forma de cerrar un incumplimiento de R6. */
export async function crearTarea(datos: NuevaTarea): Promise<void> {
  const vence = new Date(datos.venceEl)
  if (Number.isNaN(vence.getTime())) {
    throw new Error('La fecha de vencimiento no es válida.')
  }

  const { error } = await supabase.from('tareas').insert({
    titulo: datos.titulo.trim(),
    detalle: datos.detalle,
    oportunidad_id: datos.oportunidadId,
    persona_id: datos.personaId,
    responsable_id: datos.responsableId,
    vence_el: vence.toISOString(),
    creado_por: datos.responsableId,
  })
  reventar('No se pudo crear la tarea', error)
}

/**
 * Marca una tarea como hecha. No la borra: R8 («nada se borra»), y ademas el
 * historial de tareas cumplidas es la evidencia de la parte 1 del reporte de
 * 7 partes.
 */
export async function completarTarea(tareaId: string): Promise<void> {
  const { error } = await supabase
    .from('tareas')
    .update({ completada_el: new Date().toISOString() })
    .eq('id', tareaId)
  reventar('No se pudo marcar la tarea como hecha', error)
}
