import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  CalendarPlus,
  Check,
  CheckCheck,
  History,
  Loader2,
  Send,
  UserX,
  X,
} from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import { claseCampo } from '@/componentes/ui/input'
import { GrupoChips } from '@/componentes/crm/GrupoChips'
import { AvisoPendiente } from '@/componentes/crm/AvisoPendiente'
import { cn } from '@/lib/utils'
import type { FilaCartera } from '@/lib/cartera'
import {
  ESTADOS_VISITA,
  RESULTADOS_VISITA,
  TIPOS_VISITA,
  actualizarVisita,
  cargarVisitas,
  type AccionVisita,
  type ResultadoVisita,
  type Visita,
} from '@/lib/visitas'
import type { PlantillaAviso } from '@/lib/aviso-visita'
import { deEntradaLocal, diaYHora, fechaHora, sumarDias } from '@/lib/fechas'
import { Fallo, invalidarTrasAccion } from './PanelContacto'
import { DialogoAgendarVisita } from './DialogoAgendarVisita'
import { DialogoAvisoVisita } from './DialogoAvisoVisita'

// El modo llamadas (cola/index.tsx) importa el diálogo desde aquí: se
// re-exporta para no romper ese import y para que «todo lo de visitas» se
// encuentre en un solo sitio.
export { DialogoAgendarVisita }

/**
 * VISITAS DE UNA OPORTUNIDAD — SPEC §7 S4.
 *
 * Por qué una sección propia y no una tarea más: la visita es el paso que más
 * convierte y el que más se pierde (el vendedor la pacta por WhatsApp y nadie
 * más se entera). Aquí queda la visita abierta, bien grande, con sus acciones,
 * y debajo el historial — cuántas veces no vino es un dato de cierre.
 *
 * Toda acción pasa por `fn_actualizar_visita` / `fn_agendar_visita`: la base
 * deja la interacción, el evento (R9) y la siguiente tarea (R6). Esta pantalla
 * no calcula nada que la base ya decide.
 */

const ABIERTAS = new Set(['agendada', 'confirmada'])

function etiquetaDe(lista: readonly { valor: string; etiqueta: string }[], valor: string | null): string {
  if (valor === null) return '—'
  return lista.find((o) => o.valor === valor)?.etiqueta ?? valor
}

/** La visita que se está trabajando: la abierta más próxima (puede haber una vieja sin cerrar). */
function visitaAbierta(visitas: readonly Visita[]): Visita | null {
  let mejor: Visita | null = null
  for (const v of visitas) {
    if (!ABIERTAS.has(v.estado)) continue
    if (mejor === null || new Date(v.inicioEl).getTime() < new Date(mejor.inicioEl).getTime()) mejor = v
  }
  return mejor
}

// Próximo paso tras una visita realizada. Son atajos de pantalla (los mismos
// que PanelContacto), no una condición comercial: sin elegir, lo decide la base.
const PROXIMOS = [
  { valor: 'manana', etiqueta: 'Mañana' },
  { valor: 'tres', etiqueta: 'En 3 días' },
  { valor: 'semana', etiqueta: 'En una semana' },
  { valor: 'elegir', etiqueta: 'Elegir fecha' },
] as const

type Proximo = (typeof PROXIMOS)[number]['valor']

const DIAS_PROXIMO: Record<Exclude<Proximo, 'elegir'>, number> = { manana: 1, tres: 3, semana: 7 }

type Panel = Exclude<AccionVisita, 'confirmar'> | null

export function SeccionVisitas({
  fila,
  puedeEditar,
  alCambiar,
  abrirAgenda = false,
  alCerrarAgenda,
}: {
  fila: FilaCartera
  puedeEditar: boolean
  alCambiar?: (() => void) | undefined
  abrirAgenda?: boolean | undefined
  alCerrarAgenda?: (() => void) | undefined
}) {
  const cliente = useQueryClient()
  const idNota = useId()
  const idFecha = useId()

  const [agendaLocal, setAgendaLocal] = useState(false)
  const [reprogramando, setReprogramando] = useState<Visita | null>(null)
  const [aviso, setAviso] = useState<{ visitaId: string; plantilla: PlantillaAviso } | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [resultado, setResultado] = useState<ResultadoVisita | null>(null)
  const [proximo, setProximo] = useState<Proximo | null>('manana')
  const [fechaProxima, setFechaProxima] = useState('')
  const [nota, setNota] = useState('')
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<{ texto: string; avisos: string[]; canceladaId: string | null } | null>(
    null,
  )

  const visitas = useQuery({
    queryKey: ['visitas', fila.id],
    queryFn: () => cargarVisitas(fila.id),
  })

  const lista = visitas.data ?? []
  const abierta = visitaAbierta(lista)
  const historial = lista.filter((v) => v.id !== abierta?.id)
  const operable = puedeEditar && !fila.noContactar

  function abrirPanel(p: Panel) {
    setPanel(p)
    setResultado(null)
    setProximo('manana')
    setFechaProxima('')
    setNota('')
    setError(null)
  }

  function cerrarAgenda() {
    setAgendaLocal(false)
    setReprogramando(null)
    alCerrarAgenda?.()
  }

  function proximoEl(): string | null {
    if (proximo === null) return null
    if (proximo === 'elegir') return deEntradaLocal(fechaProxima)
    return sumarDias(new Date(), DIAS_PROXIMO[proximo]).toISOString()
  }

  async function actuar(visita: Visita, accion: AccionVisita) {
    if (accion === 'realizada' && resultado === null) {
      return setError('Elige cómo salió la visita.')
    }
    if (accion === 'realizada' && proximo === 'elegir' && proximoEl() === null) {
      return setError('Elige la fecha del próximo paso.')
    }
    setTrabajando(accion)
    setError(null)
    const r = await actualizarVisita({
      visitaId: visita.id,
      accion,
      resultado: resultado ?? undefined,
      nota,
      proximoEl: accion === 'realizada' ? proximoEl() : null,
    })
    setTrabajando(null)
    if (!r.ok) return setError(r.motivo)

    const estado = etiquetaDe(ESTADOS_VISITA, r.datos.estado)
    const veces =
      accion === 'no_asistio' && r.datos.noAsistioTotal > 1 ? ` · ya van ${r.datos.noAsistioTotal} sin venir` : ''
    setHecho({
      texto: `Listo. La visita quedó: ${estado}${veces}.`,
      avisos: r.datos.avisos,
      canceladaId: accion === 'cancelar' ? visita.id : null,
    })
    setPanel(null)
    invalidarTrasAccion(cliente, [['visitas', fila.id], ['actividad', fila.id]])
    alCambiar?.()
  }

  return (
    <Card id="visitas">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-lg font-black">
          <CalendarClock className="h-5 w-5" aria-hidden="true" />
          Visitas
        </CardTitle>
        {operable && abierta === null && (
          <Button className="h-11 sm:h-10" onClick={() => setAgendaLocal(true)}>
            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
            Agendar visita
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {fila.noContactar && (
          <AvisoPendiente>Pidió que no lo contacten: no se agendan visitas ni se le envían avisos.</AvisoPendiente>
        )}

        {visitas.isPending && <p className="text-sm text-suelo-700">Cargando visitas…</p>}
        {visitas.isError && <Fallo>No se pudieron leer las visitas. {visitas.error.message}</Fallo>}

        {visitas.isSuccess && abierta === null && (
          <p className="text-sm text-suelo-700">
            No tiene una visita pendiente.
            {operable && ' Si en la conversación quedó una fecha, agéndala aquí: el día anterior aparece en Hoy.'}
          </p>
        )}

        {abierta !== null && (
          <div className="space-y-3 rounded-md border-2 border-azul p-4">
            <div>
              <p className="text-sm font-bold text-suelo-700">{etiquetaDe(TIPOS_VISITA, abierta.tipo)}</p>
              <p className="text-xl font-black text-suelo">{diaYHora(abierta.inicioEl)}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-suelo">
                <span className="inline-flex items-center gap-1 font-bold">
                  {abierta.estado === 'confirmada' ? (
                    <CheckCheck className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <CalendarClock className="h-4 w-4" aria-hidden="true" />
                  )}
                  {etiquetaDe(ESTADOS_VISITA, abierta.estado)}
                </span>
                {abierta.confirmadaEl !== null && <span>confirmada el {fechaHora(abierta.confirmadaEl)}</span>}
                {abierta.vieneCodecisor === true && <span>viene con quien decide</span>}
                {abierta.vieneCodecisor === false && <span>viene sin quien decide</span>}
              </p>
              <p className="mt-1 text-sm text-suelo-700">
                {abierta.avisoEnviadoEl !== null
                  ? `Aviso enviado el ${fechaHora(abierta.avisoEnviadoEl)}${abierta.avisoCanal !== null ? ` · ${abierta.avisoCanal}` : ''}`
                  : 'Todavía no se le ha enviado el aviso.'}
              </p>
              {abierta.nota !== null && <p className="mt-1 text-sm text-suelo">Nota: {abierta.nota}</p>}
            </div>

            {operable && (
              <div className="flex flex-wrap gap-2">
                {abierta.estado === 'agendada' && (
                  <Button
                    variant="outline"
                    className="h-11 sm:h-10"
                    disabled={trabajando !== null}
                    onClick={() => void actuar(abierta, 'confirmar')}
                  >
                    {trabajando === 'confirmar' ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    )}
                    Confirmó
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="h-11 sm:h-10"
                  onClick={() =>
                    setAviso({
                      visitaId: abierta.id,
                      plantilla: abierta.avisoEnviadoEl === null ? 'confirmacion' : 'recordatorio',
                    })
                  }
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  {abierta.avisoEnviadoEl === null ? 'Enviar aviso' : 'Enviar recordatorio'}
                </Button>
                <Button
                  variant={panel === 'realizada' ? 'default' : 'outline'}
                  className="h-11 sm:h-10"
                  onClick={() => abrirPanel(panel === 'realizada' ? null : 'realizada')}
                >
                  <CheckCheck className="h-4 w-4" aria-hidden="true" />
                  Realizada
                </Button>
                <Button
                  variant={panel === 'no_asistio' ? 'default' : 'outline'}
                  className="h-11 sm:h-10"
                  onClick={() => abrirPanel(panel === 'no_asistio' ? null : 'no_asistio')}
                >
                  <UserX className="h-4 w-4" aria-hidden="true" />
                  No asistió
                </Button>
                <Button
                  variant="outline"
                  className="h-11 sm:h-10"
                  onClick={() => {
                    setReprogramando(abierta)
                    setAgendaLocal(true)
                  }}
                >
                  <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                  Reprogramar
                </Button>
                <Button
                  variant={panel === 'cancelar' ? 'default' : 'ghost'}
                  className="h-11 sm:h-10"
                  onClick={() => abrirPanel(panel === 'cancelar' ? null : 'cancelar')}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  Cancelar
                </Button>
              </div>
            )}

            {panel !== null && (
              <div className="space-y-3 border-t border-input pt-3">
                {panel === 'realizada' && (
                  <>
                    <GrupoChips
                      etiqueta="¿Cómo salió?"
                      opciones={RESULTADOS_VISITA}
                      valor={resultado}
                      alCambiar={setResultado}
                    />
                    {resultado === 'separo' && (
                      <AvisoPendiente>
                        Registra la separación en{' '}
                        <Link to="/separaciones" className="font-bold underline">
                          Separaciones
                        </Link>
                        : solo Dirección la verifica (R2) y sin eso no hay constancia (R3).
                      </AvisoPendiente>
                    )}
                    <GrupoChips
                      etiqueta="Próximo paso"
                      opciones={PROXIMOS}
                      valor={proximo}
                      alCambiar={setProximo}
                      permitirVacio
                    />
                    {proximo === 'elegir' && (
                      <div>
                        <label htmlFor={idFecha} className="text-sm font-bold text-suelo">
                          Fecha y hora del próximo paso
                        </label>
                        <input
                          id={idFecha}
                          type="datetime-local"
                          value={fechaProxima}
                          onChange={(e) => setFechaProxima(e.target.value)}
                          className={claseCampo}
                        />
                      </div>
                    )}
                    {proximo === null && (
                      <AvisoPendiente>Sin fecha, la base programa el siguiente seguimiento (R6).</AvisoPendiente>
                    )}
                  </>
                )}
                {panel === 'no_asistio' && (
                  <p className="text-sm text-suelo">
                    Queda como «No asistió» y se programa volver a llamarlo. ¿Confirmas?
                  </p>
                )}
                {panel === 'cancelar' && (
                  <p className="text-sm text-suelo">
                    La visita se cancela (no se borra: queda en el historial). Después puedes avisarle.
                  </p>
                )}
                <div>
                  <label htmlFor={idNota} className="text-sm font-bold text-suelo">
                    Nota (opcional)
                  </label>
                  <textarea
                    id={idNota}
                    rows={2}
                    maxLength={1000}
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    placeholder={panel === 'realizada' ? 'Qué vio, qué preguntó, qué quedó pendiente…' : 'Por qué'}
                    className={cn(claseCampo, 'h-auto py-2')}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    className="h-11 sm:h-10"
                    variant={panel === 'cancelar' ? 'destructive' : 'default'}
                    disabled={trabajando !== null}
                    onClick={() => void actuar(abierta, panel)}
                  >
                    {trabajando === panel && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {panel === 'realizada'
                      ? 'Guardar resultado'
                      : panel === 'no_asistio'
                        ? 'Sí, no asistió'
                        : 'Sí, cancelar la visita'}
                  </Button>
                  <Button variant="ghost" className="h-11 sm:h-10" onClick={() => abrirPanel(null)}>
                    Volver
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {error !== null && <Fallo>{error}</Fallo>}

        {hecho !== null && (
          <div role="status" className="space-y-1">
            <p className="text-sm font-bold text-suelo">{hecho.texto}</p>
            {hecho.avisos.map((a) => (
              <AvisoPendiente key={a}>{a}</AvisoPendiente>
            ))}
            {hecho.canceladaId !== null && operable && (
              <Button
                variant="outline"
                className="h-11 sm:h-10"
                onClick={() =>
                  hecho.canceladaId !== null &&
                  setAviso({ visitaId: hecho.canceladaId, plantilla: 'cancelacion' })
                }
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                Avisarle que se canceló
              </Button>
            )}
          </div>
        )}

        {historial.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-suelo">
              <History className="h-4 w-4" aria-hidden="true" />
              Historial
            </p>
            <ul className="divide-y divide-input">
              {historial.map((v) => (
                <li key={v.id} className="py-2 text-sm">
                  <p className="text-suelo">
                    <span className="font-bold">{diaYHora(v.inicioEl)}</span> · {etiquetaDe(TIPOS_VISITA, v.tipo)} ·{' '}
                    {etiquetaDe(ESTADOS_VISITA, v.estado)}
                    {v.resultado !== null && ` · ${etiquetaDe(RESULTADOS_VISITA, v.resultado)}`}
                  </p>
                  {v.resultadoNota !== null && <p className="text-suelo-700">{v.resultadoNota}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      <DialogoAgendarVisita
        abierto={abrirAgenda || agendaLocal}
        alCerrar={cerrarAgenda}
        oportunidadId={fila.id}
        reprogramar={reprogramando}
        alAgendar={() => {
          setHecho(null)
          alCambiar?.()
        }}
      />
      <DialogoAvisoVisita
        abierto={aviso !== null}
        alCerrar={() => {
          setAviso(null)
          void cliente.invalidateQueries({ queryKey: ['visitas', fila.id] })
        }}
        visitaId={aviso?.visitaId ?? null}
        plantilla={aviso?.plantilla ?? 'confirmacion'}
      />
    </Card>
  )
}
