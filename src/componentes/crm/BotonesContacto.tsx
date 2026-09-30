import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Check, Copy, ExternalLink, MessageCircle, Phone } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { cn } from '@/lib/utils'
import { enlaceLlamada, enlacePerfilRed, enlaceWhatsApp } from '@/lib/whatsapp'
import { copiarAlPortapapeles } from '@/lib/cobranza'

/**
 * BOTONES DE CONTACTO — WhatsApp · Llamar · Copiar · Perfil de la red.
 *
 * ---------------------------------------------------------------------------
 * POR QUE `whatsapp://` Y NO `wa.me`
 * ---------------------------------------------------------------------------
 * `wa.me/<número>` manda el teléfono de un tercero a un dominio web externo
 * sin que nadie lo haya decidido (Ley 29733; el repo lo evitó a propósito en
 * src/paginas/cobranza/DialogoGestion.tsx). `whatsapp://send` abre la app
 * instalada directamente, sin pasar por la web (src/lib/whatsapp.ts). Si el
 * equipo no tiene WhatsApp, el enlace no hace nada — por eso «Copiar» está
 * SIEMPRE, como salida de emergencia.
 *
 * ---------------------------------------------------------------------------
 * ABRIR NO ES CONTACTAR
 * ---------------------------------------------------------------------------
 * Pulsar un botón no registra nada: abrir WhatsApp no prueba que se haya
 * escrito. `alUsar` solo avisa a la pantalla (p. ej. para recordar el canal o
 * precargar el panel de contacto); la interacción se registra cuando el
 * vendedor dice cómo fue. Mismo criterio que la gestión de cobranza.
 *
 * ---------------------------------------------------------------------------
 * TAMAÑO
 * ---------------------------------------------------------------------------
 * En el móvil son iconos cuadrados de 44 px con la palabra solo para lectores
 * de pantalla (en una fila de lista no caben cuatro palabras); desde `sm` se
 * ve la palabra. `sobreAzul` usa el contorno cal (`outlineCal`) para la
 * cabecera de la ficha.
 *
 * Los clics no se propagan: estos botones viven dentro de filas que enteras
 * son un enlace a la ficha, y pulsar «Llamar» no debe además abrir la ficha.
 */

type CanalBoton = 'whatsapp' | 'llamada' | 'copiar' | 'red'

/** Cuánto se ve el «Copiado». Tiempo de interfaz, no del negocio. */
const MS_AVISO_COPIADO = 2000

export function BotonesContacto({
  telefonoE164,
  usuarioRed = null,
  redSocial = null,
  mensaje,
  alUsar,
  tamano = 'default',
  sobreAzul = false,
  className,
}: {
  telefonoE164: string | null
  usuarioRed?: string | null | undefined
  redSocial?: string | null | undefined
  /** Texto para WhatsApp y para «Copiar». Sin él, «Copiar» copia el número. */
  mensaje?: string | undefined
  alUsar?: ((canal: CanalBoton) => void) | undefined
  tamano?: 'sm' | 'default' | undefined
  sobreAzul?: boolean | undefined
  className?: string | undefined
}) {
  const [copiado, setCopiado] = useState<'si' | 'no' | null>(null)
  const temporizador = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (temporizador.current !== null) window.clearTimeout(temporizador.current)
    },
    [],
  )

  const perfil = enlacePerfilRed(redSocial, usuarioRed)
  const hayMensaje = mensaje !== undefined && mensaje.trim() !== ''
  const textoACopiar = hayMensaje ? mensaje : telefonoE164

  const variante = sobreAzul ? 'outlineCal' : 'outline'
  // 44 px en el móvil siempre; en escritorio, el alto del tamaño pedido.
  const alto =
    tamano === 'sm'
      ? 'h-11 min-w-11 px-3 sm:h-8 sm:min-w-0'
      : 'h-11 min-w-11 px-3 sm:h-10 sm:min-w-0 sm:px-4'

  async function alCopiar(): Promise<void> {
    if (textoACopiar === null) return
    alUsar?.('copiar')
    const ok = await copiarAlPortapapeles(textoACopiar)
    setCopiado(ok ? 'si' : 'no')
    if (temporizador.current !== null) window.clearTimeout(temporizador.current)
    temporizador.current = window.setTimeout(() => setCopiado(null), MS_AVISO_COPIADO)
  }

  function detener(evento: MouseEvent<HTMLDivElement>): void {
    evento.stopPropagation()
  }

  if (telefonoE164 === null && perfil === null && !hayMensaje) {
    return (
      <p className={cn('text-xs', sobreAzul ? 'text-cal/70' : 'text-suelo-700', className)}>
        Sin teléfono ni usuario para contactar.
      </p>
    )
  }

  const etiquetaCopiar = hayMensaje ? 'Copiar mensaje' : 'Copiar número'

  return (
    <div
      role="group"
      aria-label="Contactar"
      onClick={detener}
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      {telefonoE164 !== null && (
        <>
          <Button asChild variant={variante} size={tamano === 'sm' ? 'sm' : 'default'} className={alto}>
            <a href={enlaceWhatsApp(telefonoE164, mensaje)} onClick={() => alUsar?.('whatsapp')}>
              <MessageCircle aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">WhatsApp</span>
            </a>
          </Button>
          <Button asChild variant={variante} size={tamano === 'sm' ? 'sm' : 'default'} className={alto}>
            <a href={enlaceLlamada(telefonoE164)} onClick={() => alUsar?.('llamada')}>
              <Phone aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">Llamar</span>
            </a>
          </Button>
        </>
      )}

      {textoACopiar !== null && (
        <Button
          type="button"
          variant={variante}
          size={tamano === 'sm' ? 'sm' : 'default'}
          className={alto}
          onClick={() => void alCopiar()}
          title={etiquetaCopiar}
        >
          {copiado === 'si' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {/* La palabra visible es corta («Copiar»); el lector de pantalla oye la
              acción completa («Copiar mensaje» / «Copiar número»). */}
          <span aria-hidden="true" className="hidden sm:inline">
            {copiado === 'si' ? 'Copiado' : copiado === 'no' ? 'No se pudo copiar' : 'Copiar'}
          </span>
          <span className="sr-only">
            {copiado === 'si' ? 'Copiado' : copiado === 'no' ? 'No se pudo copiar' : etiquetaCopiar}
          </span>
        </Button>
      )}

      {perfil !== null && (
        <Button asChild variant={variante} size={tamano === 'sm' ? 'sm' : 'default'} className={alto}>
          <a
            href={perfil}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => alUsar?.('red')}
            title={`Abrir el perfil público @${usuarioRed ?? ''}`}
          >
            <ExternalLink aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Perfil</span>
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        </Button>
      )}

      {/* El resultado de copiar, anunciado. Si falla, se dice: no se finge que se copió. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copiado === 'si' ? 'Copiado' : copiado === 'no' ? 'No se pudo copiar. Cópialo a mano.' : ''}
      </span>
    </div>
  )
}
