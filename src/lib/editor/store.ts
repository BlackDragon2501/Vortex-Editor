'use client'

import { create } from 'zustand'
import type {
  Adjustment,
  AdjustmentParams,
  AdjustmentType,
  Anchor,
  BlendMode,
  DialogId,
  HistoryEntry,
  Layer,
  PenPath,
  PenPoint,
  Point,
  Rect,
  Selection,
  SerializedLayer,
  ToolId,
  TransformBox,
  TransformState,
} from './types'
import {
  ADJUSTMENT_LABELS,
  DEFAULT_ADJUSTMENT_PARAMS,
  adjustmentToFilter,
  cloneColorBalance,
  cloneCurveSet,
  identityCurveSet,
  penPathToPath2D,
} from './types'
import {
  addNoise,
  cloneCanvasEl,
  contentBounds,
  convolve,
  createCanvasEl,
  cssFilterClone,
  floodFill,
  hexToRgb,
  maskToRunsPath,
  pixelate,
  selectionToMask,
  wandMask,
  withAlpha,
} from './filters'
import { compositeLayers } from './compose'
import { makeSelection, makeSelectionFromMask } from './selection'
import { applyAdjustmentPixels } from './adjustments'
import { autoEnhance, inpaintCanvas, type InpaintOptions } from './inpaint'
import { lamaInpaint, type LamaProgress } from './lama'
import { deserializeProject, downloadProjectFile, makeThumbnail, serializeProject } from './project'
import { toast } from '@/hooks/use-toast'

const HISTORY_LIMIT = 24

// temporizadores de antirrebote para el historial de capas de ajuste
const adjustHistoryTimers = new Map<string, number>()

let uidCounter = 0
function uid(): string {
  uidCounter++
  return `layer-${Date.now().toString(36)}-${uidCounter}`
}

export interface EditorState {
  // Documento
  docName: string
  width: number
  height: number
  layers: Layer[]
  activeLayerId: string | null
  rev: number
  // Historial
  history: HistoryEntry[]
  historyIndex: number
  // Herramientas
  activeTool: ToolId
  foreground: string
  background: string
  brushSize: number
  brushHardness: number
  brushOpacity: number
  pencilSize: number
  eraserSize: number
  eraserHardness: number
  eraserOpacity: number
  fillTolerance: number
  wandTolerance: number
  wandContiguous: boolean
  healSize: number
  healStrength: number
  cloneSize: number
  cloneOpacity: number
  dodgeSize: number
  dodgeExposure: number
  dodgeRange: 'shadows' | 'midtones' | 'highlights'
  burnSize: number
  burnExposure: number
  burnRange: 'shadows' | 'midtones' | 'highlights'
  blurBrushSize: number
  blurBrushStrength: number
  maskBrushSize: number
  maskBrushSubtract: boolean
  sharpenBrushSize: number
  sharpenBrushStrength: number
  gradientMode: 'fg-transparent' | 'fg-bg'
  gradientType: 'linear' | 'radial'
  gradientOpacity: number
  textFont: string
  textSize: number
  textBold: boolean
  textItalic: boolean
  shapeFill: boolean
  shapeStroke: boolean
  shapeStrokeWidth: number
  // Pluma vectorial
  penPath: PenPath | null
  penStrokeWidth: number
  // Pincel mezclador
  mixerSize: number
  mixerWet: number
  mixerLoad: number
  // Estado de lienzo
  selection: Selection | null
  cropRect: Rect | null
  // Transformacion libre en curso (null = inactiva)
  transform: TransformState | null
  // capa de ajuste que se esta editando en un dialogo
  editingAdjustmentId: string | null
  // Vista
  zoom: number
  panX: number
  panY: number
  fitRequest: number
  cursorPos: { x: number; y: number } | null
  // Dialogos
  dialog: DialogId

  // ---- Proyectos (biblioteca en la nube + archivo .vortex.json) ----
  /** id del proyecto en la base de datos; null = todavia no guardado */
  projectId: string | null
  /** true mientras se guarda/carga en la nube */
  cloudBusy: boolean
  saveProjectToCloud: () => Promise<boolean>
  loadProjectFromCloud: (id: string) => Promise<boolean>
  loadFromSerialized: (raw: unknown) => Promise<boolean>
  exportProjectFile: () => void
  importProjectFile: (file: File) => Promise<boolean>

  // ---- Acciones ----
  initDoc: (w: number, h: number, bg: 'white' | 'transparent' | 'black' | 'fg') => void
  openImageFile: (file: File) => Promise<void>
  addLayer: () => void
  addLayerFromImage: (img: HTMLImageElement, name: string) => void
  addAdjustmentLayer: (type: AdjustmentType) => void
  updateAdjustment: (id: string, partial: Partial<AdjustmentParams>) => void
  mergeDown: () => void
  flattenImage: () => void
  invertSelection: () => void
  applyWandSelection: (x: number, y: number, tolerance: number, contiguous: boolean) => void
  deleteLayer: (id: string) => void
  duplicateLayer: (id: string) => void
  reorderLayer: (from: number, to: number) => void
  setActiveLayer: (id: string) => void
  updateLayer: (id: string, partial: Partial<Pick<Layer, 'name' | 'visible' | 'opacity' | 'blendMode'>>) => void

  setTool: (t: ToolId) => void
  patch: (partial: Partial<EditorState>) => void
  swapColors: () => void

  markDirty: () => void
  pushHistory: (label: string) => void
  undo: () => void
  redo: () => void
  jumpHistory: (index: number) => void

  selectAll: () => void
  deselect: () => void
  setSelection: (sel: Selection | null) => void
  deleteSelectionPixels: () => void
  fillSelection: (color: string) => void

  applyCssFilter: (label: string, filter: string) => void
  applyKernelFilter: (label: string, kernel: number[], offset?: number) => void
  applyPixelFilter: (label: string, fn: (canvas: HTMLCanvasElement) => void) => void
  applyFloodFill: (x: number, y: number, color: string, tolerance: number) => void
  commitGradient: (x0: number, y0: number, x1: number, y1: number) => void
  commitShape: (kind: 'rect' | 'ellipse' | 'line', x0: number, y0: number, x1: number, y1: number) => void
  commitText: (text: string, x: number, y: number) => void
  moveLayerBy: (dx: number, dy: number) => void
  nudgeLayer: (dx: number, dy: number) => void
  clearActiveLayer: () => void

  // Pluma vectorial
  penAddPoint: (p: Point) => void
  penSetLastHandles: (hOut: Point) => void
  penSetLastCorner: () => void
  penClosePath: () => void
  penClearPath: () => void
  penCommitStroke: () => void
  penCommitFill: () => void

  // Transformacion libre
  enterTransform: () => void
  updateTransformBox: (patch: Partial<TransformBox>) => void
  toggleTransformFlip: (axis: 'h' | 'v') => void
  commitTransform: () => void
  cancelTransform: () => void

  // Ajustes e IA
  applyAdjustmentToLayer: (label: string, adj: Adjustment) => void
  applyInpaint: (opts: InpaintOptions) => void
  applyInpaintNeural: (onProgress?: (p: LamaProgress) => void) => Promise<boolean>
  applyAutoEnhance: () => void
  editAdjustmentLayer: (id: string) => void

  resizeImage: (w: number, h: number) => void
  resizeCanvas: (w: number, h: number, anchor: Anchor) => void
  rotateDoc: (dir: 'cw' | 'ccw') => void
  flipDoc: (axis: 'h' | 'v') => void
  cropToRect: (rect: Rect) => void
  setCropRect: (rect: Rect | null) => void

  renderComposite: () => HTMLCanvasElement
  exportImage: (format: 'png' | 'jpeg', quality: number, name: string) => void
  setDialog: (d: DialogId) => void

  setView: (zoom: number, panX: number, panY: number) => void
  requestFit: () => void
  setCursorPos: (p: { x: number; y: number } | null) => void
}

function getActiveLayer(state: EditorState): Layer | null {
  const idx = state.layers.findIndex((l) => l.id === state.activeLayerId)
  if (idx < 0) return null
  const active = state.layers[idx]
  // las capas de ajuste no contienen pixeles editables: la operacion cae en
  // la capa de pixeles mas cercana por debajo (la capa que el ajuste afecta)
  if (active.kind === 'pixel') return active
  for (let i = idx - 1; i >= 0; i--) {
    if (state.layers[i].kind === 'pixel') return state.layers[i]
  }
  return null
}

function projectErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  return fallback
}

function restoreLayers(serialized: SerializedLayer[]): Layer[] {
  return serialized.map((l) => ({
    id: l.id,
    name: l.name,
    visible: l.visible,
    opacity: l.opacity,
    blendMode: l.blendMode,
    canvas: cloneCanvasEl(l.canvas),
    kind: l.kind,
    adjustment: l.adjustment
      ? {
          type: l.adjustment.type,
          params: {
            ...l.adjustment.params,
            curves: cloneCurveSet(l.adjustment.params.curves),
            levels: { ...l.adjustment.params.levels },
            colorBalance: cloneColorBalance(l.adjustment.params.colorBalance),
          },
        }
      : null,
  }))
}

function snapshotLayers(layers: Layer[]): SerializedLayer[] {
  return layers.map((l) => ({
    id: l.id,
    name: l.name,
    visible: l.visible,
    opacity: l.opacity,
    blendMode: l.blendMode,
    canvas: cloneCanvasEl(l.canvas),
    kind: l.kind,
    adjustment: l.adjustment
      ? {
          type: l.adjustment.type,
          params: {
            ...l.adjustment.params,
            curves: cloneCurveSet(l.adjustment.params.curves),
            levels: { ...l.adjustment.params.levels },
            colorBalance: cloneColorBalance(l.adjustment.params.colorBalance),
          },
        }
      : null,
  }))
}

export const useEditor = create<EditorState>((set, get) => ({
  docName: 'Sin titulo',
  width: 0,
  height: 0,
  layers: [],
  activeLayerId: null,
  rev: 0,
  history: [],
  historyIndex: -1,
  activeTool: 'brush',
  foreground: '#1a1a1a',
  background: '#ffffff',
  brushSize: 24,
  brushHardness: 65,
  brushOpacity: 100,
  pencilSize: 2,
  eraserSize: 30,
  eraserHardness: 80,
  eraserOpacity: 100,
  fillTolerance: 32,
  wandTolerance: 32,
  wandContiguous: true,
  healSize: 40,
  healStrength: 80,
  cloneSize: 40,
  cloneOpacity: 100,
  dodgeSize: 60,
  dodgeExposure: 25,
  dodgeRange: 'midtones',
  burnSize: 60,
  burnExposure: 25,
  burnRange: 'midtones',
  blurBrushSize: 60,
  blurBrushStrength: 50,
  maskBrushSize: 28,
  maskBrushSubtract: false,
  sharpenBrushSize: 60,
  sharpenBrushStrength: 50,
  gradientMode: 'fg-transparent',
  gradientType: 'linear',
  gradientOpacity: 100,
  textFont: 'sans-serif',
  textSize: 48,
  textBold: false,
  textItalic: false,
  shapeFill: true,
  shapeStroke: false,
  shapeStrokeWidth: 4,
  penPath: null,
  penStrokeWidth: 4,
  mixerSize: 40,
  mixerWet: 55,
  mixerLoad: 75,
  selection: null,
  cropRect: null,
  transform: null,
  editingAdjustmentId: null,
  zoom: 1,
  panX: 0,
  panY: 0,
  fitRequest: 0,
  cursorPos: null,
  // la pantalla de inicio (abrir/importar proyecto o crear documento) se muestra al arrancar
  dialog: 'new-doc',
  projectId: null,
  cloudBusy: false,

  // ---------- Documento ----------
  initDoc: (w, h, bg) => {
    const canvas = createCanvasEl(w, h)
    if (bg !== 'transparent') {
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = bg === 'fg' ? get().foreground : bg === 'black' ? '#000000' : '#ffffff'
      ctx.fillRect(0, 0, w, h)
    }
    const layer: Layer = {
      id: uid(),
      name: 'Fondo',
      visible: true,
      opacity: 100,
      blendMode: 'source-over',
      canvas,
      kind: 'pixel',
      adjustment: null,
    }
    set({
      docName: 'Sin titulo',
      width: w,
      height: h,
      layers: [layer],
      activeLayerId: layer.id,
      selection: null,
      cropRect: null,
      projectId: null,
      history: [
        {
          label: 'Nuevo documento',
          width: w,
          height: h,
          activeLayerId: layer.id,
          layers: snapshotLayers([layer]),
        },
      ],
      historyIndex: 0,
      rev: get().rev + 1,
      fitRequest: get().fitRequest + 1,
    })
  },

  openImageFile: async (file) => {
    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = reject
        image.src = url
      })
      const state = get()
      // Documento virgen: el documento por defecto que EditorShell crea al montar
      // (o uno recien creado) sin ninguna edicion del usuario. En ese caso la
      // imagen abre como documento propio con el tamano de la imagen; si el
      // usuario ya tiene trabajo real en el lienzo, se agrega como capa.
      const pristine =
        state.history.length <= 1 &&
        state.historyIndex <= 0 &&
        state.layers.length <= 1
      if (state.width === 0 || state.layers.length === 0 || pristine) {
        // crea un documento nuevo con el tamano de la imagen
        set({
          docName: file.name.replace(/\.[^.]+$/, ''),
          width: img.naturalWidth,
          height: img.naturalHeight,
          fitRequest: get().fitRequest + 1,
        })
        get().addLayerFromImage(img, file.name.replace(/\.[^.]+$/, ''))
        // la nueva capa de imagen es la ultima del arreglo; si habia un
        // documento virgen con capa Fondo, se descarta y queda solo la imagen
        const layer = get().layers[get().layers.length - 1]
        set({
          layers: [layer],
          activeLayerId: layer.id,
          history: [
            {
              label: 'Abrir imagen',
              width: img.naturalWidth,
              height: img.naturalHeight,
              activeLayerId: layer.id,
              layers: snapshotLayers([layer]),
            },
          ],
          historyIndex: 0,
          rev: get().rev + 1,
        })
      } else {
        get().addLayerFromImage(img, file.name.replace(/\.[^.]+$/, ''))
        get().pushHistory('Abrir imagen como capa')
      }
    } finally {
      URL.revokeObjectURL(url)
    }
  },

  addLayerFromImage: (img, name) => {
    const state = get()
    const w = state.width || img.naturalWidth
    const h = state.height || img.naturalHeight
    const canvas = createCanvasEl(w, h)
    canvas.getContext('2d')!.drawImage(img, 0, 0)
    const layer: Layer = {
      id: uid(),
      name: name || `Capa ${state.layers.length + 1}`,
      visible: true,
      opacity: 100,
      blendMode: 'source-over',
      canvas,
      kind: 'pixel',
      adjustment: null,
    }
    set({ layers: [...state.layers, layer], activeLayerId: layer.id, rev: state.rev + 1 })
  },

  addLayer: () => {
    const state = get()
    if (!state.width) return
    const canvas = createCanvasEl(state.width, state.height)
    const layer: Layer = {
      id: uid(),
      name: `Capa ${state.layers.length + 1}`,
      visible: true,
      opacity: 100,
      blendMode: 'source-over',
      canvas,
      kind: 'pixel',
      adjustment: null,
    }
    set({
      layers: [...state.layers, layer],
      activeLayerId: layer.id,
      rev: state.rev + 1,
    })
    get().pushHistory('Nueva capa')
  },

  addAdjustmentLayer: (type) => {
    const state = get()
    if (!state.width) return
    // la capa de ajuste se inserta justo encima de la capa activa (como en los editores pro)
    const activeIdx = state.layers.findIndex((l) => l.id === state.activeLayerId)
    const insertAt = activeIdx >= 0 ? activeIdx + 1 : state.layers.length
    const layer: Layer = {
      id: uid(),
      name: ADJUSTMENT_LABELS[type],
      visible: true,
      opacity: 100,
      blendMode: 'source-over',
      canvas: createCanvasEl(1, 1),
      kind: 'adjustment',
      adjustment: {
        type,
        params: {
          ...DEFAULT_ADJUSTMENT_PARAMS,
          curves: identityCurveSet(),
          levels: { ...DEFAULT_ADJUSTMENT_PARAMS.levels },
          colorBalance: cloneColorBalance(DEFAULT_ADJUSTMENT_PARAMS.colorBalance),
        },
      },
    }
    const layers = [...state.layers]
    layers.splice(insertAt, 0, layer)
    set({ layers, activeLayerId: layer.id, rev: state.rev + 1 })
    get().pushHistory(`Capa de ajuste: ${ADJUSTMENT_LABELS[type]}`)
    // curvas y niveles abren su editor completo en modo de edicion en vivo
    if (type === 'curves' || type === 'levels') {
      set({ editingAdjustmentId: layer.id, dialog: type })
    }
  },

  updateAdjustment: (id, partial) => {
    const state = get()
    set({
      layers: state.layers.map((l) =>
        l.id === id && l.adjustment
          ? { ...l, adjustment: { type: l.adjustment.type, params: { ...l.adjustment.params, ...partial } } }
          : l
      ),
      rev: state.rev + 1,
    })
    // historial con antirrebote: los deslizadores disparan muchos cambios seguidos
    const timers = adjustHistoryTimers
    if (timers.has(id)) clearTimeout(timers.get(id)!)
    timers.set(
      id,
      window.setTimeout(() => {
        timers.delete(id)
        const l = get().layers.find((x) => x.id === id)
        if (l) get().pushHistory(`Editar ajuste: ${l.name}`)
      }, 700)
    )
  },

  mergeDown: () => {
    const state = get()
    const idx = state.layers.findIndex((l) => l.id === state.activeLayerId)
    if (idx <= 0) return
    const top = state.layers[idx]
    const below = state.layers[idx - 1]
    if (below.kind === 'adjustment') return
    const layers = [...state.layers]
    if (top.kind === 'adjustment' && top.adjustment) {
      // aplica el ajuste directamente a la capa inferior
      const filtered = cssFilterClone(below.canvas, adjustmentToFilter(top.adjustment))
      below.canvas.getContext('2d')!.clearRect(0, 0, below.canvas.width, below.canvas.height)
      below.canvas.getContext('2d')!.drawImage(filtered, 0, 0)
    } else {
      const ctx = below.canvas.getContext('2d')!
      ctx.save()
      ctx.globalAlpha = top.opacity / 100
      ctx.globalCompositeOperation = top.blendMode
      ctx.drawImage(top.canvas, 0, 0)
      ctx.restore()
    }
    layers.splice(idx, 1)
    set({ layers, activeLayerId: below.id, rev: state.rev + 1 })
    get().pushHistory('Combinar hacia abajo')
  },

  flattenImage: () => {
    const state = get()
    if (state.layers.length <= 1) return
    const composite = createCanvasEl(state.width, state.height)
    compositeLayers(composite.getContext('2d')!, state.layers, state.width, state.height)
    const layer: Layer = {
      id: uid(),
      name: 'Fondo',
      visible: true,
      opacity: 100,
      blendMode: 'source-over',
      canvas: composite,
      kind: 'pixel',
      adjustment: null,
    }
    set({ layers: [layer], activeLayerId: layer.id, rev: state.rev + 1 })
    get().pushHistory('Aplanar imagen')
  },

  invertSelection: () => {
    const state = get()
    if (!state.selection) {
      get().selectAll()
      return
    }
    const mask = state.selection.mask
    const inverted = new Uint8ClampedArray(state.width * state.height)
    for (let p = 0; p < inverted.length; p++) inverted[p] = mask[p] > 0 ? 0 : 255
    set({ selection: makeSelectionFromMask('invert', inverted, state.width, state.height) })
  },

  applyWandSelection: (x, y, tolerance, contiguous) => {
    const state = get()
    const comp = get().renderComposite()
    const mask = wandMask(comp, x, y, tolerance, contiguous)
    if (!mask) return
    const sel = makeSelectionFromMask('wand', mask, state.width, state.height)
    if (sel.bounds.w === 0 || sel.bounds.h === 0) return
    set({ selection: sel })
  },

  deleteLayer: (id) => {
    const state = get()
    if (state.layers.length <= 1) return
    const idx = state.layers.findIndex((l) => l.id === id)
    const layers = state.layers.filter((l) => l.id !== id)
    const activeLayerId = state.activeLayerId === id ? layers[Math.min(idx, layers.length - 1)].id : state.activeLayerId
    set({ layers, activeLayerId, rev: state.rev + 1 })
    get().pushHistory('Eliminar capa')
  },

  duplicateLayer: (id) => {
    const state = get()
    const idx = state.layers.findIndex((l) => l.id === id)
    if (idx < 0) return
    const src = state.layers[idx]
    const copy: Layer = {
      id: uid(),
      name: `${src.name} copia`,
      visible: src.visible,
      opacity: src.opacity,
      blendMode: src.blendMode,
      canvas: cloneCanvasEl(src.canvas),
      kind: src.kind,
      adjustment: src.adjustment
        ? { type: src.adjustment.type, params: { ...src.adjustment.params } }
        : null,
    }
    const layers = [...state.layers]
    layers.splice(idx + 1, 0, copy)
    set({ layers, activeLayerId: copy.id, rev: state.rev + 1 })
    get().pushHistory('Duplicar capa')
  },

  reorderLayer: (from, to) => {
    const state = get()
    if (from === to || from < 0 || to < 0 || from >= state.layers.length || to >= state.layers.length) return
    const layers = [...state.layers]
    const [moved] = layers.splice(from, 1)
    layers.splice(to, 0, moved)
    set({ layers, rev: state.rev + 1 })
    get().pushHistory('Reordenar capas')
  },

  setActiveLayer: (id) => set({ activeLayerId: id }),

  updateLayer: (id, partial) => {
    const state = get()
    set({
      layers: state.layers.map((l) => (l.id === id ? { ...l, ...partial } : l)),
      rev: state.rev + 1,
    })
  },

  // ---------- Herramientas ----------
  setTool: (t) => set({ activeTool: t }),

  patch: (partial) => set(partial as EditorState),

  swapColors: () => {
    const { foreground, background } = get()
    set({ foreground: background, background: foreground })
  },

  // ---------- Historial ----------
  markDirty: () => set({ rev: get().rev + 1 }),

  pushHistory: (label) => {
    const state = get()
    if (!state.layers.length) return
    const entry: HistoryEntry = {
      label,
      width: state.width,
      height: state.height,
      activeLayerId: state.activeLayerId,
      layers: snapshotLayers(state.layers),
    }
    const truncated = state.history.slice(0, state.historyIndex + 1)
    truncated.push(entry)
    let history = truncated
    let index = truncated.length - 1
    if (history.length > HISTORY_LIMIT) {
      history = history.slice(history.length - HISTORY_LIMIT)
      index = history.length - 1
    }
    set({ history, historyIndex: index })
  },

  undo: () => {
    const state = get()
    if (state.historyIndex <= 0) return
    const entry = state.history[state.historyIndex - 1]
    set({
      width: entry.width,
      height: entry.height,
      layers: restoreLayers(entry.layers),
      activeLayerId: entry.activeLayerId,
      historyIndex: state.historyIndex - 1,
      selection: null,
      cropRect: null,
      transform: null,
      penPath: null,
      rev: state.rev + 1,
    })
  },

  redo: () => {
    const state = get()
    if (state.historyIndex >= state.history.length - 1) return
    const entry = state.history[state.historyIndex + 1]
    set({
      width: entry.width,
      height: entry.height,
      layers: restoreLayers(entry.layers),
      activeLayerId: entry.activeLayerId,
      historyIndex: state.historyIndex + 1,
      selection: null,
      cropRect: null,
      transform: null,
      penPath: null,
      rev: state.rev + 1,
    })
  },

  jumpHistory: (index) => {
    const state = get()
    if (index < 0 || index >= state.history.length || index === state.historyIndex) return
    const entry = state.history[index]
    set({
      width: entry.width,
      height: entry.height,
      layers: restoreLayers(entry.layers),
      activeLayerId: entry.activeLayerId,
      historyIndex: index,
      selection: null,
      cropRect: null,
      transform: null,
      penPath: null,
      rev: state.rev + 1,
    })
  },

  // ---------- Seleccion ----------
  selectAll: () => {
    const { width, height } = get()
    const path = new Path2D()
    path.rect(0, 0, width, height)
    set({ selection: makeSelection('rect', path, width, height) })
  },

  deselect: () => set({ selection: null }),

  setSelection: (sel) => set({ selection: sel }),

  deleteSelectionPixels: () => {
    const state = get()
    const layer = getActiveLayer(state)
    if (!layer) return
    const ctx = layer.canvas.getContext('2d')!
    if (state.selection) {
      const tmp = cloneCanvasEl(layer.canvas)
      ctx.clearRect(0, 0, state.width, state.height)
      ctx.drawImage(tmp, 0, 0)
      ctx.globalCompositeOperation = 'destination-out'
      ctx.drawImage(state.selection.maskCanvas, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
    } else {
      ctx.clearRect(0, 0, state.width, state.height)
    }
    set({ rev: state.rev + 1 })
    get().pushHistory(state.selection ? 'Borrar seleccion' : 'Borrar capa')
  },

  fillSelection: (color) => {
    const state = get()
    const layer = getActiveLayer(state)
    if (!layer) return
    const tmp = createCanvasEl(state.width, state.height)
    const tctx = tmp.getContext('2d')!
    tctx.fillStyle = color
    tctx.fillRect(0, 0, state.width, state.height)
    if (state.selection) {
      tctx.globalCompositeOperation = 'destination-in'
      tctx.drawImage(state.selection.maskCanvas, 0, 0)
      tctx.globalCompositeOperation = 'source-over'
    }
    const ctx = layer.canvas.getContext('2d')!
    ctx.drawImage(tmp, 0, 0)
    set({ rev: state.rev + 1 })
    get().pushHistory('Rellenar')
  },

  // ---------- Edicion de pixeles ----------

  applyCssFilter: (label, filter) => {
    const state = get()
    const layer = getActiveLayer(state)
    if (!layer) return
    const filtered = cssFilterClone(layer.canvas, filter)
    const ctx = layer.canvas.getContext('2d')!
    if (state.selection) {
      const fctx = filtered.getContext('2d')!
      fctx.globalCompositeOperation = 'destination-in'
      fctx.drawImage(state.selection.maskCanvas, 0, 0)
      fctx.globalCompositeOperation = 'source-over'
      ctx.drawImage(filtered, 0, 0)
    } else {
      ctx.clearRect(0, 0, state.width, state.height)
      ctx.drawImage(filtered, 0, 0)
    }
    set({ rev: state.rev + 1 })
    get().pushHistory(label)
  },

  applyKernelFilter: (label, kernel, offset = 0) => {
    const state = get()
    const layer = getActiveLayer(state)
    if (!layer) return
    const filtered = cloneCanvasEl(layer.canvas)
    convolve(filtered, kernel, offset)
    const ctx = layer.canvas.getContext('2d')!
    if (state.selection) {
      const fctx = filtered.getContext('2d')!
      fctx.globalCompositeOperation = 'destination-in'
      fctx.drawImage(state.selection.maskCanvas, 0, 0)
      fctx.globalCompositeOperation = 'source-over'
      ctx.drawImage(filtered, 0, 0)
    } else {
      ctx.clearRect(0, 0, state.width, state.height)
      ctx.drawImage(filtered, 0, 0)
    }
    set({ rev: state.rev + 1 })
    get().pushHistory(label)
  },

  applyPixelFilter: (label, fn) => {
    const state = get()
    const layer = getActiveLayer(state)
    if (!layer) return
    const filtered = cloneCanvasEl(layer.canvas)
    fn(filtered)
    const ctx = layer.canvas.getContext('2d')!
    if (state.selection) {
      const fctx = filtered.getContext('2d')!
      fctx.globalCompositeOperation = 'destination-in'
      fctx.drawImage(state.selection.maskCanvas, 0, 0)
      fctx.globalCompositeOperation = 'source-over'
      ctx.drawImage(filtered, 0, 0)
    } else {
      ctx.clearRect(0, 0, state.width, state.height)
      ctx.drawImage(filtered, 0, 0)
    }
    set({ rev: state.rev + 1 })
    get().pushHistory(label)
  },

  applyFloodFill: (x, y, color, tolerance) => {
    const state = get()
    const layer = getActiveLayer(state)
    if (!layer) return
    const mask = state.selection ? state.selection.mask : null
    floodFill(layer.canvas, x, y, { tolerance, color, mask })
    set({ rev: state.rev + 1 })
    get().pushHistory('Relleno')
  },

  commitGradient: (x0, y0, x1, y1) => {
    const state = get()
    const layer = getActiveLayer(state)
    if (!layer) return
    const tmp = createCanvasEl(state.width, state.height)
    const tctx = tmp.getContext('2d')!
    const dist = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)) || 1
    const g =
      state.gradientType === 'radial'
        ? tctx.createRadialGradient(x0, y0, 0, x0, y0, dist)
        : tctx.createLinearGradient(x0, y0, x1, y1)
    if (state.gradientMode === 'fg-transparent') {
      g.addColorStop(0, withAlpha(state.foreground, 1))
      g.addColorStop(1, withAlpha(state.foreground, 0))
    } else {
      g.addColorStop(0, state.foreground)
      g.addColorStop(1, state.background)
    }
    tctx.globalAlpha = state.gradientOpacity / 100
    tctx.fillStyle = g
    tctx.fillRect(0, 0, state.width, state.height)
    if (state.selection) {
      tctx.globalAlpha = 1
      tctx.globalCompositeOperation = 'destination-in'
      tctx.drawImage(state.selection.maskCanvas, 0, 0)
      tctx.globalCompositeOperation = 'source-over'
    }
    const ctx = layer.canvas.getContext('2d')!
    ctx.drawImage(tmp, 0, 0)
    set({ rev: state.rev + 1 })
    get().pushHistory(state.gradientType === 'radial' ? 'Degradado radial' : 'Degradado')
  },

  commitShape: (kind, x0, y0, x1, y1) => {
    const state = get()
    const layer = getActiveLayer(state)
    if (!layer) return
    const tmp = createCanvasEl(state.width, state.height)
    const ctx = tmp.getContext('2d')!
    ctx.fillStyle = state.foreground
    ctx.strokeStyle = state.foreground
    ctx.lineWidth = state.shapeStrokeWidth
    ctx.lineCap = 'round'
    if (kind === 'rect') {
      const rx = Math.min(x0, x1)
      const ry = Math.min(y0, y1)
      const rw = Math.abs(x1 - x0)
      const rh = Math.abs(y1 - y0)
      if (state.shapeFill) ctx.fillRect(rx, ry, rw, rh)
      if (state.shapeStroke || !state.shapeFill) ctx.strokeRect(rx, ry, rw, rh)
    } else if (kind === 'ellipse') {
      const cx = (x0 + x1) / 2
      const cy = (y0 + y1) / 2
      ctx.beginPath()
      ctx.ellipse(cx, cy, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2)
      if (state.shapeFill) ctx.fill()
      if (state.shapeStroke || !state.shapeFill) ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
    }
    if (state.selection) {
      ctx.globalCompositeOperation = 'destination-in'
      ctx.drawImage(state.selection.maskCanvas, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
    }
    layer.canvas.getContext('2d')!.drawImage(tmp, 0, 0)
    set({ rev: state.rev + 1 })
    const labels = { rect: 'Rectangulo', ellipse: 'Elipse', line: 'Linea' } as const
    get().pushHistory(labels[kind])
  },

  commitText: (text, x, y) => {
    const state = get()
    const layer = getActiveLayer(state)
    if (!layer || !text.trim()) return
    const tmp = createCanvasEl(state.width, state.height)
    const ctx = tmp.getContext('2d')!
    ctx.font = `${state.textItalic ? 'italic ' : ''}${state.textBold ? '700 ' : '400 '}${state.textSize}px ${state.textFont}`
    ctx.fillStyle = state.foreground
    ctx.textBaseline = 'top'
    const lineHeight = state.textSize * 1.25
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      ctx.fillText(line, x, y + i * lineHeight)
    })
    if (state.selection) {
      ctx.globalCompositeOperation = 'destination-in'
      ctx.drawImage(state.selection.maskCanvas, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
    }
    layer.canvas.getContext('2d')!.drawImage(tmp, 0, 0)
    set({ rev: state.rev + 1 })
    get().pushHistory('Texto')
  },

  moveLayerBy: (dx, dy) => {
    // lo gestiona CanvasStage durante el arrastre; aqui solo confirma el historial
    void dx
    void dy
    get().pushHistory('Mover capa')
  },

  nudgeLayer: (dx, dy) => {
    const state = get()
    const layer = getActiveLayer(state)
    if (!layer) return
    const tmp = cloneCanvasEl(layer.canvas)
    const ctx = layer.canvas.getContext('2d')!
    ctx.clearRect(0, 0, state.width, state.height)
    ctx.drawImage(tmp, dx, dy)
    set({ rev: state.rev + 1 })
    get().pushHistory('Mover capa')
  },

  clearActiveLayer: () => {
    get().deleteSelectionPixels()
  },

  // ---------- Pluma vectorial ----------
  penAddPoint: (p) => {
    const state = get()
    const path: PenPath = state.penPath ?? { points: [], closed: false }
    const point: PenPoint = { x: p.x, y: p.y, hIn: null, hOut: null }
    set({ penPath: { ...path, points: [...path.points, point] }, rev: state.rev + 1 })
  },

  penSetLastHandles: (hOut) => {
    const state = get()
    const path = state.penPath
    if (!path || path.points.length === 0) return
    const last = path.points[path.points.length - 1]
    const hIn = { x: last.x * 2 - hOut.x, y: last.y * 2 - hOut.y }
    const points = [...path.points]
    points[points.length - 1] = { ...last, hIn, hOut: { ...hOut } }
    set({ penPath: { ...path, points }, rev: state.rev + 1 })
  },

  penSetLastCorner: () => {
    const state = get()
    const path = state.penPath
    if (!path || path.points.length === 0) return
    const last = path.points[path.points.length - 1]
    if (!last.hIn && !last.hOut) return
    const points = [...path.points]
    points[points.length - 1] = { ...last, hIn: null, hOut: null }
    set({ penPath: { ...path, points }, rev: state.rev + 1 })
  },

  penClosePath: () => {
    const state = get()
    if (!state.penPath || state.penPath.points.length < 3) return
    set({ penPath: { ...state.penPath, closed: true }, rev: state.rev + 1 })
  },

  penClearPath: () => {
    const state = get()
    if (!state.penPath) return
    set({ penPath: null, rev: state.rev + 1 })
  },

  penCommitStroke: () => {
    const state = get()
    const path = state.penPath
    const layer = getActiveLayer(state)
    if (!path || path.points.length < 2 || !layer) return
    const p2d = penPathToPath2D(path)
    const tmp = createCanvasEl(state.width, state.height)
    const tctx = tmp.getContext('2d')!
    tctx.strokeStyle = state.foreground
    tctx.lineWidth = state.penStrokeWidth
    tctx.lineCap = 'round'
    tctx.lineJoin = 'round'
    tctx.stroke(p2d)
    if (state.selection) {
      tctx.globalCompositeOperation = 'destination-in'
      tctx.drawImage(state.selection.maskCanvas, 0, 0)
      tctx.globalCompositeOperation = 'source-over'
    }
    layer.canvas.getContext('2d')!.drawImage(tmp, 0, 0)
    set({ penPath: null, rev: state.rev + 1 })
    get().pushHistory('Trazar con pluma')
  },

  penCommitFill: () => {
    const state = get()
    const path = state.penPath
    const layer = getActiveLayer(state)
    if (!path || path.points.length < 3 || !layer) return
    const p2d = penPathToPath2D(path)
    const tmp = createCanvasEl(state.width, state.height)
    const tctx = tmp.getContext('2d')!
    tctx.fillStyle = state.foreground
    tctx.fill(p2d)
    if (state.selection) {
      tctx.globalCompositeOperation = 'destination-in'
      tctx.drawImage(state.selection.maskCanvas, 0, 0)
      tctx.globalCompositeOperation = 'source-over'
    }
    layer.canvas.getContext('2d')!.drawImage(tmp, 0, 0)
    set({ penPath: null, rev: state.rev + 1 })
    get().pushHistory('Rellenar trazado')
  },

  // ---------- Transformacion libre ----------
  enterTransform: () => {
    const state = get()
    if (state.transform || !state.width) return
    const layer = getActiveLayer(state)
    if (!layer) return
    const bounds = contentBounds(layer.canvas)
    if (!bounds) return
    const snapshot = cloneCanvasEl(layer.canvas)
    set({
      transform: {
        layerId: layer.id,
        orig: bounds,
        box: {
          cx: bounds.x + bounds.w / 2,
          cy: bounds.y + bounds.h / 2,
          w: bounds.w,
          h: bounds.h,
          rot: 0,
        },
        flipH: false,
        flipV: false,
        snapshot,
      },
      rev: state.rev + 1,
    })
  },

  updateTransformBox: (patch) => {
    const state = get()
    if (!state.transform) return
    set({
      transform: { ...state.transform, box: { ...state.transform.box, ...patch } },
      rev: state.rev + 1,
    })
  },

  toggleTransformFlip: (axis) => {
    const state = get()
    if (!state.transform) return
    set({
      transform:
        axis === 'h'
          ? { ...state.transform, flipH: !state.transform.flipH }
          : { ...state.transform, flipV: !state.transform.flipV },
      rev: state.rev + 1,
    })
  },

  commitTransform: () => {
    const state = get()
    const t = state.transform
    if (!t) return
    const layer = state.layers.find((l) => l.id === t.layerId)
    if (layer) {
      const out = createCanvasEl(state.width, state.height)
      const octx = out.getContext('2d')!
      octx.imageSmoothingEnabled = true
      octx.imageSmoothingQuality = 'high'
      const ocx = t.orig.x + t.orig.w / 2
      const ocy = t.orig.y + t.orig.h / 2
      const sx = (t.box.w / Math.max(1, t.orig.w)) * (t.flipH ? -1 : 1)
      const sy = (t.box.h / Math.max(1, t.orig.h)) * (t.flipV ? -1 : 1)
      octx.translate(t.box.cx, t.box.cy)
      octx.rotate(t.box.rot)
      octx.scale(sx, sy)
      octx.translate(-ocx, -ocy)
      octx.drawImage(t.snapshot, 0, 0)
      const ctx = layer.canvas.getContext('2d')!
      ctx.clearRect(0, 0, state.width, state.height)
      ctx.drawImage(out, 0, 0)
    }
    set({ transform: null, rev: state.rev + 1 })
    get().pushHistory('Transformacion libre')
  },

  cancelTransform: () => {
    const state = get()
    const t = state.transform
    if (!t) return
    const layer = state.layers.find((l) => l.id === t.layerId)
    if (layer) {
      const ctx = layer.canvas.getContext('2d')!
      ctx.clearRect(0, 0, state.width, state.height)
      ctx.drawImage(t.snapshot, 0, 0)
    }
    set({ transform: null, rev: state.rev + 1 })
  },

  // ---------- Ajustes directos e IA ----------
  applyAdjustmentToLayer: (label, adj) => {
    const state = get()
    const layer = getActiveLayer(state)
    if (!layer) return
    const filtered = cloneCanvasEl(layer.canvas)
    applyAdjustmentPixels(filtered, adj)
    const ctx = layer.canvas.getContext('2d')!
    if (state.selection) {
      const fctx = filtered.getContext('2d')!
      fctx.globalCompositeOperation = 'destination-in'
      fctx.drawImage(state.selection.maskCanvas, 0, 0)
      fctx.globalCompositeOperation = 'source-over'
      ctx.drawImage(filtered, 0, 0)
    } else {
      ctx.clearRect(0, 0, state.width, state.height)
      ctx.drawImage(filtered, 0, 0)
    }
    set({ rev: state.rev + 1 })
    get().pushHistory(label)
  },

  applyInpaint: (opts) => {
    const state = get()
    if (!state.selection) return
    const layer = getActiveLayer(state)
    if (!layer) return
    const comp = get().renderComposite()
    const filled = cloneCanvasEl(comp)
    inpaintCanvas(filled, state.selection.mask, opts)
    // transferencia por diferencia: capa + (relleno - composicion)
    const lc = layer.canvas.getContext('2d')!
    const li = lc.getImageData(0, 0, state.width, state.height)
    const ci = comp.getContext('2d')!.getImageData(0, 0, state.width, state.height)
    const fi = filled.getContext('2d')!.getImageData(0, 0, state.width, state.height)
    const mask = state.selection.mask
    for (let p = 0; p < state.width * state.height; p++) {
      if (mask[p] === 0) continue
      const i = p * 4
      for (let c = 0; c < 3; c++) {
        li.data[i + c] = Math.max(0, Math.min(255, li.data[i + c] + (fi.data[i + c] - ci.data[i + c])))
      }
      li.data[i + 3] = Math.max(li.data[i + 3], fi.data[i + 3])
    }
    lc.putImageData(li, 0, 0)
    set({ rev: state.rev + 1 })
    get().pushHistory('Relleno segun contenido (IA)')
  },

  // Inpainting neuronal LaMa: elimina texto y marcas de agua reconstruyendo
  // la zona con el modelo big-lama (WebGPU con respaldo WASM, 100% local).
  applyInpaintNeural: async (onProgress) => {
    const state = get()
    if (!state.selection) return false
    const layer = getActiveLayer(state)
    if (!layer) return false
    const comp = get().renderComposite()
    const filled = cloneCanvasEl(comp)
    const ok = await lamaInpaint(filled, state.selection.mask, (p) => onProgress?.(p))
    if (!ok) return false
    // transferencia por diferencia: capa + (relleno - composicion), identica
    // al motor clasico para respetar la opacidad y el modo de fusion de la capa
    const lc = layer.canvas.getContext('2d')!
    const li = lc.getImageData(0, 0, state.width, state.height)
    const ci = comp.getContext('2d')!.getImageData(0, 0, state.width, state.height)
    const fi = filled.getContext('2d')!.getImageData(0, 0, state.width, state.height)
    const mask = state.selection.mask
    for (let p = 0; p < state.width * state.height; p++) {
      if (mask[p] === 0) continue
      const i = p * 4
      for (let c = 0; c < 3; c++) {
        li.data[i + c] = Math.max(0, Math.min(255, li.data[i + c] + (fi.data[i + c] - ci.data[i + c])))
      }
      li.data[i + 3] = Math.max(li.data[i + 3], fi.data[i + 3])
    }
    lc.putImageData(li, 0, 0)
    set({ rev: state.rev + 1 })
    get().pushHistory('Eliminacion IA neuronal (LaMa)')
    return true
  },

  applyAutoEnhance: () => {
    const state = get()
    const layer = getActiveLayer(state)
    if (!layer) return
    if (state.selection) {
      const tmp = cloneCanvasEl(layer.canvas)
      autoEnhance(tmp)
      const tctx = tmp.getContext('2d')!
      tctx.globalCompositeOperation = 'destination-in'
      tctx.drawImage(state.selection.maskCanvas, 0, 0)
      tctx.globalCompositeOperation = 'source-over'
      layer.canvas.getContext('2d')!.drawImage(tmp, 0, 0)
    } else {
      autoEnhance(layer.canvas)
    }
    set({ rev: state.rev + 1 })
    get().pushHistory('Mejora automatica (IA)')
  },

  editAdjustmentLayer: (id) => {
    const l = get().layers.find((x) => x.id === id)
    if (!l || !l.adjustment) return
    if (l.adjustment.type === 'curves' || l.adjustment.type === 'levels') {
      set({ editingAdjustmentId: id, dialog: l.adjustment.type, activeLayerId: id })
    } else {
      set({ activeLayerId: id })
    }
  },

  // ---------- Documento: transformaciones ----------
  resizeImage: (w, h) => {
    const state = get()
    if (w < 1 || h < 1) return
    const layers = state.layers.map((l) => {
      const c = createCanvasEl(w, h)
      const ctx = c.getContext('2d')!
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(l.canvas, 0, 0, l.canvas.width, l.canvas.height, 0, 0, w, h)
      return { ...l, canvas: c }
    })
    set({ width: w, height: h, layers, selection: null, rev: state.rev + 1, fitRequest: state.fitRequest + 1 })
    get().pushHistory('Tamano de imagen')
  },

  resizeCanvas: (w, h, anchor) => {
    const state = get()
    if (w < 1 || h < 1) return
    let dx = Math.round((w - state.width) / 2)
    let dy = Math.round((h - state.height) / 2)
    if (anchor.includes('left')) dx = 0
    if (anchor.includes('right')) dx = w - state.width
    if (anchor.startsWith('top')) dy = 0
    if (anchor.startsWith('bottom')) dy = h - state.height
    const layers = state.layers.map((l) => {
      const c = createCanvasEl(w, h)
      c.getContext('2d')!.drawImage(l.canvas, dx, dy)
      return { ...l, canvas: c }
    })
    set({ width: w, height: h, layers, selection: null, rev: state.rev + 1, fitRequest: state.fitRequest + 1 })
    get().pushHistory('Tamano de lienzo')
  },

  rotateDoc: (dir) => {
    const state = get()
    const w = state.height
    const h = state.width
    const layers = state.layers.map((l) => {
      const c = createCanvasEl(w, h)
      const ctx = c.getContext('2d')!
      ctx.translate(w / 2, h / 2)
      ctx.rotate(dir === 'cw' ? Math.PI / 2 : -Math.PI / 2)
      ctx.drawImage(l.canvas, -l.canvas.width / 2, -l.canvas.height / 2)
      return { ...l, canvas: c }
    })
    set({ width: w, height: h, layers, selection: null, rev: state.rev + 1, fitRequest: state.fitRequest + 1 })
    get().pushHistory(dir === 'cw' ? 'Rotar 90 CW' : 'Rotar 90 CCW')
  },

  flipDoc: (axis) => {
    const state = get()
    const layers = state.layers.map((l) => {
      const c = createCanvasEl(state.width, state.height)
      const ctx = c.getContext('2d')!
      ctx.translate(axis === 'h' ? state.width : 0, axis === 'v' ? state.height : 0)
      ctx.scale(axis === 'h' ? -1 : 1, axis === 'v' ? -1 : 1)
      ctx.drawImage(l.canvas, 0, 0)
      return { ...l, canvas: c }
    })
    set({ layers, rev: state.rev + 1 })
    get().pushHistory(axis === 'h' ? 'Voltear horizontal' : 'Voltear vertical')
  },

  cropToRect: (rect) => {
    const state = get()
    const x = Math.max(0, Math.round(rect.x))
    const y = Math.max(0, Math.round(rect.y))
    const w = Math.max(1, Math.round(Math.min(rect.w, state.width - x)))
    const h = Math.max(1, Math.round(Math.min(rect.h, state.height - y)))
    const layers = state.layers.map((l) => {
      const c = createCanvasEl(w, h)
      c.getContext('2d')!.drawImage(l.canvas, -x, -y)
      return { ...l, canvas: c }
    })
    set({ width: w, height: h, layers, selection: null, cropRect: null, rev: state.rev + 1, fitRequest: state.fitRequest + 1 })
    get().pushHistory('Recortar')
  },

  setCropRect: (rect) => set({ cropRect: rect }),

  // ---------- Exportar ----------
  renderComposite: () => {
    const state = get()
    const out = createCanvasEl(state.width, state.height)
    compositeLayers(out.getContext('2d')!, state.layers, state.width, state.height)
    return out
  },

  exportImage: (format, quality, name) => {
    const composite = get().renderComposite()
    let final = composite
    if (format === 'jpeg') {
      final = createCanvasEl(composite.width, composite.height)
      const ctx = final.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, final.width, final.height)
      ctx.drawImage(composite, 0, 0)
    }
    const dataUrl = final.toDataURL(format === 'png' ? 'image/png' : 'image/jpeg', quality)
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${name || 'vortex-editor'}.${format === 'png' ? 'png' : 'jpg'}`
    a.click()
  },

  // ---------- Proyectos: biblioteca en la nube + archivo .vortex.json ----------
  saveProjectToCloud: async () => {
    const st = get()
    if (!st.width || !st.layers.length) {
      toast({ title: 'Nada que guardar', description: 'Abre o crea un documento primero.', variant: 'destructive' })
      return false
    }
    set({ cloudBusy: true })
    try {
      const project = serializeProject(st.docName, st.width, st.height, st.activeLayerId, st.layers)
      const payload = {
        name: project.name,
        width: project.width,
        height: project.height,
        thumbnail: makeThumbnail(get().renderComposite()),
        data: JSON.stringify(project),
      }
      if (st.projectId) {
        const res = await fetch(`/api/projects/${st.projectId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(j?.error ?? 'No se pudo actualizar el proyecto')
        }
        toast({ title: 'Proyecto actualizado', description: `"${project.name}" se guardo en tu biblioteca.` })
      } else {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(j?.error ?? 'No se pudo guardar el proyecto')
        }
        const j = (await res.json()) as { project?: { id: string } }
        set({ projectId: j.project?.id ?? null })
        toast({ title: 'Proyecto guardado', description: `"${project.name}" ya esta en tu biblioteca en la nube.` })
      }
      return true
    } catch (err) {
      toast({ title: 'Error al guardar', description: projectErrorMessage(err, 'Intenta de nuevo.'), variant: 'destructive' })
      return false
    } finally {
      set({ cloudBusy: false })
    }
  },

  loadProjectFromCloud: async (id) => {
    set({ cloudBusy: true })
    try {
      const res = await fetch(`/api/projects/${id}`)
      if (!res.ok) throw new Error('No se encontro el proyecto en la biblioteca')
      const j = (await res.json()) as { project?: { id: string; name: string; data: string } }
      if (!j.project) throw new Error('No se encontro el proyecto en la biblioteca')
      const raw: unknown = JSON.parse(j.project.data)
      const ok = await get().loadFromSerialized(raw)
      if (ok) set({ projectId: id })
      return ok
    } catch (err) {
      toast({ title: 'Error al abrir el proyecto', description: projectErrorMessage(err, 'Intenta de nuevo.'), variant: 'destructive' })
      return false
    } finally {
      set({ cloudBusy: false })
    }
  },

  loadFromSerialized: async (raw) => {
    try {
      const p = await deserializeProject(raw)
      const state = get()
      set({
        docName: p.name,
        width: p.width,
        height: p.height,
        layers: p.layers,
        activeLayerId: p.activeLayerId,
        selection: null,
        cropRect: null,
        transform: null,
        penPath: null,
        history: [
          {
            label: 'Proyecto abierto',
            width: p.width,
            height: p.height,
            activeLayerId: p.activeLayerId,
            layers: snapshotLayers(p.layers),
          },
        ],
        historyIndex: 0,
        rev: state.rev + 1,
        fitRequest: state.fitRequest + 1,
      })
      toast({ title: 'Proyecto abierto', description: `"${p.name}" (${p.width} x ${p.height} px)` })
      return true
    } catch (err) {
      toast({ title: 'Archivo invalido', description: projectErrorMessage(err, 'El proyecto no se puede abrir.'), variant: 'destructive' })
      return false
    }
  },

  exportProjectFile: () => {
    const st = get()
    if (!st.width || !st.layers.length) {
      toast({ title: 'Nada que exportar', description: 'Abre o crea un documento primero.', variant: 'destructive' })
      return
    }
    const project = serializeProject(st.docName, st.width, st.height, st.activeLayerId, st.layers)
    downloadProjectFile(project)
    toast({ title: 'Proyecto exportado', description: `"${project.name}${'.vortex.json'}" descargado con todas sus capas y ajustes.` })
  },

  importProjectFile: async (file) => {
    try {
      const text = await file.text()
      const raw: unknown = JSON.parse(text)
      const ok = await get().loadFromSerialized(raw)
      if (ok) set({ projectId: null }) // el archivo local es independiente de la nube
      return ok
    } catch {
      toast({ title: 'Archivo invalido', description: 'No es un proyecto de Vórtex Editor (.vortex.json).', variant: 'destructive' })
      return false
    }
  },

  setDialog: (d) => set({ dialog: d }),

  // ---------- Vista ----------
  setView: (zoom, panX, panY) => set({ zoom, panX, panY }),

  requestFit: () => set({ fitRequest: get().fitRequest + 1 }),

  setCursorPos: (p) => set({ cursorPos: p }),
}))

export { hexToRgb }
