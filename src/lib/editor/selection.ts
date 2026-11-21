// Fabrica de selecciones: construye mascara de bytes, canvas de mascara y contorno de 1 px

import type { Selection } from './types'
import { selectionToMask } from './filters'

function maskCanvasFromMask(mask: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(w, h)
  for (let p = 0; p < w * h; p++) {
    img.data[p * 4] = 255
    img.data[p * 4 + 1] = 255
    img.data[p * 4 + 2] = 255
    img.data[p * 4 + 3] = mask[p] > 0 ? 255 : 0
  }
  ctx.putImageData(img, 0, 0)
  return c
}

/** contorno de 1 px: mascara erosionada por sus propias copias desplazadas */
function edgeFromMaskCanvas(maskCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = maskCanvas.width
  const h = maskCanvas.height
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.drawImage(maskCanvas, 0, 0)
  ctx.globalCompositeOperation = 'destination-out'
  ctx.drawImage(maskCanvas, 1, 0)
  ctx.drawImage(maskCanvas, -1, 0)
  ctx.drawImage(maskCanvas, 0, 1)
  ctx.drawImage(maskCanvas, 0, -1)
  ctx.globalCompositeOperation = 'source-over'
  return c
}

function computeBounds(mask: Uint8ClampedArray, w: number, h: number) {
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
  if (maxX < 0) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** seleccion a partir de una ruta vectorial */
export function makeSelection(
  kind: Selection['kind'],
  path: Path2D,
  w: number,
  h: number
): Selection {
  const mask = selectionToMask(path, w, h)
  const maskCanvas = maskCanvasFromMask(mask, w, h)
  const complex = kind === 'wand' || kind === 'invert' || kind === 'lasso'
  return {
    kind,
    path,
    bounds: computeBounds(mask, w, h),
    mask,
    maskCanvas,
    edgeCanvas: complex ? edgeFromMaskCanvas(maskCanvas) : null,
  }
}

/** seleccion a partir de una mascara ya calculada (varita magica) */
export function makeSelectionFromMask(
  kind: Selection['kind'],
  mask: Uint8ClampedArray,
  w: number,
  h: number
): Selection {
  const maskCanvas = maskCanvasFromMask(mask, w, h)
  return {
    kind,
    path: new Path2D(),
    bounds: computeBounds(mask, w, h),
    mask,
    maskCanvas,
    edgeCanvas: edgeFromMaskCanvas(maskCanvas),
  }
}
