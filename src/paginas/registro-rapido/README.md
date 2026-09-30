# Pantalla: registro-rapido (v2 · 29/09/2026)

**Estado:** 🟡 escrita, sin probar contra la base — depende de `sql/13-seguimiento-comercial.sql`
(`fn_registrar_prospecto`, `fn_registrar_lote`, `fn_campana_asegurar`, `fn_equipo`). Hasta que esa
migración se aplique, cada guardado responde «La base todavía no tiene esta función…» y **no se
registra nada a medias**.

Ruta: `/registro-rapido` (`?modo=lista` · `?modo=web` abren esas pestañas directamente).
Export: `PantallaRegistroRapido` (`index.tsx`), enlazada en `src/rutas.tsx`.

## Por qué v2

El 28/09 llegaron 50 leads de un TikTok Live y nadie pudo cargarlos rápido (SPEC §0). La versión de
06 era de uno en uno, sin campaña y con la hora de cuando se tecleaba, no la del live: el SLA de
primera respuesta mentía. Objetivo de esta versión: **pegar 50 leads y dejarlos guardados,
deduplicados y asignados en menos de 3 minutos**, y pasar directo a llamarlos.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.tsx` | Cabecera, pestañas (en la URL), sesión, lista «Registrados en esta sesión». Las tres pestañas quedan montadas: cambiar de pestaña no pierde una lista a medio corregir. |
| `ConfiguracionSesion.tsx` | Lo común a todos los leads: origen, campaña (o «Nueva campaña» en línea → `fn_campana_asegurar`), responsable (por defecto quien registra), hora del live, red de los @usuario. Se recuerda en `sessionStorage['crm.registro.sesion']` (try/catch), atada al perfil que la configuró. También `prepararCola()` → `sessionStorage['crm.cola.ids']`. |
| `UnoAUno.tsx` | El flujo de 30 s: Enter avanza nombre → teléfono → (@usuario si no hay teléfono) → casilla → guarda. Cronómetro desde la primera tecla. Chips opcionales «¿Qué busca?» y «¿Para qué?». `registrarProspecto`. |
| `PegarLista.tsx` | Pegar → **Analizar** (`analizarLista` + `marcarRepetidos`, en el navegador) → corregir celdas → declaración del lote → **Validar con la base** (`registrarLote(…, true)`, no escribe) → **Guardar N leads** → **Empezar a llamarlos** (`/cola?vista=seleccion`). |
| `MensajeWeb.tsx` | Pegar el WhatsApp que arma la web → `analizarMensajeWeb` → vista previa → `registrarProspecto` con `perfilWebDirecto`. |

## Reglas que esta pantalla hace cumplir

- **Consentimiento (Ley 29733).** Uno a uno y web: casilla por persona, que **no** se arrastra al
  siguiente lead. Lista: la declaración del lote es **obligatoria antes de llamar a la base**
  (también para validar), porque `registrarLote` envía `consentimiento: true`. La frase se guarda en
  cada persona (`fuente_del_dato`) con la campaña; el canal es `tiktok_live` / `instagram_live` /
  `facebook_live` / `youtube_live` / `live` según la plataforma de la campaña (`lista_<origen>` si el
  origen no es live; `web_whatsapp` para la web; `crm_registro_rapido` uno a uno fuera de un live).
  🟡 La versión del aviso de privacidad sigue `[PENDIENTE]`, y la pantalla lo dice.
- **DNI.** Si el mensaje del evento trae un DNI, se avisa y **no se guarda ni se muestra** (dato
  mínimo necesario).
- **Reclamos.** Un mensaje del Libro de Reclamaciones se bloquea con la explicación; no es un lead.
- **Perfil desde la web.** Solo se escriben `respuestas_web` y las tres correspondencias directas
  (situación, rubro, zona) con `fuente_perfil 'web'`. Lo de R5 queda como sugerencia en la ficha.
- **Duplicados.** Dentro de la lista, `marcarRepetidos`; contra la base, `fn_registrar_prospecto`
  (candado por teléfono). Si el lead ya lo lleva otro vendedor, no cambia de dueño: la base le
  deja constancia en su ficha y aquí se ve «Tiene dueño: X».
- **Guardar exige una validación vigente**: si después de validar cambia una celda, una fila o la
  sesión, hay que volver a validar. Las filas ya guardadas no se reenvían.
- **La cola** recibe solo los leads de quien registra: los que tienen otro dueño, y los repartidos a
  otra persona, se quedan para su responsable.
- Sin cifras de negocio: los únicos números son el objetivo de tiempo del encargo (30 s por lead,
  3 min por lista) y los topes técnicos de la base (500 filas, 300 caracteres de evidencia).

## Consultas

Lee `['campanas']` y `['equipo']`. Tras cada alta invalida `['hoy']`, `['cartera']`, `['embudo']` y
`['bandeja']` (un lead web sin dueño que se registra aquí pasa a tener dueño).
