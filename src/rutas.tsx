import { Navigate, type RouteObject } from 'react-router-dom'
import { Cascaron } from '@/componentes/layout/Cascaron'
import { PantallaPendiente } from '@/componentes/layout/PantallaPendiente'
import { PantallaEmbudo } from '@/paginas/embudo'
import { PantallaEntrar } from '@/paginas/entrar/PantallaEntrar'
import { PantallaHoy } from '@/paginas/hoy'
import { PantallaInventario } from '@/paginas/inventario'
import { PantallaRegistroRapido } from '@/paginas/registro-rapido'
import { PantallaSeparaciones } from '@/paginas/separaciones'
import { Constancia } from '@/paginas/separaciones/Constancia'
import { FichaSeparacion } from '@/paginas/separaciones/FichaSeparacion'
import { FormularioSeparacion } from '@/paginas/separaciones/FormularioSeparacion'
import { RutaProtegida } from '@/auth/RutaProtegida'
import { SECCIONES, type ClaveSeccion } from '@/auth/secciones'

/**
 * Mapa de rutas.
 *
 * Las ocho pantallas del MVP-1 se generan desde `SECCIONES` (src/auth/secciones.ts)
 * para que el menu lateral y el enrutador no puedan desincronizarse: si una
 * seccion existe en el menu, existe como ruta, y con el mismo filtro de rol.
 *
 * Escritas: `hoy`, `registro-rapido`, `embudo`, `inventario` y `separaciones`.
 * Las demas siguen resolviendo al marcador de posicion; cada una tiene ya su
 * carpeta en src/paginas/ y al implementarla se anade a `ESCRITAS`, sin tocar
 * nada mas.
 *
 * Fuente de la lista: 01-documentacion\02-ESPECIFICACION-TECNICA.md §4.
 */
const ESCRITAS: Partial<Record<ClaveSeccion, JSX.Element>> = {
  hoy: <PantallaHoy />,
  'registro-rapido': <PantallaRegistroRapido />,
  embudo: <PantallaEmbudo />,
  inventario: <PantallaInventario />,
  separaciones: <PantallaSeparaciones />,
}

const pantallas: RouteObject[] = SECCIONES.map((seccion) => ({
  path: seccion.ruta.replace(/^\//, ''),
  element: (
    <RutaProtegida seccion={seccion.clave}>
      {ESCRITAS[seccion.clave] ?? <PantallaPendiente nombre={seccion.etiqueta} />}
    </RutaProtegida>
  ),
}))

export const rutas: RouteObject[] = [
  { path: '/entrar', element: <PantallaEntrar /> },

  // No hay registro: los usuarios los crea el administrador en el panel de
  // Supabase. La ruta existe solo para que quien llegue a ella (un enlace
  // viejo, una costumbre de otro sistema) acabe donde tiene que acabar.
  { path: '/registro/*', element: <Navigate to="/entrar" replace /> },

  // La constancia va FUERA del cascaron, y es a proposito: lo que se imprime
  // es la hoja, no el CRM. Dentro del cascaron, la barra lateral azul saldria
  // en el papel. Sigue detras de la sesion y del mismo filtro de seccion; lo
  // que decide si el documento llega a dibujarse es `puede_emitir_constancia`,
  // a la que la propia pantalla vuelve a preguntar (R3).
  {
    path: '/separaciones/:separacionId/constancia',
    element: (
      <RutaProtegida seccion="separaciones">
        <Constancia />
      </RutaProtegida>
    ),
  },

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
      // «/» es la pantalla de inicio. Se redirige a /hoy en vez de montar Hoy
      // en las dos rutas: asi la pantalla tiene una sola direccion, y el enlace
      // activo del menu lateral (que apunta a /hoy) no se apaga al entrar por
      // la raiz.
      { index: true, element: <Navigate to="/hoy" replace /> },

      // Atajo pedido para el live: /rapido es mas corto de teclear en un movil
      // que /registro-rapido. La ruta canonica sigue siendo la del menu, para
      // que SECCIONES siga siendo la unica lista de pantallas.
      { path: 'rapido', element: <Navigate to="/registro-rapido" replace /> },

      ...pantallas,

      // Las dos pantallas de dentro de Separaciones. Van sueltas y no en
      // SECCIONES porque no son secciones del menu: son el alta y la ficha de
      // una separacion concreta. El filtro de rol es el mismo de la seccion
      // (`sep_leer`, los cinco roles); quien puede REGISTRAR y quien puede
      // VERIFICAR lo deciden `sep_crear` y fn_verificacion_solo_direccion en
      // la base, no el enrutador.
      {
        path: 'separaciones/nueva',
        element: (
          <RutaProtegida seccion="separaciones">
            <FormularioSeparacion />
          </RutaProtegida>
        ),
      },
      {
        path: 'separaciones/:separacionId',
        element: (
          <RutaProtegida seccion="separaciones">
            <FichaSeparacion />
          </RutaProtegida>
        ),
      },

      // La ficha de persona: destino del boton «abrir ficha» de cada fila de
      // Hoy. La pantalla todavia no esta escrita — la ruta existe para que el
      // boton no lleve a «pagina no encontrada», y lo que se ve dice la verdad:
      // 🔴 pendiente.
      {
        path: 'personas/:personaId',
        element: (
          <RutaProtegida seccion="personas">
            <PantallaPendiente nombre="Ficha de persona" />
          </RutaProtegida>
        ),
      },

      { path: '*', element: <PantallaPendiente nombre="Página no encontrada" /> },
    ],
  },
]
