import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Loader2, RotateCcw, ShieldAlert, Snowflake } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog'
import { claseCampo } from '@/componentes/ui/input'
import { Label } from '@/componentes/ui/label'
import { GrupoChips } from '@/componentes/crm/GrupoChips'
import { cn } from '@/lib/utils'
import type { Rol } from '@/auth/tipos-sesion'
import {
  MOTIVOS_DESCARTE,
  MOTIVOS_FRIO,
  cargarCartera,
  etiquetaMotivoDescarte,
  etiquetaMotivoFrio,
  etiquetaSituacion,
  type FilaCartera,
  type FiltroCartera,
} from '@/lib/cartera'
import { cambiarSituacion, type AccionSituacion, type SituacionCambiada } from '@/lib/contacto'
import { diaYHora, fechaRelativa } from '@/lib/fechas'
import {
  AvisoHecho,
  AvisosLote,
  Cargando,
  ErrorAlerta,
  FilaPersona,
  invalidarTrasAccion,
  puedeOperar,
  type AlcanceResponsable,
} from './FilaPersona'

/**
 * FRÍOS Y DESCARTADOS — lo que hoy no se trabaja, pero no se pierde.
 *
 * ===========================================================================
 * FRÍO NO ES UN ESTADO DEL EMBUDO
 * ===========================================================================
 * Los 10 estados son cerrados (MANUAL:26 «No se inventan estados nuevos»).
 * «Frío» es `situacion = 'pausada'` + `motivo_frio` + una tarea de
 * reactivación con fecha; «descartado» es `situacion = 'perdida'` +
 * `motivo_perdida_codigo` (SPEC §3). El estado del embudo se conserva: al
 * reactivar, la persona vuelve a donde estaba, no al principio.
 *
 * ===========================================================================
 * «VAN PARA FRÍOS» ES UNA SUGERENCIA, NO UN MOVIMIENTO
 * ===========================================================================
 * La base ya enfría sola a quien suma `frio_intentos_sin_respuesta` intentos
 * sin respuesta (fn_registrar_contacto). Lo que aquí se sugiere es otra cosa:
 * activas cuya TEMPERATURA calculada es «frío» (fn_temperatura, umbrales 🔵 en
 * `parametros`). Moverlas es una decisión de una persona, con un toque y con
 * motivo «no responde»; la pantalla no mueve a nadie por su cuenta.
 *
 * ===========================================================================
 * «NO CONTACTAR» SOLO SE DESHACE CON CONSENTIMIENTO RENOVADO
 * ===========================================================================
 * Quien pidió no ser contactado ejerció su derecho de oposición (Ley 29733;
 * SOP-SEGUIMIENTO:61 pone también `consentimiento = false`). La base se niega
 * a reactivarlo salvo con motivo 'consentimiento_renovado' (fn_cambiar_situacion,
 * SPEC §4.5). Este diálogo exige además decir CÓMO lo renovó: sin eso, el
 * motivo sería una casilla marcada sin evidencia.
 */

type Aviso = { tipo: 'ok' | 'error'; texto: string }

/** Frase de resultado de `fn_cambiar_situacion`: situación nueva, tarea creada y avisos de la base. */
function textoCambio(nombre: string, r: SituacionCambiada): string {
  const partes = [`${nombre}: ${etiquetaSituacion(r.situacion).toLowerCase()}.`]
  if (r.tarea !== null) partes.push(`Próximo: ${r.tarea.titulo} · ${diaYHora(r.tarea.venceEl)}.`)
  for (const a of r.avisos) partes.push(a)
  return partes.join(' ')
}

/** Cambiar la situación de UNA fila, con su «ocupado» y su aviso. Compartido por Fríos y Descartados. */
function useCambioSituacion() {
  const cliente = useQueryClient()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [aviso, setAviso] = useState<Aviso | null>(null)

  async function ejecutar(
    fila: FilaCartera,
    accion: AccionSituacion,
    extra?: { motivo?: string | undefined; nota?: string | undefined } | undefined,
  ): Promise<boolean> {
    if (ocupado !== null) return false
    setOcupado(fila.id)
    setAviso(null)
    const r = await cambiarSituacion({
      oportunidadId: fila.id,
      accion,
      motivo: extra?.motivo,
      nota: extra?.nota,
    })
    setOcupado(null)
    if (!r.ok) {
      setAviso({ tipo: 'error', texto: `${fila.nombreCompleto}: ${r.motivo}` })
      return false
    }
    setAviso({ tipo: 'ok', texto: textoCambio(fila.nombreCompleto, r.datos) })
    invalidarTrasAccion(cliente, fila.personaId)
    return true
  }

  return { ocupado, aviso, setAviso, ejecutar }
}

function LineaAviso({ aviso }: { aviso: Aviso | null }) {
  if (aviso === null) return null
  return aviso.tipo === 'error' ? <ErrorAlerta mensaje={aviso.texto} /> : <AvisoHecho>{aviso.texto}</AvisoHecho>
}

function filtroDe(vista: FiltroCartera['vista'], alcance: AlcanceResponsable, yo: string | null): FiltroCartera {
  return { vista, responsable: alcance, yo: yo ?? undefined }
}

// ---------------------------------------------------------------------------
// Fríos
// ---------------------------------------------------------------------------

export function PestanaFrios({
  alcance,
  yo,
  rol,
  agente,
  umbralFrio,
}: {
  alcance: AlcanceResponsable
  yo: string | null
  rol: Rol | null
  agente: string | null
  umbralFrio: number | null
}) {
  const opera = puedeOperar(rol)
  const sinSesion = alcance === 'mios' && yo === null

  const filtroActivos = filtroDe('activos', alcance, yo)
  const filtroFrios = filtroDe('frios', alcance, yo)
  const activos = useQuery({
    queryKey: ['cartera', filtroActivos],
    queryFn: () => cargarCartera(filtroActivos),
    enabled: !sinSesion,
  })
  const frios = useQuery({
    queryKey: ['cartera', filtroFrios],
    queryFn: () => cargarCartera(filtroFrios),
    enabled: !sinSesion,
  })

  const { ocupado, aviso, ejecutar } = useCambioSituacion()
  const [descartando, setDescartando] = useState<FilaCartera | null>(null)

  const sugeridos = (activos.data?.filas ?? []).filter((f) => f.temperatura === 'frio')
  const enFrios = frios.data?.filas ?? []

  // Agrupados por motivo en el orden del catálogo; un motivo que este cliente
  // no conoce (o ninguno) va al final con su valor crudo, no se esconde.
  const conocidos: readonly string[] = MOTIVOS_FRIO.map((m) => m.valor)
  const grupos: { clave: string; etiqueta: string; filas: FilaCartera[] }[] = []
  for (const m of MOTIVOS_FRIO) {
    const filas = enFrios.filter((f) => f.motivoFrio === m.valor)
    if (filas.length > 0) grupos.push({ clave: m.valor, etiqueta: m.etiqueta, filas })
  }
  const otros = enFrios.filter((f) => f.motivoFrio === null || !conocidos.includes(f.motivoFrio))
  for (const f of otros) {
    const clave = f.motivoFrio ?? '__sin_motivo'
    let g = grupos.find((x) => x.clave === clave)
    if (g === undefined) {
      g = { clave, etiqueta: etiquetaMotivoFrio(f.motivoFrio), filas: [] }
      grupos.push(g)
    }
    g.filas.push(f)
  }

  if (sinSesion) return <ErrorAlerta mensaje="No se sabe quién eres todavía: vuelve a entrar para ver «Míos»." />

  return (
    <div className="space-y-8">
      <LineaAviso aviso={aviso} />

      <section aria-labelledby="titulo-sugeridos" className="space-y-3">
        <div>
          <h2 id="titulo-sugeridos" className="flex items-center gap-2 text-lg font-black">
            Van para fríos
            <span className="text-sm font-bold text-suelo-700">(sugeridos · {sugeridos.length})</span>
          </h2>
          <p className="mt-1 text-sm text-suelo-700">
            Siguen activos, pero su temperatura ya es «frío». Moverlos a fríos cierra su
            seguimiento y les programa una reactivación (parámetro <code>reactivacion_frio_dias</code>,
            🔵 propuesta).
          </p>
        </div>

        {activos.isPending && <Cargando texto="Buscando activos que se enfriaron…" />}
        {activos.error !== null && <ErrorAlerta mensaje={activos.error.message} />}
        {activos.isSuccess && sugeridos.length === 0 && (
          <p className="rounded-md border border-border bg-card p-4 text-sm text-suelo-700">
            Ningún activo está frío ahora mismo. Cuando alguien deje de responder, aparecerá aquí.
          </p>
        )}
        {sugeridos.length > 0 && (
          <ul className="overflow-hidden rounded-lg border border-border bg-card">
            {sugeridos.map((f) => (
              <FilaPersona
                key={f.id}
                fila={f}
                agente={agente}
                umbralFrio={umbralFrio}
                mostrarResponsable={alcance !== 'mios'}
                acciones={
                  opera ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 sm:h-8"
                      disabled={ocupado !== null}
                      onClick={() => void ejecutar(f, 'enfriar', { motivo: 'no_responde' })}
                    >
                      {ocupado === f.id ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Snowflake strokeWidth={1.75} aria-hidden="true" />
                      )}
                      Mover a fríos
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </ul>
        )}
        {activos.data !== undefined && (
          <AvisosLote descartadas={activos.data.descartadas} filas={activos.data.filas.length} />
        )}
      </section>

      <section aria-labelledby="titulo-en-frios" className="space-y-3">
        <div>
          <h2 id="titulo-en-frios" className="flex items-center gap-2 text-lg font-black">
            En fríos
            <span className="text-sm font-bold text-suelo-700">({enFrios.length})</span>
          </h2>
          <p className="mt-1 text-sm text-suelo-700">
            Cada uno tiene una tarea de reactivación con fecha: esa fecha es su «próximo paso».
          </p>
        </div>

        {frios.isPending && <Cargando texto="Cargando los fríos…" />}
        {frios.error !== null && <ErrorAlerta mensaje={frios.error.message} />}
        {frios.isSuccess && enFrios.length === 0 && (
          <p className="rounded-md border border-border bg-card p-4 text-sm text-suelo-700">
            No hay nadie en fríos. Cuando alguien acumule intentos sin respuesta o pida «más
            adelante», pasará aquí con su fecha para reactivarlo.
          </p>
        )}

        {grupos.map((g) => (
          <div key={g.clave} className="space-y-2">
            <h3 className="text-sm font-bold text-foreground">
              {g.etiqueta} <span className="font-normal text-suelo-700">· {g.filas.length}</span>
            </h3>
            <ul className="overflow-hidden rounded-lg border border-border bg-card">
              {g.filas.map((f) => (
                <FilaPersona
                  key={f.id}
                  fila={f}
                  agente={agente}
                  umbralFrio={umbralFrio}
                  mostrarResponsable={alcance !== 'mios'}
                  detalle={
                    f.enfriadoEl !== null ? <>En fríos {fechaRelativa(f.enfriadoEl)}</> : undefined
                  }
                  acciones={
                    opera ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-11 sm:h-8"
                          disabled={ocupado !== null}
                          onClick={() => void ejecutar(f, 'reactivar')}
                        >
                          {ocupado === f.id ? (
                            <Loader2 className="animate-spin" aria-hidden="true" />
                          ) : (
                            <RotateCcw strokeWidth={1.75} aria-hidden="true" />
                          )}
                          Reactivar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-11 sm:h-8"
                          disabled={ocupado !== null}
                          onClick={() => setDescartando(f)}
                        >
                          <Archive strokeWidth={1.75} aria-hidden="true" />
                          Descartar
                        </Button>
                      </>
                    ) : undefined
                  }
                />
              ))}
            </ul>
          </div>
        ))}
        {frios.data !== undefined && (
          <AvisosLote descartadas={frios.data.descartadas} filas={frios.data.filas.length} />
        )}
      </section>

      {descartando !== null && (
        <DialogoDescartar
          fila={descartando}
          motivos={MOTIVOS_DESCARTE}
          alCerrar={() => setDescartando(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Descartados
// ---------------------------------------------------------------------------

export function PestanaDescartados({
  alcance,
  yo,
  rol,
  agente,
  umbralFrio,
}: {
  alcance: AlcanceResponsable
  yo: string | null
  rol: Rol | null
  agente: string | null
  umbralFrio: number | null
}) {
  const opera = puedeOperar(rol)
  const sinSesion = alcance === 'mios' && yo === null
  const filtro = filtroDe('descartados', alcance, yo)
  const consulta = useQuery({
    queryKey: ['cartera', filtro],
    queryFn: () => cargarCartera(filtro),
    enabled: !sinSesion,
  })
  const { ocupado, aviso, setAviso, ejecutar } = useCambioSituacion()
  const [renovando, setRenovando] = useState<FilaCartera | null>(null)

  const filas = consulta.data?.filas ?? []

  if (sinSesion) return <ErrorAlerta mensaje="No se sabe quién eres todavía: vuelve a entrar para ver «Míos»." />

  return (
    <div className="space-y-3">
      <p className="text-sm text-suelo-700">
        Descartadas con su motivo, y todas las de personas que pidieron no ser contactadas. Nada se
        borra (R8): reactivar devuelve la oportunidad a su estado del embudo con una tarea para hoy.
      </p>

      <LineaAviso aviso={aviso} />

      {consulta.isPending && <Cargando texto="Cargando los descartados…" />}
      {consulta.error !== null && <ErrorAlerta mensaje={consulta.error.message} />}
      {consulta.isSuccess && filas.length === 0 && (
        <p className="rounded-md border border-border bg-card p-4 text-sm text-suelo-700">
          No hay descartados en esta vista.
        </p>
      )}

      {filas.length > 0 && (
        <ul className="overflow-hidden rounded-lg border border-border bg-card">
          {filas.map((f) => (
            <FilaPersona
              key={f.id}
              fila={f}
              agente={agente}
              umbralFrio={umbralFrio}
              mostrarResponsable={alcance !== 'mios'}
              detalle={
                <span className="flex flex-wrap items-center gap-x-2">
                  {f.noContactar && (
                    <span className="inline-flex items-center gap-1 font-bold text-foreground">
                      <ShieldAlert className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                      Pidió no ser contactado
                    </span>
                  )}
                  {f.situacion === 'perdida' && (
                    <span>
                      Motivo: <span className="font-bold">{etiquetaMotivoDescarte(f.motivoPerdidaCodigo)}</span>
                      {f.motivoPerdida !== null && f.motivoPerdida.trim() !== '' && ` — ${f.motivoPerdida}`}
                    </span>
                  )}
                  {f.situacion !== 'perdida' && (
                    // Un «no contactar» cuya oportunidad no quedó perdida: se
                    // enseña la situación real en vez de fingir un descarte.
                    <span>Situación: {etiquetaSituacion(f.situacion)}</span>
                  )}
                </span>
              }
              acciones={
                opera && f.situacion !== 'ganada' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 sm:h-8"
                    disabled={ocupado !== null}
                    onClick={() => {
                      setAviso(null)
                      if (f.noContactar) setRenovando(f)
                      else void ejecutar(f, 'reactivar')
                    }}
                  >
                    {ocupado === f.id ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <RotateCcw strokeWidth={1.75} aria-hidden="true" />
                    )}
                    Reactivar
                  </Button>
                ) : undefined
              }
            />
          ))}
        </ul>
      )}
      {consulta.data !== undefined && (
        <AvisosLote descartadas={consulta.data.descartadas} filas={consulta.data.filas.length} />
      )}

      {renovando !== null && (
        <DialogoConsentimientoRenovado
          fila={renovando}
          ocupado={ocupado !== null}
          alCerrar={() => setRenovando(null)}
          alConfirmar={async (nota) => {
            const ok = await ejecutar(renovando, 'reactivar', { motivo: 'consentimiento_renovado', nota })
            if (ok) setRenovando(null)
          }}
        />
      )}
    </div>
  )
}

function DialogoConsentimientoRenovado({
  fila,
  ocupado,
  alCerrar,
  alConfirmar,
}: {
  fila: FilaCartera
  ocupado: boolean
  alCerrar: () => void
  alConfirmar: (nota: string) => Promise<void>
}) {
  const [confirmo, setConfirmo] = useState(false)
  const [nota, setNota] = useState('')
  const listo = confirmo && nota.trim() !== ''

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && !ocupado && alCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-black">Reactivar a {fila.nombreCompleto}</DialogTitle>
          <DialogDescription>
            Esta persona pidió que no la contactemos. Solo se reactiva si ELLA volvió a escribir y
            aceptó que le escribamos otra vez (Ley 29733; SOP-SEGUIMIENTO:61).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nota-consentimiento">¿Cómo y cuándo lo renovó?</Label>
            <textarea
              id="nota-consentimiento"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={2}
              placeholder="Nos escribió por WhatsApp el 29/09 pidiendo información otra vez…"
              className={cn(claseCampo, 'h-auto py-2')}
            />
          </div>

          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={confirmo}
              onChange={(e) => setConfirmo(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-azul"
            />
            <span>
              Confirmo que la persona dio de nuevo su consentimiento. Queda registrado con mi nombre
              como «consentimiento renovado».
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" className="h-11 sm:h-10" onClick={alCerrar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button className="h-11 sm:h-10" disabled={!listo || ocupado} onClick={() => void alConfirmar(nota)}>
            {ocupado ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Reactivando…
              </>
            ) : (
              'Reactivar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Descartar (compartido con la Bandeja web)
// ---------------------------------------------------------------------------

type OpcionMotivo = { readonly valor: string; readonly etiqueta: string }

/**
 * Descartar con motivo (MANUAL:168: una perdida lleva motivo siempre) y nota
 * libre (va a `motivo_perdida`). `motivos` lo elige quien abre el diálogo: la
 * Bandeja web solo ofrece spam / duplicado / no reconoce (SPEC §7 S1).
 *
 * «Pidió no ser contactado» NO es un descarte cualquiera: es el derecho de
 * oposición de la persona. Elegirlo llama a la acción `no_contactar`, que
 * además marca a la PERSONA (todas sus oportunidades perdidas, tareas
 * cerradas, visitas canceladas, consentimiento en falso — SPEC §3). Con un
 * descarte a secas, su otra oportunidad seguiría viva y alguien le volvería a
 * escribir.
 */
export function DialogoDescartar({
  fila,
  motivos,
  alCerrar,
  alDescartar,
}: {
  fila: { id: string; personaId: string; nombreCompleto: string }
  motivos: readonly OpcionMotivo[]
  alCerrar: () => void
  alDescartar?: ((r: SituacionCambiada) => void) | undefined
}) {
  const cliente = useQueryClient()
  const [motivo, setMotivo] = useState<string | null>(null)
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const esNoContactar = motivo === 'pidio_no_contacto'

  async function descartar(): Promise<void> {
    if (guardando) return
    if (motivo === null) {
      setError('Elige el motivo del descarte.')
      return
    }
    setGuardando(true)
    setError(null)
    const r = await cambiarSituacion(
      esNoContactar
        ? { oportunidadId: fila.id, accion: 'no_contactar', nota }
        : { oportunidadId: fila.id, accion: 'descartar', motivo, nota },
    )
    setGuardando(false)
    if (!r.ok) {
      setError(r.motivo)
      return
    }
    invalidarTrasAccion(cliente, fila.personaId)
    alDescartar?.(r.datos)
    alCerrar()
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && !guardando && alCerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-black">Descartar a {fila.nombreCompleto}</DialogTitle>
          <DialogDescription>
            Se cierran sus tareas y se cancelan sus visitas abiertas. No se borra nada: se puede
            reactivar desde «Descartados».
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <GrupoChips
            etiqueta="Motivo"
            opciones={motivos}
            valor={motivo}
            alCambiar={setMotivo}
            compacto
            deshabilitado={guardando}
          />

          {esNoContactar && (
            <p className="flex items-start gap-2 rounded-md border border-border bg-tinta-banda p-3 text-sm leading-snug">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span>
                <span className="font-bold">Se marcará a la persona como «no contactar».</span> Todas
                sus oportunidades pasan a descartadas y nadie le vuelve a escribir, salvo que ella
                renueve su consentimiento (Ley 29733).
              </span>
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="nota-descarte">Nota (opcional)</Label>
            <textarea
              id="nota-descarte"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={2}
              placeholder="Qué dijo, o por qué se descarta…"
              className={cn(claseCampo, 'h-auto py-2')}
            />
          </div>
        </div>

        {error !== null && <ErrorAlerta mensaje={error} />}

        <DialogFooter>
          <Button variant="ghost" className="h-11 sm:h-10" onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            className="h-11 sm:h-10"
            disabled={guardando || motivo === null}
            onClick={() => void descartar()}
          >
            {guardando ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Descartando…
              </>
            ) : esNoContactar ? (
              'Marcar «no contactar»'
            ) : (
              'Descartar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
