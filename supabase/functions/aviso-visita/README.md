# Edge Function `aviso-visita` — correo automático del aviso de visita

**Estado:** 🔵 escrita y probada en local con simulaciones · **NO desplegada** · 29/09/2026
**Queda inerte** hasta que existan los secretos `RESEND_API_KEY` y `CORREO_REMITENTE`
(decisión del dueño, 29/09/2026 — SPEC §1).

Manda al **prospecto** el correo de una visita (confirmación, recordatorio o cancelación) por
[Resend](https://resend.com), con la invitación de calendario `.ics` adjunta, y deja el envío
registrado en el CRM. Es el camino **(b) automático**; el camino **(a) manual** (`mailto:` +
`.ics` descargable + texto de WhatsApp) funciona desde hoy sin esta función.

---

## 1. Archivos

| Archivo | Qué es |
|---|---|
| `index.ts` | La función (Deno, sin dependencias: solo `fetch` y `Deno.serve`). |
| `aviso-visita.ts` | **Copia byte a byte** de `src/lib/aviso-visita.ts`. **No se edita aquí.** Es el mismo texto que usa el envío manual: si se editara aquí, el correo automático diría otra cosa. |
| `README.md` | Este archivo. |

Antes de **cada** despliegue, desde la raíz del repositorio `crm-mml`:

```sh
cp src/lib/aviso-visita.ts supabase/functions/aviso-visita/aviso-visita.ts
cmp src/lib/aviso-visita.ts supabase/functions/aviso-visita/aviso-visita.ts   # sin salida = idénticos
```

---

## 2. Requisitos previos

- 🔴 **`sql/13-seguimiento-comercial.sql` aplicada** en el proyecto `nmqwibcxqkaifszzbloo`. La
  función llama a `fn_datos_aviso_visita` y `fn_registrar_aviso_visita`, y escribe en
  `notificaciones`. Sin la migración responde *«La base todavía no tiene fn_datos_aviso_visita…»*.
- 🟡 Recomendado: el parámetro `correo_contacto_publico` en 🟢. Es el `reply_to` del correo (ver §5).

---

## 3. Desplegar

```sh
supabase functions deploy aviso-visita --no-verify-jwt --project-ref nmqwibcxqkaifszzbloo
```

(O la herramienta de despliegue del MCP de Supabase con `verify_jwt: false`.)

**Por qué `--no-verify-jwt`.** Según la documentación de Supabase (consultada el 29/09/2026:
*Migrating to publishable and secret API keys* y *JWT Signing Keys*), el `verify_jwt` de la
pasarela solo entiende las claves JWT **heredadas** (`anon` / `service_role`), que en este
proyecto están desactivadas; con las claves nuevas (`sb_publishable_…`) y las claves de firma
asimétricas, la pasarela puede rechazar llamadas válidas. Por eso la verificación **no se
apaga, se muda**: `index.ts` exige un JWT de sesión y lo comprueba contra `/auth/v1/user`
antes de hacer cualquier cosa, y después PostgREST vuelve a validarlo en cada llamada a la base.

Si un día se crea `supabase/config.toml`, debe llevar:

```toml
[functions.aviso-visita]
verify_jwt = false
```

Desplegada sin secretos, la función **no envía nada**: `estado` responde `configurado:false` y
la pantalla no muestra el botón «Enviar automático».

---

## 4. Activar el envío — lo hace Dirección

1. **Cuenta de Resend** a nombre de la empresa, con un correo corporativo (no uno personal): quien
   tenga la cuenta controla lo que sale en nombre de Mercado Media Luna.
2. **Verificar el dominio `mercadomedialuna.com`** en Resend → *Domains* → *Add domain*. Resend
   muestra los registros DNS que hay que crear (normalmente un TXT de DKIM y, en un subdominio
   de envío, un MX y un TXT de SPF — 🟡 copiar **exactamente** los que muestre Resend, no los de
   este README). Se cargan en el DNS del dominio, que está en **Banahosting** (panel de hosting →
   editor de zona DNS; 🟡 el nombre exacto del menú depende del panel).
   - ⚠️ **No tocar el MX del dominio raíz** ni crear un segundo SPF en la raíz: eso rompe el correo
     corporativo. Los registros de Resend van en sus propios nombres (subdominio y `_domainkey`).
   - Esperar a que Resend marque el dominio como **Verified**. Antes de eso, Resend solo deja
     enviar pruebas al correo del dueño de la cuenta.
3. **Crear la API key** en Resend → *API Keys*, con permiso **solo de envío** (*Sending access*) y
   limitada al dominio `mercadomedialuna.com`. Se ve una sola vez.
4. **Cargar los dos secretos en Supabase** → *Edge Functions* → *Secrets* (preferido: no deja
   rastro en el historial de la terminal):
   - `RESEND_API_KEY` = la clave del paso 3.
   - `CORREO_REMITENTE` = el remitente, con nombre visible. 🔵 Propuesta:
     `Mercado Media Luna <avisos@mercadomedialuna.com>`. **Tiene que ser un buzón que alguien lea**
     (ver §5): nada de `no-reply`.

   Alternativa por CLI (la clave queda en el historial de la shell; borrarla después):

   ```sh
   supabase secrets set --project-ref nmqwibcxqkaifszzbloo \
     RESEND_API_KEY=... CORREO_REMITENTE="Mercado Media Luna <avisos@mercadomedialuna.com>"
   ```

   No hace falta volver a desplegar: los secretos se leen en cada llamada.
   ⚠️ La API key de Resend **jamás** va en el repositorio, en un `.env` versionado, en un chat ni
   en un prompt (misma regla que la `service_role`, 07-crm/CLAUDE.md §5).
5. **Probar** con una persona de prueba cuyo correo sea propio y con consentimiento registrado:
   ficha → *Visitas* → aviso → debe aparecer «Enviar automático». Revisar que el correo llegue,
   que el `.ics` se abra en el calendario y que en la ficha quede el aviso registrado.

Para **apagarla**: borrar cualquiera de los dos secretos. Vuelve a quedar inerte al instante.

---

## 5. Qué hace, paso a paso

`POST` con cuerpo JSON. Sin sesión válida no contesta nada — ni siquiera `estado`.

| Llamada | Respuesta |
|---|---|
| `{ accion:'estado' }` | `{ ok:true, configurado }` — `configurado` = existen **los dos** secretos |
| `{ accion:'enviar', visita_id, plantilla }` con `plantilla` = `confirmacion` \| `recordatorio` \| `cancelacion` | `{ ok:true, id, notificacion_id, faltantes, avisos }` (`id` = id del envío en Resend) o `{ ok:false, motivo }` |

`enviar`:

1. **Sin secretos** → `{ ok:false, motivo:'Envío automático sin configurar: faltan RESEND_API_KEY y
   CORREO_REMITENTE en los secretos de Supabase.' }` con **HTTP 200**, para que la pantalla lo muestre.
2. **`fn_datos_aviso_visita`** con el JWT del usuario. Si no tiene acceso a esa oportunidad, la base
   lo dice y ese mensaje llega tal cual.
3. **Permisos de contacto, fallando cerrado:** no se envía si `puede_enviar_email` es falso, si la
   persona pidió no ser contactada, si no tiene consentimiento o si su correo no es válido.
4. **Plantilla coherente con la visita:** la *cancelación* solo sale si la visita ya está
   `cancelada` (su `.ics` lleva `METHOD:CANCEL` y **borra** el evento del calendario del cliente);
   *confirmación* y *recordatorio* solo si está `agendada` o `confirmada`.
5. **Arma el correo y el `.ics`** con `aviso-visita.ts` — el mismo texto que el envío manual. La
   `nota` interna de la visita nunca va al cliente. Si falta un parámetro 🟢 (mapa, punto de
   encuentro…), el texto dice lo que se hará en su lugar y el id va en `faltantes`.
6. **Resend**, con 10 s de espera y **sin reintento** (un reintento podría duplicar el correo).
   `reply_to` = `correo_contacto_publico` si está en 🟢; si no, las respuestas llegan a
   `CORREO_REMITENTE`. El texto dice «responda este correo» y «responda **BAJA**»: alguien tiene
   que leer ese buzón.
7. **Registra siempre** con `fn_registrar_aviso_visita` (canal `email`, modo `automatico`, estado
   `enviada` o `error`, id de Resend o el error). Eso crea la fila en `notificaciones`, la
   interacción en el historial y marca `visitas.aviso_enviado_el`.
   - Si el correo salió pero el registro falló, responde `ok:true` con el problema en `avisos`
     (un `ok:false` invitaría a reenviar y el cliente recibiría dos).
   - Si Resend no contesta en 10 s, el estado es **incierto**: el motivo pide confirmarlo antes
     de reintentar.

**Orígenes permitidos (CORS):** `https://staff.mercadomedialuna.com`, `http://localhost:5173`,
`http://localhost:4173`. Una vista previa de Vercel (`*.vercel.app`) **no** está incluida: si se
necesita, se agrega a `ORIGENES_PERMITIDOS` en `index.ts` y se vuelve a desplegar.

---

## 6. Seguridad

- Corre **con el JWT del usuario** que pulsa el botón. Reenvía a PostgREST las cabeceras
  `Authorization` (sesión) y `apikey` (clave publicable) de la llamada, así que RLS, `es(...)` y
  `puede_operar_oportunidad` aplican exactamente igual que en la pantalla.
- **Nunca usa la `service_role` ni una secret key**: el código no lee `SUPABASE_SERVICE_ROLE_KEY`
  ni `SUPABASE_SECRET_KEYS`. Si una llamada trae una `sb_secret_…` en `apikey`, la rechaza (esa
  clave no puede estar en un navegador: hay que rotarla).
- Los logs de la función (`console.error`) **no guardan datos personales**: solo el id de la
  visita y el error técnico, con cualquier dirección de correo reemplazada por `[correo]`.

---

## 7. Ley 29733 — protección de datos personales

> Información general para decidir, no asesoría legal: lo revisa quien lleve lo legal de SCP
> (ver `01-documentacion/05-SEGURIDAD-BACKUPS-Y-LEY-29733.md`).

- Al activar el envío, **Resend pasa a ser encargado de tratamiento**: recibe el correo y el
  nombre del prospecto, la fecha y hora de su visita y el nombre de quien lo atiende. Nada más
  (sin DNI, sin teléfono del prospecto, sin datos del CRM en etiquetas o metadatos).
- 🟡 **Por validar con legal:** Resend es un proveedor extranjero, así que el envío implica un
  **flujo transfronterizo** de datos personales. Confirmar qué exige (mención en el aviso de
  privacidad y, si corresponde, comunicación a la autoridad) **antes** de cargar los secretos.
- 🔴 **Antes de activarlo, actualizar el aviso de privacidad** publicado: en
  `08-web/mercado-media-luna/privacidad.html` sigue pendiente la línea *«lista de encargados de
  tratamiento, incluido el proveedor de la base de datos»*. Resend tiene que figurar ahí. (Esta
  función no toca la web.)
- Solo se escribe a quien tiene **consentimiento registrado** y no pidió dejar de ser contactado;
  lo hace cumplir la base (`fn_datos_aviso_visita` y `fn_registrar_aviso_visita`), no solo este
  código.
- Si alguien responde **BAJA**, nada lo procesa solo: quien lea el buzón tiene que marcar a la
  persona como *No contactar* en el CRM. Desde ese momento la función ya no le envía nada.

---

## 8. Problemas frecuentes

| Lo que ve el vendedor | Causa probable | Qué hacer |
|---|---|---|
| No aparece «Enviar automático» | Función sin desplegar, o faltan los secretos | §3 y §4 |
| «Envío automático sin configurar…» | Falta `RESEND_API_KEY` o `CORREO_REMITENTE` | §4, paso 4 |
| «Inicia sesión en el CRM…» / «Tu sesión venció…» | Sesión cerrada o vencida | Volver a iniciar sesión |
| «Origen no permitido.» | Se llamó desde un dominio fuera de la lista CORS | §5, orígenes permitidos |
| «La base todavía no tiene fn_datos_aviso_visita…» | Falta aplicar la migración 13 | §2 |
| «No se envió el correo: Resend respondió 403/422…» | Dominio sin verificar, remitente de otro dominio o clave sin permiso | §4, pasos 2 y 3 |
| «No se pudo confirmar el envío…» | Resend tardó más de 10 s | Confirmar con el cliente o en el panel de Resend antes de reintentar |
| «El correo salió…, pero no quedó registrado» | El correo salió; falló el registro en la base | **No reenviar**; avisar a Dirección |
