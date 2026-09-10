/**
 * Dinero: formateo y sumas seguras.
 *
 * Regla R7 de 07-crm/CLAUDE.md: "Todo campo de dinero lleva su moneda al lado.
 * Nunca un número suelto". Y `01-schema.sql`: "nunca se suman dos monedas sin
 * pasar por `tipo_cambio`" — porque la moneda de control del negocio sigue
 * [PENDIENTE] en 00-fuente-de-verdad\moneda-de-comunicacion.md.
 *
 * Por eso aqui no hay ninguna funcion que devuelva un numero pelado, y la suma
 * devuelve `null` en cuanto detecta dos monedas distintas: prefiere no dar un
 * total a dar uno falso.
 *
 * Este archivo no contiene ninguna cifra del negocio. Solo formatea.
 */

/** Enum `moneda` de 01-schema.sql. */
export const MONEDAS = ['PEN', 'USD'] as const
export type Moneda = (typeof MONEDAS)[number]

/** Simbolos de uso corriente. No son datos del negocio. */
const SIMBOLO: Readonly<Record<Moneda, string>> = {
  PEN: 'S/',
  USD: 'US$',
}

export function esMoneda(valor: unknown): valor is Moneda {
  return typeof valor === 'string' && (MONEDAS as readonly string[]).includes(valor)
}

/** `numeric` de Postgres llega como string por supabase-js. */
export function aNumero(valor: number | string | null | undefined): number | null {
  if (valor === null || valor === undefined) return null
  const n = typeof valor === 'string' ? Number(valor) : valor
  return Number.isFinite(n) ? n : null
}

/**
 * "S/ 1,250.00". Si falta la moneda se dice, no se asume:
 * un monto sin moneda es un dato incompleto, no un monto en soles.
 */
export function formatearMonto(
  monto: number | string | null | undefined,
  moneda: Moneda | string | null | undefined,
): string {
  const n = aNumero(monto)
  if (n === null) return '—'

  const cifra = n.toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  if (!esMoneda(moneda)) {
    // R7: antes de mostrar un numero sin moneda, se marca el hueco.
    return `${cifra} [MONEDA PENDIENTE]`
  }

  return `${SIMBOLO[moneda]} ${cifra}`
}

export type Total = { monto: number; moneda: Moneda }

/**
 * Suma una lista de montos SOLO si todos comparten moneda.
 *
 * Devuelve:
 *   - `{ ok: true, total }`               todos en la misma moneda
 *   - `{ ok: true, total: null }`         lista vacia (nada que sumar)
 *   - `{ ok: false, monedas }`            hay mas de una moneda: no se suma
 *
 * No convierte. La conversion necesita `tipo_cambio` y una decision sobre la
 * moneda de control que todavia no existe.
 */
export function sumarMismaMoneda(
  items: readonly { monto: number | string | null; moneda: Moneda | string | null }[],
): { ok: true; total: Total | null } | { ok: false; monedas: readonly string[] } {
  const monedas = new Set<string>()
  let suma = 0
  let hubo = false

  for (const item of items) {
    const n = aNumero(item.monto)
    if (n === null) continue
    const m = item.moneda
    if (!esMoneda(m)) {
      monedas.add('[MONEDA PENDIENTE]')
      continue
    }
    monedas.add(m)
    suma += n
    hubo = true
  }

  if (monedas.size > 1) {
    return { ok: false, monedas: [...monedas].sort() }
  }
  if (!hubo) {
    return { ok: true, total: null }
  }

  const unica = [...monedas][0]
  if (!esMoneda(unica)) {
    return { ok: false, monedas: [...monedas] }
  }

  return { ok: true, total: { monto: suma, moneda: unica } }
}

/**
 * Porcentaje pagado sobre un total, para la barra de progreso.
 * `null` si falta el total, si es cero o si las monedas no coinciden: una barra
 * de progreso calculada sobre monedas distintas es una cifra inventada.
 */
export function porcentajePagado(
  pagado: Total | null,
  total: { monto: number | string | null; moneda: Moneda | string | null },
): number | null {
  const totalNumero = aNumero(total.monto)
  if (totalNumero === null || totalNumero <= 0) return null
  if (!esMoneda(total.moneda)) return null
  if (pagado === null) return 0
  if (pagado.moneda !== total.moneda) return null

  // Se permite pasar del 100 % en el calculo, pero la barra lo recorta: un
  // sobrepago existe y no debe ocultarse, aunque la barra no pueda dibujarlo.
  return (pagado.monto / totalNumero) * 100
}
