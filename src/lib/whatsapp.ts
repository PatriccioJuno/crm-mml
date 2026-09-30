/**
 * Enlaces para escribir, llamar o ver el perfil de un prospecto.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO HAY `wa.me` EN ESTE ARCHIVO
 * ---------------------------------------------------------------------------
 * El repo evito `https://wa.me/<numero>` a proposito
 * (src/paginas/cobranza/DialogoGestion.tsx): ese enlace manda el numero de un
 * TERCERO a un dominio web externo, que lo recibe en la URL antes de que nadie
 * pulse «enviar». Con datos personales (Ley 29733, 01-documentacion\
 * 05-SEGURIDAD-BACKUPS-Y-LEY-29733.md: minimo necesario) eso es un tratamiento
 * mas que no hace falta.
 *
 * `whatsapp://send?...` abre la aplicacion instalada en el dispositivo sin
 * pasar por ninguna web (SPEC 13 §2). Si el dispositivo no la tiene, el enlace
 * simplemente no abre nada: por eso la interfaz ofrece SIEMPRE, al lado,
 * «Copiar numero» y «Copiar mensaje» (copiarAlPortapapeles de cobranza.ts).
 *
 * Este archivo no contiene ninguna cifra ni ninguna regla de negocio: solo
 * arma enlaces con lo que recibe, y no inventa lo que no recibe.
 */

/** '+51999888777' → '51999888777'. Solo digitos: es lo que esperan `phone=` y `tel:`. */
export function digitosTelefono(e164: string): string {
  return e164.replace(/\D/g, '')
}

/**
 * Enlace a la aplicacion de WhatsApp, con el mensaje ya escrito si se da.
 *
 * El texto se codifica con `encodeURIComponent`: los saltos de linea, las
 * tildes y los signos de interrogacion de una plantilla (plantillas.ts) tienen
 * que llegar tal cual al chat, no cortados en el primer `&` o `?`.
 */
export function enlaceWhatsApp(e164: string, texto?: string | undefined): string {
  const base = `whatsapp://send?phone=${digitosTelefono(e164)}`
  const mensaje = texto?.trim() ?? ''
  return mensaje === '' ? base : `${base}&text=${encodeURIComponent(mensaje)}`
}

/**
 * `tel:+51...` — el marcador del telefono. Se reconstruye con el `+` delante
 * a partir de los digitos, para que un valor con espacios o guiones (que no
 * deberia existir en `telefono_e164`, pero la base no lo impide del todo) no
 * produzca un enlace que el marcador no entiende.
 */
export function enlaceLlamada(e164: string): string {
  return `tel:+${digitosTelefono(e164)}`
}

/**
 * Formato de un usuario de red valido — el mismo que exige
 * `fn_registrar_prospecto` en 13-seguimiento-comercial.sql (SPEC §4.5:
 * `^[a-z0-9._]{2,40}$`, guardado en minusculas y sin '@').
 */
const USUARIO_VALIDO = /^[a-z0-9._]{2,40}$/

/**
 * URL del perfil PUBLICO de la red social.
 *
 * Aqui si se usa un dominio externo, y es aceptable por una razon concreta: lo
 * unico que viaja es el usuario publico que la propia persona muestra en esa
 * red (por eso nos escribio desde alli). No viaja telefono, ni nombre, ni
 * nada que no sea ya publico en ese mismo dominio.
 *
 * `null` cuando la red no tiene una URL de perfil conocida ('otra'), cuando
 * falta el usuario o cuando el usuario no tiene el formato valido: un enlace
 * armado con un dato raro abriria el perfil de OTRA persona.
 */
export function enlacePerfilRed(red: string | null, usuario: string | null): string | null {
  if (red === null || usuario === null) return null
  const limpio = usuario.trim().replace(/^@+/, '').toLowerCase()
  if (!USUARIO_VALIDO.test(limpio)) return null

  switch (red) {
    case 'tiktok':
      return `https://www.tiktok.com/@${limpio}`
    case 'instagram':
      return `https://www.instagram.com/${limpio}/`
    case 'facebook':
      return `https://www.facebook.com/${limpio}`
    case 'youtube':
      return `https://www.youtube.com/@${limpio}`
    default:
      return null
  }
}
