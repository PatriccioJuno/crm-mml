-- =====================================================================
-- CRM Mercado Media Luna — 13 · SEGUIMIENTO COMERCIAL
-- Estado: 🟡 POR APLICAR · 29/09/2026
--         Ensayado entero con pruebas/reglas-13.sql DENTRO de una transacción
--         que se aborta a propósito (protocolo de SPEC §4.9): nada de esto está
--         aplicado todavía en ningún proyecto. Quien lo aplique anota la fila en
--         migraciones_aplicadas (la última sentencia de este archivo lo hace).
--
-- Orden de ejecución: … → 10-migraciones → 11-privilegios → 12-captacion → 13
--
-- POR QUÉ EXISTE ESTE ARCHIVO
-- El 28/09/2026 entraron 50 leads de un TikTok Live y nadie pudo cargarlos
-- rápido: `fn_registro_rapido` es de uno en uno, no acepta @usuario ni campaña,
-- y —por ser SECURITY INVOKER— abre una SEGUNDA oportunidad activa cuando el
-- teléfono ya es de otro vendedor o de un lead web sin dueño (RLS le esconde la
-- primera; ver analisis/sql.md §7.3). El vendedor pidió además: perfil del
-- prospecto (capital, contado/financiado, puesto/tienda y cuál, cuándo compra,
-- para qué lo quiere), temperatura con una sección de «fríos», visitas
-- agendadas con aviso al cliente, documentos, y una bandeja para los leads que
-- llegan solos desde mercadomedialuna.com.
--
-- QUÉ AÑADE
--   1 · Higiene: FORCE RLS donde faltaba, `anon` sin EXECUTE en las funciones
--       de ayuda, R8 en tareas, bitácora de personas (Ley 29733) y el `motivo`
--       del historial de estados por fin relleno (R9).
--   2 · Columnas nuevas: @usuario de red, «no contactar», motivos de frío y de
--       descarte como códigos, temperatura fijada a mano, resultado de cada
--       contacto, tipo de tarea.
--   3 · Tablas nuevas: oportunidad_perfil, oportunidad_eventos, visitas,
--       notificaciones, documentos (+ bucket privado `documentos`).
--   4 · Parámetros operativos nuevos (cadencia, umbrales de frío/temperatura,
--       visitas) — TODOS en 🔵 azul o 🔴 rojo, ninguno en verde.
--   5 · Las funciones que usa la interfaz (registro uno a uno y por lotes,
--       contacto, situación, perfil, bandeja, visitas, avisos, documentos).
--   6 · La vista `v_cartera`: una fila por oportunidad con su temperatura.
--   7 · Un cambio de RLS: un `comercial` ve los leads SIN dueño.
--
-- REGLA DE LA FUENTE DE VERDAD
-- Aquí no hay ni un precio, ni un monto, ni un plazo comercial, ni una cantidad
-- de unidades. Lo único numérico que se siembra (§4) son umbrales OPERATIVOS de
-- seguimiento —cada cuántos días se reintenta, cuántos intentos sin respuesta
-- mandan un lead a fríos—, y van en 🔵 PROPUESTA con la ruta exacta del
-- documento que los sugiere, por decisión del dueño del 29/09/2026 (SPEC §1):
-- Walter los ratifica o cambia desde la pantalla Parámetros. Todo dato que
-- llegue al CLIENTE (razón social, RUC, correo, ubicación de la visita) se lee
-- SOLO si su parámetro está en 🟢 verde (`parametro_publico`). Si no, falta, y
-- se nota — no se rellena.
--
-- SEGURIDAD (07-crm\CLAUDE.md §5)
--   · Toda tabla nueva: ENABLE + FORCE RLS y `revoke all … from anon`.
--   · Toda función SECURITY DEFINER comprueba el rol de quien llama ANTES de
--     tocar nada, lleva `set search_path = public` y queda revocada de
--     `public` y `anon`. Las que tocan una oportunidad exigen además
--     `puede_operar_oportunidad()`: el DEFINER salta RLS, así que la regla de
--     «un comercial solo opera lo suyo o lo que no tiene dueño» tiene que vivir
--     dentro de la función o no vive en ningún sitio.
--   · Las funciones auxiliares internas son SECURITY INVOKER: llamadas desde
--     una DEFINER corren como su dueño; llamadas directamente por un usuario
--     corren con SUS permisos y RLS, así que no regalan nada aunque alguien
--     vuelva a conceder EXECUTE con 11-privilegios.sql.
--
-- IDEMPOTENTE: se puede ejecutar dos veces seguidas sin error y sin duplicar
-- nada (`if not exists`, `create or replace`, `drop … if exists` + `create`,
-- restricciones añadidas solo si faltan, parámetros `on conflict do nothing`).
-- El protocolo de ensayo lo corre DOS veces en la misma transacción.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1 · HIGIENE — lo que 02, 10 y 12 dejaron a medias
-- ---------------------------------------------------------------------

-- 1a · FORCE RLS en las dos tablas que lo olvidaron (10:59 y 12:56). Con
--      `postgres` en BYPASSRLS es casi cosmético, pero la prueba RLS-b de
--      pruebas/reglas.sql las marcaba 🟡 REVISAR, y la regla es «sin excepción».
alter table captacion_bruta       force row level security;
alter table migraciones_aplicadas force row level security;

-- 1b · `anon` podía EJECUTAR estas cuatro (vía PUBLIC, que PostgreSQL concede
--      por defecto a toda función). El encabezado de 12-captacion.sql afirma que
--      fn_captar_prospecto es lo ÚNICO que anon puede hacer; ahora es verdad
--      para estas cuatro. fn_captar_prospecto conserva su grant a anon: es
--      DEFINER, así que cuando llama a origenes_admitidos() lo hace como su
--      dueño y no le hace falta que anon la pueda ejecutar.
revoke execute on function mi_rol()                      from public, anon;
revoke execute on function es(rol_usuario[])             from public, anon;
revoke execute on function puede_emitir_constancia(uuid) from public, anon;
revoke execute on function origenes_admitidos()          from public, anon;
grant  execute on function mi_rol(), es(rol_usuario[]), puede_emitir_constancia(uuid),
                           origenes_admitidos() to authenticated;

-- 1c · R8 en tareas. `tareas_escribir` (02-rls.sql) es FOR ALL: un comercial
--      podía BORRAR la tarea de otro, y con ella la prueba de que R6 se cumplía.
--      Una tarea que ya no hace falta se CIERRA (completada_el + cierre_motivo).
drop trigger if exists t_no_delete_tareas on tareas;
create trigger t_no_delete_tareas before delete on tareas
  for each row execute function fn_prohibir_delete();

-- 1d · Bitácora de personas. Ley 29733 / DS 016-2024-JUS: hay que poder decir
--      quién cambió un dato personal y cuándo. Hasta hoy `personas` no tenía
--      rastro (analisis/sql.md §5.4). fn_bitacora ya existe (01-schema §11).
drop trigger if exists t_bit_personas on personas;
create trigger t_bit_personas after insert or update on personas
  for each row execute function fn_bitacora();

-- 1e · R9 con motivo. `estado_historial.motivo` existía desde 01-schema.sql y
--      NUNCA se llenaba: las 9 filas vivas tienen motivo NULL. Las funciones de
--      este archivo dejan el porqué en la variable de sesión `crm.motivo`
--      (set_config con is_local = true: muere con la transacción) justo antes de
--      cambiar estado/situación/responsable; el disparador la recoge. Un UPDATE
--      que no la fija (p. ej. mover una tarjeta del tablero) deja motivo NULL,
--      igual que antes: no se inventa.
create or replace function fn_registrar_cambio_estado() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_motivo text := nullif(current_setting('crm.motivo', true), '');
begin
  if tg_op = 'INSERT' then
    insert into estado_historial (oportunidad_id, de_estado, a_estado, actor_id, motivo)
    values (new.id, null, new.estado, auth.uid(), v_motivo);
  elsif new.estado is distinct from old.estado then
    insert into estado_historial (oportunidad_id, de_estado, a_estado, actor_id, motivo)
    values (new.id, old.estado, new.estado, auth.uid(), v_motivo);
  end if;
  return new;
end $$;


-- ---------------------------------------------------------------------
-- 2 · COLUMNAS NUEVAS (todas admiten NULL salvo tareas.tipo)
-- ---------------------------------------------------------------------
-- Ningún enum nuevo: `alter type … add value` no se puede usar en la misma
-- transacción que lo añade, y el SQL Editor corre el pegado entero como una.
-- Texto + CHECK, como ya hacen `origen` y `cal_forma_pago`.

-- 2a · personas
alter table personas
  add column if not exists usuario_red         text,        -- sin '@', en minúsculas
  add column if not exists red_social          text,
  add column if not exists no_contactar_el     timestamptz, -- opt-out del titular
  add column if not exists no_contactar_motivo text;

comment on column personas.usuario_red is
  'Usuario publico de la red (TikTok/IG/FB/YT) sin arroba y en minusculas. Es la clave de deduplicacion cuando el lead dejo su @ en un live y no su telefono. Lo normaliza el disparador t_personas_usuario_red.';
comment on column personas.no_contactar_el is
  'Opt-out: la persona pidio no ser contactada. Pone consentimiento=false (SOP-SEGUIMIENTO.md:61) y cierra todas sus oportunidades. Solo se levanta con consentimiento renovado (fn_cambiar_situacion reactivar + consentimiento_renovado).';

create index if not exists personas_red_usuario
  on personas (red_social, lower(usuario_red)) where usuario_red is not null;

-- El @ se guarda de UNA forma, pase por donde pase (función, ficha, panel):
-- sin arrobas delante, sin espacios, en minúsculas. Un «@Juan» y un «juan»
-- son la misma persona; si se guardaran distintos, la deduplicación fallaría
-- en silencio y el live volvería a dar dos fichas.
create or replace function fn_normalizar_usuario_red() returns trigger
language plpgsql set search_path = public as $fn$
begin
  new.usuario_red := nullif(lower(regexp_replace(btrim(coalesce(new.usuario_red, '')), '^@+', '')), '');
  new.red_social  := nullif(lower(btrim(coalesce(new.red_social, ''))), '');
  return new;
end $fn$;

drop trigger if exists t_personas_usuario_red on personas;
create trigger t_personas_usuario_red before insert or update of usuario_red, red_social on personas
  for each row execute function fn_normalizar_usuario_red();

-- 2b · oportunidades
alter table oportunidades
  -- Atribución de ESTA oportunidad. `personas.campana_id` sigue siendo el primer
  -- contacto (el que cuenta v_rendimiento_campanas); una persona que vuelve en
  -- otro live tiene otra oportunidad con otra campaña.
  add column if not exists campana_id                uuid references campanas(id),
  -- «Fríos» = situacion 'pausada' + este código + una tarea de reactivación.
  add column if not exists motivo_frio               text,
  add column if not exists enfriado_el               timestamptz,
  -- Descarte = situacion 'perdida' + código (el texto libre sigue en motivo_perdida).
  add column if not exists motivo_perdida_codigo     text,
  -- Temperatura fijada a mano por el vendedor (anula la calculada; se registra quién y por qué).
  add column if not exists temperatura_manual        text,
  add column if not exists temperatura_manual_motivo text,
  add column if not exists temperatura_manual_el     timestamptz,
  add column if not exists temperatura_manual_por    uuid references perfiles(id);

create index if not exists oportunidades_persona
  on oportunidades (persona_id) where archivado_el is null;

-- 2c · interacciones
alter table interacciones
  add column if not exists resultado text,   -- qué pasó en ese contacto
  add column if not exists plantilla text;   -- id de la plantilla usada: auditoría de lo que se le dijo al cliente

create index if not exists interacciones_oportunidad
  on interacciones (oportunidad_id, ocurrio_el desc);

-- 2d · tareas
alter table tareas
  add column if not exists tipo          text not null default 'otro',
  add column if not exists visita_id     uuid,   -- FK a visitas, más abajo (§3c)
  add column if not exists cierre_motivo text;   -- por qué se cerró (R8: se cierra, no se borra)

create index if not exists tareas_oportunidad_abiertas
  on tareas (oportunidad_id, vence_el) where completada_el is null;
create index if not exists tareas_visita
  on tareas (visita_id) where visita_id is not null;

-- 2e · Las restricciones, solo si faltan (así el archivo se puede repetir).
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'personas'::regclass
                  and conname = 'personas_red_social_valido') then
    alter table personas add constraint personas_red_social_valido
      check (red_social is null or red_social in ('tiktok','instagram','facebook','youtube','otra'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'personas'::regclass
                  and conname = 'personas_usuario_red_valido') then
    alter table personas add constraint personas_usuario_red_valido
      check (usuario_red is null or (usuario_red = lower(usuario_red) and usuario_red !~ '[@[:space:]]'));
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'oportunidades'::regclass
                  and conname = 'oportunidades_motivo_frio_valido') then
    alter table oportunidades add constraint oportunidades_motivo_frio_valido
      check (motivo_frio is null or motivo_frio in
             ('no_responde','mas_adelante','sin_capital_ahora','no_asistio','otro'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'oportunidades'::regclass
                  and conname = 'oportunidades_motivo_perdida_codigo_valido') then
    alter table oportunidades add constraint oportunidades_motivo_perdida_codigo_valido
      check (motivo_perdida_codigo is null or motivo_perdida_codigo in
             ('no_interesa','numero_invalido','pidio_no_contacto','sin_capital','compro_otro',
              'no_encaja','duplicado','spam','no_reconoce','otro'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'oportunidades'::regclass
                  and conname = 'oportunidades_temperatura_manual_valido') then
    alter table oportunidades add constraint oportunidades_temperatura_manual_valido
      check (temperatura_manual is null or temperatura_manual in ('caliente','tibio','frio'));
  end if;

  -- cal_forma_pago y cal_operar_o_invertir existen desde 01-schema.sql SIN
  -- restricción. Si la base viva tuviera ya un valor fuera de lista, un CHECK
  -- normal haría fallar la migración entera. Se añade NOT VALID (obliga a todo
  -- lo que entre desde ya) y se VALIDA solo si ninguna fila vieja lo incumple.
  -- Si alguna lo incumple, queda NOT VALID y la consulta de abajo la delata:
  --   select id, cal_forma_pago, cal_operar_o_invertir from oportunidades
  --    where cal_forma_pago not in ('contado','facilidades')
  --       or cal_operar_o_invertir not in ('operar','alquilar_a_terceros','invertir','busca_alquilar');
  if not exists (select 1 from pg_constraint where conrelid = 'oportunidades'::regclass
                  and conname = 'oportunidades_cal_forma_pago_valido') then
    alter table oportunidades add constraint oportunidades_cal_forma_pago_valido
      check (cal_forma_pago is null or cal_forma_pago in ('contado','facilidades')) not valid;
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'oportunidades'::regclass
              and conname = 'oportunidades_cal_forma_pago_valido' and not convalidated)
     and not exists (select 1 from oportunidades
                      where cal_forma_pago is not null
                        and cal_forma_pago not in ('contado','facilidades')) then
    alter table oportunidades validate constraint oportunidades_cal_forma_pago_valido;
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'oportunidades'::regclass
                  and conname = 'oportunidades_cal_operar_o_invertir_valido') then
    alter table oportunidades add constraint oportunidades_cal_operar_o_invertir_valido
      check (cal_operar_o_invertir is null or cal_operar_o_invertir in
             ('operar','alquilar_a_terceros','invertir','busca_alquilar')) not valid;
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'oportunidades'::regclass
              and conname = 'oportunidades_cal_operar_o_invertir_valido' and not convalidated)
     and not exists (select 1 from oportunidades
                      where cal_operar_o_invertir is not null
                        and cal_operar_o_invertir not in
                            ('operar','alquilar_a_terceros','invertir','busca_alquilar')) then
    alter table oportunidades validate constraint oportunidades_cal_operar_o_invertir_valido;
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'interacciones'::regclass
                  and conname = 'interacciones_resultado_valido') then
    alter table interacciones add constraint interacciones_resultado_valido
      check (resultado is null or resultado in
             ('contesto','no_contesta','buzon','visto_sin_respuesta','numero_equivocado','respondio',
              'mas_adelante','no_interesa','pidio_no_contacto','agendo_visita','aviso_visita','nota'));
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'tareas'::regclass
                  and conname = 'tareas_tipo_valido') then
    alter table tareas add constraint tareas_tipo_valido
      check (tipo in ('primer_contacto','seguimiento','reactivacion','visita','confirmar_visita','otro'));
  end if;
end $$;

-- 2f · Tareas tipadas también desde las funciones que este archivo NO toca.
--      fn_registro_rapido (06) y fn_captar_prospecto (12) crean «Primer
--      contacto» sin saber que existe `tipo`. Un disparador lo arregla en vez de
--      reescribir dos funciones que ya funcionan.
update tareas set tipo = 'primer_contacto'
 where titulo = 'Primer contacto' and tipo = 'otro';

create or replace function fn_tareas_tipo() returns trigger
language plpgsql set search_path = public as $fn$
begin
  if new.tipo = 'otro' and new.titulo = 'Primer contacto' then
    new.tipo := 'primer_contacto';
  end if;
  return new;
end $fn$;

drop trigger if exists t_tareas_tipo on tareas;
create trigger t_tareas_tipo before insert on tareas
  for each row execute function fn_tareas_tipo();


-- ---------------------------------------------------------------------
-- 3 · TABLAS NUEVAS
-- ---------------------------------------------------------------------

-- 3a · oportunidad_perfil — el perfil comercial, 1 a 1 con la oportunidad.
-- Tabla APARTE y no columnas en `oportunidades`, a propósito: `oport_leer`
-- (02-rls.sql) deja a `lectura` y `contabilidad` leer TODAS las oportunidades,
-- y el capital declarado de una persona puede ser dato sensible
-- (analisis/critique.md C8). Aquí esos dos roles no entran.
-- Nada de rangos de dinero: el capital va como CATEGORÍA relativa al producto
-- («le alcanza para la inicial») y, si el cliente lo dice, como monto CON SU
-- MONEDA (R7). Las cifras de inicial/contado viven en 00-fuente-de-verdad.
create table if not exists oportunidad_perfil (
  oportunidad_id     uuid primary key references oportunidades(id),
  tipo_interes       text,          -- null = no sabe todavía
  interes_detalle    text,          -- «cuál»: código, zona o rubro, en texto mientras no hay inventario
  rubro              text,
  situacion_actual   text,
  capital_categoria  text,
  capital_monto      numeric(14,2),
  capital_moneda     moneda,
  horizonte_compra   text,
  mes_objetivo       date,          -- 1.er día del mes objetivo en America/Lima (lo calcula fn_guardar_perfil)
  decide_con         text,
  zona_procedencia   text,
  objeciones         text[] not null default '{}',
  canal_preferido    text,
  horario_preferido  text,
  respuestas_web     jsonb,         -- respuestas del chat web, solo claves y valores de la lista blanca
  fuente_perfil      text not null default 'agente',
  actualizado_el     timestamptz not null default now(),
  actualizado_por    uuid references perfiles(id),

  constraint oportunidad_perfil_tipo_interes_valido
    check (tipo_interes is null or tipo_interes in ('puesto','tienda','ambos')),
  constraint oportunidad_perfil_rubro_valido
    check (rubro is null or rubro in ('abarrotes','frutas_verduras','carnes','comida_jugos','ropa_bazar','otro')),
  constraint oportunidad_perfil_situacion_actual_valido
    check (situacion_actual is null or situacion_actual in ('alquila_puesto','ambulante_feria','local_propio','sin_negocio')),
  constraint oportunidad_perfil_capital_categoria_valido
    check (capital_categoria is null or capital_categoria in ('cubre_contado','cubre_inicial','menor_inicial','no_declara')),
  constraint oportunidad_perfil_capital_monto_valido
    check (capital_monto is null or capital_monto >= 0),
  -- R7 · un monto sin moneda no es un dato, es un número suelto.
  constraint capital_con_moneda
    check (capital_monto is null or capital_moneda is not null),
  constraint oportunidad_perfil_horizonte_compra_valido
    check (horizonte_compra is null or horizonte_compra in ('este_mes','proximo_mes','2_3_meses','mas_adelante')),
  constraint oportunidad_perfil_decide_con_valido
    check (decide_con is null or decide_con in ('pareja','familia','socio','otro')),
  constraint oportunidad_perfil_zona_procedencia_valido
    check (zona_procedencia is null or zona_procedencia in ('cerca','lima','provincia','extranjero')),
  constraint oportunidad_perfil_objeciones_valido
    check (objeciones <@ array['precio','confianza_legal','distancia','avance_obra','financiamiento','ubicacion','otro']::text[]),
  constraint oportunidad_perfil_canal_preferido_valido
    check (canal_preferido is null or canal_preferido in ('whatsapp','llamada','email')),
  constraint oportunidad_perfil_respuestas_web_valido
    check (respuestas_web is null or jsonb_typeof(respuestas_web) = 'object'),
  constraint oportunidad_perfil_fuente_perfil_valido
    check (fuente_perfil in ('agente','web','mixto'))
);

comment on table oportunidad_perfil is
  'Perfil comercial 1:1 con la oportunidad. Tabla aparte para que lectura y contabilidad NO lean el capital declarado. Sin politicas de escritura: solo se escribe con fn_guardar_perfil. Capital como categoria relativa al producto; el monto, si existe, lleva su moneda (R7).';

-- 3b · oportunidad_eventos — R9 para lo que NO es el estado del embudo.
-- `estado_historial` solo registra `estado`. Cambios de situación (fríos,
-- descarte), de responsable, de motivo de pérdida o de temperatura no dejaban
-- rastro (la oportunidad viva está 'perdida' sin rastro de quién ni cuándo).
-- `bitacora` no sirve de línea de tiempo: solo la lee dirección.
create table if not exists oportunidad_eventos (
  id             bigserial primary key,
  oportunidad_id uuid not null references oportunidades(id),
  tipo           text not null,
  de             text,
  a              text,
  motivo         text,
  actor_id       uuid references perfiles(id),
  ocurrio_el     timestamptz not null default now(),
  constraint oportunidad_eventos_tipo_valido
    check (tipo in ('situacion','responsable','motivo_perdida','temperatura','perfil',
                    'visita','documento','bandeja','contacto'))
);
create index if not exists oportunidad_eventos_oportunidad
  on oportunidad_eventos (oportunidad_id, ocurrio_el desc);

comment on table oportunidad_eventos is
  'Solo de agregar (R9). Situacion, responsable, motivo de perdida y temperatura los escribe el disparador t_oportunidad_eventos; perfil, visita, documento, bandeja y contacto, las funciones de 13. Se lee con el RLS de la oportunidad.';

-- 3c · visitas — hoy una visita no cabe en `tareas` (sin tipo, lugar ni estado).
create table if not exists visitas (
  id                 uuid primary key default gen_random_uuid(),
  oportunidad_id     uuid not null references oportunidades(id),
  persona_id         uuid not null references personas(id),
  responsable_id     uuid references perfiles(id),
  tipo               text not null,
  inicio_el          timestamptz not null,
  duracion_min       integer,     -- de parametros('visita_duracion_min'): solo para el bloque del .ics
  estado             text not null default 'agendada',
  viene_codecisor    boolean,
  nota               text,
  resultado          text,
  resultado_nota     text,
  reprogramada_de_id uuid references visitas(id),
  -- UID del evento de calendario. Una reprogramación CONSERVA el uid y sube la
  -- secuencia: así el calendario del cliente mueve el evento en vez de duplicarlo.
  ics_uid            text not null,
  ics_secuencia      integer not null default 0,
  confirmada_el      timestamptz,
  realizada_el       timestamptz,
  aviso_enviado_el   timestamptz,
  aviso_canal        text,
  archivado_el       timestamptz,
  creado_el          timestamptz not null default now(),
  creado_por         uuid references perfiles(id) default auth.uid(),
  actualizado_el     timestamptz not null default now(),
  constraint visitas_tipo_valido
    check (tipo in ('obra','videollamada','oficina')),
  constraint visitas_duracion_min_valido
    check (duracion_min is null or duracion_min > 0),
  constraint visitas_estado_valido
    check (estado in ('agendada','confirmada','realizada','no_asistio','reprogramada','cancelada')),
  constraint visitas_resultado_valido
    check (resultado is null or resultado in ('interesado','lo_piensa','no_interesa','separo'))
);

-- Una oportunidad, UNA visita abierta. Dos visitas vivas para el mismo lead
-- son dos avisos contradictorios en el WhatsApp del cliente.
create unique index if not exists visitas_una_abierta_por_oportunidad
  on visitas (oportunidad_id)
  where estado in ('agendada','confirmada') and archivado_el is null;
create index if not exists visitas_oportunidad
  on visitas (oportunidad_id, creado_el desc);
create index if not exists visitas_proximas
  on visitas (inicio_el) where estado in ('agendada','confirmada') and archivado_el is null;

comment on table visitas is
  'Visitas a la obra, videollamadas o citas en oficina. Una sola abierta por oportunidad (indice visitas_una_abierta_por_oportunidad). Se escribe solo con fn_agendar_visita / fn_actualizar_visita, que dejan las tareas (R6) y la interaccion.';

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'tareas'::regclass
                  and conname = 'tareas_visita_fk') then
    alter table tareas add constraint tareas_visita_fk
      foreign key (visita_id) references visitas(id);
  end if;
end $$;

-- 3d · notificaciones — qué aviso se preparó o envió, por dónde y a quién.
-- Se guarda también el aviso MANUAL (mailto, .ics, WhatsApp): si mañana el
-- titular pregunta qué se le mandó (Ley 29733), la respuesta está aquí.
create table if not exists notificaciones (
  id             uuid primary key default gen_random_uuid(),
  visita_id      uuid references visitas(id),
  oportunidad_id uuid references oportunidades(id),
  persona_id     uuid not null references personas(id),
  canal          text not null,
  modo           text not null,
  plantilla      text not null,
  destinatario   text,
  estado         text not null,
  proveedor_id   text,
  error          text,
  creado_el      timestamptz not null default now(),
  creado_por     uuid references perfiles(id) default auth.uid(),
  constraint notificaciones_canal_valido  check (canal in ('email','whatsapp','ics')),
  constraint notificaciones_modo_valido   check (modo in ('manual','automatico')),
  constraint notificaciones_estado_valido check (estado in ('preparada','enviada','error'))
);
create index if not exists notificaciones_visita
  on notificaciones (visita_id, creado_el desc);

-- 3e · documentos — DNI, vouchers, constancias, contratos… con su RLS propio.
-- NO se reutiliza el bucket `comprobantes`: `comprobantes_leer` deja leer
-- cualquier archivo a los cinco roles (09-separaciones-storage.sql), y un DNI
-- escaneado no puede quedar a la vista de `lectura`.
create table if not exists documentos (
  id               uuid primary key default gen_random_uuid(),
  persona_id       uuid not null references personas(id),
  oportunidad_id   uuid references oportunidades(id),
  tipo             text not null,
  sentido          text not null default 'recibido',
  nombre_archivo   text not null,
  ruta             text not null unique,   -- nombre del objeto en el bucket `documentos`
  mime             text,
  tamano_bytes     bigint,
  nota             text,
  verificado_el    timestamptz,
  verificado_por   uuid references perfiles(id),
  archivado_el     timestamptz,
  archivado_motivo text,
  creado_el        timestamptz not null default now(),
  creado_por       uuid references perfiles(id) default auth.uid(),
  constraint documentos_tipo_valido
    check (tipo in ('dni','voucher_separacion','constancia_separacion','contrato','recibo',
                    'plano_entregado','material_enviado','otro')),
  constraint documentos_sentido_valido check (sentido in ('recibido','enviado'))
);
create index if not exists documentos_persona
  on documentos (persona_id, creado_el desc);
create index if not exists documentos_oportunidad
  on documentos (oportunidad_id) where oportunidad_id is not null;

comment on table documentos is
  'Metadatos de los archivos del bucket privado documentos. El objeto solo se puede leer si su fila existe, no esta archivada y el RLS de esta tabla deja verla (politica documentos_leer de storage.objects). El DNI no lo ven lectura ni contabilidad.';

-- 3f · RLS de las cinco tablas: ENABLE + FORCE, anon fuera.
do $$
declare t text;
begin
  foreach t in array array['oportunidad_perfil','oportunidad_eventos','visitas',
                           'notificaciones','documentos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;
revoke all on sequence oportunidad_eventos_id_seq from anon;
-- Privilegio de TABLA explícito para authenticated. En la base viva ya lo dan
-- los default privileges de 11-privilegios.sql, pero este archivo no debe
-- depender de que quien lo corra sea el mismo rol que los fijó: sin el grant,
-- PostgREST responde «permission denied for table» (403) antes de mirar RLS.
-- SELECT en las cinco; INSERT solo en documentos (la única con política de
-- alta). Las demás escrituras van por funciones DEFINER.
grant select on oportunidad_perfil, oportunidad_eventos, visitas, notificaciones, documentos
  to authenticated;
grant insert on documentos to authenticated;

-- Lectura: «si ves la oportunidad, ves lo suyo». El `exists` sobre
-- `oportunidades` se evalúa con el RLS de QUIEN CONSULTA, así que un comercial
-- ve lo de sus oportunidades y lo de las que no tienen dueño (§7), y nada más.
-- El perfil excluye además a lectura y contabilidad (dato sensible).
drop policy if exists perfil_leer on oportunidad_perfil;
create policy perfil_leer on oportunidad_perfil for select to authenticated
  using (es(array['direccion','comercial','administracion']::rol_usuario[])
         and exists (select 1 from oportunidades o where o.id = oportunidad_perfil.oportunidad_id));

drop policy if exists eventos_leer on oportunidad_eventos;
create policy eventos_leer on oportunidad_eventos for select to authenticated
  using (exists (select 1 from oportunidades o where o.id = oportunidad_eventos.oportunidad_id));

drop policy if exists visitas_leer on visitas;
create policy visitas_leer on visitas for select to authenticated
  using (exists (select 1 from oportunidades o where o.id = visitas.oportunidad_id));

-- Un aviso sin oportunidad (no debería haberlo) solo lo ve dirección.
drop policy if exists notif_leer on notificaciones;
create policy notif_leer on notificaciones for select to authenticated
  using ((oportunidad_id is not null
          and exists (select 1 from oportunidades o where o.id = notificaciones.oportunidad_id))
         or (oportunidad_id is null and es(array['direccion']::rol_usuario[])));

drop policy if exists doc_leer on documentos;
create policy doc_leer on documentos for select to authenticated
  using (((oportunidad_id is not null
           and exists (select 1 from oportunidades o where o.id = documentos.oportunidad_id))
          or (oportunidad_id is null and es(array['direccion','administracion']::rol_usuario[])))
         and (tipo <> 'dni' or es(array['direccion','comercial','administracion']::rol_usuario[])));

-- Alta directa desde el navegador (tras subir el archivo), pero nadie nace
-- verificado ni archivado, y nadie firma por otro (creado_por = quien sube).
drop policy if exists doc_crear on documentos;
create policy doc_crear on documentos for insert to authenticated
  with check (es(array['direccion','comercial','administracion']::rol_usuario[])
              and creado_por = auth.uid()
              and archivado_el is null
              and verificado_el is null
              and (oportunidad_id is null
                   or exists (select 1 from oportunidades o where o.id = documentos.oportunidad_id)));
-- Sin UPDATE ni DELETE a propósito: se archiva con fn_archivar_documento (R8).
-- Sin INSERT/UPDATE en las otras cuatro: las escriben solo las funciones.

-- 3g · Disparadores: R8 en las cinco, bitácora donde hay `id`, R9 solo-agregar.
create or replace function fn_solo_agregar() returns trigger
language plpgsql set search_path = public as $fn$
begin
  raise exception '% es de solo agregar (R9): no se modifica ni se borra.', tg_table_name;
end $fn$;

drop trigger if exists t_no_delete_oportunidad_perfil on oportunidad_perfil;
create trigger t_no_delete_oportunidad_perfil before delete on oportunidad_perfil
  for each row execute function fn_prohibir_delete();

drop trigger if exists t_oportunidad_eventos_solo_agregar on oportunidad_eventos;
create trigger t_oportunidad_eventos_solo_agregar before update or delete on oportunidad_eventos
  for each row execute function fn_solo_agregar();

drop trigger if exists t_no_delete_visitas on visitas;
create trigger t_no_delete_visitas before delete on visitas
  for each row execute function fn_prohibir_delete();
drop trigger if exists t_bit_visitas on visitas;
create trigger t_bit_visitas after insert or update on visitas
  for each row execute function fn_bitacora();
drop trigger if exists t_visitas_upd on visitas;
create trigger t_visitas_upd before update on visitas
  for each row execute function fn_actualizado_el();

drop trigger if exists t_no_delete_notificaciones on notificaciones;
create trigger t_no_delete_notificaciones before delete on notificaciones
  for each row execute function fn_prohibir_delete();

drop trigger if exists t_no_delete_documentos on documentos;
create trigger t_no_delete_documentos before delete on documentos
  for each row execute function fn_prohibir_delete();
drop trigger if exists t_bit_documentos on documentos;
create trigger t_bit_documentos after insert or update on documentos
  for each row execute function fn_bitacora();

-- R9 del documento: el alta entra en la línea de tiempo de la oportunidad.
-- DEFINER porque oportunidad_eventos no tiene política de INSERT.
create or replace function fn_evento_documento() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.oportunidad_id is not null then
    insert into oportunidad_eventos (oportunidad_id, tipo, de, a, motivo, actor_id)
    values (new.oportunidad_id, 'documento', null, 'subido: ' || new.tipo,
            left(new.nombre_archivo, 120), auth.uid());
  end if;
  return new;
end $fn$;

drop trigger if exists t_documentos_evento on documentos;
create trigger t_documentos_evento after insert on documentos
  for each row execute function fn_evento_documento();

-- 3h · Bucket privado `documentos` — mismo patrón que 09-separaciones-storage.sql.
-- 10 MB y cinco tipos: límites de infraestructura (una foto de celular o un PDF),
-- no cifras del negocio.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documentos',
  'documentos',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/heic','application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists documentos_leer on storage.objects;
drop policy if exists documentos_subir on storage.objects;

-- LEER: solo si existe la fila en public.documentos, no archivada, y el RLS de
-- ESA tabla deja verla a quien pregunta (el subselect corre con su RLS). Así
-- el DNI hereda la regla «ni lectura ni contabilidad» sin repetirla aquí.
create policy documentos_leer on storage.objects
  for select to authenticated
  using (bucket_id = 'documentos'
         and exists (select 1 from public.documentos d
                      where d.ruta = storage.objects.name
                        and d.archivado_el is null));

-- SUBIR: los tres roles que operan. Sin UPDATE ni DELETE (R8), igual que
-- `comprobantes`: un archivo que no correspondía se retira desde el panel.
create policy documentos_subir on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documentos'
              and public.es(array['direccion','comercial','administracion']::public.rol_usuario[]));


-- ---------------------------------------------------------------------
-- 4 · PARÁMETROS OPERATIVOS Y SUS LECTORES
-- ---------------------------------------------------------------------
-- Decisión del dueño (29/09/2026, SPEC §1): los umbrales de seguimiento se
-- siembran CON su valor propuesto, en 🔵 azul y con la fuente del documento
-- que lo propone. No son condiciones comerciales —nadie cotiza con ellos—: son
-- el ritmo de trabajo del vendedor. Los datos que verá el CLIENTE (ubicación,
-- horario, correo, WhatsApp de la empresa) nacen en 🔴 rojo y VACÍOS.
insert into parametros (id, descripcion, valor_texto, valor_entero, unidad, fuente, estado_semaforo, nota) values
('cadencia_seguimiento_dias',
 'Dias entre un intento sin respuesta y el siguiente (lista: intento 1, 2, 3...; el ultimo se repite)',
 '1,3,7', null, 'dias_calendario_lista',
 'PROPUESTA — D:\SCPCMO\07-crm\06-operacion\SOP-SEGUIMIENTO.md (reintento 24 h, 3 días, 7 días)',
 'azul', '🔵 PROPUESTA. La usan fn_registrar_contacto y fn_actualizar_visita para fechar la siguiente tarea. Si se vacia, la tarea vence en el acto y lo dice.'),
('frio_intentos_sin_respuesta',
 'Intentos seguidos sin respuesta tras los cuales el lead pasa solo a frios',
 null, 4, 'intentos',
 'PROPUESTA — D:\SCPCMO\07-crm\06-operacion\SOP-SEGUIMIENTO.md ("tres intentos y descanso" tras el primero) + D:\SCPCMO\02-marketing\guiones-cold-reach.md:201-212',
 'azul', '🔵 PROPUESTA. No enfria si hay una visita abierta. Si se vacia, nada pasa a frios automaticamente.'),
('reactivacion_frio_dias',
 'Dias desde que un lead pasa a frios hasta la tarea de reactivacion',
 null, 30, 'dias_calendario',
 'PROPUESTA — D:\SCPCMO\01-comercial\guia-recuperacion-base-prospectos.md:50-68 (Reactivar 30–180 días)',
 'azul', '🔵 PROPUESTA. Si se vacia, el lead queda en frios sin tarea de reactivacion y la pantalla lo avisa.'),
('congelado_por_defecto_dias',
 'Dias de espera por defecto cuando el cliente dice "mas adelante" y no da fecha',
 null, 60, 'dias_calendario',
 'PROPUESTA — Sales-Skills conversation-resurrection (60–90 días)',
 'azul', '🔵 PROPUESTA. El vendedor puede poner otra fecha en el momento.'),
('temperatura_umbral_caliente',
 'Puntaje minimo para que un lead se muestre como Caliente',
 null, 6, 'puntos',
 'PROPUESTA — modelo fn_temperatura (D:\SCPCMO\07-crm\02-codigo\crm-mml\sql\13-seguimiento-comercial.sql)',
 'azul', '🔵 PROPUESTA. El puntaje lo explica fn_temperatura; si este umbral o el de tibio se vacian, los leads salen como sin_clasificar.'),
('temperatura_umbral_tibio',
 'Puntaje minimo para que un lead se muestre como Tibio',
 null, 2, 'puntos',
 'PROPUESTA — modelo fn_temperatura (D:\SCPCMO\07-crm\02-codigo\crm-mml\sql\13-seguimiento-comercial.sql)',
 'azul', '🔵 PROPUESTA. Por debajo, Frio.'),
('temperatura_dias_respuesta_reciente',
 'Dias dentro de los cuales una respuesta del cliente cuenta como reciente',
 null, 7, 'dias_calendario',
 'PROPUESTA — Sales-Skills conversation-pause-intelligence',
 'azul', '🔵 PROPUESTA.'),
('visita_confirmar_horas_antes',
 'Horas antes de la visita en que vence la tarea de confirmarla con el cliente',
 null, 24, 'horas',
 'PROPUESTA — D:\SCPCMO\05-equipo\manual-whatsapp-rosa.md (recordar el día antes) + meeting-confirmation-reminder-logic',
 'azul', '🔵 PROPUESTA. Si se vacia, no se crea la tarea de confirmar y la pantalla lo avisa.'),
('visita_duracion_min',
 'Duracion del bloque de calendario de una visita (solo para el .ics)',
 null, 60, 'minutos',
 'PROPUESTA — solo para el bloque de calendario (.ics); no se muestra al cliente',
 'azul', '🔵 PROPUESTA. No es una promesa al cliente: solo cuanto ocupa el evento en su calendario.'),
('visita_mapa_url',
 'Enlace del mapa del punto de visita que se envia al cliente',
 null, null, 'url',
 'PENDIENTE — D:\SCPCMO\00-fuente-de-verdad\ficha-proyecto-mml.md:25 sigue en PENDIENTE',
 'rojo', '🟡 indicio: pin publicado en mercadomedialuna.com (index.html:335-341) entregado por Patriccio el 28/09/2026; cargar cuando la ficha lo confirme. Mientras siga en rojo, el aviso dice que la ubicacion se envia por WhatsApp.'),
('visita_punto_encuentro',
 'Punto de encuentro de la visita tal como se le dice al cliente',
 null, null, 'texto',
 'PENDIENTE — referencia vial 🟡 en D:\SCPCMO\00-fuente-de-verdad\ficha-proyecto-mml.md:23',
 'rojo', '🔴 Nunca nombrar el distrito en un texto al cliente (SPEC §2).'),
('visita_horario',
 'Horario en que se reciben visitas',
 null, null, 'texto',
 'PENDIENTE — D:\SCPCMO\08-web\PENDIENTES-WEB.md #10 (horario de visitas sin definir)',
 'rojo', '🔴 Sin definir.'),
('correo_contacto_publico',
 'Correo de la empresa que se muestra al cliente y recibe sus respuestas',
 null, null, 'email',
 'PENDIENTE — no existe correo corporativo (D:\SCPCMO\00-sistema\entrevista-walter-cierre-total.md:345)',
 'rojo', '🔴 Sin correo corporativo no se puede activar el envio automatico con remitente propio.'),
('whatsapp_empresa',
 'WhatsApp de la empresa que se muestra al cliente',
 null, null, 'telefono_e164',
 'PENDIENTE — el número publicado en la web no está en 00-fuente-de-verdad',
 'rojo', '🟡 el numero publicado en la web (08-web config.js) no esta en 00-fuente-de-verdad.')
on conflict (id) do nothing;

-- 4b · Lectores. DEFINER para que funcionen igual dentro de una vista con
-- security_invoker; la «comprobación de rol» es `mi_rol() is not null`: todo
-- usuario con perfil activo puede leer `parametros` (parametros_leer es
-- using(true)), así que esto no amplía nada — solo cierra la puerta a anon.
-- Operativos: devuelven valor en 🟢/🟡/🔵. Públicos (lo que ve el cliente):
-- SOLO en 🟢 (SPEC §2). Un 🔴 devuelve NULL siempre, aunque tenga valor.
create or replace function parametro_entero(p_id text) returns integer
language sql stable security definer set search_path = public as $fn$
  select p.valor_entero
    from parametros p
   where p.id = p_id
     and p.estado_semaforo in ('verde','amarillo','azul')
     and mi_rol() is not null
$fn$;

create or replace function parametro_texto(p_id text) returns text
language sql stable security definer set search_path = public as $fn$
  select nullif(btrim(p.valor_texto), '')
    from parametros p
   where p.id = p_id
     and p.estado_semaforo in ('verde','amarillo','azul')
     and mi_rol() is not null
$fn$;

create or replace function parametro_publico(p_id text) returns text
language sql stable security definer set search_path = public as $fn$
  select coalesce(nullif(btrim(p.valor_texto), ''), p.valor_entero::text)
    from parametros p
   where p.id = p_id
     and p.estado_semaforo = 'verde'
     and mi_rol() is not null
$fn$;

comment on function parametro_entero is
  'Valor entero de un parametro operativo si esta en verde, amarillo o azul. NULL si esta en rojo o vacio: quien lo usa tiene que decir [PENDIENTE], no inventar.';
comment on function parametro_publico is
  'Valor de un parametro que puede llegar al CLIENTE: solo si esta en verde (SPEC §2). Rojo/azul/amarillo = NULL.';

-- Primer día del mes en hora de Lima, desplazado N meses. La base corre en UTC:
-- sin esto, un lead registrado el 30/09 a las 20:00 de Lima caería en octubre.
create or replace function mes_lima(p_desplazamiento integer default 0) returns date
language sql stable set search_path = public as $fn$
  select (date_trunc('month', now() at time zone 'America/Lima')
          + make_interval(months => coalesce(p_desplazamiento, 0)))::date
$fn$;


-- ---------------------------------------------------------------------
-- 5 · FUNCIONES
-- ---------------------------------------------------------------------

-- 5a · Quién puede operar una oportunidad. Replica, para las funciones
-- DEFINER (que saltan RLS), la regla de `oport_editar` + la bandeja:
-- dirección y administración, todas; comercial, las suyas y las sin dueño.
create or replace function puede_operar_oportunidad(p_oportunidad_id uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select es(array['direccion','administracion']::rol_usuario[])
           or (es(array['comercial']::rol_usuario[])
               and (o.responsable_id = auth.uid() or o.responsable_id is null))
      from oportunidades o
     where o.id = p_oportunidad_id
       and o.archivado_el is null), false)
$fn$;

comment on function puede_operar_oportunidad is
  'Regla de acceso de las funciones DEFINER de 13: direccion/administracion cualquier oportunidad; comercial solo las suyas o las sin duenio. Falso si no existe o esta archivada.';

-- 5b · Etiquetas en español de los códigos. Una sola tabla de traducción para
-- motivos, historial y temperatura: dos textos distintos para el mismo código
-- confunden más que un código crudo.
create or replace function etiqueta_crm(p_grupo text, p_valor text) returns text
language sql immutable set search_path = public as $fn$
  select coalesce((
    select e.etiqueta from (values
      ('resultado','contesto','Contestó'),
      ('resultado','no_contesta','No contesta'),
      ('resultado','buzon','Buzón'),
      ('resultado','visto_sin_respuesta','Visto, sin respuesta'),
      ('resultado','numero_equivocado','Número equivocado'),
      ('resultado','respondio','Me escribió'),
      ('resultado','mas_adelante','Más adelante'),
      ('resultado','no_interesa','No le interesa'),
      ('resultado','pidio_no_contacto','No contactar más'),
      ('resultado','agendo_visita','Agendó visita'),
      ('resultado','aviso_visita','Aviso de visita'),
      ('resultado','nota','Nota'),
      ('motivo_frio','no_responde','No responde'),
      ('motivo_frio','mas_adelante','Más adelante'),
      ('motivo_frio','sin_capital_ahora','Sin capital por ahora'),
      ('motivo_frio','no_asistio','No asistió a la visita'),
      ('motivo_frio','otro','Otro'),
      ('motivo_perdida','no_interesa','No le interesa'),
      ('motivo_perdida','numero_invalido','Número inválido'),
      ('motivo_perdida','pidio_no_contacto','Pidió no ser contactado'),
      ('motivo_perdida','sin_capital','Sin capital'),
      ('motivo_perdida','compro_otro','Compró en otro lado'),
      ('motivo_perdida','no_encaja','No encaja'),
      ('motivo_perdida','duplicado','Duplicado'),
      ('motivo_perdida','spam','Spam / falso'),
      ('motivo_perdida','no_reconoce','No reconoce el registro'),
      ('motivo_perdida','otro','Otro'),
      ('tipo_visita','obra','Visita a la obra'),
      ('tipo_visita','videollamada','Videollamada'),
      ('tipo_visita','oficina','Visita a oficina'),
      ('resultado_visita','interesado','Interesado'),
      ('resultado_visita','lo_piensa','Lo va a pensar'),
      ('resultado_visita','no_interesa','No le interesa'),
      ('resultado_visita','separo','Separó')
    ) as e(grupo, valor, etiqueta)
    where e.grupo = p_grupo and e.valor = p_valor), p_valor)
$fn$;

-- 5c · Respuestas del chat web: SOLO las claves conocidas y valores-código.
-- `captacion_bruta.carga` lo manda cualquier navegador de internet
-- (analisis/web.md §2): nada de ahí se muestra ni se guarda sin pasar por aquí.
create or replace function respuestas_web_limpias(p_respuestas jsonb) returns jsonb
language sql immutable set search_path = public as $fn$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from jsonb_each(case when jsonb_typeof(p_respuestas) = 'object'
                         then p_respuestas else '{}'::jsonb end) e
   where e.key in ('uso','alquiler','antes','giro','zona','pago','decide','visita','miercoles')
     and jsonb_typeof(e.value) = 'string'
     and (e.value #>> '{}') ~ '^[a-z_]{1,40}$'
$fn$;

-- 5d · Auxiliares internas (INVOKER, sin EXECUTE para nadie salvo su dueño).
create or replace function fijar_motivo(p_texto text) returns void
language plpgsql set search_path = public as $fn$
begin
  -- is_local = true: se pierde al terminar la transacción y se deshace si la
  -- subtransacción aborta. Así un motivo nunca se «pega» a otra operación.
  perform set_config('crm.motivo', coalesce(left(p_texto, 500), ''), true);
end $fn$;

create or replace function texto_a_uuid(p_texto text, p_campo text) returns uuid
language plpgsql immutable set search_path = public as $fn$
declare v text := nullif(btrim(coalesce(p_texto, '')), '');
begin
  if v is null then return null; end if;
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'El campo % no trae un identificador válido: «%».', p_campo, left(v, 60);
  end if;
  return v::uuid;
end $fn$;

-- Días de la cadencia para el intento N (el último valor se repite).
-- NULL si el parámetro falta o está mal escrito: quien llama lo dice.
create or replace function dias_de_cadencia(p_intento integer) returns integer
language plpgsql stable set search_path = public as $fn$
declare
  v_txt text := parametro_texto('cadencia_seguimiento_dias');
  v_arr text[];
begin
  if v_txt is null then return null; end if;
  v_arr := string_to_array(regexp_replace(v_txt, '\s', '', 'g'), ',');
  if coalesce(array_length(v_arr, 1), 0) = 0
     or exists (select 1 from unnest(v_arr) x where x !~ '^\d{1,3}$') then
    return null;
  end if;
  return v_arr[least(greatest(coalesce(p_intento, 1), 1), array_length(v_arr, 1))]::integer;
end $fn$;

-- Contactos de una oportunidad: la ÚNICA definición, compartida por
-- fn_registrar_contacto y v_cartera (dos pantallas que cuentan «intentos» de
-- dos formas distintas terminan mintiendo una de las dos).
--   · total_contactos: interacciones que no son 'nota' ni 'aviso_visita'
--     (las antiguas, sin resultado, cuentan como contacto).
--   · ultimo_inbound_el: la última vez que la persona RESPONDIÓ (resultado
--     positivo, visita agendada, o una interacción antigua entrante).
--   · intentos_sin_respuesta: intentos sin respuesta DESPUÉS de esa última
--     respuesta (o desde el principio si nunca respondió).
create or replace function contactos_de_oportunidad(p_oportunidad_id uuid)
returns table (intentos_sin_respuesta integer, ultimo_inbound_el timestamptz, total_contactos integer)
language sql stable set search_path = public as $fn$
  with i as (
    select x.resultado, x.entrante, x.ocurrio_el
      from interacciones x
     where x.oportunidad_id = p_oportunidad_id
       and (x.resultado is null or x.resultado not in ('nota','aviso_visita'))
  ), u as (
    select max(i.ocurrio_el) as el
      from i
     where i.resultado in ('contesto','respondio','mas_adelante','no_interesa','pidio_no_contacto','agendo_visita')
        or (i.resultado is null and i.entrante)
  )
  select (select count(*) from i
           where i.resultado in ('no_contesta','buzon','visto_sin_respuesta')
             and (u.el is null or i.ocurrio_el > u.el))::integer,
         u.el,
         (select count(*) from i)::integer
    from u
$fn$;

create or replace function cerrar_tareas_abiertas(p_oportunidad_id uuid, p_tipos text[], p_motivo text)
returns integer
language plpgsql set search_path = public as $fn$
declare v_n integer;
begin
  -- p_tipos NULL = todas. Se CIERRAN con su motivo: nunca se borran (R8).
  update tareas t
     set completada_el = now(),
         cierre_motivo = left(p_motivo, 300)
   where t.oportunidad_id = p_oportunidad_id
     and t.completada_el is null
     and (p_tipos is null or t.tipo = any(p_tipos));
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

create or replace function crear_tarea_crm(
  p_oportunidad_id uuid, p_tipo text, p_titulo text, p_vence_el timestamptz,
  p_detalle text default null, p_prioridad integer default 2, p_visita_id uuid default null)
returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_persona uuid;
  v_resp    uuid;
  v_id      uuid;
begin
  select o.persona_id, o.responsable_id into v_persona, v_resp
    from oportunidades o where o.id = p_oportunidad_id;
  -- Sin dueño (lead web), la tarea es de quien actúa: alguien tiene que verla.
  insert into tareas (titulo, detalle, oportunidad_id, persona_id, responsable_id,
                      vence_el, prioridad, creado_por, tipo, visita_id)
  values (left(p_titulo, 120), p_detalle, p_oportunidad_id, v_persona,
          coalesce(v_resp, auth.uid()), p_vence_el, coalesce(p_prioridad, 2),
          auth.uid(), p_tipo, p_visita_id)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'titulo', left(p_titulo, 120), 'vence_el', p_vence_el);
end $fn$;

-- R6 como red de seguridad: si una oportunidad ACTIVA se queda sin tarea
-- abierta al final de cualquier función de este archivo, se le crea una.
-- 07-crm\CLAUDE.md §4: «Toda oportunidad en estado activo debe tener una tarea
-- abierta con fecha». Walter: «hay semanas en las que no hacemos seguimiento».
create or replace function asegurar_tarea_abierta(p_oportunidad_id uuid) returns jsonb
language plpgsql set search_path = public as $fn$
begin
  if exists (select 1 from oportunidades o
              where o.id = p_oportunidad_id and o.situacion = 'activa' and o.archivado_el is null)
     and not exists (select 1 from tareas t
                      where t.oportunidad_id = p_oportunidad_id and t.completada_el is null) then
    return crear_tarea_crm(p_oportunidad_id, 'seguimiento', 'Seguimiento', now(),
      'Creada para cumplir R6: toda oportunidad activa tiene una tarea abierta con fecha.', 2, null);
  end if;
  return null;
end $fn$;

create or replace function cancelar_visitas_abiertas(p_oportunidad_id uuid, p_motivo text) returns integer
language plpgsql set search_path = public as $fn$
declare
  v_id uuid;
  v_n  integer := 0;
begin
  for v_id in
    select v.id from visitas v
     where v.oportunidad_id = p_oportunidad_id
       and v.estado in ('agendada','confirmada')
       and v.archivado_el is null
     for update
  loop
    update visitas set estado = 'cancelada',
                       resultado_nota = coalesce(resultado_nota, left(p_motivo, 300))
     where id = v_id;
    update tareas set completada_el = now(), cierre_motivo = left(p_motivo, 300)
     where visita_id = v_id and completada_el is null;
    insert into oportunidad_eventos (oportunidad_id, tipo, de, a, motivo, actor_id)
    values (p_oportunidad_id, 'visita', null, 'cancelada', left(p_motivo, 300), auth.uid());
    v_n := v_n + 1;
  end loop;
  return v_n;
end $fn$;

-- Pasar a fríos (o renovar la reactivación de uno que ya lo está).
-- Devuelve {tarea, aviso}. La fecha de reactivación sale de parámetros:
-- «más adelante» espera congelado_por_defecto_dias; lo demás, reactivacion_frio_dias.
create or replace function aplicar_enfriar(
  p_oportunidad_id uuid, p_motivo_frio text, p_motivo_texto text, p_fecha timestamptz)
returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_param text := case when p_motivo_frio = 'mas_adelante'
                       then 'congelado_por_defecto_dias' else 'reactivacion_frio_dias' end;
  v_dias  integer;
  v_tarea jsonb;
  v_aviso text;
  v_etiq  text := etiqueta_crm('motivo_frio', p_motivo_frio);
begin
  perform fijar_motivo(p_motivo_texto);
  update oportunidades
     set situacion   = 'pausada',
         motivo_frio = p_motivo_frio,
         enfriado_el = case when situacion = 'pausada' then coalesce(enfriado_el, now()) else now() end
   where id = p_oportunidad_id
     and situacion in ('activa','pausada');

  perform cerrar_tareas_abiertas(p_oportunidad_id,
    array['primer_contacto','seguimiento','reactivacion'], 'Pasó a fríos: ' || v_etiq);

  if p_fecha is not null then
    v_tarea := crear_tarea_crm(p_oportunidad_id, 'reactivacion', 'Reactivar · ' || v_etiq, p_fecha,
      'Fecha elegida por el vendedor.', 3, null);
  else
    v_dias := parametro_entero(v_param);
    if v_dias is null then
      v_aviso := format('[PENDIENTE] %s sin cargar: quedó en fríos sin tarea de reactivación.', v_param);
    else
      v_tarea := crear_tarea_crm(p_oportunidad_id, 'reactivacion', 'Reactivar · ' || v_etiq,
        now() + make_interval(days => v_dias),
        format('Reactivación a %s día(s) (parametros.%s, 🔵 propuesta).', v_dias, v_param), 3, null);
    end if;
  end if;
  return jsonb_build_object('tarea', v_tarea, 'aviso', v_aviso);
end $fn$;

-- Descartar: perdida + código + texto; se cierran TODAS sus tareas y se
-- cancelan sus visitas abiertas (un descarte con una visita viva es un cliente
-- esperando en la obra a alguien que ya no va a ir).
create or replace function aplicar_descartar(p_oportunidad_id uuid, p_codigo text, p_nota text)
returns void
language plpgsql set search_path = public as $fn$
declare v_etiq text := etiqueta_crm('motivo_perdida', p_codigo);
begin
  perform fijar_motivo('Descartada: ' || v_etiq || coalesce(' · ' || p_nota, ''));
  update oportunidades
     set situacion             = 'perdida',
         motivo_perdida_codigo = p_codigo,
         motivo_perdida        = left(p_nota, 1000)
   where id = p_oportunidad_id;
  perform cerrar_tareas_abiertas(p_oportunidad_id, null, 'Descartada: ' || v_etiq);
  perform cancelar_visitas_abiertas(p_oportunidad_id, 'Oportunidad descartada: ' || v_etiq);
end $fn$;

-- «No contactar»: el titular ejerce su derecho (Ley 29733). Afecta a la
-- PERSONA, no a una oportunidad: todas sus oportunidades vivas —sean de quien
-- sean— pasan a perdida, se cierran sus tareas y se cancelan sus visitas.
-- consentimiento = false (07-crm\06-operacion\SOP-SEGUIMIENTO.md:61).
create or replace function aplicar_no_contactar(p_persona_id uuid, p_motivo text) returns integer
language plpgsql set search_path = public as $fn$
declare
  v_id uuid;
  v_n  integer := 0;
begin
  update personas
     set no_contactar_el     = coalesce(no_contactar_el, now()),
         no_contactar_motivo = coalesce(no_contactar_motivo, left(p_motivo, 300)),
         consentimiento      = false
   where id = p_persona_id;

  for v_id in
    select o.id from oportunidades o
     where o.persona_id = p_persona_id
       and o.situacion in ('activa','pausada')
       and o.archivado_el is null
     for update
  loop
    perform fijar_motivo('Pidió no ser contactado');
    update oportunidades
       set situacion             = 'perdida',
           motivo_perdida_codigo = 'pidio_no_contacto',
           motivo_perdida        = left(p_motivo, 1000)
     where id = v_id;
    perform cerrar_tareas_abiertas(v_id, null, 'No contactar');
    perform cancelar_visitas_abiertas(v_id, 'La persona pidió no ser contactada');
    insert into oportunidad_eventos (oportunidad_id, tipo, de, a, motivo, actor_id)
    values (v_id, 'contacto', null, 'no_contactar', left(p_motivo, 300), auth.uid());
    v_n := v_n + 1;
  end loop;

  -- Tareas sueltas de la persona (sin oportunidad), también.
  update tareas set completada_el = now(), cierre_motivo = 'No contactar'
   where persona_id = p_persona_id and oportunidad_id is null and completada_el is null;
  return v_n;
end $fn$;

-- 5e · R9 fuera del estado: situación, responsable, motivo de pérdida y
-- temperatura manual, una fila por campo cambiado. DEFINER porque
-- oportunidad_eventos no tiene política de INSERT (nadie la escribe a mano).
create or replace function fn_registrar_evento_oportunidad() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_motivo text := nullif(current_setting('crm.motivo', true), '');
  v_actor  uuid := auth.uid();
  v_de     text;
  v_a      text;
begin
  if new.situacion is distinct from old.situacion then
    insert into oportunidad_eventos (oportunidad_id, tipo, de, a, motivo, actor_id)
    values (new.id, 'situacion', old.situacion::text, new.situacion::text,
            coalesce(v_motivo,
                     case new.situacion
                       when 'pausada' then 'Motivo: ' || coalesce(new.motivo_frio, 'sin indicar')
                       when 'perdida' then 'Motivo: ' || coalesce(new.motivo_perdida_codigo, 'sin indicar')
                     end),
            v_actor);
  end if;

  if new.responsable_id is distinct from old.responsable_id then
    -- Nombres y no solo ids: la línea de tiempo la lee un vendedor, que no
    -- puede leer `perfiles` de otros (perfiles_leer_propio).
    select p.nombre into v_de from perfiles p where p.id = old.responsable_id;
    select p.nombre into v_a  from perfiles p where p.id = new.responsable_id;
    insert into oportunidad_eventos (oportunidad_id, tipo, de, a, motivo, actor_id)
    values (new.id, 'responsable',
            coalesce(v_de, old.responsable_id::text),
            coalesce(v_a,  new.responsable_id::text),
            v_motivo, v_actor);
  end if;

  if new.motivo_perdida is distinct from old.motivo_perdida
     or new.motivo_perdida_codigo is distinct from old.motivo_perdida_codigo then
    insert into oportunidad_eventos (oportunidad_id, tipo, de, a, motivo, actor_id)
    values (new.id, 'motivo_perdida',
            nullif(concat_ws(' · ', old.motivo_perdida_codigo, old.motivo_perdida), ''),
            nullif(concat_ws(' · ', new.motivo_perdida_codigo, new.motivo_perdida), ''),
            v_motivo, v_actor);
  end if;

  if new.temperatura_manual is distinct from old.temperatura_manual then
    insert into oportunidad_eventos (oportunidad_id, tipo, de, a, motivo, actor_id)
    values (new.id, 'temperatura', old.temperatura_manual, new.temperatura_manual,
            coalesce(v_motivo, new.temperatura_manual_motivo), v_actor);
  end if;
  return new;
end $fn$;

drop trigger if exists t_oportunidad_eventos on oportunidades;
create trigger t_oportunidad_eventos
  after update of situacion, responsable_id, motivo_perdida, motivo_perdida_codigo, temperatura_manual
  on oportunidades
  for each row execute function fn_registrar_evento_oportunidad();

-- 5f · El equipo. `perfiles_leer_propio` no deja a Rosa ni a Patriccio ver a
-- sus compañeros, y sin eso no hay selector de responsable (critique.md C13).
-- Solo id, nombre, rol y teléfono de trabajo de los perfiles activos que operan.
create or replace function fn_equipo()
returns table (id uuid, nombre text, rol rol_usuario, telefono text)
language plpgsql stable security definer set search_path = public as $fn$
#variable_conflict use_column
begin
  if not es(array['direccion','comercial','administracion']::rol_usuario[]) then
    raise exception 'Tu rol no puede ver la lista del equipo.';
  end if;
  return query
    select p.id, p.nombre, p.rol, p.telefono
      from perfiles p
     where p.activo
       and p.rol in ('direccion','comercial','administracion')
     order by p.nombre;
end $fn$;

-- 5g · Campañas: encontrar o crear por nombre. La inversión NO se pide ni se
-- inventa (queda NULL): el costo por lead solo existe cuando alguien lo carga.
create or replace function fn_campana_asegurar(
  p_nombre text, p_plataforma text, p_fecha date default null, p_lanzamiento text default null)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_nombre text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_plat   text := lower(btrim(coalesce(p_plataforma, '')));
  v_perm   constant text[] := array['tiktok','meta','instagram','facebook','youtube','web','presencial','otra'];
  v_id     uuid;
begin
  if not es(array['direccion','comercial','administracion']::rol_usuario[]) then
    raise exception 'Tu rol no puede crear campañas.';
  end if;
  if v_nombre = '' then
    raise exception 'La campaña necesita un nombre (p_nombre).';
  end if;
  if char_length(v_nombre) > 120 then
    raise exception 'El nombre de la campaña (p_nombre) es demasiado largo: máximo 120 caracteres.';
  end if;
  if not (v_plat = any(v_perm)) then
    raise exception 'Plataforma «%» no admitida (p_plataforma). Las válidas son: %.',
      v_plat, array_to_string(v_perm, ', ');
  end if;

  perform pg_advisory_xact_lock(hashtext('campana:' || lower(v_nombre)));
  select c.id into v_id from campanas c
   where lower(btrim(c.nombre)) = lower(v_nombre) and c.archivado_el is null
   order by c.creado_el limit 1;
  if v_id is null then
    insert into campanas (nombre, plataforma, fecha_inicio, lanzamiento)
    values (v_nombre, v_plat, p_fecha, nullif(btrim(coalesce(p_lanzamiento, '')), ''))
    returning id into v_id;
  end if;
  return v_id;
end $fn$;

-- 5h · Perfil: normalizar (valida TODO antes de escribir nada) y guardar.
create or replace function normalizar_perfil(p_perfil jsonb) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  v_sal   jsonb := '{}'::jsonb;
  v_k     text;
  v_v     jsonb;
  v_t     text;
  v_perm  text[];
  v_num   numeric;
  v_arr   text[];
  v_uuid  uuid;
  v_objeciones constant text[] := array['precio','confianza_legal','distancia','avance_obra',
                                        'financiamiento','ubicacion','otro'];
begin
  if p_perfil is null or p_perfil = 'null'::jsonb then
    return v_sal;
  end if;
  if jsonb_typeof(p_perfil) <> 'object' then
    raise exception 'El perfil debe venir como objeto JSON.';
  end if;

  for v_k, v_v in select e.key, e.value from jsonb_each(p_perfil) e loop
    v_perm := case v_k
      when 'tipo_interes'      then array['puesto','tienda','ambos']
      when 'rubro'             then array['abarrotes','frutas_verduras','carnes','comida_jugos','ropa_bazar','otro']
      when 'situacion_actual'  then array['alquila_puesto','ambulante_feria','local_propio','sin_negocio']
      when 'capital_categoria' then array['cubre_contado','cubre_inicial','menor_inicial','no_declara']
      when 'capital_moneda'    then array['PEN','USD']
      when 'horizonte_compra'  then array['este_mes','proximo_mes','2_3_meses','mas_adelante']
      when 'decide_con'        then array['pareja','familia','socio','otro']
      when 'zona_procedencia'  then array['cerca','lima','provincia','extranjero']
      when 'canal_preferido'   then array['whatsapp','llamada','email']
      when 'fuente_perfil'     then array['agente','web','mixto']
      when 'proposito'         then array['operar','alquilar_a_terceros','invertir','busca_alquilar']
      when 'forma_pago'        then array['contado','facilidades']
    end;

    if v_perm is not null then
      if v_v = 'null'::jsonb then
        v_sal := v_sal || jsonb_build_object(v_k, null);
      elsif jsonb_typeof(v_v) <> 'string' then
        raise exception 'El campo % del perfil debe ser texto.', v_k;
      else
        v_t := nullif(btrim(v_v #>> '{}'), '');
        if v_t is null then
          v_sal := v_sal || jsonb_build_object(v_k, null);
        elsif not (v_t = any(v_perm)) then
          raise exception 'Valor no válido para % : «%». Los válidos son: %.',
            v_k, left(v_t, 40), array_to_string(v_perm, ', ');
        else
          v_sal := v_sal || jsonb_build_object(v_k, v_t);
        end if;
      end if;

    elsif v_k in ('interes_detalle','horario_preferido') then
      if v_v = 'null'::jsonb then
        v_sal := v_sal || jsonb_build_object(v_k, null);
      elsif jsonb_typeof(v_v) <> 'string' then
        raise exception 'El campo % del perfil debe ser texto.', v_k;
      else
        v_t := nullif(regexp_replace(btrim(v_v #>> '{}'), '\s+', ' ', 'g'), '');
        if char_length(coalesce(v_t, '')) > (case v_k when 'interes_detalle' then 200 else 120 end) then
          raise exception 'El campo % del perfil es demasiado largo.', v_k;
        end if;
        v_sal := v_sal || jsonb_build_object(v_k, v_t);
      end if;

    elsif v_k = 'capital_monto' then
      -- Número o texto numérico («1500» o «1500.50»). Sin separador de miles:
      -- «1,500» en Perú puede ser mil quinientos o uno coma cinco, y adivinar un
      -- monto es exactamente lo que este CRM no hace.
      if v_v = 'null'::jsonb then
        v_sal := v_sal || jsonb_build_object(v_k, null);
      else
        if jsonb_typeof(v_v) = 'number' then
          v_num := (v_v #>> '{}')::numeric;
        elsif jsonb_typeof(v_v) = 'string' and btrim(v_v #>> '{}') = '' then
          v_num := null;
        elsif jsonb_typeof(v_v) = 'string' and btrim(v_v #>> '{}') ~ '^\d{1,12}(\.\d{1,2})?$' then
          v_num := btrim(v_v #>> '{}')::numeric;
        else
          raise exception 'El capital (capital_monto) tiene que ser un número sin separador de miles, p. ej. 1500 o 1500.50.';
        end if;
        if v_num is not null and (v_num < 0 or v_num >= 1e12) then
          raise exception 'El capital (capital_monto) está fuera de rango.';
        end if;
        v_sal := v_sal || jsonb_build_object(v_k, round(v_num, 2));
      end if;

    elsif v_k = 'objeciones' then
      if v_v = 'null'::jsonb then
        v_sal := v_sal || jsonb_build_object(v_k, '[]'::jsonb);
      elsif jsonb_typeof(v_v) <> 'array' then
        raise exception 'Las objeciones deben venir como lista.';
      else
        select array_agg(distinct btrim(x) order by btrim(x)) into v_arr
          from jsonb_array_elements_text(v_v) x
         where btrim(x) <> '';
        v_arr := coalesce(v_arr, '{}'::text[]);
        if exists (select 1 from unnest(v_arr) y where not (y = any(v_objeciones))) then
          raise exception 'Objeción no válida. Las válidas son: %.', array_to_string(v_objeciones, ', ');
        end if;
        v_sal := v_sal || jsonb_build_object(v_k, to_jsonb(v_arr));
      end if;

    elsif v_k = 'respuestas_web' then
      if v_v = 'null'::jsonb then
        v_sal := v_sal || jsonb_build_object(v_k, null);
      elsif jsonb_typeof(v_v) <> 'object' then
        raise exception 'Las respuestas web deben venir como objeto.';
      else
        v_sal := v_sal || jsonb_build_object(v_k, nullif(respuestas_web_limpias(v_v), '{}'::jsonb));
      end if;

    elsif v_k in ('decide_solo','compro_antes') then
      if v_v = 'null'::jsonb then
        v_sal := v_sal || jsonb_build_object(v_k, null);
      elsif jsonb_typeof(v_v) = 'boolean' then
        v_sal := v_sal || jsonb_build_object(v_k, v_v);
      elsif jsonb_typeof(v_v) = 'string' and lower(btrim(v_v #>> '{}')) in ('true','false') then
        v_sal := v_sal || jsonb_build_object(v_k, lower(btrim(v_v #>> '{}'))::boolean);
      else
        raise exception 'El campo % del perfil debe ser sí o no (true/false).', v_k;
      end if;

    elsif v_k = 'unidad_interes_id' then
      if v_v = 'null'::jsonb then
        v_sal := v_sal || jsonb_build_object(v_k, null);
      else
        v_uuid := texto_a_uuid(v_v #>> '{}', 'unidad_interes_id');
        if v_uuid is not null and not exists (select 1 from unidades u
                                               where u.id = v_uuid and u.archivado_el is null) then
          raise exception 'La unidad de interés (unidad_interes_id) no existe.';
        end if;
        v_sal := v_sal || jsonb_build_object(v_k, v_uuid);
      end if;

    else
      raise exception 'Campo de perfil desconocido: «%».', left(v_k, 40);
    end if;
  end loop;
  return v_sal;
end $fn$;

create or replace function guardar_perfil_interno(p_oportunidad_id uuid, p_perfil jsonb, p_modo text)
returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_modo   text := coalesce(nullif(btrim(p_modo), ''), 'reemplazar');
  v_n      jsonb;
  v_o      oportunidades%rowtype;
  v_p      oportunidad_perfil%rowtype;
  v_existe boolean;
  v_actual jsonb;
  v_final  jsonb;
  v_k      text;
  v_v      jsonb;
  v_vacio  constant jsonb[] := array['null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb];
  v_cambios        text[] := '{}';
  v_cambios_cal    text[] := '{}';
  v_cambia_perfil  boolean := false;
  v_fuente         text;
  v_fuente_antes   text;
  v_mes            date;
  v_claves_cal constant text[] := array['proposito','forma_pago','decide_solo','compro_antes','unidad_interes_id'];
begin
  if v_modo not in ('reemplazar','completar') then
    raise exception 'Modo no válido (p_modo): «%». Usa reemplazar o completar.', v_modo;
  end if;
  v_n := normalizar_perfil(p_perfil);

  select * into v_o from oportunidades where id = p_oportunidad_id for update;
  if not found then
    raise exception 'La oportunidad no existe.';
  end if;
  select * into v_p from oportunidad_perfil where oportunidad_id = p_oportunidad_id for update;
  v_existe := found;
  v_fuente_antes := coalesce(v_p.fuente_perfil, 'agente');

  -- Lo que hay hoy, con los nombres que usa la interfaz. Las 4 preguntas de
  -- cualificación siguen viviendo en `oportunidades` (R5 las exige ahí).
  v_actual := jsonb_build_object(
    'tipo_interes',      v_p.tipo_interes,
    'interes_detalle',   v_p.interes_detalle,
    'rubro',             v_p.rubro,
    'situacion_actual',  v_p.situacion_actual,
    'capital_categoria', v_p.capital_categoria,
    'capital_monto',     v_p.capital_monto,
    'capital_moneda',    v_p.capital_moneda,
    'horizonte_compra',  v_p.horizonte_compra,
    'decide_con',        v_p.decide_con,
    'zona_procedencia',  v_p.zona_procedencia,
    'objeciones',        to_jsonb(coalesce(v_p.objeciones, '{}'::text[])),
    'canal_preferido',   v_p.canal_preferido,
    'horario_preferido', v_p.horario_preferido,
    'respuestas_web',    v_p.respuestas_web,
    'proposito',         v_o.cal_operar_o_invertir,
    'forma_pago',        v_o.cal_forma_pago,
    'decide_solo',       v_o.cal_decide_solo,
    'compro_antes',      v_o.cal_compro_antes,
    'unidad_interes_id', v_o.unidad_interes_id);
  v_final := v_actual;

  for v_k, v_v in select e.key, e.value from jsonb_each(v_n) e where e.key <> 'fuente_perfil' loop
    -- 'completar' (web, lote): solo llena lo vacío. Lo que escribió el
    -- vendedor NUNCA lo pisa un dato que llegó solo.
    if v_modo = 'completar'
       and (not (coalesce(v_actual -> v_k, 'null'::jsonb) = any(v_vacio))
            or v_v = any(v_vacio)) then
      continue;
    end if;
    if (v_final -> v_k) is distinct from v_v then
      v_final   := jsonb_set(v_final, array[v_k], v_v);
      v_cambios := v_cambios || v_k;
      if v_k = any(v_claves_cal) then
        v_cambios_cal := v_cambios_cal || v_k;
      else
        v_cambia_perfil := true;
      end if;
    end if;
  end loop;

  -- De dónde salió el perfil: el que llega manda si es el primero o si se
  -- reemplaza; si se completa un perfil de otra fuente, pasa a 'mixto'.
  v_fuente := v_fuente_antes;
  if (v_n ->> 'fuente_perfil') is not null then
    if v_modo = 'reemplazar' or not v_existe then
      v_fuente := v_n ->> 'fuente_perfil';
    elsif v_fuente_antes <> (v_n ->> 'fuente_perfil') and cardinality(v_cambios) > 0 then
      v_fuente := 'mixto';
    end if;
  elsif v_existe and v_fuente_antes = 'web' and v_modo = 'reemplazar' and cardinality(v_cambios) > 0 then
    v_fuente := 'mixto';
  end if;
  if v_existe and v_fuente is distinct from v_fuente_antes then
    v_cambios := v_cambios || 'fuente_perfil';
    v_cambia_perfil := true;
  end if;

  -- mes_objetivo se recalcula SOLO cuando cambia el horizonte: «este mes»
  -- dicho en septiembre sigue siendo septiembre en octubre (y la temperatura
  -- lo marca como «fecha de compra pasada»).
  v_mes := v_p.mes_objetivo;
  if 'horizonte_compra' = any(v_cambios) then
    v_mes := case v_final ->> 'horizonte_compra'
               when 'este_mes'    then mes_lima(0)
               when 'proximo_mes' then mes_lima(1)
               when '2_3_meses'   then mes_lima(2)
               else null
             end;
  end if;

  if v_cambia_perfil then
    -- R7 · el aviso claro antes de que salte la restricción capital_con_moneda.
    if (v_final ->> 'capital_monto') is not null and (v_final ->> 'capital_moneda') is null then
      raise exception 'El capital necesita su moneda al lado (capital_moneda). Regla R7 · capital_con_moneda.';
    end if;

    insert into oportunidad_perfil as op (
      oportunidad_id, tipo_interes, interes_detalle, rubro, situacion_actual, capital_categoria,
      capital_monto, capital_moneda, horizonte_compra, mes_objetivo, decide_con, zona_procedencia,
      objeciones, canal_preferido, horario_preferido, respuestas_web, fuente_perfil,
      actualizado_el, actualizado_por)
    values (
      p_oportunidad_id,
      v_final ->> 'tipo_interes', v_final ->> 'interes_detalle', v_final ->> 'rubro',
      v_final ->> 'situacion_actual', v_final ->> 'capital_categoria',
      (v_final ->> 'capital_monto')::numeric, (v_final ->> 'capital_moneda')::moneda,
      v_final ->> 'horizonte_compra', v_mes, v_final ->> 'decide_con', v_final ->> 'zona_procedencia',
      coalesce((select array_agg(x order by x)
                  from jsonb_array_elements_text(case when jsonb_typeof(v_final -> 'objeciones') = 'array'
                                                      then v_final -> 'objeciones' else '[]'::jsonb end) x),
               '{}'::text[]),
      v_final ->> 'canal_preferido', v_final ->> 'horario_preferido',
      nullif(nullif(v_final -> 'respuestas_web', 'null'::jsonb), '{}'::jsonb),
      v_fuente, now(), auth.uid())
    on conflict (oportunidad_id) do update set
      tipo_interes      = excluded.tipo_interes,
      interes_detalle   = excluded.interes_detalle,
      rubro             = excluded.rubro,
      situacion_actual  = excluded.situacion_actual,
      capital_categoria = excluded.capital_categoria,
      capital_monto     = excluded.capital_monto,
      capital_moneda    = excluded.capital_moneda,
      horizonte_compra  = excluded.horizonte_compra,
      mes_objetivo      = excluded.mes_objetivo,
      decide_con        = excluded.decide_con,
      zona_procedencia  = excluded.zona_procedencia,
      objeciones        = excluded.objeciones,
      canal_preferido   = excluded.canal_preferido,
      horario_preferido = excluded.horario_preferido,
      respuestas_web    = excluded.respuestas_web,
      fuente_perfil     = excluded.fuente_perfil,
      actualizado_el    = excluded.actualizado_el,
      actualizado_por   = excluded.actualizado_por;
  end if;

  if cardinality(v_cambios_cal) > 0 then
    -- Si la oportunidad está en 06 o más y aquí se borra una de las 4
    -- respuestas, la restricción calificado_requiere_las_4_respuestas lo
    -- impide con su propio nombre (R5). No se esquiva: se deja fallar.
    perform fijar_motivo('Perfil: ' || array_to_string(v_cambios_cal, ', '));
    update oportunidades
       set cal_operar_o_invertir = v_final ->> 'proposito',
           cal_forma_pago        = v_final ->> 'forma_pago',
           cal_decide_solo       = (v_final ->> 'decide_solo')::boolean,
           cal_compro_antes      = (v_final ->> 'compro_antes')::boolean,
           unidad_interes_id     = (v_final ->> 'unidad_interes_id')::uuid
     where id = p_oportunidad_id;
  end if;

  if cardinality(v_cambios) > 0 then
    insert into oportunidad_eventos (oportunidad_id, tipo, de, a, motivo, actor_id)
    values (p_oportunidad_id, 'perfil', null, array_to_string(v_cambios, ', '),
            case v_modo when 'completar' then 'Completado' else 'Editado' end
              || case when v_fuente = 'web' then ' (datos de la web)' else '' end,
            auth.uid());
  end if;

  select * into v_o from oportunidades where id = p_oportunidad_id;
  return jsonb_build_object(
    'ok', true,
    'cualificacion_completa', (v_o.cal_operar_o_invertir is not null and v_o.cal_compro_antes is not null
                               and v_o.cal_forma_pago is not null and v_o.cal_decide_solo is not null),
    'faltan', to_jsonb(array_remove(array[
                case when v_o.cal_operar_o_invertir is null then 'proposito' end,
                case when v_o.cal_compro_antes      is null then 'compro_antes' end,
                case when v_o.cal_forma_pago        is null then 'forma_pago' end,
                case when v_o.cal_decide_solo       is null then 'decide_solo' end], null)),
    'mes_objetivo', (select pf.mes_objetivo from oportunidad_perfil pf where pf.oportunidad_id = p_oportunidad_id),
    'cambios', to_jsonb(v_cambios));
end $fn$;

create or replace function fn_guardar_perfil(p_oportunidad_id uuid, p_perfil jsonb, p_modo text default 'reemplazar')
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_r jsonb;
begin
  if not es(array['direccion','comercial','administracion']::rol_usuario[]) then
    raise exception 'Tu rol no puede editar perfiles.';
  end if;
  if not puede_operar_oportunidad(p_oportunidad_id) then
    raise exception 'No tienes acceso a esta oportunidad.';
  end if;
  v_r := guardar_perfil_interno(p_oportunidad_id, p_perfil, p_modo);
  perform fijar_motivo(null);
  return v_r;
end $fn$;

comment on function fn_guardar_perfil is
  'Guarda el perfil comercial. reemplazar: una clave presente fija el valor (null borra), las ausentes no se tocan. completar: solo llena lo vacio (los datos web nunca pisan al vendedor). Las 4 de cualificacion van a oportunidades.cal_* (R5). Devuelve cualificacion_completa, faltan, mes_objetivo y cambios.';

-- 5i · Registro de prospectos: uno a uno (y la base del lote).
-- DEFINER a propósito (fn_registro_rapido es INVOKER y por eso duplica: no ve
-- las oportunidades de otros). Aquí la búsqueda ve TODO, con cerrojo por
-- teléfono (o @usuario), y la regla de acceso la pone la propia función.
create or replace function fn_registrar_prospecto(p_datos jsonb, p_simular boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_actor    uuid := auth.uid();
  v_d        jsonb := coalesce(p_datos, '{}'::jsonb);
  v_nombre   text;
  v_tel      text;
  v_usuario  text;
  v_red      text;
  v_email    text;
  v_origen   text;
  v_campana  uuid;
  v_campana_nombre text;
  v_resp     uuid;
  v_fecha    timestamptz;
  v_canal    text;
  v_evid     text;
  v_lanz     text;
  v_nota     text;
  v_perfil   jsonb;
  v_fuente   text;
  v_p        personas%rowtype;
  v_persona  uuid;
  v_oport    uuid;
  v_oport_resp uuid;
  v_oport_sit  estado_oportunidad;
  v_persona_previa boolean := false;
  v_oport_previa   boolean := false;
  v_oport_nueva    boolean := false;
  v_otro     boolean := false;
  v_tarea    uuid;
  v_vence    timestamptz;
  v_sla      integer;
  v_detalle  text;
  v_titulo   text;
  v_tipo     text;
  v_avisos   text[] := '{}';
  v_resp_nombre text;
  v_accion   text;
begin
  if not es(array['direccion','comercial','administracion']::rol_usuario[]) then
    raise exception 'Tu rol no puede registrar prospectos.';
  end if;
  if jsonb_typeof(v_d) <> 'object' then
    raise exception 'Los datos del prospecto (p_datos) deben venir como objeto.';
  end if;

  -- ---- Validación: cada error nombra su campo ----
  v_nombre := regexp_replace(btrim(coalesce(v_d ->> 'nombre', '')), '\s+', ' ', 'g');
  if v_nombre = '' then
    raise exception 'Falta el nombre (nombre).';
  end if;
  if char_length(v_nombre) > 150 then
    raise exception 'El nombre (nombre) es demasiado largo: máximo 150 caracteres.';
  end if;

  -- El teléfono llega normalizado por src/lib/telefono.ts. Aquí solo se
  -- comprueba la forma: un número «arreglado» a ciegas es peor que uno vacío.
  v_tel := nullif(btrim(coalesce(v_d ->> 'telefono', '')), '');
  if v_tel is not null and v_tel !~ '^\+\d{8,15}$' then
    raise exception 'El teléfono (telefono) debe venir en formato E.164, p. ej. +51999888777. Recibido: %', left(v_tel, 30);
  end if;

  v_usuario := nullif(lower(regexp_replace(btrim(coalesce(v_d ->> 'usuario_red', '')), '^@+', '')), '');
  if v_usuario is not null and v_usuario !~ '^[a-z0-9._]{2,40}$' then
    raise exception 'El usuario de la red (usuario_red) solo admite letras, números, punto y guion bajo (2 a 40). Recibido: %', left(v_usuario, 45);
  end if;
  v_red := nullif(lower(btrim(coalesce(v_d ->> 'red_social', ''))), '');
  if v_usuario is null then
    v_red := null;   -- una red sin usuario no identifica a nadie
  elsif v_red is null then
    raise exception 'Falta la red social (red_social) del usuario @%.', v_usuario;
  elsif v_red not in ('tiktok','instagram','facebook','youtube','otra') then
    raise exception 'Red social (red_social) no admitida: %. Las válidas son: tiktok, instagram, facebook, youtube, otra.', left(v_red, 20);
  end if;
  if v_tel is null and v_usuario is null then
    raise exception 'Falta el teléfono (telefono) o el usuario de la red (usuario_red).';
  end if;

  v_email := nullif(lower(btrim(coalesce(v_d ->> 'email', ''))), '');
  if v_email is not null and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 200) then
    raise exception 'El correo (email) no parece válido: %', left(v_email, 60);
  end if;

  v_origen := btrim(coalesce(v_d ->> 'origen', ''));
  if not (v_origen = any(origenes_admitidos())) then
    raise exception 'Origen (origen) «%» no admitido. Los válidos son: %.',
      left(v_origen, 30), array_to_string(origenes_admitidos(), ', ');
  end if;

  v_campana := texto_a_uuid(v_d ->> 'campana_id', 'campana_id');
  if v_campana is not null then
    select c.nombre into v_campana_nombre from campanas c
     where c.id = v_campana and c.archivado_el is null;
    if not found then
      raise exception 'La campaña (campana_id) no existe o está archivada.';
    end if;
  end if;

  v_resp := coalesce(texto_a_uuid(v_d ->> 'responsable_id', 'responsable_id'), v_actor);
  select p.nombre into v_resp_nombre from perfiles p
   where p.id = v_resp and p.activo and p.rol in ('direccion','comercial','administracion');
  if not found then
    raise exception 'El responsable (responsable_id) no es un usuario activo del equipo.';
  end if;

  begin
    v_fecha := coalesce(nullif(btrim(coalesce(v_d ->> 'fecha_ingreso', '')), '')::timestamptz, now());
  exception when others then
    raise exception 'La fecha de ingreso (fecha_ingreso) no es una fecha válida.';
  end;
  -- 10 minutos de holgura por relojes desfasados; no es una regla de negocio.
  if v_fecha > now() + interval '10 minutes' then
    raise exception 'La fecha de ingreso (fecha_ingreso) no puede estar en el futuro.';
  end if;

  -- Ley 29733 / DS 016-2024-JUS: sin consentimiento no se guarda el dato.
  if coalesce(v_d ->> 'consentimiento', '') <> 'true' then
    raise exception 'Sin consentimiento (consentimiento) no se registra el dato personal (Ley 29733).';
  end if;
  v_canal := btrim(coalesce(v_d ->> 'consentimiento_canal', ''));
  if v_canal !~ '^[a-z_]{3,40}$' then
    raise exception 'Falta el canal del consentimiento (consentimiento_canal), p. ej. tiktok_live.';
  end if;
  v_evid := nullif(btrim(coalesce(v_d ->> 'consentimiento_evidencia', '')), '');
  if char_length(coalesce(v_evid, '')) > 300 then
    raise exception 'La evidencia del consentimiento (consentimiento_evidencia) es demasiado larga: máximo 300 caracteres.';
  end if;
  v_lanz := nullif(btrim(coalesce(v_d ->> 'lanzamiento', '')), '');
  if char_length(coalesce(v_lanz, '')) > 40 then
    raise exception 'El lanzamiento (lanzamiento) es demasiado largo.';
  end if;
  v_nota := nullif(btrim(coalesce(v_d ->> 'nota', '')), '');
  if char_length(coalesce(v_nota, '')) > 1000 then
    raise exception 'La nota (nota) es demasiado larga: máximo 1000 caracteres.';
  end if;
  v_perfil := v_d -> 'perfil';
  if v_perfil = 'null'::jsonb then
    v_perfil := null;
  end if;
  if v_perfil is not null then
    perform normalizar_perfil(v_perfil);   -- valida también en simulación
  end if;

  -- ---- Cerrojo: dos registros del mismo número a la vez serían dos fichas ----
  -- Misma clave que fn_captar_prospecto (hashtext del teléfono): la web y el
  -- CRM se esperan entre sí.
  if not p_simular then
    perform pg_advisory_xact_lock(hashtext(coalesce(v_tel, v_red || ':' || v_usuario)));
  end if;

  -- ---- 1 · Persona: por teléfono y, si no, por @usuario ----
  if v_tel is not null then
    select * into v_p from personas
     where telefono_e164 = v_tel and archivado_el is null
     order by creado_el limit 1;
  end if;
  if v_p.id is null and v_usuario is not null then
    select * into v_p from personas
     where red_social = v_red and lower(usuario_red) = v_usuario and archivado_el is null
     order by creado_el limit 1;
    if v_p.id is not null and v_tel is not null and v_p.telefono_e164 is not null
       and v_p.telefono_e164 <> v_tel then
      v_avisos := v_avisos || format('El usuario @%s ya estaba registrado con otro teléfono; se conservó el anterior.', v_usuario);
    end if;
  end if;
  v_persona := v_p.id;

  if v_persona is not null then
    v_persona_previa := true;
    -- El titular pidió que no lo contacten: no se le abre otra oportunidad
    -- por haber vuelto a comentar en un live. Si renovó su consentimiento, se
    -- reactiva desde su ficha (fn_cambiar_situacion, consentimiento_renovado).
    if v_p.no_contactar_el is not null then
      raise exception 'Esta persona pidió no ser contactada (desde el %). No se registra de nuevo; si renovó su consentimiento, reactívala desde su ficha.',
        to_char(v_p.no_contactar_el at time zone 'America/Lima', 'DD/MM/YYYY');
    end if;

    if not p_simular then
      -- Se completa lo que falta; el nombre y el origen de una ficha que ya
      -- existía NO se pisan (lo registrado gana a lo tecleado con prisa).
      update personas p
         set usuario_red   = case when p.usuario_red is null and v_usuario is not null then v_usuario else p.usuario_red end,
             red_social    = case when p.usuario_red is null and v_usuario is not null then v_red else p.red_social end,
             telefono_e164 = coalesce(p.telefono_e164, v_tel),
             email         = coalesce(p.email, v_email::citext),
             campana_id    = coalesce(p.campana_id, v_campana),
             consentimiento         = true,
             consentimiento_fecha   = case when p.consentimiento then p.consentimiento_fecha else v_fecha end,
             consentimiento_canal   = case when p.consentimiento then p.consentimiento_canal else v_canal end,
             consentimiento_version = case when p.consentimiento then p.consentimiento_version
                                           else coalesce(p.consentimiento_version, '[PENDIENTE]') end,
             fuente_del_dato        = case when p.consentimiento then p.fuente_del_dato
                                           else concat_ws(' | ', p.fuente_del_dato,
                                                'Registro CRM · canal: ' || v_canal || coalesce(' · ' || v_evid, '')) end
       where p.id = v_persona
         and ((p.usuario_red is null and v_usuario is not null)
              or (p.telefono_e164 is null and v_tel is not null)
              or (p.email is null and v_email is not null)
              or (p.campana_id is null and v_campana is not null)
              or not p.consentimiento);
    end if;
  elsif not p_simular then
    v_fuente := 'Registro CRM · canal: ' || v_canal || coalesce(' · ' || v_evid, '');
    insert into personas (
      nombre_completo, telefono_e164, usuario_red, red_social, email, origen, campana_id,
      consentimiento, consentimiento_fecha, consentimiento_canal, consentimiento_version,
      fuente_del_dato, creado_por)
    values (
      v_nombre, v_tel, v_usuario, v_red, v_email::citext, v_origen, v_campana,
      -- La fecha del consentimiento es la del live (fecha_ingreso), no la de
      -- cuando se tecleó: es cuando la persona dejó su dato.
      true, v_fecha, v_canal,
      -- Aún no existe un aviso de privacidad versionado que citar: se marca,
      -- igual que fn_registro_rapido (06). 🟡 La pantalla lo dice.
      '[PENDIENTE]',
      left(v_fuente, 500), v_actor)
    returning id into v_persona;
  end if;

  -- ---- 2 · Oportunidad viva de esa persona, SEA DE QUIEN SEA ----
  if v_persona is not null then
    select o.id, o.responsable_id, o.situacion into v_oport, v_oport_resp, v_oport_sit
      from oportunidades o
     where o.persona_id = v_persona
       and o.situacion in ('activa','pausada')
       and o.archivado_el is null
     order by (o.situacion = 'activa') desc, o.fecha_ingreso desc
     limit 1;
  end if;

  if v_oport is not null then
    v_oport_previa := true;

    -- En fríos y vuelve a escribir en un live: es la mejor señal que hay.
    -- Se reactiva la MISMA oportunidad; abrir otra contaría dos veces a una persona.
    if v_oport_sit = 'pausada' then
      v_avisos := v_avisos || 'Estaba en fríos: se reactivó al volver a registrarse.'::text;
      if not p_simular then
        perform fijar_motivo('Volvió a registrarse · ' || v_canal);
        update oportunidades set situacion = 'activa', motivo_frio = null, enfriado_el = null
         where id = v_oport;
        perform cerrar_tareas_abiertas(v_oport, array['reactivacion'], 'Volvió a registrarse');
      end if;
    end if;

    if v_oport_resp is null then
      -- Lead sin dueño (entró solo por la web): lo toma quien lo registra.
      if not p_simular then
        perform fijar_motivo('Asignada al registrarse · ' || v_canal);
        update oportunidades set responsable_id = v_resp where id = v_oport;
        update tareas set responsable_id = v_resp
         where oportunidad_id = v_oport and completada_el is null;
      end if;
      v_oport_resp := v_resp;
    elsif v_oport_resp <> v_resp then
      -- Es de otro vendedor: no se le quita. Se le deja constancia en su ficha.
      v_otro := true;
      select p.nombre into v_resp_nombre from perfiles p where p.id = v_oport_resp;
      v_avisos := v_avisos || format('Esta persona ya la lleva %s: se le avisó en su ficha y no se cambió de dueño.',
                                     coalesce(v_resp_nombre, 'otra persona'));
      if not p_simular then
        insert into interacciones (oportunidad_id, persona_id, canal, entrante, resumen, ocurrio_el, actor_id, resultado)
        values (v_oport, v_persona, 'otro', false,
                left('Volvió a registrarse · ' || v_canal || coalesce(' · ' || v_campana_nombre, '')
                     || coalesce(' · Nota: ' || v_nota, ''), 1000),
                clock_timestamp(), v_actor, 'nota');
      end if;
    elsif v_nota is not null and not p_simular then
      insert into interacciones (oportunidad_id, persona_id, canal, entrante, resumen, ocurrio_el, actor_id, resultado)
      values (v_oport, v_persona, 'otro', false, left('Nota al registrar: ' || v_nota, 1000),
              clock_timestamp(), v_actor, 'nota');
    end if;

    if v_campana is not null and not p_simular then
      update oportunidades set campana_id = v_campana where id = v_oport and campana_id is null;
    end if;
  elsif not p_simular then
    perform fijar_motivo('Registro CRM · canal: ' || v_canal);
    insert into oportunidades (persona_id, estado, situacion, responsable_id, campana_id,
                               lanzamiento, fecha_ingreso, notas)
    values (v_persona, '01_prospecto_captado', 'activa', v_resp, v_campana,
            v_lanz, v_fecha, v_nota)
    returning id into v_oport;
    v_oport_nueva := true;
    v_oport_resp := v_resp;
  else
    v_oport_resp := v_resp;
  end if;

  -- ---- 3 · Perfil (modo completar: nunca pisa lo que ya había) ----
  if v_perfil is not null and not p_simular then
    if v_oport_nueva or puede_operar_oportunidad(v_oport) then
      perform guardar_perfil_interno(v_oport, v_perfil, 'completar');
    else
      v_avisos := v_avisos || 'El perfil no se guardó: la oportunidad es de otra persona.'::text;
    end if;
  end if;

  -- ---- 4 · Tarea abierta (R6) ----
  if not p_simular then
    select t.id, t.vence_el into v_tarea, v_vence
      from tareas t
     where t.oportunidad_id = v_oport and t.completada_el is null
     order by t.vence_el limit 1;

    if v_tarea is null then
      if exists (select 1 from interacciones i
                  where i.oportunidad_id = v_oport
                    and (i.resultado is null or i.resultado not in ('nota','aviso_visita'))) then
        v_titulo := 'Seguimiento · volvió a registrarse';
        v_tipo   := 'seguimiento';
      else
        v_titulo := 'Primer contacto';
        v_tipo   := 'primer_contacto';
      end if;
      v_sla := parametro_entero('sla_primera_respuesta_minutos');
      if v_sla is null then
        -- Parámetro sin cargar: vence YA y lo dice (misma regla que 06).
        v_vence   := now();
        v_detalle := 'Vence de inmediato porque el parametro sla_primera_respuesta_minutos '
                  || 'no tiene valor cargado. [PENDIENTE]';
        v_avisos  := v_avisos || '[PENDIENTE] sla_primera_respuesta_minutos sin cargar: la tarea vence ya.'::text;
      else
        v_vence   := now() + make_interval(mins => v_sla);
        v_detalle := 'Plazo tomado de parametros(sla_primera_respuesta_minutos) = ' || v_sla || ' min.';
      end if;
      insert into tareas (titulo, detalle, oportunidad_id, persona_id, responsable_id,
                          vence_el, prioridad, creado_por, tipo)
      values (v_titulo, v_detalle, v_oport, v_persona, coalesce(v_oport_resp, v_actor),
              v_vence, 1, v_actor, v_tipo)
      returning id into v_tarea;
    end if;
  end if;

  select p.nombre into v_resp_nombre from perfiles p where p.id = v_oport_resp;
  v_accion := case when v_oport_previa   then 'oportunidad_reutilizada'
                   when v_persona_previa then 'persona_reutilizada'
                   else 'creada' end;
  perform fijar_motivo(null);

  return jsonb_build_object(
    'ok', true,
    'simulado', p_simular,
    'accion', v_accion,
    'persona_id', v_persona,
    'oportunidad_id', v_oport,
    'tarea_id', v_tarea,
    'tarea_vence_el', v_vence,
    'persona_reutilizada', v_persona_previa,
    'oportunidad_reutilizada', v_oport_previa,
    'responsable_id', v_oport_resp,
    'responsable_otro', v_otro,
    'responsable_nombre', v_resp_nombre,
    'avisos', to_jsonb(v_avisos));
end $fn$;

comment on function fn_registrar_prospecto is
  'Alta de un prospecto (uno a uno o desde fn_registrar_lote). Deduplica por telefono y, si no hay, por red_social+usuario_red, con cerrojo. Reutiliza la oportunidad viva de la persona sea de quien sea (no duplica), la reactiva si estaba en frios, deja la tarea abierta (R6). p_simular: valida y busca sin escribir.';

-- 5j · Registro por lotes: la lista pegada del live.
-- Cada fila va en su propia subtransacción: una fila mala nunca tumba las demás.
create or replace function fn_registrar_lote(p_filas jsonb, p_comun jsonb, p_simular boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_comun     jsonb := coalesce(p_comun, '{}'::jsonb);
  v_repartir  uuid[] := '{}';
  v_turno     integer := 0;
  v_total     integer;
  v_i         integer;
  v_fila      jsonb;
  v_datos     jsonb;
  v_sim       jsonb;
  v_res       jsonb;
  v_motivo    text;
  v_vistos    jsonb := '{}'::jsonb;   -- clave → fila (1-based) de la primera aparición válida
  v_claves    text[];
  v_clave     text;
  v_filas     jsonb := '[]'::jsonb;
  v_validas   integer := 0;
  v_error     integer := 0;
  v_creadas   integer := 0;
  v_reutil    integer := 0;
  v_max_filas constant integer := 500;   -- límite de infraestructura (tamaño de una petición), no de negocio
begin
  if not es(array['direccion','comercial','administracion']::rol_usuario[]) then
    raise exception 'Tu rol no puede registrar prospectos.';
  end if;
  if jsonb_typeof(p_filas) is distinct from 'array' then
    raise exception 'La lista (p_filas) debe ser un arreglo de filas.';
  end if;
  if jsonb_typeof(v_comun) <> 'object' then
    raise exception 'Los datos comunes (p_comun) deben venir como objeto.';
  end if;
  v_total := jsonb_array_length(p_filas);
  if v_total > v_max_filas then
    raise exception 'La lista tiene % filas; el máximo por envío es %. Pártela en dos.', v_total, v_max_filas;
  end if;

  -- «Repartir entre»: turnos sobre las filas que abren oportunidad NUEVA (una
  -- persona que ya tiene dueño no se reparte: sigue con el suyo).
  if jsonb_typeof(v_comun -> 'repartir_entre') = 'array' then
    select coalesce(array_agg(texto_a_uuid(e.x, 'repartir_entre') order by e.ord), '{}'::uuid[])
      into v_repartir
      from jsonb_array_elements_text(v_comun -> 'repartir_entre') with ordinality as e(x, ord);
    if exists (select 1 from unnest(v_repartir) u
                where not exists (select 1 from perfiles p
                                   where p.id = u and p.activo
                                     and p.rol in ('direccion','comercial','administracion'))) then
      raise exception 'Alguien de «repartir entre» (repartir_entre) no es un usuario activo del equipo.';
    end if;
  end if;
  v_comun := v_comun - 'repartir_entre';

  for v_i in 0 .. v_total - 1 loop
    v_fila   := p_filas -> v_i;
    v_motivo := null;
    v_res    := null;
    v_claves := '{}';

    if jsonb_typeof(v_fila) is distinct from 'object' then
      v_motivo := 'La fila no tiene el formato esperado.';
    else
      v_datos := v_comun || (v_fila - 'repartir_entre');   -- lo de la fila manda sobre lo común
      v_claves := array_remove(array[
        case when nullif(btrim(coalesce(v_datos ->> 'telefono', '')), '') is not null
             then 'tel:' || btrim(v_datos ->> 'telefono') end,
        case when nullif(btrim(coalesce(v_datos ->> 'usuario_red', '')), '') is not null
             then 'red:' || lower(btrim(coalesce(v_datos ->> 'red_social', ''))) || ':'
                  || lower(regexp_replace(btrim(v_datos ->> 'usuario_red'), '^@+', '')) end], null);
      foreach v_clave in array v_claves loop
        if v_vistos ? v_clave then
          v_motivo := 'Repetido en esta lista (fila ' || (v_vistos ->> v_clave) || ')';
          exit;
        end if;
      end loop;
    end if;

    if v_motivo is null then
      begin
        if cardinality(v_repartir) > 0 then
          v_sim := fn_registrar_prospecto(v_datos, true);
          if v_sim ->> 'accion' <> 'oportunidad_reutilizada' then
            v_datos := v_datos || jsonb_build_object('responsable_id',
                         v_repartir[(v_turno % cardinality(v_repartir)) + 1]);
            v_turno := v_turno + 1;
          end if;
        end if;
        v_res := fn_registrar_prospecto(v_datos, p_simular);
      exception when others then
        v_motivo := sqlerrm;
      end;
    end if;

    if v_motivo is null then
      foreach v_clave in array v_claves loop
        v_vistos := v_vistos || jsonb_build_object(v_clave, v_i + 1);
      end loop;
      v_validas := v_validas + 1;
      if v_res ->> 'accion' = 'oportunidad_reutilizada' then
        v_reutil := v_reutil + 1;
      else
        v_creadas := v_creadas + 1;
      end if;
      v_filas := v_filas || jsonb_build_array(jsonb_build_object(
        'indice', v_i, 'ok', true, 'accion', v_res -> 'accion', 'motivo', null,
        'persona_id', v_res -> 'persona_id', 'oportunidad_id', v_res -> 'oportunidad_id',
        'responsable_id', v_res -> 'responsable_id', 'responsable_otro', v_res -> 'responsable_otro'));
    else
      v_error := v_error + 1;
      v_filas := v_filas || jsonb_build_array(jsonb_build_object(
        'indice', v_i, 'ok', false, 'accion', null, 'motivo', v_motivo,
        'persona_id', null, 'oportunidad_id', null, 'responsable_id', null, 'responsable_otro', false));
    end if;
  end loop;

  perform fijar_motivo(null);
  return jsonb_build_object(
    'ok', true, 'simulado', p_simular, 'total', v_total, 'validas', v_validas,
    'con_error', v_error, 'creadas', v_creadas, 'reutilizadas', v_reutil, 'filas', v_filas);
end $fn$;

comment on function fn_registrar_lote is
  'Registro de una lista (p. ej. los leads de un live). Cada fila se mezcla sobre p_comun y pasa por fn_registrar_prospecto en su propia subtransaccion. Repetidos dentro de la lista se marcan. repartir_entre reparte por turnos las oportunidades nuevas. p_simular=true por defecto: primero se valida, luego se guarda.';

-- 5k · Registrar un contacto y dejar el siguiente paso hecho.
create or replace function fn_registrar_contacto(
  p_oportunidad_id uuid,
  p_resultado      text,
  p_canal          canal_interaccion default 'whatsapp',
  p_nota           text default null,
  p_proximo_el     timestamptz default null,
  p_proximo_titulo text default null,
  p_plantilla      text default null)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_o          oportunidades%rowtype;
  v_res        text := lower(btrim(coalesce(p_resultado, '')));
  v_etiq       text;
  v_nota       text := nullif(btrim(coalesce(p_nota, '')), '');
  v_titulo     text := nullif(btrim(coalesce(p_proximo_titulo, '')), '');
  v_plantilla  text := nullif(btrim(coalesce(p_plantilla, '')), '');
  v_inter      uuid;
  v_n          integer := 0;
  v_umbral     integer;
  v_dias       integer;
  v_vence      timestamptz;
  v_detalle    text;
  v_tarea      jsonb;
  v_r          jsonb;
  v_avisos     text[] := '{}';
  v_frios      boolean := false;
  v_descartada boolean := false;
  v_reactivada boolean := false;
  v_sin_respuesta constant text[] := array['no_contesta','buzon','visto_sin_respuesta'];
  v_positivo      constant text[] := array['contesto','respondio','mas_adelante','no_interesa','pidio_no_contacto'];
begin
  if not es(array['direccion','comercial','administracion']::rol_usuario[]) then
    raise exception 'Tu rol no puede registrar contactos.';
  end if;
  if not puede_operar_oportunidad(p_oportunidad_id) then
    raise exception 'No tienes acceso a esta oportunidad.';
  end if;
  if not (v_res = any(array['contesto','no_contesta','buzon','visto_sin_respuesta','numero_equivocado',
                            'respondio','mas_adelante','no_interesa','pidio_no_contacto','nota'])) then
    raise exception 'Resultado (p_resultado) no reconocido: «%».', left(v_res, 30);
  end if;
  if p_canal is null then
    raise exception 'Falta el canal (p_canal).';
  end if;
  if p_proximo_el is not null and p_proximo_el < now() - interval '5 minutes' then
    raise exception 'La fecha del próximo paso (p_proximo_el) ya pasó.';
  end if;
  if char_length(coalesce(v_nota, '')) > 1000 then
    raise exception 'La nota (p_nota) es demasiado larga: máximo 1000 caracteres.';
  end if;
  if char_length(coalesce(v_titulo, '')) > 120 then
    raise exception 'El título del próximo paso (p_proximo_titulo) es demasiado largo.';
  end if;
  if v_plantilla is not null and v_plantilla !~ '^[a-z0-9_]{2,60}$' then
    raise exception 'Plantilla (p_plantilla) no válida.';
  end if;

  select * into v_o from oportunidades where id = p_oportunidad_id for update;
  if v_o.situacion not in ('activa','pausada') then
    raise exception 'Esta oportunidad está % : no se registran contactos. Reactívala primero.', v_o.situacion;
  end if;
  if v_res <> 'nota' and exists (select 1 from personas p
                                  where p.id = v_o.persona_id and p.no_contactar_el is not null) then
    raise exception 'Esta persona pidió no ser contactada.';
  end if;
  v_etiq := etiqueta_crm('resultado', v_res);

  -- 1 · La interacción. clock_timestamp() y no now(): dentro de UNA
  -- transacción (un lote, las pruebas) now() es el mismo instante para todo, y
  -- «intentos desde la última respuesta» necesita un orden real.
  insert into interacciones (oportunidad_id, persona_id, canal, entrante, resumen,
                             ocurrio_el, actor_id, resultado, plantilla)
  values (v_o.id, v_o.persona_id, p_canal, v_res = 'respondio', coalesce(v_nota, v_etiq),
          clock_timestamp(), auth.uid(), v_res, v_plantilla)
  returning id into v_inter;

  if v_res <> 'nota' then
    update oportunidades
       set fecha_primer_contacto = coalesce(fecha_primer_contacto, now()),
           fecha_ultimo_contacto = now()
     where id = v_o.id;
  end if;

  -- 2 · 02_contactado = «escribimos Y respondió» (analisis/negocio.md). Una
  -- respuesta, aunque sea «no me interesa», es contacto.
  if v_res = any(v_positivo) and v_o.estado = '01_prospecto_captado' then
    perform fijar_motivo('Respondió: ' || v_etiq);
    update oportunidades set estado = '02_contactado' where id = v_o.id;
  end if;

  -- 3 · El paso que tocaba ya se dio: se cierran las tareas de seguimiento.
  if v_res <> 'nota' then
    perform cerrar_tareas_abiertas(v_o.id, array['primer_contacto','seguimiento','reactivacion'],
                                   'Contacto: ' || v_etiq);
  end if;

  -- 4 · El siguiente paso, según lo que pasó.
  if v_res = any(v_sin_respuesta) then
    select c.intentos_sin_respuesta into v_n from contactos_de_oportunidad(v_o.id) c;
    v_umbral := parametro_entero('frio_intentos_sin_respuesta');
    if v_umbral is null then
      v_avisos := v_avisos || '[PENDIENTE] frio_intentos_sin_respuesta sin cargar: nada pasa a fríos solo.'::text;
    end if;

    if v_umbral is not null and v_n >= v_umbral
       and not exists (select 1 from visitas v
                        where v.oportunidad_id = v_o.id and v.estado in ('agendada','confirmada')
                          and v.archivado_el is null) then
      v_r := aplicar_enfriar(v_o.id, 'no_responde',
               format('Pasó a fríos: %s intentos sin respuesta', v_n), null);
      v_frios := v_o.situacion = 'activa';
      v_tarea := v_r -> 'tarea';
      if v_r ->> 'aviso' is not null then v_avisos := v_avisos || (v_r ->> 'aviso'); end if;
    else
      if v_umbral is not null and v_n >= v_umbral then
        v_avisos := v_avisos || 'No pasa a fríos porque tiene una visita abierta.'::text;
      end if;
      v_dias := dias_de_cadencia(v_n);
      if p_proximo_el is not null then
        v_vence := p_proximo_el;  v_detalle := 'Fecha elegida por el vendedor.';
      elsif v_dias is null then
        v_vence := now();
        v_detalle := 'Vence de inmediato: cadencia_seguimiento_dias sin cargar. [PENDIENTE]';
        v_avisos := v_avisos || '[PENDIENTE] cadencia_seguimiento_dias sin cargar: el reintento vence ya.'::text;
      else
        v_vence := now() + make_interval(days => v_dias);
        v_detalle := format('Cadencia: %s día(s) tras el intento %s (parametros.cadencia_seguimiento_dias, 🔵 propuesta).', v_dias, v_n);
      end if;
      v_tarea := crear_tarea_crm(v_o.id, 'seguimiento',
                   coalesce(v_titulo, format('Seguimiento · intento %s', v_n + 1)), v_vence, v_detalle, 2, null);
    end if;

  elsif v_res in ('contesto','respondio') then
    if v_o.situacion = 'pausada' then
      perform fijar_motivo('Reactivada: ' || v_etiq);
      update oportunidades set situacion = 'activa', motivo_frio = null, enfriado_el = null
       where id = v_o.id;
      v_reactivada := true;
    end if;
    v_dias := dias_de_cadencia(1);
    if p_proximo_el is not null then
      v_vence := p_proximo_el;  v_detalle := 'Fecha elegida por el vendedor.';
    elsif v_dias is null then
      v_vence := now();
      v_detalle := 'Vence de inmediato: cadencia_seguimiento_dias sin cargar. [PENDIENTE]';
      v_avisos := v_avisos || '[PENDIENTE] cadencia_seguimiento_dias sin cargar: el seguimiento vence ya.'::text;
    else
      v_vence := now() + make_interval(days => v_dias);
      v_detalle := format('Cadencia: %s día(s) (parametros.cadencia_seguimiento_dias, 🔵 propuesta).', v_dias);
    end if;
    v_tarea := crear_tarea_crm(v_o.id, 'seguimiento', coalesce(v_titulo, 'Seguimiento'), v_vence, v_detalle, 2, null);

  elsif v_res = 'mas_adelante' then
    v_r := aplicar_enfriar(v_o.id, 'mas_adelante',
             'Más adelante' || coalesce(': ' || v_nota, ''), p_proximo_el);
    v_frios := v_o.situacion = 'activa';
    v_tarea := v_r -> 'tarea';
    if v_r ->> 'aviso' is not null then v_avisos := v_avisos || (v_r ->> 'aviso'); end if;

  elsif v_res = 'no_interesa' then
    perform aplicar_descartar(v_o.id, 'no_interesa', v_nota);
    v_descartada := true;

  elsif v_res = 'pidio_no_contacto' then
    perform aplicar_no_contactar(v_o.persona_id, coalesce(v_nota, 'Pidió no ser contactado'));
    v_descartada := true;

  elsif v_res = 'numero_equivocado' then
    perform aplicar_descartar(v_o.id, 'numero_invalido', v_nota);
    v_descartada := true;
  end if;
  -- 'nota': nada más. Una nota no es un contacto.

  if v_tarea is null or v_tarea = 'null'::jsonb then
    v_tarea := asegurar_tarea_abierta(v_o.id);
  end if;

  select * into v_o from oportunidades where id = p_oportunidad_id;
  select c.intentos_sin_respuesta into v_n from contactos_de_oportunidad(v_o.id) c;
  perform fijar_motivo(null);

  return jsonb_build_object(
    'ok', true,
    'interaccion_id', v_inter,
    'estado', v_o.estado,
    'situacion', v_o.situacion,
    'intentos_sin_respuesta', v_n,
    'paso_a_frios', v_frios,
    'descartada', v_descartada,
    'reactivada', v_reactivada,
    'tarea', v_tarea,
    'avisos', to_jsonb(v_avisos));
end $fn$;

comment on function fn_registrar_contacto is
  'Registra un contacto (resultado + canal) y deja hecho el siguiente paso: reintento segun cadencia, paso a frios al llegar al umbral de intentos sin respuesta, 01->02 cuando responde, descarte, o no contactar. Todo umbral sale de parametros.';

-- 5l · Cambiar la situación a mano: enfriar, descartar, reactivar, no contactar.
create or replace function fn_cambiar_situacion(
  p_oportunidad_id uuid, p_accion text, p_motivo text default null,
  p_nota text default null, p_fecha timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_o      oportunidades%rowtype;
  v_p      personas%rowtype;
  v_accion text := lower(btrim(coalesce(p_accion, '')));
  v_motivo text := nullif(lower(btrim(coalesce(p_motivo, ''))), '');
  v_nota   text := nullif(btrim(coalesce(p_nota, '')), '');
  v_tarea  jsonb;
  v_r      jsonb;
  v_avisos text[] := '{}';
begin
  if not es(array['direccion','comercial','administracion']::rol_usuario[]) then
    raise exception 'Tu rol no puede cambiar la situación de una oportunidad.';
  end if;
  if not puede_operar_oportunidad(p_oportunidad_id) then
    raise exception 'No tienes acceso a esta oportunidad.';
  end if;
  if char_length(coalesce(v_nota, '')) > 1000 then
    raise exception 'La nota (p_nota) es demasiado larga: máximo 1000 caracteres.';
  end if;
  if p_fecha is not null and p_fecha < now() - interval '5 minutes' then
    raise exception 'La fecha (p_fecha) ya pasó.';
  end if;

  select * into v_o from oportunidades where id = p_oportunidad_id for update;

  if v_accion = 'enfriar' then
    v_motivo := coalesce(v_motivo, 'otro');
    if v_motivo not in ('no_responde','mas_adelante','sin_capital_ahora','no_asistio','otro') then
      raise exception 'Motivo de frío (p_motivo) no válido: %.', left(v_motivo, 30);
    end if;
    if v_o.situacion not in ('activa','pausada') then
      raise exception 'Solo se enfría una oportunidad activa (esta está %).', v_o.situacion;
    end if;
    v_r := aplicar_enfriar(v_o.id, v_motivo,
             'Enfriada: ' || etiqueta_crm('motivo_frio', v_motivo) || coalesce(' · ' || v_nota, ''), p_fecha);
    v_tarea := v_r -> 'tarea';
    if v_r ->> 'aviso' is not null then v_avisos := v_avisos || (v_r ->> 'aviso'); end if;

  elsif v_accion = 'descartar' then
    if v_motivo is null then
      raise exception 'Para descartar hay que elegir un motivo (p_motivo).';
    end if;
    if v_motivo not in ('no_interesa','numero_invalido','pidio_no_contacto','sin_capital','compro_otro',
                        'no_encaja','duplicado','spam','no_reconoce','otro') then
      raise exception 'Motivo de descarte (p_motivo) no válido: %.', left(v_motivo, 30);
    end if;
    if v_o.situacion not in ('activa','pausada') then
      raise exception 'Esta oportunidad ya está %.', v_o.situacion;
    end if;
    if v_motivo = 'pidio_no_contacto' then
      -- «Pidió no ser contactado» es un derecho de la PERSONA, no un motivo
      -- más: tiene los mismos efectos que la acción no_contactar.
      perform aplicar_no_contactar(v_o.persona_id, coalesce(v_nota, 'Pidió no ser contactado'));
    else
      perform aplicar_descartar(v_o.id, v_motivo, v_nota);
    end if;

  elsif v_accion = 'reactivar' then
    select * into v_p from personas where id = v_o.persona_id for update;
    if v_p.no_contactar_el is not null then
      if v_motivo is distinct from 'consentimiento_renovado' then
        raise exception 'Esta persona pidió no ser contactada. Solo se reactiva si renovó su consentimiento (motivo consentimiento_renovado).';
      end if;
      update personas
         set no_contactar_el      = null,
             no_contactar_motivo  = null,
             consentimiento       = true,
             consentimiento_fecha = now(),
             consentimiento_canal = 'consentimiento_renovado',
             fuente_del_dato      = left(concat_ws(' | ', fuente_del_dato,
                                      'Consentimiento renovado el '
                                      || to_char(now() at time zone 'America/Lima', 'DD/MM/YYYY')
                                      || coalesce(' · ' || v_nota, '')), 1000)
       where id = v_p.id;
      insert into oportunidad_eventos (oportunidad_id, tipo, de, a, motivo, actor_id)
      values (v_o.id, 'contacto', 'no_contactar', 'consentimiento_renovado', v_nota, auth.uid());
    end if;

    if v_o.situacion = 'activa' then
      v_avisos := v_avisos || 'Ya estaba activa.'::text;
    elsif v_o.situacion = 'ganada' then
      raise exception 'Una oportunidad ganada no se reactiva.';
    else
      if exists (select 1 from oportunidades o2
                  where o2.persona_id = v_o.persona_id and o2.id <> v_o.id
                    and o2.situacion = 'activa' and o2.archivado_el is null) then
        raise exception 'Esta persona ya tiene otra oportunidad activa: trabaja esa.';
      end if;
      perform fijar_motivo('Reactivada' || coalesce(': ' || v_nota, ''));
      update oportunidades
         set situacion = 'activa', motivo_frio = null, enfriado_el = null, motivo_perdida_codigo = null
       where id = v_o.id;
      perform cerrar_tareas_abiertas(v_o.id, array['reactivacion'], 'Reactivada');
      v_tarea := crear_tarea_crm(v_o.id, 'seguimiento', 'Seguimiento · reactivada', coalesce(p_fecha, now()),
                   'Reactivada a mano' || coalesce(': ' || v_nota, '.'), 2, null);
    end if;

  elsif v_accion = 'no_contactar' then
    perform aplicar_no_contactar(v_o.persona_id, coalesce(v_nota, 'Pidió no ser contactado'));

  else
    raise exception 'Acción (p_accion) no reconocida: «%». Las válidas son: enfriar, descartar, reactivar, no_contactar.',
      left(v_accion, 30);
  end if;

  if v_tarea is null or v_tarea = 'null'::jsonb then
    v_tarea := asegurar_tarea_abierta(v_o.id);
  end if;
  select * into v_o from oportunidades where id = p_oportunidad_id;
  perform fijar_motivo(null);
  return jsonb_build_object('ok', true, 'situacion', v_o.situacion, 'tarea', v_tarea,
                            'avisos', to_jsonb(v_avisos));
end $fn$;

-- 5m · Temperatura fijada a mano (null la devuelve al cálculo).
create or replace function fn_fijar_temperatura(p_oportunidad_id uuid, p_temperatura text, p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_t text := nullif(lower(btrim(coalesce(p_temperatura, ''))), '');
  v_m text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not es(array['direccion','comercial','administracion']::rol_usuario[]) then
    raise exception 'Tu rol no puede fijar la temperatura.';
  end if;
  if not puede_operar_oportunidad(p_oportunidad_id) then
    raise exception 'No tienes acceso a esta oportunidad.';
  end if;
  if v_t is not null and v_t not in ('caliente','tibio','frio') then
    raise exception 'Temperatura (p_temperatura) no válida: %. Usa caliente, tibio o frio.', left(v_t, 20);
  end if;
  if v_t is not null and v_m is null then
    raise exception 'Para fijar la temperatura a mano hay que decir por qué (p_motivo).';
  end if;
  if char_length(coalesce(v_m, '')) > 300 then
    raise exception 'El motivo (p_motivo) es demasiado largo: máximo 300 caracteres.';
  end if;

  perform fijar_motivo(coalesce(v_m, 'Vuelve a la temperatura calculada'));
  update oportunidades
     set temperatura_manual        = v_t,
         temperatura_manual_motivo = case when v_t is null then null else v_m end,
         temperatura_manual_el     = case when v_t is null then null else now() end,
         temperatura_manual_por    = case when v_t is null then null else auth.uid() end
   where id = p_oportunidad_id;
  perform fijar_motivo(null);
  return jsonb_build_object('ok', true);
end $fn$;

-- 5n · Bandeja web: tomar un lead sin dueño. El primero que llega se lo queda.
create or replace function fn_reclamar_oportunidad(p_oportunidad_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_o       oportunidades%rowtype;
  v_nombre  text;
  v_carga   jsonb;
  v_resp    jsonb;
  v_perfil  jsonb;
  v_r       jsonb;
  v_aplicado boolean := false;
begin
  if not es(array['direccion','comercial','administracion']::rol_usuario[]) then
    raise exception 'Tu rol no puede tomar leads de la bandeja.';
  end if;

  -- FOR UPDATE: si dos vendedores pulsan «Tomar» a la vez, el segundo espera
  -- al primero y después ve que ya tiene dueño. Gana uno, y solo uno.
  select * into v_o from oportunidades
   where id = p_oportunidad_id and archivado_el is null
   for update;
  if not found then
    raise exception 'La oportunidad no existe.';
  end if;
  if v_o.responsable_id is not null then
    select p.nombre into v_nombre from perfiles p where p.id = v_o.responsable_id;
    return jsonb_build_object('ok', false, 'motivo', 'Ya la tomó ' || coalesce(v_nombre, 'otra persona') || '.');
  end if;

  perform fijar_motivo('Tomada de la bandeja');
  update oportunidades set responsable_id = auth.uid() where id = v_o.id;
  update tareas set responsable_id = auth.uid()
   where oportunidad_id = v_o.id and completada_el is null;
  insert into oportunidad_eventos (oportunidad_id, tipo, de, a, motivo, actor_id)
  values (v_o.id, 'bandeja', null, 'tomada', null, auth.uid());

  -- Las respuestas del chat web, si las hay, completan el perfil (sin pisar
  -- nada). Solo claves y códigos de la lista blanca; el resto no existe.
  select c.carga into v_carga
    from captacion_bruta c
   where c.persona_id = v_o.persona_id and c.resultado in ('creada','reutilizada')
   order by c.recibido_el desc limit 1;
  if jsonb_typeof(v_carga -> 'respuestas') = 'object' then
    v_resp := respuestas_web_limpias(v_carga -> 'respuestas');
    if v_resp <> '{}'::jsonb then
      v_perfil := jsonb_strip_nulls(jsonb_build_object(
        'respuestas_web', v_resp,
        'situacion_actual', case v_resp ->> 'alquiler'
                              when 'si' then 'alquila_puesto' when 'calle' then 'ambulante_feria'
                              when 'propio' then 'local_propio' when 'sin_negocio' then 'sin_negocio' end,
        'rubro', case v_resp ->> 'giro'
                   when 'abarrotes' then 'abarrotes' when 'frutas' then 'frutas_verduras'
                   when 'carnes' then 'carnes' when 'comida' then 'comida_jugos' when 'otro' then 'otro' end,
        'zona_procedencia', case when v_resp ->> 'zona' in ('cerca','lima','provincia','extranjero')
                                 then v_resp ->> 'zona' end,
        'fuente_perfil', 'web'));
      begin
        v_r := guardar_perfil_interno(v_o.id, v_perfil, 'completar');
        v_aplicado := cardinality(array(select jsonb_array_elements_text(v_r -> 'cambios'))) > 0;
      exception when others then
        -- Un dato web raro no impide tomar el lead: se toma y el perfil queda como estaba.
        v_aplicado := false;
      end;
    end if;
  end if;

  perform asegurar_tarea_abierta(v_o.id);
  perform fijar_motivo(null);
  return jsonb_build_object('ok', true, 'responsable_id', auth.uid(), 'perfil_web_aplicado', v_aplicado);
end $fn$;

-- 5o · Asignar (o reasignar) oportunidades en bloque.
create or replace function fn_asignar_oportunidades(p_ids uuid[], p_responsable_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_jefe      boolean := es(array['direccion','administracion']::rol_usuario[]);
  v_id        uuid;
  v_o         oportunidades%rowtype;
  v_nombre    text;
  v_actor     text;
  v_asignadas integer := 0;
  v_omitidas  jsonb := '[]'::jsonb;
begin
  if not es(array['direccion','comercial','administracion']::rol_usuario[]) then
    raise exception 'Tu rol no puede asignar oportunidades.';
  end if;
  select p.nombre into v_nombre from perfiles p
   where p.id = p_responsable_id and p.activo and p.rol in ('direccion','comercial','administracion');
  if not found then
    raise exception 'El responsable (p_responsable_id) no es un usuario activo del equipo.';
  end if;
  if coalesce(cardinality(p_ids), 0) > 500 then
    raise exception 'Demasiadas oportunidades en un envío (máximo 500).';
  end if;
  select p.nombre into v_actor from perfiles p where p.id = auth.uid();

  for v_id in select distinct x from unnest(coalesce(p_ids, '{}'::uuid[])) x where x is not null loop
    select * into v_o from oportunidades where id = v_id for update;
    if not found or v_o.archivado_el is not null then
      v_omitidas := v_omitidas || jsonb_build_array(jsonb_build_object('id', v_id, 'motivo', 'No existe o está archivada.'));
      continue;
    end if;
    -- Un comercial reparte lo suyo o lo que no tiene dueño; lo de un compañero, no.
    if not v_jefe and v_o.responsable_id is not null and v_o.responsable_id <> auth.uid() then
      v_omitidas := v_omitidas || jsonb_build_array(jsonb_build_object('id', v_id,
                      'motivo', 'Es de otra persona: solo Dirección o Administración la reasignan.'));
      continue;
    end if;
    if v_o.responsable_id = p_responsable_id then
      v_omitidas := v_omitidas || jsonb_build_array(jsonb_build_object('id', v_id,
                      'motivo', 'Ya estaba asignada a ' || v_nombre || '.'));
      continue;
    end if;

    perform fijar_motivo('Asignada por ' || coalesce(v_actor, 'el sistema'));
    update oportunidades set responsable_id = p_responsable_id where id = v_id;
    update tareas set responsable_id = p_responsable_id
     where oportunidad_id = v_id and completada_el is null;
    perform asegurar_tarea_abierta(v_id);
    v_asignadas := v_asignadas + 1;
  end loop;

  perform fijar_motivo(null);
  return jsonb_build_object('ok', true, 'asignadas', v_asignadas, 'omitidas', v_omitidas);
end $fn$;

-- 5p · La bandeja: leads activos SIN dueño, con lo que dijeron en la web.
-- Devuelve texto de lista blanca, nunca `carga` cruda (la manda internet).
create or replace function fn_bandeja()
returns table (
  oportunidad_id uuid, persona_id uuid, nombre_completo text, telefono_e164 text, origen text,
  fecha_ingreso timestamptz, dias_esperando integer, fuente_sistema text, recibido_el timestamptz,
  respuestas jsonb, prioridad text, utm_source text, utm_campaign text, reingresos integer,
  tiene_tarea boolean)
language plpgsql stable security definer set search_path = public as $fn$
#variable_conflict use_column
begin
  if not es(array['direccion','comercial','administracion']::rol_usuario[]) then
    raise exception 'Tu rol no puede ver la bandeja.';
  end if;
  return query
    select o.id, p.id, p.nombre_completo, p.telefono_e164, p.origen, o.fecha_ingreso,
           extract(day from now() - o.fecha_ingreso)::integer,
           c.fuente_sistema, c.recibido_el,
           respuestas_web_limpias(c.carga -> 'respuestas'),
           -- 🔵 la prioridad la calcula el navegador del visitante: se muestra
           -- solo si es uno de los tres códigos conocidos.
           case when c.carga ->> 'prioridad' in ('alta','media','baja') then c.carga ->> 'prioridad' end,
           left(c.carga ->> 'utm_source', 60),
           left(c.carga ->> 'utm_campaign', 60),
           (select count(*)::integer from captacion_bruta cb
             where p.telefono_e164 is not null and cb.telefono_e164 = p.telefono_e164),
           exists (select 1 from tareas t where t.oportunidad_id = o.id and t.completada_el is null)
      from oportunidades o
      join personas p on p.id = o.persona_id
      left join lateral (
        select cb.fuente_sistema, cb.recibido_el, cb.carga
          from captacion_bruta cb
         where cb.persona_id = o.persona_id and cb.resultado in ('creada','reutilizada')
         order by cb.recibido_el desc
         limit 1) c on true
     where o.situacion = 'activa'
       and o.responsable_id is null
       and o.archivado_el is null
     order by o.fecha_ingreso asc;
end $fn$;

-- 5q · Visitas.
create or replace function fn_agendar_visita(
  p_oportunidad_id uuid, p_tipo text, p_inicio_el timestamptz,
  p_nota text default null, p_viene_codecisor boolean default null,
  p_reprograma_id uuid default null, p_canal canal_interaccion default 'whatsapp')
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_o       oportunidades%rowtype;
  v_prev    visitas%rowtype;
  v_otra    visitas%rowtype;
  v_id      uuid := gen_random_uuid();
  v_tipo    text := lower(btrim(coalesce(p_tipo, '')));
  v_nota    text := nullif(btrim(coalesce(p_nota, '')), '');
  v_uid     text;
  v_seq     integer := 0;
  v_dur     integer;
  v_horas   integer;
  v_resp    uuid;
  v_titulo  text;
  v_fecha   text;
  v_tv      jsonb;
  v_tc      jsonb;
  v_avisos  text[] := '{}';
begin
  if not es(array['direccion','comercial','administracion']::rol_usuario[]) then
    raise exception 'Tu rol no puede agendar visitas.';
  end if;
  if not puede_operar_oportunidad(p_oportunidad_id) then
    raise exception 'No tienes acceso a esta oportunidad.';
  end if;
  if v_tipo not in ('obra','videollamada','oficina') then
    raise exception 'Tipo de visita (p_tipo) no válido: %. Usa obra, videollamada u oficina.', left(v_tipo, 20);
  end if;
  if p_inicio_el is null or p_inicio_el <= now() then
    raise exception 'La visita tiene que ser en el futuro (p_inicio_el).';
  end if;
  if char_length(coalesce(v_nota, '')) > 1000 then
    raise exception 'La nota (p_nota) es demasiado larga: máximo 1000 caracteres.';
  end if;

  select * into v_o from oportunidades where id = p_oportunidad_id for update;
  if v_o.situacion not in ('activa','pausada') then
    raise exception 'No se agenda una visita en una oportunidad %.', v_o.situacion;
  end if;
  if exists (select 1 from personas p where p.id = v_o.persona_id and p.no_contactar_el is not null) then
    raise exception 'Esta persona pidió no ser contactada.';
  end if;

  if v_o.situacion = 'pausada' then
    perform fijar_motivo('Reactivada: agendó visita');
    update oportunidades set situacion = 'activa', motivo_frio = null, enfriado_el = null where id = v_o.id;
    perform cerrar_tareas_abiertas(v_o.id, array['reactivacion'], 'Agendó visita');
    v_avisos := v_avisos || 'Estaba en fríos: se reactivó.'::text;
  end if;

  if p_reprograma_id is not null then
    select * into v_prev from visitas
     where id = p_reprograma_id and oportunidad_id = v_o.id
       and estado in ('agendada','confirmada') and archivado_el is null
     for update;
    if not found then
      raise exception 'La visita a reprogramar no existe, es de otra oportunidad o ya no está abierta.';
    end if;
    update visitas set estado = 'reprogramada' where id = v_prev.id;
    update tareas set completada_el = now(), cierre_motivo = 'Visita reprogramada'
     where visita_id = v_prev.id and completada_el is null;
    -- Mismo UID, secuencia +1 (RFC 5545): el calendario del cliente MUEVE el
    -- evento en lugar de dejarle dos citas.
    v_uid := v_prev.ics_uid;
    v_seq := v_prev.ics_secuencia + 1;
  else
    select * into v_otra from visitas
     where oportunidad_id = v_o.id and estado in ('agendada','confirmada') and archivado_el is null
     limit 1;
    if found then
      raise exception 'Ya tiene una visita agendada para %. Reprográmala.',
        to_char(v_otra.inicio_el at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI');
    end if;
    v_uid := v_id::text;
  end if;

  v_dur := parametro_entero('visita_duracion_min');
  if v_dur is null then
    v_avisos := v_avisos || '[PENDIENTE] visita_duracion_min sin cargar: el .ics irá sin duración.'::text;
  end if;
  v_resp := coalesce(v_o.responsable_id, auth.uid());

  insert into visitas (id, oportunidad_id, persona_id, responsable_id, tipo, inicio_el, duracion_min,
                       estado, viene_codecisor, nota, reprogramada_de_id, ics_uid, ics_secuencia, creado_por)
  values (v_id, v_o.id, v_o.persona_id, v_resp, v_tipo, p_inicio_el, v_dur,
          'agendada', p_viene_codecisor, v_nota, v_prev.id, v_uid, v_seq, auth.uid());

  -- La visita ES el siguiente paso: los seguimientos pendientes se cierran.
  perform cerrar_tareas_abiertas(v_o.id, array['primer_contacto','seguimiento','reactivacion'], 'Agendó visita');

  v_titulo := case v_tipo when 'obra' then 'Visita a obra' when 'videollamada' then 'Videollamada'
                          else 'Visita a oficina' end;
  v_fecha  := to_char(p_inicio_el at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI');
  v_tv := crear_tarea_crm(v_o.id, 'visita', v_titulo, p_inicio_el,
            'Visita agendada para el ' || v_fecha || ' (hora de Lima).', 1, v_id);

  v_horas := parametro_entero('visita_confirmar_horas_antes');
  if v_horas is null then
    v_avisos := v_avisos || '[PENDIENTE] visita_confirmar_horas_antes sin cargar: no se programó la confirmación.'::text;
  elsif p_inicio_el - make_interval(hours => v_horas) > now() then
    v_tc := crear_tarea_crm(v_o.id, 'confirmar_visita', 'Confirmar visita',
              p_inicio_el - make_interval(hours => v_horas),
              format('Confirmar %s h antes (parametros.visita_confirmar_horas_antes, 🔵 propuesta).', v_horas), 1, v_id);
  else
    v_avisos := v_avisos || 'La visita es muy pronto para programar la confirmación: confírmala ahora.'::text;
  end if;

  insert into interacciones (oportunidad_id, persona_id, canal, entrante, resumen, ocurrio_el, actor_id, resultado)
  values (v_o.id, v_o.persona_id, coalesce(p_canal, 'whatsapp'), false,
          left(case when p_reprograma_id is null then 'Agendó ' else 'Reprogramó ' end
               || lower(v_titulo) || ' para el ' || v_fecha || coalesce(' · ' || v_nota, ''), 1000),
          clock_timestamp(), auth.uid(), 'agendo_visita');
  update oportunidades
     set fecha_primer_contacto = coalesce(fecha_primer_contacto, now()),
         fecha_ultimo_contacto = now()
   where id = v_o.id;
  if v_o.estado = '01_prospecto_captado' then
    perform fijar_motivo('Agendó visita');
    update oportunidades set estado = '02_contactado' where id = v_o.id;
  end if;

  insert into oportunidad_eventos (oportunidad_id, tipo, de, a, motivo, actor_id)
  values (v_o.id, 'visita', case when p_reprograma_id is null then null else 'reprogramada' end,
          'agendada', v_titulo || ' · ' || v_fecha, auth.uid());

  perform fijar_motivo(null);
  return jsonb_build_object(
    'ok', true, 'visita_id', v_id, 'inicio_el', p_inicio_el, 'ics_uid', v_uid, 'ics_secuencia', v_seq,
    'tarea_visita_id', v_tv -> 'id', 'tarea_confirmar_id', v_tc -> 'id', 'avisos', to_jsonb(v_avisos));
end $fn$;

create or replace function fn_actualizar_visita(
  p_visita_id uuid, p_accion text, p_resultado text default null,
  p_nota text default null, p_proximo_el timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_v       visitas%rowtype;
  v_o       oportunidades%rowtype;
  v_accion  text := lower(btrim(coalesce(p_accion, '')));
  v_res     text := nullif(lower(btrim(coalesce(p_resultado, ''))), '');
  v_nota    text := nullif(btrim(coalesce(p_nota, '')), '');
  v_fecha   text;
  v_estado  text;
  v_tarea   jsonb;
  v_dias    integer;
  v_vence   timestamptz;
  v_inter_res   text;
  v_inter_canal canal_interaccion;
  v_resumen text;
  v_total   integer;
  v_avisos  text[] := '{}';
begin
  if not es(array['direccion','comercial','administracion']::rol_usuario[]) then
    raise exception 'Tu rol no puede actualizar visitas.';
  end if;
  select * into v_v from visitas where id = p_visita_id and archivado_el is null for update;
  if not found then
    raise exception 'La visita no existe.';
  end if;
  if not puede_operar_oportunidad(v_v.oportunidad_id) then
    raise exception 'No tienes acceso a esta oportunidad.';
  end if;
  if char_length(coalesce(v_nota, '')) > 1000 then
    raise exception 'La nota (p_nota) es demasiado larga: máximo 1000 caracteres.';
  end if;
  if p_proximo_el is not null and p_proximo_el < now() - interval '5 minutes' then
    raise exception 'La fecha del próximo paso (p_proximo_el) ya pasó.';
  end if;
  select * into v_o from oportunidades where id = v_v.oportunidad_id for update;
  v_fecha := to_char(v_v.inicio_el at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI');

  if v_accion = 'confirmar' then
    if v_v.estado <> 'agendada' then
      raise exception 'Solo se confirma una visita agendada (esta está %).', v_v.estado;
    end if;
    update visitas set estado = 'confirmada', confirmada_el = now() where id = v_v.id;
    update tareas set completada_el = now(), cierre_motivo = 'Visita confirmada'
     where visita_id = v_v.id and tipo = 'confirmar_visita' and completada_el is null;
    v_estado := 'confirmada';
    v_inter_res := 'contesto';  v_inter_canal := 'otro';
    v_resumen := 'Confirmó la visita del ' || v_fecha || coalesce(' · ' || v_nota, '');

  elsif v_accion = 'realizada' then
    if v_v.estado not in ('agendada','confirmada') then
      raise exception 'Esta visita ya está %.', v_v.estado;
    end if;
    if v_res is null or v_res not in ('interesado','lo_piensa','no_interesa','separo') then
      raise exception 'Para marcarla realizada hay que decir cómo salió (p_resultado): interesado, lo_piensa, no_interesa o separo.';
    end if;
    update visitas set estado = 'realizada', realizada_el = now(), resultado = v_res, resultado_nota = v_nota
     where id = v_v.id;
    update tareas set completada_el = now(), cierre_motivo = 'Visita realizada'
     where visita_id = v_v.id and completada_el is null;
    v_estado := 'realizada';
    v_inter_res := 'contesto';
    v_inter_canal := (case when v_v.tipo = 'videollamada' then 'otro' else 'presencial' end)::canal_interaccion;
    v_resumen := 'Visita realizada: ' || etiqueta_crm('resultado_visita', v_res) || coalesce(' · ' || v_nota, '');
    if v_o.situacion = 'activa' then
      v_dias := dias_de_cadencia(1);
      if p_proximo_el is not null then
        v_vence := p_proximo_el;
      elsif v_dias is null then
        v_vence := now();
        v_avisos := v_avisos || '[PENDIENTE] cadencia_seguimiento_dias sin cargar: el seguimiento vence ya.'::text;
      else
        v_vence := now() + make_interval(days => v_dias);
      end if;
      v_tarea := crear_tarea_crm(v_o.id, 'seguimiento', 'Seguimiento post-visita', v_vence,
                   'Resultado de la visita: ' || etiqueta_crm('resultado_visita', v_res) || '.', 1, null);
    end if;

  elsif v_accion = 'no_asistio' then
    if v_v.estado not in ('agendada','confirmada') then
      raise exception 'Esta visita ya está %.', v_v.estado;
    end if;
    update visitas set estado = 'no_asistio', resultado_nota = v_nota where id = v_v.id;
    update tareas set completada_el = now(), cierre_motivo = 'No asistió'
     where visita_id = v_v.id and completada_el is null;
    v_estado := 'no_asistio';
    v_inter_res := 'nota';  v_inter_canal := 'otro';
    v_resumen := 'No asistió a la visita del ' || v_fecha || coalesce(' · ' || v_nota, '');
    if v_o.situacion = 'activa' then
      v_tarea := crear_tarea_crm(v_o.id, 'seguimiento', 'Reprogramar visita', coalesce(p_proximo_el, now()),
                   'No asistió a la visita del ' || v_fecha || '.', 1, null);
    end if;

  elsif v_accion = 'cancelar' then
    if v_v.estado not in ('agendada','confirmada') then
      raise exception 'Esta visita ya está %.', v_v.estado;
    end if;
    update visitas set estado = 'cancelada', resultado_nota = v_nota where id = v_v.id;
    update tareas set completada_el = now(), cierre_motivo = 'Visita cancelada'
     where visita_id = v_v.id and completada_el is null;
    v_estado := 'cancelada';
    v_inter_res := 'nota';  v_inter_canal := 'otro';
    v_resumen := 'Se canceló la visita del ' || v_fecha || coalesce(' · ' || v_nota, '');
    if v_o.situacion = 'activa' then
      v_tarea := crear_tarea_crm(v_o.id, 'seguimiento', 'Seguimiento · visita cancelada', coalesce(p_proximo_el, now()),
                   'Se canceló la visita del ' || v_fecha || '.', 2, null);
    end if;

  else
    raise exception 'Acción (p_accion) no reconocida: «%». Las válidas son: confirmar, realizada, no_asistio, cancelar.',
      left(v_accion, 30);
  end if;

  insert into interacciones (oportunidad_id, persona_id, canal, entrante, resumen, ocurrio_el, actor_id, resultado)
  values (v_o.id, v_o.persona_id, v_inter_canal, false, left(v_resumen, 1000), clock_timestamp(), auth.uid(), v_inter_res);
  if v_inter_res <> 'nota' then
    update oportunidades
       set fecha_primer_contacto = coalesce(fecha_primer_contacto, now()),
           fecha_ultimo_contacto = now()
     where id = v_o.id;
  end if;
  insert into oportunidad_eventos (oportunidad_id, tipo, de, a, motivo, actor_id)
  values (v_o.id, 'visita', v_v.estado, v_estado, left(coalesce(v_nota, v_resumen), 300), auth.uid());

  if v_tarea is null then
    v_tarea := asegurar_tarea_abierta(v_o.id);
  end if;
  select count(*)::integer into v_total from visitas
   where oportunidad_id = v_o.id and estado = 'no_asistio' and archivado_el is null;

  return jsonb_build_object('ok', true, 'estado', v_estado, 'tarea', v_tarea,
                            'no_asistio_total', v_total, 'avisos', to_jsonb(v_avisos));
end $fn$;

-- 5r · Datos para armar el aviso de una visita (correo, .ics, WhatsApp).
-- La Edge Function aviso-visita la llama con el JWT del USUARIO (nunca con
-- service_role): el mismo acceso que tiene esa persona en la pantalla.
create or replace function fn_datos_aviso_visita(p_visita_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_v      visitas%rowtype;
  v_p      personas%rowtype;
  v_ag_nombre text;
  v_ag_tel    text;
  v_motivo    text;
begin
  if not es(array['direccion','comercial','administracion']::rol_usuario[]) then
    raise exception 'Tu rol no puede preparar avisos.';
  end if;
  select * into v_v from visitas where id = p_visita_id and archivado_el is null;
  if not found then
    raise exception 'La visita no existe.';
  end if;
  if not puede_operar_oportunidad(v_v.oportunidad_id) then
    raise exception 'No tienes acceso a esta oportunidad.';
  end if;
  select * into v_p from personas where id = v_v.persona_id;
  select a.nombre, a.telefono into v_ag_nombre, v_ag_tel
    from perfiles a
   where a.id = coalesce(v_v.responsable_id,
                         (select o.responsable_id from oportunidades o where o.id = v_v.oportunidad_id));

  -- Por qué NO se puede mandar un correo, en el orden en que importa.
  -- 'cancelada' se admite: el aviso de cancelación lo elige quien llama.
  v_motivo := case
    when v_p.no_contactar_el is not null then 'La persona pidió no ser contactada.'
    when not v_p.consentimiento          then 'La persona no tiene consentimiento registrado.'
    when v_p.email is null               then 'La persona no tiene correo registrado.'
    when v_v.estado not in ('agendada','confirmada','cancelada')
                                         then 'La visita está ' || v_v.estado || '.'
  end;

  return jsonb_build_object(
    'ok', true,
    'visita', jsonb_build_object(
      'id', v_v.id, 'tipo', v_v.tipo, 'estado', v_v.estado, 'inicio_el', v_v.inicio_el,
      'duracion_min', v_v.duracion_min, 'ics_uid', v_v.ics_uid, 'ics_secuencia', v_v.ics_secuencia,
      'nota', v_v.nota),
    'persona', jsonb_build_object(
      'id', v_p.id, 'nombre', v_p.nombre_completo, 'email', v_p.email::text,
      'telefono_e164', v_p.telefono_e164, 'consentimiento', v_p.consentimiento,
      'no_contactar', v_p.no_contactar_el is not null),
    'agente', jsonb_build_object('nombre', v_ag_nombre, 'telefono', v_ag_tel),
    -- Lo que ve el CLIENTE: solo parámetros en 🟢 (SPEC §2). Si faltan, van
    -- en null y el aviso lo dice en vez de inventar.
    'empresa', jsonb_build_object(
      'razon_social',    parametro_publico('razon_social'),
      'ruc',             parametro_publico('ruc'),
      'correo_contacto', parametro_publico('correo_contacto_publico'),
      'whatsapp',        parametro_publico('whatsapp_empresa')),
    'lugar', jsonb_build_object(
      'punto_encuentro', parametro_publico('visita_punto_encuentro'),
      'mapa_url',        parametro_publico('visita_mapa_url'),
      'horario',         parametro_publico('visita_horario')),
    'aviso_privacidad_version', parametro_publico('aviso_privacidad_version'),
    'puede_enviar_email', v_motivo is null,
    'motivo_no_envio', v_motivo);
end $fn$;

create or replace function fn_registrar_aviso_visita(
  p_visita_id uuid, p_canal text, p_modo text, p_plantilla text,
  p_destinatario text default null, p_estado text default 'preparada',
  p_proveedor_id text default null, p_error text default null)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_v       visitas%rowtype;
  v_p       personas%rowtype;
  v_canal   text := lower(btrim(coalesce(p_canal, '')));
  v_modo    text := lower(btrim(coalesce(p_modo, '')));
  v_estado  text := lower(btrim(coalesce(p_estado, 'preparada')));
  v_plant   text := lower(btrim(coalesce(p_plantilla, '')));
  v_id      uuid;
begin
  if not es(array['direccion','comercial','administracion']::rol_usuario[]) then
    raise exception 'Tu rol no puede registrar avisos.';
  end if;
  select * into v_v from visitas where id = p_visita_id and archivado_el is null for update;
  if not found then
    raise exception 'La visita no existe.';
  end if;
  if not puede_operar_oportunidad(v_v.oportunidad_id) then
    raise exception 'No tienes acceso a esta oportunidad.';
  end if;
  if v_canal not in ('email','whatsapp','ics') then
    raise exception 'Canal (p_canal) no válido: %. Usa email, whatsapp o ics.', left(v_canal, 20);
  end if;
  if v_modo not in ('manual','automatico') then
    raise exception 'Modo (p_modo) no válido: %. Usa manual o automatico.', left(v_modo, 20);
  end if;
  if v_estado not in ('preparada','enviada','error') then
    raise exception 'Estado (p_estado) no válido: %.', left(v_estado, 20);
  end if;
  if v_plant !~ '^[a-z_]{3,40}$' then
    raise exception 'Plantilla (p_plantilla) no válida.';
  end if;
  select * into v_p from personas where id = v_v.persona_id;
  -- Un error de envío se anota siempre; un aviso a quien no quiere recibirlo, nunca.
  if v_estado in ('preparada','enviada') and (v_p.no_contactar_el is not null or not v_p.consentimiento) then
    raise exception 'No se envían avisos a esta persona: pidió no ser contactada o no tiene consentimiento.';
  end if;

  insert into notificaciones (visita_id, oportunidad_id, persona_id, canal, modo, plantilla,
                              destinatario, estado, proveedor_id, error, creado_por)
  values (v_v.id, v_v.oportunidad_id, v_v.persona_id, v_canal, v_modo, v_plant,
          left(nullif(btrim(coalesce(p_destinatario, '')), ''), 200), v_estado,
          left(nullif(btrim(coalesce(p_proveedor_id, '')), ''), 200),
          left(nullif(btrim(coalesce(p_error, '')), ''), 1000), auth.uid())
  returning id into v_id;

  if v_estado in ('preparada','enviada') then
    update visitas set aviso_enviado_el = now(), aviso_canal = v_canal where id = v_v.id;
    insert into interacciones (oportunidad_id, persona_id, canal, entrante, resumen,
                               ocurrio_el, actor_id, resultado, plantilla)
    values (v_v.oportunidad_id, v_v.persona_id,
            case when v_canal = 'whatsapp' then 'whatsapp' else 'email' end::canal_interaccion,
            false, format('Aviso de visita (%s) por %s · %s', v_plant, v_canal, v_modo),
            clock_timestamp(), auth.uid(), 'aviso_visita', v_plant);
  end if;
  return jsonb_build_object('ok', true, 'notificacion_id', v_id);
end $fn$;

-- 5s · Documentos: archivar (R8: el archivo y su fila se quedan).
create or replace function fn_archivar_documento(p_documento_id uuid, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_d      documentos%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not es(array['direccion','comercial','administracion']::rol_usuario[]) then
    raise exception 'Tu rol no puede archivar documentos.';
  end if;
  select * into v_d from documentos where id = p_documento_id for update;
  if not found then
    raise exception 'El documento no existe.';
  end if;
  if not (es(array['direccion','administracion']::rol_usuario[]) or v_d.creado_por = auth.uid()) then
    raise exception 'Solo Dirección, Administración o quien lo subió pueden archivar este documento.';
  end if;
  if v_d.archivado_el is not null then
    raise exception 'Este documento ya estaba archivado.';
  end if;
  if v_motivo is null then
    raise exception 'Para archivar hay que decir por qué (p_motivo).';
  end if;
  update documentos set archivado_el = now(), archivado_motivo = left(v_motivo, 300) where id = v_d.id;
  if v_d.oportunidad_id is not null then
    insert into oportunidad_eventos (oportunidad_id, tipo, de, a, motivo, actor_id)
    values (v_d.oportunidad_id, 'documento', v_d.tipo, 'archivado', left(v_motivo, 300), auth.uid());
  end if;
  return jsonb_build_object('ok', true);
end $fn$;

-- 5t · La temperatura. INVOKER y sin tocar tablas: recibe todo lo que
-- necesita y lo explica. 🔵 El modelo entero es una PROPUESTA (los pesos no
-- vienen de ningún documento del negocio; los umbrales, de parametros en azul).
-- Orden, el primero que aplica gana:
--   no contactar → descartado → cliente → en fríos → fijada a mano → separó →
--   visita agendada → nuevo (sin contactar) → puntaje.
create or replace function fn_temperatura(
  p_situacion estado_oportunidad, p_estado estado_embudo, p_no_contactar boolean, p_manual text,
  p_motivo_frio text, p_motivo_perdida text, p_horizonte text, p_mes_objetivo date, p_capital text,
  p_forma_pago text, p_tipo_interes text, p_decide_solo boolean, p_proposito text,
  p_visita_futura boolean, p_visita_realizada_buena boolean, p_no_shows integer, p_intentos integer,
  p_dias_desde_inbound integer, p_total_contactos integer,
  p_umbral_caliente integer, p_umbral_tibio integer, p_dias_reciente integer)
returns table (temperatura text, motivo text, puntaje integer)
language plpgsql stable set search_path = public as $fn$
declare
  v_p   integer := 2;
  v_pos text[] := '{}';   -- señales a favor, en orden de peso
  v_neg text[] := '{}';   -- señales en contra
begin
  puntaje := null;
  if coalesce(p_no_contactar, false) then
    temperatura := 'no_contactar'; motivo := 'Pidió no ser contactado'; return next; return;
  end if;
  if p_situacion = 'perdida' then
    temperatura := 'descartado';
    motivo := coalesce(etiqueta_crm('motivo_perdida', p_motivo_perdida), 'Descartado');
    return next; return;
  end if;
  if p_situacion = 'ganada' or p_estado >= '07_contrato' then
    temperatura := 'cliente'; motivo := 'Cliente'; return next; return;
  end if;
  if p_situacion = 'pausada' then
    temperatura := 'frio';
    motivo := 'En fríos: ' || coalesce(etiqueta_crm('motivo_frio', p_motivo_frio), 'sin motivo');
    return next; return;
  end if;
  if p_manual is not null then
    temperatura := p_manual; motivo := 'Fijada a mano'; return next; return;
  end if;
  if p_estado >= '05_separacion' then
    temperatura := 'caliente'; motivo := 'Separó'; return next; return;
  end if;
  if coalesce(p_visita_futura, false) then
    temperatura := 'caliente'; motivo := 'Visita agendada'; return next; return;
  end if;
  if coalesce(p_total_contactos, 0) = 0 then
    temperatura := 'nuevo'; motivo := 'Aún sin contactar'; return next; return;
  end if;

  -- Cuándo compraría. Una fecha que ya pasó resta: «este mes» dicho hace dos meses.
  if p_horizonte is not null then
    if p_mes_objetivo is not null and p_mes_objetivo < mes_lima(0) then
      v_p := v_p - 1; v_neg := v_neg || 'Fecha de compra pasada'::text;
    elsif p_horizonte = 'este_mes' then
      v_p := v_p + 2; v_pos := v_pos || 'Compra este mes'::text;
    elsif p_horizonte = 'proximo_mes' then
      v_p := v_p + 1; v_pos := v_pos || 'Compra el próximo mes'::text;
    elsif p_horizonte = 'mas_adelante' then
      v_p := v_p - 2; v_neg := v_neg || 'Compra más adelante'::text;
    end if;
  end if;

  -- Capital como categoría relativa al producto (nunca un rango de soles).
  if p_capital = 'cubre_contado' then
    v_p := v_p + 2; v_pos := v_pos || 'Cubre contado'::text;
  elsif p_capital = 'cubre_inicial' then
    v_p := v_p + 1; v_pos := v_pos || 'Cubre la inicial'::text;
  elsif p_capital = 'menor_inicial' then
    v_p := v_p - 1; v_neg := v_neg || 'Capital menor a la inicial'::text;
  elsif p_capital is null and p_forma_pago = 'contado' then
    v_p := v_p + 1; v_pos := v_pos || 'Pagaría al contado'::text;
  end if;

  if coalesce(p_visita_realizada_buena, false) then
    v_p := v_p + 2; v_pos := v_pos || 'Visitó con interés'::text;
  end if;

  if p_dias_desde_inbound is not null then
    v_p := v_p + 1;
    if p_dias_reciente is not null and p_dias_desde_inbound <= p_dias_reciente then
      v_p := v_p + 1;
    end if;
    v_pos := v_pos || case when p_dias_desde_inbound <= 0 then 'Respondió hoy'
                           when p_dias_desde_inbound = 1 then 'Respondió ayer'
                           else format('Respondió hace %s días', p_dias_desde_inbound) end;
  end if;

  if p_decide_solo is true then
    v_p := v_p + 1; v_pos := v_pos || 'Decide solo'::text;
  end if;
  if p_tipo_interes is not null then
    v_p := v_p + 1; v_pos := v_pos || 'Sabe qué busca'::text;
  end if;

  if coalesce(p_no_shows, 0) > 0 then
    v_p := v_p - p_no_shows;
    v_neg := v_neg || format('No asistió a %s visita(s)', p_no_shows);
  end if;
  if coalesce(p_intentos, 0) > 1 then
    v_p := v_p - (p_intentos - 1);
    v_neg := v_neg || format('%s intentos sin respuesta', p_intentos);
  end if;
  if p_proposito = 'busca_alquilar' then
    -- Hoy no se ofrece alquiler: quien busca alquilar no es comprador.
    v_p := v_p - 3; v_neg := v_neg || 'Busca alquilar, no comprar'::text;
  end if;

  puntaje := v_p;
  if p_umbral_caliente is null or p_umbral_tibio is null then
    temperatura := 'sin_clasificar'; motivo := '[PENDIENTE] umbrales sin cargar';
  elsif v_p >= p_umbral_caliente then
    temperatura := 'caliente';
    motivo := coalesce(nullif(array_to_string(v_pos[1:3], ' · '), ''), 'Varias señales');
  elsif v_p >= p_umbral_tibio then
    temperatura := 'tibio';
    motivo := coalesce(nullif(array_to_string(v_pos[1:3], ' · '), ''), 'Contactado, sin más señales');
  else
    temperatura := 'frio';
    motivo := coalesce(nullif(array_to_string(v_neg[1:3], ' · '), ''), 'Pocas señales');
  end if;
  return next;
end $fn$;

comment on function fn_temperatura is
  'Temperatura de una oportunidad y su porque. 🔵 PROPUESTA: los pesos son un modelo del CRM, los umbrales salen de parametros (temperatura_umbral_*, azul). Sin umbrales cargados devuelve sin_clasificar.';


-- ---------------------------------------------------------------------
-- 6 · v_cartera — una fila por oportunidad no archivada, con su temperatura
-- ---------------------------------------------------------------------
-- security_invoker = true (mismo motivo que 07 y 08): la vista evalúa RLS con
-- quien consulta. Un comercial ve las suyas y las sin dueño; el perfil sale en
-- NULL para lectura/contabilidad porque perfil_leer no los deja pasar.
-- Los umbrales se leen UNA vez (CTE), no una por fila.
-- ⚠ El orden de columnas es un contrato con src/lib/cartera.ts (SPEC §4.6):
--   `create or replace view` solo permite AÑADIR al final.
create or replace view v_cartera
with (security_invoker = true) as
with umbrales as (
  select parametro_entero('temperatura_umbral_caliente')         as caliente,
         parametro_entero('temperatura_umbral_tibio')            as tibio,
         parametro_entero('temperatura_dias_respuesta_reciente') as dias_reciente
)
select o.id,
       o.persona_id,
       p.nombre_completo,
       p.telefono_e164,
       p.usuario_red,
       p.red_social,
       p.email,
       p.origen,
       coalesce(o.campana_id, p.campana_id)             as campana_id,
       ca.nombre                                        as campana_nombre,
       o.lanzamiento,
       o.estado,
       o.situacion,
       o.responsable_id,
       r.nombre                                         as responsable_nombre,
       (o.responsable_id is null)                       as sin_dueno,
       (p.creado_por is null)                           as entro_solo,
       o.fecha_ingreso,
       o.fecha_primer_contacto,
       o.fecha_ultimo_contacto,
       -- Misma fórmula, carácter por carácter, que v_embudo_tarjetas y v_sin_siguiente_paso.
       extract(day from now() - coalesce(o.fecha_ultimo_contacto, o.fecha_ingreso))::int
                                                        as dias_sin_contacto,
       o.motivo_frio,
       o.enfriado_el,
       o.motivo_perdida_codigo,
       o.motivo_perdida,
       (p.no_contactar_el is not null)                  as no_contactar,
       (o.cal_operar_o_invertir is not null
        and o.cal_compro_antes  is not null
        and o.cal_forma_pago    is not null
        and o.cal_decide_solo   is not null)            as cualificacion_completa,
       ((o.cal_operar_o_invertir is null)::int + (o.cal_compro_antes is null)::int
        + (o.cal_forma_pago is null)::int + (o.cal_decide_solo is null)::int)
                                                        as faltan_cualificacion,
       (pt.id is not null)                              as tiene_tarea_abierta,
       pf.tipo_interes,
       pf.interes_detalle,
       o.cal_operar_o_invertir                          as proposito,
       o.cal_forma_pago                                 as forma_pago,
       pf.capital_categoria,
       pf.horizonte_compra,
       pf.mes_objetivo,
       c.intentos_sin_respuesta,
       c.ultimo_inbound_el,
       c.total_contactos,
       pt.id                                            as proxima_tarea_id,
       pt.titulo                                        as proxima_tarea_titulo,
       pt.tipo                                          as proxima_tarea_tipo,
       pt.vence_el                                      as proxima_tarea_vence_el,
       vi.id                                            as visita_id,
       vi.tipo                                          as visita_tipo,
       vi.estado                                        as visita_estado,
       vi.inicio_el                                     as visita_inicio_el,
       coalesce(vs.no_asistio_total, 0)                 as no_asistio_total,
       tp.temperatura,
       tp.motivo                                        as temperatura_motivo,
       (o.temperatura_manual is not null)               as temperatura_manual,
       tp.puntaje,
       o.creado_el
from oportunidades o
join personas p              on p.id = o.persona_id
cross join umbrales u
left join campanas ca        on ca.id = coalesce(o.campana_id, p.campana_id)
left join perfiles r         on r.id = o.responsable_id
left join oportunidad_perfil pf on pf.oportunidad_id = o.id
left join lateral (
  select t.id, t.titulo, t.tipo, t.vence_el
    from tareas t
   where t.oportunidad_id = o.id and t.completada_el is null
   order by t.vence_el, t.creado_el
   limit 1) pt on true
left join lateral (
  -- La visita abierta si la hay; si no, la última.
  select v.id, v.tipo, v.estado, v.inicio_el
    from visitas v
   where v.oportunidad_id = o.id and v.archivado_el is null
   order by (v.estado in ('agendada','confirmada')) desc, v.creado_el desc
   limit 1) vi on true
left join lateral (
  select count(*) filter (where v.estado = 'no_asistio')::int                               as no_asistio_total,
         bool_or(v.estado in ('agendada','confirmada') and v.inicio_el >= now())            as futura,
         bool_or(v.estado = 'realizada' and v.resultado in ('interesado','separo'))         as buena
    from visitas v
   where v.oportunidad_id = o.id and v.archivado_el is null) vs on true
cross join lateral contactos_de_oportunidad(o.id) c
cross join lateral fn_temperatura(
  p_situacion               => o.situacion,
  p_estado                  => o.estado,
  p_no_contactar            => (p.no_contactar_el is not null),
  p_manual                  => o.temperatura_manual,
  p_motivo_frio             => o.motivo_frio,
  p_motivo_perdida          => o.motivo_perdida_codigo,
  p_horizonte               => pf.horizonte_compra,
  p_mes_objetivo            => pf.mes_objetivo,
  p_capital                 => pf.capital_categoria,
  p_forma_pago              => o.cal_forma_pago,
  p_tipo_interes            => pf.tipo_interes,
  p_decide_solo             => o.cal_decide_solo,
  p_proposito               => o.cal_operar_o_invertir,
  p_visita_futura           => coalesce(vs.futura, false),
  p_visita_realizada_buena  => coalesce(vs.buena, false),
  p_no_shows                => coalesce(vs.no_asistio_total, 0),
  p_intentos                => c.intentos_sin_respuesta,
  p_dias_desde_inbound      => extract(day from now() - c.ultimo_inbound_el)::int,
  p_total_contactos         => c.total_contactos,
  p_umbral_caliente         => u.caliente,
  p_umbral_tibio            => u.tibio,
  p_dias_reciente           => u.dias_reciente) tp
where o.archivado_el is null;

comment on view v_cartera is
  'Una fila por oportunidad no archivada: contacto, campana, situacion, cualificacion, perfil, contactos, proxima tarea, visita y temperatura. security_invoker=true: cada rol ve lo que su RLS le deja (comercial: las suyas y las sin duenio). El orden de columnas es contrato con src/lib/cartera.ts.';

revoke all on v_cartera from anon;
grant select on v_cartera to authenticated;


-- ---------------------------------------------------------------------
-- 7 · RLS — un comercial ve los leads SIN dueño
-- ---------------------------------------------------------------------
-- fn_captar_prospecto crea las oportunidades web con responsable_id NULL, y
-- `oport_leer` solo le enseña a un comercial las suyas: la bandeja era
-- invisible justo para quien la tiene que trabajar (analisis/sql.md §5.1).
-- Solo LECTURA: para quedárselo usa fn_reclamar_oportunidad (el primero gana).
-- Nada más de 02-rls.sql cambia.
drop policy if exists oport_leer_sin_dueno on oportunidades;
create policy oport_leer_sin_dueno on oportunidades for select to authenticated
  using (responsable_id is null and es(array['comercial']::rol_usuario[]));


-- ---------------------------------------------------------------------
-- 8 · PERMISOS DE LAS FUNCIONES
-- ---------------------------------------------------------------------
-- PostgreSQL concede EXECUTE a PUBLIC por defecto, y PUBLIC incluye a anon.
-- 11-privilegios.sql además lo concede a authenticated en toda función nueva.
-- Por eso se dice, función por función, quién sí y quién no.

-- 8a · Las que llama la interfaz (DEFINER con comprobación de rol dentro).
revoke all on function fn_equipo()                                               from public, anon;
revoke all on function fn_campana_asegurar(text, text, date, text)               from public, anon;
revoke all on function fn_registrar_prospecto(jsonb, boolean)                    from public, anon;
revoke all on function fn_registrar_lote(jsonb, jsonb, boolean)                  from public, anon;
revoke all on function fn_guardar_perfil(uuid, jsonb, text)                      from public, anon;
revoke all on function fn_registrar_contacto(uuid, text, canal_interaccion, text, timestamptz, text, text) from public, anon;
revoke all on function fn_cambiar_situacion(uuid, text, text, text, timestamptz) from public, anon;
revoke all on function fn_fijar_temperatura(uuid, text, text)                    from public, anon;
revoke all on function fn_reclamar_oportunidad(uuid)                             from public, anon;
revoke all on function fn_asignar_oportunidades(uuid[], uuid)                    from public, anon;
revoke all on function fn_bandeja()                                              from public, anon;
revoke all on function fn_agendar_visita(uuid, text, timestamptz, text, boolean, uuid, canal_interaccion) from public, anon;
revoke all on function fn_actualizar_visita(uuid, text, text, text, timestamptz) from public, anon;
revoke all on function fn_datos_aviso_visita(uuid)                               from public, anon;
revoke all on function fn_registrar_aviso_visita(uuid, text, text, text, text, text, text, text) from public, anon;
revoke all on function fn_archivar_documento(uuid, text)                         from public, anon;
revoke all on function puede_operar_oportunidad(uuid)                            from public, anon;
revoke all on function parametro_entero(text)                                    from public, anon;
revoke all on function parametro_texto(text)                                     from public, anon;
revoke all on function parametro_publico(text)                                   from public, anon;

grant execute on function
  fn_equipo(),
  fn_campana_asegurar(text, text, date, text),
  fn_registrar_prospecto(jsonb, boolean),
  fn_registrar_lote(jsonb, jsonb, boolean),
  fn_guardar_perfil(uuid, jsonb, text),
  fn_registrar_contacto(uuid, text, canal_interaccion, text, timestamptz, text, text),
  fn_cambiar_situacion(uuid, text, text, text, timestamptz),
  fn_fijar_temperatura(uuid, text, text),
  fn_reclamar_oportunidad(uuid),
  fn_asignar_oportunidades(uuid[], uuid),
  fn_bandeja(),
  fn_agendar_visita(uuid, text, timestamptz, text, boolean, uuid, canal_interaccion),
  fn_actualizar_visita(uuid, text, text, text, timestamptz),
  fn_datos_aviso_visita(uuid),
  fn_registrar_aviso_visita(uuid, text, text, text, text, text, text, text),
  fn_archivar_documento(uuid, text),
  puede_operar_oportunidad(uuid),
  parametro_entero(text),
  parametro_texto(text),
  parametro_publico(text)
to authenticated;

-- 8b · Las que usa v_cartera (INVOKER, sin privilegios propios: la vista es
-- security_invoker, así que quien consulta tiene que poder ejecutarlas).
revoke all on function mes_lima(integer)                    from public, anon;
revoke all on function etiqueta_crm(text, text)             from public, anon;
revoke all on function respuestas_web_limpias(jsonb)        from public, anon;
revoke all on function contactos_de_oportunidad(uuid)       from public, anon;
revoke all on function fn_temperatura(estado_oportunidad, estado_embudo, boolean, text, text, text, text, date,
                                      text, text, text, boolean, text, boolean, boolean, integer, integer,
                                      integer, integer, integer, integer, integer) from public, anon;
grant execute on function
  mes_lima(integer),
  etiqueta_crm(text, text),
  respuestas_web_limpias(jsonb),
  contactos_de_oportunidad(uuid),
  fn_temperatura(estado_oportunidad, estado_embudo, boolean, text, text, text, text, date,
                 text, text, text, boolean, text, boolean, boolean, integer, integer,
                 integer, integer, integer, integer, integer)
to authenticated;

-- 8c · Auxiliares internas: solo su dueño (las llaman las DEFINER de arriba).
-- Son INVOKER: aunque alguien volviera a conceder EXECUTE, correrían con los
-- permisos y el RLS de quien las llame — no abren nada.
revoke all on function fijar_motivo(text)                                              from public, anon, authenticated;
revoke all on function texto_a_uuid(text, text)                                        from public, anon, authenticated;
revoke all on function dias_de_cadencia(integer)                                       from public, anon, authenticated;
revoke all on function cerrar_tareas_abiertas(uuid, text[], text)                      from public, anon, authenticated;
revoke all on function crear_tarea_crm(uuid, text, text, timestamptz, text, integer, uuid) from public, anon, authenticated;
revoke all on function asegurar_tarea_abierta(uuid)                                    from public, anon, authenticated;
revoke all on function cancelar_visitas_abiertas(uuid, text)                           from public, anon, authenticated;
revoke all on function aplicar_enfriar(uuid, text, text, timestamptz)                  from public, anon, authenticated;
revoke all on function aplicar_descartar(uuid, text, text)                             from public, anon, authenticated;
revoke all on function aplicar_no_contactar(uuid, text)                                from public, anon, authenticated;
revoke all on function normalizar_perfil(jsonb)                                        from public, anon, authenticated;
revoke all on function guardar_perfil_interno(uuid, jsonb, text)                       from public, anon, authenticated;

-- 8d · Funciones de disparador: nadie las llama a mano (PostgreSQL no lo
-- permite), pero se quitan de PUBLIC/anon igual, para que la comprobación de
-- «anon sin EXECUTE» no tenga excepciones que explicar.
revoke all on function fn_normalizar_usuario_red()        from public, anon;
revoke all on function fn_tareas_tipo()                   from public, anon;
revoke all on function fn_solo_agregar()                  from public, anon;
revoke all on function fn_evento_documento()              from public, anon;
revoke all on function fn_registrar_evento_oportunidad()  from public, anon;
-- fn_registrar_cambio_estado es de 01-schema, pero este archivo la reescribe
-- como DEFINER (§1e): se le quita PUBLIC igual que a las nuevas.
revoke all on function fn_registrar_cambio_estado()       from public, anon;
grant execute on function fn_normalizar_usuario_red(), fn_tareas_tipo(), fn_solo_agregar(),
                          fn_evento_documento(), fn_registrar_evento_oportunidad(),
                          fn_registrar_cambio_estado() to authenticated;


-- ---------------------------------------------------------------------
-- 9 · Registro
-- ---------------------------------------------------------------------
insert into migraciones_aplicadas (archivo, aplicado_el, nota) values
  ('13-seguimiento-comercial.sql', now(),
   'perfil, eventos R9, visitas, avisos, documentos, v_cartera, registro por lotes, bandeja web, frios y temperatura')
on conflict (archivo) do nothing;
