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
