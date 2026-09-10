# Hooks de datos

Un hook por consulta o mutación, construidos sobre TanStack Query y el cliente
único de `src/lib/supabase.ts`.

🔴 PENDIENTE — vacío a propósito: no hay esquema todavía.

Reglas para cuando se escriban:

- La lógica de negocio vive en la base de datos y en `src/lib/`, no en un hook
  de pantalla (07-crm/CLAUDE.md §6).
- Ningún hook devuelve un precio, monto, plazo o condición comercial escrito en
  el código. Todo eso se lee de la tabla `parametros`, con su `fuente` y su
  `estado_semaforo` (07-crm/CLAUDE.md §2).
- Nada se borra: las mutaciones marcan `archivado_el`, nunca hacen `DELETE`
  (regla R8).
- Todo cambio de estado escribe en `estado_historial` con actor y fecha
  (regla R9).
