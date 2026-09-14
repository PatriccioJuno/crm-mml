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
