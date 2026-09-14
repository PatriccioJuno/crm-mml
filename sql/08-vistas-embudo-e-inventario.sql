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
