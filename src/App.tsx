import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/react'
import { ProveedorSesion } from '@/auth/ContextoSesion'
import { rutas } from '@/rutas'

const enrutador = createBrowserRouter(rutas)

const clienteConsultas = new QueryClient({
  defaultOptions: {
    queries: {
      // Un CRM de seguimiento no necesita refrescar al cambiar de pestaña:
      // genera ruido y consultas de mas. Se refresca al montar y al reconectar.
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
})

/**
 * Identificadores fuera de la analitica.
 *
 * ###########################################################################
 * #  POR QUE ESTA FUNCION NO ES OPCIONAL                                    #
 * #                                                                         #
 * #  Vercel Web Analytics registra la RUTA de cada vista. En React plano no #
 * #  hay soporte de rutas (lo dice su documentacion), asi que manda la ruta #
 * #  cruda — y las nuestras llevan el id del registro dentro:               #
 * #                                                                         #
 * #      /separaciones/3f9a1c22-...   ->  la separacion de una persona      #
 * #      /personas/8bd04e71-...       ->  un comprador concreto             #
 * #                                                                         #
 * #  Sin esta funcion, cada vez que Walter abre una ficha, el identificador #
 * #  de ese comprador sale hacia un tercero. No es su nombre, pero es un    #
 * #  dato que apunta a una persona identificable, y la Ley 29733 pide       #
 * #  declarar en el aviso de privacidad a que terceros se ceden datos.      #
 * #                                                                         #
 * #  Aqui el UUID se reemplaza por `:id` ANTES de salir del navegador.      #
 * #  Vercel ve que se visito «la ficha de una separacion»; nunca cual.      #
 * #  Tambien se vacia la query string, por el mismo motivo.                 #
 * #                                                                         #
 * #  Si algun dia se anade una ruta con un identificador que NO sea un      #
 * #  UUID (un codigo de unidad, un numero de recibo), hay que anadirlo a    #
 * #  este reemplazo. Lo que no se tape aqui, se va.                         #
 * ###########################################################################
 */
const UUID = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

function sinIdentificadores(evento: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(evento.url)
  url.pathname = url.pathname.replace(UUID, '/:id')
  url.search = ''
  return { ...evento, url: url.toString() }
}

export function App() {
  return (
    <QueryClientProvider client={clienteConsultas}>
      {/* La sesion envuelve al enrutador, no al reves: la pantalla de entrada
          tambien la necesita, y asi hay un unico oyente de onAuthStateChange
          para toda la aplicacion. */}
      <ProveedorSesion>
        <RouterProvider router={enrutador} />
      </ProveedorSesion>

      {/* Analitica de Vercel. Va fuera de <ProveedorSesion> a proposito: no
          necesita sesion y no debe depender de ella. */}
      <Analytics beforeSend={sinIdentificadores} />
    </QueryClientProvider>
  )
}
