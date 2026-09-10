import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Cliente unico de Supabase para toda la aplicacion.
 *
 * Reglas que este archivo hace cumplir (07-crm/CLAUDE.md §5):
 *  - Solo la clave `anon`. La clave `service_role` jamas llega al navegador.
 *  - La clave `anon` solo es segura si TODAS las tablas tienen RLS activado.
 *    Antes de cargar un solo dato real hay que pasar la bateria de pruebas de
 *    RLS de 01-documentacion\05-SEGURIDAD-BACKUPS-Y-LEY-29733.md.
 *  - Se instancia UNA sola vez. Crear varios clientes rompe la sesion y duplica
 *    las suscripciones en tiempo real.
 *
 * Los tipos de la base se generan a src/lib/tipos.ts; mientras ese archivo este
 * vacio, el cliente queda sin tipar por esquema (no se inventan tipos a mano).
 */

const url = import.meta.env.VITE_SUPABASE_URL
const claveAnonima = import.meta.env.VITE_SUPABASE_ANON_KEY

/** Indica si el entorno esta configurado. La interfaz puede consultarlo. */
export const supabaseConfigurado: boolean = Boolean(url && claveAnonima)

if (!supabaseConfigurado && import.meta.env.DEV) {
  console.warn(
    '[supabase] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY.\n' +
      'Copia .env.example a .env.local y rellenalos. ' +
      'La aplicacion arranca igual, pero cualquier consulta fallara.',
  )
}

export const supabase: SupabaseClient = createClient(url ?? '', claveAnonima ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
