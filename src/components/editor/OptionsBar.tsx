'use client'

import { useState } from 'react'
import { Crop, MousePointer2, Scan, SlidersHorizontal, Stamp, Spline, Paintbrush, Check, X, FlipHorizontal, FlipVertical, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useEditor } from '@/lib/editor/store'
import { ADJUSTMENT_LABELS } from '@/lib/editor/types'
import type { AdjustmentParams, ToolId } from '@/lib/editor/types'

function SliderGroup({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix = '',
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  suffix?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground whitespace-nowrap w-14">{label}</span>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        className="w-24"
        aria-label={label}
      />
      <span className="text-[11px] tabular-nums text-foreground w-10 text-right">
        {Math.round(value)}
        {suffix}
      </span>
    </div>
  )
}

function RangeSelect({
  value,
  onChange,
}: {
  value: 'shadows' | 'midtones' | 'highlights'
  onChange: (v: 'shadows' | 'midtones' | 'highlights') => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className="text-[11px] text-muted-foreground">Rango</Label>
      <Select value={value} onValueChange={(v) => onChange(v as typeof value)}>
        <SelectTrigger className="h-6 text-[11px] w-28" aria-label="Rango de tonos">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="shadows" className="text-xs">Sombras</SelectItem>
          <SelectItem value="midtones" className="text-xs">Medios tonos</SelectItem>
          <SelectItem value="highlights" className="text-xs">Luces</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

function NumberBox({
  label,
  value,
  onChange,
  step = 1,
  width = 'w-16',
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  width?: string
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Input
        type="number"
        step={step}
        value={Math.round(value * 100) / 100}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className={cnNumberClass(width)}
        aria-label={label}
      />
    </div>
  )
}

function cnNumberClass(width: string) {
  return `h-6 text-[11px] px-1.5 ${width} tabular-nums`
}

export function OptionsBar() {
  const s = useEditor()
  const tool = s.activeTool
  const set = s.patch
  const activeLayer = s.layers.find((l) => l.id === s.activeLayerId) ?? null
  const isAdjustmentLayer = activeLayer?.kind === 'adjustment'
  // franja tonal mostrada en linea para la capa de ajuste de balance de color
  const [balanceRange, setBalanceRange] = useState<'shadows' | 'midtones' | 'highlights'>('midtones')

  const groups: Record<ToolId, React.ReactNode> = {
    move: (
      <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <MousePointer2 className="w-3 h-3" /> Arrastra para mover el contenido de la capa activa
      </span>
    ),
    'rect-select': (
      <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Scan className="w-3 h-3" /> Los ajustes y filtros se aplicaran solo dentro de la seleccion
      </span>
    ),
    'ellipse-select': (
      <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Scan className="w-3 h-3" /> Los ajustes y filtros se aplicaran solo dentro de la seleccion
      </span>
    ),
    lasso: (
      <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Scan className="w-3 h-3" /> Dibuja una zona libre para seleccionarla
      </span>
    ),
    wand: (
      <>
        <SliderGroup label="Toleran." value={s.wandTolerance} min={0} max={128} onChange={(v) => set({ wandTolerance: v })} />
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <Switch checked={s.wandContiguous} onCheckedChange={(v) => set({ wandContiguous: v })} aria-label="Contigua" />
          Contigua
        </label>
        <span className="text-[11px] text-muted-foreground">Haz clic para seleccionar zonas del mismo color</span>
      </>
    ),
    crop: (
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Crop className="w-3 h-3" /> Arrastra un area y confirma
        </span>
        <Button
          size="sm"
          variant="default"
          className="h-6 text-[11px] px-2 bg-amber-500 text-black hover:bg-amber-400"
          disabled={!s.cropRect}
          onClick={() => {
            if (s.cropRect) s.cropToRect(s.cropRect)
          }}
        >
          Aplicar recorte
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[11px] px-2"
          disabled={!s.cropRect}
          onClick={() => s.setCropRect(null)}
        >
          Cancelar
        </Button>
      </div>
    ),
    eyedropper: (
      <span className="text-[11px] text-muted-foreground">
        Haz clic para tomar el color frontal; Alt + clic para el de fondo
      </span>
    ),
    heal: (
      <>
        <SliderGroup label="Tamano" value={s.healSize} min={4} max={200} onChange={(v) => set({ healSize: v })} suffix="px" />
        <SliderGroup label="Fuerza" value={s.healStrength} min={5} max={100} onChange={(v) => set({ healStrength: v })} suffix="%" />
        <span className="text-[11px] text-muted-foreground">Suaviza imperfecciones mezclando con el entorno</span>
      </>
    ),
    clone: (
      <>
        <SliderGroup label="Tamano" value={s.cloneSize} min={4} max={200} onChange={(v) => set({ cloneSize: v })} suffix="px" />
        <SliderGroup label="Opacidad" value={s.cloneOpacity} min={1} max={100} onChange={(v) => set({ cloneOpacity: v })} suffix="%" />
        <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Stamp className="w-3 h-3" /> Alt + clic: define origen - luego pinta para copiar
        </span>
      </>
    ),
    dodge: (
      <>
        <SliderGroup label="Tamano" value={s.dodgeSize} min={4} max={200} onChange={(v) => set({ dodgeSize: v })} suffix="px" />
        <SliderGroup label="Exposic." value={s.dodgeExposure} min={1} max={100} onChange={(v) => set({ dodgeExposure: v })} suffix="%" />
        <RangeSelect value={s.dodgeRange} onChange={(v) => set({ dodgeRange: v })} />
      </>
    ),
    burn: (
      <>
        <SliderGroup label="Tamano" value={s.burnSize} min={4} max={200} onChange={(v) => set({ burnSize: v })} suffix="px" />
        <SliderGroup label="Exposic." value={s.burnExposure} min={1} max={100} onChange={(v) => set({ burnExposure: v })} suffix="%" />
        <RangeSelect value={s.burnRange} onChange={(v) => set({ burnRange: v })} />
      </>
    ),
    'blur-brush': (
      <>
        <SliderGroup label="Tamano" value={s.blurBrushSize} min={4} max={200} onChange={(v) => set({ blurBrushSize: v })} suffix="px" />
        <SliderGroup label="Fuerza" value={s.blurBrushStrength} min={1} max={100} onChange={(v) => set({ blurBrushStrength: v })} suffix="%" />
      </>
    ),
    'sharpen-brush': (
      <>
        <SliderGroup label="Tamano" value={s.sharpenBrushSize} min={4} max={200} onChange={(v) => set({ sharpenBrushSize: v })} suffix="px" />
        <SliderGroup label="Fuerza" value={s.sharpenBrushStrength} min={1} max={100} onChange={(v) => set({ sharpenBrushStrength: v })} suffix="%" />
      </>
    ),
    brush: (
      <>
        <SliderGroup label="Tamano" value={s.brushSize} min={1} max={200} onChange={(v) => set({ brushSize: v })} suffix="px" />
        <SliderGroup label="Dureza" value={s.brushHardness} min={0} max={100} onChange={(v) => set({ brushHardness: v })} suffix="%" />
        <SliderGroup label="Opacidad" value={s.brushOpacity} min={1} max={100} onChange={(v) => set({ brushOpacity: v })} suffix="%" />
      </>
    ),
    pencil: (
      <>
        <SliderGroup label="Tamano" value={s.pencilSize} min={1} max={40} onChange={(v) => set({ pencilSize: v })} suffix="px" />
      </>
    ),
    eraser: (
      <>
        <SliderGroup label="Tamano" value={s.eraserSize} min={1} max={200} onChange={(v) => set({ eraserSize: v })} suffix="px" />
        <SliderGroup label="Dureza" value={s.eraserHardness} min={0} max={100} onChange={(v) => set({ eraserHardness: v })} suffix="%" />
        <SliderGroup label="Opacidad" value={s.eraserOpacity} min={1} max={100} onChange={(v) => set({ eraserOpacity: v })} suffix="%" />
      </>
    ),
    fill: (
      <>
        <SliderGroup label="Toleran." value={s.fillTolerance} min={0} max={128} onChange={(v) => set({ fillTolerance: v })} />
        <span className="text-[11px] text-muted-foreground">Rellena la zona con el color frontal</span>
      </>
    ),
    gradient: (
      <>
        <div className="flex items-center gap-1.5">
          <Label className="text-[11px] text-muted-foreground">Modo</Label>
          <Select
            value={s.gradientMode}
            onValueChange={(v) => set({ gradientMode: v as 'fg-transparent' | 'fg-bg' })}
          >
            <SelectTrigger className="h-6 text-[11px] w-44" aria-label="Modo de degradado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fg-transparent" className="text-xs">Frontal a transparente</SelectItem>
              <SelectItem value="fg-bg" className="text-xs">Frontal a fondo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-[11px] text-muted-foreground">Forma</Label>
          <Select value={s.gradientType} onValueChange={(v) => set({ gradientType: v as 'linear' | 'radial' })}>
            <SelectTrigger className="h-6 text-[11px] w-32" aria-label="Forma de degradado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="linear" className="text-xs">Lineal</SelectItem>
              <SelectItem value="radial" className="text-xs">Radial</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <SliderGroup label="Opacidad" value={s.gradientOpacity} min={1} max={100} onChange={(v) => set({ gradientOpacity: v })} suffix="%" />
      </>
    ),
    text: (
      <>
        <div className="flex items-center gap-1.5">
          <Label className="text-[11px] text-muted-foreground">Fuente</Label>
          <Select value={s.textFont} onValueChange={(v) => set({ textFont: v })}>
            <SelectTrigger className="h-6 text-[11px] w-36" aria-label="Fuente">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sans-serif" className="text-xs">Sans serif</SelectItem>
              <SelectItem value="serif" className="text-xs">Serif</SelectItem>
              <SelectItem value="monospace" className="text-xs">Mono</SelectItem>
              <SelectItem value="cursive" className="text-xs">Cursiva</SelectItem>
              <SelectItem value="Georgia, serif" className="text-xs">Georgia</SelectItem>
              <SelectItem value="Impact, sans-serif" className="text-xs">Impact</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <SliderGroup label="Tamano" value={s.textSize} min={8} max={300} onChange={(v) => set({ textSize: v })} suffix="px" />
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <Switch checked={s.textBold} onCheckedChange={(v) => set({ textBold: v })} aria-label="Negrita" />
          Negrita
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <Switch checked={s.textItalic} onCheckedChange={(v) => set({ textItalic: v })} aria-label="Cursiva" />
          Cursiva
        </label>
        <span className="text-[11px] text-muted-foreground">Haz clic en el lienzo y escribe. Enter aplica.</span>
      </>
    ),
    'shape-rect': (
      <>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <Switch checked={s.shapeFill} onCheckedChange={(v) => set({ shapeFill: v })} aria-label="Relleno" />
          Relleno
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <Switch checked={s.shapeStroke} onCheckedChange={(v) => set({ shapeStroke: v })} aria-label="Contorno" />
          Contorno
        </label>
        <SliderGroup label="Grosor" value={s.shapeStrokeWidth} min={1} max={40} onChange={(v) => set({ shapeStrokeWidth: v })} suffix="px" />
      </>
    ),
    'shape-ellipse': (
      <>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <Switch checked={s.shapeFill} onCheckedChange={(v) => set({ shapeFill: v })} aria-label="Relleno" />
          Relleno
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <Switch checked={s.shapeStroke} onCheckedChange={(v) => set({ shapeStroke: v })} aria-label="Contorno" />
          Contorno
        </label>
        <SliderGroup label="Grosor" value={s.shapeStrokeWidth} min={1} max={40} onChange={(v) => set({ shapeStrokeWidth: v })} suffix="px" />
      </>
    ),
    'shape-line': (
      <>
        <SliderGroup label="Grosor" value={s.shapeStrokeWidth} min={1} max={40} onChange={(v) => set({ shapeStrokeWidth: v })} suffix="px" />
      </>
    ),
    mixer: (
      <>
        <SliderGroup label="Tamano" value={s.mixerSize} min={4} max={200} onChange={(v) => set({ mixerSize: v })} suffix="px" />
        <SliderGroup label="Humedad" value={s.mixerWet} min={0} max={100} onChange={(v) => set({ mixerWet: v })} suffix="%" />
        <SliderGroup label="Carga" value={s.mixerLoad} min={0} max={100} onChange={(v) => set({ mixerLoad: v })} suffix="%" />
        <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Paintbrush className="w-3 h-3" /> Mezcla la pintura con los colores del lienzo
        </span>
      </>
    ),
    pen: (
      <>
        <Spline className="w-3.5 h-3.5 text-amber-500/90 shrink-0" />
        <SliderGroup label="Grosor" value={s.penStrokeWidth} min={1} max={60} onChange={(v) => set({ penStrokeWidth: v })} suffix="px" />
        <span className="text-[11px] text-muted-foreground">
          Clic: esquina - Arrastrar: curva - Clic en el primer punto: cerrar - Esc: cancelar
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[11px] px-2"
            disabled={!s.penPath || s.penPath.points.length < 3 || s.penPath.closed}
            onClick={s.penClosePath}
          >
            Cerrar
          </Button>
          <Button
            size="sm"
            variant="default"
            className="h-6 text-[11px] px-2 bg-amber-500 text-black hover:bg-amber-400"
            disabled={!s.penPath || s.penPath.points.length < 2}
            onClick={s.penCommitStroke}
            title="Traza el trazado con el color frontal"
          >
            Trazar
          </Button>
          <Button
            size="sm"
            variant="default"
            className="h-6 text-[11px] px-2 bg-amber-500 text-black hover:bg-amber-400"
            disabled={!s.penPath || s.penPath.points.length < 3}
            onClick={s.penCommitFill}
            title="Rellena el trazado con el color frontal"
          >
            Rellenar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] px-2"
            disabled={!s.penPath}
            onClick={s.penClearPath}
          >
            Eliminar
          </Button>
        </div>
      </>
    ),
    hand: (
      <span className="text-[11px] text-muted-foreground">Arrastra para desplazar la vista. Manten Space para usarlo con cualquier herramienta</span>
    ),
    zoom: (
      <span className="text-[11px] text-muted-foreground">
        Clic: acercar - Alt + clic: alejar - Ctrl + rueda: zoom libre
      </span>
    ),
  }

  // barra de controles de la transformacion libre en curso
  const transformBar = () => {
    if (!s.transform) return null
    const b = s.transform.box
    const deg = (b.rot * 180) / Math.PI
    return (
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-medium text-amber-500/90 flex items-center gap-1.5">
          <RotateCw className="w-3.5 h-3.5" />
          Transformacion libre
        </span>
        <div className="h-4 w-px bg-border shrink-0" aria-hidden />
        <NumberBox label="X" value={b.cx} onChange={(v) => s.updateTransformBox({ cx: v })} />
        <NumberBox label="Y" value={b.cy} onChange={(v) => s.updateTransformBox({ cy: v })} />
        <NumberBox label="A" value={b.w} onChange={(v) => s.updateTransformBox({ w: Math.max(8, v) })} />
        <NumberBox label="Al" value={b.h} onChange={(v) => s.updateTransformBox({ h: Math.max(8, v) })} />
        <NumberBox label="Rot" value={deg} onChange={(v) => s.updateTransformBox({ rot: (v * Math.PI) / 180 })} step={1} />
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={s.transform.flipH ? 'default' : 'outline'}
            className={s.transform.flipH ? 'h-6 text-[11px] px-2 bg-amber-500 text-black hover:bg-amber-400' : 'h-6 text-[11px] px-2'}
            onClick={() => s.toggleTransformFlip('h')}
            title="Voltear horizontal"
          >
            <FlipHorizontal className="w-3 h-3" />
          </Button>
          <Button
            size="sm"
            variant={s.transform.flipV ? 'default' : 'outline'}
            className={s.transform.flipV ? 'h-6 text-[11px] px-2 bg-amber-500 text-black hover:bg-amber-400' : 'h-6 text-[11px] px-2'}
            onClick={() => s.toggleTransformFlip('v')}
            title="Voltear vertical"
          >
            <FlipVertical className="w-3 h-3" />
          </Button>
        </div>
        <div className="h-4 w-px bg-border shrink-0" aria-hidden />
        <span className="text-[11px] text-muted-foreground">Enter aplica - Esc cancela - Shift al arrastrar: proporcion</span>
        <Button
          size="sm"
          variant="default"
          className="h-6 text-[11px] px-2 bg-amber-500 text-black hover:bg-amber-400"
          onClick={s.commitTransform}
        >
          <Check className="w-3 h-3 mr-1" /> Aplicar
        </Button>
        <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" onClick={s.cancelTransform}>
          <X className="w-3 h-3 mr-1" /> Cancelar
        </Button>
      </div>
    )
  }

  // editor en linea de la capa de ajuste activa
  const adjEditor = () => {
    if (!isAdjustmentLayer || !activeLayer?.adjustment) return null
    const p = activeLayer.adjustment.params
    const upd = (partial: Partial<AdjustmentParams>) => s.updateAdjustment(activeLayer.id, partial)
    return (
      <div className="flex items-center gap-4">
        <span className="text-[11px] font-medium text-sky-400/90 flex items-center gap-1.5 capitalize">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          {ADJUSTMENT_LABELS[activeLayer.adjustment.type]}
        </span>
        <div className="h-4 w-px bg-border shrink-0" aria-hidden />
        {activeLayer.adjustment.type === 'brightness-contrast' && (
          <>
            <SliderGroup label="Brillo" value={p.brightness} min={0} max={200} onChange={(v) => upd({ brightness: v })} suffix="%" />
            <SliderGroup label="Contraste" value={p.contrast} min={0} max={200} onChange={(v) => upd({ contrast: v })} suffix="%" />
          </>
        )}
        {activeLayer.adjustment.type === 'hue-saturation' && (
          <>
            <SliderGroup label="Tono" value={p.hue} min={-180} max={180} onChange={(v) => upd({ hue: v })} suffix="°" />
            <SliderGroup label="Saturac." value={p.saturation} min={0} max={200} onChange={(v) => upd({ saturation: v })} suffix="%" />
            <SliderGroup label="Luminos." value={p.lightness} min={0} max={200} onChange={(v) => upd({ lightness: v })} suffix="%" />
          </>
        )}
        {activeLayer.adjustment.type === 'sepia' && (
          <SliderGroup label="Cantidad" value={p.sepiaAmount} min={0} max={100} onChange={(v) => upd({ sepiaAmount: v })} suffix="%" />
        )}
        {activeLayer.adjustment.type === 'vibrance' && (
          <SliderGroup label="Intensid." value={p.vibrance} min={-100} max={100} onChange={(v) => upd({ vibrance: v })} />
        )}
        {activeLayer.adjustment.type === 'color-balance' && (
          <>
            <RangeSelect value={balanceRange} onChange={setBalanceRange} />
            <SliderGroup
              label="C - R"
              value={p.colorBalance[balanceRange].r}
              min={-100}
              max={100}
              onChange={(v) =>
                upd({ colorBalance: { ...p.colorBalance, [balanceRange]: { ...p.colorBalance[balanceRange], r: v } } })
              }
            />
            <SliderGroup
              label="M - V"
              value={p.colorBalance[balanceRange].g}
              min={-100}
              max={100}
              onChange={(v) =>
                upd({ colorBalance: { ...p.colorBalance, [balanceRange]: { ...p.colorBalance[balanceRange], g: v } } })
              }
            />
            <SliderGroup
              label="A - A"
              value={p.colorBalance[balanceRange].b}
              min={-100}
              max={100}
              onChange={(v) =>
                upd({ colorBalance: { ...p.colorBalance, [balanceRange]: { ...p.colorBalance[balanceRange], b: v } } })
              }
            />
          </>
        )}
        {(activeLayer.adjustment.type === 'grayscale' || activeLayer.adjustment.type === 'invert') && (
          <span className="text-[11px] text-muted-foreground">Este ajuste no tiene parametros</span>
        )}
      </div>
    )
  }

  return (
    <div className="h-9 flex items-center gap-4 px-3 border-b border-border bg-[#232323] overflow-x-auto shrink-0">
      {s.transform ? (
        transformBar()
      ) : isAdjustmentLayer ? (
        adjEditor()
      ) : (
        <>
          <span className="text-[11px] font-medium text-amber-500/90 whitespace-nowrap capitalize">
            {tool.replace('-', ' ')}
          </span>
          <div className="h-4 w-px bg-border shrink-0" aria-hidden />
          <div className="flex items-center gap-4">{groups[tool]}</div>
        </>
      )}
    </div>
  )
}
