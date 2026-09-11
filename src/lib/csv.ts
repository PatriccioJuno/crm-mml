import { format } from 'date-fns'

/**
 * Exportar una tabla a CSV.
 *
 * ===========================================================================
 * POR QUE ESTO NO ES TRIVIAL
 * ===========================================================================
 * Un CSV mal escrito no falla: se abre y MIENTE. Los tres cuidados de aquí son
 * los tres que rompen una exportación de este CRM en concreto:
 *
 *  1 · **BOM al principio.** Sin él, Excel en Windows —que es donde se va a
 *      abrir esto— lee el archivo como ANSI y «Juño» sale «JuÃ±o». Un nombre
 *      corrupto en un reporte que se manda fuera es un error visible.
 *
 *  2 · **Punto y coma como separador.** Excel en configuración regional
 *      española usa la coma como separador decimal, así que con comas parte
 *      los montos por la mitad y desplaza todas las columnas. Con `;` no.
 *
 *  3 · **Los montos salen tal cual llegan, con su moneda en su propia
 *      columna.** No se formatean con símbolo ni con separador de miles: eso
 *      los convertiría en texto y dejarían de poder sumarse en la hoja. Y la
 *      moneda va aparte para que nadie sume dos columnas de monedas distintas
 *      sin darse cuenta (R7).
 *
 * Lo que este archivo NO hace: calcular totales, ni añadir una fila de suma.
 * Si el CSV llevara un total, sería un número calculado aquí que no está en
 * ninguna vista.
 */

/** Una columna: su título y cómo sacar su valor de la fila. */
export type ColumnaCSV<T> = {
  titulo: string
  valor: (fila: T) => string | number | null
}

/**
 * Escapa un campo. Se entrecomilla siempre que aparezca el separador, una
 * comilla o un salto de línea; las comillas internas se duplican, que es lo
 * que dice el RFC 4180 y lo que Excel espera.
 */
function escapar(valor: string | number | null): string {
  if (valor === null) return ''
  const texto = String(valor)
  if (texto === '') return ''

  // Un campo que empieza por = + - @ lo interpreta Excel como fórmula. Es la
  // vía clásica de inyección en CSV, y aquí los nombres los escriben personas
  // desde un formulario: se neutraliza con una comilla simple delante.
  const seguro = /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto

  if (/[;"\n\r]/.test(seguro)) {
    return `"${seguro.replace(/"/g, '""')}"`
  }
  return seguro
}

export function construirCSV<T>(filas: readonly T[], columnas: readonly ColumnaCSV<T>[]): string {
  const cabecera = columnas.map((c) => escapar(c.titulo)).join(';')
  const cuerpo = filas.map((fila) => columnas.map((c) => escapar(c.valor(fila))).join(';'))
  return [cabecera, ...cuerpo].join('\r\n')
}

/**
 * Descarga el CSV. El nombre lleva la fecha para que dos exportaciones del
 * mismo cuadro no se pisen en la carpeta de descargas.
 */
export function descargarCSV(nombre: string, contenido: string): void {
  const BOM = '﻿'
  const blob = new Blob([BOM + contenido], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = `${nombre}-${format(new Date(), 'yyyy-MM-dd')}.csv`
  document.body.appendChild(enlace)
  enlace.click()
  document.body.removeChild(enlace)

  // Sin esto el blob se queda en memoria hasta que se recarga la página.
  URL.revokeObjectURL(url)
}

/** Atajo: construir y descargar en un paso. */
export function exportarCSV<T>(
  nombre: string,
  filas: readonly T[],
  columnas: readonly ColumnaCSV<T>[],
): void {
  descargarCSV(nombre, construirCSV(filas, columnas))
}
