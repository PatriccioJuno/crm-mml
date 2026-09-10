import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
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

export function App() {
  return (
    <QueryClientProvider client={clienteConsultas}>
      <RouterProvider router={enrutador} />
    </QueryClientProvider>
  )
}
