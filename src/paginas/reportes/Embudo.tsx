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
import { exportarCSV } from '@/lib/csv'
import {
  cargarEmbudo,
  cargarEmbudoPorLanzamiento,
  completarEmbudo,
  pivotarPorLanzamiento,
  type FilaEmbudo,
} from '@/lib/reportes'

/**
 * EL EMBUDO — las 10 etapas, tal como las cuenta la vista.
 *
 * ===========================================================================
 * POR QUE LA BARRA ES `total` Y NO LA SUMA DE LAS TRES COLUMNAS
 * ===========================================================================
 * `v_embudo` devuelve cuatro números por etapa: activas, ganadas, perdidas y
 * total. Y las tres primeras NO suman el total: falta `pausada`, el cuarto
 * valor del enum `estado_oportunidad`, que la vista no cuenta en ninguna
 * columna. Una barra apilada con las tres se leería como el total de la etapa
 * y sería más corta que el total real.
 *
 * Así que la barra es `total`, que es una columna de la vista, y las otras
 * tres van en la tabla de al lado, que es donde se pueden leer sin que parezca
 * que se suman. La diferencia entre el total y las tres se dice al pie en vez
 * de calcularla aquí: una resta hecha en el navegador es una cifra que no se
 * puede auditar contra el SQL.
 *
 * ===========================================================================
 * LAS ETAPAS VACIAS TAMBIEN SALEN
 * ===========================================================================
 * `count(*) group by` no devuelve los grupos vacíos, así que una etapa por la
 * que no ha pasado nadie sencillamente no viene. `completarEmbudo` las añade
 * con 0 — que es lo que significa un grupo ausente, y así el embudo tiene sus
 * diez escalones aunque ocho estén a cero.
 */
export function Embudo() {
  const actual = useQuery({ queryKey: ['reportes', 'embudo'], queryFn: cargarEmbudo })
  const porLanzamiento = useQuery({
    queryKey: ['reportes', 'embudo-lanzamiento'],
    queryFn: cargarEmbudoPorLanzamiento,
  })

  const filas = completarEmbudo(actual.data?.filas ?? [])
  const datos = filas.map((f) => ({ etapa: f.etiqueta, Oportunidades: f.total }))

  const pivote = pivotarPorLanzamiento(porLanzamiento.data?.filas ?? [])

  return (
    <section aria-labelledby="titulo-embudo" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="titulo-embudo" className="text-lg font-black tracking-tight text-foreground">
            Embudo
          </h2>
          <p className="mt-1 text-sm leading-snug text-suelo-700">
            Las 10 etapas de <code>embudo-y-metricas.md</code> §1, contadas por{' '}
            <code>v_embudo</code>.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={() => exportarEmbudo(filas)} disabled={filas.length === 0}>
          <Download strokeWidth={1.75} aria-hidden="true" />
          Exportar CSV
        </Button>
      </div>

      {actual.isPending && <Cargando />}
      {actual.error !== null && <Error mensaje={actual.error.message} />}

      {actual.error === null && !actual.isPending && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-cal-300 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Ahora mismo</CardTitle>
            </CardHeader>
            <CardContent>
              <BarChart
                data={datos}
                index="etapa"
                categories={['Oportunidades']}
                colors={['blue']}
                layout="vertical"
                yAxisWidth={120}
                showLegend={false}
                allowDecimals={false}
                noDataText="La vista no devolvió ninguna fila."
                className="h-96"
              />
            </CardContent>
          </Card>

          <Card className="border-cal-300 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">El detalle que la barra no dice</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Etapa</TableHead>
                    <TableHead className="text-right">Activas</TableHead>
                    <TableHead className="text-right">Ganadas</TableHead>
                    <TableHead className="text-right">Perdidas</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filas.map((f) => (
                    <TableRow key={f.estado}>
                      <TableCell className="text-sm">{f.etiqueta}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.activas}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.ganadas}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.perdidas}</TableCell>
                      <TableCell className="text-right font-bold tabular-nums">{f.total}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* -------------------- Por lanzamiento -------------------- */}
      <div>
        <h3 className="text-base font-bold text-foreground">Por lanzamiento</h3>
        <p className="mb-3 mt-1 text-sm leading-snug text-suelo-700">
          De <code>v_embudo_por_lanzamiento</code>. Una serie por lanzamiento, sin sumarlas: el
          acumulado histórico y una cohorte concreta no son lo mismo.
        </p>

        {porLanzamiento.isPending && <Cargando />}
        {porLanzamiento.error !== null && <Error mensaje={porLanzamiento.error.message} />}

        {porLanzamiento.error === null && !porLanzamiento.isPending && (
          <Card className="border-cal-300 shadow-sm">
            <CardContent className="pt-6">
              {pivote.lanzamientos.length === 0 ? (
                <p className="py-6 text-center text-sm text-suelo-500">
                  Todavía no hay oportunidades con lanzamiento.
                </p>
              ) : (
                <BarChart
                  data={pivote.datos}
                  index="etapa"
                  categories={pivote.lanzamientos}
                  colors={COLORES_SERIE}
                  layout="vertical"
                  yAxisWidth={120}
                  allowDecimals={false}
                  className="h-96"
                />
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <p className="text-xs leading-relaxed text-suelo-500">
        La barra mide la columna <code>total</code> de la vista. Activas + ganadas + perdidas puede
        dar menos que el total: el enum <code>estado_oportunidad</code> tiene un cuarto valor,{' '}
        <span className="font-bold">pausada</span>, que <code>v_embudo</code> no cuenta en ninguna
        columna. Esa diferencia no se calcula aquí — si hace falta verla, se añade la columna a la
        vista.
      </p>
    </section>
  )
}

/**
 * Las series se pintan con los nombres de color que ya admite la `safelist` de
 * `tailwind.config.js`: blue como equivalente del Azul Noche y los neutros de
 * tabla. Ninguno nuevo — un color fuera de esa lista sale sin pintar, y ese
 * fallo es la señal correcta.
 */
const COLORES_SERIE: string[] = ['blue', 'slate', 'stone', 'gray']

function Cargando() {
  return (
    <p className="flex items-center gap-2 py-6 text-sm text-suelo-500">
      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
      Cargando…
    </p>
  )
}

function Error({ mensaje }: { mensaje: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md border border-alerta bg-alerta-suave p-3 text-sm font-bold leading-snug text-alerta"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
      {mensaje}
    </p>
  )
}

function exportarEmbudo(filas: readonly FilaEmbudo[]): void {
  exportarCSV('embudo', filas, [
    { titulo: 'Etapa', valor: (f) => f.etiqueta },
    { titulo: 'Estado', valor: (f) => f.estado },
    { titulo: 'Activas', valor: (f) => f.activas },
    { titulo: 'Ganadas', valor: (f) => f.ganadas },
    { titulo: 'Perdidas', valor: (f) => f.perdidas },
    { titulo: 'Total', valor: (f) => f.total },
  ])
}
