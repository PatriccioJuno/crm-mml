/* eslint-disable no-undef */
/**
 * SERVICE WORKER — CRM Mercado Media Luna
 *
 * Existe por una sola razón: sin service worker, Android no ofrece instalar la
 * aplicación. No está aquí para «que el CRM funcione sin internet».
 *
 * ###########################################################################
 * #  LA REGLA QUE GOBIERNA ESTE ARCHIVO                                     #
 * #                                                                         #
 * #  NO SE GUARDA NI UNA SOLA RESPUESTA DE DATOS. NUNCA.                    #
 * #                                                                         #
 * #  Este CRM enseña precios, saldos, plazos legales e inventario. Una       #
 * #  caché que devuelva la respuesta de ayer no es «modo sin conexión»: es   #
 * #  la pantalla mintiendo con cara de estar al día. Es exactamente el       #
 * #  fallo que documenta 00-fuente-de-verdad y que este repositorio entero   #
 * #  existe para evitar — un número que parece actual y no lo es.            #
 * #                                                                         #
 * #  Y hay una segunda razón, de ley: las respuestas del CRM traen datos     #
 * #  personales de terceros (DNI, teléfono, correo). Guardarlas en Cache     #
 * #  Storage las deja escritas en el disco del teléfono, fuera de la sesión  #
 * #  y sobreviviendo al cierre de sesión. Ver                                #
 * #  01-documentacion\05-SEGURIDAD-BACKUPS-Y-LEY-29733.md: mínimo            #
 * #  necesario. Una caché de datos no es el mínimo necesario.                #
 * #                                                                         #
 * #  Lo que sí se guarda es el CASCARÓN: el HTML, el JS, el CSS y los        #
 * #  iconos. Cosas que no son datos de nadie y que no caducan sin avisar.    #
 * ###########################################################################
 *
 * ---------------------------------------------------------------------------
 * CÓMO SE HACE CUMPLIR ESA REGLA
 * ---------------------------------------------------------------------------
 * Con una lista de PERMITIDOS, no de prohibidos. Sólo se toca lo que cumple
 * las tres condiciones: mismo origen, método GET, y ser un archivo estático.
 * Todo lo demás ni siquiera pasa por `respondWith`: va a la red y este archivo
 * no se entera.
 *
 * Esto deja fuera a Supabase por construcción y no por acuerdo: vive en otro
 * origen (`<proyecto>.supabase.co`), así que la primera condición ya lo
 * descarta. Nadie puede «olvidarse» de añadirlo a una lista de exclusiones,
 * porque no hay tal lista.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ LA NAVEGACIÓN ES «RED PRIMERO»
 * ---------------------------------------------------------------------------
 * Porque la alternativa deja a la gente atrapada en una versión vieja de la
 * aplicación. Con «caché primero», alguien que instaló el CRM en marzo seguiría
 * usando el JavaScript de marzo en septiembre, con las reglas de negocio de
 * marzo, y sin ninguna forma evidente de salir de ahí.
 *
 * Con «red primero»: si hay conexión, siempre se recibe el CRM de hoy. La
 * caché sólo entra cuando la red falla, y entonces lo que se sirve es el
 * cascarón vacío: la aplicación arranca, no puede consultar nada, y lo dice.
 * Arrancar y decir «sin conexión» es honesto. Arrancar y enseñar los datos de
 * la semana pasada, no.
 */

/**
 * Cambiar esta versión invalida TODA la caché en el siguiente arranque.
 * Sólo hace falta tocarla si cambian las reglas de este archivo; los archivos
 * de `/assets/` ya llevan un hash en el nombre y se renuevan solos.
 */
const VERSION = 'v1'
const CACHE = `crm-mml-cascaron-${VERSION}`

/** El documento que se sirve cuando no hay red. */
const CASCARON = '/index.html'

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // Sólo el documento. Los `/assets/` con hash se guardan solos según se
      // van pidiendo: precargarlos exigiría conocer sus nombres, que cambian
      // en cada compilación.
      await cache.add(new Request(CASCARON, { cache: 'reload' }))
      // Sin esto, el service worker nuevo se queda en espera hasta que se
      // cierran todas las pestañas — y en una aplicación instalada eso puede
      // no pasar en días.
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys()
      await Promise.all(nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

/** Un archivo compilado por Vite: lleva hash en el nombre, no cambia jamás. */
function esArchivoConHash(url) {
  return url.pathname.startsWith('/assets/')
}

/** Estáticos propios sin hash: iconos, manifiesto, favicon. */
function esEstaticoFijo(url) {
  return /\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)
}

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request
  const url = new URL(peticion.url)

  // --- Condición 1 y 2: mismo origen y GET. Todo lo demás, a la red. ---
  // Aquí es donde se cae Supabase, y con él cualquier dato personal o
  // cualquier cifra del negocio.
  if (peticion.method !== 'GET' || url.origin !== self.location.origin) return

  // --- Navegación: red primero, cascarón como último recurso ---
  if (peticion.mode === 'navigate') {
    evento.respondWith(
      (async () => {
        try {
          return await fetch(peticion)
        } catch {
          const cache = await caches.open(CACHE)
          const guardado = await cache.match(CASCARON)
          // Si ni siquiera hay cascarón, que falle como falla cualquier web
          // sin conexión. Inventar una página aquí sería otra pantalla que
          // este archivo tendría que mantener.
          return guardado ?? Response.error()
        }
      })(),
    )
    return
  }

  // --- Archivos con hash: caché primero. Son inmutables por definición. ---
  if (esArchivoConHash(url)) {
    evento.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        const guardado = await cache.match(peticion)
        if (guardado) return guardado

        const respuesta = await fetch(peticion)
        if (respuesta.ok) cache.put(peticion, respuesta.clone())
        return respuesta
      })(),
    )
    return
  }

  // --- Estáticos fijos: se sirve lo guardado y se refresca por detrás. ---
  if (esEstaticoFijo(url)) {
    evento.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        const guardado = await cache.match(peticion)

        const enRed = fetch(peticion)
          .then((respuesta) => {
            if (respuesta.ok) cache.put(peticion, respuesta.clone())
            return respuesta
          })
          .catch(() => guardado ?? Response.error())

        return guardado ?? enRed
      })(),
    )
    return
  }

  // Cualquier otra cosa del mismo origen: a la red, sin tocar la caché.
})

/** Permite a la aplicación pedir que un service worker en espera tome el mando. */
self.addEventListener('message', (evento) => {
  if (evento.data === 'tomar-el-mando') void self.skipWaiting()
})
