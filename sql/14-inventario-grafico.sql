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
