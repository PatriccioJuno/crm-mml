import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/componentes/ui/badge'

/**
 * Las dos superficies azules que el proyecto de Claude Design usa dentro del
 * contenido (la tercera, la cabecera, esta en CabeceraPantalla.tsx).
 *
 * Las dos existen por el mismo motivo de fondo: el manual de marca pide 60 %
 * de Azul Noche, y una pantalla de tarjetas blancas sobre cal no llega ni al
 * 15 %. El azul no se reparte en trocitos por toda la interfaz — se concentra
 * en bloques enteros, que ademas son los que mandan.
 */

/**
 * BLOQUE AZUL — lo mas urgente de la pantalla, en negativo.
 *
 * En el diseno es el primer bloque de Hoy: «Separaciones que vencen en 3 dias
 * o menos». Se distingue del resto no por ser rojo, sino por ser el unico
 * bloque con los colores invertidos. Eso lo hace imposible de saltarse leyendo
 * por encima, que es exactamente el problema que resuelve.
 *
 * Es ademas la superficie que legitima el ambar: dentro de este bloque, el
 * contador y el boton de accion pueden ser ambar (ver el bloque de
 * src/componentes/ui/button.tsx).
 *
 * ###########################################################################
 * #  UNO POR PANTALLA. Si dos bloques gritan, no grita ninguno — y el azul  #
 * #  deja de significar «esto primero» para significar «esto es un bloque». #
 * ###########################################################################
 */
export function BloqueAzul({
  titulo,
  conteo,
  nota,
  accion,
  children,
  className,
}: {
  titulo: ReactNode
  /** Cuantos hay. Se dibuja en la pastilla ambar. */
  conteo?: number
  /** La consecuencia, en corto. Ej.: «Si vence, la unidad vuelve al inventario». */
  nota?: ReactNode
  /** Enlace o boton a la derecha del titulo. */
  accion?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-lg bg-azul p-4 text-cal sm:p-5', className)}>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* El rombo, el titulo y el contador van en UN solo hijo del flex.
            Sueltos, al envolver en un movil el titulo se iba a la linea
            siguiente y el rombo se quedaba solo arriba, leyendose como un
            adorno perdido en vez de como la marca del titulo. */}
        <div className="flex min-w-0 items-center gap-3">
          {/* El rombo ambar: la misma forma que `MarcaEstado estado="vencido"`.
              No es casualidad — es la marca de «fuera de plazo» de la
              interfaz, aqui a tamano de titulo. */}
          <span
            aria-hidden="true"
            className="h-[9px] w-[9px] shrink-0 rotate-45 rounded-[2px] bg-ambar"
          />

          <h2 className="text-base font-black text-cal">{titulo}</h2>

          {conteo !== undefined && <Badge variant="contadorAmbar">{conteo}</Badge>}
        </div>

        {nota !== undefined && <p className="text-xs text-cal/60 sm:ml-auto">{nota}</p>}

        {accion !== undefined && (
          <div className={cn(nota === undefined && 'sm:ml-auto')}>{accion}</div>
        )}
      </div>

      <div className="space-y-2">{children}</div>
    </section>
  )
}

/**
 * Una fila dentro de un <BloqueAzul>. El velo de cal al 7 % es lo que separa
 * una fila de otra sin meter bordes dentro de una superficie oscura (donde un
 * borde se ve sucio y una sombra no se ve).
 */
export function FilaAzul({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-md bg-velo p-3 sm:p-4', className)}>{children}</div>
}

/**
 * TARJETA CON PIE AZUL — el formulario del diseno.
 *
 * El cuerpo es una tarjeta normal; al pie, una franja azul con la accion
 * principal en ambar y, a su izquierda, la nota que dice que va a pasar al
 * pulsarla.
 *
 * Esa franja no es un adorno: es la superficie azul que el boton ambar
 * necesita para cumplir WCAG. Sin ella, el boton principal de un formulario
 * tendria que ser azul sobre cal — correcto pero mudo, que es como estaban
 * los formularios de este CRM hasta ahora.
 */
export function TarjetaConPie({
  children,
  nota,
  acciones,
  className,
}: {
  children: ReactNode
  /** Que pasa al confirmar. Ej.: «El formulario se limpia solo.». */
  nota?: ReactNode
  /** La accion principal. Usar <Button variant="ambar">. */
  acciones: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-card shadow-tarjeta',
        className,
      )}
    >
      <div className="p-5 sm:p-6">{children}</div>

      <div className="flex flex-wrap items-center justify-between gap-3 bg-azul px-5 py-4 sm:px-6">
        {nota !== undefined ? (
          <p className="max-w-xs text-xs leading-relaxed text-cal/60">{nota}</p>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">{acciones}</div>
      </div>
    </div>
  )
}
