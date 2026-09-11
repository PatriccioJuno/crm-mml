import { supabase } from '@/lib/supabase'

/**
 * El bucket de comprobantes, en un solo sitio.
 *
 * ===========================================================================
 * POR QUE ESTO SALIO DE src/lib/separaciones.ts
 * ===========================================================================
 * Estas tres funciones nacieron dentro de `separaciones.ts` porque el primer
 * comprobante que hubo que subir fue el voucher del deposito de una
 * separacion. Cobranza necesita exactamente lo mismo para el comprobante de un
 * pago — mismo bucket, mismas politicas, mismo bucket privado con URL firmada.
 *
 * Copiarlas habria dado DOS criterios sobre como se nombra un archivo, cuanto
 * dura una URL firmada y que mensaje se enseña cuando falta el bucket. Dos
 * criterios sobre lo mismo acaban divergiendo; es el mismo patron que ya se
 * evito en `src/lib/lectura.ts`. Asi que hay uno, aqui, y `separaciones.ts`
 * lo reexporta para no romper a quien ya lo importaba de alli.
 *
 * El bucket lo crea 02-codigo\sql\09-separaciones-storage.sql. Es PRIVADO, y
 * sus politicas no permiten ni UPDATE ni DELETE: R8, nada se borra. Un
 * comprobante es la prueba de que entro un dinero.
 *
 * Este archivo no contiene ninguna cifra del negocio.
 */

export const BUCKET_COMPROBANTES = 'comprobantes'

/**
 * Sube el archivo y devuelve la RUTA del objeto, no una URL.
 *
 * El bucket es privado, asi que una URL publica no existe y una firmada
 * caduca. Lo que se guarda en la columna (`separaciones.comprobante_url`,
 * `pagos.comprobante_url`) es la ruta —lo unico estable—, y la URL para
 * mirarlo se pide en el momento con `urlFirmadaComprobante`.
 *
 * 🟡 Las dos columnas se llaman `..._url` y lo que guardan es una ruta. No se
 * renombran desde aqui: cambiar el nombre de una columna del esquema es una
 * migracion, y no se hace de tapadillo. Queda anotado.
 *
 * `prefijo` separa los comprobantes de separacion de los de pago dentro del
 * mismo bucket. No es seguridad —las politicas no miran la carpeta—, es poder
 * saber de que es cada archivo al mirar el bucket desde el panel.
 *
 * El nombre del archivo no lleva el nombre de la persona ni su documento: solo
 * un identificador aleatorio. Un nombre de archivo viaja en registros y en
 * URLs firmadas, y no tiene por que llevar un dato personal encima.
 */
export async function subirComprobante(
  archivo: File,
  prefijo = '',
): Promise<{ ok: true; ruta: string } | { ok: false; motivo: string }> {
  const extension = extensionDe(archivo.name)
  const ahora = new Date()
  const mes = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`
  const carpeta = prefijo === '' ? mes : `${prefijo}/${mes}`
  const ruta = `${carpeta}/${crypto.randomUUID()}${extension}`

  const { error } = await supabase.storage
    .from(BUCKET_COMPROBANTES)
    .upload(ruta, archivo, { contentType: archivo.type, upsert: false })

  if (error !== null) {
    return { ok: false, motivo: mensajeDeStorage(error.message) }
  }
  return { ok: true, ruta }
}

/** URL temporal para mirar un comprobante. Caduca: es un bucket privado. */
export async function urlFirmadaComprobante(ruta: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET_COMPROBANTES)
    .createSignedUrl(ruta, 300)

  if (error !== null) return null
  return data.signedUrl
}

function extensionDe(nombre: string): string {
  const punto = nombre.lastIndexOf('.')
  if (punto <= 0) return ''
  const extension = nombre.slice(punto).toLowerCase()
  return /^\.[a-z0-9]{1,5}$/.test(extension) ? extension : ''
}

export function mensajeDeStorage(mensaje: string): string {
  if (mensaje.includes('Bucket not found')) {
    return (
      'Falta ejecutar 02-codigo\\sql\\09-separaciones-storage.sql en Supabase: el bucket ' +
      '«comprobantes» no existe todavía.'
    )
  }
  if (mensaje.includes('exceeded the maximum allowed size')) {
    return 'El archivo pesa más de 10 MB. Sube una foto más ligera o el PDF del banco.'
  }
  if (mensaje.includes('mime type') || mensaje.includes('not supported')) {
    return 'Ese tipo de archivo no se admite. Sube una imagen (JPG, PNG, WEBP, HEIC) o un PDF.'
  }
  if (mensaje.includes('row-level security') || mensaje.includes('Unauthorized')) {
    return 'Tu rol no puede subir comprobantes (política comprobantes_subir). Habla con Walter.'
  }
  return `No se pudo subir el comprobante: ${mensaje}`
}
