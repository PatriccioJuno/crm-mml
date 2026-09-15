import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * CABECERA DE PANTALLA — la franja azul de arriba.
 *
 * Viene del proyecto de Claude Design («CRM Mercado», 14/09/2026), donde las
 * cuatro pantallas empiezan igual: una banda de Azul Noche a todo lo ancho con
 * el nombre de la pantalla, una linea de contexto debajo, y las acciones a la
 * derecha.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ES AZUL Y NO UN <h1> SUELTO
 * ---------------------------------------------------------------------------
 * Antes cada pantalla dibujaba su propio `<header>` con un `<h1>` sobre el cal.
 * Funcionaba, pero tenia dos problemas:
 *
 *   1. El manual de marca pide 60 % de Azul Noche. Con la barra lateral
 *      replegada en movil, el unico azul de la pantalla era la cabecera de
 *      14 px del cajon. El CRM se veia, literalmente, beige.
 *
 *   2. Es el sitio donde el diseno pone el boton principal, y el boton
 *      principal es ambar. El ambar necesita fondo azul para cumplir WCAG
 *      (ver el bloque de src/componentes/ui/button.tsx). Sin esta franja no
 *      hay ningun lugar legitimo donde ponerlo.
 *
 * O sea: la franja no es decoracion, es la superficie que hace posible el
 * boton principal.
 *
 * ---------------------------------------------------------------------------
 * ⚠ EL MARGEN NEGATIVO ESTA ACOPLADO AL RELLENO DEL CASCARON
 * ---------------------------------------------------------------------------
 * En el diseno la franja llega a los bordes de la ventana. Aqui vive dentro
 * del <main> de `Cascaron.tsx`, que tiene `px-4 py-6 sm:px-6 sm:py-8`, asi que
 * para llegar al borde tiene que deshacer ese relleno con margenes negativos.
 *
 * Se eligio esto —y no quitarle el relleno al <main>— porque el propio
 * Cascaron.tsx explica por que el relleno vive alli y no en cada pantalla:
 * sacarlo obligaria a cada pantalla futura a acordarse de ponerlo, que es el
 * fallo que ese archivo documenta haber tenido ya una vez (le paso a
 * Parametros). Mejor un acoplamiento en UN sitio, escrito, que un relleno
 * repartido por diez pantallas.
 *
 * ###########################################################################
 * #  SI CAMBIA EL RELLENO DE <main> EN Cascaron.tsx, CAMBIA AQUI TAMBIEN.   #
 * #  Los dos valores tienen que coincidir o la franja no llegara al borde   #
 * #  (o se saldra de el).                                                   #
 * ###########################################################################
 */

export type Indicador = {
  /** Rotulo en versalitas. Ej.: «Total por cobrar este mes». */
  titulo: string
  /** La cifra, grande. Si todavia no hay dato duro, `[PENDIENTE]`. */
  valor: ReactNode
  /** Linea de apoyo debajo. Opcional. */
  nota?: ReactNode
  /**
   * Marca el indicador que exige atencion. El diseno lo distingue con el
   * filete ambar a la izquierda y el rotulo en ambar — sobre azul, permitido.
   *
   * Uno por franja, como maximo. Si todo destaca, no destaca nada.
   */
  destacado?: boolean
}

/**
 * A que ancho se alinea el contenido de la franja.
 *
 * La franja azul siempre llega de borde a borde; lo que se centra dentro es el
 * titulo. Tiene que coincidir con el ancho del cuerpo de la pantalla, o el
 * titulo y la primera tarjeta no arrancaran en la misma vertical — que es el
 * tipo de desajuste que nadie sabe nombrar pero todo el mundo ve.
 */
const ANCHOS = {
  /** Tablas a pantalla completa: Cobranza, Inventario, Contratos, Reportes. */
  completo: '',
  /** Listas de lectura: Hoy. */
  medio: 'max-w-4xl',
  /** Fichas y formularios de una columna: alta de separación, de contrato. */
  formulario: 'max-w-3xl',
  /** Un solo campo tras otro, pensado para el pulgar: Registro rápido. */
  estrecho: 'max-w-xl',
} as const

export function CabeceraPantalla({
  titulo,
  descripcion,
  migaja,
  distintivos,
  acciones,
  indicadores,
  pestanas,
  ancho = 'completo',
}: {
  titulo: ReactNode
  /** Linea de contexto bajo el titulo: fecha, conteo, periodo. */
  descripcion?: ReactNode
  /** Sobrelinea de ubicacion. Ej.: «Personas · Socios». */
  migaja?: ReactNode
  /** Pastillas de estado bajo el titulo. Usar <Badge variant="cal" | "outlineCal">. */
  distintivos?: ReactNode
  /** Botones. Usar <Button variant="outlineCal"> y, el principal, "ambar". */
  acciones?: ReactNode
  /** Franja de cifras grandes. Ver el tipo `Indicador`. */
  indicadores?: readonly Indicador[]
  /** Pestanas ancladas al borde inferior de la franja. */
  pestanas?: ReactNode
  /** Debe coincidir con el ancho del cuerpo de la pantalla. Ver `ANCHOS`. */
  ancho?: keyof typeof ANCHOS
}) {
  return (
    <header
      className={cn(
        'bg-azul text-cal',
        // Ver el bloque ⚠ de la cabecera de este archivo: estos valores son
        // el negativo exacto del relleno del <main> de Cascaron.tsx.
        '-mx-4 -mt-6 mb-6 px-4 pt-6 sm:-mx-6 sm:-mt-8 sm:mb-8 sm:px-6 sm:pt-8',
        pestanas === undefined ? 'pb-6 sm:pb-7' : 'pb-0',
      )}
    >
      <div className={cn('mx-auto w-full', ANCHOS[ancho])}>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            {migaja !== undefined && (
              <p className="mb-2 text-xs font-bold text-cal/55">{migaja}</p>
            )}

            {/* `text-cal` y no el `text-foreground` de la regla global de h1:
                esto va sobre azul. */}
            <h1 className="text-2xl font-black tracking-tight text-cal sm:text-[1.75rem]">
              {titulo}
            </h1>

            {descripcion !== undefined && (
              <p className="mt-1 text-xs text-cal/60 sm:text-sm">{descripcion}</p>
            )}

            {distintivos !== undefined && (
              <div className="mt-3 flex flex-wrap gap-2">{distintivos}</div>
            )}
          </div>

          {acciones !== undefined && (
            <div className="flex flex-wrap items-center gap-2">{acciones}</div>
          )}
        </div>

        {indicadores !== undefined && indicadores.length > 0 && (
          <FranjaIndicadores indicadores={indicadores} />
        )}

        {pestanas !== undefined && <div className="mt-5 flex gap-1">{pestanas}</div>}
      </div>
    </header>
  )
}

/**
 * La franja de cifras grandes de la cabecera de Cobranza en el diseno.
 *
 * Se distingue con un filete vertical a la izquierda, no con una tarjeta: van
 * sobre azul, y una tarjeta clara dentro de la franja azul romperia la banda
 * en trozos. El filete separa sin cortar.
 */
function FranjaIndicadores({ indicadores }: { indicadores: readonly Indicador[] }) {
  return (
    <div className="mt-5 flex flex-wrap gap-x-8 gap-y-5">
      {indicadores.map((indicador) => (
        <div
          key={indicador.titulo}
          className={cn(
            'border-l-[3px] pl-4',
            indicador.destacado === true ? 'border-ambar' : 'border-cal/35',
          )}
        >
          {/* Ambar sobre azul: permitido. Es el unico ambar de la franja. */}
          <p className={cn('sobrelinea-cal', indicador.destacado === true && 'acento-ambar')}>
            {indicador.titulo}
          </p>
          <p className="mt-1.5 text-3xl font-black leading-none text-cal">{indicador.valor}</p>
          {indicador.nota !== undefined && (
            <p className="mt-1.5 text-xs text-cal/60">{indicador.nota}</p>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * El «volver» de una pantalla de dentro (una ficha, un alta), para pasarlo
 * como `migaja`.
 *
 * Va DENTRO de la franja azul y no encima, y no es un capricho: la franja se
 * sube con margen negativo hasta el borde de la ventana, asi que cualquier
 * cosa dibujada antes que ella le quedaria por debajo. Ademas es lo que hace
 * el proyecto de diseno, que resuelve la vuelta atras con la miga de pan
 * («Personas · Socios») en vez de con un boton suelto encima del titulo.
 */
export function MigajaVolver({ a, children }: { a: string; children: ReactNode }) {
  return (
    <Link
      to={a}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm text-cal/70 transition-colors',
        'hover:text-cal hover:underline',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ambar',
      )}
    >
      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
      {children}
    </Link>
  )
}

/**
 * Una pestana de la cabecera. Se ancla al borde inferior de la franja azul:
 * la activa se pinta del color del lienzo para que parezca que la pantalla de
 * abajo sale de ella.
 */
export function PestanaCabecera({
  activa,
  children,
  ...props
}: { activa: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'rounded-t-sm px-4 py-3 text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ambar',
        activa
          ? 'bg-background font-bold text-foreground'
          : 'font-normal text-cal/70 hover:bg-velo hover:text-cal',
      )}
      {...props}
    >
      {children}
    </button>
  )
}
