import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Input } from '@/componentes/ui/input'
import { Label } from '@/componentes/ui/label'
import { useSesion } from '@/auth/ContextoSesion'
import { PantallaCargando } from '@/auth/RutaProtegida'

/**
 * Pantalla de entrada. Sobria a proposito: logotipo, dos campos, un boton.
 *
 * Marca: es una superficie AZUL completa, asi que aqui el ambar si es legitimo
 * (regla dura de 07-crm/CLAUDE.md §6: ambar solo sobre azul). Por eso no hay
 * tarjeta blanca: meter el boton ambar dentro de una tarjeta cal romperia la
 * regla, y bajar el boton a azul dejaria la pantalla sin accion principal.
 *
 * No hay enlace a "crear cuenta" porque no existe registro: los usuarios los
 * crea el administrador en el panel de Supabase.
 */
export function PantallaEntrar() {
  const { cargando, usuario, perfil, aviso, entrar } = useSesion()
  const ubicacion = useLocation()

  const [correo, setCorreo] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Mientras se comprueba la sesion guardada (o se lee el perfil recien
  // iniciado) no se dibuja el formulario: evita el parpadeo del login.
  if (cargando) {
    return <PantallaCargando />
  }

  if (usuario !== null && perfil !== null) {
    return <Navigate to={rutaDeVuelta(ubicacion.state)} replace />
  }

  const mensaje = aviso ?? error

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setError(null)
    setEnviando(true)

    const resultado = await entrar(correo, contrasena)

    if (!resultado.ok) {
      setError(resultado.mensaje)
      setContrasena('')
    }
    setEnviando(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-azul px-6 py-12">
      <div className="w-full max-w-sm">
        {/* ---- Logotipo ----
            TODO: cuando exista el isotipo (la luna creciente,
            D:\SCPCMO\07-crm\04-media\marca\logo\), va encima de este bloque,
            a 48 px como maximo. Mismo tratamiento que en BarraLateral. */}
        <div className="mb-10">
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.22em] text-azul-300">
            Mercado
          </p>
          <p className="mt-0.5 text-3xl font-black leading-none tracking-tight text-cal">
            Media Luna
          </p>
          <p className="mt-2 text-[0.6875rem] font-bold uppercase tracking-[0.18em] acento-ambar">
            CRM · SCP Inmobiliaria
          </p>
        </div>

        {mensaje !== null && (
          <div
            role="alert"
            className="mb-6 flex gap-3 rounded-md border-l-2 border-ambar bg-azul-800 px-4 py-3"
          >
            {/* El manual de marca no define un rojo: [PENDIENTE]. Hasta que
                Walter apruebe uno, el aviso se marca con ambar sobre azul
                (permitido) y peso tipografico, no con un color inventado. */}
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 acento-ambar"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <p className="text-sm leading-relaxed text-cal">{mensaje}</p>
          </div>
        )}

        <form onSubmit={alEnviar} noValidate>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="correo" className="text-cal">
                Correo
              </Label>
              <Input
                id="correo"
                type="email"
                name="correo"
                autoComplete="username"
                autoFocus
                required
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                className="h-10 border-azul-600 bg-azul-800 text-cal shadow-none focus-visible:ring-2 focus-visible:ring-ambar"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contrasena" className="text-cal">
                Contraseña
              </Label>
              <Input
                id="contrasena"
                type="password"
                name="contrasena"
                autoComplete="current-password"
                required
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
                className="h-10 border-azul-600 bg-azul-800 text-cal shadow-none focus-visible:ring-2 focus-visible:ring-ambar"
              />
            </div>
          </div>

          {/* Unica accion principal de la pantalla, y unico ambar solido:
              bg-ambar + text-suelo = 8.9:1, cumple WCAG AA. */}
          <button
            type="submit"
            disabled={enviando}
            className="mt-8 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-ambar text-sm font-bold text-suelo transition-colors hover:bg-ambar/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cal focus-visible:ring-offset-2 focus-visible:ring-offset-azul disabled:pointer-events-none disabled:opacity-60"
          >
            {enviando && (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
            )}
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="mt-8 text-[0.75rem] leading-relaxed text-azul-300">
          No hay registro abierto. Las cuentas las crea Dirección desde el panel de
          Supabase; el acceso se otorga, no se hereda.
        </p>
      </div>
    </div>
  )
}

/**
 * Ruta a la que volver despues de entrar. Solo se aceptan rutas internas:
 * un `state` manipulado no puede convertirse en un salto a otro sitio.
 */
function rutaDeVuelta(estado: unknown): string {
  if (typeof estado === 'object' && estado !== null) {
    const { desde } = estado as Record<string, unknown>
    if (typeof desde === 'string' && desde.startsWith('/') && !desde.startsWith('//')) {
      return desde === '/entrar' ? '/hoy' : desde
    }
  }
  return '/hoy'
}
