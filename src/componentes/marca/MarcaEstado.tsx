import { cn } from '@/lib/utils'

/**
 * MARCA DE ESTADO — el cuadradito que dice en que punto esta algo.
 *
 * ---------------------------------------------------------------------------
 * ESTO ES LA RESPUESTA A UNA PROHIBICION, NO UN ADORNO
 * ---------------------------------------------------------------------------
 * `03-diseno\BRIEF-CLAUDE-DESIGN.md` prohibe el rojo/verde de semaforo para el
 * estado de pago, y manda resolverlo «con texto, icono y peso tipografico».
 * Esa regla estaba escrita, pero no implementada: no habia ningun icono, asi
 * que en la practica cada pantalla se las arreglaba con texto a secas.
 *
 * El proyecto de Claude Design («CRM Mercado», 14/09/2026) resuelve justo eso,
 * y de una forma que conviene copiar tal cual: tres formas, un solo color.
 *
 *   `hecho`      cuadrado RELLENO      Pagada · verificada · completada
 *   `pendiente`  cuadrado HUECO        Pendiente · por vencer
 *   `vencido`    rombo RELLENO         Vencida · en mora · fuera de plazo
 *                (el mismo cuadrado girado 45°, en tinta plena)
 *
 * Funciona por tres razones:
 *
 *   1. Se distinguen por FORMA, no por color. Quien no distingue rojo de
 *      verde —entre el 5 y el 8 % de los hombres— lee esta tabla igual de
 *      rapido que cualquiera. Un semaforo de color, no.
 *   2. Sobreviven al blanco y negro. Estas tablas se imprimen y se mandan por
 *      WhatsApp como captura.
 *   3. No introducen ningun color nuevo. La marca tiene cuatro y sigue
 *      teniendo cuatro.
 *
 * El rombo llama la atencion porque es la unica forma girada de la pantalla:
 * el ojo la encuentra antes de leer. Eso es lo que hacia el rojo, sin rojo.
 *
 * ###########################################################################
 * #  ESTA MARCA NO SUSTITUYE AL TEXTO, LO ACOMPANA.                        #
 * #  Nunca dejes una celda con solo el cuadradito: al lado va siempre la    #
 * #  palabra («Pagada», «Vencida»), y en las vencidas ademas `font-black`.  #
 * #  Texto + icono + peso, los tres. Es lo que pide el brief.               #
 * ###########################################################################
 */

export type Estado = 'hecho' | 'pendiente' | 'vencido'

/** El ambar de `sobreAzul` es legitimo: dentro de un bloque azul. */
export function MarcaEstado({
  estado,
  sobreAzul = false,
  className,
}: {
  estado: Estado
  /** Dentro de un bloque de fondo azul. Cambia la tinta a cal / ambar. */
  sobreAzul?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block h-[9px] w-[9px] shrink-0 rounded-[2px]',
        estado === 'vencido' && 'rotate-45',

        sobreAzul
          ? {
              hecho: 'bg-cal/85',
              pendiente: 'border-[1.5px] border-cal/60',
              vencido: 'bg-ambar',
            }[estado]
          : {
              hecho: 'bg-suelo/55',
              pendiente: 'border-[1.5px] border-suelo/50',
              vencido: 'bg-suelo',
            }[estado],

        className,
      )}
    />
  )
}

/**
 * La marca y su palabra, juntas y con el peso correcto.
 *
 * Es la forma recomendada de usar lo de arriba: obliga a que el texto vaya
 * siempre, y pone `font-black` en lo vencido sin que haya que acordarse.
 */
export function EtiquetaEstado({
  estado,
  children,
  nota,
  sobreAzul = false,
  className,
}: {
  estado: Estado
  children: React.ReactNode
  /** Apunte en gris al lado. Ej.: «hace 12 dias». */
  nota?: React.ReactNode
  sobreAzul?: boolean
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm', className)}>
      <MarcaEstado estado={estado} sobreAzul={sobreAzul} />
      <span
        className={cn(
          estado === 'vencido' ? 'font-black' : 'font-bold',
          sobreAzul ? 'text-cal' : 'text-foreground',
        )}
      >
        {children}
      </span>
      {nota !== undefined && (
        <span className={cn('font-normal', sobreAzul ? 'text-cal/55' : 'text-muted-foreground')}>
          {nota}
        </span>
      )}
    </span>
  )
}

/**
 * Leyenda de las tres formas. Va arriba de cualquier tabla que las use: la
 * primera vez que alguien ve un rombo tiene que poder averiguar que significa
 * sin preguntar.
 */
export function LeyendaEstados({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {(
        [
          ['hecho', 'Pagada'],
          ['pendiente', 'Pendiente'],
          ['vencido', 'Vencida'],
        ] as const
      ).map(([estado, palabra]) => (
        <span
          key={estado}
          className={cn(
            'inline-flex items-center gap-1.5 text-[0.6875rem]',
            estado === 'vencido' ? 'font-bold text-foreground' : 'text-muted-foreground',
          )}
        >
          <MarcaEstado estado={estado} />
          {palabra}
        </span>
      ))}
    </div>
  )
}
