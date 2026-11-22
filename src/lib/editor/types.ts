export type ToolId =
  | 'move'
  | 'rect-select'
  | 'ellipse-select'
  | 'lasso'
  | 'wand'
  | 'mask-brush'
  | 'crop'
  | 'eyedropper'
  | 'brush'
  | 'pencil'
  | 'mixer'
  | 'eraser'
  | 'fill'
  | 'gradient'
  | 'pen'
  | 'heal'
  | 'clone'
  | 'dodge'
  | 'burn'
  | 'blur-brush'
  | 'sharpen-brush'
  | 'text'
  | 'shape-rect'
  | 'shape-ellipse'
  | 'shape-line'
  | 'hand'
  | 'zoom'

export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'

export interface BlendModeOption {
  value: BlendMode
  label: string
}

export const BLEND_MODES: BlendModeOption[] = [
  { value: 'source-over', label: 'Normal' },
  { value: 'multiply', label: 'Multiplicar' },
  { value: 'screen', label: 'Trama' },
  { value: 'overlay', label: 'Superponer' },
  { value: 'darken', label: 'Oscurecer' },
  { value: 'lighten', label: 'Aclarar' },
  { value: 'color-dodge', label: 'Sobreexponer color' },
  { value: 'color-burn', label: 'Subexponer color' },
  { value: 'hard-light', label: 'Luz fuerte' },
  { value: 'soft-light', label: 'Luz suave' },
  { value: 'difference', label: 'Diferencia' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Tono' },
  { value: 'saturation', label: 'Saturacion' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosidad' },
]

// ---------- Capas de ajuste (no destructivas) ----------

export type AdjustmentType =
  | 'brightness-contrast'
  | 'hue-saturation'
  | 'curves'
  | 'levels'
  | 'grayscale'
  | 'invert'
  | 'sepia'
  | 'color-balance'
  | 'vibrance'

/** Punto de la curva en coordenadas de entrada/salida 0-255 */
export interface CurvePoint {
  x: number
  y: number
}

/** Curvas por canal compuesto y canales individuales */
export interface CurveSet {
  rgb: CurvePoint[]
  r: CurvePoint[]
  g: CurvePoint[]
  b: CurvePoint[]
}

export function identityCurve(): CurvePoint[] {
  return [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ]
}

export function identityCurveSet(): CurveSet {
  return { rgb: identityCurve(), r: identityCurve(), g: identityCurve(), b: identityCurve() }
}

/** Copia profunda de un conjunto de curvas (evita referencias compartidas) */
export function cloneCurveSet(cs: CurveSet): CurveSet {
  const cp = (pts: CurvePoint[]) => pts.map((p) => ({ x: p.x, y: p.y }))
  return { rgb: cp(cs.rgb), r: cp(cs.r), g: cp(cs.g), b: cp(cs.b) }
}

/** Desplazamiento de color por canal (-100 - 100) para una franja tonal */
export interface BalanceChannel {
  r: number
  g: number
  b: number
}

/** Balance de color por franjas tonales (sombras / medios / luces) */
export interface ColorBalanceParams {
  shadows: BalanceChannel
  midtones: BalanceChannel
  highlights: BalanceChannel
}

export function identityColorBalance(): ColorBalanceParams {
  const zero = (): BalanceChannel => ({ r: 0, g: 0, b: 0 })
  return { shadows: zero(), midtones: zero(), highlights: zero() }
}

export function cloneColorBalance(cb: ColorBalanceParams): ColorBalanceParams {
  return {
    shadows: { ...cb.shadows },
    midtones: { ...cb.midtones },
    highlights: { ...cb.highlights },
  }
}

export interface AdjustmentParams {
  brightness: number // 0 - 200 (100 = neutro)
  contrast: number // 0 - 200
  hue: number // -180 - 180
  saturation: number // 0 - 200 (100 = neutro)
  lightness: number // 0 - 200
  sepiaAmount: number // 0 - 100
  curves: CurveSet // solo usado por el ajuste 'curves'
  levels: { black: number; white: number; gamma: number } // solo 'levels'
  colorBalance: ColorBalanceParams // solo 'color-balance'
  vibrance: number // -100 - 100, solo 'vibrance'
}

export const DEFAULT_ADJUSTMENT_PARAMS: AdjustmentParams = {
  brightness: 100,
  contrast: 100,
  hue: 0,
  saturation: 100,
  lightness: 100,
  sepiaAmount: 100,
  curves: identityCurveSet(),
  levels: { black: 0, white: 255, gamma: 1 },
  colorBalance: identityColorBalance(),
  vibrance: 0,
}

/** tipos de ajuste que requieren procesado por pixel (no expresables como filtro CSS) */
const PIXEL_ADJUSTMENTS: readonly AdjustmentType[] = ['curves', 'levels', 'color-balance', 'vibrance']

export function isPixelAdjustment(type: AdjustmentType): boolean {
  return PIXEL_ADJUSTMENTS.includes(type)
}

export interface Adjustment {
  type: AdjustmentType
  params: AdjustmentParams
}

export const ADJUSTMENT_LABELS: Record<AdjustmentType, string> = {
  'brightness-contrast': 'Brillo y contraste',
  'hue-saturation': 'Tono y saturacion',
  curves: 'Curvas',
  levels: 'Niveles',
  grayscale: 'Blanco y negro',
  invert: 'Invertir colores',
  sepia: 'Sepia',
  'color-balance': 'Balance de color',
  vibrance: 'Intensidad (Vibrance)',
}

/** Traduce los parametros de una capa de ajuste a un filtro CSS de Canvas */
export function adjustmentToFilter(adj: Adjustment): string {
  const p = adj.params
  switch (adj.type) {
    case 'brightness-contrast':
      return `brightness(${p.brightness}%) contrast(${p.contrast}%)`
    case 'hue-saturation':
      return `hue-rotate(${p.hue}deg) saturate(${p.saturation}%) brightness(${p.lightness}%)`
    case 'grayscale':
      return 'grayscale(1)'
    case 'invert':
      return 'invert(1)'
    case 'sepia':
      return `sepia(${p.sepiaAmount}%)`
    // los ajustes por pixel (curvas, niveles, balance de color, vibrance)
    // nunca llegan aqui: se procesan por LUT en adjustments.ts
    case 'curves':
    case 'levels':
    case 'color-balance':
    case 'vibrance':
      return 'none'
  }
}

// ---------- Capas ----------

export interface Layer {
  id: string
  name: string
  visible: boolean
  opacity: number // 0 - 100
  blendMode: BlendMode
  canvas: HTMLCanvasElement
  /** pixel = capa de imagen; adjustment = capa de ajuste (sin pixeles propios) */
  kind: 'pixel' | 'adjustment'
  adjustment: Adjustment | null
}

export interface SerializedLayer {
  id: string
  name: string
  visible: boolean
  opacity: number
  blendMode: BlendMode
  canvas: HTMLCanvasElement
  kind: 'pixel' | 'adjustment'
  adjustment: Adjustment | null
}

export interface HistoryEntry {
  label: string
  width: number
  height: number
  activeLayerId: string | null
  layers: SerializedLayer[]
}

export interface Selection {
  kind: 'rect' | 'ellipse' | 'lasso' | 'wand' | 'invert' | 'brush'
  path: Path2D
  bounds: { x: number; y: number; w: number; h: number }
  /** mascara de bytes por pixel (255 dentro, 0 fuera) para operaciones rapidas */
  mask: Uint8ClampedArray
  /** la misma mascara como canvas blanco (para composicion destination-in/out) */
  maskCanvas: HTMLCanvasElement
  /** contorno de 1 px de la mascara (para selecciones complejas) */
  edgeCanvas: HTMLCanvasElement | null
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type DialogId =
  | 'new-doc'
  | 'image-size'
  | 'canvas-size'
  | 'brightness-contrast'
  | 'hue-saturation'
  | 'curves'
  | 'levels'
  | 'color-balance'
  | 'vibrance'
  | 'blur'
  | 'pixelate'
  | 'noise'
  | 'inpaint'
  | 'export'
  | 'projects'
  | 'about'
  | 'privacy'
  | 'terms'
  | null

export type Anchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export interface Point {
  x: number
  y: number
}

// ---------- Pluma vectorial ----------

/** Ancla de la pluma: punto + tiradores de curva bezier (opcionales) */
export interface PenPoint {
  x: number
  y: number
  hIn: Point | null
  hOut: Point | null
}

/** Trazado de trabajo de la pluma */
export interface PenPath {
  points: PenPoint[]
  closed: boolean
}

/** Convierte el trazado de la pluma en un Path2D con segmentos bezier */
export function penPathToPath2D(pp: PenPath): Path2D {
  const path = new Path2D()
  const pts = pp.points
  if (pts.length === 0) return path
  path.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const cur = pts[i]
    const c1 = prev.hOut ?? { x: prev.x, y: prev.y }
    const c2 = cur.hIn ?? { x: cur.x, y: cur.y }
    path.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, cur.x, cur.y)
  }
  if (pp.closed && pts.length > 1) {
    const last = pts[pts.length - 1]
    const first = pts[0]
    const c1 = last.hOut ?? { x: last.x, y: last.y }
    const c2 = first.hIn ?? { x: first.x, y: first.y }
    path.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, first.x, first.y)
    path.closePath()
  }
  return path
}

// ---------- Transformacion libre ----------

/** Caja actual de la transformacion: centro, dimensiones y rotacion en radianes */
export interface TransformBox {
  cx: number
  cy: number
  w: number
  h: number
  rot: number
}

export interface TransformState {
  layerId: string
  /** bbox del contenido original en coordenadas de documento */
  orig: Rect
  box: TransformBox
  flipH: boolean
  flipV: boolean
  /** copia de seguridad del contenido original de la capa */
  snapshot: HTMLCanvasElement
}
