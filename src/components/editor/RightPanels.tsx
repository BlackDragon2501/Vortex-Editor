'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, History, Layers, Palette, Plus, Trash2, ArrowLeftRight, SlidersHorizontal, SunMedium, Droplets, CircleOff, Contrast, Blend, Spline, ChartColumn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useEditor } from '@/lib/editor/store'
import { BLEND_MODES, type BlendMode, type AdjustmentType } from '@/lib/editor/types'
import { cn } from '@/lib/utils'

const PRESET_COLORS = [
  '#000000', '#ffffff', '#ef4444', '#f97316', '#facc15', '#22c55e',
  '#14b8a6', '#8b5cf6', '#ec4899', '#78716c', '#57534e', '#1c1917',
]

const ADJUSTMENT_ICONS: Record<AdjustmentType, React.ComponentType<{ className?: string }>> = {
  'brightness-contrast': Contrast,
  'hue-saturation': Droplets,
  curves: Spline,
  levels: ChartColumn,
  grayscale: Contrast,
  invert: CircleOff,
  sepia: Blend,
  'color-balance': Palette,
  vibrance: SunMedium,
}

function LayerThumbnail({
  canvas,
  rev,
  adjustmentType = null,
}: {
  canvas: HTMLCanvasElement
  rev: number
  adjustmentType: AdjustmentType | null
}) {
  const dataUrl = useMemo(() => {
    void rev
    if (adjustmentType) return ''
    try {
      const t = document.createElement('canvas')
      const ratio = canvas.width / canvas.height
      const tw = ratio >= 1 ? 44 : 44 * ratio
      const th = ratio >= 1 ? 44 / ratio : 44
      t.width = Math.max(1, Math.round(tw))
      t.height = Math.max(1, Math.round(th))
      const ctx = t.getContext('2d')!
      ctx.drawImage(canvas, 0, 0, t.width, t.height)
      return t.toDataURL()
    } catch {
      return ''
    }
  }, [canvas, rev, adjustmentType])

  if (adjustmentType) {
    const Icon = ADJUSTMENT_ICONS[adjustmentType] ?? SlidersHorizontal
    return (
      <div className="w-11 h-9 rounded-[3px] overflow-hidden border border-sky-500/40 bg-sky-500/10 flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5 text-sky-400" aria-hidden />
      </div>
    )
  }

  return (
    <div className="w-11 h-9 editor-checkerboard rounded-[3px] overflow-hidden border border-border shrink-0">
      {dataUrl && (
        <img src={dataUrl} alt={`Miniatura de capa`} className="w-full h-full object-contain" />
      )}
    </div>
  )
}

function ColorPanel() {
  const s = useEditor()
  return (
    <section aria-label="Colores" className="border-b border-border px-3 py-3">
      <div className="flex items-center gap-2 mb-2">
        <Palette className="w-3.5 h-3.5 text-amber-500/90" />
        <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Color</h3>
        <button
          type="button"
          className="ml-auto text-muted-foreground hover:text-foreground"
          onClick={s.swapColors}
          aria-label="Intercambiar colores"
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative flex items-center justify-center">
          <label className="absolute -bottom-1.5 -right-1.5 z-10 cursor-pointer" aria-label="Color de fondo">
            <span className="block w-6 h-6 rounded-[3px] border border-border editor-checkerboard">
              <span className="block w-full h-full rounded-[2px]" style={{ backgroundColor: s.background }} />
            </span>
            <input
              type="color"
              value={s.background}
              onChange={(e) => s.patch({ background: e.target.value })}
              className="sr-only"
            />
          </label>
          <label className="cursor-pointer z-20" aria-label="Color frontal">
            <span className="block w-9 h-9 rounded-[3px] border border-border editor-checkerboard shadow-md">
              <span className="block w-full h-full rounded-[2px]" style={{ backgroundColor: s.foreground }} />
            </span>
            <input
              type="color"
              value={s.foreground}
              onChange={(e) => s.patch({ foreground: e.target.value })}
              className="sr-only"
            />
          </label>
        </div>
        <div className="grid grid-cols-6 gap-1 flex-1">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="w-4 h-4 rounded-[2px] border border-white/15 hover:scale-110 transition-transform"
              style={{ backgroundColor: c }}
              onClick={() => s.patch({ foreground: c })}
              onContextMenu={(e) => {
                e.preventDefault()
                s.patch({ background: c })
              }}
              aria-label={`Usar color ${c}`}
              title={`${c} (clic derecho para fondo)`}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function LayersPanel() {
  const s = useEditor()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dragFrom, setDragFrom] = useState<number | null>(null)

  const active = s.layers.find((l) => l.id === s.activeLayerId) ?? null

  if (!s.layers.length) {
    return (
      <section aria-label="Capas" className="px-3 py-3 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2 mb-2">
          <Layers className="w-3.5 h-3.5 text-amber-500/90" />
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Capas</h3>
        </div>
        Sin documento abierto
      </section>
    )
  }

  return (
    <section aria-label="Capas" className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border">
        <Layers className="w-3.5 h-3.5 text-amber-500/90" />
        <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Capas</h3>
        <TooltipProvider delayDuration={200}>
          <div className="ml-auto flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="p-1 rounded hover:bg-zinc-700/60 text-muted-foreground hover:text-foreground" onClick={s.addLayer} aria-label="Nueva capa">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">Nueva capa</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="p-1 rounded hover:bg-zinc-700/60 text-muted-foreground hover:text-foreground" aria-label="Nueva capa de ajuste">
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs">Nueva capa de ajuste</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="text-xs">
                <DropdownMenuItem onClick={() => s.addAdjustmentLayer('brightness-contrast')} className="text-xs">
                  Brillo y contraste
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => s.addAdjustmentLayer('levels')} className="text-xs">
                  Niveles...
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => s.addAdjustmentLayer('curves')} className="text-xs">
                  Curvas...
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => s.addAdjustmentLayer('hue-saturation')} className="text-xs">
                  Tono y saturacion
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => s.addAdjustmentLayer('color-balance')} className="text-xs">
                  Balance de color
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => s.addAdjustmentLayer('vibrance')} className="text-xs">
                  Intensidad (Vibrance)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => s.addAdjustmentLayer('grayscale')} className="text-xs">
                  Blanco y negro
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => s.addAdjustmentLayer('invert')} className="text-xs">
                  Invertir colores
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => s.addAdjustmentLayer('sepia')} className="text-xs">
                  Sepia
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="p-1 rounded hover:bg-zinc-700/60 text-muted-foreground hover:text-foreground" onClick={() => active && s.duplicateLayer(active.id)} aria-label="Duplicar capa" disabled={!active}>
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">Duplicar capa</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="p-1 rounded hover:bg-zinc-700/60 text-muted-foreground hover:text-destructive" onClick={() => active && s.deleteLayer(active.id)} aria-label="Eliminar capa" disabled={!active || s.layers.length <= 1}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">Eliminar capa</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      {/* propiedades de la capa activa */}
      {active && active.kind === 'adjustment' && (
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          <SlidersHorizontal className="w-3.5 h-3.5 text-sky-400/90 shrink-0" />
          <span className="text-[11px] text-muted-foreground">
            {active.adjustment && (active.adjustment.type === 'curves' || active.adjustment.type === 'levels')
              ? 'Doble clic en la capa para abrir su editor de curvas/niveles'
              : 'Capa de ajuste: edita sus parametros en la barra superior'}
          </span>
        </div>
      )}
      {active && active.kind === 'pixel' && (
        <div className="px-3 py-2 border-b border-border space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground w-12">Modo</span>
            <Select
              value={active.blendMode}
              onValueChange={(v) => s.updateLayer(active.id, { blendMode: v as BlendMode })}
            >
              <SelectTrigger className="h-6 text-[11px] flex-1" aria-label="Modo de fusion">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {BLEND_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground w-12">Opac.</span>
            <Slider
              value={[active.opacity]}
              min={0}
              max={100}
              onValueChange={(v) => s.updateLayer(active.id, { opacity: v[0] })}
              className="flex-1"
              aria-label="Opacidad de capa"
            />
            <span className="text-[11px] tabular-nums w-8 text-right">{active.opacity}%</span>
          </div>
        </div>
      )}

      {/* lista */}
      <ol className="flex-1 min-h-0 overflow-y-auto editor-scrollbar">
        {[...s.layers].reverse().map((layer) => {
          const realIndex = s.layers.indexOf(layer)
          const isActive = layer.id === s.activeLayerId
          return (
            <li
              key={layer.id}
              draggable={renamingId !== layer.id}
              onDragStart={(e) => {
                setDragFrom(realIndex)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(realIndex))
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const dtFrom = Number(e.dataTransfer.getData('text/plain'))
                const from = Number.isNaN(dtFrom) ? dragFrom : dtFrom
                if (from !== null && !Number.isNaN(from)) s.reorderLayer(from, realIndex)
                setDragFrom(null)
              }}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 border-b border-border/60 cursor-pointer select-none',
                isActive ? 'bg-amber-500/10' : 'hover:bg-zinc-800/60'
              )}
              onClick={() => s.setActiveLayer(layer.id)}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  s.updateLayer(layer.id, { visible: !layer.visible })
                }}
                aria-label={layer.visible ? 'Ocultar capa' : 'Mostrar capa'}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 opacity-50" />}
              </button>
              <LayerThumbnail canvas={layer.canvas} rev={s.rev} adjustmentType={layer.kind === 'adjustment' ? layer.adjustment?.type ?? null : null} />
              {renamingId === layer.id ? (
                <Input
                  autoFocus
                  value={renameValue}
                  className="h-6 text-[11px]"
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      s.updateLayer(layer.id, { name: renameValue || layer.name })
                      setRenamingId(null)
                    }
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onBlur={() => {
                    s.updateLayer(layer.id, { name: renameValue || layer.name })
                    setRenamingId(null)
                  }}
                />
              ) : (
                <span
                  className={cn('text-[11px] truncate flex-1', !layer.visible && 'opacity-50 italic')}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    if (layer.kind === 'adjustment') {
                      // abre el editor del ajuste (curvas/niveles) o selecciona la capa
                      s.editAdjustmentLayer(layer.id)
                      return
                    }
                    setRenamingId(layer.id)
                    setRenameValue(layer.name)
                  }}
                  title={layer.kind === 'adjustment' ? 'Doble clic para editar el ajuste' : 'Doble clic para renombrar'}
                >
                  {layer.name}
                </span>
              )}
              <div className="flex flex-col">
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Subir capa"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (realIndex < s.layers.length - 1) s.reorderLayer(realIndex, realIndex + 1)
                  }}
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Bajar capa"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (realIndex > 0) s.reorderLayer(realIndex, realIndex - 1)
                  }}
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function HistoryPanel() {
  const s = useEditor()
  return (
    <section aria-label="Historial" className="border-t border-border flex flex-col max-h-44">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border">
        <History className="w-3.5 h-3.5 text-amber-500/90" />
        <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Historial</h3>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            className="p-1 rounded hover:bg-zinc-700/60 text-muted-foreground hover:text-foreground disabled:opacity-40"
            onClick={s.undo}
            disabled={s.historyIndex <= 0}
            aria-label="Deshacer"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="p-1 rounded hover:bg-zinc-700/60 text-muted-foreground hover:text-foreground disabled:opacity-40"
            onClick={s.redo}
            disabled={s.historyIndex >= s.history.length - 1}
            aria-label="Rehacer"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <ol className="overflow-y-auto editor-scrollbar">
        {s.history.map((entry, i) => (
          <li key={i}>
            <button
              type="button"
              className={cn(
                'w-full text-left px-3 py-1 text-[11px] flex items-center gap-2',
                i === s.historyIndex
                  ? 'bg-amber-500/15 text-foreground'
                  : i > s.historyIndex
                    ? 'text-muted-foreground/50 hover:bg-zinc-800/40'
                    : 'text-muted-foreground hover:bg-zinc-800/60'
              )}
              onClick={() => s.jumpHistory(i)}
            >
              <span className="tabular-nums w-4 opacity-60">{i + 1}</span>
              {entry.label}
            </button>
          </li>
        ))}
        {!s.history.length && (
          <li className="px-3 py-2 text-[11px] text-muted-foreground">Sin acciones todavia</li>
        )}
      </ol>
    </section>
  )
}

export function RightPanels() {
  return (
    <aside
      aria-label="Paneles"
      className="hidden md:flex w-72 flex-col border-l border-border bg-[#1c1c1c] shrink-0 min-h-0"
    >
      <ColorPanel />
      <LayersPanel />
      <HistoryPanel />
    </aside>
  )
}
