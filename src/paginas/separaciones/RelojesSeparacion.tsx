import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import { cn } from '@/lib/utils'

/**
 * Los dos relojes de la separación, como piezas de interfaz.
 *
 * ===========================================================================
 * POR QUE ESTO ES UN ARCHIVO APARTE
 * ===========================================================================
 * Porque los dos relojes aparecen en tres sitios —el formulario, la ficha y la
 * constancia— y la unica forma de garantizar que en los tres se vean IGUAL de
 * separados es que salgan del mismo componente.
 *
 * La regla R4 dice que son campos distintos que nunca se calculan uno del otro.
 * Traducida a pantalla, significa tres cosas que este archivo hace cumplir:
 *
 *   1 · Dos tarjetas. Nunca una fila con dos fechas, nunca una tabla con las
 *       dos: dos superficies separadas, cada una con su numero y su nombre.
 *   2 · Cada tarjeta dice QUIEN escribe su fecha — la base o la persona. Ahi
 *       se ve, sin leer documentacion, que no salen del mismo sitio.
 *   3 · El aviso de abajo, visible siempre, con el texto exacto del encargo.
 *
 * Lo que NO existe en este archivo: ninguna resta, ninguna suma de dias, y
 * ninguna funcion que reciba los dos plazos a la vez.
 */

/** El texto de ayuda, literal. Va visible, no escondido en un tooltip. */
export const AVISO_DOS_RELOJES = 'Son dos plazos distintos. No se calculan uno del otro.'

export function AvisoDosRelojes({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-md border border-azul bg-azul px-3 py-2',
        'text-xs font-bold leading-snug text-cal',
        className,
      )}
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
      {AVISO_DOS_RELOJES}
    </p>
  )
}

/**
 * Una tarjeta de reloj. Se usa dos veces, nunca una sola.
 *
 * `quienLoEscribe` no es decoración: es la diferencia entre los dos relojes.
 * El 1 lo calcula `fn_calcular_limite_devolucion` en la base a partir del
 * depósito efectivo; el 2 lo teclea una persona. Si algún día alguien intenta
 * «rellenar el 2 automáticamente», este texto es lo que se lo va a impedir.
 */
export function TarjetaReloj({
  numero,
  titulo,
  desdeQue,
  quienLoEscribe,
  children,
}: {
  numero: 1 | 2
  titulo: string
  desdeQue: string
  quienLoEscribe: string
  children: ReactNode
}) {
  return (
    <Card className="border-cal-300 shadow-sm">
      <CardHeader className="space-y-1 pb-3">
        <p className="text-xs font-black uppercase tracking-wide text-suelo-500">
          Reloj {numero}
        </p>
        <CardTitle className="text-base leading-tight">{titulo}</CardTitle>
        <p className="text-xs leading-snug text-suelo-700">{desdeQue}</p>
        <p className="text-xs leading-snug text-suelo-500">{quienLoEscribe}</p>
      </CardHeader>
      <CardContent className="space-y-2 pb-4">{children}</CardContent>
    </Card>
  )
}

/**
 * El valor de un reloj ya resuelto: la fecha límite y los días que faltan.
 *
 * Recibe UN plazo. No hay ninguna versión de esto que reciba los dos.
 * `dias` viene calculado por la vista (`fecha_limite - current_date`), no se
 * recalcula aquí — así el número de la ficha y el de la bandeja son el mismo.
 */
export function ValorReloj({
  fechaLimite,
  dias,
  textoSinFecha,
}: {
  fechaLimite: string | null
  dias: number | null
  /** Qué decir cuando este reloj todavía no ha empezado a correr. */
  textoSinFecha: string
}) {
  if (fechaLimite === null) {
    return <p className="text-sm font-bold text-suelo-700">{textoSinFecha}</p>
  }

  return (
    <>
      <p className="text-sm font-black tabular-nums text-foreground">
        {formatearFechaSuelta(fechaLimite)}
      </p>
      <p className={cn('text-xs', dias !== null && dias <= 0 ? 'font-black text-alerta' : 'font-bold text-suelo-700')}>
        {textoDias(dias)}
      </p>
    </>
  )
}

/**
 * Una fecha `date` de Postgres llega como «2026-09-14» y NO es un instante: es
 * un día de calendario. Pasarla por `new Date()` la interpreta en UTC y en Perú
 * (UTC-5) puede mostrarse el día anterior — en un plazo legal, un día de menos.
 * Por eso se parte el texto en vez de construir una fecha.
 */
function formatearFechaSuelta(iso: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (partes === null) return iso
  return `${partes[3]}/${partes[2]}/${partes[1]}`
}

function textoDias(dias: number | null): string {
  if (dias === null) return 'sin días calculados'
  if (dias === 0) return 'vence hoy'
  if (dias === 1) return 'queda 1 día'
  if (dias > 1) return `quedan ${dias} días`
  if (dias === -1) return 'venció ayer'
  return `venció hace ${Math.abs(dias)} días`
}
