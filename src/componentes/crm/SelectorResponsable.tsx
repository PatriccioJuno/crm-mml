import { useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import { claseCampo, claseCampoCompacto } from '@/componentes/ui/input'
import { cn } from '@/lib/utils'
import { cargarEquipo } from '@/lib/contacto'
import { ETIQUETA_ROL, ROLES } from '@/auth/tipos-sesion'

/**
 * SELECTOR DE RESPONSABLE — quién lleva una oportunidad.
 *
 * La lista sale de `fn_equipo` (perfiles ACTIVOS de dirección, comercial y
 * administración) y no de un `select` a `perfiles`: RLS no deja a un comercial
 * leer los perfiles de los demás, y para repartir un lote tiene que verlos
 * (src/lib/contacto.ts). La clave de consulta es `['equipo']`, compartida con
 * cualquier otra pantalla que la pida (SPEC §8).
 *
 * Es un `<select>` nativo y no chips: el equipo puede crecer, y en un móvil el
 * selector nativo es el que mejor se usa con una mano.
 *
 * Si el valor actual NO está en el equipo activo (alguien que ya no está, o un
 * perfil desactivado), se muestra como «fuera del equipo activo» en vez de
 * saltar en silencio al primero de la lista: cambiar de responsable sin que
 * nadie lo decida es exactamente el cambio que R9 obliga a registrar.
 */

/** El equipo cambia poco; no hace falta pedirlo en cada pantalla. Caché de interfaz. */
const EQUIPO_VIGENTE_MS = 5 * 60 * 1000

function etiquetaRol(rol: string): string {
  const conocido = ROLES.find((r) => r === rol)
  return conocido === undefined ? rol : ETIQUETA_ROL[conocido]
}

export function SelectorResponsable({
  valor,
  alCambiar,
  etiqueta = 'Responsable',
  permitirVacio = false,
  textoVacio = 'Sin responsable',
  compacto = false,
  deshabilitado = false,
  className,
}: {
  valor: string | null
  alCambiar: (id: string | null) => void
  etiqueta?: string | undefined
  /** Ofrece la opción vacía (p. ej. «Sin dueño» en un filtro, o «Yo» resuelto por quien llama). */
  permitirVacio?: boolean | undefined
  textoVacio?: string | undefined
  /** `claseCampoCompacto` para barras de filtros; `claseCampo` (52 px) para formularios. */
  compacto?: boolean | undefined
  deshabilitado?: boolean | undefined
  className?: string | undefined
}) {
  const id = useId()
  const idNota = useId()
  const equipo = useQuery({
    queryKey: ['equipo'],
    queryFn: cargarEquipo,
    staleTime: EQUIPO_VIGENTE_MS,
  })

  const miembros = equipo.data ?? []
  const valorFuera = valor !== null && equipo.isSuccess && !miembros.some((m) => m.id === valor)
  const cargando = equipo.isPending

  const nota = equipo.isError
    ? `No se pudo cargar el equipo: ${equipo.error.message}`
    : valorFuera
      ? 'El responsable actual ya no está en el equipo activo. Elige a otra persona si hay que reasignar.'
      : null

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-bold text-suelo">
        {etiqueta}
      </label>
      <select
        id={id}
        // El compacto mide 36 px: bien para un filtro con ratón, corto para un
        // pulgar. En el móvil sube a 44 px (mínimo táctil); desde `sm` vuelve.
        className={compacto ? cn(claseCampoCompacto, 'h-11 sm:h-9') : claseCampo}
        value={valor ?? ''}
        onChange={(e) => alCambiar(e.target.value === '' ? null : e.target.value)}
        disabled={deshabilitado || cargando || equipo.isError}
        aria-busy={cargando || undefined}
        aria-describedby={nota === null ? undefined : idNota}
      >
        {cargando || equipo.isError ? (
          // Mientras no hay lista, una sola opción con el valor actual: el
          // `<select>` no puede enseñar a nadie que no se haya elegido.
          <option value={valor ?? ''}>{cargando ? 'Cargando equipo…' : 'Equipo no disponible'}</option>
        ) : (
          <>
            {(permitirVacio || valor === null) && (
              // Sin `permitirVacio`, la opción vacía solo existe para que el
              // `<select>` no mienta mostrando a alguien que no se eligió.
              <option value="" disabled={!permitirVacio}>
                {permitirVacio ? textoVacio : 'Elige a una persona…'}
              </option>
            )}
            {valorFuera && <option value={valor}>Fuera del equipo activo</option>}
            {miembros.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre} · {etiquetaRol(m.rol)}
              </option>
            ))}
          </>
        )}
      </select>
      {nota !== null && (
        <p id={idNota} role={equipo.isError ? 'alert' : undefined} className="text-xs text-suelo-700">
          {nota}
        </p>
      )}
    </div>
  )
}
