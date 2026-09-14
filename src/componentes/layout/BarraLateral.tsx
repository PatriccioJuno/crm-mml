import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { LogOut, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSesion } from '@/auth/ContextoSesion'
import { seccionesVisibles } from '@/auth/secciones'
import { ETIQUETA_ROL } from '@/auth/tipos-sesion'

/**
 * Barra lateral. Es la superficie azul principal de la aplicacion: junto con
 * las cabeceras sostiene el 60 % de Azul Noche que pide el manual de marca.
 *
 * Es tambien el UNICO lugar de este andamiaje donde aparece el ambar, porque
 * es el unico con fondo azul (regla dura: ambar solo sobre azul).
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
 */
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
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-y-auto bg-azul text-cal">
      {/* ---- Logotipo de texto ----
          TODO: cuando se integre el isotipo (la luna creciente,
          D:\SCPCMO\07-crm\04-media\marca\logo\), va a la izquierda de este
          bloque, a 40 px como maximo. */}
      <div className="relative border-b border-azul-600 px-6 py-6">
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

        {/* Solo existe dentro del cajon. 44 px de lado: el minimo que se acierta
            con el pulgar sin mirar. */}
        {alCerrar !== undefined && (
          <button
            type="button"
            onClick={alCerrar}
            aria-label="Cerrar el menú"
            className={cn(
              'absolute right-3 top-4 flex h-11 w-11 items-center justify-center rounded-md',
              'text-azul-300 transition-colors hover:bg-azul-600 hover:text-cal',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ambar',
            )}
          >
            <X className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <nav className="flex-1 px-3 py-4" aria-label="Navegación principal">
        <ul className="space-y-1">
          {enlaces.map(({ ruta, etiqueta, Icono }) => (
            <li key={ruta}>
              <NavLink
                to={ruta}
                className={({ isActive }) =>
                  cn(
                    // py-2.5 y no py-2: 40 px de alto es el minimo comodo para
                    // el pulgar. En escritorio no se nota; en movil es la
                    // diferencia entre acertar y pulsar la seccion de al lado.
                    'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-normal',
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

      {/* ---- Quien esta dentro, y como salir ---- */}
      <div className="border-t border-azul-600 px-6 py-4">
        <p className="truncate text-sm font-bold text-cal" title={perfil.nombre}>
          {perfil.nombre}
        </p>
        {/* azul-300 sobre azul = 4.94:1 (cumple WCAG AA para texto pequeño).
            No bajar a azul-400: sobre azul da 2.78:1 y no cumple. */}
        <p className="mt-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-azul-300">
          {ETIQUETA_ROL[perfil.rol]}
        </p>

        <button
          type="button"
          onClick={() => void alSalir()}
          disabled={saliendo}
          className={cn(
            'mt-3 flex w-full items-center gap-2 rounded-md px-2 py-2 -ml-2',
            'text-sm text-azul-300 transition-colors',
            'hover:bg-azul-600 hover:text-cal',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ambar',
            'disabled:pointer-events-none disabled:opacity-60',
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={1.75} />
          <span>{saliendo ? 'Cerrando…' : 'Salir'}</span>
        </button>
      </div>

      {/* La nota al pie se calla en pantallas bajas: es un recordatorio, y en un
          movil compite por altura con el boton de salir, que si hace falta. */}
      <div className="hidden border-t border-azul-600 px-6 py-4 sm:block">
        <p className="text-[0.6875rem] leading-relaxed text-azul-300">
          Datos duros: solo desde <code className="font-bold">parametros</code>, con su fuente
          en <code className="font-bold">00-fuente-de-verdad</code>.
        </p>
      </div>
    </aside>
  )
}
