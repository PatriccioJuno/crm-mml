import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/* ===========================================================================
 * BOTONES — estilo del proyecto de Claude Design («CRM Mercado», 14/09/2026)
 * ---------------------------------------------------------------------------
 * Tres cambios respecto al shadcn/ui de fabrica:
 *
 *   1. PESO. Era `font-medium` (500). El manual de marca admite tres pesos y
 *      500 no es ninguno. El diseno dibuja los botones en 700, y el principal
 *      en 900. Aqui: `font-bold`, y `font-black` en `ambar`.
 *
 *   2. CONTORNO DE 1.5 px. El `outline` de fabrica es un borde de 1 px del
 *      color de campo, o sea: un boton que parece un input vacio. El diseno
 *      lo dibuja con 1.5 px del azul de marca, y eso lo convierte en lo que
 *      es —una accion secundaria de verdad— sin pintarlo de relleno.
 *
 *   3. LA VARIANTE `ambar`. Ver el bloque de abajo: es la unica novedad que
 *      necesita explicacion.
 *
 * ###########################################################################
 * #  `ambar` SOLO SE USA SOBRE FONDO AZUL                                   #
 * #                                                                         #
 * #  Ambar #F2A93B sobre cal da 1.79:1 e incumple WCAG. Sobre el ambar, la  #
 * #  tinta #14181C da 8.9:1 y cumple de sobra — asi que el boton en si es   #
 * #  accesible; lo que no lo es, es el salto del boton al lienzo cuando el  #
 * #  lienzo es claro.                                                      #
 * #                                                                         #
 * #  El proyecto de diseno resuelve esto de una forma que conviene copiar   #
 * #  literalmente: el boton ambar NUNCA aparece suelto sobre el cal. Vive   #
 * #  siempre dentro de una superficie azul — la cabecera de pantalla, el    #
 * #  bloque de urgencia, o la franja azul al pie de una tarjeta. Esa franja #
 * #  al pie de un formulario existe EXACTAMENTE para esto: para darle al    #
 * #  boton principal el fondo azul que necesita.                            #
 * #                                                                         #
 * #  Regla practica al escribir una pantalla: si tecleas `variant="ambar"`  #
 * #  y el elemento padre no tiene `bg-azul`, esta mal. Usa `default`.       #
 * ###########################################################################
 * =========================================================================== */

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-azul-600",

        // La accion principal. Solo dentro de una superficie azul.
        ambar:
          "rounded-md bg-ambar font-black text-suelo hover:bg-ambar/90 focus-visible:ring-cal focus-visible:ring-offset-azul",

        // Accion secundaria sobre superficie CLARA.
        outline:
          "border-[1.5px] border-primary bg-transparent text-primary hover:bg-primary hover:text-primary-foreground",

        // Accion secundaria sobre superficie AZUL (cabeceras, bloques).
        // Es la misma idea que `outline` con los papeles cambiados: contorno
        // de cal al 40 %, que es como el diseno dibuja «Exportar», «Llamar»
        // o «Buscar persona» dentro de la franja azul.
        outlineCal:
          "border border-velo-borde bg-transparent text-cal hover:bg-velo focus-visible:ring-cal focus-visible:ring-offset-azul",

        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "font-bold text-primary underline-offset-4 hover:underline",
      },
      size: {
        // 40 px. El diseno dibuja los botones de fila a 9-11 px de relleno
        // vertical sobre 13 px de texto; en escritorio eso cae aqui.
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        // 48 px. El principal de un formulario, y el minimo comodo en movil.
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
