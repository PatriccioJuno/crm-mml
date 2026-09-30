import { useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Camera, CheckCircle2, Circle, ExternalLink, FileText, Loader2, Upload } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import { claseCampo } from '@/componentes/ui/input'
import { GrupoChips } from '@/componentes/crm/GrupoChips'
import { AvisoPendiente } from '@/componentes/crm/AvisoPendiente'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useSesion } from '@/auth/ContextoSesion'
import { leerLote, reventar, texto } from '@/lib/lectura'
import { comoRegistro } from '@/lib/acciones'
import { fechaCorta } from '@/lib/fechas'
import { urlFirmadaComprobante } from '@/lib/comprobantes'
import {
  TIPOS_DOCUMENTO,
  archivarDocumento,
  cargarDocumentos,
  documentosEsperados,
  etiquetaTipoDocumento,
  subirDocumento,
  urlFirmadaDocumento,
  type Documento,
  type TipoDocumento,
} from '@/lib/documentos'
import { Fallo, invalidarTrasAccion } from './PanelContacto'

/**
 * DOCUMENTOS DE UNA PERSONA — SPEC §7 S5.
 *
 * Por qué por PERSONA y no por oportunidad: el DNI o el contrato son de la
 * persona, aunque haya entrado en dos lanzamientos. La oportunidad se guarda
 * al subir (para saber en qué proceso llegó), pero la lista es una sola.
 *
 * El checklist sale de `documentosEsperados(estado)` (src/lib/documentos.ts,
 * cada requisito con su fuente). Si no hay oportunidad (un titular cargado
 * desde el inventario), no hay estado del embudo y no se exige nada: se
 * enseña solo la lista.
 *
 * Los vouchers de separación que ya se subieron desde Separaciones viven en
 * `separaciones.comprobante_url` (otro bucket, otras políticas): se listan
 * aquí en solo lectura para que nadie los vuelva a pedir al cliente.
 */

const SENTIDOS = [
  { valor: 'recibido', etiqueta: 'Nos lo dio el cliente' },
  { valor: 'enviado', etiqueta: 'Se lo enviamos' },
] as const

type Sentido = (typeof SENTIDOS)[number]['valor']

type Comprobante = { id: string; ruta: string; creadoEl: string | null; estado: string | null }

function leerComprobante(fila: unknown): Comprobante | null {
  const f = comoRegistro(fila)
  if (f === null) return null
  const id = texto(f['id'])
  const ruta = texto(f['comprobante_url'])
  if (id === null || ruta === null || ruta.trim() === '') return null
  return { id, ruta, creadoEl: texto(f['creado_el']), estado: texto(f['estado']) }
}

async function cargarComprobantes(personaId: string): Promise<Comprobante[]> {
  const { data, error } = await supabase
    .from('separaciones')
    .select('id, comprobante_url, creado_el, estado')
    .eq('persona_id', personaId)
    .not('comprobante_url', 'is', null)
    .order('creado_el', { ascending: false })
  reventar('No se pudieron leer los vouchers de separación', error)
  return leerLote(data, leerComprobante).filas
}

function esTipoDocumento(v: string): v is TipoDocumento {
  return TIPOS_DOCUMENTO.some((t) => t.valor === v)
}

export function SeccionDocumentos({
  personaId,
  oportunidadId,
  estado,
  puedeEditar,
}: {
  personaId: string
  oportunidadId: string | null
  estado: string | null
  puedeEditar: boolean
}) {
  const { rol, perfil } = useSesion()
  const cliente = useQueryClient()
  const idTipo = useId()
  const idNota = useId()
  const idMotivo = useId()
  const inputArchivo = useRef<HTMLInputElement | null>(null)
  const inputCamara = useRef<HTMLInputElement | null>(null)

  const [tipo, setTipo] = useState<TipoDocumento | ''>('')
  const [sentido, setSentido] = useState<Sentido | null>('recibido')
  const [nota, setNota] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)
  const [archivando, setArchivando] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [abriendo, setAbriendo] = useState<string | null>(null)

  const documentos = useQuery({
    queryKey: ['documentos', personaId],
    queryFn: () => cargarDocumentos(personaId),
  })
  const comprobantes = useQuery({
    queryKey: ['documentos', personaId, 'comprobantes'],
    queryFn: () => cargarComprobantes(personaId),
  })

  const docs = documentos.data ?? []
  const vouchers = comprobantes.data ?? []
  const requisitos = estado === null ? [] : documentosEsperados(estado)
  const esGestion = rol === 'direccion' || rol === 'administracion'

  function cumple(t: TipoDocumento): boolean {
    if (docs.some((d) => d.tipo === t)) return true
    // El voucher subido desde Separaciones también cuenta: es el mismo papel.
    return t === 'voucher_separacion' && vouchers.length > 0
  }

  async function abrir(clave: string, obtener: () => Promise<string | null>) {
    setAbriendo(clave)
    setError(null)
    const url = await obtener()
    setAbriendo(null)
    if (url === null) return setError('No se pudo abrir el archivo. Puede que ya no exista o que no tengas acceso.')
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function alElegirArchivo(archivo: File | undefined) {
    if (archivo === undefined) return
    if (tipo === '' || sentido === null) return setError('Elige primero qué documento es y quién lo dio.')
    setSubiendo(true)
    setError(null)
    setHecho(null)
    const r = await subirDocumento({ archivo, personaId, oportunidadId, tipo, sentido, nota })
    setSubiendo(false)
    if (inputArchivo.current !== null) inputArchivo.current.value = ''
    if (inputCamara.current !== null) inputCamara.current.value = ''
    if (!r.ok) return setError(r.motivo)
    setHecho(`Subido: ${etiquetaTipoDocumento(r.datos.tipo)} · ${r.datos.nombreArchivo}`)
    setNota('')
    setTipo('')
    invalidarTrasAccion(cliente, [['documentos', personaId]])
  }

  async function archivar(d: Documento) {
    const r = await archivarDocumento(d.id, motivo)
    if (!r.ok) return setError(r.motivo)
    setArchivando(null)
    setMotivo('')
    setHecho(`Archivado: ${etiquetaTipoDocumento(d.tipo)} · ${d.nombreArchivo}`)
    invalidarTrasAccion(cliente, [['documentos', personaId]])
  }

  const puedeArchivar = (d: Documento) => esGestion || (perfil !== null && d.creadoPor === perfil.id)

  return (
    <Card id="documentos">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg font-black">
          <FileText className="h-5 w-5" aria-hidden="true" />
          Documentos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {requisitos.length > 0 && (
          <ul className="space-y-1" aria-label="Documentos que tocan en este estado">
            {requisitos.map((req) => {
              const ok = cumple(req.tipo)
              return (
                <li key={req.tipo} className="flex items-start gap-2 text-sm" title={`Fuente: ${req.fuente}`}>
                  {ok ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-azul" aria-hidden="true" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-suelo-700" aria-hidden="true" />
                  )}
                  <span className={cn('min-w-0', ok ? 'font-bold text-suelo' : 'text-suelo')}>
                    {req.etiqueta}
                    <span className="font-normal text-suelo-700"> · {ok ? 'ya está' : req.cuando}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {documentos.isPending && <p className="text-sm text-suelo-700">Cargando documentos…</p>}
        {documentos.isError && <Fallo>No se pudieron leer los documentos. {documentos.error.message}</Fallo>}
        {documentos.isSuccess && docs.length === 0 && vouchers.length === 0 && (
          <p className="text-sm text-suelo-700">Todavía no hay documentos de esta persona.</p>
        )}

        {docs.length > 0 && (
          <ul className="divide-y divide-input">
            {docs.map((d) => (
              <li key={d.id} className="space-y-2 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-sm">
                    <p className="font-bold text-suelo">{etiquetaTipoDocumento(d.tipo)}</p>
                    <p className="truncate text-suelo-700" title={d.nombreArchivo}>
                      {d.nombreArchivo}
                    </p>
                    <p className="text-suelo-700">
                      {fechaCorta(d.creadoEl)} · {d.sentido === 'enviado' ? 'enviado' : 'recibido'}
                      {d.nota !== null && ` · ${d.nota}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 sm:h-9"
                      disabled={abriendo !== null}
                      onClick={() => void abrir(d.id, () => urlFirmadaDocumento(d.ruta))}
                    >
                      {abriendo === d.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      )}
                      Ver
                    </Button>
                    {puedeArchivar(d) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 sm:h-9 sm:w-9"
                        aria-label={`Archivar ${etiquetaTipoDocumento(d.tipo)}`}
                        onClick={() => {
                          setArchivando(archivando === d.id ? null : d.id)
                          setMotivo('')
                        }}
                      >
                        <Archive className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </div>
                {archivando === d.id && (
                  <div className="space-y-2">
                    <label htmlFor={idMotivo} className="text-sm font-bold text-suelo">
                      ¿Por qué se archiva? (queda registrado, no se borra)
                    </label>
                    <input
                      id={idMotivo}
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder="Ej.: foto borrosa, se subió otra"
                      className={claseCampo}
                    />
                    <div className="flex gap-2">
                      <Button variant="destructive" className="h-11 sm:h-10" onClick={() => void archivar(d)}>
                        Archivar
                      </Button>
                      <Button variant="ghost" className="h-11 sm:h-10" onClick={() => setArchivando(null)}>
                        Volver
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {vouchers.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-bold text-suelo">Vouchers subidos en Separaciones</p>
            <ul className="divide-y divide-input">
              {vouchers.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="text-suelo-700">Voucher · {fechaCorta(v.creadoEl)}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 sm:h-9"
                    disabled={abriendo !== null}
                    onClick={() => void abrir(v.id, () => urlFirmadaComprobante(v.ruta))}
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    Ver
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {comprobantes.isError && <Fallo>No se pudieron leer los vouchers. {comprobantes.error.message}</Fallo>}

        {puedeEditar && (
          <div className="space-y-3 border-t border-input pt-3">
            <p className="text-sm font-bold text-suelo">Subir un documento</p>
            <div>
              <label htmlFor={idTipo} className="text-sm font-bold text-suelo">
                ¿Qué es?
              </label>
              <select
                id={idTipo}
                value={tipo}
                onChange={(e) => setTipo(esTipoDocumento(e.target.value) ? e.target.value : '')}
                className={claseCampo}
              >
                <option value="">Elige…</option>
                {TIPOS_DOCUMENTO.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.etiqueta}
                  </option>
                ))}
              </select>
              {tipo === 'dni' && (
                <AvisoPendiente className="mt-1">
                  Súbelo solo cuando haga falta para separar (Ley 29733: dato mínimo necesario).
                </AvisoPendiente>
              )}
            </div>
            <GrupoChips etiqueta="¿Quién lo dio?" opciones={SENTIDOS} valor={sentido} alCambiar={setSentido} />
            <div>
              <label htmlFor={idNota} className="text-sm font-bold text-suelo">
                Nota (opcional)
              </label>
              <input
                id={idNota}
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                maxLength={500}
                className={claseCampo}
              />
            </div>
            {/* Dos entradas: la cámara directa (el voucher se fotografía en el
                momento) y el archivo (un PDF no sale de la cámara). */}
            <input
              ref={inputCamara}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => void alElegirArchivo(e.target.files?.[0])}
            />
            <input
              ref={inputArchivo}
              type="file"
              accept="image/*,application/pdf"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => void alElegirArchivo(e.target.files?.[0])}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="h-11 sm:h-10"
                disabled={subiendo || tipo === ''}
                onClick={() => inputCamara.current?.click()}
              >
                <Camera className="h-4 w-4" aria-hidden="true" />
                Tomar foto
              </Button>
              <Button
                variant="outline"
                className="h-11 sm:h-10"
                disabled={subiendo || tipo === ''}
                onClick={() => inputArchivo.current?.click()}
              >
                {subiendo ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="h-4 w-4" aria-hidden="true" />
                )}
                Elegir archivo
              </Button>
            </div>
            {tipo === '' && <p className="text-sm text-suelo-700">Elige qué documento es para poder subirlo.</p>}
          </div>
        )}

        {error !== null && <Fallo>{error}</Fallo>}
        {hecho !== null && (
          <p role="status" className="text-sm font-bold text-suelo">
            {hecho}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
