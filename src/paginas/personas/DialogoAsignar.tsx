import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, UserCheck } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog'
import { SelectorResponsable } from '@/componentes/crm/SelectorResponsable'
import { asignarOportunidades, type Asignacion } from '@/lib/contacto'
import { invalidarTrasAccion } from './FilaPersona'

/**
 * ASIGNAR A… — reparte una o varias oportunidades a una persona del equipo.
 *
 * ===========================================================================
 * LO QUE NO SE PUDO ASIGNAR SE DICE, UNA POR UNA
 * ===========================================================================
 * `fn_asignar_oportunidades` deja a un comercial mover solo las suyas o las
 * sin dueño (puede_operar_oportunidad, SPEC §4.5). Las demás NO fallan en
 * bloque: vuelven en `omitidas` con su motivo. Este diálogo las enseña con el
 * nombre de la persona y el motivo, porque «se asignaron 12» cuando se
 * eligieron 15 es exactamente el tipo de hueco silencioso que luego nadie
 * sabe explicar. El cambio de responsable queda en `oportunidad_eventos` con
 * actor y fecha (R9): eso lo escribe la base, no esta pantalla.
 *
 * Se renderiza solo cuando hace falta (`{abierto && <DialogoAsignar …/>}`):
 * así cada apertura empieza limpia, sin el resultado de la vez anterior.
 */
export function DialogoAsignar({
  ids,
  nombres,
  alCerrar,
  alAsignar,
}: {
  /** Ids de OPORTUNIDAD. */
  ids: readonly string[]
  /** id → nombre de la persona, para decir cuál se omitió y por qué. */
  nombres?: Readonly<Record<string, string>> | undefined
  alCerrar: () => void
  alAsignar?: ((a: Asignacion) => void) | undefined
}) {
  const cliente = useQueryClient()
  const [responsableId, setResponsableId] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Asignacion | null>(null)

  const cuantas = ids.length === 1 ? '1 oportunidad' : `${ids.length} oportunidades`

  async function asignar(): Promise<void> {
    if (guardando) return
    if (responsableId === null) {
      setError('Elige a quién se asignan.')
      return
    }
    setGuardando(true)
    setError(null)
    const r = await asignarOportunidades(ids, responsableId)
    setGuardando(false)
    if (!r.ok) {
      setError(r.motivo)
      return
    }
    setResultado(r.datos)
    invalidarTrasAccion(cliente)
    alAsignar?.(r.datos)
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && !guardando && alCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-black">Asignar a…</DialogTitle>
          <DialogDescription>
            {cuantas}. Sus tareas abiertas pasan a la misma persona.
          </DialogDescription>
        </DialogHeader>

        {resultado === null ? (
          <SelectorResponsable
            valor={responsableId}
            alCambiar={setResponsableId}
            etiqueta="¿A quién?"
            deshabilitado={guardando}
          />
        ) : (
          <div role="status" className="space-y-3 text-sm">
            <p className="flex items-start gap-2 font-bold text-foreground">
              <UserCheck className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              {resultado.asignadas === 1
                ? 'Se asignó 1 oportunidad.'
                : `Se asignaron ${resultado.asignadas} oportunidades.`}
            </p>
            {resultado.omitidas.length > 0 && (
              <div>
                <p className="font-bold text-foreground">
                  {resultado.omitidas.length === 1
                    ? '1 no se pudo asignar:'
                    : `${resultado.omitidas.length} no se pudieron asignar:`}
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-suelo-700">
                  {resultado.omitidas.map((o) => (
                    <li key={o.id}>
                      <span className="font-bold">{nombres?.[o.id] ?? 'Oportunidad sin nombre visible'}</span>
                      {' — '}
                      {o.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
          {resultado === null ? (
            <>
              <Button variant="ghost" className="h-11 sm:h-10" onClick={alCerrar} disabled={guardando}>
                Cancelar
              </Button>
              <Button
                className="h-11 sm:h-10"
                onClick={() => void asignar()}
                disabled={guardando || responsableId === null}
              >
                {guardando ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    Asignando…
                  </>
                ) : (
                  'Asignar'
                )}
              </Button>
            </>
          ) : (
            <Button className="h-11 sm:h-10" onClick={alCerrar}>
              Listo
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
