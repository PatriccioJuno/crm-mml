import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog'
import { Input, claseCampo } from '@/componentes/ui/input'
import { Label } from '@/componentes/ui/label'
import { cn } from '@/lib/utils'
import {
  MONEDAS,
  SEMAFOROS_PARAMETRO,
  guardarParametro,
  parametroAFormulario,
  simboloSemaforo,
  tieneValor,
  type CampoParametro,
  type DatosParametro,
  type EstadoSemaforo,
  type Parametro,
} from '@/lib/parametros'

/**
 * Edición de un parámetro.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTA PANTALLA NO ES UN BOTÓN DE «APROBAR»
 * ---------------------------------------------------------------------------
 * La tentación era un botón que pusiera 🟢 de un clic. Sería más cómodo y sería
 * un error: lo que hace confiable a `parametros` no es que las cifras estén
 * cargadas, es que cada una diga de dónde sale. Un aprobar-de-un-clic habría
 * construido una forma más rápida de generar los 8 precios y las 4 políticas de
 * financiamiento en conflicto que hoy documenta 00-fuente-de-verdad.
 *
 * Así que aquí hay dos fricciones distintas y solo se ha quitado una:
 *   · escribir SQL para ratificar un número — fricción accidental, eliminada.
 *   · decir de dónde sale el número — fricción esencial, conservada y visible.
 *
 * El botón de guardar no se apaga por capricho: se apaga mientras falte la
 * fuente, o mientras se intente confirmar un parámetro sin valor.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTE FORMULARIO NO GARANTIZA
 * ---------------------------------------------------------------------------
 * `descripcion` y `fuente` son `not null` en la base, así que esas dos las
 * impone la columna. En cambio «🟢 exige un valor» vive solo aquí y en
 * `validar` de src/lib/parametros.ts: NO hay todavía una restricción
 * `verde_exige_valor` en la tabla. Un formulario se esquiva —el panel de
 * Supabase, una importación—; una restricción no. Queda anotado, no disimulado.
 */
export function DialogoParametro({
  parametro,
  cerrar,
  alGuardar,
}: {
  parametro: Parametro
  cerrar: () => void
  alGuardar: () => void
}) {
  const [datos, setDatos] = useState<DatosParametro>(() => parametroAFormulario(parametro))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<{ motivo: string; campo?: CampoParametro | undefined } | null>(
    null,
  )

  function cambiar<C extends keyof DatosParametro>(campo: C, valor: DatosParametro[C]) {
    setDatos((previo) => ({ ...previo, [campo]: valor }))
    setError(null)
  }

  async function enviar() {
    if (guardando) return
    setGuardando(true)
    setError(null)

    const resultado = await guardarParametro(datos, parametro.id)
    setGuardando(false)

    if (!resultado.ok) {
      setError({ motivo: resultado.motivo, campo: resultado.campo })
      return
    }
    alGuardar()
  }

  const semaforoElegido = SEMAFOROS_PARAMETRO.find((s) => s.valor === datos.estadoSemaforo)
  const confirmando = datos.estadoSemaforo === 'verde'
  const faltaFuente = datos.fuente.trim() === ''
  const confirmaSinValor = confirmando && !tieneValor(datos)

  // Se apaga por una razón que el usuario puede leer justo debajo. Un botón
  // apagado sin explicación se vive como un fallo del sistema.
  const noSePuedeGuardar = guardando || faltaFuente || confirmaSinValor

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{parametro.id}</DialogTitle>
          <DialogDescription>{parametro.descripcion}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(evento) => {
            evento.preventDefault()
            void enviar()
          }}
          className="space-y-5"
        >
          {/* ---- ESTADO ---- */}
          <div className="space-y-2">
            <Label htmlFor="semaforo">Estado</Label>
            <select
              id="semaforo"
              value={datos.estadoSemaforo}
              onChange={(e) => cambiar('estadoSemaforo', e.target.value as EstadoSemaforo)}
              className={claseCampo}
            >
              {SEMAFOROS_PARAMETRO.map((s) => (
                <option key={s.valor} value={s.valor}>
                  {simboloSemaforo(s.valor)} {s.etiqueta}
                </option>
              ))}
            </select>
            {semaforoElegido !== undefined && (
              <p className="text-xs leading-snug text-suelo-500">{semaforoElegido.ayuda}</p>
            )}
          </div>

          {/* ---- EL VALOR, EN SUS CUATRO HUECOS ---- */}
          <fieldset className="space-y-3 rounded-md border border-input p-4">
            <legend className="px-1 text-sm font-bold">Valor</legend>
            <p className="text-xs leading-snug text-suelo-500">
              La tabla tiene cuatro columnas de valor y cada parámetro usa la que le corresponde
              según su unidad. Rellena solo esa; las demás quedan vacías.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo
                id="valor-entero"
                etiqueta="Entero"
                valor={datos.valorEntero}
                alCambiar={(v) => cambiar('valorEntero', v)}
                error={error?.campo === 'valorEntero' || error?.campo === 'valor'}
                modo="numeric"
                ayuda="Plazos, minutos, cupos, días."
              />
              <Campo
                id="valor-numerico"
                etiqueta="Monto"
                valor={datos.valorNumerico}
                alCambiar={(v) => cambiar('valorNumerico', v)}
                error={error?.campo === 'valorNumerico' || error?.campo === 'valor'}
                modo="decimal"
                ayuda="Precios, comisiones, porcentajes."
              />
              <div className="space-y-2">
                <Label htmlFor="valor-moneda">Moneda del monto</Label>
                <select
                  id="valor-moneda"
                  value={datos.valorMoneda}
                  onChange={(e) => cambiar('valorMoneda', e.target.value)}
                  className={claseCampo}
                >
                  <option value="">— sin moneda —</option>
                  {MONEDAS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-suelo-500">
                  Todo monto lleva su moneda al lado (R7). Nunca se suman dos monedas.
                </p>
              </div>
              <Campo
                id="unidad"
                etiqueta="Unidad"
                valor={datos.unidad}
                alCambiar={(v) => cambiar('unidad', v)}
                ayuda="minutos · dias_calendario · m2 · porcentaje · monto"
              />
            </div>

            <Campo
              id="valor-texto"
              etiqueta="Texto"
              valor={datos.valorTexto}
              alCambiar={(v) => cambiar('valorTexto', v)}
              error={error?.campo === 'valor'}
              ayuda="Para lo que no es una cifra: una política, un nombre, una condición."
            />

            {confirmaSinValor && (
              <p className="flex items-start gap-2 text-xs font-bold leading-snug text-alerta">
                <AlertTriangle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                Un 🟢 sin cifra se lee como «ya está decidido», y no lo está. Carga el valor, o
                déjalo en 🔵 propuesta.
              </p>
            )}
          </fieldset>

          {/* ---- LA FUENTE. El campo que da sentido a todo lo demás. ---- */}
          <div className="space-y-2">
            <Label htmlFor="fuente">
              Fuente <span className="text-alerta">· obligatoria</span>
            </Label>
            <Input
              id="fuente"
              value={datos.fuente}
              onChange={(e) => cambiar('fuente', e.target.value)}
              placeholder="Ruta exacta en 00-fuente-de-verdad, o el acta que lo decidió"
              aria-invalid={error?.campo === 'fuente' || faltaFuente}
              className={cn((error?.campo === 'fuente' || faltaFuente) && 'border-alerta')}
            />
            <p className="text-xs leading-snug text-suelo-700">
              Dónde está escrito este número. Si vas a ponerlo en 🟢, aquí tiene que ir el
              documento o el acta de verdad — no un «acta 04» que todavía no existe. Mejor un mes
              más en 🔵 que un verde sin respaldo.
            </p>
          </div>

          {/* ---- NOTA ---- */}
          <div className="space-y-2">
            <Label htmlFor="nota">Nota</Label>
            <textarea
              id="nota"
              value={datos.nota}
              onChange={(e) => cambiar('nota', e.target.value)}
              rows={3}
              className={cn(claseCampo, 'h-auto py-2')}
              placeholder="Contexto, fundamento, qué falta para cerrarlo."
            />
          </div>

          {error !== null && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md bg-alerta-suave p-3 text-sm font-bold text-alerta"
            >
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0"
                strokeWidth={2}
                aria-hidden="true"
              />
              {error.motivo}
            </p>
          )}

          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            {faltaFuente && (
              <p className="mr-auto text-xs font-bold text-alerta">
                Falta la fuente para poder guardar.
              </p>
            )}
            <Button type="button" variant="ghost" onClick={cerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" disabled={noSePuedeGuardar}>
              {guardando ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Guardando…
                </>
              ) : (
                'Guardar'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Campo({
  id,
  etiqueta,
  valor,
  alCambiar,
  error = false,
  ayuda,
  modo,
}: {
  id: string
  etiqueta: string
  valor: string
  alCambiar: (valor: string) => void
  error?: boolean
  ayuda?: string
  modo?: 'decimal' | 'numeric'
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{etiqueta}</Label>
      <Input
        id={id}
        value={valor}
        onChange={(evento) => alCambiar(evento.target.value)}
        autoComplete="off"
        {...(modo === undefined ? {} : { inputMode: modo })}
        aria-invalid={error}
        className={cn(error && 'border-alerta')}
      />
      {ayuda !== undefined && <p className="text-xs text-suelo-500">{ayuda}</p>}
    </div>
  )
}
