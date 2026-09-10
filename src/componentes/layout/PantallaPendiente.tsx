import { Construction } from 'lucide-react'

/**
 * Marcador de posicion del andamiaje. NO es una pantalla: es lo que se ve
 * mientras la pantalla real no existe, para que el esqueleto arranque sin
 * fingir contenido.
 *
 * Se borra en cuanto cada carpeta de src/paginas/ tenga su pantalla.
 */
export function PantallaPendiente({ nombre }: { nombre: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-10 text-center">
      <Construction
        className="h-6 w-6 text-suelo-500"
        aria-hidden="true"
        strokeWidth={1.75}
      />
      <h1 className="text-lg font-black text-foreground">{nombre}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        🔴 Pendiente. Esta pantalla todavía no está escrita — solo existe el andamiaje.
      </p>
    </div>
  )
}
