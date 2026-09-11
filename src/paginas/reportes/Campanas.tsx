import { useQuery } from '@tanstack/react-query'
import { BarChart } from '@tremor/react'
import { AlertTriangle, Download, Loader2 } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/componentes/ui/table'
import { aNumero, formatearMonto } from '@/lib/dinero'
import { exportarCSV } from '@/lib/csv'
import { campanasPorMoneda, cargarRendimientoCampanas, type Campana } from '@/lib/reportes'

/**
 * RENDIMIENTO DE CAMPAÑAS — costo por lead y por contrato.
 *
 * ===========================================================================
 * UN GRAFICO POR MONEDA. NUNCA UNO SOLO.
 * ===========================================================================
 * `campanas.inversion` lleva su propia `inversion_moneda`, así que dos
 * campañas pueden estar en PEN y en USD. Poner sus costos por lead en la misma
 * barra sería una comparación falsa: el eje diría «20» para dos cifras que no
 * valen lo mismo. Por eso hay una tabla y un gráfico POR CADA MONEDA, y ningún
 * total general.
 *
 * ===========================================================================
 * LOS DOS COSTOS LOS DIVIDE LA VISTA
 * ===========================================================================
 * `costo_por_lead` y `costo_por_contrato` vienen ya divididos y redondeados de
 * `v_rendimiento_campanas`, con `nullif(...,0)` para que una campaña sin leads
 * o sin contratos devuelva `null` en vez de reventar. Aquí no se divide nada:
 * un `null` se enseña como «sin base», no como cero — una campaña sin ningún
 * contrato no tiene un costo por contrato de 0, tiene un costo por contrato
 * que todavía no existe.
 */
export function Campanas() {
  const consulta = useQuery({
    queryKey: ['reportes', 'campanas'],
    queryFn: cargarRendimientoCampanas,
  })

  const filas = consulta.data?.filas ?? []
  const grupos = campanasPorMoneda(filas)

  return (
    <section aria-labelledby="titulo-campanas" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="titulo-campanas" className="text-lg font-black tracking-tight text-foreground">
            Rendimiento de campañas
          </h2>
          <p className="mt-1 text-sm leading-snug text-suelo-700">
            Costo por lead y por contrato, de <code>v_rendimiento_campanas</code>. Separado por
            moneda de inversión.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => exportar(filas)}
          disabled={filas.length === 0}
        >
          <Download strokeWidth={1.75} aria-hidden="true" />
          Exportar CSV
        </Button>
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

      {consulta.error === null && !consulta.isPending && filas.length === 0 && (
        <p className="rounded-md border border-cal-300 bg-card p-3 text-sm leading-snug text-suelo-700">
          No hay ninguna campaña cargada. Sin campañas no hay costo por lead que calcular.
        </p>
      )}

      {grupos.map((grupo) => (
        <GrupoDeMoneda key={grupo.moneda} moneda={grupo.moneda} campanas={grupo.campanas} />
      ))}

      {grupos.length > 1 && (
        <p className="text-xs font-bold leading-snug text-suelo-700">
          🟡 Hay {grupos.length} monedas de inversión y no se comparan entre sí. La moneda de
          control del negocio sigue [PENDIENTE] y no hay ningún tipo de cambio cargado (R7).
        </p>
      )}

      <p className="text-xs leading-relaxed text-suelo-500">
        El costo por venta completo —(publicidad + evento) / contratos— no está aquí:{' '}
        <code>campanas.inversion</code> solo cubre la publicidad, y el costo del evento presencial
        no vive en ninguna tabla. Ver el bloque de fórmulas sin vista, más arriba.
      </p>
    </section>
  )
}

function GrupoDeMoneda({ moneda, campanas }: { moneda: string; campanas: readonly Campana[] }) {
  // El gráfico solo puede dibujar las campañas cuyo costo por lead existe. Las
  // que tienen `null` se quedan fuera del gráfico y SE DICEN al pie: una barra
  // ausente sin explicación se lee como un cero.
  const conCosto = campanas.filter((c) => aNumero(c.costoPorLead) !== null)
  const sinCosto = campanas.length - conCosto.length

  const datos = conCosto.map((c) => ({
    campana: c.nombre,
    'Costo por lead': aNumero(c.costoPorLead) ?? 0,
    'Costo por contrato': aNumero(c.costoPorContrato) ?? 0,
  }))

  return (
    <Card className="border-cal-300 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Inversión en {moneda}
          <span className="ml-2 text-xs font-normal text-suelo-500">
            {campanas.length} {campanas.length === 1 ? 'campaña' : 'campañas'}
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 px-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Campaña</TableHead>
                <TableHead>Plataforma</TableHead>
                <TableHead>Lanzamiento</TableHead>
                <TableHead className="text-right">Inversión</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Contratos</TableHead>
                <TableHead className="text-right">Costo por lead</TableHead>
                <TableHead className="text-right">Costo por contrato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campanas.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-bold text-foreground">{c.nombre}</TableCell>
                  <TableCell className="text-sm">{c.plataforma ?? '—'}</TableCell>
                  <TableCell className="text-sm">{c.lanzamiento ?? '—'}</TableCell>
                  {/* R7 · cada monto con su moneda */}
                  <TableCell className="whitespace-nowrap text-right tabular-nums">
                    {formatearMonto(c.inversion, c.inversionMoneda)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.leads}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.contratos}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">
                    <SinBase valor={c.costoPorLead} moneda={c.inversionMoneda} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">
                    <SinBase valor={c.costoPorContrato} moneda={c.inversionMoneda} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {datos.length > 0 && (
          <div className="px-6 pb-2">
            <BarChart
              data={datos}
              index="campana"
              categories={['Costo por lead', 'Costo por contrato']}
              colors={COLORES}
              yAxisWidth={72}
              noDataText="Ninguna campaña de esta moneda tiene costo por lead calculable."
              className="h-72"
            />
            <p className="mt-2 text-xs leading-snug text-suelo-500">
              Las dos barras están en {moneda}. Un «costo por contrato» que la vista devolvió como
              nulo se dibuja como 0 en la barra porque un gráfico no sabe dibujar «no hay base»;
              el valor real está en la tabla de arriba, como «sin base».
            </p>
          </div>
        )}

        {sinCosto > 0 && (
          <p className="px-6 pb-4 text-xs font-bold leading-snug text-suelo-700">
            🟡 {sinCosto}{' '}
            {sinCosto === 1
              ? 'campaña no aparece en el gráfico porque no tiene costo por lead'
              : 'campañas no aparecen en el gráfico porque no tienen costo por lead'}{' '}
            (sin leads, o sin inversión cargada). Sí están en la tabla.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** Un `null` de la vista se dice, no se convierte en cero. */
function SinBase({
  valor,
  moneda,
}: {
  valor: number | string | null
  moneda: string | null
}) {
  if (aNumero(valor) === null) {
    return <span className="text-xs font-bold text-suelo-700">sin base</span>
  }
  return <>{formatearMonto(valor, moneda)}</>
}

const COLORES: string[] = ['blue', 'slate']

function exportar(filas: readonly Campana[]): void {
  exportarCSV('rendimiento-campanas', filas, [
    { titulo: 'Campaña', valor: (c) => c.nombre },
    { titulo: 'Plataforma', valor: (c) => c.plataforma },
    { titulo: 'Lanzamiento', valor: (c) => c.lanzamiento },
    { titulo: 'Inversión', valor: (c) => c.inversion },
    { titulo: 'Moneda', valor: (c) => c.inversionMoneda },
    { titulo: 'Leads', valor: (c) => c.leads },
    { titulo: 'Contratos', valor: (c) => c.contratos },
    { titulo: 'Costo por lead', valor: (c) => c.costoPorLead },
    { titulo: 'Costo por contrato', valor: (c) => c.costoPorContrato },
  ])
}
