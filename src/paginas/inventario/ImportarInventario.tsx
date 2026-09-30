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

  /**
   * Recibe lo que se eligió o se arrastró (uno o los dos archivos a la vez) y
   * reconoce cuál es cuál por la extensión. Con los dos, muestra el cruce solo:
   * el 30/09/2026 la carga se quedó sin hacer porque los dos recuadros no
   * parecían botones y «Cargar» seguía gris sin decir por qué.
   */
  function recibir(lista: FileList | null) {
    if (lista === null) return
    let nuevoCsv = csv
    let nuevoJson = json
    for (const f of Array.from(lista)) {
      const n = f.name.toLowerCase()
      if (n.endsWith('.csv')) nuevoCsv = f
      else if (n.endsWith('.json')) nuevoJson = f
    }
    setCsv(nuevoCsv)
    setJson(nuevoJson)
    setCarga(null)
    if (nuevoCsv !== null && nuevoJson !== null) void analizar(nuevoCsv, nuevoJson)
  }

  async function analizar(archivoCsv: File | null = csv, archivoJson: File | null = json) {
    if (archivoCsv === null || archivoJson === null) return
    setError(null)
    setOcupado(true)
    try {
      const preparada = prepararCarga(await archivoCsv.text(), await archivoJson.text())
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
          Toca el recuadro y elige <span className="font-bold">los dos archivos a la vez</span> (con Ctrl o
          Mayús), o arrástralos encima. Primero se muestra el cruce; nada se guarda hasta que confirmes.
        </p>

        <label
          className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-azul/40 bg-white p-5 text-center hover:border-azul focus-within:ring-2 focus-within:ring-azul"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            recibir(e.dataTransfer.files)
          }}
        >
          <FileUp className="h-7 w-7 text-azul" aria-hidden="true" />
          <span className="font-black text-azul">Elegir los dos archivos</span>
          <input
            type="file"
            multiple
            accept=".csv,.json,text/csv,application/json"
            className="sr-only"
            onChange={(e) => {
              recibir(e.target.files)
              e.target.value = ''
            }}
          />
        </label>

        <ul className="grid gap-2 sm:grid-cols-2">
          <EstadoArchivo
            etiqueta="Cuadro de áreas del plano"
            ruta="D:\SCPCMO\00-fuente-de-verdad\inventario-unidades.csv"
            archivo={csv}
          />
          <EstadoArchivo
            etiqueta="Inventario gráfico"
            ruta="D:\SCPCMO\02-marketing\diseño\inventario grafico\data\seed.json"
            archivo={json}
          />
        </ul>

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

/** Qué archivo falta y dónde está en el equipo, o que ya se reconoció. */
function EstadoArchivo({ etiqueta, ruta, archivo }: { etiqueta: string; ruta: string; archivo: File | null }) {
  return (
    <li className="flex items-start gap-2 rounded-md border border-border bg-white p-3">
      {archivo === null ? (
        <FileUp className="mt-0.5 h-4 w-4 shrink-0 text-suelo-500" aria-hidden="true" />
      ) : (
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-azul" aria-hidden="true" />
      )}
      <span className="min-w-0">
        <span className="block font-bold text-azul">
          {etiqueta}
          {archivo === null ? ' — falta' : ' — listo'}
        </span>
        <span className="block break-all text-xs text-suelo-500">{archivo?.name ?? ruta}</span>
      </span>
    </li>
  )
}
