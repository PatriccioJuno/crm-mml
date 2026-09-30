# Ficha de persona — `/personas/:personaId?o=:oportunidadId`

**Estado:** 🟡 POR VALIDAR · 30/09/2026 — escrita y compila (`tsc`); falta probarla en el navegador con
datos de prueba y la migración `sql/13-seguimiento-comercial.sql` aplicada. Contrato: SPEC §7 S2, S4, S5.

## Qué es

La pantalla donde se trabaja **un** lead: registrar el contacto, completar el perfil, agendar la visita,
subir documentos y cambiar la situación. Exporta `FichaPersona` (`index.tsx`).

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.tsx` | Carga las oportunidades (`cargarOportunidadesDePersona`) y elige la de `?o=` o la principal (`elegirOportunidadPrincipal`). Selector en pestañas si hay más de una. Rejilla `lg:grid-cols-[minmax(0,1fr)_22rem]`; en el móvil una columna + barra fija (WhatsApp · Registrar contacto). |
| `CabeceraFicha.tsx` | Nombre, temperatura, estado, situación, campaña; indicadores Responsable · Próximo paso · Visita · Sin contacto; botones de contacto y «Tomar» si no tiene dueño. |
| `PanelContacto.tsx` | Registrar un contacto (también lo usa el modo llamadas). Exporta además `puedeOperarOportunidad`, `invalidarTrasAccion`, `Fallo`, `mensajeSugerido`. |
| `SeccionPerfil.tsx` | Perfil comercial y cualificación R5 (`PerfilRapido` para la cola). |
| `SeccionVisitas.tsx` | Visita abierta y sus acciones (Confirmó · Enviar aviso · Realizada · No asistió · Reprogramar · Cancelar) + historial. **Re-exporta** `DialogoAgendarVisita` (la cola lo importa desde aquí). |
| `DialogoAgendarVisita.tsx` | Tipo, día (Hoy · Mañana · Pasado mañana · Elegir) + hora, viene con quien decide, nota. Tras agendar muestra el aviso (`PanelAviso`) en el mismo diálogo. |
| `DialogoAvisoVisita.tsx` | Aviso al cliente: WhatsApp, correo, `.ics`, envío automático si está configurado. |
| `SeccionDocumentos.tsx` | Checklist de `documentosEsperados(estado)`, subida (foto o archivo), lista con «Ver» y «Archivar» (con motivo, R8) y los vouchers de `separaciones.comprobante_url` en solo lectura. |
| `Actividad.tsx`, `DatosPersona.tsx`, `ControlesSituacion.tsx`, `DialogoMensaje.tsx` | Línea de tiempo, datos de contacto y consentimiento, estado / fríos / descarte / temperatura / asignación, mensaje sugerido. |

## Persona sin oportunidad

Un titular cargado desde el inventario (`personas.es_socio`) no tiene proceso comercial: se muestran la
cabecera (sin indicadores), una explicación, **Unidades de las que es titular**
(`unidades.titular_persona_id`), Documentos y Datos. **No** se muestra el panel de contacto. Editan
Dirección y Administración.

## Reglas que respeta

- **Quién edita:** `puedeOperarOportunidad` — Dirección y Administración siempre; Comercial si es el
  responsable o si no tiene dueño. La base (RLS y funciones) vuelve a comprobarlo.
- **Claves de consulta (SPEC §8):** `['ficha', personaId, 'oportunidades' | 'persona' | 'unidades']`,
  `['visitas', oportunidadId]`, `['documentos', personaId]`, `['actividad', oportunidadId]`. Tras cada
  acción, `invalidarTrasAccion` refresca además `['ficha']`, `['cartera']`, `['hoy']`, `['embudo']`.
- **Sin cifras de negocio en pantalla.** El horario de visitas (`visita_horario`) está 🔴 sin definir: el
  diálogo no sugiere hora y lo avisa. Los atajos «Mañana / En 3 días / En una semana» son de pantalla.
- **No contactar (Ley 29733):** sin botones de contacto, sin agendar visitas ni enviar avisos.
- **DNI:** aviso de dato mínimo necesario al elegir ese tipo de documento.
- **Ámbar solo sobre azul:** «Tomar» en la cabecera y WhatsApp en la barra fija del móvil.

## Pendiente

- 🔴 Aplicar `sql/13` y probar con datos de prueba: agendar → avisar → realizada / no asistió / cancelar;
  subir y archivar un documento; persona sin oportunidad con unidades.
- 🟡 La oportunidad que llega por `?o=` y no es visible para el rol abre la principal con un aviso;
  confirmar que es el comportamiento deseado.
- 🔵 «Agendar visita» desde el panel de contacto no bloquea si ya hay una visita abierta: lo decide
  `fn_agendar_visita`. Si se prefiere, que ese botón abra «Reprogramar».
