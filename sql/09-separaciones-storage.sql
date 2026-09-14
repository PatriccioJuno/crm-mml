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
