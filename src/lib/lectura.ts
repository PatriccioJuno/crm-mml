/**
 * Lectura de frontera: lo que llega de la base se COMPRUEBA, no se supone.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE ESTE ARCHIVO
 * ---------------------------------------------------------------------------
 * `src/lib/tipos.ts` sigue vacio: los tipos generados desde la base todavia no
 * existen (README, seccion Tipos). Mientras tanto NO se escriben tipos del
 * esquema a mano y se dan por buenos — se sigue el patron que abrio
 * src/auth/tipos-sesion.ts: cada fila que llega pasa por un lector que la
 * comprueba y devuelve `null` si no cumple. Una fila rara se descarta y se
 * CUENTA; nunca se pinta un dato que no se pudo verificar, y nunca se muestra
 * un conteo que se calle lo que falta.
 *
 * Estas cuatro utilidades vivian repetidas dentro de src/lib/hoy.ts. Al
 * escribir el embudo y el inventario habria hecho falta una tercera y una
 * cuarta copia — y tres copias de «como se lee un numero de Postgres» son tres
 * criterios distintos esperando a divergir. Aqui hay uno.
 *
 * Cuando `npm run tipos` funcione, los tipos pasan a derivarse de `Database` y
 * esto se queda solo como validacion de frontera, que es lo que ya es.
 *
 * Este archivo no contiene ninguna cifra ni ninguna regla de negocio.
 */

/** Cadena, o `null` si no lo es. */
export function texto(valor: unknown): string | null {
  return typeof valor === 'string' ? valor : null
}

/** Numero finito, o `null`. Un `NaN` o un `Infinity` no son un dato. */
export function entero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null
}

/**
 * Booleano ESTRICTO. Cualquier otra cosa vuelve `null`, no `false`:
 * «no lo se» y «no» no son lo mismo, y confundirlos en una pantalla que decide
 * si una unidad se puede ofrecer seria justo el hueco rellenado que prohibe
 * 07-crm/CLAUDE.md §3.
 */
export function booleano(valor: unknown): boolean | null {
  return typeof valor === 'boolean' ? valor : null
}

/**
 * Un `numeric` de Postgres llega por PostgREST como CADENA, no como numero
 * (lo hace a proposito: un `numeric(14,2)` no cabe siempre en un `number` de
 * JavaScript sin perder precision). Por eso los montos se conservan tal cual
 * llegan y se le pasan a `formatearMonto`, que ya acepta las dos formas. No se
 * convierten a `number` aqui: redondear dinero de camino a la pantalla es
 * justo lo que no se debe hacer.
 */
export function monto(valor: unknown): number | string | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor
  if (typeof valor === 'string' && valor.trim() !== '') return valor
  return null
}

/** Resultado de una consulta: filas leidas + filas descartadas por ilegibles. */
export type Lote<T> = { filas: T[]; descartadas: number }

export function leerLote<T>(datos: unknown, leer: (fila: unknown) => T | null): Lote<T> {
  if (!Array.isArray(datos)) return { filas: [], descartadas: 0 }

  const filas: T[] = []
  let descartadas = 0
  for (const cruda of datos) {
    const fila = leer(cruda)
    if (fila === null) descartadas += 1
    else filas.push(fila)
  }
  return { filas, descartadas }
}

/** Los errores de la base se propagan con su texto, sin adornos. */
export function reventar(contexto: string, error: { message: string } | null): void {
  if (error !== null) {
    throw new Error(`${contexto}: ${error.message}`)
  }
}
