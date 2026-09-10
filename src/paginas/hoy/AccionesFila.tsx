import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarPlus, Check, FileText, MessageSquarePlus } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog'
import { Input } from '@/componentes/ui/input'
import { Label } from '@/componentes/ui/label'
import { cn } from '@/lib/utils'
import { useSesion } from '@/auth/ContextoSesion'
import { CANALES, crearTarea, registrarInteraccion, type Canal } from '@/lib/hoy'

/**
 * Las acciones directas de cada fila de la pantalla Hoy.
 *
 * ---------------------------------------------------------------------------
 * REGLA DEL ENCARGO: NADA A MAS DE DOS CLICS
 * ---------------------------------------------------------------------------
 * Por eso registrar una interaccion y crear una tarea son dialogos que se
 * abren encima (clic 1: abrir · clic 2: guardar) y no pantallas a las que
 * haya que navegar y de las que haya que volver. Abrir la ficha es un enlace,
 * un solo clic.
 *
 * Un CRM se abandona por friccion, no por falta de campos: el motivo por el
 * que existe esta pantalla es que «hay semanas, incluso meses, en los que no
 * hacemos seguimiento» (Walter). Si registrar el seguimiento cuesta cinco
 * clics, no se registra.
 */

type Objetivo = {
  personaId: string | null
  oportunidadId: string | null
  nombre: string
}

/** Los tres botones de la derecha de cada fila. */
export function AccionesFila({
  objetivo,
  alTerminar,
  extra,
}: {
  objetivo: Objetivo
  /** Se llama tras guardar, para que el bloque se refresque. */
  alTerminar: () => void
  /** Accion propia del bloque (p. ej. «Hecha» en una tarea). */
  extra?: React.ReactNode
}) {
  const [abierto, setAbierto] = useState<'interaccion' | 'tarea' | null>(null)

  return (
    <>
      {extra}

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setAbierto('interaccion')}
        disabled={objetivo.personaId === null}
        title={
          objetivo.personaId === null
            ? 'Falta el id de la persona: ejecuta 07-vistas-hoy.sql'
            : 'Registrar interacción'
        }
      >
        <MessageSquarePlus strokeWidth={1.75} aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Interacción</span>
      </Button>

      <Button variant="ghost" size="sm" onClick={() => setAbierto('tarea')} title="Crear tarea">
        <CalendarPlus strokeWidth={1.75} aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Tarea</span>
      </Button>

      {/* `asChild` sustituye el <button> por el <a>, y un <a> no admite
          `disabled`. Cuando no hay id de persona se renderiza el boton de
          verdad, desactivado, en vez de un enlace roto a /personas/. */}
      {objetivo.personaId === null ? (
        <Button
          variant="ghost"
          size="sm"
          disabled
          title="Falta el id de la persona: ejecuta 07-vistas-hoy.sql"
        >
          <FileText strokeWidth={1.75} aria-hidden="true" />
          <span className="sr-only">Abrir ficha (no disponible)</span>
        </Button>
      ) : (
        <Button variant="ghost" size="sm" asChild title="Abrir la ficha">
          <Link to={`/personas/${objetivo.personaId}`}>
            <FileText strokeWidth={1.75} aria-hidden="true" />
            <span className="sr-only">Abrir ficha de {objetivo.nombre}</span>
          </Link>
        </Button>
      )}

      <DialogoInteraccion
        abierto={abierto === 'interaccion'}
        cerrar={() => setAbierto(null)}
        objetivo={objetivo}
        alGuardar={alTerminar}
      />
      <DialogoTarea
        abierto={abierto === 'tarea'}
        cerrar={() => setAbierto(null)}
        objetivo={objetivo}
        alGuardar={alTerminar}
      />
    </>
  )
}

/** Boton de «hecha» para las filas que son tareas. */
export function BotonHecha({ onClick, ocupado }: { onClick: () => void; ocupado: boolean }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={ocupado} title="Marcar como hecha">
      <Check strokeWidth={2} aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">Hecha</span>
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Dialogo · registrar interaccion
// ---------------------------------------------------------------------------

function DialogoInteraccion({
  abierto,
  cerrar,
  objetivo,
  alGuardar,
}: {
  abierto: boolean
  cerrar: () => void
  objetivo: Objetivo
  alGuardar: () => void
}) {
  const [canal, setCanal] = useState<Canal>('whatsapp')
  const [resumen, setResumen] = useState('')
  const [entrante, setEntrante] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (abierto) {
      setResumen('')
      setError(null)
    }
  }, [abierto])

  async function guardar(actorId: string) {
    if (objetivo.personaId === null) return
    setGuardando(true)
    setError(null)
    try {
      await registrarInteraccion({
        personaId: objetivo.personaId,
        oportunidadId: objetivo.oportunidadId,
        canal,
        resumen,
        entrante,
        actorId,
      })
      alGuardar()
      cerrar()
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : String(fallo))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && cerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar interacción</DialogTitle>
          <DialogDescription>
            {objetivo.nombre}. Queda en el historial con tu nombre y la hora (R9).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="canal">Canal</Label>
            <SelectSimple
              id="canal"
              value={canal}
              onChange={(v) => setCanal(v as Canal)}
              opciones={CANALES}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="resumen">Qué pasó</Label>
            <textarea
              id="resumen"
              value={resumen}
              onChange={(e) => setResumen(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Contestó, pidió precio, quedamos en llamar el viernes…"
              className={cn(
                'flex w-full rounded-md border border-input bg-transparent px-3 py-2',
                'text-sm shadow-sm transition-colors placeholder:text-muted-foreground',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              )}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-suelo-700">
            <input
              type="checkbox"
              checked={entrante}
              onChange={(e) => setEntrante(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-azul"
            />
            La escribió o llamó la persona (entrante)
          </label>

          {error !== null && (
            <p role="alert" className="rounded-md bg-alerta-suave p-2 text-sm font-bold text-alerta">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <ConActor>
            {(actorId) => (
              <Button
                onClick={() => void guardar(actorId)}
                disabled={guardando || resumen.trim() === ''}
              >
                {guardando ? 'Guardando…' : 'Registrar'}
              </Button>
            )}
          </ConActor>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Dialogo · crear tarea
// ---------------------------------------------------------------------------

function DialogoTarea({
  abierto,
  cerrar,
  objetivo,
  alGuardar,
}: {
  abierto: boolean
  cerrar: () => void
  objetivo: Objetivo
  alGuardar: () => void
}) {
  const [titulo, setTitulo] = useState('')
  const [venceEl, setVenceEl] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setTitulo('')
    setError(null)
    // Propuesta por defecto: mañana a la misma hora. Es solo el valor inicial
    // de un campo editable, no un plazo de negocio — los plazos del negocio
    // viven en `parametros` (07-crm\CLAUDE.md §2).
    const manana = new Date()
    manana.setDate(manana.getDate() + 1)
    manana.setSeconds(0, 0)
    const desfase = manana.getTimezoneOffset() * 60_000
    setVenceEl(new Date(manana.getTime() - desfase).toISOString().slice(0, 16))
  }, [abierto])

  async function guardar(responsableId: string) {
    setGuardando(true)
    setError(null)
    try {
      await crearTarea({
        titulo,
        detalle: null,
        venceEl,
        oportunidadId: objetivo.oportunidadId,
        personaId: objetivo.personaId,
        responsableId,
      })
      alGuardar()
      cerrar()
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : String(fallo))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && cerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Crear tarea</DialogTitle>
          <DialogDescription>
            {objetivo.nombre}. Toda oportunidad activa necesita una tarea abierta con fecha (R6).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="titulo-tarea">Qué hay que hacer</Label>
            <Input
              id="titulo-tarea"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              autoFocus
              placeholder="Llamar para confirmar asistencia"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="vence-tarea">Vence el</Label>
            <Input
              id="vence-tarea"
              type="datetime-local"
              value={venceEl}
              onChange={(e) => setVenceEl(e.target.value)}
            />
          </div>

          {error !== null && (
            <p role="alert" className="rounded-md bg-alerta-suave p-2 text-sm font-bold text-alerta">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <ConActor>
            {(responsableId) => (
              <Button
                onClick={() => void guardar(responsableId)}
                disabled={guardando || titulo.trim() === '' || venceEl === ''}
              >
                {guardando ? 'Guardando…' : 'Crear tarea'}
              </Button>
            )}
          </ConActor>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

/**
 * Desplegable nativo con el aspecto de los campos de shadcn/ui.
 * Nativo por lo mismo que en Registro rapido: en el movil abre el selector del
 * sistema, que es mas rapido que un menu flotante.
 */
function SelectSimple({
  id,
  value,
  onChange,
  opciones,
}: {
  id: string
  value: string
  onChange: (valor: string) => void
  opciones: readonly { valor: string; etiqueta: string }[]
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1',
        'text-sm shadow-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
      )}
    >
      {opciones.map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.etiqueta}
        </option>
      ))}
    </select>
  )
}

/**
 * Entrega el id del usuario en sesion a un boton de guardar.
 *
 * `actor_id` y `responsable_id` NO se dejan a que los adivine la base: se
 * mandan explicitos, para que la trazabilidad de R9 diga quien hizo cada cosa.
 */
function ConActor({ children }: { children: (actorId: string) => React.ReactNode }) {
  const { perfil } = useSesion()
  if (perfil === null) return null
  return <>{children(perfil.id)}</>
}
