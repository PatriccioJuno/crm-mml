import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * AVISO DE PARAMETRO PENDIENTE — la nota pequeña que dice «esto depende de un
 * dato que todavía no está confirmado».
 *
 * Existe para cumplir 07-crm/CLAUDE.md §3 en la interfaz: cuando un parámetro
 * 🔴 o 🔵 cambia lo que hace una pantalla (no hay mapa de la obra, el horario
 * de visitas no está definido, la cadencia de seguimiento es una propuesta),
 * la pantalla lo DICE en vez de callarlo o de rellenar el hueco.
 *
 * Tinta suelo-700 con icono de información: se lee, pero no grita. No es un
 * error (el vendedor puede seguir trabajando) y por eso no usa `alerta`, que
 * tiene un único uso autorizado en la pantalla Hoy (src/index.css). Tampoco
 * ámbar: vive sobre superficie clara.
 *
 * Escribe dentro qué falta y dónde se carga («Falta cargar en Parámetros: …»),
 * no solo que algo falta.
 */
export function AvisoPendiente({
  children,
  className,
}: {
  children: ReactNode
  className?: string | undefined
}) {
  return (
    <div role="note" className={cn('flex items-start gap-2 text-sm text-suelo-700', className)}>
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
