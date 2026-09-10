import { Navigate, type RouteObject } from 'react-router-dom'
import { Cascaron } from '@/componentes/layout/Cascaron'
import { PantallaPendiente } from '@/componentes/layout/PantallaPendiente'

/**
 * Mapa de rutas.
 *
 * Las ocho pantallas del MVP-1 estan declaradas, pero NINGUNA esta escrita:
 * todas resuelven al marcador de posicion. Cada una tiene ya su carpeta en
 * src/paginas/ — al implementarla, se reemplaza aqui el elemento por el
 * import perezoso de esa carpeta.
 *
 * Fuente de la lista: 01-documentacion\02-ESPECIFICACION-TECNICA.md §4.
 */
export const rutas: RouteObject[] = [
  {
    path: '/',
    element: <Cascaron />,
    children: [
      { index: true, element: <Navigate to="/hoy" replace /> },
      { path: 'hoy', element: <PantallaPendiente nombre="Hoy" /> },
      { path: 'embudo', element: <PantallaPendiente nombre="Embudo" /> },
      { path: 'personas', element: <PantallaPendiente nombre="Personas" /> },
      { path: 'registro-rapido', element: <PantallaPendiente nombre="Registro rápido" /> },
      { path: 'inventario', element: <PantallaPendiente nombre="Inventario" /> },
      { path: 'separaciones', element: <PantallaPendiente nombre="Separaciones" /> },
      { path: 'cobranza', element: <PantallaPendiente nombre="Cobranza" /> },
      { path: 'reportes', element: <PantallaPendiente nombre="Reportes" /> },
      { path: '*', element: <PantallaPendiente nombre="Página no encontrada" /> },
    ],
  },
]
