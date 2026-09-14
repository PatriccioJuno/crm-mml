-- =====================================================================
-- CRM Mercado Media Luna — 10 · CONTROL DE MIGRACIONES
-- Estado: 🟢 VIGENTE · 14/09/2026
--
-- Orden de ejecución: … → 08-vistas-embudo-e-inventario → 09-separaciones-storage
--                     → 10 (este archivo)
--
-- POR QUÉ EXISTE ESTE ARCHIVO
-- El 14/09/2026 el CRM desplegado falló con 400 y 404 en Embudo, Inventario y
-- Hoy. La causa no fue un error de código: los archivos 07, 08 y 09 llevaban
-- días escritos y NUNCA se habían ejecutado contra la base. El frontend pedía
-- columnas y vistas que en Postgres no existían.
--
-- Lo grave no fue el fallo, sino que no había forma de saberlo salvo esperar a
-- que la aplicación reventara delante de un usuario. Nada registraba qué
-- scripts se habían aplicado y cuáles no.
--
-- Esta tabla es ese registro. No es un sistema de migraciones de verdad (no
-- verifica sumas de control ni impide correr un script dos veces); es la
-- versión mínima que responde la única pregunta que hizo falta ese día:
-- «¿este archivo ya corrió aquí?».
--
-- CÓMO SE USA
-- Al terminar de ejecutar un script nuevo, añade su fila:
--   insert into migraciones_aplicadas (archivo, aplicado_el, nota)
--   values ('11-loquesea.sql', now(), 'que hace, en una linea')
--   on conflict (archivo) do nothing;
--
-- Y para saber qué falta, antes de desplegar:
--   select archivo from migraciones_aplicadas order by archivo;
--
-- 05-pruebas-reglas.sql NO figura a propósito: es una batería de pruebas que
-- se corre cuantas veces haga falta, no una migración que se aplica una vez.
-- =====================================================================

create table if not exists migraciones_aplicadas (
  -- Nombre del archivo tal cual vive en sql\, incluida la extensión.
  archivo        text primary key,

  -- Cuándo se ejecutó de verdad. Es NULO a propósito para 01..04: esos ya
  -- estaban aplicados cuando se creó esta tabla y su fecha original no quedó
  -- registrada en ningún sitio. Inventar una fecha sería peor que admitir el
  -- hueco — es la regla de 07-crm\CLAUDE.md §2 aplicada a los metadatos.
  aplicado_el    timestamptz,

  -- Cuándo se comprobó contra la base que su efecto está presente.
  verificado_el  timestamptz not null default now(),

  nota           text
);

comment on table migraciones_aplicadas is
  'Que scripts de sql\ se han ejecutado contra ESTA base. aplicado_el es nulo cuando la fecha original no quedo registrada. 05-pruebas-reglas.sql no figura: es una bateria de pruebas, no una migracion.';

-- ---------------------------------------------------------------------
-- RLS — misma regla que el resto: `anon` no lee nada (02-rls.sql §0)
-- ---------------------------------------------------------------------
alter table migraciones_aplicadas enable row level security;

drop policy if exists migraciones_leer on migraciones_aplicadas;
create policy migraciones_leer on migraciones_aplicadas
  for select to authenticated using (true);
-- Solo lectura, y solo para usuarios autenticados. Escribir aquí es un acto
-- deliberado de quien aplica una migración desde el panel de Supabase, no algo
-- que la aplicación deba poder hacer sola.

revoke all on migraciones_aplicadas from anon;
grant select on migraciones_aplicadas to authenticated;

-- ---------------------------------------------------------------------
-- Estado verificado contra la base el 14/09/2026
-- ---------------------------------------------------------------------
insert into migraciones_aplicadas (archivo, aplicado_el, nota) values
  ('01-schema.sql',                     null,  '15 tablas, tipos y restricciones base'),
  ('02-rls.sql',                        null,  'politicas RLS, mi_rol(), es(), disparador t_nuevo_usuario'),
  ('03-vistas.sql',                     null,  '13 vistas de reportes'),
  ('04-seed-parametros.sql',            null,  '16 filas en parametros'),
  ('06-registro-rapido.sql',            now(), 'fn_registro_rapido() y origenes_admitidos()'),
  ('07-vistas-hoy.sql',                 now(), 'anade persona_id y oportunidad_id, activa security_invoker'),
  ('08-vistas-embudo-e-inventario.sql', now(), 'v_embudo_tarjetas, v_unidades_tablero, constraint verde_exige_plano'),
  ('09-separaciones-storage.sql',       now(), 'bucket comprobantes y sus 2 politicas')
on conflict (archivo) do nothing;
