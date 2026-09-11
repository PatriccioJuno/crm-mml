import { CalidadDelDato } from './CalidadDelDato'
import { Campanas } from './Campanas'
import { Conversiones } from './Conversiones'
import { Embudo } from './Embudo'
import { InsumosSemanales } from './InsumosSemanales'

/**
 * REPORTES — lo que las vistas SQL ya calculan, y nada más.
 *
 * ===========================================================================
 * LA REGLA DE ESTA PANTALLA
 * ===========================================================================
 * «Ningún gráfico debe inventar una escala ni un promedio que la vista no
 * calcule: si un dato no está en la vista SQL, el gráfico no lo muestra.»
 *
 * En la práctica, en todos estos componentes no hay ni una división, ni un
 * porcentaje, ni una media: las tasas vienen de `v_conversion`, los costos por
 * lead y por contrato de `v_rendimiento_campanas`, los conteos de `v_embudo` y
 * de `v_calidad_del_dato`. Lo único que se hace aquí es leer, ordenar y
 * pintar. Lo que ninguna vista calcula se enseña como hueco con su motivo
 * —ver el bloque de fórmulas sin vista en Conversiones— en vez de calcularse
 * en el navegador: una cifra calculada en el cliente no se puede auditar
 * contra el SQL, y en un reporte que va a leer Walter eso es justo el problema
 * que el CRM viene a resolver.
 *
 * ===========================================================================
 * EL ORDEN NO ES CASUAL
 * ===========================================================================
 * 1 · Calidad del dato, arriba del todo: si estos contadores son altos, todo
 *     lo demás está calculado sobre datos incompletos y hay que saberlo antes
 *     de leer un porcentaje.
 * 2 · Embudo — dónde está la gente.
 * 3 · Conversiones — cuánta se cae en cada paso.
 * 4 · Campañas — cuánto costó traerla.
 * 5 · Insumos del reporte semanal — la evidencia de las partes 1, 2 y 3.
 *
 * ===========================================================================
 * NI UN SOLO TOTAL MEZCLA MONEDAS
 * ===========================================================================
 * Donde hay dinero —inversión de campañas y pagos de los insumos— se muestra
 * una cifra por moneda, nunca una suma. La moneda de control del negocio sigue
 * [PENDIENTE] en 00-fuente-de-verdad\moneda-de-comunicacion.md (R7).
 */
export function PantallaReportes() {
  return (
    <div className="w-full px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-black tracking-tight text-foreground">Reportes</h1>
        <p className="mt-1 max-w-3xl text-sm leading-snug text-suelo-700">
          Todo lo de esta pantalla lo calcula una vista SQL de{' '}
          <code>02-codigo\sql\03-vistas.sql</code>. Nada se calcula en el navegador: si una cifra
          no está en una vista, aquí sale como hueco y se dice por qué.
        </p>
      </header>

      <div className="space-y-10">
        <CalidadDelDato />
        <Embudo />
        <Conversiones />
        <Campanas />
        <InsumosSemanales />
      </div>
    </div>
  )
}
