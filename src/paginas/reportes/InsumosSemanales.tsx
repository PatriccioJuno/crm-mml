import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, startOfWeek, subDays } from 'date-fns'
import { AlertTriangle, Download, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import { Input } from '@/componentes/ui/input'
import { Label } from '@/componentes/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/componentes/ui/table'
import { formatearMonto } from '@/lib/dinero'
import { fechaCorta } from '@/lib/fechas'
import { exportarCSV } from '@/lib/csv'
import {
  cargarInsumos,
  type ActividadDia,
  type CambioEstadoDia,
  type Insumos,
} from '@/lib/reportes'

/**
 * INSUMOS DEL REPORTE SEMANAL — la materia prima de las partes 1, 2 y 3.
 *
 * ===========================================================================
 * QUE ES Y QUE NO ES
 * ===========================================================================
 * Esto NO es el reporte. El reporte de 7 partes lo escribe una persona
 * (07-crm\CLAUDE.md §7), y una de sus reglas es que antes de compilarlo se
 * avisa de qué métricas y validaciones hacen falta — nunca se arma a ciegas.
 * Lo que hay aquí son los CONTEOS que el CRM puede demostrar para las partes
 * 1 (trabajo ejecutado), 2 (artefactos/evidencia) y 3 (hechos con fuente), con
 * el nombre de la vista de la que sale cada uno para poder citarla.
 *
 * Las partes 4 a 7 —por validar, hipótesis, decisiones requeridas y próximas
 * acciones— no salen de aquí y no se fingen: son juicio, y el CRM no lo tiene.
 *
 * ===========================================================================
 * NO SE CRUZAN LAS CINCO FUENTES
 * ===========================================================================
 * Son cinco consultas distintas y se enseñan como cinco bloques. No se suman
 * entre sí ni se calcula ningún ratio entre ellas: un «pagos por interacción»
 * sería un indicador nuevo inventado en el navegador.
 *
 * Los pagos van POR MONEDA, como en todas partes (R7).
 */
export function InsumosSemanales() {
  // El rango por defecto es la semana en curso desde el lunes. Es una
  // comodidad de arranque, no un dato: se puede cambiar a mano, y lo que se
  // consulta es siempre lo que digan las dos casillas.
  const hoy = new Date()
  const [desde, setDesde] = useState(format(startOfWeek(hoy, { weekStartsOn: 1 }), 'yyyy-MM-dd'))
  const [hasta, setHasta] = useState(format(hoy, 'yyyy-MM-dd'))
  const [rango, setRango] = useState<{ desde: string; hasta: string } | null>(null)

  const consulta = useQuery({
    queryKey: ['reportes', 'insumos', rango?.desde, rango?.hasta],
    queryFn: () => cargarInsumos(rango?.desde ?? '', rango?.hasta ?? ''),
    enabled: rango !== null,
  })

  const rangoValido = desde !== '' && hasta !== '' && desde <= hasta

  return (
    <section aria-labelledby="titulo-insumos" className="space-y-4">
      <div>
        <h2 id="titulo-insumos" className="text-lg font-black tracking-tight text-foreground">
          Insumos del reporte semanal
        </h2>
        <p className="mt-1 text-sm leading-snug text-suelo-700">
          Lo que el CRM puede demostrar para las partes 1, 2 y 3 del reporte de 7 partes. No es el
          reporte: es la evidencia con la que se escribe.
        </p>
      </div>

      <Card className="border-cal-300 shadow-sm">
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-2">
            <Label htmlFor="desde">Desde</Label>
            <Input
              id="desde"
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="tabular-nums"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hasta">Hasta</Label>
            <Input
              id="hasta"
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="tabular-nums"
            />
          </div>

          <Button onClick={() => setRango({ desde, hasta })} disabled={!rangoValido}>
            <FileText strokeWidth={1.75} aria-hidden="true" />
            Reunir los insumos
          </Button>

          <Button
            variant="ghost"
            onClick={() => {
              setDesde(format(subDays(hoy, 7), 'yyyy-MM-dd'))
              setHasta(format(hoy, 'yyyy-MM-dd'))
            }}
          >
            Últimos 7 días
          </Button>

          {!rangoValido && (
            <p className="text-xs font-bold text-alerta">
              El «desde» tiene que ser anterior o igual al «hasta».
            </p>
          )}
        </CardContent>
      </Card>

      {rango === null && (
        <p className="rounded-md border border-cal-300 bg-card p-3 text-sm leading-snug text-suelo-700">
          Elige el rango y pulsa el botón. No se consulta nada antes: un rango por defecto
          consultado solo porque la pantalla se abrió es una cifra que nadie pidió.
        </p>
      )}

      {consulta.isPending && rango !== null && (
        <p className="flex items-center gap-2 py-6 text-sm text-suelo-500">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
          Reuniendo los insumos…
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

      {consulta.data !== undefined && consulta.error === null && (
        <Resultado insumos={consulta.data} />
      )}
    </section>
  )
}

function Resultado({ insumos }: { insumos: Insumos }) {
  const i = insumos

  return (
    <div className="space-y-4">
      <p className="text-sm leading-snug text-suelo-700">
        Del <span className="font-bold">{fechaCorta(i.desde)}</span> al{' '}
        <span className="font-bold">{fechaCorta(i.hasta)}</span>, ambos incluidos.
      </p>

      {i.descartadas > 0 && (
        <p className="text-xs font-bold text-alerta">
          🔴 {i.descartadas}{' '}
          {i.descartadas === 1 ? 'fila no se pudo leer' : 'filas no se pudieron leer'} y no están
          contadas en ningún bloque. Un reporte no se compila sobre un conteo incompleto sin
          decirlo.
        </p>
      )}

      {/* ---------------- Separaciones ---------------- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Contador
          titulo="Separaciones nuevas"
          valor={i.separacionesNuevas}
          fuente="tabla separaciones · creado_el en el rango"
        />
        <Contador
          titulo="Separaciones verificadas"
          valor={i.separacionesVerificadas}
          fuente="tabla separaciones · verificada_el en el rango (R2: solo Dirección)"
        />
      </div>

      {/* ---------------- Actividad ---------------- */}
      <Card className="border-cal-300 shadow-sm">
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-2">
          <div>
            <CardTitle className="text-base">Interacciones por día</CardTitle>
            <p className="mt-1 text-xs text-suelo-500">
              De <code>v_actividad_diaria</code>, acumuladas por día (la vista agrupa además por
              actor).
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportarActividad(i.actividad)}
            disabled={i.actividad.length === 0}
          >
            <Download strokeWidth={1.75} aria-hidden="true" />
            CSV
          </Button>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Día</TableHead>
                <TableHead className="text-right">Interacciones</TableHead>
                <TableHead className="text-right">WhatsApp</TableHead>
                <TableHead className="text-right">Llamadas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {i.actividad.length === 0 && <Vacia colSpan={4} />}
              {i.actividad.map((d) => (
                <TableRow key={d.dia}>
                  <TableCell className="tabular-nums">{fechaCorta(d.dia)}</TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {d.interacciones}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{d.whatsapp}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.llamadas}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ---------------- Cambios de estado ---------------- */}
      <Card className="border-cal-300 shadow-sm">
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-2">
          <div>
            <CardTitle className="text-base">Cambios de estado por día</CardTitle>
            <p className="mt-1 text-xs text-suelo-500">
              De <code>v_cambios_de_estado_por_dia</code>, que lee <code>estado_historial</code>{' '}
              (R9: todo cambio deja actor y fecha).
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportarCambios(i.cambios)}
            disabled={i.cambios.length === 0}
          >
            <Download strokeWidth={1.75} aria-hidden="true" />
            CSV
          </Button>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Día</TableHead>
                <TableHead>Pasó a</TableHead>
                <TableHead className="text-right">Cuántos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {i.cambios.length === 0 && <Vacia colSpan={3} />}
              {i.cambios.map((c) => (
                <TableRow key={`${c.dia}-${c.aEstado}`}>
                  <TableCell className="tabular-nums">{fechaCorta(c.dia)}</TableCell>
                  <TableCell className="text-sm">{c.etiqueta}</TableCell>
                  <TableCell className="text-right font-bold tabular-nums">{c.n}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ---------------- Pagos ---------------- */}
      <Card className="border-cal-300 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pagos registrados</CardTitle>
          <p className="mt-1 text-xs text-suelo-500">
            De la tabla <code>pagos</code>, por fecha de pago. Una fila POR MONEDA: no se suman
            (R7).
          </p>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Moneda</TableHead>
                <TableHead className="text-right">Pagos</TableHead>
                <TableHead className="text-right">Total cobrado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {i.pagos.length === 0 && <Vacia colSpan={3} />}
              {i.pagos.map((p) => (
                <TableRow key={p.moneda}>
                  <TableCell className="font-bold">{p.moneda}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.pagos}</TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {formatearMonto(p.monto, p.moneda === '[MONEDA PENDIENTE]' ? null : p.moneda)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs leading-relaxed text-suelo-500">
        Esto cubre las partes <span className="font-bold">1, 2 y 3</span>. Las partes 4 a 7 —por
        validar, hipótesis/propuestas, decisiones requeridas y próximas acciones— no salen de
        ninguna vista: las escribe una persona. Y antes de compilar el reporte hay que avisar de
        qué métricas y validaciones faltan, nunca armarlo a ciegas (07-crm\CLAUDE.md §7).
      </p>
    </div>
  )
}

function Contador({
  titulo,
  valor,
  fuente,
}: {
  titulo: string
  valor: number
  fuente: string
}) {
  return (
    <div className="rounded-lg border border-cal-300 bg-card p-4">
      <p className="text-xs font-bold text-suelo-700">{titulo}</p>
      <p className="mt-1 text-3xl font-black tabular-nums text-foreground">{valor}</p>
      <p className="mt-1 text-xs leading-snug text-suelo-500">{fuente}</p>
    </div>
  )
}

function Vacia({ colSpan }: { colSpan: number }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="py-6 text-center text-sm text-suelo-500">
        Nada en este rango.
      </TableCell>
    </TableRow>
  )
}

function exportarActividad(filas: readonly ActividadDia[]): void {
  exportarCSV('insumos-actividad', filas, [
    { titulo: 'Día', valor: (d) => d.dia },
    { titulo: 'Interacciones', valor: (d) => d.interacciones },
    { titulo: 'WhatsApp', valor: (d) => d.whatsapp },
    { titulo: 'Llamadas', valor: (d) => d.llamadas },
  ])
}

function exportarCambios(filas: readonly CambioEstadoDia[]): void {
  exportarCSV('insumos-cambios-de-estado', filas, [
    { titulo: 'Día', valor: (c) => c.dia },
    { titulo: 'Pasó a', valor: (c) => c.etiqueta },
    { titulo: 'Estado', valor: (c) => c.aEstado },
    { titulo: 'Cuántos', valor: (c) => c.n },
  ])
}
