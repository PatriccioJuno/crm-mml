import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { exigeCualificacion, type EstadoEmbudo } from '@/lib/embudo'

/**
 * Una de las 10 columnas del tablero.
 *
 * Es la zona en la que se suelta. El resaltado al pasar por encima no es
 * adorno: sin el, arrastrar a ciegas entre diez columnas estrechas acaba
 * soltando la tarjeta en la de al lado — y aqui soltar en la de al lado
 * significa cambiar el estado de una oportunidad y dejarlo escrito en
 * `estado_historial` con tu nombre (R9).
 */
export function ColumnaEmbudo({
  estado,
  etiqueta,
  corta,
  conteo,
  sobre,
  alEntrar,
  alSalir,
  alSoltar,
  children,
}: {
  estado: EstadoEmbudo
  etiqueta: string
  corta: string
  conteo: number
  /** Se esta arrastrando algo encima de esta columna. */
  sobre: boolean
  alEntrar: () => void
  alSalir: () => void
  alSoltar: (id: string) => void
  children: ReactNode
}) {
  return (
    <section
      aria-label={etiqueta}
      onDragOver={(evento) => {
        // Sin este preventDefault el navegador no permite soltar. No es
        // opcional: es como se declara «aqui se puede soltar».
        evento.preventDefault()
        evento.dataTransfer.dropEffect = 'move'
      }}
      onDragEnter={alEntrar}
      onDragLeave={(evento) => {
        // Al pasar por encima de una tarjeta hija salta un dragleave de la
        // columna. Solo cuenta si el puntero salio de verdad del contenedor.
        const destino = evento.relatedTarget
        if (destino instanceof Node && evento.currentTarget.contains(destino)) return
        alSalir()
      }}
      onDrop={(evento) => {
        evento.preventDefault()
        alSalir()
        const id = evento.dataTransfer.getData('text/plain')
        if (id !== '') alSoltar(id)
      }}
      className={cn(
        'flex w-64 shrink-0 flex-col rounded-lg border transition-colors',
        sobre ? 'border-azul bg-cal-200' : 'border-border bg-cal',
      )}
    >
      <header className="flex items-center justify-between gap-2 rounded-t-lg bg-azul px-3 py-2">
        <h2 className="min-w-0 truncate text-xs font-bold uppercase tracking-wide text-cal">
          {corta}
        </h2>
        <span className="shrink-0 rounded bg-azul-600 px-1.5 py-0.5 text-xs font-black tabular-nums text-cal">
          {conteo}
        </span>
      </header>

      {/* Recordatorio de R5 en la cabecera de las columnas que la exigen: el
          06 y todas las posteriores. Sale de `exigeCualificacion`, que lee la
          misma comparacion que la restriccion de la base. */}
      {exigeCualificacion(estado) && (
        <p className="border-b border-border px-3 py-1 text-[0.7rem] leading-snug text-suelo-500">
          Exige las 4 respuestas (R5)
        </p>
      )}

      <ul className="flex min-h-24 flex-1 flex-col gap-2 p-2">{children}</ul>
    </section>
  )
}
