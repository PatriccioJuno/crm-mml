import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Loader2, UserPlus } from 'lucide-react'
import { CabeceraPantalla } from '@/componentes/marca/CabeceraPantalla'
import { Badge } from '@/componentes/ui/badge'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import { Input } from '@/componentes/ui/input'
import { Label } from '@/componentes/ui/label'
import { cn } from '@/lib/utils'
import { fechaHora } from '@/lib/fechas'
import { useSesion } from '@/auth/ContextoSesion'
import {
  ORIGENES,
  registrarRapido,
  type Origen,
  type RegistroCreado,
} from '@/lib/registro-rapido'

/**
 * REGISTRO RAPIDO — cuatro campos y un boton.
 *
 * ---------------------------------------------------------------------------
 * EL OBJETIVO DURO ES EL TIEMPO: MENOS DE 30 SEGUNDOS
 * ---------------------------------------------------------------------------
 * Se usa en directo, en un celular, con varias personas escribiendo a la vez.
 * Todo lo que hay aqui esta puesto (o quitado) por esa razon:
 *
 *  · Foco automatico en el nombre al abrir y despues de cada guardado.
 *  · Enter avanza al campo siguiente y, en el ultimo, guarda. Sin ratón.
 *  · Sin pasos intermedios: ni asistente, ni confirmacion, ni navegacion.
 *    Guardar deja el formulario limpio y listo para el siguiente.
 *  · El desplegable y la casilla son controles NATIVOS, no los de Radix. Un
 *    <select> nativo abre el selector del sistema operativo en el movil (mucho
 *    mas rapido que un menu flotante) y una casilla nativa responde a Enter y
 *    a Espacio sin codigo extra. En una pantalla donde el requisito es el
 *    tiempo, eso pesa mas que la uniformidad visual; el resto de la interfaz
 *    (Card, Badge, Button, Input, Label) si es shadcn/ui.
 *  · Un cronometro real mide cada alta, para que el objetivo de 30 segundos se
 *    pueda comprobar en vez de suponer.
 *
 * La transaccion (persona + oportunidad + tarea) esta en la base, en
 * `fn_registro_rapido`. Aqui no se hacen tres inserciones sueltas: ver el
 * encabezado de src/lib/registro-rapido.ts.
 */

/** Objetivo declarado en el encargo. Solo se usa para colorear el cronometro. */
const OBJETIVO_SEGUNDOS = 30

type Campo = 'nombre' | 'telefono' | 'origen' | 'consentimiento'

export function PantallaRegistroRapido() {
  const { perfil } = useSesion()

  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  // El origen se conserva entre altas: en un live entran veinte seguidos por
  // el mismo canal. No es dato personal, asi que mantenerlo no arrastra nada.
  const [origen, setOrigen] = useState<Origen>('live')
  // El consentimiento NO se conserva: es un acto afirmativo de cada persona
  // (Ley 29733). Arrastrarlo seria darlo por supuesto.
  const [consentimiento, setConsentimiento] = useState(false)

  const [guardando, setGuardando] = useState(false)
  // `campo` se declara con `| undefined` explicito porque el proyecto compila
  // con `exactOptionalPropertyTypes`: ahi «opcional» y «puede ser undefined»
  // no son lo mismo.
  const [error, setError] = useState<{ motivo: string; campo?: Campo | undefined } | null>(null)
  const [ultimo, setUltimo] = useState<{ registro: RegistroCreado; nombre: string } | null>(null)
  const [altas, setAltas] = useState(0)
  const [segundos, setSegundos] = useState<number | null>(null)

  const refNombre = useRef<HTMLInputElement>(null)
  const refTelefono = useRef<HTMLInputElement>(null)
  const refOrigen = useRef<HTMLSelectElement>(null)
  const refConsentimiento = useRef<HTMLInputElement>(null)
  /** Momento de la primera tecla de este registro. null = aun no ha empezado. */
  const inicio = useRef<number | null>(null)

  // Foco al abrir la pantalla.
  useEffect(() => {
    refNombre.current?.focus()
  }, [])

  /** Arranca el cronometro en la primera tecla, no al montar la pantalla. */
  const marcarInicio = useCallback(() => {
    if (inicio.current === null) inicio.current = Date.now()
  }, [])

  function limpiar() {
    setNombre('')
    setTelefono('')
    setConsentimiento(false)
    setError(null)
    inicio.current = null
    refNombre.current?.focus()
  }

  async function guardar() {
    if (guardando || perfil === null) return

    setGuardando(true)
    setError(null)

    const nombreEnviado = nombre.trim()
    const resultado = await registrarRapido({ nombre, telefono, origen, consentimiento })

    if (!resultado.ok) {
      setGuardando(false)
      setError({ motivo: resultado.motivo, campo: resultado.campo })
      // El foco vuelve al campo que fallo: corregir y seguir, sin buscar nada.
      const destino: Record<Campo, HTMLElement | null> = {
        nombre: refNombre.current,
        telefono: refTelefono.current,
        origen: refOrigen.current,
        consentimiento: refConsentimiento.current,
      }
      if (resultado.campo !== undefined) destino[resultado.campo]?.focus()
      return
    }

    const transcurrido = inicio.current === null ? null : (Date.now() - inicio.current) / 1000
    setSegundos(transcurrido)
    setUltimo({ registro: resultado.registro, nombre: nombreEnviado })
    setAltas((n) => n + 1)
    setGuardando(false)
    limpiar()
  }

  /**
   * Enter avanza; en el ultimo control, guarda.
   * En el <select> se deja pasar el comportamiento nativo de las flechas: solo
   * se intercepta Enter.
   */
  function alPulsar(evento: React.KeyboardEvent, siguiente: HTMLElement | null) {
    if (evento.key !== 'Enter') return
    evento.preventDefault()
    if (siguiente === null) void guardar()
    else siguiente.focus()
  }

  const listo = nombre.trim() !== '' && telefono.trim() !== '' && consentimiento

  return (
    <>
      {/* Fuera del contenedor de ancho máximo: la franja azul llega al borde.
          El texto de dentro se alinea al mismo ancho vía `ancho="estrecho"`. */}
      <CabeceraPantalla
        titulo="Registro rápido"
        ancho="estrecho"
        descripcion="Cuatro campos. Enter avanza; en la casilla, Enter guarda."
        distintivos={
          altas > 0 ? (
            <Badge variant="cal" aria-live="polite">
              {altas} {altas === 1 ? 'registro' : 'registros'} en esta sesión
            </Badge>
          ) : undefined
        }
      />

      <div className="mx-auto w-full max-w-xl">
      <Card className="overflow-hidden">
        {/* El contador de altas de la sesión subió a la cabecera de pantalla:
            en el diseño es un dato de contexto de la pantalla, no del
            formulario, y ahí no compite con el título de la tarjeta. */}
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-suelo-500" strokeWidth={1.75} aria-hidden="true" />
            Nuevo prospecto
          </CardTitle>
        </CardHeader>

        <CardContent className="pb-6">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void guardar()
            }}
            className="space-y-5"
          >
            {/* ---- 1 · NOMBRE ---- */}
            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre</Label>
              <Input
                id="nombre"
                ref={refNombre}
                value={nombre}
                onChange={(e) => {
                  marcarInicio()
                  setNombre(e.target.value)
                }}
                onKeyDown={(e) => alPulsar(e, refTelefono.current)}
                autoComplete="off"
                autoCapitalize="words"
                spellCheck={false}
                enterKeyHint="next"
                placeholder="Nombre y apellidos"
                aria-invalid={error?.campo === 'nombre'}
                className={cn(error?.campo === 'nombre' && 'border-alerta')}
              />
            </div>

            {/* ---- 2 · TELEFONO ---- */}
            <div className="space-y-2">
              <Label htmlFor="telefono">Teléfono</Label>
              <Input
                id="telefono"
                ref={refTelefono}
                value={telefono}
                onChange={(e) => {
                  marcarInicio()
                  setTelefono(e.target.value)
                }}
                onKeyDown={(e) => alPulsar(e, refOrigen.current)}
                // `tel` abre el teclado numerico en el movil. La normalizacion a
                // E.164 la hace src/lib/telefono.ts, no este campo.
                type="tel"
                inputMode="tel"
                autoComplete="off"
                enterKeyHint="next"
                placeholder="999888777"
                aria-invalid={error?.campo === 'telefono'}
                className={cn(error?.campo === 'telefono' && 'border-alerta')}
              />
            </div>

            {/* ---- 3 · ORIGEN ---- */}
            <div className="space-y-2">
              <Label htmlFor="origen">Origen</Label>
              <select
                id="origen"
                ref={refOrigen}
                value={origen}
                onChange={(e) => setOrigen(e.target.value as Origen)}
                onKeyDown={(e) => alPulsar(e, refConsentimiento.current)}
                // Mismas medidas que <Input>: 52 px de alto, borde de 1.5 px y
                // texto de 16 px. Un <select> nativo no hereda de ese
                // componente, así que si allí cambian las medidas, aquí
                // también. El porqué de los 52 px está en ui/input.tsx.
                className={cn(
                  'flex h-[3.25rem] w-full rounded-md border-[1.5px] border-input bg-background px-4 py-1',
                  'text-base font-bold text-foreground transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                {ORIGENES.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.etiqueta}
                  </option>
                ))}
              </select>
              <p className="text-xs text-suelo-500">
                Se mantiene entre registros: en un live entran varios seguidos por el mismo canal.
              </p>
            </div>

            {/* ---- 4 · CONSENTIMIENTO ---- */}
            <div
              className={cn(
                'flex items-start gap-3 rounded-md border p-3',
                error?.campo === 'consentimiento' ? 'border-alerta' : 'border-border',
              )}
            >
              <input
                id="consentimiento"
                ref={refConsentimiento}
                type="checkbox"
                checked={consentimiento}
                onChange={(e) => setConsentimiento(e.target.checked)}
                onKeyDown={(e) => alPulsar(e, null)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-azul"
              />
              <Label htmlFor="consentimiento" className="cursor-pointer text-sm font-normal leading-snug">
                Autoriza que SCP Inmobiliaria guarde sus datos y le contacte.
                <span className="mt-0.5 block text-xs text-suelo-500">
                  Obligatorio: Ley 29733. Sin esto no se guarda nada.
                </span>
              </Label>
            </div>

            {/* ---- ERROR ---- */}
            {error !== null && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md bg-alerta-suave p-3 text-sm font-bold text-alerta"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                {error.motivo}
              </p>
            )}
          </form>
        </CardContent>

        {/* ---- ACCION PRINCIPAL ----
            Es el unico ambar de la pantalla, y va sobre azul: la regla dura de
            marca dice que el ambar nunca toca una superficie clara. Por eso el
            pie de la tarjeta es azul, en vez de poner un boton ambar sobre cal. */}
        <div className="flex flex-col items-stretch gap-3 bg-azul px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
          <p className="text-xs leading-snug text-azul-300">
            Crea persona, oportunidad y tarea de primer contacto.
            <br />
            Todo o nada, en una sola transacción.
          </p>
          <Button
            type="button"
            variant="ambar"
            size="lg"
            onClick={() => void guardar()}
            disabled={!listo || guardando}
            className={cn(
              'w-full shrink-0 sm:w-auto',
              // Deshabilitado no se «apaga» con opacidad: sobre azul, un ámbar
              // al 50 % queda ilegible. Se cambia por el azul claro del propio
              // bloque, que dice «todavía no» sin desaparecer.
              'disabled:bg-azul-600 disabled:text-azul-300 disabled:opacity-100',
            )}
          >
            {guardando ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Guardando…
              </>
            ) : (
              'Guardar'
            )}
          </Button>
        </div>
      </Card>

      {/* ---- CONFIRMACION DEL ULTIMO ALTA ----
          No interrumpe: el formulario ya esta limpio y enfocado. Esto es el
          acuse de recibo, debajo, para mirarlo solo si hace falta. */}
      {ultimo !== null && (
        <Card className="mt-4 shadow-none" aria-live="polite">
          <CardContent className="flex items-start gap-3 py-4">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-suelo-700" strokeWidth={2} aria-hidden="true" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-bold text-foreground">
                Guardado: {ultimo.nombre}
                {segundos !== null && (
                  <span
                    className={cn(
                      'ml-2 text-xs font-bold',
                      segundos <= OBJETIVO_SEGUNDOS ? 'text-suelo-500' : 'text-alerta',
                    )}
                  >
                    {segundos.toFixed(1)} s
                    {segundos > OBJETIVO_SEGUNDOS && ` · sobre el objetivo de ${OBJETIVO_SEGUNDOS} s`}
                  </span>
                )}
              </p>

              <p className="mt-1 text-suelo-700">
                Tarea «Primer contacto» para {fechaHora(ultimo.registro.tareaVenceEl)}.
              </p>

              {/* El plazo real sale de parametros(sla_primera_respuesta_minutos).
                  Si no esta cargado hay que decirlo, no disimularlo con el valor
                  «sugerido» de una nota (07-crm\CLAUDE.md §2). */}
              {ultimo.registro.slaMinutos === null ? (
                <p className="mt-2 rounded-md bg-alerta-suave p-2 text-xs font-bold text-alerta">
                  🔴 La tarea vence de inmediato porque el parámetro{' '}
                  <code>sla_primera_respuesta_minutos</code> no tiene valor cargado. Cárgalo desde{' '}
                  <code>00-fuente-de-verdad</code> para que el plazo sea el real.
                </p>
              ) : (
                <p className="mt-1 text-xs text-suelo-500">
                  Plazo: {ultimo.registro.slaMinutos} min, según{' '}
                  <code>parametros(sla_primera_respuesta_minutos)</code>.
                </p>
              )}

              {ultimo.registro.personaReutilizada && (
                <p className="mt-2 text-xs text-suelo-700">
                  🟡 Ya existía una ficha con ese teléfono: se reutilizó en vez de duplicarla.
                  {ultimo.registro.oportunidadReutilizada &&
                    ' También tenía una oportunidad activa, así que no se abrió otra.'}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </>
  )
}
