import { useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SECCIONES } from '@/auth/secciones'

/**
 * Cabecera de movil. Solo existe por debajo de `lg`, donde la barra lateral se
 * repliega en un cajon y hace falta algo que la vuelva a abrir.
 *
 * Es azul, y eso no es decoracion: cuando la barra lateral desaparece, esta
 * franja es lo unico que sostiene el 60 % de Azul Noche del manual de marca en
 * una pantalla de movil. Sin ella el telefono veria un CRM entero en cal.
 *
 * El ambar de la sobrelinea esta PERMITIDO porque el fondo es azul. Si algun
 * dia esta cabecera se pinta de claro, el ambar tiene que salir con ella.
 *
 * Dice en que seccion esta el usuario porque en un movil no hay menu a la
 * vista que lo diga: el nombre de la seccion es la unica pista de ubicacion
 * mientras el cajon esta cerrado.
 */
export function CabeceraMovil({ alAbrir }: { alAbrir: () => void }) {
  const { pathname } = useLocation()

  // La ruta mas larga que encaje: asi «/separaciones/abc» sigue diciendo
  // «Separaciones» en vez de caer en la primera coincidencia parcial.
  const seccion = [...SECCIONES]
    .sort((a, b) => b.ruta.length - a.ruta.length)
    .find((s) => pathname === s.ruta || pathname.startsWith(`${s.ruta}/`))

  return (
    <header
      className={cn(
        // `top` descuenta el área segura: `sticky` se pega al borde del
        // viewport, no al del contenedor. Con `top-0`, al hacer scroll en un
        // iPhone instalado esta franja acabaría debajo de la hora. La tira que
        // queda por encima es el relleno azul de <Cascaron>, así que no se ve
        // ninguna costura.
        'sticky top-[env(safe-area-inset-top)] z-30 flex h-14 shrink-0 items-center gap-2',
        'bg-azul pl-1 pr-4 text-cal',
        'lg:hidden',
      )}
    >
      <button
        type="button"
        onClick={alAbrir}
        aria-label="Abrir el menú"
        className={cn(
          // 44 px de lado. Es el tamaño minimo de un objetivo tactil: por
          // debajo, se falla con el pulgar y el usuario culpa al CRM.
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-sm',
          'text-cal transition-colors hover:bg-velo',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ambar',
        )}
      >
        <Menu className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
      </button>

      <div className="min-w-0">
        <p className="text-[0.625rem] font-bold uppercase leading-none tracking-[0.18em] acento-ambar">
          Mercado Media Luna
        </p>
        <p className="mt-1 truncate text-sm font-bold leading-none text-cal">
          {seccion?.etiqueta ?? 'CRM'}
        </p>
      </div>
    </header>
  )
}
