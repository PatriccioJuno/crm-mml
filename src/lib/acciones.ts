import { supabase } from '@/lib/supabase'

/**
 * El contrato comun de toda ACCION que escribe en la base desde el CRM.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE ESTE ARCHIVO
 * ---------------------------------------------------------------------------
 * Hasta el 29/09/2026 cada modulo (registro-rapido, embudo, parametros,
 * separaciones) declaraba su propio `{ ok: true } | { ok: false; motivo }` y su
 * propio `mensajeDeError`. Con 13-seguimiento-comercial.sql llegan una docena de
 * funciones nuevas (contacto, perfil, visitas, bandeja, lote…) y repetir eso
 * doce veces era garantizar que dos pantallas tradujeran el mismo error de dos
 * formas distintas. Aqui hay UNA forma.
 *
 * Los modulos viejos no se tocan: siguen funcionando con su tipo propio, que es
 * estructuralmente el mismo.
 *
 * Este archivo no contiene ninguna cifra ni ninguna regla de negocio.
 */

/** Resultado de una accion: o salio, con sus datos, o no, con el motivo en español. */
export type ResultadoAccion<T> = { ok: true; datos: T } | { ok: false; motivo: string }

/**
 * Traduce SOLO las causas conocidas. Todo lo demas pasa tal cual: un mensaje
 * de la base es mas util que un «algo salio mal» inventado.
 *
 * Los `raise exception` de las funciones de 13-seguimiento-comercial.sql ya
 * vienen redactados en español para el vendedor, asi que pasan sin cambios.
 */
export function mensajeDeError(mensaje: string): string {
  const m = mensaje.toLowerCase()

  if (m.includes('could not find the function') || m.includes('schema cache')) {
    return 'La base todavía no tiene esta función. Hay que ejecutar sql/13-seguimiento-comercial.sql en Supabase.'
  }
  if (m.includes('row-level security') || m.includes('permission denied')) {
    return 'Tu rol no tiene permiso para hacer esto (lo decide la seguridad de la base, no la pantalla).'
  }
  if (m.includes('jwt') || m.includes('not authenticated')) {
    return 'Tu sesión venció. Vuelve a entrar al CRM.'
  }
  if (m.includes('calificado_requiere_las_4_respuestas')) {
    return 'No puede pasar a Calificado sin las 4 respuestas de cualificación (R5). Complétalas en el perfil.'
  }
  if (m.includes('unidad_una_sola_asignacion_activa')) {
    return 'Esa unidad ya está asignada a otra oportunidad activa (R1).'
  }
  if (m.includes('visitas_una_abierta_por_oportunidad')) {
    return 'Esta oportunidad ya tiene una visita agendada. Reprográmala en lugar de crear otra.'
  }
  if (m.includes('capital_con_moneda')) {
    return 'El capital necesita su moneda al lado (R7).'
  }
  if (m.includes('violates check constraint')) {
    return 'Uno de los valores no es válido para la base. Revisa lo que elegiste.'
  }
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('network request failed')) {
    return 'Sin conexión con la base. Revisa el internet y vuelve a intentarlo.'
  }
  return mensaje
}

/**
 * Llama a una funcion de la base que devuelve `jsonb` y la interpreta.
 *
 * `interpretar` recibe lo que llego (sin suponer nada) y devuelve los datos o
 * `null` si la respuesta no tiene la forma esperada. Una respuesta ilegible NO
 * se da por buena: se informa como fallo, porque pintar «guardado» sobre algo
 * que no se pudo comprobar es justo lo que este CRM no hace.
 *
 * Las funciones de 13 devuelven `{ ok: false, motivo }` para los rechazos de
 * negocio esperables (p. ej. «ya la tomó otra persona»), y lanzan excepcion
 * para los errores de validacion. Las dos cosas acaban aqui como `ok: false`.
 */
export async function llamarRpc<T>(
  nombre: string,
  argumentos: Record<string, unknown>,
  interpretar: (respuesta: unknown) => T | null,
): Promise<ResultadoAccion<T>> {
  const { data, error } = await supabase.rpc(nombre, argumentos)
  if (error !== null) return { ok: false, motivo: mensajeDeError(error.message) }

  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const r = data as Record<string, unknown>
    if (r['ok'] === false) {
      const motivo = typeof r['motivo'] === 'string' ? r['motivo'] : 'La base rechazó la operación.'
      return { ok: false, motivo }
    }
  }

  const datos = interpretar(data)
  if (datos === null) {
    return { ok: false, motivo: `La base respondió algo que no se pudo leer (${nombre}).` }
  }
  return { ok: true, datos }
}

/** Lee un objeto jsonb como registro, o `null`. */
export function comoRegistro(valor: unknown): Record<string, unknown> | null {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null
}

/** Lee un arreglo de textos (p. ej. `avisos` de una respuesta), descartando lo que no sea texto. */
export function comoTextos(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === 'string') : []
}
