// Relleno segun contenido (inpainting) y mejora automatica.
// Motor propio: piramide multi-escala con difusion de Jacobi + transferencia
// de textura por bloques de alta frecuencia. Sin dependencias externas.

export interface InpaintOptions {
  /** 1 - 5: mas iteraciones de refinado y piramide mas profunda */
  quality: number
  /** transfiere textura (grano/detalle) desde zonas conocidas */
  texture: boolean
}

interface PyrLevel {
  w: number
  h: number
  /** rgb por pixel: 3 floats */
  rgb: Float32Array
  /** 1 = pixel conocido, 0 = hueco a rellenar */
  known: Uint8Array
}

function bboxOfMask(mask: Uint8ClampedArray, w: number, h: number, pad: number) {
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  const x0 = Math.max(0, minX - pad)
  const y0 = Math.max(0, minY - pad)
  const x1 = Math.min(w, maxX + 1 + pad)
  const y1 = Math.min(h, maxY + 1 + pad)
  return { x0, y0, w: x1 - x0, h: y1 - y0 }
}

function downsampleLevel(prev: PyrLevel): PyrLevel {
  const w = Math.max(1, Math.floor(prev.w / 2))
  const h = Math.max(1, Math.floor(prev.h / 2))
  const rgb = new Float32Array(w * h * 3)
  const known = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(prev.w - 1, x * 2 + dx)
          const sy = Math.min(prev.h - 1, y * 2 + dy)
          const si = sy * prev.w + sx
          if (prev.known[si]) {
            r += prev.rgb[si * 3]
            g += prev.rgb[si * 3 + 1]
            b += prev.rgb[si * 3 + 2]
            n++
          }
        }
      }
      const di = y * w + x
      if (n > 0) {
        known[di] = 1
        rgb[di * 3] = r / n
        rgb[di * 3 + 1] = g / n
        rgb[di * 3 + 2] = b / n
      }
    }
  }
  return { w, h, rgb, known }
}

/** Difusion de Jacobi sobre los huecos usando los pixeles conocidos como frontera */
function diffuse(level: PyrLevel, iterations: number): void {
  const { w, h, known } = level
  let cur = level.rgb
  let next: Float32Array = new Float32Array(cur.length)
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        if (known[p]) {
          next[p * 3] = cur[p * 3]
          next[p * 3 + 1] = cur[p * 3 + 1]
          next[p * 3 + 2] = cur[p * 3 + 2]
          continue
        }
        let r = 0
        let g = 0
        let b = 0
        let n = 0
        if (x > 0) {
          const q = p - 1
          r += cur[q * 3]
          g += cur[q * 3 + 1]
          b += cur[q * 3 + 2]
          n++
        }
        if (x < w - 1) {
          const q = p + 1
          r += cur[q * 3]
          g += cur[q * 3 + 1]
          b += cur[q * 3 + 2]
          n++
        }
        if (y > 0) {
          const q = p - w
          r += cur[q * 3]
          g += cur[q * 3 + 1]
          b += cur[q * 3 + 2]
          n++
        }
        if (y < h - 1) {
          const q = p + w
          r += cur[q * 3]
          g += cur[q * 3 + 1]
          b += cur[q * 3 + 2]
          n++
        }
        if (n === 0) {
          next[p * 3] = cur[p * 3]
          next[p * 3 + 1] = cur[p * 3 + 1]
          next[p * 3 + 2] = cur[p * 3 + 2]
        } else {
          next[p * 3] = r / n
          next[p * 3 + 1] = g / n
          next[p * 3 + 2] = b / n
        }
      }
    }
    // intercambio ping-pong de buffers
    const t = cur
    cur = next
    next = t
  }
  level.rgb = cur
}

/** Muestreo bilineal del nivel grueso hacia un punto del nivel fino (coords de fino) */
function sampleBilinear(src: PyrLevel, fx: number, fy: number, out: Float32Array): void {
  const cx = (fx + 0.5) / 2 - 0.5
  const cy = (fy + 0.5) / 2 - 0.5
  const x0 = Math.max(0, Math.min(src.w - 1, Math.floor(cx)))
  const y0 = Math.max(0, Math.min(src.h - 1, Math.floor(cy)))
  const x1 = Math.min(src.w - 1, x0 + 1)
  const y1 = Math.min(src.h - 1, y0 + 1)
  const tx = Math.max(0, Math.min(1, cx - x0))
  const ty = Math.max(0, Math.min(1, cy - y0))
  for (let c = 0; c < 3; c++) {
    const v00 = src.rgb[(y0 * src.w + x0) * 3 + c]
    const v10 = src.rgb[(y0 * src.w + x1) * 3 + c]
    const v01 = src.rgb[(y1 * src.w + x0) * 3 + c]
    const v11 = src.rgb[(y1 * src.w + x1) * 3 + c]
    out[c] = v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty
  }
}

/** Blur de caja separable sobre rgb float (para extraer componentes de baja/alta frecuencia) */
function boxBlurFloat(rgb: Float32Array, w: number, h: number, radius: number): Float32Array {
  const tmp = new Float32Array(rgb.length)
  const out = new Float32Array(rgb.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const sx = Math.min(w - 1, Math.max(0, x + k))
        const si = (y * w + sx) * 3
        r += rgb[si]
        g += rgb[si + 1]
        b += rgb[si + 2]
        n++
      }
      const di = (y * w + x) * 3
      tmp[di] = r / n
      tmp[di + 1] = g / n
      tmp[di + 2] = b / n
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const sy = Math.min(h - 1, Math.max(0, y + k))
        const si = (sy * w + x) * 3
        r += tmp[si]
        g += tmp[si + 1]
        b += tmp[si + 2]
        n++
      }
      const di = (y * w + x) * 3
      out[di] = r / n
      out[di + 1] = g / n
      out[di + 2] = b / n
    }
  }
  return out
}

/**
 * Transferencia de textura: para cada bloque del hueco busca el bloque conocido
 * con estructura similar y le copia su componente de alta frecuencia.
 */
function transferTexture(
  filled: Float32Array,
  known: Uint8Array,
  w: number,
  h: number,
  holeMask: Uint8ClampedArray // region-local
): void {
  const blurRadius = 3
  const blurred = boxBlurFloat(filled, w, h, blurRadius)
  const block = 8
  const step = 4
  const hfs = new Float32Array(filled.length) // suma ponderada de hf
  const wts = new Float32Array(w * h) // suma de pesos

  // bloques de hueco
  const holeBlocks: { bx: number; by: number }[] = []
  for (let by = 0; by + block <= h; by += step) {
    for (let bx = 0; bx + block <= w; bx += step) {
      let hasHole = false
      for (let y = by; y < by + block && !hasHole; y++) {
        for (let x = bx; x < bx + block; x++) {
          if (holeMask[y * w + x] > 0) {
            hasHole = true
            break
          }
        }
      }
      if (hasHole) holeBlocks.push({ bx, by })
    }
  }
  if (!holeBlocks.length) return

  // candidatos: bloques totalmente conocidos, recorridos con paso mayor para limitar coste
  const candStep = Math.max(step, Math.ceil(Math.sqrt((w * h) / 16000)) * 2)
  const candidates: { bx: number; by: number }[] = []
  for (let by = 0; by + block <= h; by += candStep) {
    for (let bx = 0; bx + block <= w; bx += candStep) {
      let allKnown = true
      for (let y = by; y < by + block && allKnown; y += 2) {
        for (let x = bx; x < bx + block; x += 2) {
          if (!known[y * w + x]) {
            allKnown = false
            break
          }
        }
      }
      if (allKnown) candidates.push({ bx, by })
    }
  }
  if (!candidates.length) return

  // muestra de 12 posiciones dentro del bloque para comparar estructura
  const samples: { dx: number; dy: number }[] = []
  for (let i = 0; i < 12; i++) {
    samples.push({
      dx: 1 + Math.floor((i * 7) % (block - 2)),
      dy: 1 + Math.floor((i * 5) % (block - 2)),
    })
  }

  for (const hb of holeBlocks) {
    // estructura objetivo: valores difuminados del relleno por difusion
    let best = -1
    let bestScore = Infinity
    for (let ci = 0; ci < candidates.length; ci++) {
      const cb = candidates[ci]
      let score = 0
      for (const s of samples) {
        const hi = (hb.by + s.dy) * w + (hb.bx + s.dx)
        const ki = (cb.by + s.dy) * w + (cb.bx + s.dx)
        const dr = blurred[hi * 3] - blurred[ki * 3]
        const dg = blurred[hi * 3 + 1] - blurred[ki * 3 + 1]
        const db = blurred[hi * 3 + 2] - blurred[ki * 3 + 2]
        score += dr * dr + dg * dg + db * db
      }
      if (score < bestScore) {
        bestScore = score
        best = ci
      }
    }
    if (best < 0) continue
    const cb = candidates[best]
    // transfiere la alta frecuencia del candidato al hueco
    for (let y = 0; y < block; y++) {
      for (let x = 0; x < block; x++) {
        const px = hb.bx + x
        const py = hb.by + y
        const p = py * w + px
        if (holeMask[p] === 0) continue
        const k = cb.by * w + cb.bx + y * w + x
        const weight = 1
        for (let c = 0; c < 3; c++) {
          const hf = filled[k * 3 + c] - blurred[k * 3 + c]
          hfs[p * 3 + c] += hf * weight
        }
        wts[p] += weight
      }
    }
  }

  // aplica: pixel final = difusion (baja frecuencia) + hf transferido
  for (let p = 0; p < w * h; p++) {
    if (holeMask[p] === 0 || wts[p] === 0) continue
    for (let c = 0; c < 3; c++) {
      filled[p * 3 + c] = Math.max(0, Math.min(255, filled[p * 3 + c] + hfs[p * 3 + c] / wts[p]))
    }
  }
}

/**
 * Inpainting sobre un canvas usando una mascara de bytes del mismo tamano
 * (255 = zona a rellenar). Modifica el canvas in-place.
 */
export function inpaintCanvas(
  src: HTMLCanvasElement,
  mask: Uint8ClampedArray,
  opts: InpaintOptions
): void {
  const w = src.width
  const h = src.height
  const pad = 24 + opts.quality * 6
  const bbox = bboxOfMask(mask, w, h, pad)
  if (!bbox) return
  const ctx = src.getContext('2d')!
  const region = ctx.getImageData(bbox.x0, bbox.y0, bbox.w, bbox.h)
  const rw = bbox.w
  const rh = bbox.h

  // nivel 0 de la piramide con datos reales
  const level0: PyrLevel = { w: rw, h: rh, rgb: new Float32Array(rw * rh * 3), known: new Uint8Array(rw * rh) }
  const holeMask = new Uint8ClampedArray(rw * rh)
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const p = y * rw + x
      const isHole = mask[(bbox.y0 + y) * w + (bbox.x0 + x)] > 0
      holeMask[p] = isHole ? 255 : 0
      if (!isHole) {
        level0.rgb[p * 3] = region.data[p * 4]
        level0.rgb[p * 3 + 1] = region.data[p * 4 + 1]
        level0.rgb[p * 3 + 2] = region.data[p * 4 + 2]
        level0.known[p] = 1
      }
    }
  }

  // construye la piramide hasta un tamano manejable
  const levels: PyrLevel[] = [level0]
  const maxLevels = 6
  while (levels.length < maxLevels) {
    const prev = levels[levels.length - 1]
    if (Math.max(prev.w, prev.h) <= 24) break
    levels.push(downsampleLevel(prev))
  }

  const coarsest = levels[levels.length - 1]

  // inicializa los huecos del nivel mas grueso con el color medio conocido
  let mr = 0
  let mg = 0
  let mb = 0
  let mn = 0
  for (let p = 0; p < coarsest.w * coarsest.h; p++) {
    if (coarsest.known[p]) {
      mr += coarsest.rgb[p * 3]
      mg += coarsest.rgb[p * 3 + 1]
      mb += coarsest.rgb[p * 3 + 2]
      mn++
    }
  }
  if (mn === 0) return
  mr /= mn
  mg /= mn
  mb /= mn
  for (let p = 0; p < coarsest.w * coarsest.h; p++) {
    if (!coarsest.known[p]) {
      coarsest.rgb[p * 3] = mr
      coarsest.rgb[p * 3 + 1] = mg
      coarsest.rgb[p * 3 + 2] = mb
    }
  }
  diffuse(coarsest, 400)

  // refinado de grueso a fino
  const tmp = new Float32Array(3)
  for (let li = levels.length - 2; li >= 0; li--) {
    const fine = levels[li]
    const coarse = levels[li + 1]
    for (let y = 0; y < fine.h; y++) {
      for (let x = 0; x < fine.w; x++) {
        const p = y * fine.w + x
        if (fine.known[p]) continue
        sampleBilinear(coarse, x, y, tmp)
        fine.rgb[p * 3] = tmp[0]
        fine.rgb[p * 3 + 1] = tmp[1]
        fine.rgb[p * 3 + 2] = tmp[2]
      }
    }
    const iters = Math.round(30 + opts.quality * 35)
    diffuse(fine, iters)
  }

  if (opts.texture) {
    transferTexture(level0.rgb, level0.known, rw, rh, holeMask)
  }

  // escribe el resultado en la region
  const out = ctx.createImageData(rw, rh)
  for (let p = 0; p < rw * rh; p++) {
    out.data[p * 4] = Math.round(level0.rgb[p * 3])
    out.data[p * 4 + 1] = Math.round(level0.rgb[p * 3 + 1])
    out.data[p * 4 + 2] = Math.round(level0.rgb[p * 3 + 2])
    out.data[p * 4 + 3] = region.data[p * 4 + 3]
    if (holeMask[p] === 0) {
      // fuera del hueco se conservan los pixeles originales intactos
      out.data[p * 4] = region.data[p * 4]
      out.data[p * 4 + 1] = region.data[p * 4 + 1]
      out.data[p * 4 + 2] = region.data[p * 4 + 2]
    }
  }
  ctx.putImageData(out, bbox.x0, bbox.y0)
}

/**
 * Mejora automatica (IA): estira el histograma de luminancia al 1%-99%,
 * ajusta el contraste y realza ligeramente la saturacion.
 */
export function autoEnhance(src: HTMLCanvasElement): void {
  const ctx = src.getContext('2d')!
  const img = ctx.getImageData(0, 0, src.width, src.height)
  const d = img.data
  const hist = new Array<number>(256).fill(0)
  let total = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue
    hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++
    total++
  }
  if (total === 0) return
  const lo = percentileOf(hist, total, 0.01)
  const hi = percentileOf(hist, total, 0.99)
  if (hi - lo < 8) return
  const lut = new Uint8ClampedArray(256)
  const range = hi - lo
  for (let v = 0; v < 256; v++) {
    const t = Math.max(0, Math.min(1, (v - lo) / range))
    lut[v] = Math.round(Math.pow(t, 0.96) * 255)
  }
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    d[i] = lut[d[i]]
    d[i + 1] = lut[d[i + 1]]
    d[i + 2] = lut[d[i + 2]]
  }
  ctx.putImageData(img, 0, 0)
  // realce sutil de saturacion y contraste local
  const tmp = document.createElement('canvas')
  tmp.width = src.width
  tmp.height = src.height
  tmp.getContext('2d')!.drawImage(src, 0, 0)
  ctx.clearRect(0, 0, src.width, src.height)
  ctx.filter = 'saturate(1.08)'
  ctx.drawImage(tmp, 0, 0)
  ctx.filter = 'none'
}

function percentileOf(hist: number[], total: number, fraction: number): number {
  const target = total * fraction
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= target) return v
  }
  return 255
}
