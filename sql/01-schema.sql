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
