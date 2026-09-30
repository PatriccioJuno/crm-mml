/**
 * EDGE FUNCTION `aviso-visita` — el envío AUTOMÁTICO del aviso de una visita:
 * un correo al PROSPECTO, enviado por Resend, con la invitación `.ics` adjunta.
 *
 * ===========================================================================
 * aviso-visita.ts ES UNA COPIA — NO SE EDITA AQUÍ
 * ===========================================================================
 * `./aviso-visita.ts` es una copia BYTE A BYTE de src/lib/aviso-visita.ts
 * (SPEC §5). Deno no resuelve `@/lib/...`, y el correo automático tiene que
 * decir EXACTAMENTE lo mismo que el manual (`mailto:` + `.ics` + WhatsApp del
 * navegador). Si cambia el original, se vuelve a copiar con la shell y se
 * comprueba, antes de desplegar:
 *
 *   cp src/lib/aviso-visita.ts supabase/functions/aviso-visita/aviso-visita.ts
 *   cmp src/lib/aviso-visita.ts supabase/functions/aviso-visita/aviso-visita.ts
 *
 * Este archivo NO escribe texto para el cliente: solo transporta el que arma
 * aquella copia. Por eso aquí no hay ni una frase que lea el prospecto.
 *
 * ===========================================================================
 * CON QUÉ PERMISOS CORRE — LOS DEL USUARIO, NUNCA LOS DEL SERVIDOR
 * ===========================================================================
 * 07-crm/CLAUDE.md §5: la clave service_role (y su sucesora, la secret key)
 * no sale nunca del lugar donde vive. Esta función NO la lee: ni
 * SUPABASE_SERVICE_ROLE_KEY ni SUPABASE_SECRET_KEYS aparecen en este archivo.
 *
 * Reenvía a PostgREST las cabeceras `Authorization` (el JWT de la sesión del
 * vendedor) y `apikey` (la clave PUBLICABLE) que trae la llamada. Así
 * `fn_datos_aviso_visita` y `fn_registrar_aviso_visita` corren como ESA
 * persona: `es(...)`, `puede_operar_oportunidad` y RLS aplican igual que en la
 * pantalla. Un comercial no puede, a través de esta función, escribirle al
 * prospecto de otro — la base se lo niega, no este archivo.
 *
 * Documentación de Supabase (consultada el 29/09/2026, «Migrating to
 * publishable and secret API keys» y «JWT Signing Keys»): las claves nuevas
 * `sb_publishable_…` viajan SOLO en `apikey` (en `Authorization: Bearer` se
 * rechazan con «Invalid JWT»), y el `verify_jwt` de la pasarela solo entiende
 * las claves JWT heredadas — que en este proyecto están desactivadas. Por eso
 * la función se despliega con verify_jwt = false (ver README.md) y la sesión
 * se comprueba AQUÍ, contra /auth/v1/user, antes de hacer nada.
 *
 * ===========================================================================
 * INERTE HASTA QUE EXISTAN LOS SECRETOS
 * ===========================================================================
 * Decisión del dueño (29/09/2026, SPEC §1): se despliega apagada. Mientras no
 * existan RESEND_API_KEY y CORREO_REMITENTE en los secretos de Supabase:
 *   · `estado` responde `configurado:false` y la pantalla no ofrece el botón;
 *   · `enviar` responde `{ ok:false, motivo }` con HTTP 200, para que
 *     src/lib/visitas.ts muestre el motivo tal cual.
 *
 * ===========================================================================
 * CONTRATO (POST, cuerpo JSON)
 * ===========================================================================
 *   { accion:'estado' }
 *     → { ok:true, configurado }
 *   { accion:'enviar', visita_id, plantilla:'confirmacion'|'recordatorio'|'cancelacion' }
 *     → { ok:true, id, notificacion_id, faltantes, avisos }   id = id del envío en Resend
 *     → { ok:false, motivo }
 *
 * Códigos HTTP: 200 para todo lo que la pantalla debe mostrar como motivo
 * (sin configurar, sin consentimiento, sin acceso, Resend rechazó); 401 sin
 * sesión válida; 400 cuerpo mal formado; 403 origen no permitido; 405 método;
 * 502 cuando Supabase no contesta; 500 error imprevisto. En TODOS el cuerpo
 * trae `motivo`: visitas.ts (`motivoDeFuncion`) lo lee también de los no-200.
 *
 * ===========================================================================
 * DATOS PERSONALES EN LOS REGISTROS (Ley 29733)
 * ===========================================================================
 * Los `console.*` de una Edge Function quedan guardados en los logs de
 * Supabase. Aquí nunca se escribe un correo, un nombre ni un teléfono: solo
 * el id de la visita y el mensaje técnico del error. El registro de negocio
 * (a quién, cuándo, con qué resultado) vive en `notificaciones`, con RLS.
 *
 * Este archivo no contiene ninguna cifra del negocio: los únicos números son
 * tiempos de espera de red y códigos HTTP.
 */

import {
  armarAviso,
  armarIcs,
  interpretarDatosAviso,
  type DatosAviso,
  type PlantillaAviso,
} from './aviso-visita.ts'

// ---------------------------------------------------------------------------
// Constantes de infraestructura — ninguna es una cifra del negocio
// ---------------------------------------------------------------------------

/**
 * Orígenes que pueden llamar desde un navegador (SPEC §5): el CRM publicado y
 * los dos puertos de Vite (`vite` = 5173, `vite preview` = 4173). Un origen
 * que no está aquí no recibe `Access-Control-Allow-Origin` y el navegador
 * bloquea la respuesta; y además se le contesta 403.
 */
const ORIGENES_PERMITIDOS: readonly string[] = [
  'https://staff.mercadomedialuna.com',
  'http://localhost:5173',
  'http://localhost:4173',
]

/**
 * Las cuatro de SPEC §5 (authorization, x-client-info, apikey, content-type)
 * más las que supabase-js declara en su propio `corsHeaders`
 * (@supabase/supabase-js/cors, v2.116): x-retry-count y las de trazas W3C. Hoy
 * `functions.invoke` no las manda, pero si alguien activa la propagación de
 * trazas en src/lib/supabase.ts, el preflight fallaría sin avisar y el botón
 * «Enviar automático» desaparecería (envioAutomaticoConfigurado → false).
 */
const CABECERAS_PERMITIDAS = [
  'authorization',
  'x-client-info',
  'apikey',
  'content-type',
  'x-retry-count',
  'traceparent',
  'tracestate',
  'baggage',
].join(', ')

const METODOS_PERMITIDOS = 'POST, OPTIONS'

const URL_RESEND = 'https://api.resend.com/emails'

/** SPEC §5: Resend tiene 10 s. Pasado eso no se sabe si el correo salió (ver `enviarPorResend`). */
const MS_ESPERA_RESEND = 10_000

/** Lo mismo para Auth y PostgREST: una pantalla que espera sin límite es peor que un error claro. */
const MS_ESPERA_SUPABASE = 10_000

/** SPEC §5: el nombre con el que el cliente ve el adjunto. */
const NOMBRE_ADJUNTO = 'visita-mercado-media-luna.ics'

/** SPEC §5, textual: lo lee el vendedor y le dice a Dirección qué falta. */
const MOTIVO_SIN_CONFIGURAR =
  'Envío automático sin configurar: faltan RESEND_API_KEY y CORREO_REMITENTE en los secretos de Supabase.'

/** Las tres plantillas de src/lib/aviso-visita.ts (`PlantillaAviso`). */
const PLANTILLAS: readonly PlantillaAviso[] = ['confirmacion', 'recordatorio', 'cancelacion']

/** `visitas.id` es uuid: se comprueba antes de mandarlo a la base. */
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Un JWT de sesión: tres segmentos base64url. Las claves `sb_…` no lo son (y no van en Bearer). */
const PATRON_BEARER_JWT = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/

/** Longitud máxima del error técnico que se guarda (la base recorta a 1000; aquí se deja margen). */
const MAX_ERROR = 900

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type Registro = Record<string, unknown>

/** Resultado interno de cada paso: o el dato, o el motivo en español y el HTTP con que se responde. */
type Paso<T> = { ok: true; datos: T } | { ok: false; motivo: string; http: number }

/** Lo que hace falta para hablar con Supabase COMO el usuario. */
type Conexion = { url: string; apikey: string; authorization: string }

type Secretos = { claveResend: string; remitente: string }

type EnvioResend =
  | { ok: true; id: string }
  | { ok: false; error: string; incierto: boolean }

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function comoRegistro(valor: unknown): Registro | null {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Registro)
    : null
}

function textoLimpio(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const limpio = valor.trim()
  return limpio === '' ? null : limpio
}

function esPlantilla(valor: unknown): valor is PlantillaAviso {
  return typeof valor === 'string' && (PLANTILLAS as readonly string[]).includes(valor)
}

/** Cierra una frase con punto si no lo trae: los motivos de la base se encadenan con otra frase. */
function conPunto(texto: string): string {
  return /[.!?…]$/.test(texto) ? texto : `${texto}.`
}

function recortar(texto: string): string {
  return texto.length > MAX_ERROR ? `${texto.slice(0, MAX_ERROR)}…` : texto
}

function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Para los `console.*`: un mensaje de Resend puede citar una dirección de
 * correo. En los logs de Supabase no se guarda ninguna (ver cabecera).
 */
function sinCorreos(texto: string): string {
  return texto.replace(/[^\s@<>"']+@[^\s@<>"']+/g, '[correo]')
}

/** Un `fetch` abortado por `AbortSignal.timeout` lanza TimeoutError (o AbortError en runtimes viejos). */
function esTiempoAgotado(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')
}

/**
 * Base64 de los OCTETOS UTF-8 del texto, que es lo que Resend espera en
 * `attachments[].content`. `btoa` solo acepta caracteres de un byte, y el
 * `.ics` lleva tildes («miércoles», «Dónde»): por eso primero TextEncoder y
 * luego una cadena binaria, a trozos para no reventar la pila con
 * `String.fromCharCode(...octetos)` en un adjunto grande.
 */
function base64Utf8(texto: string): string {
  const octetos = new TextEncoder().encode(texto)
  const TROZO = 0x8000
  let binario = ''
  for (let i = 0; i < octetos.length; i += TROZO) {
    binario += String.fromCharCode(...octetos.subarray(i, i + TROZO))
  }
  return btoa(binario)
}

// ---------------------------------------------------------------------------
// Respuestas y CORS
// ---------------------------------------------------------------------------

function cabecerasCors(origen: string | null): Headers {
  const h = new Headers({
    'Access-Control-Allow-Headers': CABECERAS_PERMITIDAS,
    'Access-Control-Allow-Methods': METODOS_PERMITIDOS,
    // La respuesta cambia según el origen: una caché intermedia no debe
    // servirle a un origen la cabecera de otro.
    Vary: 'Origin',
  })
  if (origen !== null && ORIGENES_PERMITIDOS.includes(origen)) {
    h.set('Access-Control-Allow-Origin', origen)
  }
  return h
}

function responder(cuerpo: Registro, http: number, cors: Headers): Response {
  const h = new Headers(cors)
  h.set('Content-Type', 'application/json; charset=utf-8')
  // Lleva el estado de un envío concreto: nada de cachés.
  h.set('Cache-Control', 'no-store')
  return new Response(JSON.stringify(cuerpo), { status: http, headers: h })
}

function rechazo(motivo: string, http: number, cors: Headers): Response {
  return responder({ ok: false, motivo }, http, cors)
}

// ---------------------------------------------------------------------------
// Secretos y conexión
// ---------------------------------------------------------------------------

/** `null` si falta cualquiera de los dos: la función sigue inerte (SPEC §1). */
function leerSecretos(): Secretos | null {
  const claveResend = textoLimpio(Deno.env.get('RESEND_API_KEY'))
  const remitente = textoLimpio(Deno.env.get('CORREO_REMITENTE'))
  return claveResend === null || remitente === null ? null : { claveResend, remitente }
}

/**
 * La clave PUBLICABLE del proyecto, por si la llamada no trajo `apikey`.
 * SUPABASE_PUBLISHABLE_KEYS es un JSON `{ "default": "sb_publishable_…" }`
 * (docs «Environment variables», 29/09/2026). SUPABASE_ANON_KEY queda solo
 * como último recurso: es la heredada, desactivada en este proyecto.
 */
function clavePublicableDelEntorno(): string | null {
  const crudo = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')
  if (crudo !== undefined) {
    try {
      const claves = comoRegistro(JSON.parse(crudo))
      const porDefecto = claves === null ? null : textoLimpio(claves['default'])
      if (porDefecto !== null) return porDefecto
    } catch {
      // JSON ilegible: se sigue con la heredada
    }
  }
  return textoLimpio(Deno.env.get('SUPABASE_ANON_KEY'))
}

/**
 * Arma la conexión «como el usuario» a partir de la llamada.
 *
 *  · `Authorization` tiene que ser un JWT de SESIÓN. Una clave `sb_…` en
 *    Bearer significa «nadie ha iniciado sesión» (supabase-js la pone ahí
 *    cuando no hay sesión): se rechaza sin llamar a nadie.
 *  · `apikey` se reenvía tal cual (SPEC §5) — salvo que sea una clave
 *    SECRETA: si una `sb_secret_…` llegó desde un navegador, alguien la filtró
 *    (07-crm/CLAUDE.md §5) y esta función no va a ser quien la use.
 */
function conexionDelUsuario(req: Request): Paso<Conexion> {
  const url = textoLimpio(Deno.env.get('SUPABASE_URL'))
  if (url === null) {
    return { ok: false, motivo: 'La función no tiene SUPABASE_URL: revisa el despliegue.', http: 500 }
  }

  const authorization = (req.headers.get('Authorization') ?? '').trim()
  if (!PATRON_BEARER_JWT.test(authorization)) {
    return {
      ok: false,
      motivo: 'Inicia sesión en el CRM para usar el envío automático.',
      http: 401,
    }
  }

  const apikeyLlamada = textoLimpio(req.headers.get('apikey'))
  if (apikeyLlamada !== null && apikeyLlamada.startsWith('sb_secret_')) {
    return {
      ok: false,
      motivo:
        'La llamada trae una clave SECRETA de Supabase. Esa clave no puede estar en el navegador: ' +
        'avisa a Dirección para rotarla.',
      http: 400,
    }
  }
  const apikey = apikeyLlamada ?? clavePublicableDelEntorno()
  if (apikey === null) {
    return { ok: false, motivo: 'La llamada no trae la clave pública del proyecto (apikey).', http: 401 }
  }

  return { ok: true, datos: { url: url.replace(/\/+$/, ''), apikey, authorization } }
}

function cabecerasSupabase(c: Conexion): Headers {
  return new Headers({
    apikey: c.apikey,
    Authorization: c.authorization,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  })
}

/**
 * ¿La sesión es válida AHORA? Lo contesta Auth, no este archivo: así vale
 * igual con la clave JWT heredada que con las claves de firma asimétricas, y
 * una sesión cerrada o un usuario baneado quedan fuera aunque su JWT no haya
 * caducado. Es el reemplazo del `verify_jwt` de la pasarela (ver cabecera).
 */
async function comprobarSesion(c: Conexion): Promise<Paso<null>> {
  try {
    const r = await fetch(`${c.url}/auth/v1/user`, {
      method: 'GET',
      headers: cabecerasSupabase(c),
      signal: AbortSignal.timeout(MS_ESPERA_SUPABASE),
    })
    if (r.ok) {
      await r.body?.cancel()
      return { ok: true, datos: null }
    }
    await r.body?.cancel()
    if (r.status === 401 || r.status === 403) {
      return {
        ok: false,
        motivo: 'Tu sesión venció o no es válida. Vuelve a iniciar sesión en el CRM.',
        http: 401,
      }
    }
    return { ok: false, motivo: `Supabase Auth respondió ${r.status}. Inténtalo de nuevo.`, http: 502 }
  } catch (e) {
    return {
      ok: false,
      motivo: esTiempoAgotado(e)
        ? 'Supabase Auth no respondió a tiempo. Inténtalo de nuevo.'
        : `No se pudo comprobar la sesión: ${mensajeDe(e)}`,
      http: 502,
    }
  }
}

/**
 * Llama a una función SQL por PostgREST con las credenciales del usuario.
 *
 * Los `raise exception` de 13-seguimiento-comercial.sql ya están escritos en
 * español para el vendedor («No tienes acceso a esta oportunidad.»): llegan
 * como `{ code:'P0001', message }` y se muestran tal cual, con HTTP 200 —
 * son rechazos de negocio, no fallos de la función.
 */
async function llamarRpc(c: Conexion, funcion: string, args: Registro): Promise<Paso<unknown>> {
  let r: Response
  try {
    r = await fetch(`${c.url}/rest/v1/rpc/${funcion}`, {
      method: 'POST',
      headers: cabecerasSupabase(c),
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(MS_ESPERA_SUPABASE),
    })
  } catch (e) {
    return {
      ok: false,
      motivo: esTiempoAgotado(e)
        ? `La base no respondió a tiempo (${funcion}). Inténtalo de nuevo.`
        : `No se pudo llegar a la base (${funcion}): ${mensajeDe(e)}`,
      http: 502,
    }
  }

  let cuerpo: unknown = null
  try {
    cuerpo = await r.json()
  } catch {
    // cuerpo vacío o no JSON: se decide solo con el código HTTP
  }
  if (r.ok) return { ok: true, datos: cuerpo }

  const error = comoRegistro(cuerpo)
  const codigo = error === null ? null : textoLimpio(error['code'])
  const mensaje = error === null ? null : textoLimpio(error['message'])

  if (r.status === 401) {
    return {
      ok: false,
      motivo: 'Tu sesión venció o no es válida. Vuelve a iniciar sesión en el CRM.',
      http: 401,
    }
  }
  // PGRST202: la función no existe en el caché de esquema de PostgREST.
  if (codigo === 'PGRST202') {
    return {
      ok: false,
      motivo: `La base todavía no tiene ${funcion}: falta aplicar sql/13-seguimiento-comercial.sql.`,
      http: 200,
    }
  }
  // 42501: permiso denegado (la función está revocada para `anon` y `public`).
  if (codigo === '42501') {
    return { ok: false, motivo: 'Tu usuario no tiene permiso para enviar avisos.', http: 200 }
  }
  if (codigo === 'P0001' && mensaje !== null) {
    return { ok: false, motivo: mensaje, http: 200 }
  }
  return {
    ok: false,
    motivo: `La base rechazó ${funcion}${mensaje === null ? ` (HTTP ${r.status})` : `: ${mensaje}`}`,
    http: 200,
  }
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

/**
 * Manda el correo. Solo viaja a Resend lo imprescindible para ese correo
 * (Ley 29733, principio de proporcionalidad): destinatario, asunto, cuerpo y
 * el `.ics`. Sin etiquetas, sin metadatos del CRM.
 *
 * `reply_to` = el correo de contacto 🟢 de la empresa, si existe: el texto
 * dice «responda este correo» y «responda BAJA», y esas respuestas tienen que
 * llegar a alguien que las lea. Si no existe, las respuestas van a
 * CORREO_REMITENTE — por eso el README exige que sea un buzón atendido.
 *
 * `incierto`: si Resend no contesta en 10 s, el correo PUEDE haber salido.
 * No se reintenta aquí (un segundo intento podría duplicarlo); se le dice al
 * vendedor que lo compruebe antes de volver a pulsar.
 */
async function enviarPorResend(
  s: Secretos,
  para: string,
  asunto: string,
  html: string,
  texto: string,
  ics: string,
  responderA: string | null,
): Promise<EnvioResend> {
  const cuerpo: Registro = {
    from: s.remitente,
    to: [para],
    subject: asunto,
    html,
    text: texto,
    attachments: [{ filename: NOMBRE_ADJUNTO, content: base64Utf8(ics) }],
  }
  if (responderA !== null) cuerpo['reply_to'] = responderA

  let r: Response
  try {
    r = await fetch(URL_RESEND, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${s.claveResend}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(MS_ESPERA_RESEND),
    })
  } catch (e) {
    if (esTiempoAgotado(e)) {
      return {
        ok: false,
        error: `Resend no respondió en ${MS_ESPERA_RESEND / 1000} s`,
        incierto: true,
      }
    }
    return { ok: false, error: `No se pudo llegar a Resend: ${mensajeDe(e)}`, incierto: false }
  }

  let respuesta: unknown = null
  try {
    respuesta = await r.json()
  } catch {
    // sin cuerpo JSON: se decide con el código HTTP
  }
  const datos = comoRegistro(respuesta)

  if (!r.ok) {
    // Resend responde `{ statusCode, name, message }` en sus errores.
    const nombre = datos === null ? null : textoLimpio(datos['name'])
    const mensaje = datos === null ? null : textoLimpio(datos['message'])
    const detalle = [nombre, mensaje].filter((x): x is string => x !== null).join(': ')
    return {
      ok: false,
      error: `Resend respondió ${r.status}${detalle === '' ? '' : ` — ${detalle}`}`,
      incierto: false,
    }
  }

  const id = datos === null ? null : textoLimpio(datos['id'])
  if (id === null) {
    // 2xx sin id: lo más probable es que haya salido, pero no hay cómo rastrearlo.
    return { ok: false, error: 'Resend aceptó el envío pero no devolvió su id', incierto: true }
  }
  return { ok: true, id }
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

/**
 * ¿La plantilla tiene sentido para el estado de la visita? El correo
 * automático no tiene «deshacer»:
 *  · una CANCELACIÓN lleva `METHOD:CANCEL`, que BORRA el evento del
 *    calendario del cliente — mandarla para una visita viva sería decirle que
 *    no venga;
 *  · una confirmación o un recordatorio de una visita cancelada, realizada o
 *    reprogramada lo citaría a una hora que ya no existe.
 * `fn_datos_aviso_visita` admite 'agendada', 'confirmada' y 'cancelada' y deja
 * la elección de plantilla a quien llama (13-seguimiento-comercial.sql §5r):
 * esta es esa elección, hecha del lado que no se puede esquivar.
 */
/** Los estados de `visitas.estado` (CHECK de 13-seguimiento-comercial.sql) dichos para el vendedor. */
const ESTADO_LEGIBLE: Readonly<Record<string, string>> = {
  agendada: 'agendada',
  confirmada: 'confirmada',
  realizada: 'realizada',
  no_asistio: 'marcada como «no asistió»',
  reprogramada: 'reprogramada (el aviso va a la visita nueva)',
  cancelada: 'cancelada',
}

function plantillaCoherente(d: DatosAviso, plantilla: PlantillaAviso): string | null {
  const estado = d.visita.estado
  if (plantilla === 'cancelacion') {
    return estado === 'cancelada'
      ? null
      : 'El aviso de cancelación solo se envía cuando la visita ya está cancelada en el CRM.'
  }
  return estado === 'agendada' || estado === 'confirmada'
    ? null
    : `La visita está ${ESTADO_LEGIBLE[estado] ?? estado}: no se le envía ` +
        `${plantilla === 'confirmacion' ? 'una confirmación' : 'un recordatorio'}.`
}

async function accionEnviar(c: Conexion, cuerpo: Registro, cors: Headers): Promise<Response> {
  const visitaId = textoLimpio(cuerpo['visita_id'])
  const plantilla = cuerpo['plantilla']
  if (visitaId === null || !PATRON_UUID.test(visitaId)) {
    return rechazo('Falta visita_id (uuid) en la llamada.', 400, cors)
  }
  if (!esPlantilla(plantilla)) {
    return rechazo('Plantilla no válida: usa confirmacion, recordatorio o cancelacion.', 400, cors)
  }

  // 1 · Inerte sin secretos (SPEC §1 y §5): HTTP 200 para que la pantalla lo muestre.
  const secretos = leerSecretos()
  if (secretos === null) return rechazo(MOTIVO_SIN_CONFIGURAR, 200, cors)

  // 2 · Los datos, COMO el usuario. Si no tiene acceso, la base lo dice.
  const crudo = await llamarRpc(c, 'fn_datos_aviso_visita', { p_visita_id: visitaId })
  if (!crudo.ok) return rechazo(crudo.motivo, crudo.http, cors)

  const d = interpretarDatosAviso(crudo.datos)
  if (d === null) {
    return rechazo(
      'La base devolvió datos incompletos de la visita. No se envió nada.',
      200,
      cors,
    )
  }

  // 3 · Permisos de contacto, fallando CERRADO (Ley 29733). La base ya los
  //     resume en `puede_enviar_email`; aquí se vuelven a mirar por si una
  //     versión futura de la función SQL se equivocara: un «no sé» no
  //     autoriza a escribirle a nadie.
  if (!d.puedeEnviarEmail) {
    return rechazo(d.motivoNoEnvio ?? 'Esta visita no admite aviso por correo.', 200, cors)
  }
  if (d.persona.noContactar) {
    return rechazo('La persona pidió no ser contactada.', 200, cors)
  }
  if (!d.persona.consentimiento) {
    return rechazo('La persona no tiene consentimiento registrado.', 200, cors)
  }
  const para = d.persona.email
  if (para === null) {
    return rechazo('El correo registrado de la persona no es válido. Corrígelo en su ficha.', 200, cors)
  }

  const incoherente = plantillaCoherente(d, plantilla)
  if (incoherente !== null) return rechazo(incoherente, 200, cors)

  // 4 · El texto y la invitación: los MISMOS que el envío manual.
  const aviso = armarAviso(d, plantilla)
  const ics = armarIcs(d, plantilla === 'cancelacion' ? 'CANCEL' : 'REQUEST')

  // 5 · Resend.
  const envio = await enviarPorResend(
    secretos,
    para,
    aviso.asunto,
    aviso.html,
    aviso.texto,
    ics,
    d.empresa.correoContacto,
  )

  // 6 · Registro — SIEMPRE, salga bien o mal (R9 y SPEC §5). Un error de
  //     envío también se anota: es lo que le dice a Dirección que la
  //     configuración de Resend está rota.
  const registro = await llamarRpc(c, 'fn_registrar_aviso_visita', {
    p_visita_id: d.visita.id,
    p_canal: 'email',
    p_modo: 'automatico',
    p_plantilla: plantilla,
    p_destinatario: para,
    p_estado: envio.ok ? 'enviada' : 'error',
    p_proveedor_id: envio.ok ? envio.id : null,
    p_error: envio.ok
      ? null
      : recortar(envio.incierto ? `${envio.error} — estado incierto: puede haber salido` : envio.error),
  })
  const notificacionId = registro.ok
    ? textoLimpio(comoRegistro(registro.datos)?.['notificacion_id'])
    : null
  if (!registro.ok) {
    console.error(
      `[aviso-visita] visita ${d.visita.id}: no se pudo registrar el aviso: ${sinCorreos(registro.motivo)}`,
    )
  }

  if (!envio.ok) {
    console.error(`[aviso-visita] visita ${d.visita.id}: ${sinCorreos(envio.error)}`)
    const partes = [
      envio.incierto
        ? `No se pudo confirmar el envío: ${conPunto(envio.error)} Puede que el correo sí haya salido; ` +
          'antes de reintentar, confírmalo con el cliente o en el panel de Resend.'
        : `No se envió el correo: ${conPunto(envio.error)} El envío manual sigue disponible.`,
    ]
    if (!registro.ok) partes.push(`Además, el fallo no quedó registrado: ${conPunto(registro.motivo)}`)
    return rechazo(partes.join(' '), 200, cors)
  }

  // El correo YA salió: aunque el registro falle se responde ok:true, porque
  // un ok:false invitaría a reenviarlo y el cliente recibiría dos. El
  // problema del registro viaja en `avisos`.
  const avisos: string[] = []
  if (!registro.ok) {
    avisos.push(
      `El correo salió (Resend ${envio.id}), pero no quedó registrado en el historial: ` +
        `${conPunto(registro.motivo)} No lo reenvíes; avisa a Dirección.`,
    )
  }
  return responder(
    {
      ok: true,
      id: envio.id,
      notificacion_id: notificacionId,
      faltantes: aviso.faltantes,
      avisos,
    },
    200,
    cors,
  )
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

async function atender(req: Request): Promise<Response> {
  const origen = req.headers.get('Origin')
  const cors = cabecerasCors(origen)

  // Preflight del navegador: sin cuerpo, sin sesión (el navegador no la manda aquí).
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  if (req.method !== 'POST') return rechazo('Método no permitido: usa POST.', 405, cors)

  // Una llamada SIN Origin no viene de un navegador (curl, un script): CORS no
  // aplica y la decide la sesión. Una CON Origin ajeno se corta aquí.
  if (origen !== null && !ORIGENES_PERMITIDOS.includes(origen)) {
    return rechazo('Origen no permitido.', 403, cors)
  }

  // Nada se contesta sin sesión válida — ni siquiera `estado`.
  const conexion = conexionDelUsuario(req)
  if (!conexion.ok) return rechazo(conexion.motivo, conexion.http, cors)
  const sesion = await comprobarSesion(conexion.datos)
  if (!sesion.ok) return rechazo(sesion.motivo, sesion.http, cors)

  let cuerpo: Registro | null = null
  try {
    cuerpo = comoRegistro(await req.json())
  } catch {
    cuerpo = null
  }
  if (cuerpo === null) return rechazo('El cuerpo de la llamada no es un JSON válido.', 400, cors)

  const accion = cuerpo['accion']
  if (accion === 'estado') {
    return responder({ ok: true, configurado: leerSecretos() !== null }, 200, cors)
  }
  if (accion === 'enviar') return accionEnviar(conexion.datos, cuerpo, cors)
  return rechazo('Acción no válida: usa estado o enviar.', 400, cors)
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    return await atender(req)
  } catch (e) {
    // Último recurso: nunca un 500 sin cuerpo (la pantalla lee `motivo`).
    console.error(`[aviso-visita] error imprevisto: ${sinCorreos(mensajeDe(e))}`)
    return rechazo(
      'Error imprevisto en la función de aviso. El envío manual sigue disponible.',
      500,
      cabecerasCors(req.headers.get('Origin')),
    )
  }
})
