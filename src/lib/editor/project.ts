// Serializacion del documento completo de Vórtex Editor.
// Un proyecto contiene todas las capas (pixeles como PNG base64) y sus
// capas de ajuste con los parametros exactos. Formato propio ".vortex.json"
// compatible con la nube (base de datos) y con archivos locales.

import type { Adjustment, AdjustmentParams, BlendMode, CurvePoint, Layer } from './types'
import {
  ADJUSTMENT_LABELS,
  DEFAULT_ADJUSTMENT_PARAMS,
  identityColorBalance,
  identityCurveSet,
} from './types'
import { createCanvasEl } from './filters'

export const PROJECT_FORMAT = 'vortex-editor'
export const PROJECT_VERSION = 1
export const PROJECT_EXT = '.vortex.json'

export interface ProjectLayer {
  id: string
  name: string
  visible: boolean
  opacity: number
  blendMode: BlendMode
  kind: 'pixel' | 'adjustment'
  adjustment: Adjustment | null
  /** PNG base64 del contenido de la capa; null en capas de ajuste */
  data: string | null
}

export interface SerializedProject {
  app: string
  product: string
  version: number
  name: string
  width: number
  height: number
  activeLayerId: string | null
  layers: ProjectLayer[]
  savedAt: string
}

/** Miniatura PNG para la lista de proyectos (max 320 px) */
export function makeThumbnail(src: HTMLCanvasElement, max = 320): string {
  const ratio = src.width / Math.max(1, src.height)
  const w = ratio >= 1 ? max : Math.max(1, Math.round(max * ratio))
  const h = ratio >= 1 ? Math.max(1, Math.round(max / ratio)) : max
  const t = createCanvasEl(w, h)
  const ctx = t.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, w, h)
  return t.toDataURL('image/png')
}

/** Serializa el documento actual a formato de proyecto (JSON-safe) */
export function serializeProject(
  name: string,
  width: number,
  height: number,
  activeLayerId: string | null,
  layers: Layer[]
): SerializedProject {
  return {
    app: PROJECT_FORMAT,
    product: 'Vórtex Editor',
    version: PROJECT_VERSION,
    name,
    width,
    height,
    activeLayerId,
    layers: layers.map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      blendMode: l.blendMode,
      kind: l.kind,
      adjustment: l.adjustment ? cloneAdjustment(l.adjustment) : null,
      data: l.kind === 'pixel' ? l.canvas.toDataURL('image/png') : null,
    })),
    savedAt: new Date().toISOString(),
  }
}

/** Copia profunda JSON-safe de un ajuste */
export function cloneAdjustment(adj: Adjustment): Adjustment {
  const cp = (pts: CurvePoint[]) => pts.map((p) => ({ x: p.x, y: p.y }))
  const cs = adj.params.curves
  return {
    type: adj.type,
    params: {
      ...adj.params,
      curves: { rgb: cp(cs.rgb), r: cp(cs.r), g: cp(cs.g), b: cp(cs.b) },
      levels: { ...adj.params.levels },
      colorBalance: {
        shadows: { ...adj.params.colorBalance.shadows },
        midtones: { ...adj.params.colorBalance.midtones },
        highlights: { ...adj.params.colorBalance.highlights },
      },
    },
  }
}

// ---------- Validacion / saneado ----------

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length ? v : fallback
}

function sanitizeCurvePoints(v: unknown, fallback: CurvePoint[]): CurvePoint[] {
  if (!Array.isArray(v)) return fallback
  const pts = v
    .filter((p) => p && typeof p.x === 'number' && typeof p.y === 'number')
    .map((p) => ({ x: p.x as number, y: p.y as number }))
  return pts.length >= 2 ? pts : fallback
}

/** Garantiza que un ajuste recibido (BD / archivo) sea valido y completo */
export function sanitizeAdjustment(raw: unknown): Adjustment | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { type?: unknown; params?: unknown }
  const type = str(r.type, '')
  if (!(type in ADJUSTMENT_LABELS)) return null
  const p = (r.params ?? {}) as Record<string, unknown>
  const d = DEFAULT_ADJUSTMENT_PARAMS
  const curvesRaw = (p.curves ?? {}) as Record<string, unknown>
  const levelsRaw = (p.levels ?? {}) as Record<string, unknown>
  const cbRaw = (p.colorBalance ?? {}) as Record<string, unknown>
  const channel = (v: unknown) => {
    const c = (v ?? {}) as Record<string, unknown>
    return {
      r: num(c.r, 0, -100, 100),
      g: num(c.g, 0, -100, 100),
      b: num(c.b, 0, -100, 100),
    }
  }
  const params: AdjustmentParams = {
    brightness: num(p.brightness, d.brightness, 0, 200),
    contrast: num(p.contrast, d.contrast, 0, 200),
    hue: num(p.hue, d.hue, -180, 180),
    saturation: num(p.saturation, d.saturation, 0, 200),
    lightness: num(p.lightness, d.lightness, 0, 200),
    sepiaAmount: num(p.sepiaAmount, d.sepiaAmount, 0, 100),
    curves: {
      rgb: sanitizeCurvePoints(curvesRaw.rgb, identityCurveSet().rgb),
      r: sanitizeCurvePoints(curvesRaw.r, identityCurveSet().r),
      g: sanitizeCurvePoints(curvesRaw.g, identityCurveSet().g),
      b: sanitizeCurvePoints(curvesRaw.b, identityCurveSet().b),
    },
    levels: {
      black: num(levelsRaw.black, 0, 0, 254),
      white: num(levelsRaw.white, 255, 1, 255),
      gamma: num(levelsRaw.gamma, 1, 0.05, 10),
    },
    colorBalance: {
      shadows: channel(cbRaw.shadows ?? identityColorBalance().shadows),
      midtones: channel(cbRaw.midtones ?? identityColorBalance().midtones),
      highlights: channel(cbRaw.highlights ?? identityColorBalance().highlights),
    },
    vibrance: num(p.vibrance, d.vibrance, -100, 100),
  }
  return { type: type as Adjustment['type'], params }
}

// ---------- Deserializacion ----------

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Capa con datos de imagen invalidos'))
    img.src = dataUrl
  })
}

export interface LoadedProject {
  name: string
  width: number
  height: number
  activeLayerId: string | null
  layers: Layer[]
}

/**
 * Reconstruye un proyecto serializado en capas vivas de canvas.
 * Rechaza archivos de otra aplicacion o corruptos.
 */
export async function deserializeProject(raw: unknown): Promise<LoadedProject> {
  if (!raw || typeof raw !== 'object') throw new Error('Archivo de proyecto invalido')
  const p = raw as Partial<SerializedProject>
  if (p.app !== PROJECT_FORMAT) {
    throw new Error('Este archivo no pertenece a Vórtex Editor')
  }
  const width = Math.round(num(p.width, 0, 1, 16384))
  const height = Math.round(num(p.height, 0, 1, 16384))
  if (!width || !height) throw new Error('El proyecto no tiene dimensiones validas')
  if (!Array.isArray(p.layers) || p.layers.length === 0) {
    throw new Error('El proyecto no contiene capas')
  }

  const layers: Layer[] = []
  for (const rl of p.layers as unknown[]) {
    if (!rl || typeof rl !== 'object') continue
    const l = rl as Record<string, unknown>
    const kind = l.kind === 'adjustment' ? 'adjustment' : 'pixel'
    const adjustment = sanitizeAdjustment(l.adjustment)
    if (kind === 'adjustment') {
      if (!adjustment) continue
      layers.push({
        id: str(l.id, `layer-${layers.length}`),
        name: str(l.name, ADJUSTMENT_LABELS[adjustment.type]),
        visible: bool(l.visible, true),
        opacity: num(l.opacity, 100, 0, 100),
        blendMode: str(l.blendMode, 'source-over') as BlendMode,
        canvas: createCanvasEl(1, 1),
        kind: 'adjustment',
        adjustment,
      })
      continue
    }
    const data = typeof l.data === 'string' && l.data.startsWith('data:image/') ? l.data : null
    if (!data) continue
    const img = await loadImage(data)
    const canvas = createCanvasEl(width, height)
    canvas.getContext('2d')!.drawImage(img, 0, 0)
    layers.push({
      id: str(l.id, `layer-${layers.length}`),
      name: str(l.name, 'Capa'),
      visible: bool(l.visible, true),
      opacity: num(l.opacity, 100, 0, 100),
      blendMode: str(l.blendMode, 'source-over') as BlendMode,
      canvas,
      kind: 'pixel',
      adjustment: null,
    })
  }
  if (!layers.length) throw new Error('El proyecto no contiene capas de imagen validas')

  const activeId =
    typeof p.activeLayerId === 'string' && layers.some((l) => l.id === p.activeLayerId)
      ? (p.activeLayerId as string)
      : layers[layers.length - 1].id

  return {
    name: str(p.name, 'Proyecto Vórtex'),
    width,
    height,
    activeLayerId: activeId,
    layers,
  }
}

/** Descarga el proyecto como archivo .vortex.json */
export function downloadProjectFile(project: SerializedProject): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const safe = (project.name || 'proyecto').replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '').trim() || 'proyecto'
  a.download = `${safe}${PROJECT_EXT}`
  a.click()
  URL.revokeObjectURL(url)
}
