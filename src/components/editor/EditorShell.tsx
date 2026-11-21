'use client'

import { useEffect } from 'react'
import { MenuBar } from './MenuBar'
import { Toolbar } from './Toolbar'
import { OptionsBar } from './OptionsBar'
import { CanvasStage } from './CanvasStage'
import { RightPanels } from './RightPanels'
import { Dialogs } from './Dialogs'
import { Minus, Plus, Maximize } from 'lucide-react'
import { useEditor } from '@/lib/editor/store'
import type { ToolId } from '@/lib/editor/types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { LegalFooter } from './Branding'

const TOOL_NAMES: Record<ToolId, string> = {
  move: 'Mover',
  'rect-select': 'Seleccion rectangular',
  'ellipse-select': 'Seleccion eliptica',
  lasso: 'Lazo libre',
  wand: 'Varita magica',
  crop: 'Recorte',
  eyedropper: 'Cuentagotas',
  brush: 'Pincel',
  pencil: 'Lapiz',
  mixer: 'Pincel mezclador',
  eraser: 'Borrador',
  fill: 'Relleno',
  gradient: 'Degradado',
  pen: 'Pluma vectorial',
  heal: 'Pincel corrector',
  clone: 'Tampon de clonar',
  dodge: 'Sobreexponer',
  burn: 'Subexponer',
  'blur-brush': 'Desenfocar',
  'sharpen-brush': 'Enfocar',
  text: 'Texto',
  'shape-rect': 'Rectangulo',
  'shape-ellipse': 'Elipse',
  'shape-line': 'Linea',
  hand: 'Mano',
  zoom: 'Zoom',
}

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'move',
  m: 'rect-select',
  l: 'lasso',
  w: 'wand',
  c: 'crop',
  i: 'eyedropper',
  j: 'heal',
  s: 'clone',
  o: 'dodge',
  f: 'burn',
  r: 'blur-brush',
  n: 'sharpen-brush',
  b: 'brush',
  p: 'pen',
  e: 'eraser',
  g: 'fill',
  t: 'text',
  u: 'shape-rect',
  h: 'hand',
  z: 'zoom',
}

function StatusBar() {
  const zoom = useEditor((s) => s.zoom)
  const cursorPos = useEditor((s) => s.cursorPos)
  const activeTool = useEditor((s) => s.activeTool)
  const width = useEditor((s) => s.width)
  const height = useEditor((s) => s.height)
  const layersCount = useEditor((s) => s.layers.length)
  const activeLayer = useEditor((s) => s.layers.find((l) => l.id === s.activeLayerId)?.name ?? '-')
  const setView = useEditor((s) => s.setView)

  const zoomAt = (factor: number) => {
    const st = useEditor.getState()
    const newZoom = Math.max(0.02, Math.min(16, st.zoom * factor))
    setView(newZoom, st.panX, st.panY)
  }

  return (
    <footer className="h-6 flex items-center gap-4 px-3 border-t border-border bg-[#1c1c1c] text-[10.5px] text-muted-foreground shrink-0 select-none">
      <span className="text-foreground/80 w-40 truncate">{TOOL_NAMES[activeTool]}</span>
      <span className="hidden sm:inline">Capa: {activeLayer}</span>
      <span className="hidden md:inline">
        {width} x {height} px - {layersCount} capa{layersCount === 1 ? '' : 's'}
      </span>
      <span className="hidden lg:inline tabular-nums">
        {cursorPos ? `X: ${cursorPos.x}  Y: ${cursorPos.y}` : ''}
      </span>
      <div className="ml-auto flex items-center gap-1" aria-label="Controles de zoom">
        <button
          type="button"
          className="p-0.5 hover:text-foreground"
          onClick={() => zoomAt(1 / 1.25)}
          aria-label="Alejar"
        >
          <Minus className="w-3 h-3" />
        </button>
        <span className="tabular-nums w-10 text-center text-foreground/80">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className="p-0.5 hover:text-foreground"
          onClick={() => zoomAt(1.25)}
          aria-label="Acercar"
        >
          <Plus className="w-3 h-3" />
        </button>
        <button
          type="button"
          className="p-0.5 hover:text-foreground ml-1"
          onClick={() => useEditor.getState().requestFit()}
          aria-label="Ajustar a pantalla"
          title="Ajustar a pantalla"
        >
          <Maximize className="w-3 h-3" />
        </button>
      </div>
    </footer>
  )
}

export function EditorShell() {
  // inicializa un documento por defecto en el cliente
  useEffect(() => {
    const st = useEditor.getState()
    if (!st.width) {
      st.initDoc(1200, 800, 'white')
    }
  }, [])

  // atajos de teclado globales
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      const st = useEditor.getState()
      const ctrl = e.ctrlKey || e.metaKey

      if (ctrl) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault()
            if (e.shiftKey) st.redo()
            else st.undo()
            return
          case 'y':
            e.preventDefault()
            st.redo()
            return
          case 'd':
            e.preventDefault()
            st.deselect()
            return
          case 'a':
            e.preventDefault()
            st.selectAll()
            return
          case 'i':
            if (e.shiftKey) {
              e.preventDefault()
              st.invertSelection()
              return
            }
            return
          case 's':
            e.preventDefault()
            if (e.altKey) {
              void st.saveProjectToCloud()
            } else {
              st.setDialog('export')
            }
            return
          case 'o':
            e.preventDefault()
            if (e.shiftKey) {
              st.setDialog('projects')
            } else {
              // el input de archivo vive en MenuBar; disparamos un evento personalizado
              window.dispatchEvent(new CustomEvent('image-editor:open-file'))
            }
            return
          case 'n':
            e.preventDefault()
            st.setDialog('new-doc')
            return
          case 't':
            e.preventDefault()
            if (st.transform) st.commitTransform()
            else st.enterTransform()
            return
          case 'l':
            e.preventDefault()
            st.setDialog('levels')
            return
          case 'm':
            e.preventDefault()
            st.setDialog('curves')
            return
          case '0':
            e.preventDefault()
            st.requestFit()
            return
          case '1':
            e.preventDefault()
            st.patch({ zoom: 1 })
            return
          case '=':
          case '+':
            e.preventDefault()
            st.patch({ zoom: Math.min(16, st.zoom * 1.25) })
            return
          case '-':
            e.preventDefault()
            st.patch({ zoom: Math.max(0.02, st.zoom / 1.25) })
            return
        }
        return
      }

      if (e.key === 'Enter') {
        if (st.transform) {
          e.preventDefault()
          st.commitTransform()
          return
        }
        if (st.penPath) {
          e.preventDefault()
          st.penCommitStroke()
          return
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        st.deleteSelectionPixels()
        return
      }
      if (e.key === 'Escape') {
        if (st.transform) {
          st.cancelTransform()
          return
        }
        if (st.penPath) {
          st.penClearPath()
          return
        }
        st.deselect()
        st.setCropRect(null)
        return
      }
      if (e.key === '[') {
        const size = Math.max(1, Math.round(st.brushSize * 0.8))
        st.patch({ brushSize: size, eraserSize: Math.max(1, Math.round(st.eraserSize * 0.8)) })
        return
      }
      if (e.key === ']') {
        st.patch({
          brushSize: Math.min(200, Math.round(st.brushSize * 1.25)),
          eraserSize: Math.min(200, Math.round(st.eraserSize * 1.25)),
        })
        return
      }
      if (e.key === 'x' && !e.ctrlKey) {
        st.swapColors()
        return
      }
      const tool = TOOL_KEYS[e.key.toLowerCase()]
      if (tool) {
        st.setTool(tool)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <TooltipProvider delayDuration={400}>
      <div className="min-h-screen w-full flex flex-col bg-[#161616] text-foreground">
        {/* espacio de trabajo: ocupa exactamente un viewport */}
        <div className="h-screen w-full flex flex-col overflow-hidden shrink-0">
          <MenuBar />
          <OptionsBar />
          <div className="flex flex-1 min-h-0">
            <Toolbar />
            <main className="flex-1 flex flex-col min-w-0">
              <CanvasStage />
            </main>
            <RightPanels />
          </div>
          <StatusBar />
        </div>
        {/* legal branding completo de Vortex Company */}
        <LegalFooter />
        <Dialogs />
      </div>
    </TooltipProvider>
  )
}
