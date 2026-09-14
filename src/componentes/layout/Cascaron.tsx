import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { BarraLateral } from './BarraLateral'
import { CabeceraMovil } from './CabeceraMovil'

/**
 * Cascaron de la aplicacion: barra lateral azul + area de trabajo en cal.
 * Cada pantalla se monta en el <Outlet />. El cascaron no contiene logica de
 * negocio ni datos.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARCHIVO CRECIO (14/09/2026)
 * ---------------------------------------------------------------------------
 * Hasta hoy el cascaron era un `flex` sin un solo punto de corte: la barra
 * lateral media 256 px SIEMPRE. En un movil de 360 px eso dejaba 104 px de
 * contenido, y cada frase caia a una palabra por linea. El CRM no estaba
 * «mal maquetado» en movil: no tenia movil.
 *
 * La regla de aqui en adelante:
 *
 *   >= lg (1024 px)   barra lateral fija a la izquierda, pegada al scroll.
 *   <  lg             la barra se repliega en un cajon y aparece la
 *                     <CabeceraMovil> con el boton que lo abre.
 *
 * El corte es `lg` y no `md` a proposito: en una tableta de 768 px, restarle
 * 256 px al ancho deja 512 px para tablas de ocho y diez columnas. Vale mas
 * el ancho completo y un menu a un toque.
 *
 * ---------------------------------------------------------------------------
 * DOS DETALLES QUE PARECEN MENORES Y NO LO SON
 * ---------------------------------------------------------------------------
 * 1. `min-w-0` en la columna de contenido. Un hijo de flex tiene, por defecto,
 *    `min-width: auto`, o sea: no se encoge por debajo de lo que mide su
 *    contenido. Sin este `min-w-0`, una tabla ancha no scrollea dentro de su
 *    caja — empuja el layout entero y saca la pagina de la pantalla. Es la
 *    causa numero uno de «se ve corrido a la derecha» en moviles.
 *
 * 2. El relleno (`px`/`py`) vive AQUI y no en cada pantalla. Antes cada
 *    pantalla repetia `px-6 py-8` por su cuenta, con dos consecuencias: en
 *    movil 24 px por lado se comian el ancho util, y la pantalla que se
 *    olvidara de ponerlo salia pegada al borde (le pasaba a Parametros).
 *    Puesto una sola vez, la siguiente pantalla que alguien escriba nace bien
 *    por defecto, sin acordarse de nada.
 */
export function Cascaron() {
  const [menuAbierto, setMenuAbierto] = useState(false)
  const { pathname } = useLocation()
  const cajon = useRef<HTMLDivElement>(null)

  // Navegar cierra el cajon. Sin esto, al tocar una seccion el menu se queda
  // abierto encima de la pantalla que se acaba de pedir.
  useEffect(() => {
    setMenuAbierto(false)
  }, [pathname])

  // Al pasar a escritorio, el cajon se cierra solo.
  //
  // No es cosmetico: mientras esta abierto, este cascaron pone
  // `body { overflow: hidden }`. Si alguien abre el menu en un movil y gira el
  // telefono —o arrastra la ventana del navegador hasta pasar de 1024 px—, el
  // cajon se esconderia por CSS (`lg:hidden`) pero el estado seguiria en
  // «abierto», y el bloqueo del scroll se quedaria puesto en una pantalla que
  // ya no tiene cajon. La pagina se veria entera y no bajaria, sin motivo
  // visible. Por eso el cambio de tamano tiene que tocar el ESTADO, no solo
  // las clases.
  useEffect(() => {
    const escritorio = window.matchMedia('(min-width: 1024px)')

    function alCambiar(evento: MediaQueryListEvent) {
      if (evento.matches) setMenuAbierto(false)
    }

    escritorio.addEventListener('change', alCambiar)
    return () => escritorio.removeEventListener('change', alCambiar)
  }, [])

  // Con el cajon abierto: Escape lo cierra y el fondo no scrollea. Lo segundo
  // importa en movil, donde arrastrar sobre el menu movia la pagina de detras.
  useEffect(() => {
    if (!menuAbierto) return

    function alTeclado(evento: KeyboardEvent) {
      if (evento.key === 'Escape') setMenuAbierto(false)
    }

    const desbordeAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', alTeclado)

    // El foco entra al cajon: quien navega con teclado o lector de pantalla
    // tiene que aterrizar dentro del menu que acaba de abrir, no seguir en el
    // boton de la cabecera.
    cajon.current?.focus()

    return () => {
      document.body.style.overflow = desbordeAnterior
      window.removeEventListener('keydown', alTeclado)
    }
  }, [menuAbierto])

  return (
    <div className="flex min-h-screen bg-background">
      {/* ---- Escritorio (>= lg) ----
          `sticky` + `h-screen`: el menu sigue a la vista aunque la tabla de
          abajo tenga doscientas filas. */}
      <div className="sticky top-0 hidden h-screen shrink-0 lg:flex">
        <BarraLateral />
      </div>

      {/* ---- Movil (< lg): el cajon ----
          Se monta solo cuando esta abierto. Dejarlo montado y esconderlo con
          `-translate-x-full` habria dado una animacion de salida mas suave, a
          cambio de que los diez enlaces del menu siguieran recibiendo el foco
          del tabulador estando invisibles. No compensa. */}
      {menuAbierto && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Cerrar el menú"
            onClick={() => setMenuAbierto(false)}
            className="absolute inset-0 bg-suelo/60 animate-in fade-in duration-200"
          />
          <div
            ref={cajon}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Menú de navegación"
            className={cn(
              'absolute inset-y-0 left-0 outline-none',
              'animate-in slide-in-from-left duration-200 ease-out',
            )}
          >
            <BarraLateral alCerrar={() => setMenuAbierto(false)} />
          </div>
        </div>
      )}

      {/* ---- Columna de trabajo ----
          `min-w-0`: ver el punto 1 de la cabecera de este archivo. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <CabeceraMovil alAbrir={() => setMenuAbierto(true)} />

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
