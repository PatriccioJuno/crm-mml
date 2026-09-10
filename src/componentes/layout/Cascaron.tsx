import { Outlet } from 'react-router-dom'
import { BarraLateral } from './BarraLateral'

/**
 * Cascaron de la aplicacion: barra lateral azul fija + area de trabajo en cal.
 * Cada pantalla se monta en el <Outlet />. El cascaron no contiene logica de
 * negocio ni datos.
 */
export function Cascaron() {
  return (
    <div className="flex min-h-screen bg-background">
      <BarraLateral />
      <main className="flex-1 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  )
}
