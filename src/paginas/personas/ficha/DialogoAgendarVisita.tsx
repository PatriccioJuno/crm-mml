import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, Loader2 } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import { ChipsSiNo, GrupoChips } from '@/componentes/crm/GrupoChips'
import { AvisoPendiente } from '@/componentes/crm/AvisoPendiente'
import { TIPOS_VISITA, agendarVisita, type TipoVisita, type Visita } from '@/lib/visitas'
import { aEntradaLocal, deEntradaLocal, diaYHora, sumarDias } from '@/lib/fechas'
import { cargarParametrosPorId, estaConfirmado, textoDeParametro } from '@/lib/parametros'
import { Fallo, invalidarTrasAccion } from './PanelContacto'
import { PanelAviso } from './DialogoAvisoVisita'

/**
 * AGENDAR (O REPROGRAMAR) UNA VISITA — SPEC §7 S4.
 *
 * Lo usan la ficha (SeccionVisitas) y el modo llamadas (cola/index.tsx, que lo
 * importa desde './SeccionVisitas'): por eso vive aparte y con props mínimas.
 *
 * Por qué chips de día + hora y no un solo `datetime-local`: en el móvil el
 * selector nativo de fecha y hora son dos o tres pantallas por visita, y el
 * 90 % de las visitas se agendan para hoy, mañana o pasado mañana (lo que se
 * pacta en la misma llamada). «Elegir» abre el selector solo cuando hace falta.
 *
 * La hora NO se rellena sola: el horario de visitas (`visita_horario`) sigue
 * 🔴 sin definir (08-web/PENDIENTES-WEB.md #10), así que el CRM no sugiere una
 * hora que nadie ha confirmado. La elige el vendedor con el cliente.
 *
 * Tras agendar, el mismo diálogo pasa a un paso «Visita agendada» con el
 * aviso al cliente (PanelAviso) dentro: no se abre un diálogo sobre otro, que
 * en el móvil es donde la gente se pierde.
 */

const DIAS = [
  { valor: 'hoy', etiqueta: 'Hoy' },
  { valor: 'manana', etiqueta: 'Mañana' },
  { valor: 'pasado', etiqueta: 'Pasado mañana' },
  { valor: 'elegir', etiqueta: 'Elegir' },
] as const

type Dia = (typeof DIAS)[number]['valor']

const DESPLAZAMIENTO: Record<Exclude<Dia, 'elegir'>, number> = { hoy: 0, manana: 1, pasado: 2 }

/** 'YYYY-MM-DD' en la hora del dispositivo (la misma conversión que el resto de la app). */
function fechaLocal(fecha: Date): string {
  return aEntradaLocal(fecha).slice(0, 10)
}

function esTipoVisita(v: string): v is TipoVisita {
  return TIPOS_VISITA.some((t) => t.valor === v)
}

export function DialogoAgendarVisita({
  abierto,
  alCerrar,
  oportunidadId,
  reprogramar = null,
  alAgendar,
}: {
  abierto: boolean
  alCerrar: () => void
  oportunidadId: string
  reprogramar?: Visita | null | undefined
  alAgendar?: ((visitaId: string) => void) | undefined
}) {
  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && alCerrar()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {/* Montado solo mientras está abierto: cada apertura empieza limpia
            (sin la hora ni la nota de la visita anterior). */}
        {abierto && (
          <CuerpoAgenda
            oportunidadId={oportunidadId}
            reprogramar={reprogramar}
            alCerrar={alCerrar}
            alAgendar={alAgendar}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CuerpoAgenda({
  oportunidadId,
  reprogramar,
  alCerrar,
  alAgendar,
}: {
  oportunidadId: string
  reprogramar: Visita | null
  alCerrar: () => void
  alAgendar?: ((visitaId: string) => void) | undefined
}) {
  const cliente = useQueryClient()
  const idFecha = useId()
  const idHora = useId()
  const idNota = useId()

  const tipoPrevio = reprogramar !== null && esTipoVisita(reprogramar.tipo) ? reprogramar.tipo : null
  const [tipo, setTipo] = useState<TipoVisita | null>(tipoPrevio)
  const [dia, setDia] = useState<Dia | null>(null)
  const [fechaElegida, setFechaElegida] = useState('')
  const [hora, setHora] = useState('')
  const [vieneCodecisor, setVieneCodecisor] = useState<boolean | null>(reprogramar?.vieneCodecisor ?? null)
  const [nota, setNota] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [agendada, setAgendada] = useState<{ visitaId: string; inicioEl: string; avisos: string[] } | null>(
    null,
  )
  const [avisar, setAvisar] = useState(false)

  // El horario de visitas es un parámetro 🔴: se enseña como pendiente, no se
  // usa para validar ni para sugerir (CLAUDE.md §2: no rellenar el vacío).
  const horario = useQuery({
    queryKey: ['parametros', ['visita_horario']],
    queryFn: () => cargarParametrosPorId(['visita_horario']),
    staleTime: 5 * 60 * 1000,
  })
  const parametroHorario = horario.data?.['visita_horario'] ?? null

  const hoy = fechaLocal(new Date())
  const fecha =
    dia === null ? '' : dia === 'elegir' ? fechaElegida : fechaLocal(sumarDias(new Date(), DESPLAZAMIENTO[dia]))
  const inicioEl = fecha !== '' && hora !== '' ? deEntradaLocal(`${fecha}T${hora}`) : null
  const enElPasado = inicioEl !== null && new Date(inicioEl).getTime() <= Date.now()

  async function guardar() {
    if (tipo === null) return setError('Elige el tipo de visita.')
    if (inicioEl === null) return setError('Elige el día y la hora de la visita.')
    if (enElPasado) return setError('La visita tiene que ser en el futuro. Revisa el día y la hora.')
    setTrabajando(true)
    setError(null)
    const r = await agendarVisita({
      oportunidadId,
      tipo,
      inicioEl,
      nota,
      vieneCodecisor,
      reprogramaId: reprogramar?.id ?? null,
    })
    setTrabajando(false)
    if (!r.ok) return setError(r.motivo)
    invalidarTrasAccion(cliente, [['visitas', oportunidadId], ['actividad', oportunidadId]])
    setAgendada(r.datos)
    alAgendar?.(r.datos.visitaId)
  }

  if (agendada !== null) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-black">
            <CalendarCheck className="h-5 w-5" aria-hidden="true" />
            {reprogramar !== null ? 'Visita reprogramada' : 'Visita agendada'}
          </DialogTitle>
          <DialogDescription>{diaYHora(agendada.inicioEl)}</DialogDescription>
        </DialogHeader>
        {agendada.avisos.length > 0 && (
          <ul className="space-y-1">
            {agendada.avisos.map((a) => (
              <li key={a}>
                <AvisoPendiente>{a}</AvisoPendiente>
              </li>
            ))}
          </ul>
        )}
        {avisar ? (
          <PanelAviso visitaId={agendada.visitaId} plantillaInicial="confirmacion" />
        ) : (
          <p className="text-sm text-suelo-700">
            ¿Le avisamos ahora? El aviso lleva el día, la hora y solo los datos confirmados (🟢).
          </p>
        )}
        <DialogFooter className="gap-2">
          {!avisar && (
            <Button className="h-11 sm:h-10" onClick={() => setAvisar(true)}>
              Avisarle ahora
            </Button>
          )}
          <Button variant="outline" className="h-11 sm:h-10" onClick={alCerrar}>
            {avisar ? 'Listo' : 'Después'}
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-black">
          {reprogramar !== null ? 'Reprogramar la visita' : 'Agendar visita'}
        </DialogTitle>
        <DialogDescription>
          {reprogramar !== null
            ? `Estaba para el ${diaYHora(reprogramar.inicioEl)}. Queda en el historial como reprogramada.`
            : 'Lo que se pactó con el cliente. Deja una tarea para ese día (R6).'}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <GrupoChips etiqueta="¿Qué visita?" opciones={TIPOS_VISITA} valor={tipo} alCambiar={setTipo} />

        <div className="space-y-2">
          <GrupoChips etiqueta="¿Qué día?" opciones={DIAS} valor={dia} alCambiar={setDia} />
          {dia === 'elegir' && (
            <div>
              <label htmlFor={idFecha} className="text-sm font-bold text-suelo">
                Fecha
              </label>
              <input
                id={idFecha}
                type="date"
                min={hoy}
                value={fechaElegida}
                onChange={(e) => setFechaElegida(e.target.value)}
                className={claseCampo}
              />
            </div>
          )}
        </div>

        <div>
          <label htmlFor={idHora} className="text-sm font-bold text-suelo">
            Hora
          </label>
          <input
            id={idHora}
            type="time"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
            className={claseCampo}
          />
          {parametroHorario !== null && estaConfirmado(parametroHorario) ? (
            <p className="mt-1 text-sm text-suelo-700">Horario de visitas: {textoDeParametro(parametroHorario)}</p>
          ) : (
            !horario.isPending && (
              <AvisoPendiente className="mt-1">
                🔴 El horario de visitas no está definido (parámetro visita_horario). Acuerda la hora con el
                equipo antes de confirmarla al cliente.
              </AvisoPendiente>
            )
          )}
          {inicioEl !== null && (
            <p className={enElPasado ? 'mt-1 text-sm font-bold text-alerta' : 'mt-1 text-sm text-suelo-700'}>
              {enElPasado ? 'Esa hora ya pasó.' : `Queda: ${diaYHora(inicioEl)}`}
            </p>
          )}
        </div>

        <ChipsSiNo etiqueta="¿Viene con quien decide?" valor={vieneCodecisor} alCambiar={setVieneCodecisor} />

        <div>
          <label htmlFor={idNota} className="text-sm font-bold text-suelo">
            Nota (opcional)
          </label>
          <textarea
            id={idNota}
            rows={2}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Ej.: viene con su esposa; quiere ver las tiendas del frente"
            maxLength={1000}
            className={cn(claseCampo, 'h-auto py-2')}
          />
        </div>

        {error !== null && <Fallo>{error}</Fallo>}
      </div>

      <DialogFooter className="gap-2">
        <Button variant="ghost" className="h-11 sm:h-10" onClick={alCerrar} disabled={trabajando}>
          Cancelar
        </Button>
        <Button className="h-11 sm:h-10" onClick={() => void guardar()} disabled={trabajando}>
          {trabajando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {reprogramar !== null ? 'Reprogramar' : 'Agendar'}
        </Button>
      </DialogFooter>
    </>
  )
}
