import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarPlus, Download, Loader2, Plus } from 'lucide-react'
import { Badge } from '@/componentes/ui/badge'
import { Button } from '@/componentes/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/componentes/ui/table'
import { useSesion } from '@/auth/ContextoSesion'
import { esMoneda, formatearMonto } from '@/lib/dinero'
import { fechaCorta } from '@/lib/fechas'
import { exportarCSV } from '@/lib/csv'
import {
  MODALIDADES,
  cargarContratos,
  financiablePropuesto,
  type Contrato,
} from '@/lib/contratos'
import { CalendarioCuotas } from './CalendarioCuotas'

/**
 * CONTRATOS — la lista, y el sitio donde se ve qué contrato se quedó sin
 * calendario.
 *
 * ===========================================================================
 * LA COLUMNA «CUOTAS» ES LA QUE IMPORTA
 * ===========================================================================
 * Un contrato con 0 cuotas no es un error del CRM: el calendario es OPCIONAL
 * al darlo de alta (un contrato al contado no lo necesita). Pero un contrato
 * financiado al que se le olvidó generar el calendario es dinero que nadie va
 * a perseguir — no aparece en Cobranza, porque Cobranza lee `cuotas`. Por eso
 * el conteo sale en su propia columna y desde ahí se genera.
 *
 * El conteo lo cuenta la BASE (`cuotas(count)` de PostgREST), no esta
 * pantalla. Un conteo hecho aquí sobre una lista paginada mentiría en cuanto
 * hubiera más de una página.
 *
 * ===========================================================================
 * NINGUNA SUMA, NINGÚN TOTAL
 * ===========================================================================
 * No hay fila de totales al pie, y es deliberado: los contratos pueden estar
 * en PEN y en USD, y la moneda de control del negocio sigue [PENDIENTE]. Un
 * total al pie de esta tabla sería una suma de dos monedas (R7). Los totales
 * por moneda están en Cobranza y en Reportes, donde se calculan agrupados.
 */
const CLAVE = ['contratos', 'lista'] as const

/** `contratos_escribir` de 02-rls.sql. Copiado de allí, no decidido aquí. */
const ESCRIBEN: readonly string[] = ['direccion', 'administracion']

export function PantallaContratos() {
  const { rol } = useSesion()
  const clienteConsultas = useQueryClient()
  const consulta = useQuery({ queryKey: CLAVE, queryFn: cargarContratos })

  const [calendarioDe, setCalendarioDe] = useState<Contrato | null>(null)

  const filas = consulta.data?.filas ?? []
  const sinCalendario = filas.filter((c) => c.cuotas === 0).length
  const puedeEscribir = rol !== null && ESCRIBEN.includes(rol)

  return (
    <div className="w-full">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground">Contratos</h1>
          <p className="mt-1 text-sm text-suelo-700">
            Los socios que ya compraron. Cada contrato manda sobre una unidad, y solo sobre una.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => exportar(filas)}
            disabled={filas.length === 0}
          >
            <Download strokeWidth={1.75} aria-hidden="true" />
            Exportar CSV
          </Button>

          {puedeEscribir && (
            <Button asChild>
              <Link to="/contratos/nuevo">
                <Plus strokeWidth={2} aria-hidden="true" />
                Nuevo contrato
              </Link>
            </Button>
          )}
        </div>
      </header>

      {sinCalendario > 0 && (
        <p className="mb-4 flex items-start gap-2 rounded-md border border-cal-300 bg-card p-3 text-sm">
          <CalendarPlus
            className="mt-0.5 h-4 w-4 shrink-0 text-suelo-700"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span className="leading-snug">
            <span className="font-bold text-foreground">
              {sinCalendario === 1
                ? '1 contrato no tiene calendario de cuotas.'
                : `${sinCalendario} contratos no tienen calendario de cuotas.`}
            </span>{' '}
            <span className="text-suelo-700">
              Si son al contado, está bien. Si son financiados, ese dinero no aparece en Cobranza
              y nadie lo está persiguiendo.
            </span>
          </span>
        </p>
      )}

      {consulta.isPending && (
        <p className="flex items-center gap-2 py-10 text-sm text-suelo-500">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
          Cargando los contratos…
        </p>
      )}

      {consulta.error !== null && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-alerta bg-alerta-suave p-4 text-sm font-bold text-alerta"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {consulta.error.message}
        </p>
      )}

      {consulta.error === null && !consulta.isPending && (
        <div className="overflow-x-auto rounded-lg border border-cal-300 bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Socio</TableHead>
                <TableHead>Unidad</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Firma</TableHead>
                <TableHead className="text-right">Precio total</TableHead>
                <TableHead className="text-right">Inicial</TableHead>
                <TableHead>Modalidad</TableHead>
                <TableHead>Estado legal</TableHead>
                <TableHead>Cuotas</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {filas.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={9} className="py-10 text-center text-sm">
                    <p className="font-bold text-foreground">Todavía no hay ningún contrato.</p>
                    <p className="mt-1 text-suelo-500">
                      Un contrato nace de una oportunidad que ya llegó a separación.
                    </p>
                  </TableCell>
                </TableRow>
              )}

              {filas.map((c) => (
                <FilaContrato
                  key={c.id}
                  contrato={c}
                  puedeEscribir={puedeEscribir}
                  generar={() => setCalendarioDe(c)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Pie descartadas={consulta.data?.descartadas ?? 0} />

      {calendarioDe !== null && (
        <DialogoCalendario
          contrato={calendarioDe}
          cerrar={() => setCalendarioDe(null)}
          alGenerar={() => {
            setCalendarioDe(null)
            void clienteConsultas.invalidateQueries({ queryKey: ['contratos'] })
            void clienteConsultas.invalidateQueries({ queryKey: ['cobranza'] })
          }}
        />
      )}
    </div>
  )
}

function FilaContrato({
  contrato,
  puedeEscribir,
  generar,
}: {
  contrato: Contrato
  puedeEscribir: boolean
  generar: () => void
}) {
  const c = contrato
  const modalidad = MODALIDADES.find((m) => m.valor === c.modalidadPago)

  return (
    <TableRow>
      <TableCell className="font-bold text-foreground">
        {c.nombreCompleto ?? '[sin nombre]'}
      </TableCell>

      <TableCell className="text-sm">{c.codigoUnidad ?? '—'}</TableCell>

      <TableCell className="text-sm tabular-nums">
        {c.codigo ?? <span className="text-suelo-500">sin código</span>}
      </TableCell>

      <TableCell className="whitespace-nowrap text-sm tabular-nums">
        {fechaCorta(c.fechaFirma)}
      </TableCell>

      {/* R7: cada monto con su moneda. `formatearMonto` marca el hueco si falta. */}
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {formatearMonto(c.precioTotal, c.precioMoneda)}
      </TableCell>

      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {c.inicialMonto === null ? (
          <span className="text-suelo-500">—</span>
        ) : (
          formatearMonto(c.inicialMonto, c.precioMoneda)
        )}
      </TableCell>

      <TableCell className="text-sm">
        {modalidad?.etiqueta ?? c.modalidadPago ?? <span className="text-suelo-500">—</span>}
      </TableCell>

      <TableCell className="text-sm">
        {c.estadoLegal ?? <span className="text-suelo-500">—</span>}
      </TableCell>

      <TableCell>
        {c.cuotas > 0 ? (
          <Badge variant="outline" className="tabular-nums font-normal">
            {c.cuotas}
          </Badge>
        ) : puedeEscribir && esMoneda(c.precioMoneda) ? (
          <Button variant="ghost" size="sm" onClick={generar}>
            <CalendarPlus strokeWidth={1.75} aria-hidden="true" />
            Generar
          </Button>
        ) : (
          <span className="text-xs font-bold text-suelo-700">sin calendario</span>
        )}
      </TableCell>
    </TableRow>
  )
}

/**
 * Generar el calendario más tarde.
 *
 * Es el mismo componente que se ofrece al crear el contrato, con la misma
 * vista previa y la misma comprobación de que las cuotas cuadran al céntimo.
 * No hay una segunda versión «rápida»: dos formas de generar un calendario
 * serían dos criterios sobre cómo se reparte el resto del redondeo.
 */
function DialogoCalendario({
  contrato,
  cerrar,
  alGenerar,
}: {
  contrato: Contrato
  cerrar: () => void
  alGenerar: () => void
}) {
  const moneda = contrato.precioMoneda

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Calendario de {contrato.nombreCompleto ?? 'este contrato'}
          </DialogTitle>
          <DialogDescription>
            {contrato.codigoUnidad === null ? '' : `Unidad ${contrato.codigoUnidad}. `}
            Precio total {formatearMonto(contrato.precioTotal, contrato.precioMoneda)}
            {contrato.inicialMonto === null
              ? '.'
              : `, inicial ${formatearMonto(contrato.inicialMonto, contrato.precioMoneda)}.`}
          </DialogDescription>
        </DialogHeader>

        {esMoneda(moneda) ? (
          <CalendarioCuotas
            contratoId={contrato.id}
            moneda={moneda}
            financiablePropuesto={financiablePropuesto(
              String(contrato.precioTotal ?? ''),
              String(contrato.inicialMonto ?? ''),
            )}
            alGenerar={alGenerar}
          />
        ) : (
          // No debería ocurrir: `contratos.precio_moneda` es NOT NULL. Si pasa,
          // es que la base devolvió algo que este cliente no sabe leer, y
          // generar cuotas suponiendo una moneda sería justo lo prohibido (R7).
          <p className="rounded-md border border-alerta bg-alerta-suave p-3 text-sm font-bold leading-snug text-alerta">
            🔴 Este contrato no tiene una moneda legible, así que no se puede generar su
            calendario: las cuotas heredan la moneda del contrato y aquí no se supone ninguna.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Pie({ descartadas }: { descartadas: number }) {
  return (
    <div className="mt-3 space-y-2">
      {descartadas > 0 && (
        <p className="text-xs font-bold text-alerta">
          🔴 {descartadas}{' '}
          {descartadas === 1 ? 'fila no se pudo leer' : 'filas no se pudieron leer'} y no están en
          la tabla. Un contrato que falta en esta lista es un socio al que nadie le está cobrando:
          revisa el esquema antes de fiarte de ella.
        </p>
      )}

      <p className="text-xs leading-relaxed text-suelo-500">
        Sin fila de totales a propósito: los precios pueden estar en PEN y en USD, y sumarlos
        exigiría un tipo de cambio que nadie ha cargado (R7). Los totales por moneda están en
        Cobranza. El conteo de cuotas lo hace la base, no esta pantalla.
      </p>
    </div>
  )
}

/**
 * El CSV lleva el monto y su moneda EN COLUMNAS SEPARADAS, sin formatear: así
 * se pueden sumar en la hoja de cálculo y es imposible sumar dos monedas sin
 * darse cuenta. No lleva fila de total (ver `src/lib/csv.ts`).
 */
function exportar(filas: readonly Contrato[]): void {
  exportarCSV('contratos', filas, [
    { titulo: 'Socio', valor: (c) => c.nombreCompleto },
    { titulo: 'Unidad', valor: (c) => c.codigoUnidad },
    { titulo: 'Código', valor: (c) => c.codigo },
    { titulo: 'Fecha de firma', valor: (c) => c.fechaFirma },
    { titulo: 'Precio total', valor: (c) => c.precioTotal },
    { titulo: 'Moneda', valor: (c) => c.precioMoneda },
    { titulo: 'Inicial', valor: (c) => c.inicialMonto },
    { titulo: 'Moneda de la inicial', valor: (c) => c.precioMoneda },
    { titulo: 'Modalidad', valor: (c) => c.modalidadPago },
    { titulo: 'Estado legal', valor: (c) => c.estadoLegal },
    { titulo: 'Cuotas generadas', valor: (c) => c.cuotas },
  ])
}
