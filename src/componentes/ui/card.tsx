import * as React from "react"

import { cn } from "@/lib/utils"

/* ===========================================================================
 * TARJETAS — estilo del proyecto de Claude Design («CRM Mercado», 14/09/2026)
 * ---------------------------------------------------------------------------
 * La tarjeta del diseno es deliberadamente discreta: blanco tibio (#FDFCF9,
 * el token `card`), contorno de azul al 10 % y UNA sombra de 1 px teñida de
 * azul. Nada mas. La jerarquia de la pantalla no la marcan las tarjetas —
 * todas pesan igual—, la marca el bloque azul que va arriba del todo.
 *
 * Por eso aqui se bajo la sombra de `shadow` (la de shadcn, de dos capas y
 * gris) a `shadow-tarjeta`: con la sombra de fabrica, ocho tarjetas apiladas
 * en la pantalla Hoy competian entre ellas y con el bloque de urgencia.
 *
 * El relleno tambien bajo de 24 px a 20 px. El diseno trabaja a 22 px y con
 * cabeceras de tarjeta de una sola linea; 24 px dejaban las tarjetas de
 * Cobranza con mas aire que datos.
 * =========================================================================== */

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-lg border bg-card text-card-foreground shadow-tarjeta",
      className
    )}
    {...props}
  />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-5", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    // `font-bold` y no `font-semibold`: 600 no es uno de los tres pesos del
    // manual de marca. El diseno rotula las tarjetas en 15 px / 700.
    className={cn("text-[0.9375rem] font-bold leading-none tracking-tight", className)}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-xs text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-5 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
