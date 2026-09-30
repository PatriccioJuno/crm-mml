import { differenceInCalendarDays, format, formatDistanceToNowStrict, isValid } from 'date-fns'
import { es } from 'date-fns/locale'

/**
 * Formateo y aritmetica de fechas, en español, en un solo lugar.
 *
 * Por que centralizarlo: el CRM tiene DOS plazos de 7 dias que son relojes
 * independientes (regla R4 de 07-crm/CLAUDE.md) — el derecho de devolucion
 * desde el deposito efectivo, y la vigencia post-evento del precio. Si cada
 * pantalla calcula "vence en N dias" a su manera, tarde o temprano una de las
 * dos usa el reloj de la otra. Aqui hay UNA funcion, y recibe la fecha de
 * vencimiento ya resuelta: este modulo NUNCA deriva un plazo del otro.
 *
 * Este archivo no contiene ninguna cifra de negocio (ni duracion de plazos, ni
 * montos): solo formatea lo que recibe.
 */

/** Convierte a Date lo que venga de la base (ISO string, Date o null). */
function aFecha(valor: Date | string | null | undefined): Date | null {
  if (valor === null || valor === undefined) return null
  const fecha = typeof valor === 'string' ? new Date(valor) : valor
  return isValid(fecha) ? fecha : null
}

/** "14 de septiembre de 2026" */
export function fechaLarga(valor: Date | string | null | undefined): string {
  const fecha = aFecha(valor)
  return fecha ? format(fecha, "d 'de' MMMM 'de' yyyy", { locale: es }) : '—'
}

/** "14/09/2026" — para tablas densas. */
export function fechaCorta(valor: Date | string | null | undefined): string {
  const fecha = aFecha(valor)
  return fecha ? format(fecha, 'dd/MM/yyyy', { locale: es }) : '—'
}

/** "14/09/2026 15:42" — para el historial y la trazabilidad (regla R9). */
export function fechaHora(valor: Date | string | null | undefined): string {
  const fecha = aFecha(valor)
  return fecha ? format(fecha, 'dd/MM/yyyy HH:mm', { locale: es }) : '—'
}

/** "hace 3 dias" / "en 2 meses" */
export function fechaRelativa(valor: Date | string | null | undefined): string {
  const fecha = aFecha(valor)
  return fecha ? formatDistanceToNowStrict(fecha, { locale: es, addSuffix: true }) : '—'
}

/**
 * Dias de calendario que faltan hasta `vencimiento`.
 * Negativo = ya vencio. Cero = vence hoy. null = sin fecha.
 *
 * Se usa dias de CALENDARIO, no horas: "vence en 1 dia" debe significar
 * "manana", no "en 24 horas".
 */
export function diasHasta(
  vencimiento: Date | string | null | undefined,
  referencia: Date = new Date(),
): number | null {
  const fecha = aFecha(vencimiento)
  return fecha ? differenceInCalendarDays(fecha, referencia) : null
}

/**
 * Texto de vencimiento, ya redactado: "vence en 3 dias", "vence hoy",
 * "vencio hace 5 dias".
 *
 * Devuelve solo texto. El color y el peso tipografico los decide la pantalla,
 * y el brief de diseño prohibe usar rojo/verde para el estado de pago: se
 * comunica con texto, icono y peso (Black para vencido, Regular para al dia).
 */
export function textoVencimiento(vencimiento: Date | string | null | undefined): string {
  const dias = diasHasta(vencimiento)
  if (dias === null) return 'sin fecha'
  if (dias === 0) return 'vence hoy'
  if (dias === 1) return 'vence mañana'
  if (dias > 1) return `vence en ${dias} días`
  if (dias === -1) return 'venció ayer'
  return `venció hace ${Math.abs(dias)} días`
}

/** "mié 30/09 · 19:30" — para visitas y próximas tareas, donde importa el día de la semana. */
export function diaYHora(valor: Date | string | null | undefined): string {
  const fecha = aFecha(valor)
  return fecha ? format(fecha, "EEE dd/MM '·' HH:mm", { locale: es }) : '—'
}

/**
 * Fecha → valor de un `<input type="datetime-local">` ("2026-09-30T19:30"), en
 * la hora del dispositivo. Vivia en linea dentro de hoy/AccionesFila.tsx; se
 * saco aqui el 29/09/2026 porque la agenda de visitas y el panel de contacto
 * necesitan la misma conversion, y dos copias de «como se lee la hora local»
 * son dos formas de equivocarse de hora.
 */
export function aEntradaLocal(valor: Date | string | null | undefined): string {
  const fecha = aFecha(valor)
  if (fecha === null) return ''
  const local = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

/**
 * Valor de un `<input type="datetime-local">` → ISO 8601 con zona (lo que
 * espera un `timestamptz`). `null` si esta vacio o no es una fecha.
 */
export function deEntradaLocal(entrada: string): string | null {
  if (entrada.trim() === '') return null
  const fecha = new Date(entrada)
  return isValid(fecha) ? fecha.toISOString() : null
}

/** `base` + `dias` dias de calendario, conservando la hora. No redondea ni recorta. */
export function sumarDias(base: Date, dias: number): Date {
  const resultado = new Date(base.getTime())
  resultado.setDate(resultado.getDate() + dias)
  return resultado
}
