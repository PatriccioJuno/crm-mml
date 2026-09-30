-- =====================================================================
-- CRM Mercado Media Luna — INSTALACIÓN COMPLETA
-- Generado el 30/09/2026 (script: gen-00.mjs del arnés local; ver
-- pruebas\COMO-PROBAR.md §9.1). NO se edita a mano.
--
-- QUÉ ES ESTO
-- Los trece scripts de sql\ concatenados en su orden de ejecución, para poder
-- levantar una base desde cero con UN SOLO pegado en el SQL Editor de Supabase.
-- No contiene ni una línea que no esté en esos archivos: es una comodidad, no
-- una fuente de verdad. Si algo hay que cambiar, se cambia en el archivo
-- numerado que corresponda y este se vuelve a generar.
--
-- QUÉ NO INCLUYE
-- 05-pruebas-reglas.sql, pruebas\reglas.sql ni pruebas\reglas-13.sql. Son
-- baterías de pruebas y se corren APARTE y DESPUÉS, a propósito: algunas de
-- sus comprobaciones fallan adrede para demostrar que una regla se está
-- cumpliendo. Mezclarlas aquí haría abortar la instalación.
--
-- CÓMO SE USA
--   1 · SQL Editor de Supabase -> New query
--   2 · Pegar este archivo entero
--   3 · Run
--   4 · Comprobar:  select archivo, aplicado_el from migraciones_aplicadas
--                   order by archivo;        -- deben salir 13 filas
--   5 · Después, y por separado, correr pruebas\reglas.sql y pruebas\reglas-13.sql
--
-- 🟡 ESTADO: el archivo entero se ensayó en una base vacía LOCAL (PGlite) el
--    30/09/2026 y terminó sin errores con 13 filas en
--    migraciones_aplicadas. En un proyecto Supabase nuevo todavía no se ha corrido.
--
-- ORDEN (no se altera: cada uno depende del anterior)
--   01 esquema -> 02 RLS -> 03 vistas -> 04 parámetros -> 06 registro rápido
--   -> 07 vistas de Hoy -> 08 vistas de embudo e inventario
--   -> 09 storage -> 10 control de migraciones -> 11 privilegios
--   -> 12 captación web -> 13 seguimiento comercial -> 14 inventario gráfico
-- =====================================================================



-- #####################################################################
-- 01-schema.sql #######################################################
-- #####################################################################

-- =====================================================================
-- CRM Mercado Media Luna — 01 · ESQUEMA
-- Estado: 🟢 VIGENTE · 08/09/2026 · PostgreSQL 15+ (Supabase)
--
-- REGLA QUE GOBIERNA ESTE ARCHIVO:
--   Aquí NO hay precios, ni cantidades de unidades, ni plazos comerciales
--   escritos a mano. Todo eso vive en la tabla `parametros`, que cita
--   D:\SCPCMO\00-fuente-de-verdad\. Si añades un número duro aquí, rompes
--   la regla del repositorio.
--
-- Orden de ejecución: 01-schema → 02-rls → 03-vistas → 04-seed-parametros
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------------
-- 0 · TIPOS
-- ---------------------------------------------------------------------

-- Los 10 estados oficiales del embudo.
-- Fuente: D:\SCPCMO\01-comercial\embudo-y-metricas.md §1 (estructura aprobada por SCP).
-- NO renombrar ni reordenar sin cambiar ese archivo primero.
create type estado_embudo as enum (
  '01_prospecto_captado',
  '02_contactado',
  '03_registrado',
  '04_asistente',
  '05_separacion',
  '06_calificado',
  '07_contrato',
  '08_inicial_cobrada',
  '09_pago_total',
  '10_posventa'
);

create type estado_oportunidad as enum ('activa','ganada','perdida','pausada');

create type estado_unidad as enum (
  'disponible',          -- libre y verificable contra plano
  'reservada_temporal',  -- bloqueo blando mientras se cierra
  'separada',            -- hay separación verificada
  'contratada',
  'pagada',
  'entregada',
  'no_disponible'        -- retirada de venta, litigio, etc.
);

create type semaforo as enum ('verde','amarillo','rojo','azul','negro');
-- verde=confirmado · amarillo=por validar · rojo=sin resolver · azul=propuesta · negro=histórico

create type rol_usuario as enum (
  'direccion',       -- Walter Iván. Único que verifica separaciones (R2)
  'comercial',       -- Patriccio y futuros vendedores
  'administracion',  -- Rosa: inventario y cobranza
  'contabilidad',    -- Carmen Vizcarra (contacto directo NO autorizado aún)
  'lectura'
);

create type canal_interaccion as enum
  ('whatsapp','llamada','presencial','email','live','instagram','facebook','tiktok','otro');

create type estado_separacion as enum
  ('pendiente_verificacion','verificada','devuelta','aplicada_a_contrato','vencida');

create type estado_cuota as enum ('pendiente','pagada','parcial','vencida','condonada');

create type moneda as enum ('PEN','USD');
-- La moneda de control del negocio sigue [PENDIENTE] en
-- 00-fuente-de-verdad\moneda-de-comunicacion.md. Por eso TODO monto lleva su moneda al lado
-- y nunca se suman dos monedas sin pasar por `tipo_cambio`. (Regla R7)

-- ---------------------------------------------------------------------
-- 1 · USUARIOS Y PARÁMETROS
-- ---------------------------------------------------------------------

create table perfiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  nombre        text not null,
  rol           rol_usuario not null default 'lectura',
  activo        boolean not null default true,
  telefono      text,
  creado_el     timestamptz not null default now()
);
comment on table perfiles is 'Un perfil por usuario autenticado. El rol gobierna todo el acceso (RLS).';

-- La tabla que hace cumplir la regla de la fuente de verdad.
create table parametros (
  id               text primary key,           -- ej: 'precio_puesto_9m2'
  descripcion      text not null,
  valor_texto      text,
  valor_numerico   numeric(14,2),
  valor_moneda     moneda,
  valor_entero     integer,
  unidad           text,                       -- 'dias_calendario', 'm2', 'porcentaje'
  fuente           text not null,              -- ruta EXACTA en 00-fuente-de-verdad
  estado_semaforo  semaforo not null default 'rojo',
  vigente_desde    date,
  vigente_hasta    date,
  nota             text,
  actualizado_el   timestamptz not null default now(),
  actualizado_por  uuid references perfiles(id)
);
comment on table parametros is
  'Único lugar donde puede vivir un precio, un plazo o una condición comercial. Cada fila cita su fuente en D:\SCPCMO\00-fuente-de-verdad\ y lleva semáforo. El código lee de aquí; nunca escribe cifras literales.';

create table tipo_cambio (
  fecha       date primary key,
  pen_por_usd numeric(10,4) not null,
  fuente      text not null
);

-- ---------------------------------------------------------------------
-- 2 · INVENTARIO
-- ---------------------------------------------------------------------
-- 🔴 BLOQUEANTE VIGENTE: no existe base maestra de inventario y falta el plano.
-- Fuente: 00-fuente-de-verdad\inventario-maestro.md (4 cifras en conflicto: 478/473/474/120).
-- Esta tabla NACE VACÍA. No la sembramos con ninguna de esas cifras.
-- Estructura tomada literalmente de inventario-maestro.md §4.

create table unidades (
  id                 uuid primary key default gen_random_uuid(),
  codigo_unidad      text not null unique,
  tipo               text not null,            -- 'puesto' | 'tienda' | otro, según plano
  area_m2            numeric(8,2),
  etapa              text,
  bloque             text,
  ubicacion          text,                     -- esquina, pasaje, frente: afecta precio
  estado_comercial   estado_unidad not null default 'no_disponible',
  estado_dato        semaforo not null default 'rojo',
  fuente_plano       text,                     -- qué plano y de qué fecha respalda esta fila
  precio_parametro   text references parametros(id),
  titular_persona_id uuid,                     -- FK añadida más abajo
  tipo_socio         text,                     -- Fundador / Nuevo 2023 / ... / Nuevo 2026
  estado_legal       text,                     -- Minuta / Notaría / Registros Públicos / Titulado
  estado_fisico      text,
  documento_sustento text,
  observaciones      text,
  archivado_el       timestamptz,              -- R8: nada se borra
  creado_el          timestamptz not null default now(),
  actualizado_el     timestamptz not null default now()
);
comment on column unidades.estado_dato is
  'rojo = esta unidad NO está verificada contra un plano vigente y NO puede ofrecerse como libre. Acta 03-O02: Patricio puede ofrecer sin pasar por Walter SOLO si el sistema demuestra que el puesto está objetivamente libre.';

-- ---------------------------------------------------------------------
-- 3 · PERSONAS  (prospectos y socios en una sola tabla: un prospecto
--     que compra NO se duplica, cambia de estado)
-- ---------------------------------------------------------------------

create table personas (
  id                    uuid primary key default gen_random_uuid(),
  nombre_completo       text not null,
  doc_tipo              text,                  -- DNI | CE | RUC | Pasaporte
  doc_numero            text,
  telefono_e164         text,                  -- +51999888777. Un formato, siempre
  telefono_alterno      text,
  email                 citext,
  ciudad                text,
  pais                  text default 'Perú',
  segmento              text,                  -- A/B/C según publico-objetivo.md
  origen                text,                  -- 'meta_ads' | 'organico' | 'referido' | 'base_historica' | 'live'
  campana_id            uuid,                  -- FK añadida más abajo
  es_socio              boolean not null default false,
  -- Ley 29733 / DS 016-2024-JUS: consentimiento en el primer contacto y capacidad de
  -- informar la fuente de los datos si el titular lo solicita.
  consentimiento        boolean not null default false,
  consentimiento_fecha  timestamptz,
  consentimiento_canal  text,
  consentimiento_version text,                 -- versión del texto del aviso aceptado
  fuente_del_dato       text,                  -- de dónde salió este contacto, exactamente
  notas                 text,
  archivado_el          timestamptz,
  creado_el             timestamptz not null default now(),
  creado_por            uuid references perfiles(id),
  actualizado_el        timestamptz not null default now(),
  constraint personas_doc_unico unique (doc_tipo, doc_numero)
);
create index on personas (telefono_e164);
create index on personas (lower(nombre_completo));

alter table unidades
  add constraint unidades_titular_fk
  foreign key (titular_persona_id) references personas(id);

-- ---------------------------------------------------------------------
-- 4 · CAMPAÑAS  (para que el costo por lead y por contrato se calculen solos)
-- ---------------------------------------------------------------------

create table campanas (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  plataforma     text,                          -- meta | tiktok | organico | presencial
  objetivo       text,
  inversion      numeric(12,2),
  inversion_moneda moneda,
  fecha_inicio   date,
  fecha_fin      date,
  lanzamiento    text,                          -- 'L2', 'L3'...
  nota           text,
  archivado_el   timestamptz,
  creado_el      timestamptz not null default now()
);

alter table personas
  add constraint personas_campana_fk foreign key (campana_id) references campanas(id);

-- ---------------------------------------------------------------------
-- 5 · OPORTUNIDADES  (el embudo)
-- ---------------------------------------------------------------------

create table oportunidades (
  id                  uuid primary key default gen_random_uuid(),
  persona_id          uuid not null references personas(id),
  estado              estado_embudo not null default '01_prospecto_captado',
  situacion           estado_oportunidad not null default 'activa',
  responsable_id      uuid references perfiles(id),
  lanzamiento         text,
  unidad_interes_id   uuid references unidades(id),
  unidad_asignada_id  uuid references unidades(id),
  precio_parametro    text references parametros(id),   -- a qué precio quedó congelada
  precio_pactado      numeric(14,2),
  precio_moneda       moneda,

  -- Las 4 preguntas de cualificación. Sin las 4, no hay estado 06. (R5)
  cal_operar_o_invertir text,      -- '¿va a operar el puesto o a invertir?'
  cal_compro_antes      boolean,   -- '¿ya compró antes en el mercado?'
  cal_forma_pago        text,      -- 'contado' | 'facilidades'
  cal_decide_solo       boolean,   -- '¿decide solo o con alguien más?'

  fecha_ingreso       timestamptz not null default now(),
  fecha_primer_contacto timestamptz,            -- para medir el SLA de respuesta
  fecha_ultimo_contacto timestamptz,
  motivo_perdida      text,
  notas               text,
  archivado_el        timestamptz,
  creado_el           timestamptz not null default now(),
  actualizado_el      timestamptz not null default now(),

  -- R5 como restricción real, no como aviso en pantalla
  constraint calificado_requiere_las_4_respuestas check (
    estado < '06_calificado'
    or (cal_operar_o_invertir is not null
        and cal_compro_antes    is not null
        and cal_forma_pago      is not null
        and cal_decide_solo     is not null)
  )
);
create index on oportunidades (estado) where archivado_el is null;
create index on oportunidades (responsable_id) where archivado_el is null;

-- R1 · UNA UNIDAD, UNA ASIGNACIÓN ACTIVA. La defensa contra la doble asignación.
create unique index unidad_una_sola_asignacion_activa
  on oportunidades (unidad_asignada_id)
  where unidad_asignada_id is not null
    and archivado_el is null
    and situacion = 'activa';

-- ---------------------------------------------------------------------
-- 6 · HISTORIAL DE ESTADOS  (append-only · R9)
-- ---------------------------------------------------------------------

create table estado_historial (
  id             bigserial primary key,
  oportunidad_id uuid not null references oportunidades(id),
  de_estado      estado_embudo,
  a_estado       estado_embudo not null,
  actor_id       uuid references perfiles(id),
  motivo         text,
  ocurrio_el     timestamptz not null default now()
);
create index on estado_historial (oportunidad_id, ocurrio_el);

-- ---------------------------------------------------------------------
-- 7 · INTERACCIONES Y TAREAS  (el seguimiento que hoy no existe)
-- ---------------------------------------------------------------------

create table interacciones (
  id             uuid primary key default gen_random_uuid(),
  oportunidad_id uuid references oportunidades(id),
  persona_id     uuid not null references personas(id),
  canal          canal_interaccion not null,
  entrante       boolean not null default true,
  resumen        text not null,
  ocurrio_el     timestamptz not null default now(),
  actor_id       uuid references perfiles(id),
  adjunto_url    text,
  creado_el      timestamptz not null default now()
);
create index on interacciones (persona_id, ocurrio_el desc);

create table tareas (
  id             uuid primary key default gen_random_uuid(),
  titulo         text not null,
  detalle        text,
  oportunidad_id uuid references oportunidades(id),
  persona_id     uuid references personas(id),
  responsable_id uuid not null references perfiles(id),
  vence_el       timestamptz not null,
  prioridad      smallint not null default 2,   -- 1 alta · 2 media · 3 baja
  completada_el  timestamptz,
  creado_el      timestamptz not null default now(),
  creado_por     uuid references perfiles(id)
);
create index on tareas (responsable_id, vence_el) where completada_el is null;

-- ---------------------------------------------------------------------
-- 8 · SEPARACIONES  (S/500 · las dos reglas más delicadas del negocio)
-- ---------------------------------------------------------------------

create table separaciones (
  id                       uuid primary key default gen_random_uuid(),
  oportunidad_id           uuid not null references oportunidades(id),
  persona_id               uuid not null references personas(id),
  unidad_id                uuid references unidades(id),
  monto                    numeric(12,2) not null,
  monto_moneda             moneda not null,
  -- El plazo NO se escribe aquí: se lee de parametros('plazo_devolucion_separacion_dias')
  plazo_parametro          text not null default 'plazo_devolucion_separacion_dias'
                           references parametros(id),

  -- RELOJ 1 · derecho de devolución. Corre desde el DEPÓSITO EFECTIVO.
  fecha_deposito_efectivo  date,
  fecha_limite_devolucion  date,

  -- RELOJ 2 · vigencia del precio post-evento. INDEPENDIENTE del anterior. (R4)
  fecha_limite_precio      date,

  banco                    text,
  nro_operacion            text,
  comprobante_url          text,

  -- R2 · solo un usuario con rol 'direccion' puede llenar esto
  verificada_por           uuid references perfiles(id),
  verificada_el            timestamptz,

  estado                   estado_separacion not null default 'pendiente_verificacion',
  devuelta_el              date,
  motivo_devolucion        text,
  firma_cliente_url        text,   -- la brecha nº1 del talonario actual: falta firma del cliente
  doc_cliente_registrado   boolean not null default false,
  notas                    text,
  archivado_el             timestamptz,
  creado_el                timestamptz not null default now(),
  creado_por               uuid references perfiles(id),

  constraint verificada_exige_ambos check (
    (verificada_por is null and verificada_el is null)
    or (verificada_por is not null and verificada_el is not null)
  ),
  constraint estado_verificada_exige_verificacion check (
    estado <> 'verificada' or verificada_el is not null
  )
);
comment on column separaciones.fecha_limite_devolucion is
  'RELOJ 1. Derecho de devolución, contado desde el depósito efectivo. Distinto del reloj 2. Acta 03-O02 y DEC-018.';
comment on column separaciones.fecha_limite_precio is
  'RELOJ 2. Vigencia post-evento del precio. NO se deriva del reloj 1. Mezclarlos es un problema legal.';

-- R1 también a nivel de separación: una unidad no admite dos separaciones vivas
create unique index unidad_una_separacion_viva
  on separaciones (unidad_id)
  where unidad_id is not null
    and archivado_el is null
    and estado in ('pendiente_verificacion','verificada');

-- ---------------------------------------------------------------------
-- 9 · CONTRATOS, CUOTAS Y PAGOS  (el seguimiento de socios)
-- ---------------------------------------------------------------------

create table contratos (
  id               uuid primary key default gen_random_uuid(),
  oportunidad_id   uuid references oportunidades(id),
  persona_id       uuid not null references personas(id),
  unidad_id        uuid not null references unidades(id),
  separacion_id    uuid references separaciones(id),
  codigo           text unique,
  fecha_firma      date,
  precio_total     numeric(14,2) not null,
  precio_moneda    moneda not null,
  modalidad_pago   text,             -- contado | financiado_directo | financiera_aliada
  inicial_monto    numeric(14,2),
  estado_legal     text,             -- Minuta | Notaría | Registros Públicos | Titulado
  documento_url    text,
  observaciones    text,
  archivado_el     timestamptz,
  creado_el        timestamptz not null default now(),
  creado_por       uuid references perfiles(id)
);

create unique index unidad_un_contrato_vivo
  on contratos (unidad_id) where archivado_el is null;

create table cuotas (
  id               uuid primary key default gen_random_uuid(),
  contrato_id      uuid not null references contratos(id) on delete restrict,
  numero           integer not null,
  fecha_vencimiento date not null,
  monto            numeric(14,2) not null,
  monto_moneda     moneda not null,
  estado           estado_cuota not null default 'pendiente',
  concepto         text,
  nota             text,
  creado_el        timestamptz not null default now(),
  unique (contrato_id, numero)
);
create index on cuotas (fecha_vencimiento) where estado in ('pendiente','parcial','vencida');

create table pagos (
  id               uuid primary key default gen_random_uuid(),
  cuota_id         uuid references cuotas(id),
  separacion_id    uuid references separaciones(id),
  persona_id       uuid not null references personas(id),
  monto            numeric(14,2) not null,
  monto_moneda     moneda not null,
  fecha_pago       date not null,
  medio            text,              -- transferencia | efectivo | yape | depósito
  banco            text,
  nro_operacion    text,
  comprobante_url  text,
  verificado_por   uuid references perfiles(id),
  verificado_el    timestamptz,
  nota             text,
  archivado_el     timestamptz,
  creado_el        timestamptz not null default now(),
  creado_por       uuid references perfiles(id),
  constraint pago_pertenece_a_algo check (cuota_id is not null or separacion_id is not null)
);
create index on pagos (persona_id, fecha_pago desc);

-- ---------------------------------------------------------------------
-- 10 · AUDITORÍA GENERAL
-- ---------------------------------------------------------------------

create table bitacora (
  id          bigserial primary key,
  tabla       text not null,
  registro_id text not null,
  accion      text not null,          -- INSERT | UPDATE | DELETE
  actor_id    uuid,
  antes       jsonb,
  despues     jsonb,
  ocurrio_el  timestamptz not null default now()
);
create index on bitacora (tabla, registro_id, ocurrio_el desc);

-- ---------------------------------------------------------------------
-- 11 · DISPARADORES  (las reglas que el formulario no puede esquivar)
-- ---------------------------------------------------------------------

create or replace function fn_actualizado_el() returns trigger
language plpgsql as $$
begin
  new.actualizado_el := now();
  return new;
end $$;

create trigger t_unidades_upd before update on unidades
  for each row execute function fn_actualizado_el();
create trigger t_personas_upd before update on personas
  for each row execute function fn_actualizado_el();
create trigger t_oportunidades_upd before update on oportunidades
  for each row execute function fn_actualizado_el();

-- R9 · historial de estados automático
create or replace function fn_registrar_cambio_estado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into estado_historial (oportunidad_id, de_estado, a_estado, actor_id)
    values (new.id, null, new.estado, auth.uid());
  elsif new.estado is distinct from old.estado then
    insert into estado_historial (oportunidad_id, de_estado, a_estado, actor_id)
    values (new.id, old.estado, new.estado, auth.uid());
  end if;
  return new;
end $$;

create trigger t_oportunidad_historial
  after insert or update of estado on oportunidades
  for each row execute function fn_registrar_cambio_estado();

-- R2 · solo dirección verifica una separación
create or replace function fn_verificacion_solo_direccion() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_rol rol_usuario;
begin
  if new.verificada_el is not null
     and (old.verificada_el is null or tg_op = 'INSERT') then
    select rol into v_rol from perfiles where id = auth.uid();
    if v_rol is distinct from 'direccion' then
      raise exception
        'Solo un usuario con rol dirección puede verificar una separación (Acta 03-O02: Walter es el único verificador del S/500).';
    end if;
    new.verificada_por := auth.uid();
  end if;
  return new;
end $$;

create trigger t_separacion_verificacion
  before insert or update on separaciones
  for each row execute function fn_verificacion_solo_direccion();

-- R4 · el reloj 1 se calcula desde el depósito efectivo y SOLO desde ahí.
--      El reloj 2 nunca se toca aquí.
create or replace function fn_calcular_limite_devolucion() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_dias integer;
begin
  if new.fecha_deposito_efectivo is not null then
    select valor_entero into v_dias from parametros where id = new.plazo_parametro;
    if v_dias is null then
      raise exception
        'No se puede calcular el plazo: el parámetro % no tiene valor. Cárgalo desde 00-fuente-de-verdad antes de registrar separaciones.', new.plazo_parametro;
    end if;
    new.fecha_limite_devolucion := new.fecha_deposito_efectivo + v_dias;
  end if;
  return new;
end $$;

create trigger t_separacion_plazo
  before insert or update of fecha_deposito_efectivo, plazo_parametro on separaciones
  for each row execute function fn_calcular_limite_devolucion();

-- R3 · la función que la interfaz DEBE llamar antes de emitir constancia o recibo
create or replace function puede_emitir_constancia(p_separacion_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.verificada_el is not null
            and s.estado = 'verificada'
            and s.doc_cliente_registrado
       from separaciones s where s.id = p_separacion_id),
    false)
$$;
comment on function puede_emitir_constancia is
  'R3. Falso mientras Walter no verifique. Acta 03-O02: no se emite recibo antes de su verificación. La interfaz no debe ofrecer el botón de imprimir si esto devuelve falso.';

-- R8 · nadie borra: se revoca DELETE y se usa archivado_el
create or replace function fn_prohibir_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Nada se borra en este sistema. Usa archivado_el (regla R8 de CLAUDE.md).';
end $$;

create trigger t_no_delete_personas before delete on personas
  for each row execute function fn_prohibir_delete();
create trigger t_no_delete_oportunidades before delete on oportunidades
  for each row execute function fn_prohibir_delete();
create trigger t_no_delete_separaciones before delete on separaciones
  for each row execute function fn_prohibir_delete();
create trigger t_no_delete_contratos before delete on contratos
  for each row execute function fn_prohibir_delete();
create trigger t_no_delete_pagos before delete on pagos
  for each row execute function fn_prohibir_delete();

-- Bitácora genérica
create or replace function fn_bitacora() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into bitacora (tabla, registro_id, accion, actor_id, antes, despues)
  values (tg_table_name,
          coalesce(new.id::text, old.id::text),
          tg_op,
          auth.uid(),
          case when tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger t_bit_separaciones after insert or update on separaciones
  for each row execute function fn_bitacora();
create trigger t_bit_contratos after insert or update on contratos
  for each row execute function fn_bitacora();
create trigger t_bit_pagos after insert or update on pagos
  for each row execute function fn_bitacora();
create trigger t_bit_unidades after insert or update on unidades
  for each row execute function fn_bitacora();
create trigger t_bit_parametros after insert or update on parametros
  for each row execute function fn_bitacora();



-- #####################################################################
-- 02-rls.sql ##########################################################
-- #####################################################################

-- =====================================================================
-- CRM Mercado Media Luna — 02 · SEGURIDAD A NIVEL DE FILA (RLS)
-- Estado: 🟢 VIGENTE · 08/09/2026
--
-- LEE ESTO ANTES DE EJECUTARLO:
-- La clave `anon` de Supabase viaja dentro del navegador de cualquiera que abra
-- el CRM. Es pública por diseño. Lo único que impide que un curioso lea todos los
-- DNI y todos los montos es lo que hay en este archivo.
-- Una tabla sin RLS = una base de datos pública.
--
-- Después de ejecutarlo, corre OBLIGATORIAMENTE la batería de pruebas de
-- 01-documentacion\05-SEGURIDAD-BACKUPS-Y-LEY-29733.md §4 antes de cargar un
-- solo dato real.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0 · Cerrar la puerta principal
-- ---------------------------------------------------------------------
revoke all on schema public from anon;
grant usage on schema public to anon, authenticated;
-- El rol anónimo NO necesita leer nada: este CRM no tiene páginas públicas.
-- Todo acceso pasa por un usuario autenticado.

alter default privileges in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------
-- 1 · Funciones de ayuda (SECURITY DEFINER para no recursionar sobre perfiles)
-- ---------------------------------------------------------------------

create or replace function mi_rol() returns rol_usuario
language sql stable security definer set search_path = public as $$
  select rol from perfiles where id = auth.uid() and activo
$$;

create or replace function es(p_roles rol_usuario[]) returns boolean
language sql stable security definer set search_path = public as $$
  select mi_rol() = any(p_roles)
$$;

-- ---------------------------------------------------------------------
-- 2 · Activar RLS en TODAS las tablas. Sin excepción.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'perfiles','parametros','tipo_cambio','unidades','personas','campanas',
    'oportunidades','estado_historial','interacciones','tareas','separaciones',
    'contratos','cuotas','pagos','bitacora'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3 · Políticas
-- ---------------------------------------------------------------------

-- PERFILES: cada quien se ve a sí mismo; dirección ve y administra a todos.
create policy perfiles_leer_propio on perfiles for select to authenticated
  using (id = auth.uid() or es(array['direccion']::rol_usuario[]));
create policy perfiles_direccion_todo on perfiles for all to authenticated
  using (es(array['direccion']::rol_usuario[]))
  with check (es(array['direccion']::rol_usuario[]));

-- PARÁMETROS: todos leen (el CRM entero depende de ellos); solo dirección escribe.
-- Un vendedor que pudiera editar el precio haría inútil la regla de fuente de verdad.
create policy parametros_leer on parametros for select to authenticated using (true);
create policy parametros_escribir on parametros for all to authenticated
  using (es(array['direccion']::rol_usuario[]))
  with check (es(array['direccion']::rol_usuario[]));

create policy tc_leer on tipo_cambio for select to authenticated using (true);
create policy tc_escribir on tipo_cambio for all to authenticated
  using (es(array['direccion','contabilidad']::rol_usuario[]))
  with check (es(array['direccion','contabilidad']::rol_usuario[]));

-- UNIDADES: todo el equipo las lee; Rosa (administración) y dirección las mantienen.
-- Acta 03-O02: "Rosa es responsable de mantener el inventario".
create policy unidades_leer on unidades for select to authenticated using (true);
create policy unidades_escribir on unidades for all to authenticated
  using (es(array['direccion','administracion']::rol_usuario[]))
  with check (es(array['direccion','administracion']::rol_usuario[]));

-- PERSONAS: datos personales. Lectura para quien opera; contabilidad y lectura solo leen.
create policy personas_leer on personas for select to authenticated
  using (es(array['direccion','comercial','administracion','contabilidad','lectura']::rol_usuario[]));
create policy personas_crear on personas for insert to authenticated
  with check (es(array['direccion','comercial','administracion']::rol_usuario[]));
create policy personas_editar on personas for update to authenticated
  using (es(array['direccion','comercial','administracion']::rol_usuario[]))
  with check (es(array['direccion','comercial','administracion']::rol_usuario[]));

-- CAMPAÑAS
create policy campanas_leer on campanas for select to authenticated using (true);
create policy campanas_escribir on campanas for all to authenticated
  using (es(array['direccion','comercial']::rol_usuario[]))
  with check (es(array['direccion','comercial']::rol_usuario[]));

-- OPORTUNIDADES: un vendedor ve y edita las suyas. Dirección y administración, todas.
-- (Hoy hay un solo comercial; la política ya está lista para cuando entren más.)
create policy oport_leer on oportunidades for select to authenticated
  using (
    es(array['direccion','administracion','contabilidad','lectura']::rol_usuario[])
    or responsable_id = auth.uid()
  );
create policy oport_crear on oportunidades for insert to authenticated
  with check (es(array['direccion','comercial','administracion']::rol_usuario[]));
create policy oport_editar on oportunidades for update to authenticated
  using (
    es(array['direccion','administracion']::rol_usuario[])
    or (es(array['comercial']::rol_usuario[]) and responsable_id = auth.uid())
  )
  with check (
    es(array['direccion','administracion']::rol_usuario[])
    or (es(array['comercial']::rol_usuario[]) and responsable_id = auth.uid())
  );

-- HISTORIAL: solo lectura para humanos. Lo escriben los disparadores. (R9)
create policy historial_leer on estado_historial for select to authenticated using (true);
-- Sin política de INSERT/UPDATE/DELETE: nadie puede reescribir la historia desde el cliente.

-- INTERACCIONES
create policy inter_leer on interacciones for select to authenticated using (true);
create policy inter_crear on interacciones for insert to authenticated
  with check (es(array['direccion','comercial','administracion']::rol_usuario[]));
create policy inter_editar on interacciones for update to authenticated
  using (actor_id = auth.uid() or es(array['direccion']::rol_usuario[]))
  with check (actor_id = auth.uid() or es(array['direccion']::rol_usuario[]));

-- TAREAS
create policy tareas_leer on tareas for select to authenticated using (true);
create policy tareas_escribir on tareas for all to authenticated
  using (es(array['direccion','comercial','administracion']::rol_usuario[]))
  with check (es(array['direccion','comercial','administracion']::rol_usuario[]));

-- SEPARACIONES: el corazón del dinero.
-- Comercial y administración registran; SOLO dirección verifica (el disparador R2
-- lo refuerza, esto lo refuerza dos veces: defensa en profundidad).
create policy sep_leer on separaciones for select to authenticated using (true);
create policy sep_crear on separaciones for insert to authenticated
  with check (
    es(array['direccion','comercial','administracion']::rol_usuario[])
    and verificada_el is null      -- nadie nace verificado
  );
create policy sep_editar_operativo on separaciones for update to authenticated
  using (es(array['comercial','administracion']::rol_usuario[]))
  with check (
    es(array['comercial','administracion']::rol_usuario[])
    and verificada_el is null      -- un comercial jamás puede marcarla verificada
  );
create policy sep_editar_direccion on separaciones for update to authenticated
  using (es(array['direccion']::rol_usuario[]))
  with check (es(array['direccion']::rol_usuario[]));

-- CONTRATOS
create policy contratos_leer on contratos for select to authenticated using (true);
create policy contratos_escribir on contratos for all to authenticated
  using (es(array['direccion','administracion']::rol_usuario[]))
  with check (es(array['direccion','administracion']::rol_usuario[]));

-- CUOTAS Y PAGOS: cobranza es de Rosa; contabilidad lee; dirección todo.
create policy cuotas_leer on cuotas for select to authenticated using (true);
create policy cuotas_escribir on cuotas for all to authenticated
  using (es(array['direccion','administracion']::rol_usuario[]))
  with check (es(array['direccion','administracion']::rol_usuario[]));

create policy pagos_leer on pagos for select to authenticated using (true);
create policy pagos_crear on pagos for insert to authenticated
  with check (es(array['direccion','administracion']::rol_usuario[]));
create policy pagos_editar on pagos for update to authenticated
  using (es(array['direccion','administracion']::rol_usuario[]))
  with check (es(array['direccion','administracion']::rol_usuario[]));

-- BITÁCORA: solo dirección la lee. Nadie la escribe desde el cliente.
create policy bitacora_leer on bitacora for select to authenticated
  using (es(array['direccion']::rol_usuario[]));

-- ---------------------------------------------------------------------
-- 4 · Alta de perfil automática al crear un usuario
--     Nace con rol 'lectura': el acceso se otorga, no se hereda.
-- ---------------------------------------------------------------------
create or replace function fn_nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (id, nombre, rol)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', new.email), 'lectura')
  on conflict (id) do nothing;
  return new;
end $$;

create trigger t_nuevo_usuario after insert on auth.users
  for each row execute function fn_nuevo_usuario();



-- #####################################################################
-- 03-vistas.sql #######################################################
-- #####################################################################

-- =====================================================================
-- CRM Mercado Media Luna — 03 · VISTAS DE REPORTE
-- Estado: 🟢 VIGENTE · 08/09/2026
--
-- Las fórmulas son las de D:\SCPCMO\01-comercial\embudo-y-metricas.md §4.
-- No inventes indicadores nuevos aquí sin cambiar antes ese archivo.
-- =====================================================================

-- 1 · EL EMBUDO AHORA MISMO -------------------------------------------
create or replace view v_embudo as
select o.estado,
       count(*) filter (where o.situacion = 'activa')  as activas,
       count(*) filter (where o.situacion = 'ganada')  as ganadas,
       count(*) filter (where o.situacion = 'perdida') as perdidas,
       count(*)                                        as total
from oportunidades o
where o.archivado_el is null
group by o.estado
order by o.estado;

-- 2 · CONVERSIONES ----------------------------------------------------
-- Ojo: son tasas sobre el acumulado histórico de la base, no sobre una cohorte.
-- Para comparar contra la línea base de julio 2026 (595 → 26 → 1) hay que filtrar
-- por lanzamiento; la vista v_embudo_por_lanzamiento sirve para eso.
create or replace view v_conversion as
with c as (
  select
    count(*)                                                          as captados,
    count(*) filter (where estado >= '02_contactado')                 as contactados,
    count(*) filter (where estado >= '03_registrado')                 as registrados,
    count(*) filter (where estado >= '04_asistente')                  as asistentes,
    count(*) filter (where estado >= '05_separacion')                 as separaciones,
    count(*) filter (where estado >= '06_calificado')                 as calificados,
    count(*) filter (where estado >= '07_contrato')                   as contratos,
    count(*) filter (where estado >= '08_inicial_cobrada')            as iniciales,
    count(*) filter (where estado >= '09_pago_total')                 as pagos_totales
  from oportunidades where archivado_el is null
)
select *,
  round(100.0 * contactados  / nullif(captados,0),    2) as tasa_contacto_pct,
  round(100.0 * asistentes   / nullif(registrados,0), 2) as tasa_asistencia_pct,
  round(100.0 * separaciones / nullif(asistentes,0),  2) as tasa_separacion_pct,
  round(100.0 * contratos    / nullif(separaciones,0),2) as tasa_contrato_pct,
  round(100.0 * iniciales    / nullif(contratos,0),   2) as tasa_inicial_pct,
  round(100.0 * contratos    / nullif(captados,0),    2) as prospecto_a_contrato_pct
from c;

create or replace view v_embudo_por_lanzamiento as
select coalesce(lanzamiento,'(sin lanzamiento)') as lanzamiento,
       estado, count(*) as n
from oportunidades where archivado_el is null
group by 1,2 order by 1,2;

-- 3 · COSTO POR LEAD Y POR CONTRATO -----------------------------------
create or replace view v_rendimiento_campanas as
select c.id, c.nombre, c.plataforma, c.lanzamiento,
       c.inversion, c.inversion_moneda,
       count(distinct p.id)                                        as leads,
       count(distinct o.id) filter (where o.estado >= '07_contrato') as contratos,
       round(c.inversion / nullif(count(distinct p.id),0), 2)      as costo_por_lead,
       round(c.inversion / nullif(count(distinct o.id)
             filter (where o.estado >= '07_contrato'),0), 2)       as costo_por_contrato
from campanas c
left join personas p       on p.campana_id = c.id and p.archivado_el is null
left join oportunidades o  on o.persona_id = p.id and o.archivado_el is null
where c.archivado_el is null
group by c.id;

-- 4 · LO QUE SE ESTÁ FUGANDO HOY --------------------------------------
-- Esta es la vista más importante del sistema. Es la lista de gente
-- que entró y a la que nadie le está haciendo nada.
create or replace view v_sin_siguiente_paso as
select o.id, p.nombre_completo, p.telefono_e164, o.estado, o.lanzamiento,
       o.fecha_ingreso,
       o.fecha_ultimo_contacto,
       extract(day from now() - coalesce(o.fecha_ultimo_contacto, o.fecha_ingreso))::int
         as dias_sin_contacto
from oportunidades o
join personas p on p.id = o.persona_id
where o.archivado_el is null
  and o.situacion = 'activa'
  and o.estado < '09_pago_total'
  and not exists (
    select 1 from tareas t
    where t.oportunidad_id = o.id and t.completada_el is null
  )
order by dias_sin_contacto desc;

-- Cumplimiento del SLA de primera respuesta.
-- El umbral vive en parametros('sla_primera_respuesta_minutos').
create or replace view v_sla_primera_respuesta as
select o.id, p.nombre_completo, o.fecha_ingreso, o.fecha_primer_contacto,
       round(extract(epoch from (o.fecha_primer_contacto - o.fecha_ingreso))/60)::int
         as minutos_hasta_respuesta,
       (select valor_entero from parametros where id = 'sla_primera_respuesta_minutos')
         as sla_minutos
from oportunidades o
join personas p on p.id = o.persona_id
where o.archivado_el is null;

-- 5 · SEPARACIONES — LOS DOS RELOJES ----------------------------------
create or replace view v_separaciones_vigilancia as
select s.id, p.nombre_completo, u.codigo_unidad,
       s.monto, s.monto_moneda, s.estado,
       s.fecha_deposito_efectivo,
       s.fecha_limite_devolucion,
       (s.fecha_limite_devolucion - current_date) as dias_para_fin_devolucion,
       s.fecha_limite_precio,
       (s.fecha_limite_precio - current_date)     as dias_para_fin_precio,
       s.verificada_el,
       (s.verificada_el is null)                  as espera_verificacion_de_walter,
       puede_emitir_constancia(s.id)              as puede_emitir_constancia
from separaciones s
join personas p on p.id = s.persona_id
left join unidades u on u.id = s.unidad_id
where s.archivado_el is null
  and s.estado in ('pendiente_verificacion','verificada')
order by s.fecha_limite_devolucion nulls first;

-- 6 · COBRANZA — ANTIGÜEDAD DE SALDOS (socios) ------------------------
create or replace view v_cobranza as
select c.id as contrato_id, per.nombre_completo, per.telefono_e164,
       u.codigo_unidad, cu.numero, cu.fecha_vencimiento,
       cu.monto, cu.monto_moneda, cu.estado,
       coalesce(sum(pg.monto),0) as pagado,
       cu.monto - coalesce(sum(pg.monto),0) as saldo,
       (current_date - cu.fecha_vencimiento) as dias_de_atraso,
       case
         when cu.fecha_vencimiento >= current_date then 'por_vencer'
         when current_date - cu.fecha_vencimiento <= 30 then 'mora_1_30'
         when current_date - cu.fecha_vencimiento <= 60 then 'mora_31_60'
         else 'mora_60_mas'
       end as tramo
from cuotas cu
join contratos c on c.id = cu.contrato_id
join personas per on per.id = c.persona_id
join unidades u on u.id = c.unidad_id
left join pagos pg on pg.cuota_id = cu.id and pg.archivado_el is null
where cu.estado <> 'pagada' and c.archivado_el is null
group by c.id, per.nombre_completo, per.telefono_e164, u.codigo_unidad,
         cu.numero, cu.fecha_vencimiento, cu.monto, cu.monto_moneda, cu.estado
order by cu.fecha_vencimiento;

-- 7 · INVENTARIO — QUÉ SE PUEDE OFRECER DE VERDAD ---------------------
-- Acta 03-O02: se puede ofrecer sin pasar por Walter SOLO si el sistema
-- demuestra que el puesto está objetivamente libre. Eso exige las dos
-- condiciones: estado disponible Y dato verde contra plano.
create or replace view v_unidades_ofrecibles as
select u.*
from unidades u
where u.archivado_el is null
  and u.estado_comercial = 'disponible'
  and u.estado_dato = 'verde'
  and not exists (
    select 1 from oportunidades o
    where o.unidad_asignada_id = u.id and o.situacion = 'activa' and o.archivado_el is null)
  and not exists (
    select 1 from separaciones s
    where s.unidad_id = u.id
      and s.estado in ('pendiente_verificacion','verificada') and s.archivado_el is null);

create or replace view v_inventario_resumen as
select estado_comercial, estado_dato, count(*) as unidades
from unidades where archivado_el is null
group by 1,2 order by 1,2;

-- 8 · INSUMOS DEL REPORTE DE 7 PARTES ---------------------------------
-- Alimenta las partes 1 (trabajo ejecutado), 2 (artefactos) y 3 (hechos con fuente).
create or replace view v_actividad_diaria as
select date_trunc('day', ocurrio_el)::date as dia,
       actor_id,
       count(*) filter (where true)                    as interacciones,
       count(*) filter (where canal = 'whatsapp')      as whatsapp,
       count(*) filter (where canal = 'llamada')       as llamadas
from interacciones
group by 1,2 order by 1 desc;

create or replace view v_cambios_de_estado_por_dia as
select date_trunc('day', ocurrio_el)::date as dia, a_estado, count(*) as n
from estado_historial group by 1,2 order by 1 desc, 2;

-- 9 · CALIDAD DEL DATO -------------------------------------------------
-- Un CRM miente en silencio. Esta vista lo delata.
create or replace view v_calidad_del_dato as
select
  (select count(*) from personas where archivado_el is null and telefono_e164 is null)      as personas_sin_telefono,
  (select count(*) from personas where archivado_el is null and not consentimiento)          as personas_sin_consentimiento,
  (select count(*) from personas where archivado_el is null and doc_numero is null)          as personas_sin_documento,
  (select count(*) from oportunidades where archivado_el is null and responsable_id is null) as oportunidades_sin_responsable,
  (select count(*) from v_sin_siguiente_paso)                                                as oportunidades_sin_tarea,
  (select count(*) from unidades where archivado_el is null and estado_dato <> 'verde')      as unidades_sin_verificar,
  (select count(*) from separaciones where archivado_el is null and verificada_el is null
      and estado = 'pendiente_verificacion')                                                 as separaciones_esperando_a_walter,
  (select count(*) from parametros where estado_semaforo <> 'verde')                         as parametros_no_confirmados;



-- #####################################################################
-- 04-seed-parametros.sql ##############################################
-- #####################################################################

-- =====================================================================
-- CRM Mercado Media Luna — 04 · SIEMBRA DE PARÁMETROS
-- Estado: 🟢 VIGENTE (la estructura) · 🔴 los valores están VACÍOS a propósito
--
-- ⛔ LEE ESTO ANTES DE TOCAR NADA
-- Este archivo NO trae ni un solo precio, plazo ni cantidad.
-- Los deja declarados, con su fuente y en semáforo rojo.
--
-- ¿Por qué? Porque en D:\SCPCMO\00-fuente-de-verdad\ hay documentados 8 precios
-- en conflicto, 4 políticas de financiamiento y 4 cifras de inventario. Si yo
-- copiara "el más reciente" estaría creando la novena versión, y el CRM pasaría
-- a ser una fuente de verdad falsa que además se ve oficial.
--
-- CÓMO SE LLENA (10 minutos, lo haces tú, una sola vez):
--   1. Abre el archivo citado en la columna `fuente`.
--   2. Copia el valor EXACTO que ese archivo declara.
--   3. Ejecuta el UPDATE correspondiente del bloque de abajo.
--   4. Cambia estado_semaforo a 'verde' SOLO si el archivo lo tiene en 🟢.
--      Si allá está en 🟡 o 🔴, aquí también. El CRM no mejora la certeza de un dato.
--
-- Mientras un parámetro esté en rojo, la interfaz debe mostrarlo como
-- «[PENDIENTE — ver 00-fuente-de-verdad]» y NO permitir cotizar con él.
-- =====================================================================

insert into parametros (id, descripcion, fuente, estado_semaforo, unidad, nota) values

('precio_puesto_9m2',
 'Precio de lista del puesto de 9 m² para el lanzamiento vigente',
 'D:\SCPCMO\00-fuente-de-verdad\precios-vigentes.md',
 'rojo', 'monto',
 'Acta 03-O02 (31/08): el producto del lanzamiento son puestos de 9 m² únicamente. Tiendas y otros tipos quedan fuera. Copiar el valor y la moneda del archivo fuente, incluyendo si es con IGV.'),

('separacion_monto',
 'Monto de la separación',
 'D:\SCPCMO\01-comercial\politica-separacion.md',
 'rojo', 'monto',
 'DEC-018. Reembolsable. Receptor: cuenta empresarial de SCP Inmobiliaria.'),

('plazo_devolucion_separacion_dias',
 'RELOJ 1 — días de derecho de devolución, contados desde el DEPÓSITO EFECTIVO',
 'D:\SCPCMO\01-comercial\politica-separacion.md',
 'rojo', 'dias_calendario',
 'El disparador de separaciones NO funciona sin este valor: lanza excepción. Es el primero que hay que cargar. NO es el mismo plazo que la vigencia del precio (ver siguiente).'),

('plazo_vigencia_precio_dias',
 'RELOJ 2 — días de vigencia del precio después del evento',
 'D:\SCPCMO\00-fuente-de-verdad\precios-vigentes.md',
 'rojo', 'dias_calendario',
 'INDEPENDIENTE del reloj 1. Nunca calcular uno a partir del otro (regla R4).'),

('cupos_lanzamiento',
 'Cantidad de unidades ofrecidas en el lanzamiento vigente',
 'D:\SCPCMO\00-fuente-de-verdad\inventario-maestro.md',
 'rojo', 'unidades',
 'Cifra de la perspectiva pública del lanzamiento. NO es el inventario total.'),

('inventario_total_unidades',
 'Total de unidades del proyecto',
 'D:\SCPCMO\00-fuente-de-verdad\inventario-maestro.md',
 'rojo', 'unidades',
 '🔴 BLOQUEADO en la fuente: hay 4 cifras en conflicto (478 / 473 / 474 / 120) y falta el plano vigente. NO cargar ninguna hasta que se concilie. Dejar en rojo es la respuesta correcta hoy.'),

('moneda_de_control',
 'Moneda única en la que se consolidan los indicadores',
 'D:\SCPCMO\00-fuente-de-verdad\moneda-de-comunicacion.md',
 'rojo', 'moneda',
 'embudo-y-metricas.md §7 lo deja [PENDIENTE]. Hasta que se defina, ninguna vista suma PEN con USD.'),

('meta_comercial_acumulada',
 'Meta comercial acumulada del periodo',
 'D:\SCPCMO\00-sistema\ (DEC-018)',
 'rojo', 'monto',
 'Citar de la decisión formal, no de un correo.'),

('comision_por_venta',
 'Comisión del colaborador por venta cerrada',
 'D:\SCPCMO\04-mi-rol\modelo-comisiones.md',
 'rojo', 'monto',
 'Acta 03-O02: rango comunicado y confirmado, fórmula definitiva PENDIENTE. Mantener en 🟡 como máximo, nunca en verde, hasta que exista acuerdo escrito.'),

('sla_primera_respuesta_minutos',
 'Minutos máximos para la primera respuesta a un lead nuevo en horario laboral',
 'PROPUESTA de Patriccio — sin ratificar por Dirección',
 'azul', 'minutos',
 '🔵 PROPUESTA. Sugerido: 15 minutos (operacion_redes_y_embudo). El fundamento externo es el estudio MIT/InsideSales (Oldroyd): responder en 5 min frente a 30 min multiplica por 21 las probabilidades de calificar el lead. Ver 01-documentacion\06-MEJORES-PRACTICAS-Y-FUENTES.md.'),

('horario_laboral_inicio',
 'Hora de inicio del horario de atención',
 'PROPUESTA — pendiente de acordar con Rosa y Dirección',
 'azul', 'hora', null),

('horario_laboral_fin',
 'Hora de fin del horario de atención',
 'PROPUESTA — pendiente de acordar con Rosa y Dirección',
 'azul', 'hora', null),

('banco_receptor',
 'Banco y cuenta que recibe las separaciones',
 'D:\SCPCMO\01-comercial\politica-separacion.md',
 'rojo', 'texto',
 'DEC-018 nombra el banco. El número de cuenta NO se guarda aquí si no es imprescindible.'),

('razon_social',      'Razón social de la empresa emisora',
 'D:\SCPCMO\00-fuente-de-verdad\ficha-proyecto-mml.md', 'rojo', 'texto',
 'Falta en el talonario actual. La constancia del CRM debe traerla.'),

('ruc',               'RUC de la empresa emisora',
 'D:\SCPCMO\00-fuente-de-verdad\ficha-proyecto-mml.md', 'rojo', 'texto',
 'Falta en el talonario actual (política-separacion §1.2).'),

('naturaleza_juridica_producto',
 'Qué se transfiere exactamente al comprador',
 'D:\SCPCMO\00-fuente-de-verdad\ficha-proyecto-mml.md §4',
 'rojo', 'texto',
 '🔴 RIESGO MÁS ALTO DEL PITCH. La ficha confirma acciones y derechos sobre el inmueble matriz, NO propiedad independizada. Este texto es el que debe aparecer literal en la constancia. No parafrasearlo.')

on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- CÓMO CARGAR UN VALOR (ejemplos de la forma, sin valores reales)
-- ---------------------------------------------------------------------
-- Numérico con moneda:
--   update parametros set valor_numerico = <copiar del archivo fuente>,
--                         valor_moneda   = 'USD',
--                         estado_semaforo = 'verde',
--                         vigente_desde  = '2026-__-__',
--                         actualizado_el = now()
--   where id = 'precio_puesto_9m2';
--
-- Entero (plazos, cupos):
--   update parametros set valor_entero = <copiar>, estado_semaforo = 'verde'
--   where id = 'plazo_devolucion_separacion_dias';
--
-- Texto:
--   update parametros set valor_texto = '<copiar literal>', estado_semaforo = 'verde'
--   where id = 'naturaleza_juridica_producto';
--
-- Comprobar qué falta:
--   select id, descripcion, estado_semaforo, fuente
--   from parametros where estado_semaforo <> 'verde' order by estado_semaforo desc, id;



-- #####################################################################
-- 06-registro-rapido.sql ##############################################
-- #####################################################################

-- =====================================================================
-- CRM Mercado Media Luna — 06 · REGISTRO RÁPIDO (transacción única)
-- Estado: 🟢 VIGENTE · 14/09/2026 (corregida la ambiguedad de persona_id / oportunidad_id)
--
-- Orden de ejecución: 01-schema → 02-rls → 03-vistas → 04-seed-parametros → 06
--
-- POR QUÉ ESTE ARCHIVO EXISTE
-- La pantalla /rapido tiene que crear TRES filas (persona, oportunidad y
-- tarea) y que las tres existan o ninguna. supabase-js no puede abrir una
-- transacción desde el navegador: son tres peticiones HTTP independientes.
-- Si la segunda falla, queda una persona sin oportunidad; si falla la tercera,
-- queda una oportunidad sin tarea abierta — es decir, se rompe R6 en el mismo
-- acto de registrar. Por eso el alta vive aquí: una llamada, una transacción.
--
-- SEGURIDAD: la función es SECURITY INVOKER (el modo por defecto — NO se
-- declara SECURITY DEFINER a propósito). Corre con los permisos de quien
-- llama, así que las políticas de 02-rls.sql se siguen evaluando fila por
-- fila. Esta función da atomicidad, no privilegios.
--
-- REGLA DE LA FUENTE DE VERDAD: aquí no hay ni un número de negocio escrito.
-- Los 15 minutos del vencimiento de la tarea NO están en el código: salen de
-- parametros('sla_primera_respuesta_minutos'), que hoy está en 🔵 azul y con
-- valor_entero NULO. Mientras siga nulo, la tarea vence en el acto (aparece
-- de inmediato en «Tareas vencidas» de la pantalla Hoy) y lo dice en su
-- detalle. Es deliberado: un parámetro sin cargar tiene que doler, no
-- rellenarse solo con el valor «sugerido» de una nota.
-- =====================================================================

-- Los orígenes admitidos. NO son un invento de la interfaz: son exactamente
-- los cinco que enumera el comentario de `personas.origen` en 01-schema.sql
-- (sección 3). `personas.origen` es `text` y no un enum, así que la lista se
-- valida aquí para que la pantalla no pueda introducir un sexto valor suelto
-- que después rompa los agrupados de v_rendimiento_campanas.
create or replace function origenes_admitidos() returns text[]
language sql immutable as $fn$
  select array['meta_ads','organico','referido','base_historica','live']
$fn$;

comment on function origenes_admitidos is
  'Fuente: 01-schema.sql seccion 3, comentario de la columna personas.origen. Si alli se anade un origen, se anade aqui; nunca al reves.';


create or replace function fn_registro_rapido(
  p_nombre_completo      text,
  p_telefono_e164        text,   -- ya normalizado a E.164 por src/lib/telefono.ts
  p_origen               text,
  p_consentimiento       boolean,
  p_consentimiento_canal text default 'crm_registro_rapido',
  p_lanzamiento          text default null
)
returns table (
  persona_id              uuid,
  oportunidad_id          uuid,
  tarea_id                uuid,
  tarea_vence_el          timestamptz,
  sla_minutos             integer,   -- NULL = el parámetro no está cargado
  persona_reutilizada     boolean,   -- true = ya existía esa persona (mismo teléfono)
  oportunidad_reutilizada boolean
)
language plpgsql
set search_path = public
as $fn$
declare
  v_actor    uuid := auth.uid();
  v_persona  uuid;
  v_oport    uuid;
  v_tarea    uuid;
  v_sla      integer;
  v_vence    timestamptz;
  v_detalle  text;
  v_persona_previa boolean := false;
  v_oport_previa   boolean := false;
begin
  if v_actor is null then
    raise exception 'No hay sesión activa. Vuelve a entrar al CRM.';
  end if;

  if coalesce(btrim(p_nombre_completo), '') = '' then
    raise exception 'El nombre es obligatorio.';
  end if;

  -- El teléfono llega ya normalizado; aquí solo se comprueba la forma E.164.
  -- No se «arregla» un número mal escrito: un teléfono inventado es peor que
  -- un campo vacío, porque el vacío se ve y el inventado no.
  if p_telefono_e164 !~ '^\+\d{8,15}$' then
    raise exception 'El teléfono debe venir en formato E.164 (+51999888777). Recibido: %', p_telefono_e164;
  end if;

  if not (p_origen = any(origenes_admitidos())) then
    raise exception 'Origen «%» no admitido. Los válidos son: %',
      p_origen, array_to_string(origenes_admitidos(), ', ');
  end if;

  -- Ley 29733 / DS 016-2024-JUS: el consentimiento se recoge en el primer
  -- contacto. Sin él no se guarda el dato personal.
  -- Ver 01-documentacion\05-SEGURIDAD-BACKUPS-Y-LEY-29733.md.
  if not coalesce(p_consentimiento, false) then
    raise exception 'Sin consentimiento no se puede registrar el dato personal (Ley 29733).';
  end if;

  -- ---------------------------------------------------------------
  -- 1 · PERSONA — se reutiliza si ya existe con ese mismo teléfono.
  -- El teléfono en E.164 es la clave de deduplicación (ver el encabezado de
  -- src/lib/telefono.ts). Durante un live la misma persona escribe dos veces;
  -- crear su ficha por duplicado es como se pierde el historial y el origen.
  -- ---------------------------------------------------------------
  select id into v_persona
  from personas
  where telefono_e164 = p_telefono_e164
    and archivado_el is null
  order by creado_el
  limit 1;

  if v_persona is not null then
    v_persona_previa := true;
    -- No se pisa el nombre ni el origen de una ficha que ya existía: lo que
    -- ya está registrado gana sobre lo que se teclea con prisa en un live.
    -- Solo se deja constancia del consentimiento si antes no lo tenía.
    update personas
       set consentimiento       = true,
           consentimiento_fecha = coalesce(consentimiento_fecha, now()),
           consentimiento_canal = coalesce(consentimiento_canal, p_consentimiento_canal)
     where id = v_persona
       and not consentimiento;
  else
    insert into personas (
      nombre_completo, telefono_e164, origen,
      consentimiento, consentimiento_fecha, consentimiento_canal,
      consentimiento_version, fuente_del_dato, creado_por
    ) values (
      btrim(p_nombre_completo), p_telefono_e164, p_origen,
      true, now(), p_consentimiento_canal,
      -- No existe todavía un texto de aviso de privacidad versionado que
      -- citar. Se marca, no se inventa una versión (CLAUDE.md secc. 2).
      '[PENDIENTE]',
      'Registro rápido del CRM · origen declarado: ' || p_origen,
      v_actor
    )
    returning id into v_persona;
  end if;

  -- ---------------------------------------------------------------
  -- 2 · OPORTUNIDAD en '01_prospecto_captado', responsable = quien registra.
  -- Si esa persona ya tiene una oportunidad activa, no se abre una segunda:
  -- dos oportunidades vivas para el mismo prospecto hacen que el embudo
  -- cuente dos veces a una sola persona.
  -- ---------------------------------------------------------------
  -- El alias `o.` NO es cosmetico. `persona_id` es tambien una columna de
  -- salida del RETURNS TABLE de arriba, asi que existe como variable dentro de
  -- esta funcion. Sin calificar, PL/pgSQL no sabe si te refieres a la columna o
  -- a la variable y aborta con «column reference "persona_id" is ambiguous».
  -- Corregido el 14/09/2026, la primera vez que la funcion se ejecuto de verdad.
  select o.id into v_oport
  from oportunidades o
  where o.persona_id = v_persona
    and o.situacion  = 'activa'
    and o.archivado_el is null
  order by o.fecha_ingreso desc
  limit 1;

  if v_oport is not null then
    v_oport_previa := true;
  else
    insert into oportunidades (persona_id, estado, situacion, responsable_id, lanzamiento)
    values (v_persona, '01_prospecto_captado', 'activa', v_actor, p_lanzamiento)
    returning id into v_oport;
    -- El historial de estados (R9) lo escribe solo el disparador
    -- t_oportunidad_historial. No se inserta a mano desde aquí.
  end if;

  -- ---------------------------------------------------------------
  -- 3 · TAREA «Primer contacto» — R6: ninguna oportunidad activa se queda
  -- sin una tarea abierta con fecha.
  -- ---------------------------------------------------------------
  select valor_entero into v_sla
  from parametros
  where id = 'sla_primera_respuesta_minutos';

  if v_sla is null then
    -- Parámetro sin cargar: la tarea vence YA. No se sustituye por el valor
    -- «sugerido» de la nota del parámetro — eso sería exactamente rellenar el
    -- vacío que prohíbe CLAUDE.md secc. 3.
    v_vence   := now();
    v_detalle := 'Vence de inmediato porque el parametro sla_primera_respuesta_minutos '
              || 'no tiene valor cargado. Cargalo (04-seed-parametros.sql) para que este '
              || 'plazo sea el real. [PENDIENTE]';
  else
    v_vence   := now() + make_interval(mins => v_sla);
    v_detalle := 'Plazo tomado de parametros(sla_primera_respuesta_minutos) = '
              || v_sla || ' min.';
  end if;

  -- Si la oportunidad ya venía con una tarea abierta, no se apila otra:
  -- duplicar recordatorios es la forma más rápida de que se dejen de mirar.
  -- Mismo caso que arriba: `oportunidad_id` tambien es columna de salida.
  select t.id into v_tarea
  from tareas t
  where t.oportunidad_id = v_oport
    and t.completada_el is null
  order by t.vence_el
  limit 1;

  if v_tarea is null then
    insert into tareas (
      titulo, detalle, oportunidad_id, persona_id,
      responsable_id, vence_el, prioridad, creado_por
    ) values (
      'Primer contacto', v_detalle, v_oport, v_persona,
      v_actor, v_vence, 1, v_actor
    )
    returning id into v_tarea;
  else
    select t.vence_el into v_vence from tareas t where t.id = v_tarea;
  end if;

  return query
    select v_persona, v_oport, v_tarea, v_vence, v_sla,
           v_persona_previa, v_oport_previa;
end $fn$;

comment on function fn_registro_rapido is
  'Alta de prospecto en una sola transaccion: persona + oportunidad 01_prospecto_captado + tarea Primer contacto (R6). SECURITY INVOKER: RLS se sigue aplicando. El plazo de la tarea sale de parametros(sla_primera_respuesta_minutos), nunca del codigo.';

revoke all on function fn_registro_rapido(text, text, text, boolean, text, text) from public, anon;
grant execute on function fn_registro_rapido(text, text, text, boolean, text, text) to authenticated;
grant execute on function origenes_admitidos() to authenticated;



-- #####################################################################
-- 07-vistas-hoy.sql ###################################################
-- #####################################################################

-- =====================================================================
-- CRM Mercado Media Luna — 07 · VISTAS DE LA PANTALLA HOY
-- Estado: 🟢 VIGENTE · 10/09/2026
--
-- Orden de ejecución: … → 04-seed-parametros → 06-registro-rapido → 07
--
-- QUÉ CAMBIA Y POR QUÉ
-- Nada de la lógica de 03-vistas.sql: ni un filtro, ni una fórmula, ni el
-- orden de las columnas que ya existían. Lo único que se hace es AÑADIR al
-- final las claves ajenas que las dos vistas ya usaban por dentro pero no
-- devolvían: `persona_id` y `oportunidad_id`.
--
-- Hacen falta porque cada fila de la pantalla Hoy lleva un botón de acción
-- directa (registrar interacción · crear tarea · abrir la ficha), y esas tres
-- acciones necesitan un id, no un nombre:
--   · interacciones.persona_id     es NOT NULL
--   · tareas.oportunidad_id        es lo que ata la tarea al embudo (R6)
--   · la ficha se abre por id de persona, nunca por nombre
-- Buscar la persona por `nombre_completo` desde el cliente sería, además de
-- lento, incorrecto: dos personas pueden llamarse igual.
--
-- `create or replace view` permite añadir columnas al final conservando las
-- anteriores. Por eso 03-vistas.sql NO se toca: sigue siendo la definición
-- original, y este archivo es el delta, con su fecha.
--
-- REGLA DE LA FUENTE DE VERDAD: aquí no entra ningún umbral de negocio. El
-- «3 días o menos» del bloque 1 NO se filtra en la vista — lo aplica la
-- pantalla, que es donde está declarado y marcado como propuesta
-- (src/lib/hoy.ts). Si mañana se ratifica otro número, no hay que migrar la
-- base.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ⚠ SEGUNDO CAMBIO: `security_invoker = true` en las dos vistas.
--
-- Una vista de PostgreSQL corre, por defecto, con los privilegios de SU DUEÑO
-- (aquí `postgres`), no con los de quien la consulta. Eso significa que una
-- vista sin `security_invoker` SORTEA el RLS de las tablas que lee. Con
-- `v_sin_siguiente_paso` eso importa de verdad: la política `oport_leer` de
-- 02-rls.sql limita a un `comercial` a las oportunidades donde
-- `responsable_id = auth.uid()`, y a través de la vista las veía TODAS.
--
-- Con `security_invoker = true` la vista evalúa RLS con el usuario que
-- consulta, que es lo que 07-crm\CLAUDE.md §5 exige. Requiere PostgreSQL 15+,
-- que es la versión declarada en 01-schema.sql.
--
-- 🟡 EFECTO A VALIDAR CON WALTER: a partir de aquí, un `comercial` ve en la
-- pantalla Hoy solo SUS oportunidades sin siguiente paso. Es el comportamiento
-- que `oport_leer` ya describía; hoy todavía hay un solo comercial, así que en
-- la práctica no cambia nada — pero conviene decidirlo antes de que entren más
-- vendedores. Las otras vistas de 03-vistas.sql siguen como estaban: revisarlas
-- es un trabajo aparte, y no se toca lo que no se está usando aún.
-- ---------------------------------------------------------------------

-- 1 · SEPARACIONES — LOS DOS RELOJES (+ ids para las acciones)
-- Copia literal de 03-vistas.sql §5, con s.persona_id y s.oportunidad_id
-- añadidos al final. Si aquella cambia, esta se vuelve a copiar entera.
create or replace view v_separaciones_vigilancia
with (security_invoker = true) as
select s.id, p.nombre_completo, u.codigo_unidad,
       s.monto, s.monto_moneda, s.estado,
       s.fecha_deposito_efectivo,
       s.fecha_limite_devolucion,
       (s.fecha_limite_devolucion - current_date) as dias_para_fin_devolucion,
       s.fecha_limite_precio,
       (s.fecha_limite_precio - current_date)     as dias_para_fin_precio,
       s.verificada_el,
       (s.verificada_el is null)                  as espera_verificacion_de_walter,
       puede_emitir_constancia(s.id)              as puede_emitir_constancia,
       -- ---- añadido el 10/09/2026 para los botones de acción de Hoy ----
       s.persona_id,
       s.oportunidad_id
from separaciones s
join personas p on p.id = s.persona_id
left join unidades u on u.id = s.unidad_id
where s.archivado_el is null
  and s.estado in ('pendiente_verificacion','verificada')
order by s.fecha_limite_devolucion nulls first;

-- 2 · LO QUE SE ESTÁ FUGANDO HOY (+ persona_id)
-- Copia literal de 03-vistas.sql §4. `id` sigue siendo el de la OPORTUNIDAD,
-- como estaba: no se renombra una columna de la que ya puede depender otra
-- consulta. `persona_id` se añade al final.
create or replace view v_sin_siguiente_paso
with (security_invoker = true) as
select o.id, p.nombre_completo, p.telefono_e164, o.estado, o.lanzamiento,
       o.fecha_ingreso,
       o.fecha_ultimo_contacto,
       extract(day from now() - coalesce(o.fecha_ultimo_contacto, o.fecha_ingreso))::int
         as dias_sin_contacto,
       -- ---- añadido el 10/09/2026 ----
       o.persona_id
from oportunidades o
join personas p on p.id = o.persona_id
where o.archivado_el is null
  and o.situacion = 'activa'
  and o.estado < '09_pago_total'
  and not exists (
    select 1 from tareas t
    where t.oportunidad_id = o.id and t.completada_el is null
  )
order by dias_sin_contacto desc;

comment on view v_separaciones_vigilancia is
  'Los dos relojes de la separacion, como campos INDEPENDIENTES (R4): devolucion desde el deposito efectivo, y vigencia del precio. Nunca se calcula uno del otro, ni aqui ni en la interfaz.';
comment on view v_sin_siguiente_paso is
  'Oportunidades activas sin ninguna tarea abierta: incumplimientos vivos de R6. Es la lista de gente que entro y a la que nadie le esta haciendo nada.';



-- #####################################################################
-- 08-vistas-embudo-e-inventario.sql ###################################
-- #####################################################################

-- =====================================================================
-- CRM Mercado Media Luna — 08 · VISTAS DE EMBUDO E INVENTARIO
-- Estado: 🟢 VIGENTE · 10/09/2026
--
-- Orden de ejecución: … → 04-seed-parametros → 06-registro-rapido
--                     → 07-vistas-hoy → 08 (este archivo)
--
-- QUÉ AÑADE Y POR QUÉ
--   1 · `v_embudo_tarjetas`   — una fila por oportunidad, con lo que lleva
--                               escrito la tarjeta del tablero /embudo.
--   2 · `v_unidades_tablero`  — una fila por unidad, con los MOTIVOS por los
--                               que no es ofrecible, para que /inventario
--                               pueda explicarlo en vez de solo apagarla.
--   3 · Una restricción nueva en `unidades` (ver §3).
--
-- NO se toca nada de 03-vistas.sql ni de 07-vistas-hoy.sql: este archivo solo
-- añade. `v_unidades_ofrecibles` sigue siendo, literalmente, la única
-- definición de «qué se puede ofrecer»; aquí se CONSULTA, no se reescribe.
--
-- REGLA DE LA FUENTE DE VERDAD: en este archivo no hay ningún precio, plazo,
-- cupo ni umbral de negocio. El «más de 3 días sin contacto» que pinta en rojo
-- una tarjeta NO se filtra aquí — se declara en src/lib/embudo.ts, marcado
-- como 🔵 propuesta, igual que se hizo con la ventana de vigilancia de Hoy.
-- La vista devuelve los días; el umbral lo pone quien mira.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1 · v_embudo_tarjetas — el tablero de los 10 estados
-- ---------------------------------------------------------------------
-- `security_invoker = true`, por el mismo motivo que en 07-vistas-hoy.sql: sin
-- eso la vista correría con los privilegios de su dueño y SORTEARÍA el RLS de
-- `oportunidades`, con lo que un `comercial` vería en el tablero las
-- oportunidades de los demás — justo lo contrario de lo que dice `oport_leer`.
--
-- 🟡 EFECTO CONOCIDO, PENDIENTE DE DECISIÓN DE DIRECCIÓN
-- `perfiles_leer_propio` (02-rls.sql) deja que cada usuario lea SOLO su propia
-- fila de `perfiles`; dirección las lee todas. Por eso `responsable_nombre`
-- llega en null para los roles `administracion`, `contabilidad` y `lectura`
-- cuando la oportunidad es de otra persona: ven la tarjeta, pero no el nombre
-- de quien la lleva. El LEFT JOIN es deliberado — con un JOIN normal esas
-- tarjetas DESAPARECERÍAN del tablero, que es mucho peor que un nombre en
-- blanco. La pantalla muestra «[sin acceso al nombre]» en vez de inventarlo.
--   Si Walter decide que el equipo debe verse los nombres entre sí, eso se
--   arregla en RLS con una política nueva sobre `perfiles`, NO relajando esta
--   vista. Mientras tanto, `comercial` y `direccion` —los dos roles que de
--   verdad trabajan el embudo— lo ven completo.
create or replace view v_embudo_tarjetas
with (security_invoker = true) as
select o.id,
       o.persona_id,
       p.nombre_completo,
       p.telefono_e164,
       p.origen,
       o.estado,
       o.situacion,
       o.lanzamiento,
       o.responsable_id,
       r.nombre                                as responsable_nombre,
       o.fecha_ingreso,
       o.fecha_ultimo_contacto,
       -- Misma fórmula, carácter por carácter, que `v_sin_siguiente_paso`
       -- (03-vistas.sql §4). Dos pantallas que dicen «días sin contacto» tienen
       -- que contar los días igual, o una de las dos miente.
       extract(day from now() - coalesce(o.fecha_ultimo_contacto, o.fecha_ingreso))::int
                                               as dias_sin_contacto,
       -- R5 hecho dato: si esto es falso, la base RECHAZARÁ el paso al estado
       -- 06 y siguientes. La pantalla lo usa para avisar ANTES de intentarlo;
       -- quien lo impide de verdad sigue siendo la restricción
       -- `calificado_requiere_las_4_respuestas` de 01-schema.sql.
       (o.cal_operar_o_invertir is not null
        and o.cal_compro_antes  is not null
        and o.cal_forma_pago    is not null
        and o.cal_decide_solo   is not null)   as cualificacion_completa,
       -- R6: toda oportunidad activa debe tener una tarea abierta con fecha.
       exists (select 1 from tareas t
                where t.oportunidad_id = o.id
                  and t.completada_el is null) as tiene_tarea_abierta
from oportunidades o
join personas p      on p.id = o.persona_id
left join perfiles r on r.id = o.responsable_id
where o.archivado_el is null;

comment on view v_embudo_tarjetas is
  'Una fila por oportunidad no archivada, con lo que lleva escrito la tarjeta del tablero /embudo. No filtra por situacion ni por dias sin contacto: eso lo decide la pantalla. security_invoker=true, asi que un comercial solo ve las suyas (politica oport_leer).';


-- ---------------------------------------------------------------------
-- 2 · v_unidades_tablero — el inventario, con el MOTIVO del bloqueo
-- ---------------------------------------------------------------------
-- `v_unidades_ofrecibles` responde sí o no. La pantalla necesita además el
-- POR QUÉ, porque una unidad apagada sin explicación se interpreta como un
-- fallo del sistema y acaba en «pregúntale a Walter» — que es exactamente el
-- cuello de botella que el CRM viene a quitar.
--
-- `ofrecible` NO se recalcula aquí: se pregunta a la vista original. Si mañana
-- cambia la definición de «ofrecible», esta columna cambia sola. Las cuatro
-- columnas de motivo son EXPLICACIÓN, no definición; si alguna vez discreparan,
-- manda `ofrecible`.
--
-- ⚠ ESTA VISTA NO LLEVA `security_invoker`, Y ES A PROPÓSITO.
-- Es lo contrario del caso de arriba, y el motivo es R1 (doble asignación):
-- `oport_leer` esconde a un `comercial` las oportunidades de otro comercial.
-- Si esta vista evaluara RLS con el usuario que consulta, el
-- `exists (... oportunidades ...)` daría FALSO para la asignación activa de un
-- compañero, la unidad aparecería libre y la pantalla la ofrecería para
-- asignar — el peor riesgo del proyecto, servido por una vista «más segura».
-- Por eso corre con los privilegios del dueño y devuelve BOOLEANOS: dice «esta
-- unidad ya está tomada», nunca por quién ni de quién. Ningún dato personal
-- ni comercial ajeno sale de aquí, y sobre `unidades` no amplía nada, porque
-- `unidades_leer` ya es `using (true)` para todo usuario autenticado.
create or replace view v_unidades_tablero as
select u.id,
       u.codigo_unidad,
       u.tipo,
       u.area_m2,
       u.etapa,
       u.bloque,
       u.ubicacion,
       u.estado_comercial,
       u.estado_dato,
       u.fuente_plano,
       u.precio_parametro,
       u.tipo_socio,
       u.estado_legal,
       u.observaciones,
       u.actualizado_el,

       -- LA respuesta. Delegada, no copiada.
       exists (select 1 from v_unidades_ofrecibles v where v.id = u.id)
         as ofrecible,

       -- Los motivos, uno por condición de `v_unidades_ofrecibles`.
       (u.estado_dato = 'verde')                as verificada_contra_plano,
       (u.estado_comercial = 'disponible')      as disponible_comercialmente,
       exists (select 1 from oportunidades o
                where o.unidad_asignada_id = u.id
                  and o.situacion = 'activa'
                  and o.archivado_el is null)   as tiene_asignacion_activa,
       exists (select 1 from separaciones s
                where s.unidad_id = u.id
                  and s.estado in ('pendiente_verificacion','verificada')
                  and s.archivado_el is null)   as tiene_separacion_viva
from unidades u
where u.archivado_el is null;

comment on view v_unidades_tablero is
  'Inventario para la pantalla /inventario. `ofrecible` se consulta a v_unidades_ofrecibles, no se recalcula. Las demas banderas solo EXPLICAN el bloqueo. Sin security_invoker a proposito: una asignacion activa de otro comercial tiene que bloquear la unidad aunque RLS esconda esa oportunidad (R1).';


-- ---------------------------------------------------------------------
-- 3 · Una unidad no puede declararse verificada sin decir contra qué plano
-- ---------------------------------------------------------------------
-- `estado_dato = 'verde'` significa, según el comentario de la propia columna
-- en 01-schema.sql, «verificada contra un plano vigente». Sin `fuente_plano`
-- esa afirmación no es verificable por nadie — es precisamente el hueco
-- rellenado que prohíbe CLAUDE.md §2, y el que produjo las 4 cifras en
-- conflicto que hoy documenta 00-fuente-de-verdad\inventario-maestro.md.
--
-- Va como restricción y no como validación de formulario porque un formulario
-- se esquiva (una importación de CSV, el panel de Supabase, otra pantalla) y
-- una restricción no. La tabla nace vacía, así que no hay filas que migrar.
--
-- 🟡 POR VALIDAR CON DIRECCIÓN. Si se decide otra cosa, se quita en una línea:
--   alter table unidades drop constraint verde_exige_plano;
alter table unidades
  add constraint verde_exige_plano
  check (estado_dato <> 'verde' or fuente_plano is not null)
  not valid;
-- `not valid` = no revalida lo ya existente (hoy: nada) pero sí obliga a todo
-- lo que entre a partir de ahora. Para exigirlo también hacia atrás, el día que
-- haya datos: alter table unidades validate constraint verde_exige_plano;


-- ---------------------------------------------------------------------
-- 4 · Permisos de las dos vistas nuevas
-- ---------------------------------------------------------------------
-- 02-rls.sql §0 dejó fuera al rol `anon`: este CRM no tiene páginas públicas.
-- Se repite explícitamente para lo que se crea aquí, en vez de confiar en los
-- privilegios por defecto del proyecto.
revoke all on v_embudo_tarjetas, v_unidades_tablero from anon;
grant select on v_embudo_tarjetas, v_unidades_tablero to authenticated;



-- #####################################################################
-- 09-separaciones-storage.sql #########################################
-- #####################################################################

-- =====================================================================
-- CRM Mercado Media Luna — 09 · STORAGE DE COMPROBANTES
-- Estado: 🟢 VIGENTE · 10/09/2026
--
-- Orden de ejecución: … → 07-vistas-hoy → 08-vistas-embudo-e-inventario
--                     → 09 (este archivo)
--
-- QUÉ AÑADE
--   1 · El bucket `comprobantes`, PRIVADO, donde se sube el voucher del
--       depósito de cada separación.
--   2 · Sus políticas de RLS sobre `storage.objects`.
--   3 · Un permiso explícito de lectura sobre `v_unidades_ofrecibles`, que la
--       pantalla de separaciones consulta directamente para el selector de
--       unidad.
--
-- Este archivo NO crea ninguna tabla ni toca `separaciones`: la columna
-- `comprobante_url` ya existe desde 01-schema.sql. Aquí solo se crea el sitio
-- donde vive el archivo y quién puede tocarlo.
--
-- REGLA DE LA FUENTE DE VERDAD: aquí no hay ningún precio, plazo ni monto. El
-- monto de la separación y los dos plazos siguen viviendo en `parametros`,
-- en 🔴 rojo, y la interfaz los muestra como «[PENDIENTE — ver
-- 00-fuente-de-verdad]» mientras sigan así.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1 · El bucket
-- ---------------------------------------------------------------------
-- PRIVADO (`public = false`), y no es negociable: un comprobante de depósito
-- lleva el nombre del titular, el banco y el número de operación. Un bucket
-- público en Supabase sirve los archivos a cualquiera que tenga la URL, sin
-- sesión y sin RLS. Los datos personales de terceros exigen el mínimo
-- necesario y consentimiento registrado
-- (01-documentacion\05-SEGURIDAD-BACKUPS-Y-LEY-29733.md).
--
-- Como es privado, la interfaz NO puede guardar una URL pública: guarda la
-- RUTA del objeto en `separaciones.comprobante_url` y pide una URL firmada,
-- que caduca, cada vez que alguien quiere ver el archivo.
--
-- El límite de tamaño y los tipos admitidos son decisiones de infraestructura,
-- no cifras del negocio: acotan lo que puede entrar por el formulario (una
-- foto del voucher o un PDF del banco), no lo que vale una separación.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comprobantes',
  'comprobantes',
  false,
  10485760,  -- 10 MB: una foto de voucher desde un celular cabe de sobra
  array['image/jpeg','image/png','image/webp','image/heic','application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ---------------------------------------------------------------------
-- 2 · Políticas
-- ---------------------------------------------------------------------
-- `storage.objects` ya tiene RLS activado por Supabase. Sin políticas, nadie
-- entra — que es el punto de partida correcto.
--
-- Se declaran con `drop policy if exists` delante para que este archivo se
-- pueda volver a ejecutar sin dejar un error a medias.

drop policy if exists comprobantes_leer on storage.objects;
drop policy if exists comprobantes_subir on storage.objects;

-- LEER: todo el equipo autenticado. Es coherente con `sep_leer` de
-- 02-rls.sql, que deja leer las separaciones a los cinco roles: si se puede
-- ver el monto y el número de operación en la ficha, esconder la foto del
-- voucher no protegería nada — solo obligaría a mandarla por WhatsApp, que es
-- exactamente lo que este bucket viene a evitar.
create policy comprobantes_leer on storage.objects
  for select to authenticated
  using (bucket_id = 'comprobantes');

-- SUBIR: los mismos tres roles que pueden crear una separación (`sep_crear`).
-- `contabilidad` y `lectura` no suben nada.
create policy comprobantes_subir on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'comprobantes'
    and public.es(array['direccion','comercial','administracion']::public.rol_usuario[])
  );

-- NO HAY POLÍTICA DE UPDATE NI DE DELETE, Y ES A PROPÓSITO.
-- R8: nada se borra. Un comprobante es la prueba de que entró un dinero; que
-- se pueda reemplazar o borrar desde el navegador convertiría esa prueba en
-- una opinión. Si hay que retirar un archivo (se subió el que no era, un dato
-- personal que no correspondía), se hace desde el panel de Supabase, deja
-- rastro, y lo hace una persona a propósito — no un clic accidental.
--
-- Consecuencia conocida y aceptada: si la subida sale bien y el `insert` de la
-- separación falla después, el archivo queda huérfano en el bucket. Es el lado
-- correcto del error — un archivo de más no rompe nada; una separación
-- guardada sin su comprobante sí. Los huérfanos se limpian desde el panel.


-- ---------------------------------------------------------------------
-- 3 · Lectura explícita de v_unidades_ofrecibles
-- ---------------------------------------------------------------------
-- El selector de unidad del formulario de separación consulta ESTA vista y no
-- la tabla `unidades`: es la única definición de «qué se puede ofrecer»
-- (03-vistas.sql §7, Acta 03-O02). Se repiten aquí los permisos en vez de
-- confiar en los privilegios por defecto del proyecto, igual que se hizo con
-- las vistas de 08. No amplía nada: `unidades_leer` ya es `using (true)` para
-- todo usuario autenticado.
revoke all on v_unidades_ofrecibles from anon;
grant select on v_unidades_ofrecibles to authenticated;


-- ---------------------------------------------------------------------
-- 4 · Recordatorio de lo que sigue 🔴 BLOQUEANTE
-- ---------------------------------------------------------------------
-- Mientras `plazo_devolucion_separacion_dias` no tenga `valor_entero`, el
-- disparador `fn_calcular_limite_devolucion` LANZA UNA EXCEPCIÓN al registrar
-- cualquier separación con fecha de depósito efectivo. No es un fallo: es la
-- regla R4 impidiendo que se guarde un derecho de devolución sin plazo.
--
-- La pantalla avisa de esto ANTES de dejar enviar el formulario, y si aun así
-- ocurre, muestra el mensaje de la base tal cual — porque ese mensaje dice
-- exactamente qué parámetro falta.
--
-- Para comprobar qué falta por cargar:
--   select id, descripcion, estado_semaforo, fuente
--   from parametros where estado_semaforo <> 'verde' order by id;



-- #####################################################################
-- 10-migraciones.sql ##################################################
-- #####################################################################

-- =====================================================================
-- CRM Mercado Media Luna — 10 · CONTROL DE MIGRACIONES
-- Estado: 🟢 VIGENTE · 14/09/2026
--
-- Orden de ejecución: … → 08-vistas-embudo-e-inventario → 09-separaciones-storage
--                     → 10 (este archivo, el último)
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

  -- Cuándo se ejecutó. Puede quedar NULO: si esta tabla se crea sobre una base
  -- que ya tenía scripts aplicados de antes, su fecha original no existe en
  -- ningún sitio e inventarla sería peor que admitir el hueco — la regla de
  -- 07-crm\CLAUDE.md §2 aplicada a los propios metadatos. En una instalación
  -- limpia, en cambio, todos se aplican a la vez y la fecha sí se conoce.
  aplicado_el    timestamptz,

  -- Cuándo se comprobó contra la base que su efecto está presente.
  verificado_el  timestamptz not null default now(),

  nota           text
);

comment on table migraciones_aplicadas is
  'Que scripts de sql\ se han ejecutado contra ESTA base. aplicado_el puede ser nulo si la tabla se creo sobre una base que ya tenia scripts de antes. 05-pruebas-reglas.sql no figura: es una bateria de pruebas, no una migracion.';

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
-- Los nueve scripts que componen una instalación completa
--
-- `now()` es correcto porque este archivo es el ÚLTIMO de la secuencia: si se
-- está ejecutando, los ocho anteriores acaban de correr en esta misma sesión.
-- Si lo ejecutas suelto sobre una base que ya venía montada de antes, cambia
-- los `now()` por `null` en los que no puedas fechar honestamente.
-- ---------------------------------------------------------------------
insert into migraciones_aplicadas (archivo, aplicado_el, nota) values
  ('01-schema.sql',                     now(), '15 tablas, tipos y restricciones base'),
  ('02-rls.sql',                        now(), 'politicas RLS, mi_rol(), es(), disparador t_nuevo_usuario'),
  ('03-vistas.sql',                     now(), '13 vistas de reportes'),
  ('04-seed-parametros.sql',            now(), '16 parametros con su fuente y su semaforo'),
  ('06-registro-rapido.sql',            now(), 'fn_registro_rapido() y origenes_admitidos()'),
  ('07-vistas-hoy.sql',                 now(), 'persona_id y oportunidad_id + security_invoker en las 2 vistas de Hoy'),
  ('08-vistas-embudo-e-inventario.sql', now(), 'v_embudo_tarjetas, v_unidades_tablero, constraint verde_exige_plano'),
  ('09-separaciones-storage.sql',       now(), 'bucket comprobantes y sus 2 politicas')
on conflict (archivo) do nothing;

insert into migraciones_aplicadas (archivo, aplicado_el, nota) values
  ('10-migraciones.sql', now(), 'esta misma tabla')
on conflict (archivo) do nothing;



-- #####################################################################
-- 11-privilegios.sql ##################################################
-- #####################################################################

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



-- #####################################################################
-- 12-captacion.sql ####################################################
-- #####################################################################

-- =====================================================================
-- CRM Mercado Media Luna — 12 · CAPTACIÓN EXTERNA
-- Estado: 🟢 VIGENTE · 14/09/2026
--
-- Orden de ejecución: … → 10-migraciones → 11-privilegios → 12
--
-- QUÉ ABRE ESTE ARCHIVO
-- Una puerta para que un prospecto entre al CRM SIN que haya nadie con sesión
-- iniciada: una landing, un formulario de Meta, un bot de WhatsApp. Hasta hoy
-- la única entrada era `fn_registro_rapido`, y esa no sirve para esto — es
-- SECURITY INVOKER y lo primero que hace es exigir `auth.uid()`:
--
--     if v_actor is null then
--       raise exception 'No hay sesión activa. Vuelve a entrar al CRM.';
--
-- Es correcto que lo exija: esa función la usa Rosa en un live, y saber QUIÉN
-- registró cada ficha importa. Para la entrada externa la pregunta no es quién,
-- sino DESDE DÓNDE. Por eso son dos funciones y no una con un parámetro.
--
-- ⚠ ESTA ES LA ÚNICA COSA QUE `anon` PUEDE HACER EN TODA LA BASE
-- 02-rls.sql §0 dejó al rol anónimo sin una sola tabla, y 11-privilegios.sql lo
-- volvió a revocar después de conceder. Aquí se le da EXECUTE sobre una función
-- y nada más. Esa función solo INSERTA; no devuelve ni una fila de datos
-- existentes, ni siquiera para decir «este teléfono ya estaba». Un formulario
-- público que confirmara eso sería un enumerador de clientes gratis para la
-- competencia.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1 · Todo lo que entra queda registrado, se procese o no
-- ---------------------------------------------------------------------
-- Un webhook que falla en silencio es un lead pagado que se pierde sin rastro.
-- Aquí cae TODO: lo bueno, lo rechazado y lo que reventó. `carga` guarda el
-- cuerpo tal como llegó, así que si mañana cambia el formato de Meta se puede
-- reprocesar lo viejo en vez de haberlo tirado.
create table if not exists captacion_bruta (
  id             uuid primary key default gen_random_uuid(),
  recibido_el    timestamptz not null default now(),
  fuente_sistema text not null,          -- 'landing' | 'meta_lead_ads' | 'whatsapp_flow'
  telefono_e164  text,                   -- desnormalizado a propósito: se consulta mucho
  carga          jsonb not null default '{}'::jsonb,
  resultado      text not null,          -- 'creada' | 'reutilizada' | 'rechazada' | 'error'
  motivo         text,
  persona_id     uuid references personas(id)
);

create index if not exists captacion_bruta_telefono
  on captacion_bruta (telefono_e164, recibido_el desc);
create index if not exists captacion_bruta_recibido
  on captacion_bruta (recibido_el desc);

comment on table captacion_bruta is
  'Bitacora de todo lo que entra por captacion externa, incluidos los rechazos. Sirve para auditar el gasto en anuncios contra los leads que llegaron de verdad, y para reprocesar si cambia el formato del origen.';

alter table captacion_bruta enable row level security;

drop policy if exists captacion_leer on captacion_bruta;
create policy captacion_leer on captacion_bruta
  for select to authenticated
  using (es(array['direccion','administracion']::rol_usuario[]));
-- Nadie escribe desde el cliente: solo la funcion de abajo, que es
-- SECURITY DEFINER. No hay politica de insert a proposito.

revoke all on captacion_bruta from anon;


-- ---------------------------------------------------------------------
-- 2 · Los dos parámetros que esto necesita
-- ---------------------------------------------------------------------
insert into parametros (id, descripcion, fuente, estado_semaforo, unidad, nota) values
('aviso_privacidad_version',
 'Version del aviso de privacidad que acepta quien deja sus datos en la landing',
 'PENDIENTE — no existe todavia el texto del aviso',
 'rojo', 'texto',
 '🔴 BLOQUEANTE. La Ley 29733 exige informar ANTES de recoger el dato, y poder demostrar que version acepto cada persona. Mientras esto siga vacio, fn_captar_prospecto rechaza todo. Es deliberado: capturar cientos de leads con la version en [PENDIENTE] convierte una deuda pequena en exposicion legal. Cargar con algo como v1.0-2026-09 y la ruta del documento en fuente.'),

('responsable_captacion_por_defecto',
 'Perfil al que se asigna la tarea de primer contacto de un lead que entra solo',
 'PROPUESTA — pendiente de acordar con Direccion',
 'azul', 'uuid_perfil',
 '🔵 PROPUESTA. Guardar en valor_texto el id de perfiles de quien atiende los leads nuevos (hoy seria Rosa, administracion). Si se deja vacio, la tarea recae en Direccion y el detalle de la tarea lo dice — nunca se pierde un lead por un parametro sin cargar, pero se nota.')
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- 3 · La función de entrada
-- ---------------------------------------------------------------------
-- SECURITY DEFINER porque no hay sesión: corre con los privilegios del dueño.
-- `set search_path = public` no es decorativo — sin eso, un search_path
-- manipulado puede desviar las llamadas a tablas falsas, que es la forma
-- clásica de escalar privilegios con una funcion DEFINER.
--
-- NO lanza excepciones para validar. Devuelve jsonb. El motivo es que una
-- excepcion revierte la transaccion entera, y con ella el apunte en
-- `captacion_bruta` — perderiamos justo el registro del rechazo, que es el que
-- dice si alguien esta abusando del formulario.
create or replace function fn_captar_prospecto(
  p_nombre_completo text,
  p_telefono_e164   text,               -- ya en E.164; la landing normaliza
  p_origen          text,
  p_consentimiento  boolean,
  p_carga           jsonb default '{}'::jsonb,
  p_fuente_sistema  text  default 'landing'
) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_nombre    text := btrim(coalesce(p_nombre_completo, ''));
  v_tel       text := btrim(coalesce(p_telefono_e164, ''));
  v_origen    text := btrim(coalesce(p_origen, ''));
  v_aviso     text;
  v_resp      uuid;
  v_persona   uuid;
  v_oport     uuid;
  v_previa    boolean := false;
  v_motivo    text;
  v_detalle   text;
begin
  -- ---- Validaciones. Cada rechazo se apunta y se devuelve, no se lanza ----
  if v_nombre = '' then
    v_motivo := 'nombre vacio';
  elsif v_tel !~ '^\+\d{8,15}$' then
    v_motivo := 'telefono no esta en formato E.164';
  elsif not (v_origen = any(origenes_admitidos())) then
    v_motivo := 'origen no admitido';
  elsif not coalesce(p_consentimiento, false) then
    -- Ley 29733: sin consentimiento no se guarda el dato personal. Ni una fila.
    v_motivo := 'sin consentimiento';
  end if;

  -- El aviso de privacidad tiene que existir y estar confirmado.
  if v_motivo is null then
    select valor_texto into v_aviso
    from parametros
    where id = 'aviso_privacidad_version' and estado_semaforo = 'verde';

    if v_aviso is null or btrim(v_aviso) = '' then
      v_motivo := 'aviso de privacidad sin version cargada (parametro aviso_privacidad_version)';
    end if;
  end if;

  -- Freno de abuso: el mismo numero, dos veces en menos de 30 segundos, es un
  -- doble clic o un bot. No es seguridad de verdad —eso va delante, en la
  -- landing— pero evita duplicar una ficha por un boton pulsado dos veces.
  if v_motivo is null and exists (
    select 1 from captacion_bruta
    where telefono_e164 = v_tel
      and recibido_el > now() - interval '30 seconds'
  ) then
    v_motivo := 'repetido en menos de 30 segundos';
  end if;

  if v_motivo is not null then
    insert into captacion_bruta (fuente_sistema, telefono_e164, carga, resultado, motivo)
    values (p_fuente_sistema, nullif(v_tel, ''), coalesce(p_carga, '{}'::jsonb), 'rechazada', v_motivo);
    return jsonb_build_object('ok', false, 'motivo', v_motivo);
  end if;

  -- ---- Cerrojo por telefono ----
  -- `personas.telefono_e164` NO tiene indice unico (01-schema.sql): la
  -- deduplicacion es por consulta. Con trafico de anuncios, dos envios a la vez
  -- del mismo numero crearian dos fichas. Este cerrojo los serializa y se
  -- suelta solo al terminar la transaccion.
  perform pg_advisory_xact_lock(hashtext(v_tel));

  -- ---- Quien atiende ----
  select id into v_resp from perfiles
  where id::text = (select valor_texto from parametros
                    where id = 'responsable_captacion_por_defecto')
    and activo;

  if v_resp is null then
    -- Sin parametro cargado no se pierde el lead: cae en Direccion y la tarea
    -- lo explica. Un lead perdido cuesta mas que una tarea mal dirigida.
    select id into v_resp from perfiles
    where rol = 'direccion' and activo order by creado_el limit 1;
    v_detalle := 'Lead entrado por ' || p_fuente_sistema || '. Asignado a Direccion porque '
              || 'el parametro responsable_captacion_por_defecto esta sin cargar. [PENDIENTE]';
  else
    v_detalle := 'Lead entrado por ' || p_fuente_sistema || '.';
  end if;

  if v_resp is null then
    insert into captacion_bruta (fuente_sistema, telefono_e164, carga, resultado, motivo)
    values (p_fuente_sistema, v_tel, coalesce(p_carga, '{}'::jsonb), 'error',
            'no hay ningun perfil activo al que asignar la tarea');
    return jsonb_build_object('ok', false, 'motivo', 'configuracion incompleta');
  end if;

  -- ---- 1 · Persona (se reutiliza por telefono, igual que el registro rapido) ----
  select id into v_persona from personas
  where telefono_e164 = v_tel and archivado_el is null
  order by creado_el limit 1;

  if v_persona is not null then
    v_previa := true;
    -- No se pisa el nombre ni el origen de una ficha que ya existia. Solo se
    -- deja constancia del consentimiento si antes no lo tenia.
    update personas
       set consentimiento        = true,
           consentimiento_fecha  = coalesce(consentimiento_fecha, now()),
           consentimiento_canal  = coalesce(consentimiento_canal, p_fuente_sistema),
           consentimiento_version = coalesce(consentimiento_version, v_aviso)
     where id = v_persona and not consentimiento;
  else
    insert into personas (
      nombre_completo, telefono_e164, origen,
      consentimiento, consentimiento_fecha, consentimiento_canal, consentimiento_version,
      fuente_del_dato, creado_por
    ) values (
      v_nombre, v_tel, v_origen,
      true, now(), p_fuente_sistema, v_aviso,
      'Captacion externa · ' || p_fuente_sistema || ' · origen declarado: ' || v_origen,
      null   -- nadie con sesion lo creo, y eso se ve: creado_por nulo = entro solo
    )
    returning id into v_persona;
  end if;

  -- ---- 2 · Oportunidad, si no tiene ya una viva ----
  select id into v_oport from oportunidades
  where persona_id = v_persona and situacion = 'activa' and archivado_el is null
  order by fecha_ingreso desc limit 1;

  if v_oport is null then
    -- `responsable_id` se deja NULO: todavia no hay comercial asignado, y decir
    -- lo contrario falsearia el embudo. Quien la reclame la tomara.
    insert into oportunidades (persona_id, estado, situacion, responsable_id)
    values (v_persona, '01_prospecto_captado', 'activa', null)
    returning id into v_oport;
  end if;

  -- ---- 3 · Tarea de primer contacto (R6) ----
  -- Vence YA, a proposito: un lead que acaba de dejar su numero esperando que
  -- le escriban es lo mas urgente que hay en el CRM. El plazo del SLA
  -- (sla_primera_respuesta_minutos) sigue sin cargar, y aqui no se inventa.
  if not exists (select 1 from tareas
                 where oportunidad_id = v_oport and completada_el is null) then
    insert into tareas (titulo, detalle, oportunidad_id, persona_id,
                        responsable_id, vence_el, prioridad, creado_por)
    values ('Primer contacto', v_detalle, v_oport, v_persona,
            v_resp, now(), 1, null);
  end if;

  insert into captacion_bruta (fuente_sistema, telefono_e164, carga, resultado, persona_id)
  values (p_fuente_sistema, v_tel, coalesce(p_carga, '{}'::jsonb),
          case when v_previa then 'reutilizada' else 'creada' end, v_persona);

  -- Se devuelve lo minimo. Ni el id de la persona, ni si ya existia: esto lo
  -- llama un navegador cualquiera desde internet.
  return jsonb_build_object('ok', true);

exception when others then
  -- Ni un lead se pierde sin dejar rastro, pase lo que pase.
  insert into captacion_bruta (fuente_sistema, telefono_e164, carga, resultado, motivo)
  values (p_fuente_sistema, nullif(v_tel, ''), coalesce(p_carga, '{}'::jsonb), 'error', sqlerrm);
  return jsonb_build_object('ok', false, 'motivo', 'error interno');
end $fn$;

comment on function fn_captar_prospecto is
  'Entrada de un prospecto SIN sesion iniciada (landing, Meta, bot). Crea persona + oportunidad + tarea en una transaccion, deduplicando por telefono con cerrojo. Exige consentimiento y una version de aviso de privacidad en verde. Devuelve solo ok/motivo: no filtra si el telefono ya existia.';

-- ---------------------------------------------------------------------
-- 4 · Permisos
-- ---------------------------------------------------------------------
-- La excepcion consciente a «anon no toca nada». Solo esta funcion, que solo
-- escribe. Ver el encabezado.
grant execute on function fn_captar_prospecto(text, text, text, boolean, jsonb, text)
  to anon, authenticated;

insert into migraciones_aplicadas (archivo, aplicado_el, nota) values
  ('12-captacion.sql', now(), 'captacion_bruta + fn_captar_prospecto: entrada de leads sin sesion')
on conflict (archivo) do nothing;



-- #####################################################################
-- 13-seguimiento-comercial.sql ########################################
-- #####################################################################

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



-- #####################################################################
-- 14-inventario-grafico.sql ###########################################
-- #####################################################################

-- =====================================================================
-- CRM Mercado Media Luna — 14 · INVENTARIO GRÁFICO
-- Estado: 🟢 VIGENTE · 29/09/2026
--
-- Orden de ejecución: … → 12-captacion → 13-seguimiento-comercial → 14
--
-- QUÉ AÑADE
-- Las cuatro columnas que necesita el plano interactivo de /inventario, y las
-- mismas cuatro al final de v_unidades_tablero. Nada más: ni una unidad, ni un
-- titular, ni una cifra. Las 485 filas se cargan aparte (ver abajo).
--
-- POR QUÉ AHORA
-- `unidades` nació vacía el 08/09/2026 porque no había plano vigente
-- (01-schema.sql §2). El plano llegó el 21/09/2026 y
-- 00-fuente-de-verdad\inventario-maestro.md pasó a 🟢 con 485 unidades. El
-- 29/09/2026 Patriccio entregó además el «inventario gráfico»
-- (02-marketing\diseño\inventario grafico): un polígono por unidad trazado
-- sobre el plano de zonificación, el rubro de cada zona y la disponibilidad
-- de Libres.xlsx. Este archivo le hace sitio en la base.
--
-- LA CARGA DE DATOS NO VIVE AQUÍ, Y ES A PROPÓSITO
-- Los titulares de las unidades son personas reales con DNI y teléfono: esos
-- datos NO se escriben en un archivo del repositorio (Ley 29733; 07-crm/CLAUDE.md
-- §5). La carga se genera con un script que lee las fuentes locales y se
-- ejecuta una sola vez contra la base, después de pasar las pruebas de RLS.
--
-- REGLA DE LA FUENTE DE VERDAD
-- Aquí no hay ningún número de negocio. `geometria` son coordenadas de dibujo
-- (píxeles de una imagen), no metros ni áreas: el área de cada unidad sigue
-- siendo `area_m2`, tomada del cuadro de áreas del plano.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1 · Columnas nuevas en `unidades` (todas admiten NULL)
-- ---------------------------------------------------------------------

-- El polígono de la unidad en el plano de zonificación: un arreglo de puntos
-- [x, y] en el espacio de 1050 × 2048 que usa el visor (public/plano/
-- zonificacion.webp dibujada a ese tamaño). NULL = la unidad existe en el
-- cuadro de áreas pero no tiene una ubicación inequívoca en el dibujo: el
-- visor la lista aparte, «sin ubicación en plano», en vez de inventársela.
alter table unidades add column if not exists geometria jsonb;

-- El rubro de la zona en la que cae la unidad, tal como lo rotula el plano de
-- zonificación («Pollo/Carne/Pescado», «Frutas/Verduras», «Tiendas»…). Es
-- texto libre y no una lista cerrada porque el plano mezcla rótulos
-- («Abarrotes/Bazar/Ropa», «Abarrotes/Librería/Accesorios/Bazar/Ropa/Piñatería»)
-- y normalizarlos aquí sería decidir por el plano.
alter table unidades add column if not exists zona_rubro text;

-- Lo que alguien tiene que revisar antes de fiarse de esta fila: dos fuentes
-- que no coinciden, un titular que el kardex nombra distinto en dos hojas, un
-- área que difiere entre el plano y el kardex. Un aviso que se ve, no una
-- corrección silenciosa (07-crm/CLAUDE.md §6).
alter table unidades add column if not exists revisar text;

-- De dónde sale el `estado_comercial` de esta fila, con su fecha. «disponible»
-- sin decir según quién es exactamente cómo se llegó a tres cifras de libres
-- que no cuadran (inventario-maestro.md §4).
alter table unidades add column if not exists fuente_disponibilidad text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'unidades_geometria_valida') then
    alter table unidades add constraint unidades_geometria_valida
      check (geometria is null or jsonb_typeof(geometria) = 'array');
  end if;
end $$;

comment on column unidades.geometria is
  'Poligono de la unidad en el plano de zonificacion: arreglo de [x, y] en el espacio 1050 x 2048 del visor. NULL = sin ubicacion inequivoca en el dibujo. Coordenadas de dibujo, no metros.';
comment on column unidades.revisar is
  'Aviso de revision: fuentes que no coinciden (plano vs kardex, titulares distintos). Se muestra, no se corrige en silencio.';
comment on column unidades.fuente_disponibilidad is
  'Origen y fecha del estado_comercial de la fila (p. ej. Libres.xlsx, lista de secretaria).';


-- ---------------------------------------------------------------------
-- 2 · v_unidades_tablero — las mismas columnas, AL FINAL
-- ---------------------------------------------------------------------
-- `create or replace view` solo admite añadir columnas detrás de las que ya
-- había (07-vistas-hoy.sql lo explica): las 20 de 08-vistas-embudo-e-
-- inventario.sql quedan idénticas y en el mismo orden, y src/lib/inventario.ts
-- sigue leyéndolas igual.
--
-- Sigue SIN security_invoker, por el mismo motivo de 08 (R1): la asignación
-- activa de otro comercial tiene que bloquear la unidad aunque RLS le esconda
-- esa oportunidad a quien mira. Las cuatro columnas nuevas no son datos
-- personales: el nombre del titular NO entra en esta vista; la pantalla lo pide
-- aparte a `personas`, donde lo filtra RLS.
create or replace view v_unidades_tablero as
select u.id,
       u.codigo_unidad,
       u.tipo,
       u.area_m2,
       u.etapa,
       u.bloque,
       u.ubicacion,
       u.estado_comercial,
       u.estado_dato,
       u.fuente_plano,
       u.precio_parametro,
       u.tipo_socio,
       u.estado_legal,
       u.observaciones,
       u.actualizado_el,
       exists (select 1 from v_unidades_ofrecibles v where v.id = u.id)
         as ofrecible,
       (u.estado_dato = 'verde')                as verificada_contra_plano,
       (u.estado_comercial = 'disponible')      as disponible_comercialmente,
       exists (select 1 from oportunidades o
                where o.unidad_asignada_id = u.id
                  and o.situacion = 'activa'
                  and o.archivado_el is null)   as tiene_asignacion_activa,
       exists (select 1 from separaciones s
                where s.unidad_id = u.id
                  and s.estado in ('pendiente_verificacion','verificada')
                  and s.archivado_el is null)   as tiene_separacion_viva,
       -- 14 · inventario gráfico
       u.geometria,
       u.zona_rubro,
       u.revisar,
       u.fuente_disponibilidad
from unidades u
where u.archivado_el is null;

comment on view v_unidades_tablero is
  'Inventario para la pantalla /inventario. `ofrecible` se consulta a v_unidades_ofrecibles, no se recalcula. Las demas banderas solo EXPLICAN el bloqueo. Sin security_invoker a proposito (R1). Desde 14: geometria, zona_rubro, revisar y fuente_disponibilidad al final, para el plano interactivo; sin datos personales.';

revoke all on v_unidades_tablero from anon;
grant select on v_unidades_tablero to authenticated;


-- ---------------------------------------------------------------------
-- 3 · El parámetro que dice de cuándo es la disponibilidad
-- ---------------------------------------------------------------------
-- Nace vacío y en rojo, como todos. Lo llena la carga del inventario con el
-- corte real de Libres.xlsx y la conciliación contra el plano marcado; la
-- pantalla lo muestra tal cual en el aviso de /inventario.
insert into parametros (id, descripcion, fuente, estado_semaforo, unidad, nota) values
('inventario_disponibilidad_corte',
 'De qué lista y de qué fecha sale la disponibilidad que muestra el inventario',
 'D:\SCPCMO\00-fuente-de-verdad\inventario-maestro.md §4',
 'rojo', 'texto',
 '🔴 Sin cargar. Se llena con la fuente y la fecha de corte de la disponibilidad al importar el inventario.')
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- 4 · fn_importar_inventario — la carga inicial, hecha por quien responde
-- ---------------------------------------------------------------------
-- La carga de las 485 unidades y sus titulares la hace Dirección o
-- Administración desde /inventario («Cargar el inventario del plano»): el
-- navegador lee los dos archivos locales (el CSV del cuadro de áreas y el
-- seed.json del inventario gráfico), los cruza con las reglas de
-- src/lib/importar-inventario.ts, enseña la vista previa y llama a esta
-- función UNA vez. Así los datos personales viajan del equipo de quien los
-- custodia a la base, sin pasar por el repositorio ni por nadie más, y la
-- bitácora dice quién hizo la carga (auth.uid()).
--
-- Todo o nada: una sola transacción. Y solo sobre un inventario vacío: los
-- cambios posteriores son unidad por unidad, desde la misma pantalla, que es
-- donde Rosa mantiene la lista viva (Acta 03-O02).
--
-- `p_titulares`: [{clave, nombre, doc_tipo, doc_numero, telefono, fuente, notas}]
-- `p_unidades`:  [{codigo, tipo, area_m2, estado_comercial, estado_dato,
--                  fuente_plano, fuente_disponibilidad, geometria, zona_rubro,
--                  observaciones, tipo_socio, titular (= clave), revisar}]
create or replace function fn_importar_inventario(
  p_unidades  jsonb,
  p_titulares jsonb,
  p_corte     text,
  p_simular   boolean default true
) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_t          jsonb;
  v_u          jsonb;
  v_id         uuid;
  v_mapa       jsonb := '{}'::jsonb;
  v_nuevos     integer := 0;
  v_reusados   integer := 0;
  v_unidades   integer := 0;
  v_codigos    integer;
begin
  if not es(array['direccion','administracion']::rol_usuario[]) then
    raise exception 'Solo Dirección o Administración pueden cargar el inventario (Acta 03-O02: Rosa mantiene el inventario).';
  end if;

  if jsonb_typeof(p_unidades) is distinct from 'array' or jsonb_array_length(p_unidades) = 0 then
    raise exception 'No llegó ninguna unidad para cargar.';
  end if;
  if jsonb_array_length(p_unidades) > 2000 then
    raise exception 'Demasiadas filas (%). El plano vigente tiene cientos de unidades, no miles: revisa el archivo.',
      jsonb_array_length(p_unidades);
  end if;
  if jsonb_typeof(coalesce(p_titulares, '[]'::jsonb)) <> 'array' then
    raise exception 'La lista de titulares no tiene la forma esperada.';
  end if;

  select count(distinct btrim(e->>'codigo')) into v_codigos from jsonb_array_elements(p_unidades) e;
  if v_codigos <> jsonb_array_length(p_unidades) then
    raise exception 'Hay códigos de unidad repetidos o vacíos en la carga.';
  end if;

  if exists (select 1 from unidades where archivado_el is null) then
    raise exception 'Ya hay unidades cargadas. La carga inicial solo corre sobre un inventario vacío; los cambios se hacen unidad por unidad desde /inventario.';
  end if;

  if p_simular then
    return jsonb_build_object('ok', true, 'simulado', true,
      'unidades', jsonb_array_length(p_unidades),
      'titulares', jsonb_array_length(coalesce(p_titulares, '[]'::jsonb)));
  end if;

  -- ---- Titulares: se reutiliza la persona si ya existe por documento o teléfono ----
  for v_t in select * from jsonb_array_elements(coalesce(p_titulares, '[]'::jsonb)) loop
    if coalesce(btrim(v_t->>'nombre'), '') = '' or coalesce(v_t->>'clave', '') = '' then
      raise exception 'Un titular llegó sin nombre o sin clave.';
    end if;
    v_id := null;
    select id into v_id from personas
     where archivado_el is null
       and ((v_t->>'doc_numero' is not null and doc_tipo = v_t->>'doc_tipo' and doc_numero = v_t->>'doc_numero')
            or (v_t->>'telefono' is not null and telefono_e164 = v_t->>'telefono'))
     order by creado_el limit 1;
    if v_id is null then
      insert into personas (nombre_completo, doc_tipo, doc_numero, telefono_e164, origen, es_socio,
                            consentimiento, fuente_del_dato, notas, creado_por)
      values (btrim(v_t->>'nombre'), v_t->>'doc_tipo', v_t->>'doc_numero', v_t->>'telefono',
              'base_historica', true, false, v_t->>'fuente', nullif(v_t->>'notas', ''), auth.uid())
      returning id into v_id;
      v_nuevos := v_nuevos + 1;
    else
      -- Ya estaba (un lead que resultó ser socio): se marca como socio y no se
      -- pisa nada de lo que ya tenía.
      update personas set es_socio = true where id = v_id and not es_socio;
      v_reusados := v_reusados + 1;
    end if;
    v_mapa := v_mapa || jsonb_build_object(v_t->>'clave', v_id);
  end loop;

  -- ---- Unidades ----
  for v_u in select * from jsonb_array_elements(p_unidades) loop
    insert into unidades (codigo_unidad, tipo, area_m2, estado_comercial, estado_dato, fuente_plano,
                          fuente_disponibilidad, geometria, zona_rubro, observaciones, tipo_socio,
                          titular_persona_id, revisar)
    values (btrim(v_u->>'codigo'),
            v_u->>'tipo',
            nullif(v_u->>'area_m2', '')::numeric,
            (v_u->>'estado_comercial')::estado_unidad,
            (v_u->>'estado_dato')::semaforo,
            v_u->>'fuente_plano',
            v_u->>'fuente_disponibilidad',
            case when jsonb_typeof(v_u->'geometria') = 'array' then v_u->'geometria' end,
            nullif(v_u->>'zona_rubro', ''),
            nullif(v_u->>'observaciones', ''),
            nullif(v_u->>'tipo_socio', ''),
            case when coalesce(v_u->>'titular', '') <> '' then (v_mapa->>(v_u->>'titular'))::uuid end,
            nullif(v_u->>'revisar', ''));
    v_unidades := v_unidades + 1;
  end loop;

  -- ---- De cuándo es la disponibilidad ----
  update parametros
     set valor_texto = p_corte,
         estado_semaforo = 'amarillo',
         fuente = 'D:\SCPCMO\02-marketing\diseño\inventario grafico (Libres.xlsx y kardex MML 2026) · 00-fuente-de-verdad\inventario-maestro.md §4',
         nota = '🟡 Disponibilidad cargada con el inventario gráfico. Libres.xlsx no trae fecha de corte y las tiendas no coinciden del todo con el plano marcado: confirmar con Rosa antes de separar.',
         actualizado_el = now(),
         actualizado_por = auth.uid()
   where id = 'inventario_disponibilidad_corte';

  return jsonb_build_object('ok', true, 'simulado', false, 'unidades', v_unidades,
                            'titulares_nuevos', v_nuevos, 'titulares_reutilizados', v_reusados);
end $fn$;

comment on function fn_importar_inventario is
  'Carga inicial del inventario (unidades del plano + titulares del kardex) en una transaccion, solo sobre un inventario vacio y solo para direccion/administracion. La llama la pantalla /inventario; los datos personales no pasan por el repositorio.';

revoke all on function fn_importar_inventario(jsonb, jsonb, text, boolean) from public, anon;
grant execute on function fn_importar_inventario(jsonb, jsonb, text, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- 5 · Registro
-- ---------------------------------------------------------------------
insert into migraciones_aplicadas (archivo, aplicado_el, nota) values
  ('14-inventario-grafico.sql', now(), 'geometria, zona_rubro, revisar y fuente_disponibilidad en unidades y v_unidades_tablero')
on conflict (archivo) do nothing;
