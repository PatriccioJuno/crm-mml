import { supabase } from '@/lib/supabase'
import { entero, leerLote, reventar, texto } from '@/lib/lectura'
import { comoRegistro, llamarRpc, type ResultadoAccion } from '@/lib/acciones'
import { ESTADOS } from '@/lib/embudo'

/**
 * Documentos de una persona: DNI, voucher, constancia, contrato, recibo,
 * plano o material entregado.
 *
 * ===========================================================================
 * POR QUE HAY UN BUCKET NUEVO Y NO SE REUSA `comprobantes`
 * ===========================================================================
 * `comprobantes` (09-separaciones-storage.sql) guarda la PRUEBA de que entró
 * un dinero, y su política de lectura no mira a quién pertenece cada archivo.
 * Un DNI no es eso: es un dato personal que solo tienen que ver los roles que
 * operan la venta (Ley 29733, dato mínimo necesario —
 * 01-documentacion/05-SEGURIDAD-BACKUPS-Y-LEY-29733.md). El bucket
 * `documentos` de 13-seguimiento-comercial.sql solo deja leer un archivo si
 * existe su fila en `documentos`, sin archivar, y la política de esa tabla
 * esconde los DNI a lectura y contabilidad.
 *
 * Nada se borra (R8): ni la tabla ni el bucket tienen políticas de UPDATE o
 * DELETE. Un documento equivocado se ARCHIVA con motivo (`fn_archivar_documento`).
 *
 * ===========================================================================
 * EL ORDEN DE LA SUBIDA: PRIMERO LA FILA, LUEGO EL ARCHIVO
 * ===========================================================================
 * `subirComprobante` sube el archivo y después guarda la ruta. Aquí se hace al
 * revés, a propósito. Si el archivo sube y la fila falla (p. ej. un comercial
 * intentando adjuntar a una oportunidad que no es suya: la política de subida
 * del bucket solo mira el rol, la de la tabla mira la oportunidad), queda un
 * DNI en el bucket sin ninguna fila que diga de quién es, que nadie puede leer
 * y que nadie puede borrar. Un dato personal huérfano es peor que ningún dato.
 * Con la fila primero, ese caso falla ANTES de subir nada; y si lo que falla es
 * la subida, la fila se archiva con el motivo y queda la traza.
 *
 * Este archivo no contiene ninguna cifra del negocio. El tope de 10 MB y los
 * tipos admitidos son los del bucket (13-seguimiento-comercial.sql, igual que
 * 09-separaciones-storage.sql líneas 44-50): se repiten aquí solo para avisar
 * antes de gastar la subida; quien los impone es el bucket.
 */

export const BUCKET_DOCUMENTOS = 'documentos'

export const TIPOS_DOCUMENTO = [
  { valor: 'dni', etiqueta: 'DNI / CE' },
  { valor: 'voucher_separacion', etiqueta: 'Voucher del depósito' },
  { valor: 'constancia_separacion', etiqueta: 'Constancia de separación' },
  { valor: 'contrato', etiqueta: 'Contrato' },
  { valor: 'recibo', etiqueta: 'Recibo / comprobante' },
  { valor: 'plano_entregado', etiqueta: 'Plano entregado' },
  { valor: 'material_enviado', etiqueta: 'Material enviado' },
  { valor: 'otro', etiqueta: 'Otro' },
] as const

export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number]['valor']

export function etiquetaTipoDocumento(tipo: string): string {
  return TIPOS_DOCUMENTO.find((t) => t.valor === tipo)?.etiqueta ?? tipo
}

/** Límite del bucket (`file_size_limit`). Técnico, no del negocio. */
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024

/** `allowed_mime_types` del bucket, con la extensión que corresponde a cada uno. */
const TIPOS_ADMITIDOS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
}

/** Para cuando el navegador no dice el tipo (Windows con fotos HEIC de un iPhone lo deja vacío). */
const TIPO_POR_EXTENSION: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
}

/** Lo que dura una URL firmada. Igual que `urlFirmadaComprobante`: basta para abrirlo, no para compartirlo. */
const SEGUNDOS_URL_FIRMADA = 300

export type Documento = {
  id: string
  personaId: string
  oportunidadId: string | null
  tipo: string
  sentido: string
  nombreArchivo: string
  ruta: string
  mime: string | null
  tamanoBytes: number | null
  nota: string | null
  verificadoEl: string | null
  creadoEl: string
  creadoPor: string | null
}

const COLUMNAS_DOCUMENTO =
  'id, persona_id, oportunidad_id, tipo, sentido, nombre_archivo, ruta, mime, tamano_bytes, ' +
  'nota, verificado_el, creado_el, creado_por'

function interpretarDocumento(fila: unknown): Documento | null {
  const f = comoRegistro(fila)
  if (f === null) return null

  const id = texto(f['id'])
  const personaId = texto(f['persona_id'])
  const tipo = texto(f['tipo'])
  const sentido = texto(f['sentido'])
  const nombreArchivo = texto(f['nombre_archivo'])
  const ruta = texto(f['ruta'])
  const creadoEl = texto(f['creado_el'])
  if (
    id === null ||
    personaId === null ||
    tipo === null ||
    sentido === null ||
    nombreArchivo === null ||
    ruta === null ||
    creadoEl === null
  ) {
    return null
  }

  return {
    id,
    personaId,
    oportunidadId: texto(f['oportunidad_id']),
    tipo,
    sentido,
    nombreArchivo,
    ruta,
    mime: texto(f['mime']),
    tamanoBytes: entero(f['tamano_bytes']),
    nota: texto(f['nota']),
    verificadoEl: texto(f['verificado_el']),
    creadoEl,
    creadoPor: texto(f['creado_por']),
  }
}

/**
 * Los documentos vigentes de una persona (de todas sus oportunidades), el más
 * reciente primero. Lo que RLS no deja ver (un DNI para lectura/contabilidad,
 * o el documento de una oportunidad ajena) simplemente no llega. Lanza si
 * falla, para `useQuery`.
 */
export async function cargarDocumentos(personaId: string): Promise<Documento[]> {
  const { data, error } = await supabase
    .from('documentos')
    .select(COLUMNAS_DOCUMENTO)
    .eq('persona_id', personaId)
    .is('archivado_el', null)
    .order('creado_el', { ascending: false })

  reventar('No se pudieron leer los documentos', error)
  return leerLote(data, interpretarDocumento).filas
}

function extensionDe(nombre: string): string | null {
  const punto = nombre.lastIndexOf('.')
  if (punto <= 0) return null
  const extension = nombre.slice(punto + 1).toLowerCase()
  return /^[a-z0-9]{1,5}$/.test(extension) ? extension : null
}

/** `hasOwnProperty` y no `in`: `'constructor' in {}` es verdadero. */
function tiene(mapa: Readonly<Record<string, string>>, clave: string): boolean {
  return Object.prototype.hasOwnProperty.call(mapa, clave)
}

/** El tipo MIME admitido del archivo, o `null` si el bucket lo rechazaría. */
function tipoAdmitido(archivo: File): string | null {
  if (archivo.type !== '') return tiene(TIPOS_ADMITIDOS, archivo.type) ? archivo.type : null
  const extension = extensionDe(archivo.name)
  if (extension === null || !tiene(TIPO_POR_EXTENSION, extension)) return null
  return TIPO_POR_EXTENSION[extension] ?? null
}

/**
 * El nombre original, solo para mostrarlo en la lista. Se recorta y se le
 * quitan los caracteres de control. Ojo: puede llevar datos personales
 * («DNI Juan 4xxxxxxx.jpg»); por eso vive en la fila (protegida por RLS) y
 * NUNCA en la ruta del bucket, que es un identificador aleatorio.
 */
function nombreParaMostrar(nombre: string): string {
  const limpio = nombre.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return limpio === '' ? 'archivo' : limpio.slice(0, 180)
}

function mensajeDeStorageDocumentos(mensaje: string): string {
  if (mensaje.includes('Bucket not found')) {
    return (
      'Falta ejecutar sql/13-seguimiento-comercial.sql en Supabase: el bucket «documentos» ' +
      'no existe todavía.'
    )
  }
  if (mensaje.includes('exceeded the maximum allowed size')) {
    return 'El archivo pesa más de 10 MB. Sube una foto más ligera o un PDF.'
  }
  if (mensaje.includes('mime type') || mensaje.includes('not supported')) {
    return 'Ese tipo de archivo no se admite. Sube una imagen (JPG, PNG, WEBP, HEIC) o un PDF.'
  }
  if (mensaje.includes('row-level security') || mensaje.includes('Unauthorized')) {
    return 'Tu rol no puede subir documentos (política documentos_subir). Habla con Walter.'
  }
  return `No se pudo subir el archivo: ${mensaje}`
}

function mensajeDeFila(mensaje: string): string {
  if (mensaje.includes('row-level security') || mensaje.includes('permission denied')) {
    return (
      'La base no dejó registrar el documento: tu rol no puede adjuntar documentos a esta ' +
      'oportunidad (solo quien la lleva, Dirección o Administración). No se subió nada.'
    )
  }
  if (mensaje.includes('could not find') || mensaje.includes('does not exist')) {
    return 'Falta ejecutar sql/13-seguimiento-comercial.sql en Supabase: la tabla «documentos» no existe.'
  }
  return `No se pudo registrar el documento: ${mensaje}`
}

/** 'aaaa-mm' del momento de la subida: solo para ordenar el bucket por carpetas al mirarlo. */
function carpetaDelMes(fecha: Date): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Registra y sube un documento. Ver arriba por qué primero la fila.
 *
 * El `id` se genera aquí (y es también el nombre del archivo) para no tener
 * que pedirle a la base que devuelva la fila: si la fila se pidiera de vuelta,
 * PostgREST exigiría además la política de LECTURA, y un comercial que adjunta
 * a nivel de persona (sin oportunidad) tiene permiso de insertar pero no de
 * leer — el alta fallaría por la razón equivocada. `creado_por` lo pone la
 * base (`default auth.uid()`), que es lo que exige la política de alta.
 */
export async function subirDocumento(d: {
  archivo: File
  personaId: string
  oportunidadId: string | null
  tipo: TipoDocumento
  sentido: 'recibido' | 'enviado'
  nota?: string | undefined
}): Promise<ResultadoAccion<Documento>> {
  const mime = tipoAdmitido(d.archivo)
  if (mime === null) {
    return {
      ok: false,
      motivo: 'Ese tipo de archivo no se admite. Sube una imagen (JPG, PNG, WEBP, HEIC) o un PDF.',
    }
  }
  if (d.archivo.size > TAMANO_MAXIMO_BYTES) {
    return { ok: false, motivo: 'El archivo pesa más de 10 MB. Sube una foto más ligera o un PDF.' }
  }
  if (d.archivo.size === 0) {
    return { ok: false, motivo: 'El archivo está vacío. Vuelve a elegirlo.' }
  }

  const ahora = new Date()
  const id = crypto.randomUUID()
  const extension = TIPOS_ADMITIDOS[mime] ?? extensionDe(d.archivo.name) ?? 'bin'
  const ruta = `${d.oportunidadId ?? d.personaId}/${carpetaDelMes(ahora)}/${id}.${extension}`
  const nombreArchivo = nombreParaMostrar(d.archivo.name)
  const notaLimpia = d.nota === undefined || d.nota.trim() === '' ? null : d.nota.trim()

  // 1 · La fila. Sin `.select()`: ver el comentario de la función.
  const { error: errorFila } = await supabase.from('documentos').insert({
    id,
    persona_id: d.personaId,
    oportunidad_id: d.oportunidadId,
    tipo: d.tipo,
    sentido: d.sentido,
    nombre_archivo: nombreArchivo,
    ruta,
    mime,
    tamano_bytes: d.archivo.size,
    nota: notaLimpia,
  })
  if (errorFila !== null) return { ok: false, motivo: mensajeDeFila(errorFila.message) }

  // 2 · El archivo.
  const { error: errorArchivo } = await supabase.storage
    .from(BUCKET_DOCUMENTOS)
    .upload(ruta, d.archivo, { contentType: mime, upsert: false })

  if (errorArchivo !== null) {
    const motivo = mensajeDeStorageDocumentos(errorArchivo.message)
    // La fila no se borra (R8): se archiva diciendo por qué. Si hasta eso
    // falla, se dice — una fila visible sin archivo no debe quedar callada.
    const archivado = await archivarDocumento(id, `La subida del archivo falló: ${motivo}`)
    return {
      ok: false,
      motivo: archivado.ok
        ? motivo
        : `${motivo} Además, el registro quedó sin archivo y no se pudo archivar (${archivado.motivo}).`,
    }
  }

  const { data: sesion } = await supabase.auth.getSession()
  return {
    ok: true,
    datos: {
      id,
      personaId: d.personaId,
      oportunidadId: d.oportunidadId,
      tipo: d.tipo,
      sentido: d.sentido,
      nombreArchivo,
      ruta,
      mime,
      tamanoBytes: d.archivo.size,
      nota: notaLimpia,
      verificadoEl: null,
      // La hora del navegador, no la de la base: la fila no se pidió de vuelta.
      // La lista la relee con `cargarDocumentos` y ahí manda la de la base.
      creadoEl: ahora.toISOString(),
      creadoPor: sesion.session?.user.id ?? null,
    },
  }
}

/** URL temporal para mirar un documento, o `null` si no se puede (sin fila, archivado o sin permiso). */
export async function urlFirmadaDocumento(ruta: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET_DOCUMENTOS)
    .createSignedUrl(ruta, SEGUNDOS_URL_FIRMADA)

  if (error !== null) return null
  return data.signedUrl
}

/**
 * Archiva un documento con su motivo (R8: nada se borra). Pueden Dirección,
 * Administración o quien lo subió; lo comprueba `fn_archivar_documento`.
 * Archivado, el archivo deja de poder abrirse (la política del bucket exige
 * una fila SIN archivar), pero sigue existiendo para una auditoría.
 */
export async function archivarDocumento(id: string, motivo: string): Promise<ResultadoAccion<true>> {
  const limpio = motivo.trim()
  if (limpio === '') {
    return { ok: false, motivo: 'Escribe por qué se archiva: queda en el registro (R8).' }
  }
  return llamarRpc('fn_archivar_documento', { p_documento_id: id, p_motivo: limpio }, (r) =>
    comoRegistro(r)?.['ok'] === true ? true : null,
  )
}

// ---------------------------------------------------------------------------
// Qué documentos se esperan en cada estado del embudo
// ---------------------------------------------------------------------------

export type RequisitoDocumento = {
  tipo: TipoDocumento
  etiqueta: string
  cuando: string
  fuente: string
}

const DNI: RequisitoDocumento = {
  tipo: 'dni',
  etiqueta: 'DNI / CE',
  cuando: 'Antes de separar',
  fuente: '07-crm/06-operacion/HOJA-CAPTURA-DIA-0.md:57 (documento obligatorio antes de separar)',
}

const VOUCHER: RequisitoDocumento = {
  tipo: 'voucher_separacion',
  etiqueta: 'Voucher del depósito',
  cuando: 'Al registrar la separación',
  fuente: '07-crm/01-documentacion/04-MANUAL-DE-USO.md §2.4 punto 2 (sube el comprobante)',
}

const CONSTANCIA: RequisitoDocumento = {
  tipo: 'constancia_separacion',
  etiqueta: 'Constancia de separación',
  cuando: 'Solo después de que Walter verifique (R3)',
  fuente: '07-crm/CLAUDE.md §4 R3 · Acta 03-O02 (04-MANUAL-DE-USO.md §2.4 punto 4)',
}

const CONTRATO: RequisitoDocumento = {
  tipo: 'contrato',
  etiqueta: 'Contrato',
  cuando: 'Al firmar (estado Contrato)',
  fuente: '07-crm/01-documentacion/04-MANUAL-DE-USO.md §1 (estado 7: firmado)',
}

const RECIBO: RequisitoDocumento = {
  tipo: 'recibo',
  etiqueta: 'Recibo / comprobante',
  cuando: 'Cuando entra la inicial, y solo tras la verificación (R3)',
  fuente: '07-crm/01-documentacion/04-MANUAL-DE-USO.md §1 (estado 8: la inicial entró) · R3',
}

/** Posición de un estado en el embudo (0 = captado), o `null` si este cliente no lo conoce. */
function posicionEnEmbudo(estado: string): number | null {
  const i = ESTADOS.findIndex((e) => e.valor === estado)
  return i === -1 ? null : i
}

const POS_SEPARACION = posicionEnEmbudo('05_separacion')
const POS_CONTRATO = posicionEnEmbudo('07_contrato')
const POS_INICIAL = posicionEnEmbudo('08_inicial_cobrada')

/**
 * Los documentos que se esperan en un estado, con cuándo y de dónde sale cada
 * exigencia. Se compara por POSICIÓN en `ESTADOS` de src/lib/embudo.ts (los 10
 * estados aprobados de embudo-y-metricas.md §1), no por el número del nombre:
 * si un día cambia el prefijo, la lista sigue siendo la de la base.
 *
 * Un estado desconocido no devuelve nada: mejor una lista vacía que exigir
 * papeles que no tocan.
 */
export function documentosEsperados(estado: string): RequisitoDocumento[] {
  const pos = posicionEnEmbudo(estado)
  if (pos === null || POS_SEPARACION === null || POS_CONTRATO === null || POS_INICIAL === null) {
    return []
  }
  if (pos < POS_SEPARACION) return [DNI]

  const lista: RequisitoDocumento[] = [DNI, VOUCHER, CONSTANCIA]
  if (pos >= POS_CONTRATO) lista.push(CONTRATO)
  if (pos >= POS_INICIAL) lista.push(RECIBO)
  return lista
}
