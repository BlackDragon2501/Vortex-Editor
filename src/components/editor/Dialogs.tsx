'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useEditor } from '@/lib/editor/store'
import { toast } from '@/hooks/use-toast'
import { addNoise, pixelate } from '@/lib/editor/filters'
import { computeHistogram } from '@/lib/editor/adjustments'
import { CurveEditor, HistogramCanvas } from './CurveEditor'
import type { Anchor, ColorBalanceParams, CurvePoint, CurveSet } from '@/lib/editor/types'
import {
  DEFAULT_ADJUSTMENT_PARAMS,
  cloneColorBalance,
  cloneCurveSet,
  identityColorBalance,
  identityCurveSet,
} from '@/lib/editor/types'
import { Sparkles, Scan, CloudUpload, FolderOpen, Trash2, ImagePlus, Loader2, RefreshCw, FileUp } from 'lucide-react'
import { SUPPORT_EMAIL, VORTEX_ABOUT_TEXT, VortexLogo } from './Branding'

const ANCHOR_POSITIONS: { value: Anchor; label: string }[] = [
  { value: 'top-left', label: 'Arriba izquierda' },
  { value: 'top-center', label: 'Arriba centro' },
  { value: 'top-right', label: 'Arriba derecha' },
  { value: 'middle-left', label: 'Centro izquierda' },
  { value: 'center', label: 'Centro' },
  { value: 'middle-right', label: 'Centro derecha' },
  { value: 'bottom-left', label: 'Abajo izquierda' },
  { value: 'bottom-center', label: 'Abajo centro' },
  { value: 'bottom-right', label: 'Abajo derecha' },
]

function NumberField({
  id,
  label,
  value,
  onChange,
  min = 1,
  max = 8000,
}: {
  id: string
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
}) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-xs text-muted-foreground w-28">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        className="h-8 text-xs w-28"
      />
      <span className="text-xs text-muted-foreground">px</span>
    </div>
  )
}

function DialogFrame({
  title,
  description,
  children,
  onCancel,
  onConfirm,
  confirmLabel = 'Aplicar',
  confirmDisabled = false,
}: {
  title: string
  description: string
  children: React.ReactNode
  onCancel: () => void
  onConfirm: () => void
  confirmLabel?: string
  confirmDisabled?: boolean
}) {
  return (
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle className="text-sm">{title}</DialogTitle>
        <DialogDescription className="text-xs">{description}</DialogDescription>
      </DialogHeader>
      <div className="py-1">{children}</div>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onCancel} className="text-xs">
          Cancelar
        </Button>
        <Button
          size="sm"
          className="text-xs bg-amber-500 text-black hover:bg-amber-400"
          onClick={onConfirm}
          disabled={confirmDisabled}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

// Pantalla de inicio de Vórtex Editor: arriba, abrir / importar proyecto desde el
// almacenamiento (biblioteca en la nube de Vortex Company o archivo .vortex.json);
// abajo, creacion de un documento nuevo.
function NewDocDialog() {
  const s = useEditor()
  const [w, setW] = useState(1200)
  const [h, setH] = useState(800)
  const [bg, setBg] = useState<'white' | 'transparent' | 'black' | 'fg'>('white')

  // proyectos guardados en el almacenamiento
  const [projects, setProjects] = useState<ProjectRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [openingId, setOpenid] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/projects')
        if (!res.ok) throw new Error('respuesta del servidor invalida')
        const j = (await res.json()) as { projects?: ProjectRow[] }
        if (!cancelled) {
          setProjects(j.projects ?? [])
          setError(null)
        }
      } catch {
        if (!cancelled) setError('No se pudo conectar con el almacenamiento de proyectos.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const refresh = () => {
    setProjects(null)
    setError(null)
    setReloadKey((k) => k + 1)
  }

  const handleOpen = async (id: string) => {
    setOpenid(id)
    const ok = await s.loadProjectFromCloud(id)
    setOpenid(null)
    if (ok) s.setDialog(null)
  }

  const handleDelete = async (row: ProjectRow) => {
    if (!window.confirm(`Eliminar "${row.name}" del almacenamiento? Esta accion no se puede deshacer.`)) return
    try {
      const res = await fetch(`/api/projects/${row.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      if (row.id === s.projectId) s.patch({ projectId: null })
      refresh()
    } catch {
      setError('No se pudo eliminar el proyecto.')
    }
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    // Las imagenes (jpg, jpeg, png, webp) se abren como documento/capa;
    // los archivos .vortex.json se importan como proyecto completo.
    const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.name)
    if (isImage) {
      try {
        await s.openImageFile(file)
        setImporting(false)
        s.setDialog(null)
      } catch {
        setImporting(false)
        toast({ title: 'Imagen invalida', description: 'No se pudo abrir la imagen (jpg, jpeg, png o webp).', variant: 'destructive' })
      }
      return
    }
    const ok = await s.importProjectFile(file)
    setImporting(false)
    if (ok) s.setDialog(null)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && s.setDialog(null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <VortexLogo className="w-5 h-5" aria-hidden />
            Bienvenido a <span className="text-violet-400">Vórtex</span> Editor
          </DialogTitle>
          <DialogDescription className="text-xs">
            Abre un proyecto guardado en el almacenamiento, importa un archivo de proyecto o una imagen (jpg, jpeg, png, webp), o crea un documento nuevo.
          </DialogDescription>
        </DialogHeader>

        {/* ---- Abrir / importar proyecto desde el almacenamiento ---- */}
        <section aria-label="Abrir proyecto desde el almacenamiento" className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5 text-amber-500/90" aria-hidden />
              Abrir proyecto
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] gap-1 text-muted-foreground"
              onClick={refresh}
              aria-label="Actualizar lista de proyectos"
            >
              <RefreshCw className="w-3 h-3" aria-hidden />
              Actualizar
            </Button>
          </div>

          <div className="max-h-44 overflow-y-auto editor-scrollbar rounded-md border border-border/60">
            {projects === null && !error && (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                Cargando proyectos del almacenamiento...
              </div>
            )}
            {error && <p className="py-5 text-center text-xs text-destructive px-3">{error}</p>}
            {projects !== null && projects.length === 0 && !error && (
              <div className="py-5 text-center text-xs text-muted-foreground px-3">
                <ImagePlus className="w-5 h-5 mx-auto mb-1.5 opacity-50" aria-hidden />
                Todavia no hay proyectos guardados en el almacenamiento.
              </div>
            )}
            {projects !== null && projects.length > 0 && (
              <ul className="divide-y divide-border/60">
                {projects.map((p) => (
                  <li key={p.id} className="flex items-center gap-2.5 px-2.5 py-1.5">
                    <div className="w-12 h-9 editor-checkerboard rounded-[3px] overflow-hidden border border-border shrink-0">
                      {p.thumbnail && (
                        <img src={p.thumbnail} alt={`Miniatura de ${p.name}`} className="w-full h-full object-contain" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{p.name}</p>
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        {p.width} x {p.height} px - {formatDate(p.updatedAt)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1 shrink-0"
                      onClick={() => void handleOpen(p.id)}
                      disabled={openingId === p.id}
                    >
                      {openingId === p.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                      ) : (
                        <FolderOpen className="w-3 h-3" aria-hidden />
                      )}
                      Abrir
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-destructive hover:text-destructive shrink-0"
                      onClick={() => void handleDelete(p)}
                      aria-label={`Eliminar ${p.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".vortex.json,.json,application/json,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={(e) => void handleImportFile(e)}
            aria-hidden
            tabIndex={-1}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-full text-xs gap-1.5"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            {importing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
            ) : (
              <FileUp className="w-3.5 h-3.5" aria-hidden />
            )}
            Importar proyecto o imagen (.vortex.json · jpg · png · webp)
          </Button>
        </section>

        <div className="flex items-center gap-3" role="separator" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">o crea uno nuevo</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        {/* ---- Crear nuevo documento ---- */}
        <section aria-label="Crear nuevo documento" className="space-y-3">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <ImagePlus className="w-3.5 h-3.5 text-amber-500/90" aria-hidden />
            Crear nuevo documento
          </p>
          <div className="space-y-3">
            <NumberField id="new-w" label="Ancho" value={w} onChange={setW} />
            <NumberField id="new-h" label="Alto" value={h} onChange={setH} />
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground w-28">Fondo</Label>
              <RadioGroup
                value={bg}
                onValueChange={(v) => setBg(v as typeof bg)}
                className="flex flex-row gap-3"
              >
                <div className="flex items-center gap-1">
                  <RadioGroupItem value="white" id="bg-white" />
                  <Label htmlFor="bg-white" className="text-xs">Blanco</Label>
                </div>
                <div className="flex items-center gap-1">
                  <RadioGroupItem value="transparent" id="bg-transp" />
                  <Label htmlFor="bg-transp" className="text-xs">Transparente</Label>
                </div>
                <div className="flex items-center gap-1">
                  <RadioGroupItem value="black" id="bg-black" />
                  <Label htmlFor="bg-black" className="text-xs">Negro</Label>
                </div>
              </RadioGroup>
            </div>
          </div>
        </section>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => s.setDialog(null)} className="text-xs">
            Cerrar
          </Button>
          <Button
            size="sm"
            className="text-xs bg-amber-500 text-black hover:bg-amber-400 gap-1.5"
            onClick={() => {
              s.initDoc(w, h, bg)
              s.setDialog(null)
            }}
          >
            <ImagePlus className="w-3.5 h-3.5" aria-hidden />
            Crear documento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImageSizeDialog() {
  const s = useEditor()
  const [w, setW] = useState(s.width)
  const [h, setH] = useState(s.height)
  const [keepRatio, setKeepRatio] = useState(true)
  return (
    <Dialog open onOpenChange={(o) => !o && s.setDialog(null)}>
      <DialogFrame
        title="Tamano de imagen"
        description="Reescala todas las capas al nuevo tamano."

        onCancel={() => s.setDialog(null)}
        onConfirm={() => {
          s.resizeImage(w, h)
          s.setDialog(null)
        }}
      >
        <div className="space-y-3">
          <NumberField
            id="img-w"
            label="Ancho"
            value={w}
            onChange={(v) => {
              setW(v)
              if (keepRatio && s.width) setH(Math.max(1, Math.round((v / s.width) * s.height)))
            }}
          />
          <NumberField
            id="img-h"
            label="Alto"
            value={h}
            onChange={(v) => {
              setH(v)
              if (keepRatio && s.height) setW(Math.max(1, Math.round((v / s.height) * s.width)))
            }}
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={keepRatio}
              onChange={(e) => setKeepRatio(e.target.checked)}
              className="accent-amber-500"
            />
            Mantener proporcion
          </label>
        </div>
      </DialogFrame>
    </Dialog>
  )
}

function CanvasSizeDialog() {
  const s = useEditor()
  const [w, setW] = useState(s.width)
  const [h, setH] = useState(s.height)
  const [anchor, setAnchor] = useState<Anchor>('center')
  return (
    <Dialog open onOpenChange={(o) => !o && s.setDialog(null)}>
      <DialogFrame
        title="Tamano de lienzo"
        description="Cambia el area del documento sin reescalar el contenido."

        onCancel={() => s.setDialog(null)}
        onConfirm={() => {
          s.resizeCanvas(w, h, anchor)
          s.setDialog(null)
        }}
      >
        <div className="space-y-3">
          <NumberField id="cv-w" label="Ancho" value={w} onChange={setW} />
          <NumberField id="cv-h" label="Alto" value={h} onChange={setH} />
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground w-28">Anclaje</Label>
            <Select value={anchor} onValueChange={(v) => setAnchor(v as Anchor)}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANCHOR_POSITIONS.map((a) => (
                  <SelectItem key={a.value} value={a.value} className="text-xs">
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </DialogFrame>
    </Dialog>
  )
}

function BrightnessContrastDialog() {
  const s = useEditor()
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  return (
    <Dialog open onOpenChange={(o) => !o && s.setDialog(null)}>
      <DialogFrame
        title="Brillo / Contraste"
        description={`Se aplica a la capa activa${s.selection ? ' y solo dentro de la seleccion' : ''}.`}

        onCancel={() => s.setDialog(null)}
        onConfirm={() => {
          s.applyCssFilter('Brillo y contraste', `brightness(${brightness}%) contrast(${contrast}%)`)
          s.setDialog(null)
        }}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <Label>Brillo</Label>
              <span className="tabular-nums text-muted-foreground">{brightness - 100}</span>
            </div>
            <Slider value={[brightness]} min={0} max={200} onValueChange={(v) => setBrightness(v[0])} />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <Label>Contraste</Label>
              <span className="tabular-nums text-muted-foreground">{contrast - 100}</span>
            </div>
            <Slider value={[contrast]} min={0} max={200} onValueChange={(v) => setContrast(v[0])} />
          </div>
        </div>
      </DialogFrame>
    </Dialog>
  )
}

function HueSaturationDialog() {
  const s = useEditor()
  const [hue, setHue] = useState(0)
  const [saturation, setSaturation] = useState(100)
  const [lightness, setLightness] = useState(100)
  return (
    <Dialog open onOpenChange={(o) => !o && s.setDialog(null)}>
      <DialogFrame
        title="Tono / Saturacion"
        description="Ajusta el color de la capa activa."

        onCancel={() => s.setDialog(null)}
        onConfirm={() => {
          s.applyCssFilter(
            'Tono y saturacion',
            `hue-rotate(${hue}deg) saturate(${saturation}%) brightness(${lightness}%)`
          )
          s.setDialog(null)
        }}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <Label>Tono</Label>
              <span className="tabular-nums text-muted-foreground">{hue} grados</span>
            </div>
            <Slider value={[hue]} min={-180} max={180} onValueChange={(v) => setHue(v[0])} />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <Label>Saturacion</Label>
              <span className="tabular-nums text-muted-foreground">{saturation - 100}</span>
            </div>
            <Slider value={[saturation]} min={0} max={200} onValueChange={(v) => setSaturation(v[0])} />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <Label>Luminosidad</Label>
              <span className="tabular-nums text-muted-foreground">{lightness - 100}</span>
            </div>
            <Slider value={[lightness]} min={0} max={200} onValueChange={(v) => setLightness(v[0])} />
          </div>
        </div>
      </DialogFrame>
    </Dialog>
  )
}

function BlurDialog() {
  const s = useEditor()
  const [radius, setRadius] = useState(4)
  return (
    <Dialog open onOpenChange={(o) => !o && s.setDialog(null)}>
      <DialogFrame
        title="Desenfoque gaussiano"
        description="Suaviza la capa activa con un radio variable."

        onCancel={() => s.setDialog(null)}
        onConfirm={() => {
          s.applyCssFilter('Desenfoque', `blur(${radius}px)`)
          s.setDialog(null)
        }}
      >
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <Label>Radio</Label>
            <span className="tabular-nums text-muted-foreground">{radius} px</span>
          </div>
          <Slider value={[radius]} min={1} max={40} onValueChange={(v) => setRadius(v[0])} />
        </div>
      </DialogFrame>
    </Dialog>
  )
}

function PixelateDialog() {
  const s = useEditor()
  const [size, setSize] = useState(10)
  return (
    <Dialog open onOpenChange={(o) => !o && s.setDialog(null)}>
      <DialogFrame
        title="Pixelar"
        description="Agrupa los pixeles en bloques del tamano indicado."

        onCancel={() => s.setDialog(null)}
        onConfirm={() => {
          s.applyPixelFilter('Pixelar', (c) => pixelate(c, size))
          s.setDialog(null)
        }}
      >
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <Label>Tamano de bloque</Label>
            <span className="tabular-nums text-muted-foreground">{size} px</span>
          </div>
          <Slider value={[size]} min={2} max={80} onValueChange={(v) => setSize(v[0])} />
        </div>
      </DialogFrame>
    </Dialog>
  )
}

function NoiseDialog() {
  const s = useEditor()
  const [amount, setAmount] = useState(40)
  return (
    <Dialog open onOpenChange={(o) => !o && s.setDialog(null)}>
      <DialogFrame
        title="Anadir ruido"
        description="Inyecta grano aleatorio en la capa activa."

        onCancel={() => s.setDialog(null)}
        onConfirm={() => {
          s.applyPixelFilter('Ruido', (c) => addNoise(c, amount))
          s.setDialog(null)
        }}
      >
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <Label>Intensidad</Label>
            <span className="tabular-nums text-muted-foreground">{amount}</span>
          </div>
          <Slider value={[amount]} min={1} max={150} onValueChange={(v) => setAmount(v[0])} />
        </div>
      </DialogFrame>
    </Dialog>
  )
}

function CurvesDialog() {
  const s = useEditor()
  const editingLayer =
    s.editingAdjustmentId
      ? s.layers.find((l) => l.id === s.editingAdjustmentId && l.adjustment?.type === 'curves') ?? null
      : null
  const [curves, setCurves] = useState<CurveSet>(() =>
    editingLayer ? cloneCurveSet(editingLayer.adjustment!.params.curves) : identityCurveSet()
  )
  const [channel, setChannel] = useState<'rgb' | 'r' | 'g' | 'b'>('rgb')
  const [histogram] = useState(() => {
    try {
      return computeHistogram(s.renderComposite())
    } catch {
      return null
    }
  })

  const update = (pts: CurvePoint[]) => {
    const next = { ...curves, [channel]: pts }
    setCurves(next)
    if (editingLayer) s.updateAdjustment(editingLayer.id, { curves: next })
  }

  const close = () => {
    s.patch({ editingAdjustmentId: null })
    s.setDialog(null)
  }

  const resetChannel = () => {
    update(identityCurveSet()[channel])
  }

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Curvas</DialogTitle>
          <DialogDescription className="text-xs">
            {editingLayer
              ? 'Editando una capa de ajuste: los cambios se aplican en vivo.'
              : `Se aplica a la capa activa${s.selection ? ' y solo dentro de la seleccion' : ''}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="py-1 flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 w-full">
            <Label className="text-xs text-muted-foreground">Canal</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as 'rgb' | 'r' | 'g' | 'b')}>
              <SelectTrigger className="h-8 text-xs flex-1" aria-label="Canal de color">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rgb" className="text-xs">RGB (compuesto)</SelectItem>
                <SelectItem value="r" className="text-xs">Rojo</SelectItem>
                <SelectItem value="g" className="text-xs">Verde</SelectItem>
                <SelectItem value="b" className="text-xs">Azul</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={resetChannel}>
              Restablecer
            </Button>
          </div>
          <CurveEditor points={curves[channel]} onChange={update} histogram={histogram} channel={channel} />
          <HistogramCanvas histogram={histogram} className="shrink-0" />
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={close} className="text-xs">
            {editingLayer ? 'Cerrar' : 'Cancelar'}
          </Button>
          {!editingLayer && (
            <Button
              size="sm"
              className="text-xs bg-amber-500 text-black hover:bg-amber-400"
              onClick={() => {
                s.applyAdjustmentToLayer('Curvas', {
                  type: 'curves',
                  params: { ...DEFAULT_ADJUSTMENT_PARAMS, curves },
                })
                close()
              }}
            >
              Aplicar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LevelsDialog() {
  const s = useEditor()
  const editingLayer =
    s.editingAdjustmentId
      ? s.layers.find((l) => l.id === s.editingAdjustmentId && l.adjustment?.type === 'levels') ?? null
      : null
  const [levels, setLevels] = useState(() => ({ ...DEFAULT_ADJUSTMENT_PARAMS.levels, ...(editingLayer ? { ...editingLayer.adjustment!.params.levels } : {}) }))
  const [histogram] = useState(() => {
    try {
      return computeHistogram(s.renderComposite())
    } catch {
      return null
    }
  })

  const update = (patch: Partial<{ black: number; white: number; gamma: number }>) => {
    const next = {
      ...levels,
      ...patch,
      black: Math.min(patch.black ?? levels.black, 254),
      white: Math.max(patch.white ?? levels.white, (patch.black ?? levels.black) + 1),
    }
    setLevels(next)
    if (editingLayer) s.updateAdjustment(editingLayer.id, { levels: next })
  }

  const close = () => {
    s.patch({ editingAdjustmentId: null })
    s.setDialog(null)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Niveles</DialogTitle>
          <DialogDescription className="text-xs">
            {editingLayer
              ? 'Editando una capa de ajuste: los cambios se aplican en vivo.'
              : `Se aplica a la capa activa${s.selection ? ' y solo dentro de la seleccion' : ''}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="py-1 space-y-4">
          <HistogramCanvas histogram={histogram} height={56} className="w-full" />
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <Label>Negro (entrada)</Label>
              <span className="tabular-nums text-muted-foreground">{levels.black}</span>
            </div>
            <Slider value={[levels.black]} min={0} max={254} onValueChange={(v) => update({ black: v[0] })} />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <Label>Gamma (tonos medios)</Label>
              <span className="tabular-nums text-muted-foreground">{levels.gamma.toFixed(2)}</span>
            </div>
            <Slider
              value={[levels.gamma]}
              min={0.1}
              max={3}
              step={0.01}
              onValueChange={(v) => update({ gamma: v[0] })}
            />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <Label>Blanco (entrada)</Label>
              <span className="tabular-nums text-muted-foreground">{levels.white}</span>
            </div>
            <Slider value={[levels.white]} min={1} max={255} onValueChange={(v) => update({ white: v[0] })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={close} className="text-xs">
            {editingLayer ? 'Cerrar' : 'Cancelar'}
          </Button>
          {!editingLayer && (
            <Button
              size="sm"
              className="text-xs bg-amber-500 text-black hover:bg-amber-400"
              onClick={() => {
                s.applyAdjustmentToLayer('Niveles', {
                  type: 'levels',
                  params: { ...DEFAULT_ADJUSTMENT_PARAMS, levels },
                })
                close()
              }}
            >
              Aplicar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InpaintDialog() {
  const s = useEditor()
  const [quality, setQuality] = useState(3)
  const [texture, setTexture] = useState(true)
  const [working, setWorking] = useState(false)
  const hasSelection = !!s.selection
  const activePixel = s.layers.some((l) => l.id === s.activeLayerId && l.kind === 'pixel')
  const canRun = hasSelection && activePixel && !working

  const run = () => {
    setWorking(true)
    setTimeout(() => {
      s.applyInpaint({ quality, texture })
      setWorking(false)
      s.setDialog(null)
    }, 50)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && s.setDialog(null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Relleno segun contenido (IA)
          </DialogTitle>
          <DialogDescription className="text-xs">
            La IA reconstruye la zona seleccionada sintetizando contenido a partir del entorno.
          </DialogDescription>
        </DialogHeader>
        <div className="py-1 space-y-4">
          {!hasSelection ? (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90 flex items-start gap-2">
              <Scan className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Necesitas una seleccion. Usa las herramientas de seleccion o haz clic para seleccionar todo.</span>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Scan className="w-3.5 h-3.5" /> Zona seleccionada: {s.selection ? s.selection.bounds.w : 0} x{' '}
              {s.selection ? s.selection.bounds.h : 0} px
            </p>
          )}
          {!hasSelection && (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={s.selectAll}>
              Seleccionar todo (Ctrl+A)
            </Button>
          )}
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <Label>Calidad de sintesis</Label>
              <span className="tabular-nums text-muted-foreground">{quality} / 5</span>
            </div>
            <Slider value={[quality]} min={1} max={5} onValueChange={(v) => setQuality(v[0])} />
            <p className="text-[10.5px] text-muted-foreground">Mas calidad = reconstruccion mas detallada (tarda unos segundos)</p>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={texture}
              onChange={(e) => setTexture(e.target.checked)}
              className="accent-amber-500"
            />
            Transferir textura del entorno (grano y detalle)
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => s.setDialog(null)} className="text-xs">
            Cancelar
          </Button>
          <Button
            size="sm"
            className="text-xs bg-amber-500 text-black hover:bg-amber-400"
            onClick={run}
            disabled={!canRun}
          >
            {working ? 'Generando...' : 'Generar relleno'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ExportDialog() {
  const s = useEditor()
  const [format, setFormat] = useState<'png' | 'jpeg'>('png')
  const [quality, setQuality] = useState(92)
  const [name, setName] = useState(s.docName || 'image-editor')
  return (
    <Dialog open onOpenChange={(o) => !o && s.setDialog(null)}>
      <DialogFrame
        title="Exportar imagen"
        description="Combina todas las capas visibles y descarga el archivo."

        confirmLabel="Descargar"
        onCancel={() => s.setDialog(null)}
        onConfirm={() => {
          s.exportImage(format, quality / 100, name)
          s.setDialog(null)
        }}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="exp-name" className="text-xs text-muted-foreground w-28">
              Nombre
            </Label>
            <Input id="exp-name" value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground w-28">Formato</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as 'png' | 'jpeg')}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="png" className="text-xs">PNG (con transparencia)</SelectItem>
                <SelectItem value="jpeg" className="text-xs">JPEG (comprimido)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {format === 'jpeg' && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <Label>Calidad</Label>
                <span className="tabular-nums text-muted-foreground">{quality}%</span>
              </div>
              <Slider value={[quality]} min={10} max={100} onValueChange={(v) => setQuality(v[0])} />
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Dimensiones finales: {s.width} x {s.height} px
          </p>
        </div>
      </DialogFrame>
    </Dialog>
  )
}

export function Dialogs() {
  const dialog = useEditor((s) => s.dialog)
  switch (dialog) {
    case 'new-doc':
      return <NewDocDialog />
    case 'image-size':
      return <ImageSizeDialog />
    case 'canvas-size':
      return <CanvasSizeDialog />
    case 'brightness-contrast':
      return <BrightnessContrastDialog />
    case 'hue-saturation':
      return <HueSaturationDialog />
    case 'curves':
      return <CurvesDialog />
    case 'levels':
      return <LevelsDialog />
    case 'blur':
      return <BlurDialog />
    case 'pixelate':
      return <PixelateDialog />
    case 'noise':
      return <NoiseDialog />
    case 'inpaint':
      return <InpaintDialog />
    case 'export':
      return <ExportDialog />
    case 'color-balance':
      return <ColorBalanceDialog />
    case 'vibrance':
      return <VibranceDialog />
    case 'projects':
      return <ProjectsDialog />
    case 'about':
      return <AboutDialog />
    case 'privacy':
      return <LegalDialog kind="privacy" />
    case 'terms':
      return <LegalDialog kind="terms" />
    default:
      return null
  }
}

// ---------- Balance de color ----------

const BALANCE_ROWS: { key: 'r' | 'g' | 'b'; label: string }[] = [
  { key: 'r', label: 'Cian - Rojo' },
  { key: 'g', label: 'Magenta - Verde' },
  { key: 'b', label: 'Amarillo - Azul' },
]

const BALANCE_RANGES: { key: keyof ColorBalanceParams; label: string }[] = [
  { key: 'shadows', label: 'Sombras' },
  { key: 'midtones', label: 'Tonos medios' },
  { key: 'highlights', label: 'Luces' },
]

function BalanceSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]">
        <Label className="text-muted-foreground">{label}</Label>
        <span className="tabular-nums text-muted-foreground">{value > 0 ? `+${value}` : value}</span>
      </div>
      <Slider value={[value]} min={-100} max={100} onValueChange={(v) => onChange(v[0])} aria-label={label} />
    </div>
  )
}

function ColorBalanceDialog() {
  const s = useEditor()
  const editingLayer =
    s.editingAdjustmentId
      ? s.layers.find((l) => l.id === s.editingAdjustmentId && l.adjustment?.type === 'color-balance') ?? null
      : null
  const [balance, setBalance] = useState<ColorBalanceParams>(() =>
    editingLayer ? cloneColorBalance(editingLayer.adjustment!.params.colorBalance) : identityColorBalance()
  )

  const update = (range: keyof ColorBalanceParams, channel: 'r' | 'g' | 'b', value: number) => {
    const next: ColorBalanceParams = {
      shadows: { ...balance.shadows },
      midtones: { ...balance.midtones },
      highlights: { ...balance.highlights },
      [range]: { ...balance[range], [channel]: value },
    }
    setBalance(next)
    if (editingLayer) s.updateAdjustment(editingLayer.id, { colorBalance: next })
  }

  const reset = () => {
    const next = identityColorBalance()
    setBalance(next)
    if (editingLayer) s.updateAdjustment(editingLayer.id, { colorBalance: next })
  }

  const close = () => {
    s.patch({ editingAdjustmentId: null })
    s.setDialog(null)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogFrame
        title="Balance de color"
        description={
          editingLayer
            ? 'Editando una capa de ajuste: los cambios se aplican en vivo.'
            : `Se aplica a la capa activa${s.selection ? ' y solo dentro de la seleccion' : ''}.`
        }
        onCancel={close}
        confirmLabel={editingLayer ? 'Hecho' : 'Aplicar'}
        onConfirm={() => {
          if (!editingLayer) {
            s.applyAdjustmentToLayer('Balance de color', {
              type: 'color-balance',
              params: { ...DEFAULT_ADJUSTMENT_PARAMS, colorBalance: balance },
            })
          }
          close()
        }}
      >
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={reset}>
              Restablecer todo
            </Button>
          </div>
          {BALANCE_RANGES.map((range) => (
            <div key={range.key} className="space-y-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-500/90">{range.label}</p>
              {BALANCE_ROWS.map((row) => (
                <BalanceSlider
                  key={row.key}
                  label={row.label}
                  value={balance[range.key][row.key]}
                  onChange={(v) => update(range.key, row.key, v)}
                />
              ))}
            </div>
          ))}
        </div>
      </DialogFrame>
    </Dialog>
  )
}

// ---------- Vibrance ----------

function VibranceDialog() {
  const s = useEditor()
  const editingLayer =
    s.editingAdjustmentId
      ? s.layers.find((l) => l.id === s.editingAdjustmentId && l.adjustment?.type === 'vibrance') ?? null
      : null
  const [amount, setAmount] = useState(() =>
    editingLayer ? editingLayer.adjustment!.params.vibrance : 0
  )

  const update = (v: number) => {
    setAmount(v)
    if (editingLayer) s.updateAdjustment(editingLayer.id, { vibrance: v })
  }

  const close = () => {
    s.patch({ editingAdjustmentId: null })
    s.setDialog(null)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogFrame
        title="Intensidad (Vibrance)"
        description={
          editingLayer
            ? 'Editando una capa de ajuste: los cambios se aplican en vivo.'
            : `Satura mas los colores apagados y protege los ya saturados. Se aplica a la capa activa${s.selection ? ' y solo dentro de la seleccion' : ''}.`
        }
        onCancel={close}
        confirmLabel={editingLayer ? 'Hecho' : 'Aplicar'}
        onConfirm={() => {
          if (!editingLayer) {
            s.applyAdjustmentToLayer('Intensidad (Vibrance)', {
              type: 'vibrance',
              params: { ...DEFAULT_ADJUSTMENT_PARAMS, vibrance: amount },
            })
          }
          close()
        }}
      >
        <div className="space-y-3">
          <div className="flex justify-between text-xs">
            <Label>Intensidad</Label>
            <span className="tabular-nums text-muted-foreground">{amount > 0 ? `+${amount}` : amount}</span>
          </div>
          <Slider value={[amount]} min={-100} max={100} onValueChange={(v) => update(v[0])} aria-label="Intensidad" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Valores positivos realzan los colores apagados; valores negativos los desaturan suavemente, como la
            Vibrance clasica de los editores profesionales.
          </p>
        </div>
      </DialogFrame>
    </Dialog>
  )
}

// ---------- Biblioteca de proyectos (nube) ----------

interface ProjectRow {
  id: string
  name: string
  width: number
  height: number
  thumbnail: string
  createdAt: string
  updatedAt: string
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function ProjectsDialog() {
  const s = useEditor()
  const [projects, setProjects] = useState<ProjectRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [name, setName] = useState(s.docName || 'Proyecto Vórtex')
  const [saving, setSaving] = useState(false)
  const [openingId, setOpenid] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/projects')
        if (!res.ok) throw new Error('respuesta del servidor invalida')
        const j = (await res.json()) as { projects?: ProjectRow[] }
        if (!cancelled) {
          setProjects(j.projects ?? [])
          setError(null)
        }
      } catch {
        if (!cancelled) setError('No se pudo conectar con la biblioteca de proyectos.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const refresh = () => {
    setProjects(null)
    setError(null)
    setReloadKey((k) => k + 1)
  }

  const handleSave = async () => {
    setSaving(true)
    s.patch({ docName: name.trim() || 'Proyecto Vórtex' })
    const ok = await s.saveProjectToCloud()
    setSaving(false)
    if (ok) refresh()
  }

  const handleOpen = async (id: string) => {
    setOpenid(id)
    const ok = await s.loadProjectFromCloud(id)
    setOpenid(null)
    if (ok) s.setDialog(null)
  }

  const handleDelete = async (row: ProjectRow) => {
    if (!window.confirm(`Eliminar "${row.name}" de la biblioteca? Esta accion no se puede deshacer.`)) return
    try {
      const res = await fetch(`/api/projects/${row.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      if (row.id === s.projectId) s.patch({ projectId: null })
      refresh()
    } catch {
      setError('No se pudo eliminar el proyecto.')
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && s.setDialog(null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-amber-500/90" aria-hidden />
            Biblioteca de proyectos
          </DialogTitle>
          <DialogDescription className="text-xs">
            Guarda tu documento completo en la nube (capas, ajustes y composicion) y abrélo cuando quieras. Los
            proyectos solo se almacenan cuando tú los guardas de forma explicita.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2 py-1 border-b border-border pb-3">
          <div className="flex-1 space-y-1">
            <Label htmlFor="proj-name" className="text-xs text-muted-foreground">
              Nombre del proyecto
            </Label>
            <Input
              id="proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-xs"
              placeholder="Proyecto Vórtex"
            />
          </div>
          <Button
            size="sm"
            className="h-8 text-xs bg-amber-500 text-black hover:bg-amber-400 gap-1.5"
            onClick={() => void handleSave()}
            disabled={saving || !s.width}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <CloudUpload className="w-3.5 h-3.5" aria-hidden />}
            {s.projectId ? 'Guardar cambios' : 'Guardar en la nube'}
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={refresh} aria-label="Actualizar lista">
            <RefreshCw className="w-3.5 h-3.5" aria-hidden />
            Actualizar
          </Button>
        </div>

        <div className="max-h-72 overflow-y-auto editor-scrollbar">
          {projects === null && !error && (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              Cargando proyectos...
            </div>
          )}
          {error && <p className="py-6 text-center text-xs text-destructive">{error}</p>}
          {projects !== null && projects.length === 0 && !error && (
            <div className="py-10 text-center text-xs text-muted-foreground">
              <ImagePlus className="w-6 h-6 mx-auto mb-2 opacity-50" aria-hidden />
              Todavia no hay proyectos guardados. Crea uno y pulsa "Guardar en la nube".
            </div>
          )}
          {projects !== null && projects.length > 0 && (
            <ul className="divide-y divide-border/60">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <div className="w-14 h-10 editor-checkerboard rounded-[3px] overflow-hidden border border-border shrink-0">
                    {p.thumbnail && (
                      <img src={p.thumbnail} alt={`Miniatura de ${p.name}`} className="w-full h-full object-contain" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{p.name}</p>
                    <p className="text-[10.5px] text-muted-foreground tabular-nums">
                      {p.width} x {p.height} px - {formatDate(p.updatedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => void handleOpen(p.id)}
                      disabled={openingId === p.id}
                    >
                      {openingId === p.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                      ) : (
                        <FolderOpen className="w-3 h-3" aria-hidden />
                      )}
                      Abrir
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      onClick={() => void handleDelete(p)}
                      aria-label={`Eliminar ${p.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => s.setDialog(null)} className="text-xs">
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Acerca de / legales ----------

function AboutDialog() {
  const s = useEditor()
  return (
    <Dialog open onOpenChange={(o) => !o && s.setDialog(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm sr-only">Acerca de Vórtex Editor</DialogTitle>
          <DialogDescription className="sr-only">
            Informacion legal y de contacto de Vórtex Editor, de Vortex Company.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2 space-y-4 text-center">
          <div className="flex items-center justify-center gap-3">
            <VortexLogo className="w-10 h-10" />
            <div className="text-left">
              <p className="text-lg font-bold leading-tight">
                <span className="text-violet-400">Vórtex</span> Editor
              </p>
              <p className="text-[11px] text-muted-foreground">Gratis - Sin anuncios</p>
            </div>
          </div>
          <p className="text-sm">
            <span className="font-semibold">Tu editor, sin límites.</span>{' '}
            <span className="text-muted-foreground">Gratis y sin anuncios.</span>
          </p>
          <p className="text-[11.5px] text-muted-foreground leading-relaxed text-left">{VORTEX_ABOUT_TEXT}</p>
          <div className="rounded-md border border-border bg-zinc-900/60 px-3 py-2.5 text-left space-y-1">
            <p className="text-[11px] text-muted-foreground">Soporte oficial:</p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-xs font-medium text-violet-400 hover:text-violet-300 break-all"
            >
              {SUPPORT_EMAIL}
            </a>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Este correo pertenece a Vortex Company: es el mismo soporte de la misma compania que atiende Vórtex
              Music y Vórtex Editor.
            </p>
          </div>
          <div className="pt-1 border-t border-border">
            <p className="text-[11px] text-muted-foreground mt-3">
              Derechos Reservados © 2026 Vortex Company. Todos los derechos reservados.
            </p>
            <p className="text-[11px] text-muted-foreground/80 mt-0.5">Vórtex Studio</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => s.setDialog(null)} className="text-xs">
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const PRIVACY_PARAGRAPHS = [
  'Vórtex Editor, producto de Vortex Company, aplica un principio de minimizacion de datos: el procesamiento de las imagenes se ejecuta integramente en el navegador del usuario, en su propio dispositivo. Las imagenes que abres o creas no se transmiten a servidores externos ni son accesibles para Vortex Company.',
  'No recopilamos datos personales de navegacion, no utilizamos cookies de seguimiento, no incorporamos sistemas de analisis de terceros ni mostramos publicidad. La aplicacion es gratuita y se financia de forma independiente.',
  'Unicamente cuando el usuario utiliza de forma voluntaria la funcion "Guardar en la nube", el proyecto (capas, ajustes y miniatura) se almacena en la base de datos de Vortex Company con la exclusiva finalidad de permitir su posterior recuperacion. Dicha informacion no se cede, vende ni comparte con terceros, y el usuario puede eliminarla en cualquier momento desde la Biblioteca de proyectos.',
  'Al exportar un proyecto como archivo .vortex.json, el archivo se genera y descarga localmente; Vortex Company no tiene acceso a su contenido.',
  `Para cualquier consulta sobre privacidad o protección de datos, el usuario puede dirigirse al soporte oficial de Vortex Company en ${SUPPORT_EMAIL}, el mismo canal de soporte de la compania que atiende Vórtex Music y Vórtex Editor.`,
]

const TERMS_PARAGRAPHS = [
  'Vórtex Editor es una aplicacion de edicion de imagenes proporcionada de forma gratuita por Vortex Company. Su uso esta permitido con fines personales, educativos y profesionales para crear, editar y exportar contenido grafico propio.',
  'El usuario conserva la totalidad de los derechos de propiedad intelectual sobre las obras que cree o edite con la aplicacion. Vortex Company no reclama titularidad ni licencia alguna sobre dichos contenidos, y no accede a ellos salvo que el usuario los almacene voluntariamente mediante la funcion de guardado en la nube.',
  'El usuario se compromete a no emplear la aplicacion para la creacion o distribucion de contenidos ilicitos, que infrinjan derechos de terceros o que contravengan la legislacion aplicable. La funcion de biblioteca en la nube esta destinada exclusivamente al almacenamiento de proyectos de edicion propios.',
  'Los proyectos guardados en la biblioteca son personales y se proporcionan como utilidad de almacenamiento para la comodidad del usuario; se recomienda conservar copias locales mediante la exportacion de archivos .vortex.json o imagenes finales, ya que Vortex Company no garantiza la disponibilidad permanente del almacenamiento.',
  'La aplicacion se ofrece "tal cual", sin garantias expresas o implicitas. En la maxima medida permitida por la ley, Vortex Company no sera responsable de danos derivados del uso de la aplicacion. El uso de Vórtex Editor implica la aceptacion de estos terminos.',
  `Para consultas sobre estos terminos, contacta con el soporte oficial de Vortex Company en ${SUPPORT_EMAIL}, el mismo canal de la compania para Vórtex Music y Vórtex Editor.`,
]

function LegalDialog({ kind }: { kind: 'privacy' | 'terms' }) {
  const s = useEditor()
  const title = kind === 'privacy' ? 'Políticas de Privacidad' : 'Términos y Servicios'
  const paragraphs = kind === 'privacy' ? PRIVACY_PARAGRAPHS : TERMS_PARAGRAPHS
  return (
    <Dialog open onOpenChange={(o) => !o && s.setDialog(null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">{title} - Vórtex Editor</DialogTitle>
          <DialogDescription className="text-xs">
            Documento legal de Vortex Company para Vórtex Editor.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto editor-scrollbar pr-1 space-y-3">
          {paragraphs.map((p, i) => (
            <p key={i} className="text-[11.5px] leading-relaxed text-muted-foreground">
              {p}
            </p>
          ))}
          <p className="text-[11px] text-muted-foreground pt-2 border-t border-border">
            Derechos Reservados © 2026 Vortex Company. Todos los derechos reservados. Vórtex Studio.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => s.setDialog(null)} className="text-xs">
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
