-- =====================================================================
-- CRM Mercado Media Luna — INSTALACIÓN COMPLETA
-- Generado el 14/09/2026
--
-- QUÉ ES ESTO
-- Los diez scripts de sql\ concatenados en su orden de ejecución, para poder
-- levantar una base desde cero con UN SOLO pegado en el SQL Editor de Supabase.
-- No contiene ni una línea que no esté en esos archivos: es una comodidad, no
-- una fuente de verdad. Si algo hay que cambiar, se cambia en el archivo
-- numerado que corresponda y este se vuelve a generar.
--
-- QUÉ NO INCLUYE
-- 05-pruebas-reglas.sql. Es la batería de pruebas de las nueve reglas duras, y
-- se corre APARTE y DESPUÉS, a propósito: algunas de sus comprobaciones fallan
-- adrede para demostrar que una regla se está cumpliendo. Mezclarla aquí haría
-- abortar la instalación.
--
-- CÓMO SE USA
--   1 · SQL Editor de Supabase -> New query
--   2 · Pegar este archivo entero
--   3 · Run
--   4 · Comprobar:  select archivo, aplicado_el from migraciones_aplicadas
--                   order by archivo;        -- deben salir 10 filas
--   5 · Después, y por separado, correr 05-pruebas-reglas.sql
--
-- ORDEN (no se altera: cada uno depende del anterior)
--   01 esquema -> 02 RLS -> 03 vistas -> 04 parámetros -> 06 registro rápido
--   -> 07 vistas de Hoy -> 08 vistas de embudo e inventario
--   -> 09 storage -> 10 control de migraciones -> 11 privilegios
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
