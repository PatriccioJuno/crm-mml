-- =====================================================================
-- CRM Mercado Media Luna — 11 · PRIVILEGIOS DE TABLA
-- Estado: 🟢 VIGENTE · 14/09/2026
--
-- Orden de ejecución: … → 09-separaciones-storage → 10-migraciones → 11
--
-- POR QUÉ EXISTE ESTE ARCHIVO
-- El 14/09/2026, al reinstalar el CRM en un proyecto nuevo, hubo que vaciar el
-- esquema con `drop schema public cascade`. Después la instalación entera corrió
-- sin un error —16 tablas, 15 vistas, 35 políticas— y aun así la aplicación no
-- dejaba entrar a nadie:
--
--     GET /rest/v1/perfiles  ->  403
--     [sesion] No se pudo leer el perfil: permission denied for table perfiles
--
-- Ese mensaje NO es RLS. Una política que deniega devuelve cero filas, no un
-- 403: RLS filtra, no prohíbe. «permission denied for table» es un GRANT que
-- falta, una capa por debajo de las políticas.
--
-- La causa: ningún script de sql\ concede privilegios de tabla a
-- `authenticated`. 02-rls.sql §0 solo concede USAGE del esquema, y nunca hizo
-- falta más porque Supabase trae unos DEFAULT PRIVILEGES que conceden sola cada
-- tabla que se cree en `public`. `drop schema public cascade` se lleva esos
-- defaults por delante, y `create schema public` lo devuelve desnudo.
--
-- En una instalación normal sobre un proyecto recién creado este archivo NO
-- hace falta: los defaults de Supabase ya están. Es idempotente, así que
-- ejecutarlo de todos modos no rompe nada — y evita depender de que el proyecto
-- venga con los defaults intactos, que es exactamente lo que falló.
--
-- LAS DOS CAPAS, Y POR QUÉ LAS DOS TIENEN QUE ESTAR
--   · GRANT dice QUÉ ROL puede tocar la tabla.        (esta capa, aquí)
--   · RLS  dice QUÉ FILAS ve ese rol.                 (02-rls.sql)
-- Sin GRANT, RLS no llega a evaluarse. Con GRANT y sin RLS, se ve todo. Las dos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Los roles de servicio
-- ---------------------------------------------------------------------
grant all privileges on all tables    in schema public to postgres, service_role;
grant all privileges on all sequences in schema public to postgres, service_role;
grant all privileges on all functions in schema public to postgres, service_role;

-- ---------------------------------------------------------------------
-- 2 · `authenticated` — el rol de cualquiera que haya iniciado sesión
-- ---------------------------------------------------------------------
-- Se le da acceso a TODAS las tablas a propósito. Quien decide qué filas ve
-- cada quien es RLS, evaluado con auth.uid() fila por fila. Intentar afinar
-- aquí por tabla sería un segundo sistema de permisos que se desincronizaría
-- del primero — y el que manda, el único que el navegador no puede esquivar,
-- es el de 02-rls.sql.
grant select, insert, update, delete on all tables    in schema public to authenticated;
grant usage, select                  on all sequences in schema public to authenticated;
grant execute                        on all functions in schema public to authenticated;

-- ---------------------------------------------------------------------
-- 3 · Lo que se cree en el futuro, concedido solo
-- ---------------------------------------------------------------------
-- Sin esto, la siguiente tabla que alguien añada nacería sin privilegios y
-- reventaría igual que `perfiles` — pero un mes después, cuando nadie recuerde
-- este archivo. Reponer los defaults es la mitad que importa.
alter default privileges in schema public grant all on tables    to postgres, service_role;
alter default privileges in schema public grant all on sequences to postgres, service_role;
alter default privileges in schema public grant all on functions to postgres, service_role;

alter default privileges in schema public grant select, insert, update, delete on tables    to authenticated;
alter default privileges in schema public grant usage, select                  on sequences to authenticated;
alter default privileges in schema public grant execute                        on functions to authenticated;

-- ---------------------------------------------------------------------
-- 4 · `anon` sigue sin nada
-- ---------------------------------------------------------------------
-- Regla dura de 02-rls.sql §0: este CRM no tiene páginas públicas, así que el
-- rol anónimo no necesita leer ni una fila. Se repite aquí porque el paso 2
-- concede sobre `all tables` y conviene que la revocación quede DESPUÉS y a la
-- vista, no confiada a que nadie amplíe el paso 2 sin darse cuenta.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------
-- 5 · Comprobación
-- ---------------------------------------------------------------------
-- Las seis respuestas tienen que ser `true`. Si alguna sale `false`, la
-- aplicación devolverá 403 con «permission denied for table», no un error de
-- RLS: busca aquí, no en 02-rls.sql.
--
--   select 'authenticated lee perfiles'      as comprobacion,
--          has_table_privilege('authenticated','perfiles','SELECT')::text  as resultado
--   union all select 'authenticated lee v_embudo_tarjetas',
--          has_table_privilege('authenticated','v_embudo_tarjetas','SELECT')::text
--   union all select 'authenticated escribe personas',
--          has_table_privilege('authenticated','personas','INSERT')::text
--   union all select 'anon NO lee perfiles',
--          (not has_table_privilege('anon','perfiles','SELECT'))::text
--   union all select 'anon NO lee personas',
--          (not has_table_privilege('anon','personas','SELECT'))::text
--   union all select 'anon NO lee parametros',
--          (not has_table_privilege('anon','parametros','SELECT'))::text;

insert into migraciones_aplicadas (archivo, aplicado_el, nota) values
  ('11-privilegios.sql', now(), 'grants de tabla a authenticated y default privileges; anon sin nada')
on conflict (archivo) do nothing;
