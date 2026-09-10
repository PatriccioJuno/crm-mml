/**
 * Tipos del dominio, GENERADOS desde la base de datos.
 *
 * 07-crm/CLAUDE.md §6: "Tipos generados desde la base de datos, no escritos a mano."
 *
 * TODO: generar este archivo con (requiere `npx supabase login` una vez):
 *
 *   npm run tipos
 *
 * que ejecuta:
 *
 *   supabase gen types typescript --project-id klqltduvtfqymchdsdob --schema public > src/lib/tipos.ts
 *
 * El project-id (o "reference id") está en el panel de Supabase, en
 * Project Settings → General → Reference ID; también es el subdominio de la
 * URL del proyecto (https://<project-id>.supabase.co) y del panel
 * (https://supabase.com/dashboard/project/<project-id>).
 *
 * Hasta entonces este archivo queda vacio a proposito. NO escribir tipos a mano
 * aqui: un tipo inventado es una afirmacion sobre el esquema sin fuente que la
 * respalde, y es exactamente lo que la regla de la fuente de verdad prohibe.
 *
 * En cuanto exista, `src/auth/tipos-sesion.ts` debe pasar a derivar `Perfil`
 * de `Database['public']['Tables']['perfiles']['Row']` (ver la nota alli).
 *
 * Estado: 🔴 PENDIENTE — falta ejecutar la generacion contra el proyecto.
 */

export {}
