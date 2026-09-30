import {
  Archive,
  BadgeCheck,
  Ban,
  Flame,
  HelpCircle,
  Snowflake,
  Sparkles,
  Thermometer,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { etiquetaTemperatura, type Temperatura } from '@/lib/cartera'

/**
 * INSIGNIA DE TEMPERATURA — qué tan cerca está un lead de comprar.
 *
 * ---------------------------------------------------------------------------
 * SIN COLORES DE SEMAFORO, A PROPOSITO
 * ---------------------------------------------------------------------------
 * «Caliente en rojo, frío en azul» es lo primero que se le ocurre a cualquiera,
 * y es justo lo que el brief de diseño prohíbe (03-diseno/BRIEF-CLAUDE-DESIGN.md:
 * el estado se dice con texto, icono de línea y peso, nunca con rojo/verde) y
 * lo que la marca no tiene (cuatro colores, ninguno rojo). Se resuelve igual
 * que `MarcaEstado`:
 *
 *   FORMA   un icono de lucide distinto por temperatura (llama, termómetro,
 *           copo, destello, prohibido, archivo, insignia, interrogación)
 *   PESO    caliente en Black (900); las demás en Bold (700)
 *   TINTA   sobre claro: azul para lo que está vivo (caliente, tibio, nuevo,
 *           cliente), suelo-700 para lo que no se trabaja hoy;
 *           sobre azul: cal, y el caliente en ámbar — ámbar sobre azul está
 *           PERMITIDO (7.3:1). Ámbar sobre claro, NUNCA (1.79:1).
 *
 * El motivo («Compra este mes · Cubre contado») va en `title` y en texto solo
 * para lectores de pantalla: la insignia es corta para que quepa en una fila
 * de lista, pero el porqué no se pierde.
 *
 * La temperatura la calcula la base (`fn_temperatura`, 13-seguimiento-
 * comercial.sql), con umbrales que viven en `parametros` (🔵 propuesta). Este
 * componente no calcula nada: solo la pinta.
 */

const ICONOS: Readonly<Record<Temperatura, LucideIcon>> = {
  caliente: Flame,
  tibio: Thermometer,
  frio: Snowflake,
  nuevo: Sparkles,
  no_contactar: Ban,
  descartado: Archive,
  cliente: BadgeCheck,
  sin_clasificar: HelpCircle,
}

/** Las que se pintan en azul sobre claro; el resto, en suelo-700. */
const VIVAS: ReadonlySet<Temperatura> = new Set<Temperatura>(['caliente', 'tibio', 'nuevo', 'cliente'])

function tinta(temperatura: Temperatura, sobreAzul: boolean): string {
  if (sobreAzul) return temperatura === 'caliente' ? 'text-ambar' : 'text-cal'
  return VIVAS.has(temperatura) ? 'text-azul' : 'text-suelo-700'
}

export function InsigniaTemperatura({
  temperatura,
  motivo,
  sobreAzul = false,
  compacta = false,
  className,
}: {
  temperatura: Temperatura
  motivo?: string | null | undefined
  /** Dentro de una superficie azul (cabecera de la ficha). Cambia la tinta a cal / ámbar. */
  sobreAzul?: boolean | undefined
  /** Para filas de lista: sin contorno y con icono más pequeño. */
  compacta?: boolean | undefined
  className?: string | undefined
}) {
  const Icono = ICONOS[temperatura]
  const etiqueta = etiquetaTemperatura(temperatura)
  const conMotivo = motivo !== null && motivo !== undefined && motivo.trim() !== ''
  const descripcion = conMotivo ? `${etiqueta}: ${motivo}` : etiqueta

  return (
    <span
      title={descripcion}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs',
        temperatura === 'caliente' ? 'font-black' : 'font-bold',
        tinta(temperatura, sobreAzul),
        !compacta && 'rounded-full border px-2.5 py-0.5',
        !compacta && (sobreAzul ? 'border-velo-borde' : 'border-input'),
        className,
      )}
    >
      <Icono
        aria-hidden="true"
        strokeWidth={temperatura === 'caliente' ? 2.5 : 2}
        className={compacta ? 'h-3.5 w-3.5' : 'h-4 w-4'}
      />
      <span>{etiqueta}</span>
      {conMotivo && <span className="sr-only">: {motivo}</span>}
    </span>
  )
}
