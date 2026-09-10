import { NavLink } from 'react-router-dom'
import {
  Banknote,
  Boxes,
  FileCheck2,
  LayoutList,
  Sun,
  UserPlus,
  Users,
  BarChart3,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Barra lateral. Es la superficie azul principal de la aplicacion: junto con
 * las cabeceras sostiene el 60 % de Azul Noche que pide el manual de marca.
 *
 * Es tambien el UNICO lugar de este andamiaje donde aparece el ambar, porque
 * es el unico con fondo azul (regla dura: ambar solo sobre azul).
 *
 * Iconografia: lucide-react, un solo estilo de linea en toda la interfaz.
 * No mezclar con otro set.
 */

type Enlace = {
  ruta: string
  etiqueta: string
  Icono: LucideIcon
}

/**
 * Las ocho pantallas del MVP-1.
 * Fuente: D:\SCPCMO\07-crm\01-documentacion\02-ESPECIFICACION-TECNICA.md §4.
 * Ninguna esta escrita todavia: todas las rutas resuelven al marcador de
 * posicion hasta que se implemente su pantalla.
 */
const ENLACES: readonly Enlace[] = [
  { ruta: '/hoy', etiqueta: 'Hoy', Icono: Sun },
  { ruta: '/embudo', etiqueta: 'Embudo', Icono: LayoutList },
  { ruta: '/personas', etiqueta: 'Personas', Icono: Users },
  { ruta: '/registro-rapido', etiqueta: 'Registro rápido', Icono: UserPlus },
  { ruta: '/inventario', etiqueta: 'Inventario', Icono: Boxes },
  { ruta: '/separaciones', etiqueta: 'Separaciones', Icono: FileCheck2 },
  { ruta: '/cobranza', etiqueta: 'Cobranza', Icono: Banknote },
  { ruta: '/reportes', etiqueta: 'Reportes', Icono: BarChart3 },
] as const

export function BarraLateral() {
  return (
    <aside className="flex w-64 shrink-0 flex-col bg-azul text-cal">
      {/* ---- Logotipo de texto ----
          TODO: cuando se integre el isotipo (la luna creciente,
          D:\SCPCMO\07-crm\04-media\marca\logo\), va a la izquierda de este
          bloque, a 40 px como maximo. */}
      <div className="border-b border-azul-600 px-6 py-6">
        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.22em] text-azul-300">
          Mercado
        </p>
        <p className="mt-0.5 text-2xl font-black leading-none tracking-tight text-cal">
          Media Luna
        </p>
        {/* Ambar sobre azul: permitido. Sobre cal seria 1.79:1 e incumpliria WCAG. */}
        <p className="mt-2 text-[0.6875rem] font-bold uppercase tracking-[0.18em] acento-ambar">
          CRM · SCP Inmobiliaria
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Navegación principal">
        <ul className="space-y-1">
          {ENLACES.map(({ ruta, etiqueta, Icono }) => (
            <li key={ruta}>
              <NavLink
                to={ruta}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-normal',
                    'text-azul-300 transition-colors',
                    'hover:bg-azul-600 hover:text-cal',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ambar',
                    isActive && 'bg-azul-600 font-bold text-cal',
                  )
                }
              >
                <Icono className="h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={1.75} />
                <span>{etiqueta}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-azul-600 px-6 py-4">
        {/* azul-300 sobre azul = 4.94:1 (cumple WCAG AA para texto pequeño).
            No bajar a azul-400: sobre azul da 2.78:1 y no cumple. */}
        <p className="text-[0.6875rem] leading-relaxed text-azul-300">
          Datos duros: solo desde <code className="font-bold">parametros</code>, con su fuente
          en <code className="font-bold">00-fuente-de-verdad</code>.
        </p>
      </div>
    </aside>
  )
}
