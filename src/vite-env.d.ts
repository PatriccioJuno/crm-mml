/// <reference types="vite/client" />

/**
 * Variables de entorno de la aplicacion.
 * Solo claves publicas del navegador. La clave `service_role` de Supabase
 * NUNCA se declara aqui ni se expone al cliente (07-crm/CLAUDE.md §5).
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
