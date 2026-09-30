import { useState } from 'react'
import { AlertTriangle, Check, FileUp, Loader2 } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import { prepararCarga, importarInventario, type CargaPreparada, type CargaHecha } from '@/lib/importar-inventario'

/**
 * «Cargar el inventario del plano» — la carga inicial de /inventario.
 *
 * Solo aparece con el inventario VACÍO y para Dirección o Administración (lo
 * mismo que exige fn_importar_inventario en 14-inventario-grafico.sql; aquí es
 * comodidad, la base lo vuelve a comprobar).
 *
 * Tres pasos a la vista, sin atajos:
 *  1. Elegir los dos archivos locales: el CSV del cuadro de áreas
 *     (00-fuente-de-verdad) y el seed.json del inventario gráfico.
 *  2. Ver el cruce ANTES de escribir: cuántas unidades, cuántos titulares,
 *     cuántas quedan ofrecibles y cuántas entran con aviso de revisión.
 *  3. Cargar: una sola transacción en la base. O entra todo o no entra nada.
 *
 * Los archivos se leen en el navegador de quien los custodia y viajan
 * directamente a la base. No pasan por el repositorio (Ley 29733).
 */
export function ImportarInventario({ alCargar }: { alCargar: () => void }) {
  const [csv, setCsv] = useState<File | null>(null)
  const [json, setJson] = useState<File | null>(null)
  const [carga, setCarga] = useState<CargaPreparada | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [hecho, setHecho] = useState<CargaHecha | null>(null)

  async function analizar() {
    if (csv === null || json === null) return
    setError(null)
    setOcupado(true)
    try {
      const preparada = prepararCarga(await csv.text(), await json.text())
      // La base valida permiso, inventario vacío y códigos únicos sin escribir nada.
      const prueba = await importarInventario(preparada, true)
      if (!prueba.ok) {
        setError(prueba.motivo)
        setCarga(null)
      } else {
        setCarga(preparada)
      }
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : String(fallo))
      setCarga(null)
    } finally {
      setOcupado(false)
    }
  }

  async function cargar() {
    if (carga === null) return
    setError(null)
    setOcupado(true)
    const resultado = await importarInventario(carga, false)
    setOcupado(false)
    if (!resultado.ok) {
      setError(resultado.motivo)
      return
    }
    setHecho(resultado.datos)
    alCargar()
  }

  if (hecho !== null) {
    return (
      <Card className="mb-4">
        <CardContent className="flex items-start gap-3 p-4 text-sm">
          <Check className="mt-0.5 h-5 w-5 shrink-0 text-azul" aria-hidden="true" />
          <p className="font-bold text-azul">
            Inventario cargado: {hecho.unidades} unidades y {hecho.titularesNuevos} titulares nuevos
            {hecho.titularesReutilizados > 0 ? ` (${hecho.titularesReutilizados} ya estaban en el CRM)` : ''}.
          </p>
        </CardContent>
      </Card>
    )
  }

  const r = carga?.resumen
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Cargar el inventario del plano</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="leading-relaxed text-suelo-700">
          Elige los dos archivos desde tu equipo. Primero se muestra el cruce; nada se guarda hasta que
          confirmes.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <SelectorArchivo
            etiqueta="1 · Cuadro de áreas del plano"
            ayuda="00-fuente-de-verdad / inventario-unidades.csv"
            aceptar=".csv,text/csv"
            archivo={csv}
            alElegir={(f) => {
              setCsv(f)
              setCarga(null)
            }}
          />
          <SelectorArchivo
            etiqueta="2 · Inventario gráfico"
            ayuda="02-marketing / diseño / inventario grafico / data / seed.json"
            aceptar=".json,application/json"
            archivo={json}
            alElegir={(f) => {
              setJson(f)
              setCarga(null)
            }}
          />
        </div>

        {error !== null && (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-alerta-suave p-3 font-bold text-alerta">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        {r !== undefined && (
          <div className="rounded-md border border-border bg-tinta-fila p-3 leading-relaxed">
            <p className="font-bold text-azul">
              {r.unidades} unidades ({r.puestos} puestos · {r.tiendas} tiendas) · {r.titulares} titulares
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-suelo-700">
              <li>
                Disponibles: {r.disponiblesPuestos} puestos y {r.disponiblesTiendas} tiendas. Quedarán ofrecibles{' '}
                <span className="font-bold">{r.ofrecibles}</span>: las demás tienen un dato por confirmar.
              </li>
              <li>{r.porRevisar} unidades entran con un aviso de revisión (plano y kardex no coinciden en algo).</li>
              {r.sinArea.length > 0 && <li>Sin área en el plano (no se ofrecen): {r.sinArea.join(', ')}.</li>}
              {r.sinUbicacion.length > 0 && (
                <li>Sin ubicación en el dibujo (aparecen en la lista, no en el plano): {r.sinUbicacion.join(', ')}.</li>
              )}
              {r.soloEnPlano.length > 0 && <li>Solo están en el plano, no en el kardex: {r.soloEnPlano.join(', ')}.</li>}
              {r.soloEnInventarioGrafico.length > 0 && (
                <li className="font-bold">
                  Están en el inventario gráfico pero NO en el plano (no se cargan): {r.soloEnInventarioGrafico.join(', ')}.
                </li>
              )}
            </ul>
            <p className="mt-2 text-xs text-suelo-500">
              No se cargan los montos del kardex (van sin moneda y son cobranza) ni el estado civil de los
              titulares.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={csv === null || json === null || ocupado} onClick={() => void analizar()}>
            {ocupado && carga === null ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Ver el cruce
          </Button>
          <Button disabled={carga === null || ocupado} onClick={() => void cargar()}>
            {ocupado && carga !== null ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {r !== undefined ? `Cargar ${r.unidades} unidades` : 'Cargar'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function SelectorArchivo({
  etiqueta,
  ayuda,
  aceptar,
  archivo,
  alElegir,
}: {
  etiqueta: string
  ayuda: string
  aceptar: string
  archivo: File | null
  alElegir: (f: File | null) => void
}) {
  return (
    <label className="flex min-h-11 cursor-pointer flex-col gap-1 rounded-md border border-input bg-white p-3 focus-within:ring-2 focus-within:ring-azul">
      <span className="flex items-center gap-2 font-bold text-azul">
        <FileUp className="h-4 w-4" aria-hidden="true" />
        {etiqueta}
      </span>
      <span className="text-xs text-suelo-500">{archivo?.name ?? ayuda}</span>
      <input
        type="file"
        accept={aceptar}
        className="sr-only"
        onChange={(e) => alElegir(e.target.files?.[0] ?? null)}
      />
    </label>
  )
}
