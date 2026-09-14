import type { ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Badge } from '@/componentes/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import { cn } from '@/lib/utils'

/**
 * El contenedor de cada uno de los bloques de la pantalla Hoy.
 *
 * Existe para que los cuatro (cinco con Direccion) se vean y se comporten
 * igual: mismo sitio para el titulo, mismo sitio para el conteo, mismo trato
 * al cargar, al fallar y al estar vacio. Si cada bloque se maquetara por su
 * cuenta, el orden de urgencia se leeria peor.
 *
 * ---------------------------------------------------------------------------
 * LOS TRES TONOS Y DE DONDE SALEN
 * ---------------------------------------------------------------------------
 *  · `alerta` — rojo. UNICO uso legitimo del rojo en toda la interfaz: el
 *    bloque de separaciones cuyo plazo se acaba. Ver el bloque largo de
 *    src/index.css: el rojo es 🔵 PROPUESTA, no esta en el manual de marca y
 *    NO se usa para estado de pago.
 *  · `azul` — Azul Noche con el conteo en ambar. Es el unico sitio de esta
 *    pantalla donde aparece el ambar, y va sobre azul, como manda la regla
 *    dura de marca (sobre cal daria 1.79:1 e incumpliria WCAG).
 *  · `neutro` — tarjeta blanca sobre el lienzo cal. Lo que no es urgente no
 *    se pinta de urgente.
 */
export type TonoBloque = 'alerta' | 'azul' | 'neutro'

type Props = {
  titulo: string
  /** Una linea que explique por que este bloque existe. */
  descripcion: string
  tono: TonoBloque
  /** `null` mientras se esta cargando: entonces no se muestra conteo. */
  conteo: number | null
  cargando: boolean
  error: string | null
  /** Que decir cuando el bloque esta vacio. Vacio suele ser una buena noticia. */
  vacio: string
  /** Filas descartadas por ilegibles. Se avisa; no se esconden. */
  descartadas?: number
  children: ReactNode
}

export function BloqueHoy({
  titulo,
  descripcion,
  tono,
  conteo,
  cargando,
  error,
  vacio,
  descartadas = 0,
  children,
}: Props) {
  const esAlerta = tono === 'alerta'
  const esAzul = tono === 'azul'

  return (
    <Card
      className={cn(
        'overflow-hidden shadow-sm',
        esAlerta && 'border-alerta',
        esAzul && 'border-azul',
      )}
    >
      <CardHeader
        className={cn(
          'flex-row items-start justify-between gap-4 space-y-0 px-4 py-4 sm:px-6',
          esAlerta && 'bg-alerta text-alerta-foreground',
          esAzul && 'bg-azul text-cal',
          tono === 'neutro' && 'border-b border-cal-200',
        )}
      >
        <div className="min-w-0">
          <CardTitle
            className={cn(
              'text-base leading-tight',
              (esAlerta || esAzul) && 'text-inherit',
            )}
          >
            {titulo}
          </CardTitle>
          <p
            className={cn(
              'mt-1 text-xs leading-snug',
              esAlerta && 'text-alerta-foreground/85',
              esAzul && 'text-azul-300',
              tono === 'neutro' && 'text-suelo-500',
            )}
          >
            {descripcion}
          </p>
        </div>

        {/* El conteo, siempre visible y siempre en el mismo sitio. */}
        {conteo !== null && (
          <Badge
            className={cn(
              'shrink-0 px-2.5 py-1 text-sm font-black tabular-nums',
              esAlerta && 'border-transparent bg-alerta-foreground text-alerta hover:bg-alerta-foreground',
              // Ambar sobre azul: permitido, 7.33:1 con el Negro Suelo encima.
              esAzul && 'border-transparent bg-ambar text-suelo hover:bg-ambar',
              tono === 'neutro' && 'border-transparent bg-secondary text-secondary-foreground',
            )}
          >
            {conteo}
          </Badge>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {cargando && (
          <p className="flex items-center gap-2 px-4 py-5 sm:px-6 text-sm text-suelo-500">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
            Cargando…
          </p>
        )}

        {!cargando && error !== null && (
          <p
            role="alert"
            className="flex items-start gap-2 px-4 py-5 sm:px-6 text-sm font-bold text-alerta"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {error}
          </p>
        )}

        {!cargando && error === null && conteo === 0 && (
          <p className="px-4 py-5 sm:px-6 text-sm text-suelo-500">{vacio}</p>
        )}

        {!cargando && error === null && conteo !== null && conteo > 0 && (
          <ul className="divide-y divide-cal-200">{children}</ul>
        )}

        {descartadas > 0 && (
          <p className="border-t border-cal-200 px-4 py-2 sm:px-6 text-xs font-bold text-alerta">
            🔴 {descartadas}{' '}
            {descartadas === 1 ? 'fila no se pudo leer' : 'filas no se pudieron leer'} y no se
            están mostrando. Revisa el esquema antes de fiarte de este conteo.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** Una fila de bloque: datos a la izquierda, acciones a la derecha. */
export function FilaHoy({
  principal,
  secundario,
  acciones,
}: {
  principal: ReactNode
  secundario: ReactNode
  acciones: ReactNode
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-foreground">{principal}</p>
        <div className="mt-0.5 text-xs text-suelo-700">{secundario}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">{acciones}</div>
    </li>
  )
}
