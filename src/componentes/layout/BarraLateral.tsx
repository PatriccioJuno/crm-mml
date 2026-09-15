import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { LogOut, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSesion } from '@/auth/ContextoSesion'
import { seccionesVisibles } from '@/auth/secciones'
import { ETIQUETA_ROL } from '@/auth/tipos-sesion'
import { BotonInstalar } from '@/componentes/marca/Instalacion'

/**
 * Barra lateral. Es la superficie azul principal de la aplicacion: junto con
 * las cabeceras sostiene el 60 % de Azul Noche que pide el manual de marca.
 *
 * Es tambien uno de los pocos lugares donde aparece el ambar, porque es uno de
 * los pocos con fondo azul (regla dura: ambar solo sobre azul).
 *
 * Iconografia: lucide-react, un solo estilo de linea en toda la interfaz.
 * No mezclar con otro set.
 *
 * ###########################################################################
 * #  El menu se filtra por rol desde `seccionesVisibles()`. Eso es COMODIDAD: #
 * #  quita de la vista lo que a ese rol le saldria vacio o le fallaria al     #
 * #  guardar. NO es seguridad — quien protege los datos es RLS en la base     #
 * #  (02-codigo\sql\02-rls.sql). Ver el bloque de src/auth/secciones.ts.      #
 * ###########################################################################
 *
 * ---------------------------------------------------------------------------
 * DOS SITIOS, UN SOLO COMPONENTE
 * ---------------------------------------------------------------------------
 * En escritorio (>= lg) este componente es una columna fija a la izquierda.
 * En movil vive dentro del cajon deslizante del <Cascaron>. Es el MISMO
 * componente en los dos casos, a proposito: si fueran dos, el menu del movil
 * se quedaria atras cada vez que se anada una seccion.
 *
 * Lo unico que cambia es `alCerrar`: cuando el cascaron lo pasa, esta barra
 * sabe que esta dentro del cajon y dibuja el boton de cerrar. Cuando no lo
 * pasa, es la columna de escritorio y no hay nada que cerrar.
 *
 * ---------------------------------------------------------------------------
 * QUE CAMBIO CON EL PROYECTO DE CLAUDE DESIGN (14/09/2026)
 * ---------------------------------------------------------------------------
 * - Ancho 256 -> 236 px. Veinte pixeles que en un portatil de 1366 son una
 *   columna mas de tabla en Cobranza.
 * - Marca: el rotulo de tres lineas se cambio por el iso de texto («ML» en un
 *   cuadro de cal) mas una linea. Tres lineas de texto arriba del menu hacian
 *   que la primera seccion empezara a 120 px del borde superior.
 * - Quien esta dentro pasa a ser un bloque con avatar sobre `bg-velo`, en vez
 *   de texto suelto: el diseno lo trata como una ficha, no como un pie.
 * ---------------------------------------------------------------------------
 */

/**
 * El isotipo de marca: la luna creciente. Mismo trazado que los iconos de la
 * aplicacion instalada (public/icono-*.png), para que el CRM abierto en el
 * navegador y el instalado en el telefono se vean como lo mismo.
 *
 * Ambar sobre azul: permitido, y esta barra siempre es azul.
 */
function Isotipo() {
  return (
    <svg
      viewBox="-118 -118 236 236"
      className="h-[30px] w-[30px] shrink-0"
      role="img"
      aria-label="Mercado Media Luna"
    >
      <g transform="rotate(-45)">
        <path
          d="M 50.176 -86.5 A 100 100 0 1 0 50.176 86.5 A 88 88 0 1 1 50.176 -86.5 Z"
          fill="#F2A93B"
        />
      </g>
    </svg>
  )
}

/** Iniciales para el avatar. Dos como maximo: «Ana Maria Lopez» -> «AL». */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '·'
  const primera = partes[0]?.[0] ?? ''
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : ''
  return (primera + ultima).toUpperCase()
}

export function BarraLateral({ alCerrar }: { alCerrar?: () => void }) {
  const { perfil, salir } = useSesion()
  const [saliendo, setSaliendo] = useState(false)

  // El cascaron va detras de <RutaProtegida>, asi que aqui siempre hay perfil.
  if (perfil === null) return null

  const enlaces = seccionesVisibles(perfil.rol)

  async function alSalir() {
    setSaliendo(true)
    await salir()
    // No hace falta navegar: al desaparecer la sesion, <RutaProtegida> manda
    // a /entrar por su cuenta.
  }

  return (
    // `h-full` + `overflow-y-auto`: en un movil apaisado el menu completo no
    // entra en la altura de pantalla. Sin esto, las ultimas secciones y el
    // boton de salir quedarian debajo del borde, inalcanzables.
    <aside className="flex h-full w-[236px] shrink-0 flex-col overflow-y-auto bg-azul px-4 py-6 text-cal">
      {/* ---- Marca ----
          El isotipo va en linea y no como <img>: son 120 bytes de trazado, no
          compensa una peticion mas, y asi hereda el color de marca en vez de
          traerlo cocido. Fuente del trazado:
          D:\SCPCMO\07-crm\04-media\marca\logo\MML-isotipo-ambar.svg
          (el mismo que genera los iconos de public/). */}
      <div className="relative flex items-center gap-2.5 px-2">
        <Isotipo />

        <span className="min-w-0">
          <span className="block truncate text-sm font-black leading-tight text-cal">
            Media Luna
          </span>
          {/* Ambar sobre azul: permitido. Sobre cal seria 1.79:1 e incumpliria WCAG. */}
          <span className="block text-[0.625rem] font-bold uppercase leading-tight tracking-[0.16em] acento-ambar">
            CRM · SCP
          </span>
        </span>

        {/* Solo existe dentro del cajon. 44 px de lado: el minimo que se acierta
            con el pulgar sin mirar. */}
        {alCerrar !== undefined && (
          <button
            type="button"
            onClick={alCerrar}
            aria-label="Cerrar el menú"
            className={cn(
              'absolute -right-1 -top-1 flex h-11 w-11 items-center justify-center rounded-sm',
              'text-cal/70 transition-colors hover:bg-velo hover:text-cal',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ambar',
            )}
          >
            <X className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <nav className="mt-8 flex-1" aria-label="Navegación principal">
        <ul className="space-y-0.5">
          {enlaces.map(({ ruta, etiqueta, Icono }) => (
            <li key={ruta}>
              <NavLink
                to={ruta}
                className={({ isActive }) =>
                  cn(
                    // py-2.5 y no py-2: 40 px de alto es el minimo comodo para
                    // el pulgar. En escritorio no se nota; en movil es la
                    // diferencia entre acertar y pulsar la seccion de al lado.
                    'flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-normal',
                    'text-cal/70 transition-colors',
                    'hover:bg-velo hover:text-cal',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ambar',
                    isActive && 'bg-velo-chip font-bold text-cal',
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

      {/* ---- Quien esta dentro, y como salir ---- */}
      <div className="mt-6 rounded-md bg-velo p-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-velo-chip text-xs font-bold text-cal"
          >
            {iniciales(perfil.nombre)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[0.8125rem] font-bold leading-tight text-cal" title={perfil.nombre}>
              {perfil.nombre}
            </span>
            {/* cal/60 sobre azul = 5.64:1. No bajar: al 50 % cae a 4.37:1 y
                deja de cumplir WCAG AA para texto pequeno. */}
            <span className="block text-[0.6875rem] leading-tight text-cal/60">
              {ETIQUETA_ROL[perfil.rol]}
            </span>
          </span>
        </div>

        <button
          type="button"
          onClick={() => void alSalir()}
          disabled={saliendo}
          className={cn(
            'mt-2.5 flex w-full items-center gap-2 rounded-sm px-2 py-1.5',
            'text-[0.8125rem] text-cal/70 transition-colors',
            'hover:bg-velo-chip hover:text-cal',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ambar',
            'disabled:pointer-events-none disabled:opacity-60',
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={1.75} />
          <span>{saliendo ? 'Cerrando…' : 'Salir'}</span>
        </button>
      </div>

      {/* Instalar el CRM en el telefono. Se esconde solo cuando ya esta
          instalado o cuando el navegador no lo permite. */}
      <BotonInstalar />

      {/* La nota al pie se calla en pantallas bajas: es un recordatorio, y en un
          movil compite por altura con el boton de salir, que si hace falta. */}
      {/* cal/60 = 5.64:1 sobre azul. Al 50 % cae a 4.37:1 y no cumple. */}
      <p className="mt-4 hidden text-[0.6875rem] leading-relaxed text-cal/60 sm:block">
        Datos duros: solo desde <code className="font-bold">parametros</code>, con su fuente en{' '}
        <code className="font-bold">00-fuente-de-verdad</code>.
      </p>
    </aside>
  )
}
