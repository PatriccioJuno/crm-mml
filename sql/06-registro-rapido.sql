-- =====================================================================
-- CRM Mercado Media Luna — 06 · REGISTRO RÁPIDO (transacción única)
-- Estado: 🟢 VIGENTE · 10/09/2026
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
  select id into v_oport
  from oportunidades
  where persona_id = v_persona
    and situacion  = 'activa'
    and archivado_el is null
  order by fecha_ingreso desc
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
  select id into v_tarea
  from tareas
  where oportunidad_id = v_oport
    and completada_el is null
  order by vence_el
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
