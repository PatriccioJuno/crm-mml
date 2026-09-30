import { useEffect, useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Ban, Check, Loader2, RotateCcw, Snowflake, Trash2, UserPlus } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import { claseCampo } from '@/componentes/ui/input'
import { GrupoChips } from '@/componentes/crm/GrupoChips'
import { AvisoPendiente } from '@/componentes/crm/AvisoPendiente'
import { SelectorResponsable } from '@/componentes/crm/SelectorResponsable'
import { cn } from '@/lib/utils'
import { useSesion } from '@/auth/ContextoSesion'
import {
  MOTIVOS_DESCARTE,
  MOTIVOS_FRIO,
  etiquetaMotivoDescarte,
  etiquetaMotivoFrio,
  etiquetaSituacion,
  type FilaCartera,
  type MotivoDescarte,
  type MotivoFrio,
} from '@/lib/cartera'
import {
  asignarOportunidades,
  cambiarSituacion,
  fijarTemperatura,
  type AccionSituacion,
} from '@/lib/contacto'
import { ESTADOS, etiquetaEstado, exigeCualificacion, moverOportunidad } from '@/lib/embudo'
import { PREGUNTAS_CUALIFICACION } from '@/lib/perfil'
import { deEntradaLocal, diaYHora } from '@/lib/fechas'
import { Fallo, invalidarTrasAccion } from './PanelContacto'

/**
 * CONTROLES DE SITUACION — estado del embudo, fríos, descarte, temperatura y
 * responsable.
 *
 * ===========================================================================
 * DOS DIMENSIONES QUE NO SE MEZCLAN
 * ===========================================================================
 * El ESTADO son los 10 pasos cerrados del embudo (embudo-y-metricas.md §1;
 * MANUAL:26 «no se inventan estados nuevos»). La SITUACION es si se trabaja o
 * no: frío = `pausada` + motivo + tarea de reactivación; descartado =
 * `perdida` + motivo (SPEC §3). Por eso son dos bloques separados: «en fríos»
 * no es un estado del embudo, y mover el estado no enfría a nadie.
 *
 * ===========================================================================
 * QUIEN DECIDE
 * ===========================================================================
 *  · R5 (Calificado exige las 4 respuestas) lo impone la restricción
 *    `calificado_requiere_las_4_respuestas`. Aquí se AVISA antes; el intento
 *    se deja hacer y, si la base lo rechaza, su mensaje se muestra tal cual.
 *  · Enfriar, descartar, reactivar y «no contactar» los hace
 *    `fn_cambiar_situacion` con todas sus consecuencias (tareas, visitas,
 *    consentimiento) en una transacción, y cada cambio queda en R9.
 *  · La temperatura la calcula la base; fijarla a mano exige decir por qué
 *    (07-crm/CLAUDE.md §3: nada de datos sin fuente).
 */

type Panel = AccionSituacion | null

function textoResultado(situacion: string, tarea: { titulo: string; venceEl: string } | null): string {
  const base = `Ahora está: ${etiquetaSituacion(situacion)}.`
  return tarea === null ? base : `${base} Próximo: ${tarea.titulo} · ${diaYHora(tarea.venceEl)}`
}

const TEMPERATURAS_MANUALES = [
  { valor: 'caliente', etiqueta: 'Caliente' },
  { valor: 'tibio', etiqueta: 'Tibio' },
  { valor: 'frio', etiqueta: 'Frío' },
] as const

type TemperaturaManual = (typeof TEMPERATURAS_MANUALES)[number]['valor']

export function ControlesSituacion({
  fila,
  puedeEditar,
  alCambiar,
}: {
  fila: FilaCartera
  puedeEditar: boolean
  alCambiar?: (() => void) | undefined
}) {
  const { rol, perfil } = useSesion()
  const cliente = useQueryClient()
  const idEstado = useId()
  const idNota = useId()
  const idFecha = useId()
  const idMotivoTemp = useId()

  const [estadoElegido, setEstadoElegido] = useState<string>(fila.estado)
  const [panel, setPanel] = useState<Panel>(null)
  const [motivoFrio, setMotivoFrio] = useState<MotivoFrio | null>(null)
  const [motivoDescarte, setMotivoDescarte] = useState<MotivoDescarte | null>(null)
  const [nota, setNota] = useState('')
  const [fecha, setFecha] = useState('')
  const [consentimientoRenovado, setConsentimientoRenovado] = useState(false)
  const [temperatura, setTemperatura] = useState<TemperaturaManual | null>(null)
  const [motivoTemperatura, setMotivoTemperatura] = useState('')
  const [responsable, setResponsable] = useState<string | null>(fila.responsableId)
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [hecho, setHecho] = useState<{ linea: string; avisos: string[] } | null>(null)

  // Si la fila cambia (otra oportunidad, o la base devolvió otro estado), los
  // controles vuelven a enseñar lo que hay en la base, no lo que se tocó.
  useEffect(() => {
    setEstadoElegido(fila.estado)
    setResponsable(fila.responsableId)
  }, [fila.id, fila.estado, fila.responsableId])

  const yo = perfil?.id ?? null
  const puedeAsignar =
    puedeEditar && (rol === 'direccion' || rol === 'administracion' || (yo !== null && fila.responsableId === yo))

  function abrir(p: Panel): void {
    setPanel((actual) => (actual === p ? null : p))
    setMotivoFrio(null)
    setMotivoDescarte(null)
    setNota('')
    setFecha('')
    setConsentimientoRenovado(false)
    setFallo(null)
    setHecho(null)
  }

  function terminar(linea: string, avisos: string[] = []): void {
    setHecho({ linea, avisos })
    setPanel(null)
    invalidarTrasAccion(cliente, [['actividad', fila.id], ['visitas', fila.id]])
    alCambiar?.()
  }

  async function cambiarEstado(): Promise<void> {
    const destino = ESTADOS.find((e) => e.valor === estadoElegido)?.valor
    if (destino === undefined || destino === fila.estado) return
    setTrabajando('estado')
    setFallo(null)
    const r = await moverOportunidad(fila.id, destino)
    setTrabajando(null)
    if (!r.ok) {
      setFallo(r.motivo)
      setEstadoElegido(fila.estado)
      return
    }
    terminar(`Estado: ${etiquetaEstado(destino)}. Queda en el historial (R9).`)
  }

  async function aplicarSituacion(): Promise<void> {
    if (panel === null) return
    let motivo: string | undefined
    if (panel === 'enfriar') {
      if (motivoFrio === null) {
        setFallo('Elige por qué pasa a fríos.')
        return
      }
      motivo = motivoFrio
    }
    if (panel === 'descartar') {
      if (motivoDescarte === null) {
        setFallo('Elige el motivo del descarte (una pérdida lleva motivo siempre, MANUAL:168).')
        return
      }
      motivo = motivoDescarte
    }
    if (panel === 'reactivar' && fila.noContactar) {
      if (!consentimientoRenovado || nota.trim() === '') {
        setFallo('Para reactivar a quien pidió no ser contactado hace falta su consentimiento renovado y anotar cómo lo dio.')
        return
      }
      motivo = 'consentimiento_renovado'
    }
    if (panel === 'no_contactar' && nota.trim() === '') {
      setFallo('Anota cómo lo pidió (por ejemplo, «lo dijo por WhatsApp el 29/09»): queda como motivo.')
      return
    }

    let fechaIso: string | null = null
    if ((panel === 'enfriar' || panel === 'reactivar') && fecha.trim() !== '') {
      fechaIso = deEntradaLocal(fecha)
      if (fechaIso === null) {
        setFallo('La fecha no es válida.')
        return
      }
    }

    setTrabajando('situacion')
    setFallo(null)
    const r = await cambiarSituacion({
      oportunidadId: fila.id,
      accion: panel,
      motivo,
      nota,
      fecha: fechaIso,
    })
    setTrabajando(null)
    if (!r.ok) {
      setFallo(r.motivo)
      return
    }
    terminar(textoResultado(r.datos.situacion, r.datos.tarea), r.datos.avisos)
  }

  async function aplicarTemperatura(valor: TemperaturaManual | null): Promise<void> {
    setTrabajando('temperatura')
    setFallo(null)
    const r = await fijarTemperatura(fila.id, valor, valor === null ? null : motivoTemperatura)
    setTrabajando(null)
    if (!r.ok) {
      setFallo(r.motivo)
      return
    }
    setTemperatura(null)
    setMotivoTemperatura('')
    terminar(valor === null ? 'La temperatura vuelve a ser la automática.' : 'Temperatura fijada a mano.')
  }

  async function asignar(): Promise<void> {
    if (responsable === null || responsable === fila.responsableId) return
    setTrabajando('asignar')
    setFallo(null)
    const r = await asignarOportunidades([fila.id], responsable)
    setTrabajando(null)
    if (!r.ok) {
      setFallo(r.motivo)
      return
    }
    const omitida = r.datos.omitidas[0]
    if (r.datos.asignadas === 0 && omitida !== undefined) {
      setFallo(`No se asignó: ${omitida.motivo}`)
      setResponsable(fila.responsableId)
      return
    }
    terminar('Responsable cambiado. Sus tareas abiertas pasaron también a la nueva persona.')
  }

  const avisoR5 =
    exigeCualificacion(estadoElegido) && !fila.cualificacionCompleta
      ? `Faltan ${fila.faltanCualificacion} de las ${PREGUNTAS_CUALIFICACION.length} respuestas de cualificación: la base rechazará este estado (R5). Complétalas en el perfil.`
      : null

  const situacion = fila.situacion
  const acciones: { accion: AccionSituacion; etiqueta: string; icono: typeof Snowflake }[] = []
  if (situacion === 'activa') acciones.push({ accion: 'enfriar', etiqueta: 'Pasar a fríos', icono: Snowflake })
  if (situacion === 'pausada' || situacion === 'perdida') {
    acciones.push({ accion: 'reactivar', etiqueta: 'Reactivar', icono: RotateCcw })
  }
  if (situacion === 'activa' || situacion === 'pausada') {
    acciones.push({ accion: 'descartar', etiqueta: 'Descartar', icono: Trash2 })
  }
  if (!fila.noContactar && situacion !== 'ganada') {
    acciones.push({ accion: 'no_contactar', etiqueta: 'No contactar', icono: Ban })
  }

  const detalleSituacion =
    situacion === 'pausada'
      ? `${etiquetaMotivoFrio(fila.motivoFrio)}${fila.enfriadoEl === null ? '' : ` · desde ${diaYHora(fila.enfriadoEl)}`}`
      : situacion === 'perdida'
        ? `${etiquetaMotivoDescarte(fila.motivoPerdidaCodigo)}${fila.motivoPerdida === null ? '' : ` · ${fila.motivoPerdida}`}`
        : null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Situación</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {!puedeEditar && (
          <AvisoPendiente>
            Solo lectura: esta oportunidad la lleva otra persona o tu rol no la opera.
          </AvisoPendiente>
        )}

        {/* Estado del embudo */}
        <div className="space-y-2">
          <label htmlFor={idEstado} className="block text-sm font-bold text-suelo">
            Estado del embudo
          </label>
          <div className="flex gap-2">
            <select
              id={idEstado}
              value={estadoElegido}
              onChange={(e) => setEstadoElegido(e.target.value)}
              disabled={!puedeEditar || trabajando !== null}
              className={cn(claseCampo, 'min-w-0 flex-1')}
            >
              {ESTADOS.map((e) => (
                <option key={e.valor} value={e.valor}>
                  {e.etiqueta}
                </option>
              ))}
            </select>
            {estadoElegido !== fila.estado && (
              <Button className="h-[3.25rem]" onClick={() => void cambiarEstado()} disabled={trabajando !== null}>
                {trabajando === 'estado' ? <Loader2 className="animate-spin" aria-hidden="true" /> : 'Cambiar'}
              </Button>
            )}
          </div>
          {avisoR5 !== null && estadoElegido !== fila.estado && <AvisoPendiente>{avisoR5}</AvisoPendiente>}
        </div>

        {/* Situación */}
        <div className="space-y-2">
          <p className="text-sm font-bold text-suelo">
            {etiquetaSituacion(situacion)}
            {detalleSituacion !== null && (
              <span className="block font-normal text-suelo-700">{detalleSituacion}</span>
            )}
          </p>
          {fila.noContactar && (
            <p className="text-sm text-suelo-700">
              Pidió no ser contactada. Solo se reactiva con su consentimiento renovado (Ley 29733).
            </p>
          )}
          {puedeEditar && acciones.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {acciones.map(({ accion, etiqueta, icono: Icono }) => (
                <Button
                  key={accion}
                  variant={panel === accion ? 'default' : 'outline'}
                  className="h-11 sm:h-9"
                  onClick={() => abrir(accion)}
                  disabled={trabajando !== null}
                  aria-expanded={panel === accion}
                >
                  <Icono aria-hidden="true" />
                  {etiqueta}
                </Button>
              ))}
            </div>
          )}

          {panel !== null && (
            <div className="space-y-3 rounded-md border border-border p-3">
              {panel === 'enfriar' && (
                <>
                  <GrupoChips
                    etiqueta="¿Por qué pasa a fríos?"
                    opciones={MOTIVOS_FRIO}
                    valor={motivoFrio}
                    alCambiar={setMotivoFrio}
                    compacto
                  />
                  <CampoFecha
                    id={idFecha}
                    etiqueta="¿Cuándo reactivar? (opcional: sin fecha, la base usa reactivacion_frio_dias)"
                    valor={fecha}
                    alCambiar={setFecha}
                  />
                </>
              )}
              {panel === 'descartar' && (
                <>
                  <GrupoChips
                    etiqueta="Motivo del descarte"
                    opciones={MOTIVOS_DESCARTE}
                    valor={motivoDescarte}
                    alCambiar={setMotivoDescarte}
                    compacto
                  />
                  <p className="text-xs text-suelo-700">
                    Se cierran todas sus tareas y se cancelan sus visitas. Queda en Descartados, desde donde se
                    puede reactivar.
                  </p>
                </>
              )}
              {panel === 'reactivar' && (
                <>
                  {fila.noContactar && (
                    <label className="flex min-h-11 items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={consentimientoRenovado}
                        onChange={(e) => setConsentimientoRenovado(e.target.checked)}
                        className="mt-0.5 h-5 w-5 shrink-0 accent-azul"
                      />
                      <span>
                        La persona volvió a dar su consentimiento para que la contactemos. Anota abajo cómo y
                        cuándo lo dio: queda como evidencia.
                      </span>
                    </label>
                  )}
                  <CampoFecha
                    id={idFecha}
                    etiqueta="¿Cuándo el primer seguimiento? (opcional: sin fecha, hoy)"
                    valor={fecha}
                    alCambiar={setFecha}
                  />
                </>
              )}
              {panel === 'no_contactar' && (
                <p className="text-sm font-bold leading-snug text-foreground">
                  Su consentimiento pasa a «No» (SOP-SEGUIMIENTO:61), todas sus oportunidades se descartan, se
                  cierran sus tareas y se cancelan sus visitas. Solo se revierte con consentimiento renovado.
                </p>
              )}

              <div className="space-y-1.5">
                <label htmlFor={idNota} className="block text-sm font-bold text-suelo">
                  {panel === 'no_contactar' || (panel === 'reactivar' && fila.noContactar)
                    ? 'Cómo lo pidió / cómo lo dio'
                    : 'Nota (opcional)'}
                </label>
                <textarea
                  id={idNota}
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  rows={2}
                  maxLength={1000}
                  className={cn(claseCampo, 'h-auto py-2 font-normal')}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button className="h-11 sm:h-10" onClick={() => void aplicarSituacion()} disabled={trabajando !== null}>
                  {trabajando === 'situacion' ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Check aria-hidden="true" />
                  )}
                  Confirmar
                </Button>
                <Button variant="ghost" className="h-11 sm:h-10" onClick={() => abrir(null)} disabled={trabajando !== null}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Temperatura manual */}
        {puedeEditar && (situacion === 'activa' || fila.temperaturaManual) && (
          <div className="space-y-2">
            <GrupoChips
              etiqueta="Fijar la temperatura a mano"
              opciones={TEMPERATURAS_MANUALES}
              valor={temperatura}
              alCambiar={setTemperatura}
              permitirVacio
              compacto
              deshabilitado={trabajando !== null}
            />
            <p className="text-xs text-suelo-700">
              Gana a la calculada hasta que la quites. Úsalo cuando sabes algo que el CRM no ve.
            </p>
            {temperatura !== null && (
              <div className="space-y-2">
                <label htmlFor={idMotivoTemp} className="block text-sm font-bold text-suelo">
                  ¿Por qué?
                </label>
                <input
                  id={idMotivoTemp}
                  value={motivoTemperatura}
                  onChange={(e) => setMotivoTemperatura(e.target.value)}
                  placeholder="Dijo que separa el sábado…"
                  className={claseCampo}
                />
                <Button
                  className="h-11 sm:h-10"
                  onClick={() => void aplicarTemperatura(temperatura)}
                  disabled={trabajando !== null || motivoTemperatura.trim() === ''}
                >
                  {trabajando === 'temperatura' && <Loader2 className="animate-spin" aria-hidden="true" />}
                  Fijar temperatura
                </Button>
              </div>
            )}
            {fila.temperaturaManual && (
              <Button
                variant="outline"
                className="h-11 sm:h-9"
                onClick={() => void aplicarTemperatura(null)}
                disabled={trabajando !== null}
              >
                Quitar la temperatura fijada
              </Button>
            )}
          </div>
        )}

        {/* Responsable */}
        {puedeAsignar && (
          <div className="space-y-2">
            <SelectorResponsable valor={responsable} alCambiar={setResponsable} etiqueta="Responsable" />
            {responsable !== null && responsable !== fila.responsableId && (
              <Button className="h-11 sm:h-10" onClick={() => void asignar()} disabled={trabajando !== null}>
                {trabajando === 'asignar' ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <UserPlus aria-hidden="true" />
                )}
                Asignar
              </Button>
            )}
          </div>
        )}

        {fallo !== null && <Fallo>{fallo}</Fallo>}
        {hecho !== null && (
          <div role="status" aria-live="polite" className="space-y-1.5">
            <p className="flex items-start gap-2 text-sm font-bold text-foreground">
              <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {hecho.linea}
            </p>
            {hecho.avisos.map((a) => (
              <AvisoPendiente key={a}>{a}</AvisoPendiente>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CampoFecha({
  id,
  etiqueta,
  valor,
  alCambiar,
}: {
  id: string
  etiqueta: string
  valor: string
  alCambiar: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-bold text-suelo">
        {etiqueta}
      </label>
      <input
        id={id}
        type="datetime-local"
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        className={claseCampo}
      />
    </div>
  )
}
