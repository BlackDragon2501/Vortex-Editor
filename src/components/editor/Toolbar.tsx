'use client'

import {
  Brush,
  CircleDashed,
  Contrast,
  Crop,
  Droplets,
  Eraser,
  Flame,
  Hand,
  Lasso,
  Minus,
  Move,
  PaintBucket,
  Paintbrush,
  Pipette,
  Blend,
  Pencil,
  PenTool,
  Stamp,
  SunMedium,
  Bandage,
  SquareDashed,
  Type,
  Wand2,
  ZoomIn,
  Square,
  Circle,
  Gem,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { useEditor } from '@/lib/editor/store'
import type { ToolId } from '@/lib/editor/types'
import { cn } from '@/lib/utils'

interface ToolDef {
  id: ToolId
  icon: React.ComponentType<{ className?: string }>
  label: string
  shortcut: string
}

const TOOL_GROUPS: ToolDef[][] = [
  [
    { id: 'move', icon: Move, label: 'Mover', shortcut: 'V' },
    { id: 'rect-select', icon: SquareDashed, label: 'Seleccion rectangular', shortcut: 'M' },
    { id: 'ellipse-select', icon: CircleDashed, label: 'Seleccion eliptica', shortcut: 'M' },
    { id: 'lasso', icon: Lasso, label: 'Lazo libre', shortcut: 'L' },
    { id: 'wand', icon: Wand2, label: 'Varita magica', shortcut: 'W' },
  ],
  [
    { id: 'crop', icon: Crop, label: 'Recorte', shortcut: 'C' },
    { id: 'eyedropper', icon: Pipette, label: 'Cuentagotas', shortcut: 'I' },
  ],
  [
    { id: 'heal', icon: Bandage, label: 'Pincel corrector', shortcut: 'J' },
    { id: 'clone', icon: Stamp, label: 'Tampon de clonar (Alt+clic: origen)', shortcut: 'S' },
    { id: 'dodge', icon: SunMedium, label: 'Sobreexponer (aclarar)', shortcut: 'O' },
    { id: 'burn', icon: Flame, label: 'Subexponer (oscurecer)', shortcut: 'F' },
    { id: 'blur-brush', icon: Droplets, label: 'Desenfocar', shortcut: 'R' },
    { id: 'sharpen-brush', icon: Gem, label: 'Enfocar', shortcut: 'N' },
  ],
  [
    { id: 'brush', icon: Brush, label: 'Pincel', shortcut: 'B' },
    { id: 'pencil', icon: Pencil, label: 'Lapiz', shortcut: '' },
    { id: 'mixer', icon: Paintbrush, label: 'Pincel mezclador', shortcut: '' },
    { id: 'eraser', icon: Eraser, label: 'Borrador', shortcut: 'E' },
    { id: 'fill', icon: PaintBucket, label: 'Relleno', shortcut: 'G' },
    { id: 'gradient', icon: Blend, label: 'Degradado', shortcut: 'G' },
  ],
  [
    { id: 'pen', icon: PenTool, label: 'Pluma vectorial', shortcut: 'P' },
  ],
  [
    { id: 'text', icon: Type, label: 'Texto', shortcut: 'T' },
    { id: 'shape-rect', icon: Square, label: 'Rectangulo', shortcut: 'U' },
    { id: 'shape-ellipse', icon: Circle, label: 'Elipse', shortcut: 'U' },
    { id: 'shape-line', icon: Minus, label: 'Linea', shortcut: 'U' },
  ],
  [
    { id: 'hand', icon: Hand, label: 'Mano (o Space)', shortcut: 'H' },
    { id: 'zoom', icon: ZoomIn, label: 'Zoom', shortcut: 'Z' },
  ],
]

export function Toolbar() {
  const activeTool = useEditor((s) => s.activeTool)
  const setTool = useEditor((s) => s.setTool)

  return (
    <TooltipProvider delayDuration={300}>
      <nav
        aria-label="Herramientas"
        className="w-11 flex flex-col items-center gap-0.5 py-2 border-r border-border bg-[#1c1c1c] shrink-0 overflow-y-auto editor-scrollbar"
      >
        {TOOL_GROUPS.map((group, gi) => (
          <div key={gi} className="flex flex-col items-center gap-0.5 w-full">
            {gi > 0 && <Separator className="my-1 w-6 bg-border" />}
            {group.map((tool) => {
              const Icon = tool.icon
              const active = activeTool === tool.id
              return (
                <Tooltip key={tool.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={tool.label}
                      aria-pressed={active}
                      onClick={() => setTool(tool.id)}
                      className={cn(
                        'w-8 h-8 rounded-[5px] flex items-center justify-center transition-colors shrink-0',
                        active
                          ? 'bg-amber-500/90 text-black'
                          : 'text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-100'
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">
                    {tool.label} <span className="ml-1 text-muted-foreground">{tool.shortcut}</span>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        ))}
        <div className="mt-auto pt-2">
          <Contrast className="w-3.5 h-3.5 text-zinc-600" aria-hidden />
        </div>
      </nav>
    </TooltipProvider>
  )
}
