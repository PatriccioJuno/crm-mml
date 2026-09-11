import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Paperclip } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog'
import { Input } from '@/componentes/ui/input'
import { Label } from '@/componentes/ui/label'
import { cn } from '@/lib/utils'
import { useSesion } from '@/auth/ContextoSesion'
import { MONEDAS, aNumero, formatearMonto, type Moneda } from '@/lib/dinero'
import { fechaCorta } from '@/lib/fechas'
import { subirComprobante } from '@/lib/comprobantes'
import {
  MEDIOS_DE_PAGO,
  PREFIJO_COMPROBANTES_PAGO,
  buscarCuotaParaPago,
  pagoEnBlanco,
  registrarPago,
  type CuotaParaPago,
  type DatosPago,
  type FilaCobranza,
} from '@/lib/cobranza'

/**
 * REGISTRAR UN PAGO — parcial o total.
 *
 * ===========================================================================
 * SE BUSCA LA CUOTA ANTES DE ABRIR EL FORMULARIO
 * ===========================================================================
 * `v_cobranza` no trae `cuota_id` ni `persona_id` —se queda en (contrato,
 * número)—, y `pagos` necesita los dos. Así que al abrir esto se va a buscar
 * la cuota, y si no aparece NO se enseña el formulario: es mejor no ofrecerlo
 * que registrar el dinero contra la cuota equivocada.
 *
 * ===========================================================================
 * PARCIAL Y TOTAL SON EL MISMO FORMULARIO
 * ===========================================================================
 * No hay casilla de «pago total»: se escribe el importe, y quien decide si la
 * cuota queda `pagada` o `parcial` es la comparación en céntimos de
 * `registrarPago`, no una casilla que alguien pueda marcar por costumbre. El
 * saldo pendiente se enseña arriba para no tener que recordarlo.
 *
 * ===========================================================================
 * LA MONEDA NO SE ELIGE LIBRE
 * ===========================================================================
 * Viene fijada a la de la cuota. `registrarPago` rechaza el pago si no
 * coinciden, porque `v_cobranza` calcula el saldo con `cu.monto - sum(pagos)`
 * SIN mirar la moneda del pago: un pago en otra moneda haría que el saldo de
 * esa fila fuera una resta entre monedas distintas, es decir, un número falso.
 */
export function DialogoPago({
  fila,
  cerrar,
  alRegistrar,
}: {
  fila: FilaCobranza
  cerrar: () => void
  alRegistrar: (aviso: string | null) => void
}) {
  const { perfil } = useSesion()

  const [cuota, setCuota] = useState<CuotaParaPago | null>(null)
  const [buscando, setBuscando] = useState(true)
  const [datos, setDatos] = useState<DatosPago>(pagoEnBlanco)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setBuscando(true)

    buscarCuotaParaPago(fila.contratoId, fila.numero)
      .then((encontrada) => {
        if (!vivo) return
        setCuota(encontrada)
        if (encontrada === null) {
          setError(
            'No se encontró la cuota en la tabla `cuotas`, o el contrato no tiene persona ' +
              'legible. No se abre el formulario: registrar un pago contra la cuota equivocada ' +
              'es peor que no registrarlo.',
          )
        } else {
          // La moneda se copia de la cuota y no se deja cambiar (R7).
          setDatos((previo) => ({ ...previo, montoMoneda: encontrada.moneda ?? '' }))
        }
      })
      .catch((fallo: unknown) => {
        if (!vivo) return
        setError(fallo instanceof Error ? fallo.message : String(fallo))
      })
      .finally(() => {
        if (vivo) setBuscando(false)
      })

    return () => {
      vivo = false
    }
  }, [fila.contratoId, fila.numero])

  function cambiar<C extends keyof DatosPago>(campo: C, valor: DatosPago[C]) {
    setDatos((previo) => ({ ...previo, [campo]: valor }))
    setError(null)
  }

  async function guardar() {
    if (guardando || cuota === null) return

    // `creado_por` va explícito: un pago sin autor no se puede auditar (R9).
    if (perfil === null) {
      setError('No hay perfil en sesión. Vuelve a entrar al CRM.')
      return
    }

    setGuardando(true)
    setError(null)

    // El comprobante se sube ANTES del insert, igual que en separaciones: si
    // el insert fallara después, queda un archivo huérfano en el bucket. Es el
    // lado correcto del error — un archivo de más no rompe nada; un pago sin
    // su comprobante, sí.
    let ruta: string | null = null
    if (archivo !== null) {
      const subida = await subirComprobante(archivo, PREFIJO_COMPROBANTES_PAGO)
      if (!subida.ok) {
        setGuardando(false)
        setError(subida.motivo)
        return
      }
      ruta = subida.ruta
    }

    const resultado = await registrarPago(cuota, datos, ruta, perfil.id)
    setGuardando(false)

    if (!resultado.ok) {
      setError(resultado.motivo)
      return
    }
    alRegistrar(resultado.aviso)
  }

  const saldo = aNumero(fila.saldo)
  const importe = aNumero(datos.monto.trim().replace(',', '.'))
  const esParcial = saldo !== null && importe !== null && Math.round(importe * 100) < Math.round(saldo * 100)

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar un pago</DialogTitle>
          <DialogDescription>
            {fila.nombreCompleto} · cuota n.º {fila.numero}
            {fila.codigoUnidad === null ? '' : ` · unidad ${fila.codigoUnidad}`} · vence el{' '}
            {fechaCorta(fila.fechaVencimiento)}
          </DialogDescription>
        </DialogHeader>

        {buscando && (
          <p className="flex items-center gap-2 py-6 text-sm text-suelo-500">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
            Buscando la cuota…
          </p>
        )}

        {!buscando && cuota !== null && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-cal-300 bg-cal p-3 text-sm">
              <div>
                <dt className="text-xs text-suelo-500">Monto de la cuota</dt>
                <dd className="font-bold tabular-nums text-foreground">
                  {formatearMonto(fila.monto, fila.montoMoneda)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-suelo-500">Saldo pendiente</dt>
                <dd className="font-black tabular-nums text-foreground">
                  {formatearMonto(fila.saldo, fila.montoMoneda)}
                </dd>
              </div>
            </dl>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="importe">Monto pagado</Label>
                <Input
                  id="importe"
                  value={datos.monto}
                  onChange={(e) => cambiar('monto', e.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  className="tabular-nums"
                />
                {esParcial && (
                  <p className="text-xs font-bold leading-snug text-suelo-700">
                    Es menor que el saldo: la cuota quedará en{' '}
                    <span className="font-black">parcial</span> y seguirá en esta lista.
                  </p>
                )}
              </div>

              {/* R7 · La moneda es la de la cuota. No se ofrece cambiarla. */}
              <div className="space-y-2">
                <Label htmlFor="moneda-pago">Moneda</Label>
                <select
                  id="moneda-pago"
                  value={datos.montoMoneda}
                  onChange={(e) => cambiar('montoMoneda', e.target.value as Moneda | '')}
                  disabled={cuota.moneda !== null}
                  className={claseSelect}
                >
                  <option value="">Elige…</option>
                  {MONEDAS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <p className="text-xs leading-snug text-suelo-500">
                  {cuota.moneda === null
                    ? '🔴 La cuota no tiene moneda legible.'
                    : 'La de la cuota. Un pago en otra moneda haría falso el saldo.'}
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fecha-pago">Fecha del pago</Label>
                <Input
                  id="fecha-pago"
                  type="date"
                  value={datos.fechaPago}
                  onChange={(e) => cambiar('fechaPago', e.target.value)}
                  className="tabular-nums"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="medio">Medio</Label>
                <select
                  id="medio"
                  value={datos.medio}
                  onChange={(e) => cambiar('medio', e.target.value)}
                  className={claseSelect}
                >
                  <option value="">Sin especificar</option>
                  {MEDIOS_DE_PAGO.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="banco">Banco</Label>
                <Input
                  id="banco"
                  value={datos.banco}
                  onChange={(e) => cambiar('banco', e.target.value)}
                  autoComplete="off"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="operacion">N.º de operación</Label>
                <Input
                  id="operacion"
                  value={datos.nroOperacion}
                  onChange={(e) => cambiar('nroOperacion', e.target.value)}
                  autoComplete="off"
                  className="tabular-nums"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="comprobante">Comprobante</Label>
              <Input
                id="comprobante"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
                className="cursor-pointer file:mr-3 file:cursor-pointer file:border-0 file:bg-transparent file:text-sm file:font-bold"
              />
              <p className="flex items-start gap-1.5 text-xs leading-snug text-suelo-500">
                <Paperclip className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                Va al bucket privado <code>comprobantes</code>. Una vez subido no se puede borrar
                desde el CRM (R8): es la prueba de que entró un dinero.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="nota-pago">Nota</Label>
              <Input
                id="nota-pago"
                value={datos.nota}
                onChange={(e) => cambiar('nota', e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
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

        <DialogFooter>
          <Button variant="ghost" onClick={cerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={() => void guardar()} disabled={guardando || cuota === null}>
            {guardando ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Registrando…
              </>
            ) : (
              'Registrar el pago'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const claseSelect = cn(
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1',
  'text-sm shadow-sm transition-colors',
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
  'disabled:cursor-not-allowed disabled:opacity-50',
)
