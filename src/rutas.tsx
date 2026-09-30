import { Navigate, type RouteObject } from 'react-router-dom'
import { Cascaron } from '@/componentes/layout/Cascaron'
import { PantallaPendiente } from '@/componentes/layout/PantallaPendiente'
import { PantallaCobranza } from '@/paginas/cobranza'
import { PantallaCola } from '@/paginas/cola'
import { PantallaContratos } from '@/paginas/contratos'
import { FormularioContrato } from '@/paginas/contratos/FormularioContrato'
import { PantallaEmbudo } from '@/paginas/embudo'
import { PantallaEntrar } from '@/paginas/entrar/PantallaEntrar'
import { PantallaHoy } from '@/paginas/hoy'
import { PantallaInventario } from '@/paginas/inventario'
import { PantallaParametros } from '@/paginas/parametros'
import { PantallaPersonas } from '@/paginas/personas'
import { FichaPersona } from '@/paginas/personas/ficha'
import { PantallaRegistroRapido } from '@/paginas/registro-rapido'
import { PantallaReportes } from '@/paginas/reportes'
import { PantallaSeparaciones } from '@/paginas/separaciones'
import { Constancia } from '@/paginas/separaciones/Constancia'
import { FichaSeparacion } from '@/paginas/separaciones/FichaSeparacion'
import { FormularioSeparacion } from '@/paginas/separaciones/FormularioSeparacion'
import { RutaProtegida } from '@/auth/RutaProtegida'
import { SECCIONES, type ClaveSeccion } from '@/auth/secciones'

/**
 * Mapa de rutas.
 *
 * Las pantallas del menu se generan desde `SECCIONES` (src/auth/secciones.ts)
 * para que el menu lateral y el enrutador no puedan desincronizarse: si una
 * seccion existe en el menu, existe como ruta, y con el mismo filtro de rol.
 *
 * Escritas las diez: `hoy`, `personas`, `registro-rapido`, `embudo`,
 * `inventario`, `separaciones`, `contratos`, `cobranza`, `reportes` y
 * `parametros`. `personas` fue la ultima (entrega 13, 30/09/2026). El
 * `PantallaPendiente` de abajo se queda como red: una seccion nueva que se
 * anada a SECCIONES sin pantalla dice «pendiente», no «pagina no encontrada».
 *
 * Fuente de la lista: 01-documentacion\02-ESPECIFICACION-TECNICA.md §4 — con
 * la salvedad de `contratos`, que es la novena seccion y todavia no esta en
 * ese documento (ver la nota de src/auth/secciones.ts).
 */
const ESCRITAS: Partial<Record<ClaveSeccion, JSX.Element>> = {
  hoy: <PantallaHoy />,
  personas: <PantallaPersonas />,
  'registro-rapido': <PantallaRegistroRapido />,
  embudo: <PantallaEmbudo />,
  inventario: <PantallaInventario />,
  separaciones: <PantallaSeparaciones />,
  contratos: <PantallaContratos />,
  cobranza: <PantallaCobranza />,
  reportes: <PantallaReportes />,
  parametros: <PantallaParametros />,
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

      // El alta de contrato. Va suelta y no en SECCIONES por lo mismo que el
      // alta de separacion: no es una seccion del menu, es un formulario de
      // dentro. El filtro de rol es el de la seccion (`contratos_leer`, los
      // cinco roles); quien puede CREAR lo decide `contratos_escribir` en la
      // base, y la pantalla solo evita dibujar un boton que va a fallar.
      {
        path: 'contratos/nuevo',
        element: (
          <RutaProtegida seccion="contratos">
            <FormularioContrato />
          </RutaProtegida>
        ),
      },

      // La ficha de persona: destino de «abrir ficha» en Hoy, Personas, el
      // Embudo y el Modo llamadas. `?o=` elige la oportunidad cuando la persona
      // tiene mas de una. Mismo filtro que la seccion Personas (los cinco
      // roles); lo que cada rol puede EDITAR lo deciden RLS y las funciones
      // de sql/13, y la ficha solo evita dibujar controles que van a fallar.
      {
        path: 'personas/:personaId',
        element: (
          <RutaProtegida seccion="personas">
            <FichaPersona />
          </RutaProtegida>
        ),
      },

      // Modo llamadas: la cola de leads para trabajarlos uno tras otro
      // (?vista=nuevos | pendientes | seleccion | campana). No es una seccion
      // del menu —se entra desde Hoy, Personas y Registro rapido—, y cuelga del
      // filtro de `registro-rapido` porque todo lo que hace es registrar
      // contactos: `contabilidad` y `lectura` no pueden, y la base se lo
      // rechazaria igual.
      {
        path: 'cola',
        element: (
          <RutaProtegida seccion="registro-rapido">
            <PantallaCola />
          </RutaProtegida>
        ),
      },

      { path: '*', element: <PantallaPendiente nombre="Página no encontrada" /> },
    ],
  },
]
