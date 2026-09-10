import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase, supabaseConfigurado } from '@/lib/supabase'
import {
  COLUMNAS_PERFIL,
  interpretarPerfil,
  type Perfil,
  type Rol,
} from '@/auth/tipos-sesion'

/**
 * Contexto de sesion: usuario (auth), perfil (tabla `perfiles`) y rol.
 *
 * ---------------------------------------------------------------------------
 * QUE ES Y QUE NO ES
 * ---------------------------------------------------------------------------
 * Esto es COMODIDAD DE INTERFAZ. El rol que vive aqui sirve para no dibujar
 * botones que van a fallar. NO es un control de acceso: quien manda es RLS en
 * la base (02-codigo\sql\02-rls.sql), que se evalua con `auth.uid()` del lado
 * del servidor y no depende de nada de este archivo.
 *
 * Si alguien edita este objeto desde la consola del navegador, vera mas menus
 * y seguira sin poder leer ni escribir una sola fila de mas.
 *
 * ---------------------------------------------------------------------------
 * SIN REGISTRO PUBLICO
 * ---------------------------------------------------------------------------
 * No hay `signUp` en ningun punto de la aplicacion. Los usuarios los crea el
 * administrador desde el panel de Supabase (Authentication -> Users); el
 * disparador `t_nuevo_usuario` (02-rls.sql §4) les crea el perfil con rol
 * `lectura`, y Direccion lo eleva despues. El acceso se otorga, no se hereda.
 */

/** Mensaje textual del requisito: perfil desactivado. */
const AVISO_DESACTIVADO = 'Tu acceso está desactivado. Habla con Walter.'

/**
 * El usuario esta autenticado pero no hay fila legible en `perfiles`.
 * Puede ser que el disparador no corriera o que RLS la esconda. No se adivina
 * un rol: se cierra la sesion.
 */
const AVISO_SIN_PERFIL =
  'Tu usuario existe pero no tiene un perfil válido en el CRM. Habla con Walter.'

const AVISO_SIN_CONFIGURAR =
  'La aplicación no tiene configurada la conexión a Supabase (.env.local). ' +
  'No es posible iniciar sesión.'

export type ResultadoEntrar = { ok: true } | { ok: false; mensaje: string }

export type ValorSesion = {
  /** `true` mientras no se sabe todavia si hay sesion y perfil. */
  cargando: boolean
  /** Usuario de Supabase Auth, o `null` si no hay sesion. */
  usuario: User | null
  /** Fila de `perfiles` correspondiente, o `null`. */
  perfil: Perfil | null
  /** Atajo de `perfil.rol`. `null` si no hay perfil cargado. */
  rol: Rol | null
  /** Mensaje que la pantalla de entrada debe mostrar (p. ej. acceso cerrado). */
  aviso: string | null
  entrar: (correo: string, contrasena: string) => Promise<ResultadoEntrar>
  salir: () => Promise<void>
}

const ContextoSesion = createContext<ValorSesion | null>(null)

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<User | null>(null)
  const [sesionLeida, setSesionLeida] = useState(false)

  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [perfilLeido, setPerfilLeido] = useState(false)

  const [aviso, setAviso] = useState<string | null>(null)

  // -------------------------------------------------------------------------
  // 1 · Sesion de Supabase Auth.
  //     El callback de onAuthStateChange se mantiene SINCRONO a proposito:
  //     llamar a supabase.from(...) dentro de el puede bloquear el cerrojo
  //     interno de supabase-js. La lectura del perfil va en el efecto 2.
  // -------------------------------------------------------------------------
  useEffect(() => {
    let vivo = true

    void supabase.auth.getSession().then(({ data }) => {
      if (!vivo) return
      setUsuario(data.session?.user ?? null)
      setSesionLeida(true)
    })

    const { data } = supabase.auth.onAuthStateChange((_evento, sesion) => {
      setUsuario(sesion?.user ?? null)
      setSesionLeida(true)
    })

    return () => {
      vivo = false
      data.subscription.unsubscribe()
    }
  }, [])

  // -------------------------------------------------------------------------
  // 2 · Perfil de la tabla `perfiles`.
  //     Politica que lo permite: `perfiles_leer_propio` (id = auth.uid()).
  // -------------------------------------------------------------------------
  const idUsuario = usuario?.id ?? null

  useEffect(() => {
    if (idUsuario === null) {
      setPerfil(null)
      setPerfilLeido(true)
      return
    }

    let vivo = true
    setPerfilLeido(false)

    const cerrarCon = async (mensaje: string) => {
      setAviso(mensaje)
      setPerfil(null)
      await supabase.auth.signOut()
    }

    void (async () => {
      const respuesta = await supabase
        .from('perfiles')
        .select(COLUMNAS_PERFIL)
        .eq('id', idUsuario)
        .maybeSingle()

      if (!vivo) return

      if (respuesta.error) {
        // No se distingue "no existe" de "RLS lo oculta": desde el cliente son
        // el mismo hecho. Se cierra la sesion y se pide ayuda humana.
        console.error('[sesion] No se pudo leer el perfil:', respuesta.error.message)
        await cerrarCon(AVISO_SIN_PERFIL)
        setPerfilLeido(true)
        return
      }

      const leido = interpretarPerfil(respuesta.data as unknown)

      if (leido === null) {
        await cerrarCon(AVISO_SIN_PERFIL)
        setPerfilLeido(true)
        return
      }

      // Requisito explicito: perfil desactivado -> cerrar sesion y avisar.
      // Es cortesia de interfaz; la defensa real es que `mi_rol()` (02-rls.sql)
      // solo devuelve rol `where activo`, asi que un perfil inactivo no pasa
      // ninguna politica de todos modos.
      if (!leido.activo) {
        await cerrarCon(AVISO_DESACTIVADO)
        setPerfilLeido(true)
        return
      }

      setPerfil(leido)
      setPerfilLeido(true)
    })()

    return () => {
      vivo = false
    }
  }, [idUsuario])

  const entrar = useCallback(
    async (correo: string, contrasena: string): Promise<ResultadoEntrar> => {
      if (!supabaseConfigurado) {
        return { ok: false, mensaje: AVISO_SIN_CONFIGURAR }
      }

      setAviso(null)

      const { error } = await supabase.auth.signInWithPassword({
        email: correo.trim(),
        password: contrasena,
      })

      if (error) {
        return { ok: false, mensaje: mensajeDeError(error.message) }
      }

      // El efecto 1 recibe el evento SIGNED_IN y el efecto 2 lee el perfil.
      // Si resulta estar desactivado, el efecto 2 cierra la sesion y pone el
      // aviso: por eso `entrar` devolviendo ok:true no significa "adentro".
      return { ok: true }
    },
    [],
  )

  const salir = useCallback(async () => {
    setAviso(null)
    await supabase.auth.signOut()
  }, [])

  const cargando = !sesionLeida || (idUsuario !== null && !perfilLeido)

  const valor = useMemo<ValorSesion>(
    () => ({
      cargando,
      usuario,
      perfil,
      rol: perfil?.rol ?? null,
      aviso,
      entrar,
      salir,
    }),
    [cargando, usuario, perfil, aviso, entrar, salir],
  )

  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>
}

/**
 * Traduce los errores de Supabase Auth sin filtrar si el correo existe:
 * "usuario no encontrado" y "contrasena incorrecta" dan el MISMO mensaje.
 */
function mensajeDeError(mensajeOriginal: string): string {
  const m = mensajeOriginal.toLowerCase()

  if (m.includes('invalid login credentials')) {
    return 'Correo o contraseña incorrectos.'
  }
  if (m.includes('email not confirmed')) {
    return 'Tu correo todavía no está confirmado. Habla con Walter.'
  }
  if (m.includes('too many requests') || m.includes('rate limit')) {
    return 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.'
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'
  }
  return `No se pudo iniciar sesión (${mensajeOriginal})`
}

export function useSesion(): ValorSesion {
  const valor = useContext(ContextoSesion)
  if (valor === null) {
    throw new Error('useSesion() se usó fuera de <ProveedorSesion>.')
  }
  return valor
}
