import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useSesion } from '@/auth/ContextoSesion'
import { puedeVerSeccion, seccionInicial, type ClaveSeccion } from '@/auth/secciones'

/**
 * Envoltorio de ruta. Hace tres cosas, en este orden:
 *
 *  1. Mientras no se sabe si hay sesion, no decide nada (evita el parpadeo de
 *     mandar a /entrar a alguien que si tenia sesion guardada).
 *  2. Sin usuario o sin perfil valido → a /entrar, recordando a donde iba.
 *  3. Con `seccion`, si el rol no ve esa seccion → a su primera seccion visible.
 *
 * ###########################################################################
 * #  El punto 3 es COMODIDAD, no seguridad. Impide llegar a una pantalla que #
 * #  saldria vacia; no impide leer un dato. Quien impide leer un dato es RLS #
 * #  (02-codigo\sql\02-rls.sql). No anadir aqui reglas de permiso que no      #
 * #  existan alli: se desincronizan, y la version del cliente siempre pierde. #
 * ###########################################################################
 */
export function RutaProtegida({
  children,
  seccion,
}: {
  children?: ReactNode
  seccion?: ClaveSeccion
}) {
  const { cargando, usuario, perfil } = useSesion()
  const ubicacion = useLocation()

  if (cargando) {
    return <PantallaCargando />
  }

  if (usuario === null || perfil === null) {
    return (
      <Navigate
        to="/entrar"
        replace
        state={{ desde: ubicacion.pathname + ubicacion.search }}
      />
    )
  }

  if (seccion !== undefined && !puedeVerSeccion(perfil.rol, seccion)) {
    const destino = seccionInicial(perfil.rol)
    return <Navigate to={destino?.ruta ?? '/entrar'} replace />
  }

  return <>{children ?? <Outlet />}</>
}

/**
 * Espera. Fondo azul, como la pantalla de entrada, para que el arranque en
 * frio no muestre dos lienzos distintos antes de decidir a donde ir.
 */
export function PantallaCargando() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-azul">
      <Loader2
        className="h-6 w-6 animate-spin text-azul-300"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="sr-only">Comprobando tu sesión…</span>
    </div>
  )
}
