import { useQuery } from '@tanstack/react-query'
import { Card as TarjetaTremor, Metric } from '@tremor/react'
import { AlertTriangle, HelpCircle, Loader2 } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/componentes/ui/tooltip'
import { TASAS, TASAS_SIN_VISTA, cargarConversion, conteoDeTasa } from '@/lib/reportes'

/**
 * CONVERSIONES — seis tasas, y las tres que faltan dichas en voz alta.
 *
 * ===========================================================================
 * AQUI NO SE DIVIDE NADA
 * ===========================================================================
 * Los porcentajes vienen calculados y redondeados por `v_conversion`
 * (03-vistas.sql §2), con las fórmulas de
 * `D:\SCPCMO\01-comercial\embudo-y-metricas.md` §4. Este componente los pinta.
 * No hay ni una división en todo el archivo — una tasa calculada en el
 * navegador no se puede auditar contra el SQL, y en un reporte que va a leer
 * Walter eso es exactamente el problema que el CRM viene a resolver.
 *
 * ===========================================================================
 * UN NULL NO ES UN CERO
 * ===========================================================================
 * `nullif(denominador, 0)` hace que una tasa sin denominador llegue como
 * `null`. Se enseña como «sin base para calcularla», no como 0 %: «no hay con
 * qué calcularla» y «es cero» son cosas distintas, y confundirlas es hacer que
 * el embudo mienta hacia abajo.
 *
 * ===========================================================================
 * LA FORMULA VA EN EL TOOLTIP, Y EL CONTEO A LA VISTA
 * ===========================================================================
 * Cada tarjeta lleva su fórmula literal en el tooltip y, debajo del
 * porcentaje, los dos conteos de los que sale. Así quien lea un 12 % puede
 * comprobar de qué es el 12 % sin abrir el SQL.
 */
export function Conversiones() {
  const consulta = useQuery({ queryKey: ['reportes', 'conversion'], queryFn: cargarConversion })
  const conversion = consulta.data ?? null

  return (
    <section aria-labelledby="titulo-conversiones" className="space-y-4">
      <div>
        <h2 id="titulo-conversiones" className="text-lg font-black tracking-tight text-foreground">
          Conversiones
        </h2>
        <p className="mt-1 text-sm leading-snug text-suelo-700">
          Calculadas por <code>v_conversion</code> sobre el acumulado histórico de la base, no
          sobre una cohorte. Para comparar contra un lanzamiento concreto hay que mirar el embudo
          por lanzamiento.
        </p>
      </div>

      {consulta.isPending && (
        <p className="flex items-center gap-2 py-6 text-sm text-suelo-500">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
          Cargando…
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

      {conversion === null && !consulta.isPending && consulta.error === null && (
        <p className="rounded-md border border-border bg-card p-3 text-sm leading-snug text-suelo-700">
          <code>v_conversion</code> no devolvió ninguna fila. No se pintan ceros en su lugar.
        </p>
      )}

      {conversion !== null && (
        <TooltipProvider delayDuration={150}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TASAS.map((t) => {
              const valor = conversion.tasas[t.clave] ?? null
              const arriba = conteoDeTasa(conversion, t.numerador)
              const abajo = conteoDeTasa(conversion, t.denominador)

              return (
                <TarjetaTremor key={t.clave} className="p-4 shadow-tarjeta ring-border">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-bold leading-snug text-suelo-700">{t.titulo}</p>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="shrink-0 rounded text-suelo-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          aria-label={`Fórmula de ${t.titulo}`}
                        >
                          <HelpCircle className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-72">
                        <p className="font-bold">{t.formula}</p>
                        <p className="mt-1 opacity-80">
                          La calcula <code>v_conversion</code> como{' '}
                          <code>{t.clave}</code>, con las fórmulas de
                          embudo-y-metricas.md §4.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>

                  {valor === null ? (
                    <>
                      <Metric className="mt-1 text-2xl font-normal text-suelo-500">—</Metric>
                      <p className="mt-1 text-xs font-bold leading-snug text-suelo-700">
                        Sin base para calcularla: el denominador es cero. No es un 0 %.
                      </p>
                    </>
                  ) : (
                    <>
                      <Metric className="mt-1 text-2xl font-black tabular-nums text-foreground">
                        {valor} %
                      </Metric>
                      <p className="mt-1 text-xs leading-snug text-suelo-500">
                        {arriba ?? '—'} de {abajo ?? '—'} · {t.numerador} / {t.denominador}
                      </p>
                    </>
                  )}
                </TarjetaTremor>
              )
            })}
          </div>
        </TooltipProvider>
      )}

      {/* -------------------- Las que ninguna vista calcula -------------------- */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-bold text-foreground">
          Fórmulas de §4 que ninguna vista calcula todavía
        </h3>
        <p className="mt-1 text-xs leading-snug text-suelo-700">
          Están aquí como huecos, con su motivo. Calcularlas en el navegador sería inventar una
          escala que la vista no tiene.
        </p>
        <dl className="mt-3 space-y-3">
          {TASAS_SIN_VISTA.map((t) => (
            <div key={t.titulo}>
              <dt className="text-sm font-bold text-foreground">
                🔴 {t.titulo}{' '}
                <span className="font-normal text-suelo-500">— {t.formula}</span>
              </dt>
              <dd className="text-xs leading-snug text-suelo-700">{t.porQue}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
