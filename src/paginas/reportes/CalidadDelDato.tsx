import { useQuery } from '@tanstack/react-query'
import { Card as TarjetaTremor, Metric } from '@tremor/react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { INDICADORES_CALIDAD, cargarCalidadDelDato } from '@/lib/reportes'

/**
 * CALIDAD DEL DATO — arriba del todo, y no es decoración.
 *
 * Va antes que el embudo y antes que las tasas porque, como dice el comentario
 * de `v_calidad_del_dato` en 03-vistas.sql, «un CRM miente en silencio». Si
 * estos ocho contadores son altos, todos los demás gráficos de esta pantalla
 * están calculados sobre datos incompletos — y eso hay que verlo ANTES de leer
 * un porcentaje, no después.
 *
 * No hay umbral de «bueno» ni de «malo», y es a propósito: nadie ha definido
 * cuántas personas sin teléfono son demasiadas. Pintar de un color el 12 y de
 * otro el 3 sería inventar ese umbral. Lo que se hace es lo contrario: un cero
 * se apaga y cualquier cifra distinta de cero se enseña en negrita, porque
 * cada una es un caso concreto que alguien tiene que resolver.
 */
export function CalidadDelDato() {
  const consulta = useQuery({
    queryKey: ['reportes', 'calidad'],
    queryFn: cargarCalidadDelDato,
  })

  const calidad = consulta.data ?? null

  return (
    <section aria-labelledby="titulo-calidad">
      <h2 id="titulo-calidad" className="text-lg font-black tracking-tight text-foreground">
        Calidad del dato
      </h2>
      <p className="mb-3 mt-1 text-sm leading-snug text-suelo-700">
        Lo que falta por rellenar. Si estas cifras son altas, todo lo de más abajo está calculado
        sobre datos incompletos. Sale de <code>v_calidad_del_dato</code>.
      </p>

      {consulta.isPending && (
        <p className="flex items-center gap-2 py-6 text-sm text-suelo-500">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
          Contando…
        </p>
      )}

      {consulta.error !== null && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-alerta bg-alerta-suave p-3 text-sm font-bold leading-snug text-alerta"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {consulta.error.message}
        </p>
      )}

      {calidad === null && !consulta.isPending && consulta.error === null && (
        <p className="rounded-md border border-cal-300 bg-card p-3 text-sm leading-snug text-suelo-700">
          La vista no devolvió ninguna fila. No se enseña un cero en su lugar: «no hay respuesta»
          y «no hay incidencias» no son lo mismo.
        </p>
      )}

      {calidad !== null && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {INDICADORES_CALIDAD.map((i) => {
            const valor = calidad[i.clave] ?? 0
            return (
              <TarjetaTremor key={i.clave} className="p-4 shadow-sm ring-cal-300">
                <p className="text-xs font-bold leading-snug text-suelo-700">{i.titulo}</p>
                <Metric
                  className={cn(
                    'mt-1 text-2xl tabular-nums',
                    valor === 0 ? 'font-normal text-suelo-500' : 'font-black text-foreground',
                  )}
                >
                  {valor}
                </Metric>
                <p className="mt-1 text-xs leading-snug text-suelo-500">{i.porQue}</p>
              </TarjetaTremor>
            )
          })}
        </div>
      )}
    </section>
  )
}
