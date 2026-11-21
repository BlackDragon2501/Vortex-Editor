// Motor de ajustes por LUT: curvas con interpolacion cubica monotona,
// niveles, balance de color por franjas tonales y vibrance.
// Implementacion propia sobre Canvas 2D.

import type { Adjustment, ColorBalanceParams, CurvePoint, CurveSet } from './types'
import { isPixelAdjustment } from './types'

/**
 * Interpolacion cubica monotona (Fritsch-Carlson) sobre puntos ordenados.
 * Garantiza que la curva no oscile por encima/debajo de los puntos de control.
 */
function monotoneSlopes(pts: CurvePoint[]): number[] {
  const n = pts.length
  const delta: number[] = []
  const m: number[] = new Array(n)
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x
    delta.push(dx === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx)
  }
  m[0] = delta[0]
  m[n - 1] = delta[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) {
      m[i] = 0
    } else {
      const wx = (delta[i - 1] * (pts[i + 1].x - pts[i].x) + delta[i] * (pts[i].x - pts[i - 1].x)) / (pts[i + 1].x - pts[i - 1].x)
      m[i] = wx
    }
  }
  // limita las tangentes para preservar la monotonia
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / delta[i]
    const b = m[i + 1] / delta[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * delta[i]
      m[i + 1] = t * b * delta[i]
    }
  }
  return m
}

/** Construye una LUT de 256 entradas a partir de los puntos de la curva */
export function buildLUT(points: CurvePoint[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256)
  const pts = [...points].sort((a, b) => a.x - b.x)
  // elimina duplicados de x
  const clean: CurvePoint[] = []
  for (const p of pts) {
    if (clean.length && clean[clean.length - 1].x === p.x) clean[clean.length - 1] = p
    else clean.push(p)
  }
  if (clean.length === 0) {
    for (let v = 0; v < 256; v++) lut[v] = v
    return lut
  }
  if (clean.length === 1) {
    for (let v = 0; v < 256; v++) lut[v] = clean[0].y
    return lut
  }
  const m = monotoneSlopes(clean)
  let seg = 0
  for (let v = 0; v < 256; v++) {
    // localiza el segmento
    while (seg < clean.length - 2 && v > clean[seg + 1].x) seg++
    while (seg > 0 && v < clean[seg].x) seg--
    const p0 = clean[seg]
    const p1 = clean[seg + 1]
    const h = p1.x - p0.x
    const t = h === 0 ? 0 : Math.max(0, Math.min(1, (v - p0.x) / h))
    const h00 = 2 * t * t * t - 3 * t * t + 1
    const h10 = t * t * t - 2 * t * t + t
    const h01 = -2 * t * t * t + 3 * t * t
    const h11 = t * t * t - t * t
    const y = h00 * p0.y + h10 * h * m[seg] + h01 * p1.y + h11 * h * m[seg + 1]
    lut[v] = Math.max(0, Math.min(255, Math.round(y)))
  }
  return lut
}

/** Detecta si una curva es la diagonal identidad */
export function isIdentityCurve(points: CurvePoint[]): boolean {
  if (points.length !== 2) return false
  const [a, b] = [...points].sort((p, q) => p.x - q.x)
  return a.x === 0 && a.y === 0 && b.x === 255 && b.y === 255
}

/** LUT de niveles: remapeo [black, white] con correccion gamma */
export function levelsLUT(black: number, white: number, gamma: number): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256)
  const b = Math.max(0, Math.min(254, black))
  const w = Math.max(b + 1, Math.min(255, white))
  const invG = 1 / Math.max(0.05, gamma)
  const range = w - b
  for (let v = 0; v < 256; v++) {
    const t = Math.max(0, Math.min(1, (v - b) / range))
    lut[v] = Math.round(Math.pow(t, invG) * 255)
  }
  return lut
}

interface CurvesLuts {
  rgb: Uint8ClampedArray | null
  r: Uint8ClampedArray | null
  g: Uint8ClampedArray | null
  b: Uint8ClampedArray | null
}

function curvesToLuts(curves: CurveSet): CurvesLuts {
  return {
    rgb: isIdentityCurve(curves.rgb) ? null : buildLUT(curves.rgb),
    r: isIdentityCurve(curves.r) ? null : buildLUT(curves.r),
    g: isIdentityCurve(curves.g) ? null : buildLUT(curves.g),
    b: isIdentityCurve(curves.b) ? null : buildLUT(curves.b),
  }
}

/** Aplica curvas por canal (RGB compuesto + R/G/B) in-place */
export function applyCurvesAdjust(src: HTMLCanvasElement, curves: CurveSet): void {
  const luts = curvesToLuts(curves)
  if (!luts.rgb && !luts.r && !luts.g && !luts.b) return
  const ctx = src.getContext('2d')!
  const img = ctx.getImageData(0, 0, src.width, src.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    let r = d[i]
    let g = d[i + 1]
    let b = d[i + 2]
    if (luts.r) r = luts.r[r]
    if (luts.g) g = luts.g[g]
    if (luts.b) b = luts.b[b]
    if (luts.rgb) {
      r = luts.rgb[r]
      g = luts.rgb[g]
      b = luts.rgb[b]
    }
    d[i] = r
    d[i + 1] = g
    d[i + 2] = b
  }
  ctx.putImageData(img, 0, 0)
}

/** Aplica niveles in-place */
export function applyLevelsAdjust(src: HTMLCanvasElement, black: number, white: number, gamma: number): void {
  if (black === 0 && white === 255 && gamma === 1) return
  const lut = levelsLUT(black, white, gamma)
  const ctx = src.getContext('2d')!
  const img = ctx.getImageData(0, 0, src.width, src.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    d[i] = lut[d[i]]
    d[i + 1] = lut[d[i + 1]]
    d[i + 2] = lut[d[i + 2]]
  }
  ctx.putImageData(img, 0, 0)
}

/** Despacho de ajustes por pixel (curvas / niveles / balance / vibrance) in-place */
export function applyAdjustmentPixels(src: HTMLCanvasElement, adj: Adjustment): void {
  if (!isPixelAdjustment(adj.type)) return
  if (adj.type === 'curves') applyCurvesAdjust(src, adj.params.curves)
  if (adj.type === 'levels') {
    const l = adj.params.levels
    applyLevelsAdjust(src, l.black, l.white, l.gamma)
  }
  if (adj.type === 'color-balance') applyColorBalance(src, adj.params.colorBalance)
  if (adj.type === 'vibrance') applyVibrance(src, adj.params.vibrance)
}

/**
 * Balance de color por franjas tonales: cada canal recibe un desplazamiento
 * -100..100 ponderado por la franja (sombras / medios / luces) segun la
 * luminancia del pixel. Implementacion propia equivalente al ajuste clasico.
 */
export function applyColorBalance(src: HTMLCanvasElement, cb: ColorBalanceParams): void {
  const isNeutral =
    isNeutralChannel(cb.shadows) && isNeutralChannel(cb.midtones) && isNeutralChannel(cb.highlights)
  if (isNeutral) return
  const ctx = src.getContext('2d')!
  const img = ctx.getImageData(0, 0, src.width, src.height)
  const d = img.data
  // escala: 100 -> ±70 unidades de color (rango profesional, sin quemar tonos)
  const SCALE = 0.7
  const sR = cb.shadows.r * SCALE
  const sG = cb.shadows.g * SCALE
  const sB = cb.shadows.b * SCALE
  const mR = cb.midtones.r * SCALE
  const mG = cb.midtones.g * SCALE
  const mB = cb.midtones.b * SCALE
  const hR = cb.highlights.r * SCALE
  const hG = cb.highlights.g * SCALE
  const hB = cb.highlights.b * SCALE
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    let wShadow: number
    let wMid: number
    let wHigh: number
    if (lum <= 127.5) {
      const t = lum / 127.5
      wShadow = 1 - t
      wMid = t
      wHigh = 0
    } else {
      const t = (lum - 127.5) / 127.5
      wShadow = 0
      wMid = 1 - t
      wHigh = t
    }
    d[i] = d[i] + sR * wShadow + mR * wMid + hR * wHigh
    d[i + 1] = d[i + 1] + sG * wShadow + mG * wMid + hG * wHigh
    d[i + 2] = d[i + 2] + sB * wShadow + mB * wMid + hB * wHigh
  }
  ctx.putImageData(img, 0, 0)
}

function isNeutralChannel(ch: { r: number; g: number; b: number }): boolean {
  return ch.r === 0 && ch.g === 0 && ch.b === 0
}

/**
 * Vibrance (intensidad inteligente): satura mas los colores apagados y
 * protege los ya saturados y los tonos neutros. amount -100..100.
 * Implementacion propia basada en distancia cromatica respecto a la
 * luminancia (espacio tipo luma-chroma).
 */
export function applyVibrance(src: HTMLCanvasElement, amount: number): void {
  if (amount === 0) return
  const ctx = src.getContext('2d')!
  const img = ctx.getImageData(0, 0, src.width, src.height)
  const d = img.data
  const a = amount / 100 // -1..1
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    const maxc = Math.max(r, g, b)
    const minc = Math.min(r, g, b)
    const sat = (maxc - minc) / 255 // 0 = gris, 1 = color puro
    // los colores apagados reciben mas intensidad; los muy saturados, menos
    const factor = 1 + a * (1 - sat)
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    d[i] = lum + (r - lum) * factor
    d[i + 1] = lum + (g - lum) * factor
    d[i + 2] = lum + (b - lum) * factor
  }
  ctx.putImageData(img, 0, 0)
}

export interface Histogram {
  r: number[]
  g: number[]
  b: number[]
  lum: number[]
  max: number
}

/** Histograma RGB/luminancia normalizado (conteos por canal) */
export function computeHistogram(src: HTMLCanvasElement): Histogram {
  const ctx = src.getContext('2d')!
  const d = ctx.getImageData(0, 0, src.width, src.height).data
  const r = new Array<number>(256).fill(0)
  const g = new Array<number>(256).fill(0)
  const b = new Array<number>(256).fill(0)
  const lum = new Array<number>(256).fill(0)
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue
    r[d[i]]++
    g[d[i + 1]]++
    b[d[i + 2]]++
    lum[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++
  }
  let max = 1
  for (let v = 0; v < 256; v++) max = Math.max(max, r[v], g[v], b[v])
  return { r, g, b, lum, max }
}

/** Percentil acumulado del histograma de luminancia (0-255) */
export function luminancePercentile(h: Histogram, fraction: number): number {
  const total = h.lum.reduce((a, c) => a + c, 0)
  if (total === 0) return fraction < 0.5 ? 0 : 255
  const target = total * fraction
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += h.lum[v]
    if (acc >= target) return v
  }
  return 255
}
