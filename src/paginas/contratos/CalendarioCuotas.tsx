import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarDays, Loader2 } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import { Input, claseCampo } from '@/componentes/ui/input'
import { Label } from '@/componentes/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/componentes/ui/table'
import { cn } from '@/lib/utils'
import { formatearMonto } from '@/lib/dinero'
import { fechaCorta } from '@/lib/fechas'
import type { Moneda } from '@/lib/dinero'
import {
  PERIODICIDADES,
  centimosAMonto,
  generarCuotas,
  planEnBlanco,
  repartirCuotas,
  totalProyectado,
  type PlanDeCuotas,
} from '@/lib/contratos'

/**
 * EL CALENDARIO DE CUOTAS — se OFRECE, no se impone.
 *
 * ===========================================================================
 * POR QUE HAY UNA VISTA PREVIA Y NO UN BOTON DIRECTO
 * ===========================================================================
 * Porque un calendario de cuotas es lo que la cobranza va a perseguir durante
 * uno o dos años, y una vez escrito no se borra (R8): `cuotas` tiene índice
 * único por (contrato, número), así que un calendario mal generado hay que
 * corregirlo fila a fila. Se enseña entero ANTES de guardar — con la última
 * cuota destacada si le toca el resto del reparto.
 *
 * ===========================================================================
 * EL REPARTO NO ESCONDE CENTIMOS
 * ===========================================================================
 * `repartirCuotas` trabaja en céntimos enteros y deja el resto en la última
 * cuota. Aquí se comprueba en pantalla que la suma de las cuotas es EXACTAMENTE
 * el monto a financiar, y si no lo fuera, no se deja guardar.
 *
 * ===========================================================================
 * MONEDA
 * ===========================================================================
 * La del contrato, y no se ofrece cambiarla (R7). Un calendario con cuotas en
 * dos monedas no se puede sumar, y la moneda de control sigue [PENDIENTE].
 */
export function CalendarioCuotas({
  contratoId,
  moneda,
  financiablePropuesto,
  alGenerar,
}: {
  contratoId: string
  moneda: Moneda
  /** Precio − inicial, ya calculado por quien llama. Editable aquí. */
  financiablePropuesto: string
  alGenerar: (generadas: number) => void
}) {
  const [plan, setPlan] = useState<PlanDeCuotas>(() => ({
    ...planEnBlanco(),
    montoAFinanciar: financiablePropuesto,
  }))
  const [concepto, setConcepto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cuotas = useMemo(() => {
    const total = Number(plan.montoAFinanciar.trim().replace(',', '.'))
    const cuantas = Number(plan.cuantas.trim())
    return repartirCuotas(total, cuantas, plan.primeraFecha, plan.periodicidad)
  }, [plan])

  const objetivo = Number(plan.montoAFinanciar.trim().replace(',', '.'))
  const suma = totalProyectado(cuotas)
  const cuadra =
    cuotas.length > 0 && Math.round(suma * 100) === Math.round((objetivo || 0) * 100)

  function cambiar<C extends keyof PlanDeCuotas>(campo: C, valor: PlanDeCuotas[C]) {
    setPlan((previo) => ({ ...previo, [campo]: valor }))
  }

  async function generar() {
    if (guardando || !cuadra) return
    setGuardando(true)
    setError(null)

    const resultado = await generarCuotas(contratoId, cuotas, moneda, concepto)
    setGuardando(false)

    if (!resultado.ok) {
      setError(resultado.motivo)
      return
    }
    alGenerar(resultado.generadas)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          Calendario de cuotas
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 pb-4">
        <p className="text-sm leading-snug text-suelo-700">
          Es opcional. Un contrato al contado no necesita calendario, y uno financiado puede
          generarlo más tarde desde la lista de contratos.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="financiar">Monto a financiar ({moneda})</Label>
            <Input
              id="financiar"
              value={plan.montoAFinanciar}
              onChange={(e) => cambiar('montoAFinanciar', e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              className="tabular-nums"
            />
            <p className="text-xs leading-snug text-suelo-500">
              Se propone como <span className="font-bold">precio total − inicial</span>. Es una
              resta de dos cifras que acabas de escribir tú, no un dato del negocio: cámbiala si
              lo pactado fue otra cosa.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cuantas">Número de cuotas</Label>
            <Input
              id="cuantas"
              value={plan.cuantas}
              onChange={(e) => cambiar('cuantas', e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              className="tabular-nums"
            />
            {/* Ningún número de cuotas viene sugerido: el plan de financiamiento
                de MML tiene 4 versiones en conflicto en 00-fuente-de-verdad. */}
            <p className="text-xs leading-snug text-suelo-500">
              Sin valor sugerido: la política de financiamiento tiene 4 versiones en conflicto en
              <code> 00-fuente-de-verdad</code>. Escribe lo que diga el contrato firmado.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="primera">Fecha de la primera cuota</Label>
            <Input
              id="primera"
              type="date"
              value={plan.primeraFecha}
              onChange={(e) => cambiar('primeraFecha', e.target.value)}
              className="tabular-nums"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="periodicidad">Periodicidad</Label>
            <select
              id="periodicidad"
              value={plan.periodicidad}
              onChange={(e) => cambiar('periodicidad', e.target.value as PlanDeCuotas['periodicidad'])}
              className={claseCampo}
            >
              {PERIODICIDADES.map((p) => (
                <option key={p.valor} value={p.valor}>
                  {p.etiqueta}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="concepto">Concepto (opcional)</Label>
          <Input
            id="concepto"
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            autoComplete="off"
            placeholder="Se copia igual en todas las cuotas"
          />
        </div>

        {cuotas.length > 0 && (
          <VistaPrevia cuotas={cuotas} moneda={moneda} suma={suma} objetivo={objetivo} cuadra={cuadra} />
        )}

        {error !== null && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-alerta bg-alerta-suave p-3 text-sm font-bold leading-snug text-alerta"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-md bg-azul px-5 py-4">
          <p className="text-xs leading-snug text-azul-300">
            {cuotas.length === 0
              ? 'Rellena las cuatro casillas para ver el calendario antes de guardarlo.'
              : `Se van a escribir ${cuotas.length} filas en la tabla cuotas. Nada se borra después (R8).`}
          </p>
          <Button
            onClick={() => void generar()}
            disabled={guardando || !cuadra}
            className={cn(
              'h-11 shrink-0 px-6 text-base font-bold',
              'bg-ambar text-suelo hover:bg-ambar/90',
              'focus-visible:ring-2 focus-visible:ring-cal',
              'disabled:bg-azul-600 disabled:text-azul-300 disabled:opacity-100',
            )}
          >
            {guardando ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Generando…
              </>
            ) : (
              'Generar el calendario'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function VistaPrevia({
  cuotas,
  moneda,
  suma,
  objetivo,
  cuadra,
}: {
  cuotas: readonly { numero: number; fechaVencimiento: string; centimos: number }[]
  moneda: Moneda
  suma: number
  objetivo: number
  cuadra: boolean
}) {
  const ultima = cuotas[cuotas.length - 1]
  const primeraCentimos = cuotas[0]?.centimos ?? 0
  const ultimaDistinta = ultima !== undefined && ultima.centimos !== primeraCentimos

  return (
    <div className="space-y-2">
      <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-16">N.º</TableHead>
              <TableHead>Vence</TableHead>
              <TableHead className="text-right">Monto</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cuotas.map((c) => (
              <TableRow key={c.numero}>
                <TableCell className="tabular-nums">{c.numero}</TableCell>
                <TableCell className="tabular-nums">{fechaCorta(c.fechaVencimiento)}</TableCell>
                <TableCell
                  className={cn(
                    'text-right tabular-nums',
                    c.numero === ultima?.numero && ultimaDistinta && 'font-black',
                  )}
                >
                  {formatearMonto(centimosAMonto(c.centimos), moneda)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {ultimaDistinta && (
        <p className="text-xs font-bold leading-snug text-suelo-700">
          🟡 La última cuota es distinta: lleva el resto del reparto, para que la suma dé exacta.
          Se marca en negrita arriba en vez de esconderla en el redondeo.
        </p>
      )}

      <p
        className={cn(
          'text-xs leading-snug',
          cuadra ? 'text-suelo-500' : 'font-bold text-alerta',
        )}
      >
        {cuadra ? (
          <>
            Las {cuotas.length} cuotas suman {formatearMonto(suma, moneda)}, exactamente el monto a
            financiar.
          </>
        ) : (
          <>
            🔴 Las cuotas suman {formatearMonto(suma, moneda)} y el monto a financiar es{' '}
            {formatearMonto(objetivo, moneda)}. No se puede generar un calendario que no cuadre.
          </>
        )}
      </p>
    </div>
  )
}
