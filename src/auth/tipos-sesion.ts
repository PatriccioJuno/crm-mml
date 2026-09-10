/**
 * Contrato minimo de lectura del perfil autenticado.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARCHIVO EXISTE Y POR QUE NO CONTRADICE LA REGLA DE TIPOS
 * ---------------------------------------------------------------------------
 * 07-crm/CLAUDE.md §6 exige tipos GENERADOS desde la base, no escritos a mano.
 * `src/lib/tipos.ts` sigue 🔴 PENDIENTE porque genera falta la sesion de
 * `supabase login` (ver README §Tipos). Mientras tanto, esto NO es una
 * declaracion del esquema: es el subconjunto exacto de columnas que la
 * interfaz lee, mas un lector en tiempo de ejecucion que RECHAZA cualquier
 * fila que no lo cumpla.
 *
 * Fuente verificable de cada campo y de cada valor de rol:
 *   D:\SCPCMO\07-crm\02-codigo\sql\01-schema.sql
 *     · lineas 52-59  → `create type rol_usuario as enum (...)`
 *     · lineas 77-84  → `create table perfiles (...)`
 *
 * 🟡 POR VALIDAR: en cuanto `src/lib/tipos.ts` este generado, `Perfil` debe
 * pasar a derivarse de el:
 *
 *     import type { Database } from '@/lib/tipos'
 *     export type Perfil = Pick<
 *       Database['public']['Tables']['perfiles']['Row'],
 *       'id' | 'nombre' | 'rol' | 'activo'
 *     >
 *
 * y este archivo se queda solo con el lector de tiempo de ejecucion.
 */

/**
 * Los cinco roles del enum `rol_usuario`, en el mismo orden que el esquema.
 * No se anaden, no se renombran y no se inventan roles aqui: si el enum de la
 * base cambia, esta lista se actualiza citando la migracion que lo cambio.
 */
export const ROLES = [
  'direccion', // Walter Ivan. Unico que verifica separaciones (R2)
  'comercial', // Patriccio y futuros vendedores
  'administracion', // Rosa: inventario y cobranza
  'contabilidad', // Carmen Vizcarra
  'lectura',
] as const

export type Rol = (typeof ROLES)[number]

/** Etiquetas para mostrar. Solo presentacion; el valor que manda es `Rol`. */
export const ETIQUETA_ROL: Readonly<Record<Rol, string>> = {
  direccion: 'Dirección',
  comercial: 'Comercial',
  administracion: 'Administración',
  contabilidad: 'Contabilidad',
  lectura: 'Lectura',
}

/** El subconjunto de `perfiles` que la interfaz necesita. Nada mas. */
export type Perfil = {
  id: string
  nombre: string
  rol: Rol
  activo: boolean
}

/**
 * Las columnas que se piden en el `select`. Se pide lo minimo necesario:
 * `telefono` es un dato personal y esta pantalla no lo usa
 * (01-documentacion\05-SEGURIDAD-BACKUPS-Y-LEY-29733.md: minimo necesario).
 */
export const COLUMNAS_PERFIL = 'id, nombre, rol, activo'

function esRol(valor: unknown): valor is Rol {
  return typeof valor === 'string' && (ROLES as readonly string[]).includes(valor)
}

/**
 * Lee una fila cruda de `perfiles` y devuelve `null` si no cumple el contrato.
 *
 * Falla cerrado a proposito: si la base devuelve un rol que este cliente no
 * conoce (porque alguien amplio el enum sin actualizar la interfaz), NO se
 * adivina un rol por defecto — se rechaza la sesion. Adivinar aqui seria
 * exactamente el vacio rellenado que prohibe CLAUDE.md §3.
 */
export function interpretarPerfil(fila: unknown): Perfil | null {
  if (typeof fila !== 'object' || fila === null) return null

  const { id, nombre, rol, activo } = fila as Record<string, unknown>

  if (typeof id !== 'string' || id === '') return null
  if (typeof nombre !== 'string') return null
  if (typeof activo !== 'boolean') return null
  if (!esRol(rol)) return null

  return { id, nombre, rol, activo }
}
