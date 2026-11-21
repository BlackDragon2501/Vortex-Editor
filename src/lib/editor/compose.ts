// Compositor de capas compartido por el lienzo visible, la exportacion y las miniaturas.
// Las capas de ajuste se aplican sobre el resultado acumulado de las capas inferiores.
// Si hay una transformacion libre en curso, la capa afectada se dibuja con su matriz.

import type { Layer, TransformState } from './types'
import { adjustmentToFilter, isPixelAdjustment } from './types'
import { applyAdjustmentPixels } from './adjustments'

export function compositeLayers(
  ctx: CanvasRenderingContext2D,
  layers: Layer[],
  width: number,
  height: number,
  transformPreview?: TransformState | null
): void {
  ctx.clearRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const hasAdjustment = layers.some((l) => l.visible && l.kind === 'adjustment' && l.adjustment)
  const drawingLayer = (l: Layer) => {
    if (transformPreview && transformPreview.layerId === l.id) {
      const t = transformPreview
      const ocx = t.orig.x + t.orig.w / 2
      const ocy = t.orig.y + t.orig.h / 2
      const sx = (t.box.w / Math.max(1, t.orig.w)) * (t.flipH ? -1 : 1)
      const sy = (t.box.h / Math.max(1, t.orig.h)) * (t.flipV ? -1 : 1)
      ctx.save()
      ctx.globalAlpha = l.opacity / 100
      ctx.globalCompositeOperation = l.blendMode
      ctx.translate(t.box.cx, t.box.cy)
      ctx.rotate(t.box.rot)
      ctx.scale(sx, sy)
      ctx.translate(-ocx, -ocy)
      ctx.drawImage(l.canvas, 0, 0)
      ctx.restore()
      return
    }
    ctx.globalAlpha = l.opacity / 100
    ctx.globalCompositeOperation = l.blendMode
    ctx.drawImage(l.canvas, 0, 0)
  }

  if (!hasAdjustment) {
    // ruta rapida: composicion directa
    for (const l of layers) {
      if (!l.visible) continue
      drawingLayer(l)
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    return
  }

  // ruta con ajustes: acumulado en canvas propio para poder filtrar en cada capa de ajuste
  const acc = document.createElement('canvas')
  acc.width = width
  acc.height = height
  const accCtx = acc.getContext('2d')!
  const tmp = document.createElement('canvas')
  tmp.width = width
  tmp.height = height
  const tmpCtx = tmp.getContext('2d')!

  for (const l of layers) {
    if (!l.visible) continue

    if (l.kind === 'adjustment' && l.adjustment) {
      if (isPixelAdjustment(l.adjustment.type)) {
        // curvas / niveles: procesado por LUT sobre el acumulado
        applyAdjustmentPixels(acc, l.adjustment)
      } else {
        tmpCtx.clearRect(0, 0, width, height)
        tmpCtx.filter = adjustmentToFilter(l.adjustment)
        tmpCtx.drawImage(acc, 0, 0)
        tmpCtx.filter = 'none'
        accCtx.clearRect(0, 0, width, height)
        accCtx.drawImage(tmp, 0, 0)
      }
      continue
    }

    accCtx.globalAlpha = l.opacity / 100
    accCtx.globalCompositeOperation = l.blendMode
    if (transformPreview && transformPreview.layerId === l.id) {
      const t = transformPreview
      const ocx = t.orig.x + t.orig.w / 2
      const ocy = t.orig.y + t.orig.h / 2
      const sx = (t.box.w / Math.max(1, t.orig.w)) * (t.flipH ? -1 : 1)
      const sy = (t.box.h / Math.max(1, t.orig.h)) * (t.flipV ? -1 : 1)
      accCtx.save()
      accCtx.translate(t.box.cx, t.box.cy)
      accCtx.rotate(t.box.rot)
      accCtx.scale(sx, sy)
      accCtx.translate(-ocx, -ocy)
      accCtx.drawImage(l.canvas, 0, 0)
      accCtx.restore()
      accCtx.globalAlpha = 1
      accCtx.globalCompositeOperation = 'source-over'
      continue
    }
    accCtx.drawImage(l.canvas, 0, 0)
  }

  accCtx.globalAlpha = 1
  accCtx.globalCompositeOperation = 'source-over'
  ctx.drawImage(acc, 0, 0)
}
