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
