import {
  Banknote,
  BarChart3,
  Boxes,
  FileCheck2,
  LayoutList,
  Sun,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { ROLES, type Rol } from '@/auth/tipos-sesion'

/**
 * Las ocho secciones del MVP-1 y que roles las ven en el menu.
 *
 * ###########################################################################
 * #  ESTO NO ES SEGURIDAD. ES COMODIDAD.                                    #
 * #                                                                         #
 * #  Ocultar un enlace no protege nada: cualquiera puede escribir la ruta    #
 * #  en la barra de direcciones, o llamar a supabase-js desde la consola.    #
 * #  Lo unico que protege los datos son las politicas de RLS de              #
 * #  02-codigo\sql\02-rls.sql, evaluadas en el servidor con auth.uid().      #
 * #                                                                         #
 * #  Por eso esta tabla NO define permisos: los COPIA de RLS. Cada fila cita #
 * #  la politica exacta de la que sale su `rolesQueVen`. Si RLS cambia,      #
 * #  esto se actualiza detras — nunca al reves, y nunca "por criterio".      #
 * #                                                                         #
 * #  Y por eso tampoco hay aqui ninguna logica de "puede editar / puede      #
 * #  aprobar": esa pregunta se la hace la base de datos, no el cliente.      #
 * ###########################################################################
 *
 * Fuente de la lista de pantallas:
 *   D:\SCPCMO\07-crm\01-documentacion\02-ESPECIFICACION-TECNICA.md §4
 */

export type ClaveSeccion =
  | 'hoy'
  | 'embudo'
  | 'personas'
  | 'registro-rapido'
  | 'inventario'
  | 'separaciones'
  | 'cobranza'
  | 'reportes'

export type Seccion = {
  clave: ClaveSeccion
  ruta: string
  etiqueta: string
  Icono: LucideIcon
  /** Roles con acceso de LECTURA a los datos de la seccion, segun RLS. */
  rolesQueVen: readonly Rol[]
  /** Politica(s) de 02-rls.sql de las que sale `rolesQueVen`. */
  fuente: string
}

/** Atajo: la politica dice `using (true)` para cualquier `authenticated`. */
const TODOS: readonly Rol[] = ROLES

/** Roles que pueden INSERTAR personas y oportunidades. */
const REGISTRAN: readonly Rol[] = ['direccion', 'comercial', 'administracion']

export const SECCIONES: readonly Seccion[] = [
  {
    clave: 'hoy',
    ruta: '/hoy',
    etiqueta: 'Hoy',
    Icono: Sun,
    rolesQueVen: TODOS,
    fuente: '02-rls.sql · tareas_leer + oport_leer + sep_leer',
  },
  {
    clave: 'embudo',
    ruta: '/embudo',
    etiqueta: 'Embudo',
    Icono: LayoutList,
    rolesQueVen: TODOS,
    // `comercial` entra por la otra rama de la politica (responsable_id = auth.uid()):
    // ve el embudo, pero solo con SUS oportunidades dentro. Eso lo filtra la base.
    fuente: '02-rls.sql · oport_leer',
  },
  {
    clave: 'personas',
    ruta: '/personas',
    etiqueta: 'Personas',
    Icono: Users,
    rolesQueVen: TODOS,
    fuente: '02-rls.sql · personas_leer (enumera los cinco roles)',
  },
  {
    clave: 'registro-rapido',
    ruta: '/registro-rapido',
    etiqueta: 'Registro rápido',
    Icono: UserPlus,
    // Unica seccion que el menu esconde hoy: es puro alta de datos, y a
    // `contabilidad` y `lectura` el INSERT les fallaria en la base. Mostrarles
    // el formulario solo serviria para que perdieran el tiempo escribiendolo.
    rolesQueVen: REGISTRAN,
    fuente: '02-rls.sql · personas_crear + oport_crear',
  },
  {
    clave: 'inventario',
    ruta: '/inventario',
    etiqueta: 'Inventario',
    Icono: Boxes,
    rolesQueVen: TODOS,
    fuente: '02-rls.sql · unidades_leer',
  },
  {
    clave: 'separaciones',
    ruta: '/separaciones',
    etiqueta: 'Separaciones',
    Icono: FileCheck2,
    // Todos la LEEN. El boton de verificar (R2, solo `direccion`) es una
    // decision de dentro de la pantalla, no del menu; y lo hace cumplir el
    // disparador fn_verificacion_solo_direccion, no este archivo.
    rolesQueVen: TODOS,
    fuente: '02-rls.sql · sep_leer',
  },
  {
    clave: 'cobranza',
    ruta: '/cobranza',
    etiqueta: 'Cobranza',
    Icono: Banknote,
    rolesQueVen: TODOS,
    fuente: '02-rls.sql · cuotas_leer + pagos_leer',
  },
  {
    clave: 'reportes',
    ruta: '/reportes',
    etiqueta: 'Reportes',
    Icono: BarChart3,
    rolesQueVen: TODOS,
    fuente: '02-rls.sql · lectura de las tablas base a través de 03-vistas.sql',
  },
] as const

/** Las secciones que un rol ve en el menu, en el orden de SECCIONES. */
export function seccionesVisibles(rol: Rol): readonly Seccion[] {
  return SECCIONES.filter((s) => s.rolesQueVen.includes(rol))
}

export function puedeVerSeccion(rol: Rol, clave: ClaveSeccion): boolean {
  const seccion = SECCIONES.find((s) => s.clave === clave)
  // Una seccion desconocida no se abre: fallar cerrado, no adivinar.
  return seccion !== undefined && seccion.rolesQueVen.includes(rol)
}

/**
 * Primera seccion visible para el rol: a donde mandar a alguien que escribio
 * a mano una ruta que su rol no ve. `null` si no ve ninguna (no deberia pasar:
 * los cinco roles ven `hoy`).
 */
export function seccionInicial(rol: Rol): Seccion | null {
  return seccionesVisibles(rol)[0] ?? null
}
