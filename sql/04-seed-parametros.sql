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
