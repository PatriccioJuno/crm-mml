import * as React from "react"

import { cn } from "@/lib/utils"

/* ===========================================================================
 * CAMPOS — estilo del proyecto de Claude Design («CRM Mercado», 14/09/2026)
 * ---------------------------------------------------------------------------
 * Tres decisiones del diseno que aqui no son estetica:
 *
 *   ALTO 52 px (era 36). El diseno lo justifica en la pantalla de Registro
 *   rapido: se teclea de pie, en un movil, con una persona delante esperando,
 *   y la meta declarada es menos de 30 segundos por prospecto. Un campo de
 *   36 px se falla con el pulgar. 52 px esta por encima del minimo tactil de
 *   44 px con margen para el error.
 *
 *   TEXTO 16 px, y sin `md:text-sm`. El shadcn de fabrica baja a 14 px en
 *   escritorio; el diseno mantiene 16-17 px en los dos tamanos. Ademas, por
 *   debajo de 16 px Safari de iOS hace zoom al enfocar un campo y descoloca
 *   la pantalla entera — sintoma clasico que se confunde con un fallo de
 *   maquetacion.
 *
 *   PESO 700. Lo que se escribe aqui son nombres, telefonos y montos: datos
 *   que despues hay que releer y confirmar en voz alta. El diseno los pone en
 *   negrita para que se lean de un vistazo, no para decorar.
 *
 * El borde de 1.5 px sale del token `input` (azul al 25 %). Es mas marcado
 * que el de una tarjeta (10 %) a proposito: un campo tiene que parecer algo
 * en lo que se puede escribir.
 * =========================================================================== */

/**
 * El aspecto de UN CAMPO, en un solo sitio.
 *
 * ###########################################################################
 * #  POR QUE ESTO ES UNA CONSTANTE EXPORTADA Y NO SOLO CLASES DENTRO DE     #
 * #  <Input>                                                                #
 * #                                                                         #
 * #  Porque `<select>` y `<textarea>` son etiquetas nativas distintas de    #
 * #  `<input>` y no pueden usar este componente. Hasta ahora, cada pantalla  #
 * #  que necesitaba un desplegable se copiaba las clases de <Input> a mano   #
 * #  en un `const claseSelect` local: SIETE copias identicas, en siete       #
 * #  archivos.                                                              #
 * #                                                                         #
 * #  Mientras nadie tocara <Input>, las siete copias coincidian y no se      #
 * #  notaba. Al rediseñar el campo (52 px, borde de 1.5 px, 16 px de texto)  #
 * #  solo cambio <Input>, y los desplegables se quedaron con el aspecto      #
 * #  viejo: dos lenguajes de formulario en la misma pantalla.               #
 * #                                                                         #
 * #  Ahora hay una sola fuente. Si cambia el aspecto de un campo, cambia     #
 * #  aqui y cambian los tres tipos a la vez.                                 #
 * ###########################################################################
 *
 * Para un `<textarea>`, añadir `h-auto py-2`: el alto fijo es de los campos
 * de una linea.
 */
export const claseCampo = cn(
  "flex h-[3.25rem] w-full rounded-md border-[1.5px] border-input bg-background px-4 py-1",
  "text-base font-bold text-foreground transition-colors",
  "placeholder:font-normal placeholder:text-muted-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
  "disabled:cursor-not-allowed disabled:opacity-50"
)

/**
 * La versión compacta, para controles que NO son captura de datos: el filtro
 * de una barra de filtros, el desplegable de estado dentro de una tarjeta del
 * embudo.
 *
 * Los 52 px de `claseCampo` se justifican porque alguien va a teclear ahí un
 * nombre o un monto, de pie y con prisa. Un filtro no se teclea: se elige una
 * vez y se deja. A ese tamaño, cuatro filtros seguidos ocupan media pantalla
 * y empujan hacia abajo la tabla, que es lo que se ha venido a mirar.
 *
 * Lo que NO cambia respecto a `claseCampo` es la familia: mismo borde de
 * 1.5 px, mismo anillo de foco, ninguna sombra. Es el mismo campo, más bajo.
 */
export const claseCampoCompacto = cn(
  "flex h-9 w-full rounded-sm border-[1.5px] border-input bg-background px-3",
  "text-sm text-foreground transition-colors",
  "placeholder:text-muted-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
  "disabled:cursor-not-allowed disabled:opacity-50"
)

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          claseCampo,
          "file:border-0 file:bg-transparent file:text-sm file:font-bold file:text-foreground",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
