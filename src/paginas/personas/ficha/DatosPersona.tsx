import { useId, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil, ShieldCheck } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import { claseCampo } from '@/componentes/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog'
import { AvisoPendiente } from '@/componentes/crm/AvisoPendiente'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { booleano, texto } from '@/lib/lectura'
import { fechaHora } from '@/lib/fechas'
import { formatearTelefono, normalizarTelefono } from '@/lib/telefono'
import { REDES_SOCIALES } from '@/lib/lote'
import { etiquetaOrigen } from '@/lib/embudo'
import { Fallo, invalidarTrasAccion } from './PanelContacto'

/**
 * DATOS DE LA PERSONA — contacto, documento y consentimiento.
 *
 * ===========================================================================
 * POR QUE LA LECTURA Y LA ESCRITURA ESTAN AQUI
 * ===========================================================================
 * `v_cartera` trae lo que necesita una lista (nombre, teléfono, @usuario,
 * correo) pero no el documento, la ciudad, las notas ni el consentimiento. No
 * hay todavía un `src/lib/personas.ts`, y esta sección es la única que los
 * lee; cuando otra pantalla los necesite, `cargarPersona` y
 * `actualizarPersona` se mudan allí tal cual (anotado en el README).
 *
 * Se escribe directo en `personas` (política `personas_editar`, 02-rls.sql:
 * dirección, comercial y administración). El `.select('id')` final no es
 * decoración: con RLS, un `update` que no encaja en la política no da error,
 * afecta CERO filas y responde 200 (mismo caso que `moverOportunidad`).
 *
 * ===========================================================================
 * LO QUE NO SE EDITA AQUI
 * ===========================================================================
 * El consentimiento (Ley 29733): se enseña, no se toca. Lo registra quien
 * capta el lead con su canal y su evidencia (`fn_registrar_prospecto`), y lo
 * quita la base cuando la persona pide no ser contactada (SOP-SEGUIMIENTO:61).
 * Un casillero de «consentimiento» editable en una ficha es exactamente como
 * se fabrica un consentimiento que nadie dio.
 */

export type PersonaFicha = {
  id: string
  nombreCompleto: string
  telefonoE164: string | null
  telefonoAlterno: string | null
  email: string | null
  usuarioRed: string | null
  redSocial: string | null
  docTipo: string | null
  docNumero: string | null
  ciudad: string | null
  notas: string | null
  origen: string | null
  consentimiento: boolean
  consentimientoFecha: string | null
  consentimientoCanal: string | null
  consentimientoVersion: string | null
  fuenteDelDato: string | null
  noContactarEl: string | null
  noContactarMotivo: string | null
  creadoEl: string
}

const COLUMNAS_PERSONA =
  'id, nombre_completo, telefono_e164, telefono_alterno, email, usuario_red, red_social, ' +
  'doc_tipo, doc_numero, ciudad, notas, origen, consentimiento, consentimiento_fecha, ' +
  'consentimiento_canal, consentimiento_version, fuente_del_dato, no_contactar_el, ' +
  'no_contactar_motivo, creado_el'

function interpretarPersona(fila: unknown): PersonaFicha | null {
  if (typeof fila !== 'object' || fila === null) return null
  const f = fila as Record<string, unknown>
  const id = texto(f['id'])
  const nombreCompleto = texto(f['nombre_completo'])
  const creadoEl = texto(f['creado_el'])
  // `consentimiento` es NOT NULL en la base; si no llega un booleano se lee
  // como NO: un «no sé» no autoriza a escribirle a nadie (Ley 29733).
  const consentimiento = booleano(f['consentimiento']) === true
  if (id === null || nombreCompleto === null || creadoEl === null) return null
  return {
    id,
    nombreCompleto,
    telefonoE164: texto(f['telefono_e164']),
    telefonoAlterno: texto(f['telefono_alterno']),
    email: texto(f['email']),
    usuarioRed: texto(f['usuario_red']),
    redSocial: texto(f['red_social']),
    docTipo: texto(f['doc_tipo']),
    docNumero: texto(f['doc_numero']),
    ciudad: texto(f['ciudad']),
    notas: texto(f['notas']),
    origen: texto(f['origen']),
    consentimiento,
    consentimientoFecha: texto(f['consentimiento_fecha']),
    consentimientoCanal: texto(f['consentimiento_canal']),
    consentimientoVersion: texto(f['consentimiento_version']),
    fuenteDelDato: texto(f['fuente_del_dato']),
    noContactarEl: texto(f['no_contactar_el']),
    noContactarMotivo: texto(f['no_contactar_motivo']),
    creadoEl,
  }
}

function mensajeDePersona(mensaje: string): string {
  if (mensaje.includes('usuario_red') || mensaje.includes('no_contactar')) {
    return 'Falta ejecutar sql/13-seguimiento-comercial.sql en Supabase: la tabla personas todavía no tiene las columnas nuevas.'
  }
  if (mensaje.includes('personas_doc_unico')) {
    return 'Ya hay otra persona registrada con ese documento. Búscala antes de duplicarla.'
  }
  if (mensaje.includes('personas_usuario_red_valido') || mensaje.includes('personas_red_social_valido')) {
    return 'El @usuario o la red no son válidos para la base: sin arroba, sin espacios, en minúsculas.'
  }
  return mensajeDeError(mensaje)
}

/** La fila de `personas`, o `null` si no existe o RLS no la deja ver. Lanza si falla (para useQuery). */
export async function cargarPersona(personaId: string): Promise<PersonaFicha | null> {
  const { data, error } = await supabase
    .from('personas')
    .select(COLUMNAS_PERSONA)
    .eq('id', personaId)
    .maybeSingle()
  if (error !== null) throw new Error(mensajeDePersona(error.message))
  return data === null ? null : interpretarPersona(data)
}

/** Columnas que esta ficha puede cambiar. Ni el consentimiento ni el opt-out: ver la cabecera. */
export type CambiosPersona = Partial<{
  nombre_completo: string
  telefono_e164: string | null
  telefono_alterno: string | null
  email: string | null
  usuario_red: string | null
  red_social: string | null
  doc_tipo: string | null
  doc_numero: string | null
  ciudad: string | null
  notas: string | null
}>

export async function actualizarPersona(
  personaId: string,
  cambios: CambiosPersona,
): Promise<ResultadoAccion<true>> {
  if (Object.keys(cambios).length === 0) return { ok: false, motivo: 'No hay nada que guardar.' }

  const { data, error } = await supabase.from('personas').update(cambios).eq('id', personaId).select('id')
  if (error !== null) return { ok: false, motivo: mensajeDePersona(error.message) }
  if (!Array.isArray(data) || data.length === 0) {
    return {
      ok: false,
      motivo:
        'La base no aplicó el cambio y tampoco devolvió un error: tu rol no puede editar esta persona ' +
        '(política personas_editar de RLS).',
    }
  }
  return { ok: true, datos: true }
}

/** Tipos de documento que anota el esquema (01-schema.sql: `doc_tipo -- DNI | CE | RUC | Pasaporte`). */
const TIPOS_DOC = ['DNI', 'CE', 'RUC', 'Pasaporte'] as const

/** El mismo formato que exige `fn_registrar_prospecto` (SPEC §4.5) y `whatsapp.ts`. */
const USUARIO_VALIDO = /^[a-z0-9._]{2,40}$/

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function etiquetaRed(red: string | null): string {
  if (red === null) return ''
  return REDES_SOCIALES.find((r) => r.valor === red)?.etiqueta ?? red
}

export function DatosPersona({ personaId, puedeEditar }: { personaId: string; puedeEditar: boolean }) {
  const [editando, setEditando] = useState(false)
  const persona = useQuery({
    queryKey: ['ficha', personaId, 'persona'],
    queryFn: () => cargarPersona(personaId),
  })

  const p = persona.data ?? null

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">Datos de la persona</CardTitle>
        {puedeEditar && p !== null && (
          <Button variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => setEditando(true)}>
            <Pencil aria-hidden="true" />
            Editar
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {persona.isPending && (
          <p className="flex items-center gap-2 text-sm text-suelo-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Cargando…
          </p>
        )}
        {persona.isError && <Fallo>{persona.error.message}</Fallo>}
        {persona.isSuccess && p === null && (
          <p className="text-sm text-suelo-700">
            No se encontró la persona, o tu rol no puede leerla (política personas_leer).
          </p>
        )}

        {p !== null && (
          <>
            <dl className="grid gap-3">
              <Dato etiqueta="Teléfono">
                {p.telefonoE164 === null ? '—' : formatearTelefono(p.telefonoE164)}
                {p.telefonoAlterno !== null && (
                  <span className="block text-suelo-700">Alterno: {formatearTelefono(p.telefonoAlterno)}</span>
                )}
              </Dato>
              <Dato etiqueta="Correo">{p.email ?? '—'}</Dato>
              <Dato etiqueta="Red social">
                {p.usuarioRed === null ? '—' : `@${p.usuarioRed}${p.redSocial === null ? '' : ` · ${etiquetaRed(p.redSocial)}`}`}
              </Dato>
              <Dato etiqueta="Documento">
                {p.docTipo === null && p.docNumero === null
                  ? '—'
                  : `${p.docTipo ?? '¿tipo?'} ${p.docNumero ?? '¿número?'}`}
              </Dato>
              <Dato etiqueta="Ciudad">{p.ciudad ?? '—'}</Dato>
              <Dato etiqueta="Origen">{p.origen === null ? '—' : etiquetaOrigen(p.origen)}</Dato>
              {p.notas !== null && (
                <Dato etiqueta="Notas">
                  <span className="whitespace-pre-line">{p.notas}</span>
                </Dato>
              )}
            </dl>
            <Consentimiento persona={p} />
          </>
        )}
      </CardContent>

      {p !== null && editando && (
        <DialogoEditarPersona persona={p} alCerrar={() => setEditando(false)} />
      )}
    </Card>
  )
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-suelo-500">{etiqueta}</dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{children}</dd>
    </div>
  )
}

/**
 * Solo lectura. La versión del aviso sigue '[PENDIENTE]' mientras Dirección no
 * ratifique `aviso_privacidad_version` (así lo deja `fn_registrar_prospecto`
 * hoy, SPEC §3): se dice con 🟡, no se esconde.
 */
function Consentimiento({ persona: p }: { persona: PersonaFicha }) {
  const versionPendiente = p.consentimientoVersion === null || p.consentimientoVersion.includes('PENDIENTE')

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <p className="flex items-center gap-2 text-sm font-bold text-foreground">
        <ShieldCheck className="h-4 w-4 text-azul" strokeWidth={1.75} aria-hidden="true" />
        Consentimiento (Ley 29733)
      </p>

      {p.noContactarEl !== null && (
        <p className="text-sm font-bold text-foreground">
          Pidió no ser contactada el {fechaHora(p.noContactarEl)}
          {p.noContactarMotivo !== null && ` · ${p.noContactarMotivo}`}. Solo se vuelve a contactar
          con consentimiento renovado.
        </p>
      )}

      <dl className="grid gap-2 text-sm">
        <Dato etiqueta="¿Dio su consentimiento?">
          {p.consentimiento ? 'Sí' : 'No'}
          {p.consentimientoFecha !== null && ` · ${fechaHora(p.consentimientoFecha)}`}
        </Dato>
        <Dato etiqueta="Canal">{p.consentimientoCanal ?? '—'}</Dato>
        <Dato etiqueta="Versión del aviso">{p.consentimientoVersion ?? '—'}</Dato>
        <Dato etiqueta="De dónde salió el dato">{p.fuenteDelDato ?? '—'}</Dato>
      </dl>

      {versionPendiente && (
        <AvisoPendiente className="text-xs">
          🟡 La versión del aviso de privacidad sigue sin ratificar (aviso_privacidad_version). El
          consentimiento quedó registrado con su canal y su evidencia, pero no se puede citar qué texto
          aceptó hasta que Dirección la confirme.
        </AvisoPendiente>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------------

type Borrador = {
  nombre: string
  telefono: string
  telefonoAlterno: string
  email: string
  usuarioRed: string
  redSocial: string
  docTipo: string
  docNumero: string
  ciudad: string
  notas: string
}

function borradorDe(p: PersonaFicha): Borrador {
  return {
    nombre: p.nombreCompleto,
    telefono: p.telefonoE164 ?? '',
    telefonoAlterno: p.telefonoAlterno ?? '',
    email: p.email ?? '',
    usuarioRed: p.usuarioRed ?? '',
    redSocial: p.redSocial ?? '',
    docTipo: p.docTipo ?? '',
    docNumero: p.docNumero ?? '',
    ciudad: p.ciudad ?? '',
    notas: p.notas ?? '',
  }
}

function vacioONulo(v: string): string | null {
  const t = v.trim()
  return t === '' ? null : t
}

/**
 * Valida el borrador y devuelve SOLO lo que cambió (así la bitácora y el
 * registro de cambios no se llenan de «cambió X por X»), o el motivo.
 */
function cambiosDe(b: Borrador, p: PersonaFicha): { ok: true; cambios: CambiosPersona } | { ok: false; motivo: string } {
  const nombre = b.nombre.trim().replace(/\s+/g, ' ')
  if (nombre === '') return { ok: false, motivo: 'El nombre no puede quedar vacío.' }

  let telefono: string | null = null
  if (b.telefono.trim() !== '') {
    const t = normalizarTelefono(b.telefono)
    if (!t.ok) return { ok: false, motivo: `Teléfono: ${t.motivo}` }
    telefono = t.e164
  }

  let alterno: string | null = null
  if (b.telefonoAlterno.trim() !== '') {
    const t = normalizarTelefono(b.telefonoAlterno)
    if (!t.ok) return { ok: false, motivo: `Teléfono alterno: ${t.motivo}` }
    alterno = t.e164
  }

  const email = vacioONulo(b.email)
  if (email !== null && !CORREO_VALIDO.test(email)) {
    return { ok: false, motivo: 'El correo no parece válido. Revísalo o déjalo vacío.' }
  }

  const usuario = vacioONulo(b.usuarioRed.replace(/^@+/, '').toLowerCase())
  if (usuario !== null && !USUARIO_VALIDO.test(usuario)) {
    return {
      ok: false,
      motivo: 'El @usuario solo puede tener letras minúsculas, números, punto y guion bajo (2 a 40), sin espacios.',
    }
  }
  const red = vacioONulo(b.redSocial)
  if (usuario !== null && red === null) return { ok: false, motivo: 'Elige en qué red está ese @usuario.' }

  if (telefono === null && usuario === null) {
    return {
      ok: false,
      motivo: 'Deja al menos un teléfono o un @usuario: sin ninguno de los dos no hay forma de contactarla.',
    }
  }

  const docTipo = vacioONulo(b.docTipo)
  const docNumero = vacioONulo(b.docNumero)
  if ((docTipo === null) !== (docNumero === null)) {
    return { ok: false, motivo: 'El documento va completo (tipo y número) o se deja vacío.' }
  }

  const propuesto: Required<CambiosPersona> = {
    nombre_completo: nombre,
    telefono_e164: telefono,
    telefono_alterno: alterno,
    email,
    usuario_red: usuario,
    red_social: usuario === null ? null : red,
    doc_tipo: docTipo,
    doc_numero: docNumero,
    ciudad: vacioONulo(b.ciudad),
    notas: vacioONulo(b.notas),
  }
  const actual: Required<CambiosPersona> = {
    nombre_completo: p.nombreCompleto,
    telefono_e164: p.telefonoE164,
    telefono_alterno: p.telefonoAlterno,
    email: p.email,
    usuario_red: p.usuarioRed,
    red_social: p.redSocial,
    doc_tipo: p.docTipo,
    doc_numero: p.docNumero,
    ciudad: p.ciudad,
    notas: p.notas,
  }

  const cambios: Record<string, string | null> = {}
  for (const clave of Object.keys(propuesto) as (keyof CambiosPersona)[]) {
    if (propuesto[clave] !== actual[clave]) cambios[clave] = propuesto[clave]
  }
  // `nombre_completo` nunca llega aquí como null (se validó arriba): la
  // aserción solo estrecha el registro genérico al tipo de columnas.
  return { ok: true, cambios: cambios as CambiosPersona }
}

function DialogoEditarPersona({ persona, alCerrar }: { persona: PersonaFicha; alCerrar: () => void }) {
  const cliente = useQueryClient()
  const base = useId()
  const [b, setB] = useState<Borrador>(() => borradorDe(persona))
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  function campo<K extends keyof Borrador>(clave: K, valor: Borrador[K]): void {
    setB((actual) => ({ ...actual, [clave]: valor }))
  }

  async function guardar(): Promise<void> {
    const r = cambiosDe(b, persona)
    if (!r.ok) {
      setFallo(r.motivo)
      return
    }
    if (Object.keys(r.cambios).length === 0) {
      alCerrar()
      return
    }
    setGuardando(true)
    setFallo(null)
    const hecho = await actualizarPersona(persona.id, r.cambios)
    setGuardando(false)
    if (!hecho.ok) {
      setFallo(hecho.motivo)
      return
    }
    invalidarTrasAccion(cliente, [['visitas']])
    alCerrar()
  }

  const id = (sufijo: string): string => `${base}-${sufijo}`

  return (
    <Dialog open onOpenChange={(a) => !a && !guardando && alCerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-black">Editar datos</DialogTitle>
          <DialogDescription>
            Solo lo necesario para contactarla (Ley 29733: dato mínimo necesario).
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void guardar()
          }}
        >
          <Campo id={id('nombre')} etiqueta="Nombre completo">
            <input
              id={id('nombre')}
              value={b.nombre}
              onChange={(e) => campo('nombre', e.target.value)}
              autoComplete="off"
              className={claseCampo}
            />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id={id('tel')} etiqueta="Teléfono">
              <input
                id={id('tel')}
                type="tel"
                inputMode="tel"
                value={b.telefono}
                onChange={(e) => campo('telefono', e.target.value)}
                placeholder="999 888 777"
                className={claseCampo}
              />
            </Campo>
            <Campo id={id('tel2')} etiqueta="Teléfono alterno">
              <input
                id={id('tel2')}
                type="tel"
                inputMode="tel"
                value={b.telefonoAlterno}
                onChange={(e) => campo('telefonoAlterno', e.target.value)}
                className={claseCampo}
              />
            </Campo>
          </div>
          <Campo id={id('correo')} etiqueta="Correo">
            <input
              id={id('correo')}
              type="email"
              inputMode="email"
              value={b.email}
              onChange={(e) => campo('email', e.target.value)}
              className={claseCampo}
            />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id={id('usuario')} etiqueta="@usuario">
              <input
                id={id('usuario')}
                value={b.usuarioRed}
                onChange={(e) => campo('usuarioRed', e.target.value)}
                autoCapitalize="none"
                placeholder="@rosita"
                className={claseCampo}
              />
            </Campo>
            <Campo id={id('red')} etiqueta="Red">
              <select
                id={id('red')}
                value={b.redSocial}
                onChange={(e) => campo('redSocial', e.target.value)}
                className={claseCampo}
              >
                <option value="">Sin red</option>
                {REDES_SOCIALES.map((r) => (
                  <option key={r.valor} value={r.valor}>
                    {r.etiqueta}
                  </option>
                ))}
              </select>
            </Campo>
          </div>
          <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <Campo id={id('doctipo')} etiqueta="Documento">
              <select
                id={id('doctipo')}
                value={b.docTipo}
                onChange={(e) => campo('docTipo', e.target.value)}
                className={claseCampo}
              >
                <option value="">Sin documento</option>
                {TIPOS_DOC.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo id={id('docnum')} etiqueta="Número">
              <input
                id={id('docnum')}
                inputMode="numeric"
                value={b.docNumero}
                onChange={(e) => campo('docNumero', e.target.value)}
                className={claseCampo}
              />
            </Campo>
          </div>
          <p className="text-xs leading-snug text-suelo-700">
            El documento, solo cuando haga falta para separar (Ley 29733: dato mínimo necesario).
          </p>
          <Campo id={id('ciudad')} etiqueta="Ciudad">
            <input
              id={id('ciudad')}
              value={b.ciudad}
              onChange={(e) => campo('ciudad', e.target.value)}
              className={claseCampo}
            />
          </Campo>
          <Campo id={id('notas')} etiqueta="Notas">
            <textarea
              id={id('notas')}
              value={b.notas}
              onChange={(e) => campo('notas', e.target.value)}
              rows={3}
              className={cn(claseCampo, 'h-auto py-2 font-normal')}
            />
          </Campo>

          {fallo !== null && <Fallo>{fallo}</Fallo>}

          <DialogFooter>
            <Button type="button" variant="ghost" className="h-11 sm:h-10" onClick={alCerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" className="h-11 sm:h-10" disabled={guardando}>
              {guardando ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Guardando…
                </>
              ) : (
                'Guardar'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Campo({ id, etiqueta, children }: { id: string; etiqueta: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-bold text-suelo">
        {etiqueta}
      </label>
      {children}
    </div>
  )
}
