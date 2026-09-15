import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/* ===========================================================================
 * DISTINTIVOS — estilo del proyecto de Claude Design («CRM Mercado», 14/09/2026)
 * ---------------------------------------------------------------------------
 * El diseno usa dos formas distintas, y conviene no confundirlas:
 *
 *   CONTADOR (`contador`, `contadorAmbar`) — pastilla completamente redonda
 *   con un numero dentro, pegada al titulo de un bloque. Dice CUANTOS hay.
 *   Es lo que convierte «Tareas vencidas» en «Tareas vencidas (7)», que es la
 *   diferencia entre un titulo y una carga de trabajo.
 *
 *   ETIQUETA (`default`, `outline`, `cal`, `outlineCal`) — pastilla con una
 *   palabra dentro, bajo el nombre de una persona o de una unidad. Dice QUE
 *   es. «Socia · credito activo», «Puesto B-12».
 *
 * Las cuatro variantes que terminan en `Cal` / `cal` van SOBRE FONDO AZUL.
 * Las demas, sobre fondo claro. `contadorAmbar` es ademas el unico sitio de
 * este archivo donde aparece el ambar, y por eso mismo solo existe en version
 * «sobre azul»: ver el bloque de src/componentes/ui/button.tsx.
 * =========================================================================== */

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        // --- Sobre superficie clara ---
        default: "border-transparent bg-primary text-primary-foreground",
        contador: "border-transparent bg-primary px-2.5 font-black text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-border text-foreground",

        // --- Sobre superficie azul ---
        // Pastilla solida de cal: el estado principal de una persona.
        cal: "border-transparent bg-cal text-primary",
        // Contorno de cal al 35 %: los datos de apoyo (unidad, codigo).
        outlineCal: "border-cal/35 text-cal",
        // El contador del bloque de urgencia. Ambar sobre azul: permitido.
        contadorAmbar: "border-transparent bg-ambar px-2.5 font-black text-suelo",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
