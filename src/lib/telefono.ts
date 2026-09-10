/**
 * Normalizacion de telefonos a E.164, en un solo lugar.
 *
 * Por que existe: `personas.telefono_e164` tiene un indice y es la clave con la
 * que se busca un duplicado antes de crear a alguien. Si el mismo numero se
 * guarda como "999 888 777", "+51999888777" y "051999888777", la busqueda de
 * duplicados no encuentra nada y se crea el registro repetido — que es
 * exactamente como se pierde el historial y el origen del lead.
 *
 * Fuentes de las reglas de este archivo:
 *  - `01-schema.sql` · `personas.telefono_e164` — comentario: "+51999888777.
 *    Un formato, siempre".
 *  - `01-schema.sql` · `personas.pais default 'Perú'` — por eso el prefijo que
 *    se asume cuando el numero viene sin codigo de pais es +51, y solo ese.
 *
 * Lo que este archivo NO hace: adivinar. Un numero que no encaja en ninguno de
 * los patrones documentados se RECHAZA con un motivo legible, en vez de
 * completarse "como se pueda". Un telefono mal inventado es peor que un campo
 * vacio: el vacio se ve, el inventado no.
 */

/** Codigo de pais por defecto. Unico, y justificado por `personas.pais`. */
const PREFIJO_PERU = '+51'

export type ResultadoTelefono =
  | { ok: true; e164: string }
  | { ok: false; motivo: string }

/**
 * Lleva lo que el usuario escribio a E.164 (+ seguido de 8 a 15 digitos).
 *
 * Patrones aceptados:
 *   +51999888777    ya en E.164, cualquier pais  → se conserva
 *   0051999888777   prefijo internacional 00     → +51999888777
 *   999888777       celular peruano (9 digitos, empieza en 9) → +51999888777
 *   014567890       fijo peruano nacional (9 digitos, empieza en 0) → +514567890
 *   51999888777     11 digitos que ya empiezan en 51 → +51999888777
 *
 * Cualquier otra cosa devuelve `ok: false` con el motivo.
 */
export function normalizarTelefono(entrada: string): ResultadoTelefono {
  const bruto = entrada.trim()

  if (bruto === '') {
    return { ok: false, motivo: 'El teléfono es obligatorio.' }
  }

  // Se conserva solo un eventual "+" inicial y los digitos. Espacios, guiones,
  // parentesis y puntos son decoracion de quien escribe, no dato.
  const tieneMas = bruto.startsWith('+')
  const digitos = bruto.replace(/\D/g, '')

  if (digitos === '') {
    return { ok: false, motivo: 'El teléfono no contiene ningún número.' }
  }

  const candidato = tieneMas
    ? `+${digitos}`
    : digitos.startsWith('00')
      ? `+${digitos.slice(2)}`
      : deNumeroPeruano(digitos)

  if (candidato === null) {
    return {
      ok: false,
      motivo:
        'No se reconoce el formato. Escríbelo como celular peruano (9 dígitos: 999888777) ' +
        'o en formato internacional completo (+51999888777).',
    }
  }

  // E.164: "+" y entre 8 y 15 digitos. El minimo de la norma es 1, pero un
  // numero marcable de verdad no baja de 8; por debajo casi siempre es un dato
  // incompleto, y guardarlo solo sirve para romper la busqueda de duplicados.
  if (!/^\+\d{8,15}$/.test(candidato)) {
    return {
      ok: false,
      motivo: `«${bruto}» no es un teléfono completo (deben ser entre 8 y 15 dígitos con el código de país).`,
    }
  }

  return { ok: true, e164: candidato }
}

/**
 * Numeros escritos como se marcan dentro de Perú.
 * Devuelve `null` si no encaja en un patron documentado — nunca "se aproxima".
 */
function deNumeroPeruano(digitos: string): string | null {
  // Celular: 9 digitos que empiezan en 9.
  if (digitos.length === 9 && digitos.startsWith('9')) {
    return `${PREFIJO_PERU}${digitos}`
  }

  // Fijo marcado en nacional: 9 digitos con el "0" de larga distancia delante
  // (01 + 7 de Lima, o 0 + codigo de area + 6). El 0 no forma parte del numero
  // internacional, por eso se descarta.
  if (digitos.length === 9 && digitos.startsWith('0')) {
    return `${PREFIJO_PERU}${digitos.slice(1)}`
  }

  // Ya trae el codigo de pais pero sin el "+".
  if (digitos.length === 11 && digitos.startsWith('51')) {
    return `+${digitos}`
  }

  return null
}

/**
 * Para mostrar: "+51 999 888 777". Solo agrupa; no cambia el dato.
 * Si no es un numero peruano de 9 digitos se devuelve tal cual, sin inventar
 * una agrupacion que no corresponde a ese plan de numeracion.
 */
export function formatearTelefono(e164: string | null | undefined): string {
  if (e164 === null || e164 === undefined || e164 === '') return '—'

  const peruano = /^\+51(\d{9})$/.exec(e164)
  if (peruano !== null) {
    const n = peruano[1]
    if (n !== undefined) {
      return `+51 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`
    }
  }
  return e164
}
