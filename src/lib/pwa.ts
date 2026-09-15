/**
 * Instalación en el teléfono (PWA) y actualización de la aplicación.
 *
 * ---------------------------------------------------------------------------
 * QUÉ HACE FALTA PARA QUE EL CRM SE PUEDA INSTALAR
 * ---------------------------------------------------------------------------
 * Cuatro cosas, y las cuatro tienen que estar a la vez:
 *
 *   1. `public/manifest.webmanifest`, enlazado desde index.html.
 *   2. Iconos de 192 y 512 px, más uno `maskable`.
 *   3. Un service worker registrado — esto es lo que hace este archivo.
 *   4. HTTPS. Sin certificado no hay instalación, y esto no se arregla desde
 *      el código: es del servidor donde se publique. `localhost` es la única
 *      excepción, para poder probarlo en desarrollo.
 *
 * ---------------------------------------------------------------------------
 * ANDROID E iOS NO SE INSTALAN IGUAL
 * ---------------------------------------------------------------------------
 * Android (Chrome, Edge, Samsung Internet) dispara `beforeinstallprompt`, que
 * se puede guardar y lanzar después desde un botón nuestro. Por eso en Android
 * el CRM puede ofrecer «Instalar» dentro de la propia interfaz.
 *
 * iOS NO tiene ese evento, y no lo va a tener: Safari sólo instala desde
 * Compartir → «Añadir a pantalla de inicio», y ningún sitio web puede abrir ese
 * menú por su cuenta. Lo único que se puede hacer —y es lo que se hace— es
 * detectar que estamos en iOS y explicar los dos toques. Para Rosa o Walter, la
 * diferencia entre «no se puede instalar» y «se instala así» es justamente esa
 * explicación.
 */

/** El evento de Chrome. No está en lib.dom, hay que declararlo. */
type EventoInstalacion = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** ¿Se está ejecutando ya como aplicación instalada, y no en una pestaña? */
export function esInstalada(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari de iOS no implementa display-mode: usa esta propiedad suya.
    ('standalone' in window.navigator && window.navigator.standalone === true)
  )
}

/** iPhone o iPad. El iPad moderno se anuncia como Mac, de ahí la segunda parte. */
export function esIOS(): boolean {
  const ua = window.navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

// ---------------------------------------------------------------------------
// Service worker
// ---------------------------------------------------------------------------

let enEspera: ServiceWorker | null = null

/**
 * Registra el service worker y avisa cuando hay una versión nueva esperando.
 *
 * Sólo en producción: en desarrollo, un service worker sirviendo el cascarón
 * guardado pelea con el recambio en caliente de Vite y produce el peor tipo de
 * error — el que sólo le pasa a quien tiene la pestaña abierta desde hace rato.
 */
export function registrarServiceWorker(alHaberVersionNueva: () => void): void {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  /**
   * ###########################################################################
   * #  NO BASTA CON ESCUCHAR `load`                                           #
   * #                                                                         #
   * #  Esto se llama desde un `useEffect` de <App>, y para cuando React monta  #
   * #  y ejecuta sus efectos, el evento `load` de la ventana YA SE DISPARO.    #
   * #  Un `addEventListener('load', ...)` puesto ahi no se ejecuta nunca: el   #
   * #  service worker no se registraba, y por tanto la aplicacion no se podia  #
   * #  instalar en Android. No daba ningun error — simplemente no pasaba nada. #
   * #                                                                         #
   * #  Por eso hay que mirar `document.readyState` antes de suscribirse.       #
   * #                                                                         #
   * #  Se sigue esperando a `load` cuando todavia no ha ocurrido porque el     #
   * #  registro compite por ancho de banda con el JS y el CSS de la pantalla;  #
   * #  registrarlo antes retrasa lo unico que la persona esta esperando ver.   #
   * ###########################################################################
   */
  if (document.readyState === 'complete') {
    registrar()
  } else {
    window.addEventListener('load', registrar, { once: true })
  }

  function registrar() {
    void navigator.serviceWorker
      .register('/sw.js')
      .then((registro) => {
        // Ya hay uno esperando de una visita anterior.
        if (registro.waiting !== null) {
          enEspera = registro.waiting
          alHaberVersionNueva()
        }

        registro.addEventListener('updatefound', () => {
          const nuevo = registro.installing
          if (nuevo === null) return

          nuevo.addEventListener('statechange', () => {
            // `controller` no nulo significa que ya había una versión
            // funcionando: esto es una ACTUALIZACIÓN, no la primera
            // instalación. En la primera no hay nada que avisar.
            if (nuevo.state === 'installed' && navigator.serviceWorker.controller !== null) {
              enEspera = nuevo
              alHaberVersionNueva()
            }
          })
        })
      })
      .catch((fallo: unknown) => {
        // Que falle el registro no puede tumbar el CRM: sin service worker se
        // pierde la instalación, no el funcionamiento.
        console.warn('[pwa] No se pudo registrar el service worker:', fallo)
      })
  }
}

/** Da el mando a la versión nueva y recarga. */
export function aplicarVersionNueva(): void {
  if (enEspera === null) {
    window.location.reload()
    return
  }

  // Cuando el nuevo service worker toma el control, se recarga UNA vez.
  let recargando = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando) return
    recargando = true
    window.location.reload()
  })

  enEspera.postMessage('tomar-el-mando')
}

// ---------------------------------------------------------------------------
// Instalación
// ---------------------------------------------------------------------------

let eventoGuardado: EventoInstalacion | null = null

/**
 * Escucha el ofrecimiento de instalación de Android y avisa cuando lo hay.
 *
 * El evento hay que guardarlo en cuanto llega: el navegador lo dispara una vez
 * y, si no se le llama a `preventDefault`, lo da por perdido.
 */
export function vigilarInstalacion(alCambiar: (sePuedeInstalar: boolean) => void): () => void {
  function alOfrecer(evento: Event) {
    evento.preventDefault()
    eventoGuardado = evento as EventoInstalacion
    alCambiar(true)
  }

  function alInstalar() {
    eventoGuardado = null
    alCambiar(false)
  }

  window.addEventListener('beforeinstallprompt', alOfrecer)
  window.addEventListener('appinstalled', alInstalar)

  return () => {
    window.removeEventListener('beforeinstallprompt', alOfrecer)
    window.removeEventListener('appinstalled', alInstalar)
  }
}

/**
 * Abre el diálogo de instalación de Android.
 * Devuelve `true` si la persona aceptó.
 */
export async function instalar(): Promise<boolean> {
  if (eventoGuardado === null) return false

  await eventoGuardado.prompt()
  const { outcome } = await eventoGuardado.userChoice

  // El evento no se puede reutilizar: si lo rechazan, el navegador volverá a
  // ofrecerlo por su cuenta más adelante.
  eventoGuardado = null
  return outcome === 'accepted'
}
