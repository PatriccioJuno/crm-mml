import * as React from "react"

import { cn } from "@/lib/utils"

/* ===========================================================================
 * DESVIACION DELIBERADA DE shadcn/ui — 14/09/2026
 * ---------------------------------------------------------------------------
 * El `<Table>` original es `w-full` dentro de un contenedor con scroll. En una
 * pantalla ancha se comporta bien; en un movil de 360 px, no: `w-full` obliga
 * a la tabla a CABER, asi que las columnas se estrujan y cada celda parte el
 * texto en una palabra por linea. El scroll horizontal nunca llega a
 * aparecer, porque la tabla siempre «cabe».
 *
 * Por eso se anade `min-w-[44rem]` (704 px): por debajo de ese ancho la tabla
 * deja de encogerse y empieza a desplazarse de lado, que es lo que un movil
 * sabe hacer. En escritorio no cambia nada — ahi `w-full` es mayor que 44rem
 * y manda `w-full`.
 *
 * No se pone con punto de corte (`md:`, `lg:`) a proposito: la regla no es
 * «en movil», es «cuando no quepa», y eso tambien pasa con una ventana de
 * escritorio a media pantalla.
 * =========================================================================== */

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-x-auto">
    <table
      ref={ref}
      className={cn("w-full min-w-[44rem] caption-bottom text-sm", className)}
      {...props}
    />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  // La franja de cabecera del proyecto de diseno: azul al 5 %, sin borde
  // inferior. El borde sobraba — la franja ya separa por si sola, y con las
  // dos cosas la tabla arrancaba con una raya doble.
  <thead ref={ref} className={cn("bg-tinta-banda", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t border-tinta-fila bg-tinta-banda font-bold [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      // Separador de fila propio (azul al 7 %), mas suave que el contorno de
      // la tarjeta que la contiene: en una tabla de veinte filas, el borde
      // `border-b` de fabrica pesaba mas que los datos.
      "border-b border-tinta-fila transition-colors hover:bg-tinta-grupo data-[state=selected]:bg-tinta-banda",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      // Versalitas de 11 px, como el resto de rotulos de la interfaz (ver la
      // utilidad `.sobrelinea` de src/index.css). Y `font-bold`: 500 no es uno
      // de los tres pesos del manual de marca.
      "h-9 px-3 text-left align-middle text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "px-3 py-2.5 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
