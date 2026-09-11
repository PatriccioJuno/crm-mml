import { supabase } from '@/lib/supabase'
import { entero, leerLote, monto, texto, type Lote } from '@/lib/lectura'

/**
 * `parametros` — el unico sitio del sistema donde puede vivir una cifra.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE MODULO EXISTE
 * ---------------------------------------------------------------------------
 * 07-crm\CLAUDE.md §2: ningun precio, monto, plazo, cantidad de unidades ni
 * condicion comercial se escribe literal en el codigo, en el esquema, en un
 * `seed`, en la interfaz ni en un documento. Todo vive en `parametros`, con su
 * `fuente` apuntando al archivo exacto de 00-fuente-de-verdad y su
 * `estado_semaforo`.
 *
 * La consecuencia practica es esta: cuando una pantalla necesita una cifra, no
 * la tiene — la PIDE. Y tiene que saber tratar la respuesta «todavia no hay
 * valor», que hoy es la respuesta de casi todos (14 de los 16 parametros
 * sembrados estan en 🔴 rojo a proposito, 04-seed-parametros.sql).
 *
 * ---------------------------------------------------------------------------
 * LA REGLA QUE HACE CUMPLIR ESTE ARCHIVO
 * ---------------------------------------------------------------------------
 * Un parametro en 🔴 rojo NO tiene valor utilizable, aunque su columna traiga
 * un numero. Se muestra `PENDIENTE` y no se cotiza con el. Nunca se «rellena
 * el hueco» con lo ultimo que se vio: asi nacieron los 8 precios y las 4
 * politicas de financiamiento en conflicto que documenta 00-fuente-de-verdad.
 */

/**
 * Lo que se ESCRIBE en pantalla en lugar de una cifra que no se puede afirmar.
 * Texto literal pedido por 04-seed-parametros.sql («la interfaz debe mostrarlo
 * como…»). Se declara una vez para que las cuatro pantallas digan lo mismo.
 */
export const PENDIENTE = '[PENDIENTE — ver 00-fuente-de-verdad]'

export type Parametro = {
  id: string
  descripcion: string
  valorTexto: string | null
  /** `numeric` de Postgres: se conserva como llega (ver src/lib/lectura.ts). */
  valorNumerico: number | string | null
  valorMoneda: string | null
  valorEntero: number | null
  unidad: string | null
  fuente: string
  estadoSemaforo: string
  nota: string | null
}

const COLUMNAS =
  'id, descripcion, valor_texto, valor_numerico, valor_moneda, valor_entero, ' +
  'unidad, fuente, estado_semaforo, nota'

function interpretarParametro(fila: unknown): Parametro | null {
  if (typeof fila !== 'object' || fila === null) return null
  const f = fila as Record<string, unknown>

  const id = texto(f['id'])
  const descripcion = texto(f['descripcion'])
  const fuente = texto(f['fuente'])
  const estadoSemaforo = texto(f['estado_semaforo'])
  if (id === null || descripcion === null || fuente === null || estadoSemaforo === null) {
    return null
  }

  return {
    id,
    descripcion,
    valorTexto: texto(f['valor_texto']),
    valorNumerico: monto(f['valor_numerico']),
    valorMoneda: texto(f['valor_moneda']),
    valorEntero: entero(f['valor_entero']),
    unidad: texto(f['unidad']),
    fuente,
    estadoSemaforo,
    nota: texto(f['nota']),
  }
}

/** Simbolo del semaforo, para poder enseñar el estado junto al valor. */
export function simboloSemaforo(estado: string): string {
  switch (estado) {
    case 'verde':
      return '🟢'
    case 'amarillo':
      return '🟡'
    case 'rojo':
      return '🔴'
    case 'azul':
      return '🔵'
    case 'negro':
      return '⚫'
    default:
      return '❔'
  }
}

/**
 * ¿Este parametro esta CONFIRMADO? Solo 🟢 verde.
 *
 * Es la unica respuesta que permite presentar la cifra como un hecho. Un
 * 🟡 o un 🔵 pueden proponerse, pero llevando su simbolo y su aviso al lado;
 * un 🔴 o un ⚫ no se usan para nada.
 */
export function estaConfirmado(p: Parametro | null): boolean {
  return p !== null && p.estadoSemaforo === 'verde'
}

/**
 * ¿Se puede PROPONER este valor en un formulario?
 *
 * Rojo y negro, nunca: rojo es «sin resolver» y negro es «reemplazado».
 * Amarillo y azul si, porque son un indicio o una propuesta con procedencia —
 * pero quien los muestre tiene que enseñar el simbolo y decir que no estan
 * confirmados. Y ademas tiene que haber un valor de verdad: un parametro verde
 * con la columna vacia sigue sin ser un dato.
 */
export function sePuedeProponer(p: Parametro | null): boolean {
  if (p === null) return false
  if (p.estadoSemaforo === 'rojo' || p.estadoSemaforo === 'negro') return false
  return p.valorTexto !== null || p.valorNumerico !== null || p.valorEntero !== null
}

/**
 * El valor de texto, o `PENDIENTE`. Nunca devuelve cadena vacia ni «—»:
 * un hueco silencioso se lee como «no aplica», y aqui significa «nadie lo ha
 * confirmado todavia».
 */
export function textoDeParametro(p: Parametro | null): string {
  if (!sePuedeProponer(p) || p === null) return PENDIENTE
  return p.valorTexto ?? PENDIENTE
}

/** El monto propuesto, o `null` si no se puede proponer. */
export function numeroDeParametro(p: Parametro | null): number | string | null {
  if (!sePuedeProponer(p) || p === null) return null
  return p.valorNumerico
}

/** El entero (plazos, cupos), o `null` si no se puede proponer. */
export function enteroDeParametro(p: Parametro | null): number | null {
  if (!sePuedeProponer(p) || p === null) return null
  return p.valorEntero
}

function mensajeDeError(mensaje: string): string {
  if (mensaje.includes('row-level security') || mensaje.includes('violates row-level')) {
    return 'Tu rol no puede leer los parámetros (política parametros_leer de RLS). Habla con Walter.'
  }
  if (mensaje.includes('JWT') || mensaje.includes('sesión activa')) {
    return 'Se cerró tu sesión. Vuelve a entrar al CRM.'
  }
  return mensaje
}

/**
 * Todos los parametros. Politica que lo permite: `parametros_leer`
 * (02-rls.sql) — todos leen, solo direccion escribe. Un vendedor que pudiera
 * editar el precio haria inutil toda la regla de la fuente de verdad.
 */
export async function cargarParametros(): Promise<Lote<Parametro>> {
  const { data, error } = await supabase
    .from('parametros')
    .select(COLUMNAS)
    .order('id', { ascending: true })

  if (error !== null) throw new Error(mensajeDeError(error.message))
  return leerLote(data, interpretarParametro)
}

/**
 * Solo los parametros pedidos, por id.
 *
 * Devuelve un mapa para que quien lo use tenga que preguntar por cada uno y
 * enfrentarse al `null`, en vez de recibir una lista donde es facil no darse
 * cuenta de que falta el que importa.
 */
export async function cargarParametrosPorId(
  ids: readonly string[],
): Promise<Record<string, Parametro | null>> {
  const { data, error } = await supabase.from('parametros').select(COLUMNAS).in('id', [...ids])

  if (error !== null) throw new Error(mensajeDeError(error.message))

  const lote = leerLote(data, interpretarParametro)
  const mapa: Record<string, Parametro | null> = {}
  for (const id of ids) {
    mapa[id] = lote.filas.find((p) => p.id === id) ?? null
  }
  return mapa
}
