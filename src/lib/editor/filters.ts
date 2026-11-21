// Motor de filtros de pixeles - implementacion propia basada en Canvas 2D

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '').trim()
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const num = parseInt(h || '000000', 16)
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  }
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

export function cloneCanvasEl(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const ctx = c.getContext('2d')!
  ctx.drawImage(src, 0, 0)
  return c
}

export function createCanvasEl(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

/** Aplica un filtro CSS (blur, brightness, ...) y devuelve un nuevo canvas */
export function cssFilterClone(src: HTMLCanvasElement, filter: string): HTMLCanvasElement {
  const out = createCanvasEl(src.width, src.height)
  const ctx = out.getContext('2d')!
  ctx.filter = filter
  ctx.drawImage(src, 0, 0)
  ctx.filter = 'none'
  return out
}

type Kernel = number[]

/** Convolucion generica in-place sobre RGB (alpha se conserva) */
export function convolve(src: HTMLCanvasElement, kernel: Kernel, offset = 0): void {
  const w = src.width
  const h = src.height
  const ctx = src.getContext('2d')!
  const input = ctx.getImageData(0, 0, w, h)
  const output = ctx.createImageData(w, h)
  const side = Math.round(Math.sqrt(kernel.length))
  const half = Math.floor(side / 2)
  let divisor = 0
  for (let i = 0; i < kernel.length; i++) divisor += kernel[i]
  if (divisor === 0) divisor = 1

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let ky = 0; ky < side; ky++) {
        for (let kx = 0; kx < side; kx++) {
          const sy = Math.min(h - 1, Math.max(0, y + ky - half))
          const sx = Math.min(w - 1, Math.max(0, x + kx - half))
          const si = (sy * w + sx) * 4
          const wgt = kernel[ky * side + kx]
          r += input.data[si] * wgt
          g += input.data[si + 1] * wgt
          b += input.data[si + 2] * wgt
        }
      }
      const di = (y * w + x) * 4
      output.data[di] = Math.max(0, Math.min(255, r / divisor + offset))
      output.data[di + 1] = Math.max(0, Math.min(255, g / divisor + offset))
      output.data[di + 2] = Math.max(0, Math.min(255, b / divisor + offset))
      output.data[di + 3] = input.data[di + 3]
    }
  }
  ctx.putImageData(output, 0, 0)
}

/** Pixelado in-place: reduce y reescala sin suavizado */
export function pixelate(src: HTMLCanvasElement, blockSize: number): void {
  const w = src.width
  const h = src.height
  const size = Math.max(2, Math.round(blockSize))
  const sw = Math.max(1, Math.floor(w / size))
  const sh = Math.max(1, Math.floor(h / size))
  const tmp = createCanvasEl(sw, sh)
  const tctx = tmp.getContext('2d')!
  tctx.imageSmoothingEnabled = true
  tctx.drawImage(src, 0, 0, sw, sh)
  const ctx = src.getContext('2d')!
  ctx.clearRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tmp, 0, 0, sw, sh, 0, 0, w, h)
  ctx.imageSmoothingEnabled = true
}

/** Ruido aleatorio in-place */
export function addNoise(src: HTMLCanvasElement, amount: number): void {
  const ctx = src.getContext('2d')!
  const img = ctx.getImageData(0, 0, src.width, src.height)
  const d = img.data
  const strength = Math.max(0, Math.min(255, amount))
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const n = (Math.random() - 0.5) * 2 * strength
    d[i] = Math.max(0, Math.min(255, d[i] + n))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n))
  }
  ctx.putImageData(img, 0, 0)
}

export interface FloodFillOptions {
  tolerance: number // 0 - 255
  color: string
  mask?: Uint8ClampedArray | null // alpha por pixel; si existe, solo rellena donde alpha > 0
}

/** Relleno por diffusion (scanline) in-place sobre el canvas dado */
export function floodFill(src: HTMLCanvasElement, sx: number, sy: number, opts: FloodFillOptions): void {
  const w = src.width
  const h = src.height
  sx = Math.floor(sx)
  sy = Math.floor(sy)
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return

  const ctx = src.getContext('2d')!
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data

  const startIdx = (sy * w + sx) * 4
  const target = [d[startIdx], d[startIdx + 1], d[startIdx + 2], d[startIdx + 3]]
  const fill = hexToRgb(opts.color)
  const tol = opts.tolerance * opts.tolerance * 4

  const match = (idx: number) => {
    const dr = d[idx] - target[0]
    const dg = d[idx + 1] - target[1]
    const db = d[idx + 2] - target[2]
    const da = d[idx + 3] - target[3]
    return dr * dr + dg * dg + db * db + da * da <= tol
  }

  if (match(startIdx) && target[0] === fill.r && target[1] === fill.g && target[2] === fill.b && target[3] === 255) {
    return
  }

  const visited = new Uint8Array(w * h)
  const stack: number[] = [sx, sy]

  while (stack.length > 0) {
    const py = stack.pop()!
    const px = stack.pop()!
    let left = px
    let right = px
    // expande a la izquierda
    while (left > 0 && match(((py * w) + left - 1) * 4) && !visited[py * w + left - 1]) left--
    // expande a la derecha
    while (right < w - 1 && match(((py * w) + right + 1) * 4) && !visited[py * w + right + 1]) right++
    for (let x = left; x <= right; x++) {
      const p = py * w + x
      if (visited[p]) continue
      visited[p] = 1
      if (opts.mask && opts.mask[p] === 0) continue
      const idx = p * 4
      d[idx] = fill.r
      d[idx + 1] = fill.g
      d[idx + 2] = fill.b
      d[idx + 3] = 255
      if (py > 0) {
        const up = (py - 1) * w + x
        if (!visited[up] && match(up * 4)) stack.push(x, py - 1)
      }
      if (py < h - 1) {
        const down = (py + 1) * w + x
        if (!visited[down] && match(down * 4)) stack.push(x, py + 1)
      }
    }
  }
  ctx.putImageData(img, 0, 0)
}

/** Convierte una seleccion (Path2D) en una mascara de bytes (255 dentro, 0 fuera) */
export function selectionToMask(path: Path2D, w: number, h: number): Uint8ClampedArray {
  const c = createCanvasEl(w, h)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fill(path)
  const data = ctx.getImageData(0, 0, w, h).data
  const mask = new Uint8ClampedArray(w * h)
  for (let p = 0; p < w * h; p++) mask[p] = data[p * 4 + 3] > 0 ? 255 : 0
  return mask
}

/** Convierte una mascara de bytes en un Path2D hecho de tramos horizontales de 1 px */
export function maskToRunsPath(mask: Uint8ClampedArray, w: number, h: number, invert = false): Path2D {
  const path = new Path2D()
  for (let y = 0; y < h; y++) {
    const row = y * w
    let runStart = -1
    for (let x = 0; x <= w; x++) {
      let inside = x < w ? (mask[row + x] > 0 ? 1 : 0) : 0
      if (invert) inside = inside ? 0 : 1
      if (inside && runStart < 0) {
        runStart = x
      } else if (!inside && runStart >= 0) {
        path.rect(runStart, y, x - runStart, 1)
        runStart = -1
      }
    }
  }
  return path
}

/** Varita magica: devuelve la mascara de la region conectada de color similar */
export function wandMask(
  src: HTMLCanvasElement,
  sx: number,
  sy: number,
  tolerance: number,
  contiguous: boolean
): Uint8ClampedArray | null {
  const w = src.width
  const h = src.height
  sx = Math.floor(sx)
  sy = Math.floor(sy)
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null
  const ctx = src.getContext('2d')!
  const d = ctx.getImageData(0, 0, w, h).data
  const start = (sy * w + sx) * 4
  const target = [d[start], d[start + 1], d[start + 2], d[start + 3]]
  const tol = tolerance * tolerance * 4
  const mask = new Uint8ClampedArray(w * h)
  const match = (idx: number) => {
    const dr = d[idx] - target[0]
    const dg = d[idx + 1] - target[1]
    const db = d[idx + 2] - target[2]
    const da = d[idx + 3] - target[3]
    return dr * dr + dg * dg + db * db + da * da <= tol
  }
  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (match(p * 4)) mask[p] = 255
    return mask
  }
  const stack: number[] = [sx, sy]
  const visited = new Uint8Array(w * h)
  while (stack.length) {
    const py = stack.pop()!
    const px = stack.pop()!
    let left = px
    let right = px
    while (left > 0 && match(((py * w) + left - 1) * 4) && !visited[py * w + left - 1]) left--
    while (right < w - 1 && match(((py * w) + right + 1) * 4) && !visited[py * w + right + 1]) right++
    for (let x = left; x <= right; x++) {
      const p = py * w + x
      if (visited[p]) continue
      visited[p] = 1
      mask[p] = 255
      if (py > 0) {
        const up = (py - 1) * w + x
        if (!visited[up] && match(up * 4)) stack.push(x, py - 1)
      }
      if (py < h - 1) {
        const down = (py + 1) * w + x
        if (!visited[down] && match(down * 4)) stack.push(x, py + 1)
      }
    }
  }
  return mask
}

// ---------- Pinceles de retoque (implementaciones propias) ----------

/** Caja del contenido visible (alpha > 8) de un canvas; null si esta vacio */
export function contentBounds(src: HTMLCanvasElement): Rect | null {
  const w = src.width
  const h = src.height
  const ctx = src.getContext('2d')!
  const d = ctx.getImageData(0, 0, w, h).data
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Color medio (ponderado por alpha) de un area circular del canvas */
export function sampleAverageColor(src: HTMLCanvasElement, cx: number, cy: number, radius: number): { r: number; g: number; b: number } {
  const x0 = Math.max(0, Math.floor(cx - radius))
  const y0 = Math.max(0, Math.floor(cy - radius))
  const x1 = Math.min(src.width, Math.ceil(cx + radius))
  const y1 = Math.min(src.height, Math.ceil(cy + radius))
  if (x1 <= x0 || y1 <= y0) return { r: 128, g: 128, b: 128 }
  const d = src.getContext('2d')!.getImageData(x0, y0, x1 - x0, y1 - y0).data
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy > radius * radius) continue
      const i = ((y - y0) * (x1 - x0) + (x - x0)) * 4
      const a = d[i + 3]
      if (a === 0) continue
      r += d[i]
      g += d[i + 1]
      b += d[i + 2]
      n++
    }
  }
  if (n === 0) return { r: 128, g: 128, b: 128 }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) }
}

/** Desenfoque de caja sobre la region [x0,y0,x1,y1] del ImageData */
function boxBlurRegion(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number
): Uint8ClampedArray {
  const rw = x1 - x0
  const rh = y1 - y0
  const out = new Uint8ClampedArray(rw * rh * 4)
  // horizontal
  const tmp = new Uint8ClampedArray(rw * rh * 4)
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const sx = Math.min(x1 - 1, Math.max(x0, x0 + x + k))
        const si = ((y0 + y) * w + sx) * 4
        r += data[si]
        g += data[si + 1]
        b += data[si + 2]
        a += data[si + 3]
        n++
      }
      const ti = (y * rw + x) * 4
      tmp[ti] = r / n
      tmp[ti + 1] = g / n
      tmp[ti + 2] = b / n
      tmp[ti + 3] = a / n
    }
  }
  // vertical
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const sy = Math.min(rh - 1, Math.max(0, y + k))
        const ti = (sy * rw + x) * 4
        r += tmp[ti]
        g += tmp[ti + 1]
        b += tmp[ti + 2]
        a += tmp[ti + 3]
        n++
      }
      const oi = (y * rw + x) * 4
      out[oi] = r / n
      out[oi + 1] = g / n
      out[oi + 2] = b / n
      out[oi + 3] = a / n
    }
  }
  return out
}

export interface StampOptions {
  x: number
  y: number
  radius: number
  hardness: number // 0 - 100
  strength: number // 0 - 100
  selectionMask?: Uint8ClampedArray | null
}

/** Pincel corrector: suaviza la zona mezclando con los pixeles circundantes */
export function healStamp(canvas: HTMLCanvasElement, opts: StampOptions): void {
  const w = canvas.width
  const h = canvas.height
  const ctx = canvas.getContext('2d')!
  const x0 = Math.max(0, Math.floor(opts.x - opts.radius))
  const y0 = Math.max(0, Math.floor(opts.y - opts.radius))
  const x1 = Math.min(w, Math.ceil(opts.x + opts.radius))
  const y1 = Math.min(h, Math.ceil(opts.y + opts.radius))
  if (x1 <= x0 || y1 <= y0) return
  const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0)
  const blurred = boxBlurRegion(img.data, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0, Math.max(1, Math.round(opts.radius / 3)))
  const strength = opts.strength / 100
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - opts.x
      const dy = y - opts.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > opts.radius) continue
      const falloff = Math.min(1, Math.max(0, (opts.radius - dist) / Math.max(1, (opts.radius * (opts.hardness / 100)))))
      const wgt = falloff * strength
      const p = ((y - y0) * (x1 - x0) + (x - x0)) * 4
      if (opts.selectionMask && opts.selectionMask[y * w + x] === 0) continue
      img.data[p] = img.data[p] * (1 - wgt) + blurred[p] * wgt
      img.data[p + 1] = img.data[p + 1] * (1 - wgt) + blurred[p + 1] * wgt
      img.data[p + 2] = img.data[p + 2] * (1 - wgt) + blurred[p + 2] * wgt
    }
  }
  ctx.putImageData(img, x0, y0)
}

/** Desenfoque o enfoque local */
export function blurSharpenStamp(canvas: HTMLCanvasElement, opts: StampOptions, mode: 'blur' | 'sharpen'): void {
  const w = canvas.width
  const h = canvas.height
  const ctx = canvas.getContext('2d')!
  const x0 = Math.max(0, Math.floor(opts.x - opts.radius))
  const y0 = Math.max(0, Math.floor(opts.y - opts.radius))
  const x1 = Math.min(w, Math.ceil(opts.x + opts.radius))
  const y1 = Math.min(h, Math.ceil(opts.y + opts.radius))
  if (x1 <= x0 || y1 <= y0) return
  const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0)
  const radius = Math.max(1, Math.round(opts.radius / 4))
  const processed = boxBlurRegion(img.data, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0, radius)
  const strength = opts.strength / 100
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - opts.x
      const dy = y - opts.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > opts.radius) continue
      const falloff = Math.min(1, Math.max(0, (opts.radius - dist) / Math.max(1, (opts.radius * (opts.hardness / 100)))))
      const wgt = falloff * strength
      const p = ((y - y0) * (x1 - x0) + (x - x0)) * 4
      if (opts.selectionMask && opts.selectionMask[y * w + x] === 0) continue
      for (let c = 0; c < 3; c++) {
        const o = img.data[p + c]
        const b = processed[p + c]
        // blur: mezcla hacia el desenfoque; sharpen: resta el desenfoque (unsharp mask)
        img.data[p + c] = mode === 'blur' ? o * (1 - wgt) + b * wgt : Math.max(0, Math.min(255, o + (o - b) * wgt * 2))
      }
    }
  }
  ctx.putImageData(img, x0, y0)
}

/** Sobreexponer (aclara) o subexponer (oscurece) con alcance por tonos */
export function dodgeBurnStamp(
  canvas: HTMLCanvasElement,
  opts: StampOptions,
  mode: 'dodge' | 'burn',
  range: 'shadows' | 'midtones' | 'highlights'
): void {
  const w = canvas.width
  const h = canvas.height
  const ctx = canvas.getContext('2d')!
  const x0 = Math.max(0, Math.floor(opts.x - opts.radius))
  const y0 = Math.max(0, Math.floor(opts.y - opts.radius))
  const x1 = Math.min(w, Math.ceil(opts.x + opts.radius))
  const y1 = Math.min(h, Math.ceil(opts.y + opts.radius))
  if (x1 <= x0 || y1 <= y0) return
  const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0)
  const strength = opts.strength / 100
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - opts.x
      const dy = y - opts.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > opts.radius) continue
      const falloff = Math.min(1, Math.max(0, (opts.radius - dist) / Math.max(1, (opts.radius * (opts.hardness / 100)))))
      const p = ((y - y0) * (x1 - x0) + (x - x0)) * 4
      if (opts.selectionMask && opts.selectionMask[y * w + x] === 0) continue
      const lum = (img.data[p] + img.data[p + 1] + img.data[p + 2]) / 3
      let rangeW = 1
      if (range === 'shadows') rangeW = Math.max(0, 1 - lum / 128)
      else if (range === 'highlights') rangeW = Math.max(0, (lum - 128) / 127)
      else rangeW = 1 - Math.abs(lum - 128) / 128
      const wgt = falloff * strength * rangeW
      for (let c = 0; c < 3; c++) {
        const o = img.data[p + c]
        img.data[p + c] =
          mode === 'dodge'
            ? o + (255 - o) * wgt
            : o * (1 - wgt)
      }
    }
  }
  ctx.putImageData(img, x0, y0)
}

