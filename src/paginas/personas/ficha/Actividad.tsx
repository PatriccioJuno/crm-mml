import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRightLeft,
  CalendarClock,
  History,
  ListTodo,
  Loader2,
  MessageCircle,
  Phone,
  StickyNote,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import { cargarActividad, type ItemActividad } from '@/lib/contacto'
import { fechaHora } from '@/lib/fechas'
import { Fallo } from './PanelContacto'

/**
 * ACTIVIDAD — la línea de tiempo de la oportunidad, de lo más nuevo a lo más
 * viejo: contactos (de TODAS las oportunidades de la persona), cambios de
 * estado (R9), eventos de situación/responsable/perfil, tareas y visitas.
 *
 * La arma `cargarActividad` (src/lib/contacto.ts), que tolera que falte una
 * tabla y lo DICE en el primer elemento en vez de enseñar una ficha vacía con
 * cara de «sin actividad». Aquí solo se pinta.
 *
 * Es también la evidencia de la parte 1 del reporte de 7 partes
 * (07-crm/CLAUDE.md §7): lo que no está aquí, no se hizo.
 */

const ICONOS: Readonly<Record<ItemActividad['icono'], LucideIcon>> = {
  mensaje: MessageCircle,
  llamada: Phone,
  estado: ArrowRightLeft,
  tarea: ListTodo,
  visita: CalendarClock,
  evento: History,
  nota: StickyNote,
}

/** Cuántos se ven sin desplegar. Límite de pantalla (el móvil), no un dato del negocio. */
const VISIBLES_AL_INICIO = 12

export function Actividad({ oportunidadId, personaId }: { oportunidadId: string; personaId: string }) {
  const [todo, setTodo] = useState(false)
  const actividad = useQuery({
    queryKey: ['actividad', oportunidadId],
    queryFn: () => cargarActividad(oportunidadId, personaId),
  })

  const items = actividad.data ?? []
  const visibles = todo ? items : items.slice(0, VISIBLES_AL_INICIO)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Actividad</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {actividad.isPending && (
          <p className="flex items-center gap-2 text-sm text-suelo-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Cargando la actividad…
          </p>
        )}

        {actividad.isError && (
          <div className="space-y-2">
            <Fallo>{actividad.error.message}</Fallo>
            <Button variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => void actividad.refetch()}>
              Reintentar
            </Button>
          </div>
        )}

        {actividad.isSuccess && items.length === 0 && (
          <p className="text-sm text-suelo-700">
            Todavía no hay nada registrado. El primer contacto que registres aparecerá aquí.
          </p>
        )}

        {visibles.length > 0 && (
          <ol className="space-y-3">
            {visibles.map((item) => {
              const Icono = ICONOS[item.icono]
              return (
                <li key={item.id} className="flex gap-3">
                  <Icono className="mt-0.5 h-4 w-4 shrink-0 text-azul" strokeWidth={1.75} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold leading-snug text-foreground">{item.titulo}</p>
                    {item.detalle !== null && (
                      <p className="mt-0.5 break-words text-xs leading-snug text-suelo-700">{item.detalle}</p>
                    )}
                    <p className="mt-0.5 text-xs tabular-nums text-suelo-500">{fechaHora(item.ocurrioEl)}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        {items.length > VISIBLES_AL_INICIO && (
          <Button variant="ghost" size="sm" className="h-11 sm:h-8" onClick={() => setTodo((t) => !t)}>
            {todo ? 'Ver menos' : `Ver toda la actividad (${items.length})`}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
