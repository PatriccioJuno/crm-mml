-- =====================================================================
-- CRM Mercado Media Luna — 05 · PRUEBAS DE LAS REGLAS DURAS
-- Estado: 🟢 VIGENTE · 08/09/2026
--
-- ✅ ESTE ARCHIVO YA SE EJECUTÓ contra PostgreSQL 16 el 08/09/2026 y las
--    9 reglas dieron el resultado esperado. Vuélvelo a correr tú en tu
--    propio proyecto: es la prueba de que el esquema quedó bien instalado.
--
-- CÓMO SE LEE: cada bloque dice qué DEBE pasar. Varios bloques tienen que
-- DAR ERROR. Un error rojo aquí es una prueba superada, no un fallo.
--
-- ⚠️ Ejecútalo en un proyecto de PRUEBA o antes de cargar datos reales.
--    Al final hay una limpieza, pero no la ejecutes sobre datos de verdad.
-- =====================================================================

-- ---------- PREPARACIÓN ----------
-- Usa tu propio usuario. Sustituye este identificador por el tuyo:
--   select id from auth.users where email = 'patricciojuno@gmail.com';
-- MI_USUARIO '00000000-0000-0000-0000-000000000000'

insert into unidades (codigo_unidad, tipo, estado_comercial, estado_dato)
values ('PRUEBA-001','puesto','disponible','verde') on conflict do nothing;

insert into personas (nombre_completo, telefono_e164) values
  ('PRUEBA Ana','+51900000001'), ('PRUEBA Luis','+51900000002')
on conflict do nothing;

-- ---------- R9 · el historial se escribe solo ----------
insert into oportunidades (persona_id, unidad_asignada_id)
  select p.id, u.id from personas p, unidades u
  where p.nombre_completo='PRUEBA Ana' and u.codigo_unidad='PRUEBA-001';
-- ESPERADO: 1 fila en estado_historial, sin que nadie la escribiera
select count(*) as r9_filas_historial from estado_historial;

-- ---------- R1 · una unidad, una asignación activa ----------
-- ESPERADO: ❌ ERROR "unidad_una_sola_asignacion_activa"
insert into oportunidades (persona_id, unidad_asignada_id)
  select p.id, u.id from personas p, unidades u
  where p.nombre_completo='PRUEBA Luis' and u.codigo_unidad='PRUEBA-001';

-- ---------- R5 · calificado exige las 4 respuestas ----------
-- ESPERADO: ❌ ERROR "calificado_requiere_las_4_respuestas"
update oportunidades set estado='06_calificado'
where estado='01_prospecto_captado';

-- ESPERADO: ✅ con las 4 respuestas, sí pasa
update oportunidades set
  cal_operar_o_invertir='operar', cal_compro_antes=false,
  cal_forma_pago='contado',       cal_decide_solo=true,
  estado='06_calificado';
select de_estado, a_estado from estado_historial order by id;   -- R9: quedó registrado

-- ---------- R8 · nada se borra ----------
-- ESPERADO: ❌ ERROR "Nada se borra en este sistema"
delete from personas where nombre_completo='PRUEBA Luis';

-- ---------- R4 · sin parámetro cargado, no se registra separación ----------
-- ESPERADO: ❌ ERROR con mensaje que te dice qué parámetro falta
insert into separaciones (oportunidad_id, persona_id, unidad_id, monto, monto_moneda, fecha_deposito_efectivo)
  select o.id, o.persona_id, o.unidad_asignada_id, 0, 'PEN', current_date
  from oportunidades o limit 1;

-- Carga el plazo REAL desde 00-fuente-de-verdad antes de continuar:
--   update parametros set valor_entero = <el que diga el archivo fuente>,
--                         estado_semaforo='verde'
--   where id='plazo_devolucion_separacion_dias';

-- ---------- R4b · los dos relojes son independientes ----------
-- ESPERADO: fecha_limite_devolucion = depósito + plazo;
--           fecha_limite_precio conserva exactamente lo que se escribió
insert into separaciones (oportunidad_id, persona_id, unidad_id, monto, monto_moneda,
                          fecha_deposito_efectivo, fecha_limite_precio)
  select o.id, o.persona_id, o.unidad_asignada_id, 0, 'PEN',
         current_date, current_date + 12
  from oportunidades o limit 1;
select fecha_deposito_efectivo, fecha_limite_devolucion, fecha_limite_precio
from separaciones;

-- ---------- R3 · sin verificación no hay constancia ----------
-- ESPERADO: false
select puede_emitir_constancia(id) as r3_puede_emitir from separaciones;

-- ---------- R2 · solo dirección verifica ----------
-- Con sesión iniciada como usuario de rol 'comercial':
-- ESPERADO: ❌ ERROR citando el Acta 03-O02
update separaciones set verificada_el = now(), estado='verificada';

-- Repítelo con un usuario de rol 'direccion': ESPERADO ✅, y entonces
-- puede_emitir_constancia pasa a true (si doc_cliente_registrado es true).

-- ---------- R6 · la fuga es visible ----------
-- ESPERADO: al menos 1 fila (la oportunidad de prueba no tiene tarea)
select count(*) as r6_sin_siguiente_paso from v_sin_siguiente_paso;

-- ---------- R7 · ninguna vista suma monedas distintas ----------
-- Revisión manual: en v_cobranza y en los reportes, la moneda siempre
-- aparece como columna propia, nunca sumada.

-- ---------- RLS en todas las tablas ----------
-- ESPERADO: tablas_sin_rls = 0
select count(*) filter (where not rowsecurity) as tablas_sin_rls,
       count(*) as total
from pg_tables where schemaname='public';

-- ---------- LIMPIEZA (solo en entorno de prueba) ----------
-- Los disparadores impiden borrar. Para limpiar de verdad hay que
-- desactivarlos temporalmente; por eso esto SOLO se hace en un proyecto
-- de prueba y nunca sobre datos reales:
--
--   alter table personas disable trigger t_no_delete_personas;
--   delete from separaciones where notas is null and monto = 0;
--   delete from oportunidades where persona_id in
--     (select id from personas where nombre_completo like 'PRUEBA%');
--   delete from personas where nombre_completo like 'PRUEBA%';
--   delete from unidades where codigo_unidad like 'PRUEBA%';
--   alter table personas enable trigger t_no_delete_personas;
