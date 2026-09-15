import { useEffect, useState } from 'react'
import { CloudOff, Download, RefreshCw, Share } from 'lucide-react'
import { cn } from '@/lib/utils'
import { esIOS, esInstalada, instalar, vigilarInstalacion } from '@/lib/pwa'

/**
 * Lo que el CRM enseña sobre sí mismo: si está sin conexión, si hay una
 * versión nueva, y cómo instalarlo en el teléfono.
 */

// ---------------------------------------------------------------------------
// Aviso de estado (abajo del todo, fijo)
// ---------------------------------------------------------------------------

/**
 * Dos avisos que comparten sitio porque nunca hacen falta los dos a la vez, y
 * porque los dos dicen lo mismo: «lo que ves ahora mismo no es de fiar».
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ «SIN CONEXIÓN» NO DICE «MODO SIN CONEXIÓN»
 * ---------------------------------------------------------------------------
 * Porque no lo hay. El service worker guarda el cascarón de la aplicación,
 * nunca los datos (ver public/sw.js). Así que sin red el CRM arranca y no
 * puede consultar nada — y eso es exactamente lo que dice el aviso.
 *
 * La tentación aquí es escribir «trabajando sin conexión», que suena mejor y
 * es mentira: daría a entender que lo que hay en pantalla sigue valiendo.
 */
export function AvisoEstado({ hayVersionNueva, alActualizar }: {
  hayVersionNueva: boolean
  alActualizar: () => void
}) {
  const [sinConexion, setSinConexion] = useState(() => !navigator.onLine)

  useEffect(() => {
    const conectar = () => setSinConexion(false)
    const desconectar = () => setSinConexion(true)

    window.addEventListener('online', conectar)
    window.addEventListener('offline', desconectar)
    return () => {
      window.removeEventListener('online', conectar)
      window.removeEventListener('offline', desconectar)
    }
  }, [])

  if (!sinConexion && !hayVersionNueva) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex justify-center px-4',
        'pb-[calc(1rem+env(safe-area-inset-bottom))]',
        'pointer-events-none',
      )}
    >
      <div
        className={cn(
          'pointer-events-auto flex max-w-lg items-center gap-3 rounded-lg bg-azul px-4 py-3',
          'text-cal shadow-flotante',
          'animate-in slide-in-from-bottom-2 duration-200',
        )}
      >
        {sinConexion ? (
          <>
            <CloudOff className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <p className="text-sm leading-snug">
              <span className="font-bold">Sin conexión.</span>{' '}
              <span className="text-cal/70">
                El CRM no puede consultar ni guardar nada hasta que vuelva.
              </span>
            </p>
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <p className="text-sm leading-snug">
              <span className="font-bold">Hay una versión nueva.</span>{' '}
              <span className="text-cal/70">Se aplica al recargar.</span>
            </p>
            {/* Ámbar sobre azul: permitido. */}
            <button
              type="button"
              onClick={alActualizar}
              className={cn(
                'shrink-0 rounded-sm bg-ambar px-3 py-1.5 text-sm font-bold text-suelo',
                'transition-colors hover:bg-ambar/90',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cal',
              )}
            >
              Actualizar
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Instalar
// ---------------------------------------------------------------------------

/**
 * El botón de instalar, para el pie de la barra lateral.
 *
 * Se esconde solo en los tres casos en que no pinta nada: cuando el CRM ya
 * está instalado, cuando el navegador no ofrece instalarlo (escritorio sin
 * soporte, Firefox de Android) y cuando ya se instaló en esta visita.
 *
 * ###########################################################################
 * #  EN iOS NO HAY BOTÓN QUE VALGA                                          #
 * #                                                                         #
 * #  Safari no dispara `beforeinstallprompt` y ninguna web puede abrir el    #
 * #  menú Compartir. Lo único posible es explicar los dos toques, y por eso  #
 * #  en iOS esto no es un botón que instala: es un botón que enseña cómo.    #
 * #  Fingir un botón de instalar que no instala sería peor que no ponerlo.   #
 * ###########################################################################
 */
export function BotonInstalar() {
  const [sePuedeInstalar, setSePuedeInstalar] = useState(false)
  const [ayudaIOS, setAyudaIOS] = useState(false)

  const yaInstalada = esInstalada()
  const ios = esIOS()

  useEffect(() => vigilarInstalacion(setSePuedeInstalar), [])

  if (yaInstalada) return null
  if (!sePuedeInstalar && !ios) return null

  async function alPulsar() {
    if (ios) {
      setAyudaIOS((previo) => !previo)
      return
    }
    const aceptada = await instalar()
    if (aceptada) setSePuedeInstalar(false)
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => void alPulsar()}
        aria-expanded={ios ? ayudaIOS : undefined}
        className={cn(
          'flex w-full items-center gap-2 rounded-sm border border-velo-borde px-3 py-2',
          'text-[0.8125rem] font-bold text-cal transition-colors',
          'hover:bg-velo',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ambar',
        )}
      >
        <Download className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span>{ios ? 'Cómo instalarlo' : 'Instalar la app'}</span>
      </button>

      {ios && ayudaIOS && (
        <div className="mt-2 rounded-sm bg-velo p-3 text-[0.6875rem] leading-relaxed text-cal/70">
          <p className="mb-2 font-bold text-cal">En iPhone o iPad, desde Safari:</p>
          <ol className="list-inside list-decimal space-y-1">
            <li>
              Toca{' '}
              <Share className="inline h-3 w-3 align-[-1px]" strokeWidth={2} aria-label="Compartir" />{' '}
              Compartir, abajo.
            </li>
            <li>Elige «Añadir a pantalla de inicio».</li>
          </ol>
          <p className="mt-2">
            Tiene que ser Safari: desde Chrome de iPhone esa opción no aparece.
          </p>
        </div>
      )}
    </div>
  )
}
