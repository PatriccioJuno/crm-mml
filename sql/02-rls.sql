-- =====================================================================
-- CRM Mercado Media Luna — 02 · SEGURIDAD A NIVEL DE FILA (RLS)
-- Estado: 🟢 VIGENTE · 08/09/2026
--
-- LEE ESTO ANTES DE EJECUTARLO:
-- La clave `anon` de Supabase viaja dentro del navegador de cualquiera que abra
-- el CRM. Es pública por diseño. Lo único que impide que un curioso lea todos los
-- DNI y todos los montos es lo que hay en este archivo.
-- Una tabla sin RLS = una base de datos pública.
--
-- Después de ejecutarlo, corre OBLIGATORIAMENTE la batería de pruebas de
-- 01-documentacion\05-SEGURIDAD-BACKUPS-Y-LEY-29733.md §4 antes de cargar un
-- solo dato real.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0 · Cerrar la puerta principal
-- ---------------------------------------------------------------------
revoke all on schema public from anon;
grant usage on schema public to anon, authenticated;
-- El rol anónimo NO necesita leer nada: este CRM no tiene páginas públicas.
-- Todo acceso pasa por un usuario autenticado.

alter default privileges in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------
-- 1 · Funciones de ayuda (SECURITY DEFINER para no recursionar sobre perfiles)
-- ---------------------------------------------------------------------

create or replace function mi_rol() returns rol_usuario
language sql stable security definer set search_path = public as $$
  select rol from perfiles where id = auth.uid() and activo
$$;

create or replace function es(p_roles rol_usuario[]) returns boolean
language sql stable security definer set search_path = public as $$
  select mi_rol() = any(p_roles)
$$;

-- ---------------------------------------------------------------------
-- 2 · Activar RLS en TODAS las tablas. Sin excepción.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'perfiles','parametros','tipo_cambio','unidades','personas','campanas',
    'oportunidades','estado_historial','interacciones','tareas','separaciones',
    'contratos','cuotas','pagos','bitacora'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3 · Políticas
-- ---------------------------------------------------------------------

-- PERFILES: cada quien se ve a sí mismo; dirección ve y administra a todos.
create policy perfiles_leer_propio on perfiles for select to authenticated
  using (id = auth.uid() or es(array['direccion']::rol_usuario[]));
create policy perfiles_direccion_todo on perfiles for all to authenticated
  using (es(array['direccion']::rol_usuario[]))
  with check (es(array['direccion']::rol_usuario[]));

-- PARÁMETROS: todos leen (el CRM entero depende de ellos); solo dirección escribe.
-- Un vendedor que pudiera editar el precio haría inútil la regla de fuente de verdad.
create policy parametros_leer on parametros for select to authenticated using (true);
create policy parametros_escribir on parametros for all to authenticated
  using (es(array['direccion']::rol_usuario[]))
  with check (es(array['direccion']::rol_usuario[]));

create policy tc_leer on tipo_cambio for select to authenticated using (true);
create policy tc_escribir on tipo_cambio for all to authenticated
  using (es(array['direccion','contabilidad']::rol_usuario[]))
  with check (es(array['direccion','contabilidad']::rol_usuario[]));

-- UNIDADES: todo el equipo las lee; Rosa (administración) y dirección las mantienen.
-- Acta 03-O02: "Rosa es responsable de mantener el inventario".
create policy unidades_leer on unidades for select to authenticated using (true);
create policy unidades_escribir on unidades for all to authenticated
  using (es(array['direccion','administracion']::rol_usuario[]))
  with check (es(array['direccion','administracion']::rol_usuario[]));

-- PERSONAS: datos personales. Lectura para quien opera; contabilidad y lectura solo leen.
create policy personas_leer on personas for select to authenticated
  using (es(array['direccion','comercial','administracion','contabilidad','lectura']::rol_usuario[]));
create policy personas_crear on personas for insert to authenticated
  with check (es(array['direccion','comercial','administracion']::rol_usuario[]));
create policy personas_editar on personas for update to authenticated
  using (es(array['direccion','comercial','administracion']::rol_usuario[]))
  with check (es(array['direccion','comercial','administracion']::rol_usuario[]));

-- CAMPAÑAS
create policy campanas_leer on campanas for select to authenticated using (true);
create policy campanas_escribir on campanas for all to authenticated
  using (es(array['direccion','comercial']::rol_usuario[]))
  with check (es(array['direccion','comercial']::rol_usuario[]));

-- OPORTUNIDADES: un vendedor ve y edita las suyas. Dirección y administración, todas.
-- (Hoy hay un solo comercial; la política ya está lista para cuando entren más.)
create policy oport_leer on oportunidades for select to authenticated
  using (
    es(array['direccion','administracion','contabilidad','lectura']::rol_usuario[])
    or responsable_id = auth.uid()
  );
create policy oport_crear on oportunidades for insert to authenticated
  with check (es(array['direccion','comercial','administracion']::rol_usuario[]));
create policy oport_editar on oportunidades for update to authenticated
  using (
    es(array['direccion','administracion']::rol_usuario[])
    or (es(array['comercial']::rol_usuario[]) and responsable_id = auth.uid())
  )
  with check (
    es(array['direccion','administracion']::rol_usuario[])
    or (es(array['comercial']::rol_usuario[]) and responsable_id = auth.uid())
  );

-- HISTORIAL: solo lectura para humanos. Lo escriben los disparadores. (R9)
create policy historial_leer on estado_historial for select to authenticated using (true);
-- Sin política de INSERT/UPDATE/DELETE: nadie puede reescribir la historia desde el cliente.

-- INTERACCIONES
create policy inter_leer on interacciones for select to authenticated using (true);
create policy inter_crear on interacciones for insert to authenticated
  with check (es(array['direccion','comercial','administracion']::rol_usuario[]));
create policy inter_editar on interacciones for update to authenticated
  using (actor_id = auth.uid() or es(array['direccion']::rol_usuario[]))
  with check (actor_id = auth.uid() or es(array['direccion']::rol_usuario[]));

-- TAREAS
create policy tareas_leer on tareas for select to authenticated using (true);
create policy tareas_escribir on tareas for all to authenticated
  using (es(array['direccion','comercial','administracion']::rol_usuario[]))
  with check (es(array['direccion','comercial','administracion']::rol_usuario[]));

-- SEPARACIONES: el corazón del dinero.
-- Comercial y administración registran; SOLO dirección verifica (el disparador R2
-- lo refuerza, esto lo refuerza dos veces: defensa en profundidad).
create policy sep_leer on separaciones for select to authenticated using (true);
create policy sep_crear on separaciones for insert to authenticated
  with check (
    es(array['direccion','comercial','administracion']::rol_usuario[])
    and verificada_el is null      -- nadie nace verificado
  );
create policy sep_editar_operativo on separaciones for update to authenticated
  using (es(array['comercial','administracion']::rol_usuario[]))
  with check (
    es(array['comercial','administracion']::rol_usuario[])
    and verificada_el is null      -- un comercial jamás puede marcarla verificada
  );
create policy sep_editar_direccion on separaciones for update to authenticated
  using (es(array['direccion']::rol_usuario[]))
  with check (es(array['direccion']::rol_usuario[]));

-- CONTRATOS
create policy contratos_leer on contratos for select to authenticated using (true);
create policy contratos_escribir on contratos for all to authenticated
  using (es(array['direccion','administracion']::rol_usuario[]))
  with check (es(array['direccion','administracion']::rol_usuario[]));

-- CUOTAS Y PAGOS: cobranza es de Rosa; contabilidad lee; dirección todo.
create policy cuotas_leer on cuotas for select to authenticated using (true);
create policy cuotas_escribir on cuotas for all to authenticated
  using (es(array['direccion','administracion']::rol_usuario[]))
  with check (es(array['direccion','administracion']::rol_usuario[]));

create policy pagos_leer on pagos for select to authenticated using (true);
create policy pagos_crear on pagos for insert to authenticated
  with check (es(array['direccion','administracion']::rol_usuario[]));
create policy pagos_editar on pagos for update to authenticated
  using (es(array['direccion','administracion']::rol_usuario[]))
  with check (es(array['direccion','administracion']::rol_usuario[]));

-- BITÁCORA: solo dirección la lee. Nadie la escribe desde el cliente.
create policy bitacora_leer on bitacora for select to authenticated
  using (es(array['direccion']::rol_usuario[]));

-- ---------------------------------------------------------------------
-- 4 · Alta de perfil automática al crear un usuario
--     Nace con rol 'lectura': el acceso se otorga, no se hereda.
-- ---------------------------------------------------------------------
create or replace function fn_nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (id, nombre, rol)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', new.email), 'lectura')
  on conflict (id) do nothing;
  return new;
end $$;

create trigger t_nuevo_usuario after insert on auth.users
  for each row execute function fn_nuevo_usuario();
