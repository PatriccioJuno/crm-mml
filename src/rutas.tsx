import { Navigate, type RouteObject } from 'react-router-dom'
import { Cascaron } from '@/componentes/layout/Cascaron'
import { PantallaPendiente } from '@/componentes/layout/PantallaPendiente'
import { PantallaEntrar } from '@/paginas/entrar/PantallaEntrar'
import { RutaProtegida } from '@/auth/RutaProtegida'
import { SECCIONES } from '@/auth/secciones'

/**
 * Mapa de rutas.
 *
 * Las ocho pantallas del MVP-1 se generan desde `SECCIONES` (src/auth/secciones.ts)
 * para que el menu lateral y el enrutador no puedan desincronizarse: si una
 * seccion existe en el menu, existe como ruta, y con el mismo filtro de rol.
 *
 * NINGUNA esta escrita todavia: todas resuelven al marcador de posicion. Cada
 * una tiene ya su carpeta en src/paginas/ — al implementarla, se reemplaza aqui
 * el `PantallaPendiente` por el import de esa carpeta.
 *
 * Fuente de la lista: 01-documentacion\02-ESPECIFICACION-TECNICA.md §4.
 */
const pantallas: RouteObject[] = SECCIONES.map((seccion) => ({
  path: seccion.ruta.replace(/^\//, ''),
  element: (
    <RutaProtegida seccion={seccion.clave}>
      <PantallaPendiente nombre={seccion.etiqueta} />
    </RutaProtegida>
  ),
}))

export const rutas: RouteObject[] = [
  { path: '/entrar', element: <PantallaEntrar /> },

  // No hay registro: los usuarios los crea el administrador en el panel de
  // Supabase. La ruta existe solo para que quien llegue a ella (un enlace
  // viejo, una costumbre de otro sistema) acabe donde tiene que acabar.
  { path: '/registro/*', element: <Navigate to="/entrar" replace /> },

  {
    path: '/',
    // El cascaron entero esta detras de la sesion: sin usuario y sin perfil
    // valido no se dibuja ni la barra lateral.
    element: (
      <RutaProtegida>
        <Cascaron />
      </RutaProtegida>
    ),
    children: [
      { index: true, element: <Navigate to="/hoy" replace /> },
      ...pantallas,
      { path: '*', element: <PantallaPendiente nombre="Página no encontrada" /> },
    ],
  },
]
