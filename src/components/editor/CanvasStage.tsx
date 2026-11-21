'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor } from '@/lib/editor/store'
import type { Layer, Rect, TransformBox } from '@/lib/editor/types'
import { penPathToPath2D } from '@/lib/editor/types'
import {
  blurSharpenStamp,
  dodgeBurnStamp,
  healStamp,
  hexToRgb,
  sampleAverageColor,
} from '@/lib/editor/filters'
import { compositeLayers } from '@/lib/editor/compose'
import { makeSelection } from '@/lib/editor/selection'

interface DragState {
  tool: string
  startX: number
  startY: number
  lastX: number
  lastY: number
  points: { x: number; y: number }[]
  layerSnapshot: HTMLCanvasElement | null
  strokeCanvas: HTMLCanvasElement | null
  moved: boolean
  /** origen del tampon de clonar en coords de documento */
  cloneSource: { x: number; y: number } | null
  /** pluma: distancia recorrida desde el ancla para decidir esquina o curva */
  penMovedPx: number
  /** mezclador: pintura actual cargada en el pincel */
  paint: { r: number; g: number; b: number } | null
  /** transformacion: tirador activo y caja al iniciar el gesto */
  handle: TransformHandle | null
  boxStart: TransformBox | null
}

type TransformHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate' | 'move'

interface BoxAxes {
  u: { x: number; y: number }
  n: { x: number; y: number }
  nw: { x: number; y: number }
  ne: { x: number; y: number }
  se: { x: number; y: number }
  sw: { x: number; y: number }
  nMid: { x: number; y: number }
  eMid: { x: number; y: number }
  sMid: { x: number; y: number }
  wMid: { x: number; y: number }
  rotate: { x: number; y: number }
}

function boxGeometry(box: TransformBox, handleSize: number, docW?: number, docH?: number): BoxAxes {
  const u = { x: Math.cos(box.rot), y: Math.sin(box.rot) }
  const n = { x: -Math.sin(box.rot), y: Math.cos(box.rot) }
  const hw = box.w / 2
  const hh = box.h / 2
  const nw = { x: box.cx - u.x * hw - n.x * hh, y: box.cy - u.y * hw - n.y * hh }
  const ne = { x: box.cx + u.x * hw - n.x * hh, y: box.cy + u.y * hw - n.y * hh }
  const se = { x: box.cx + u.x * hw + n.x * hh, y: box.cy + u.y * hw + n.y * hh }
  const sw = { x: box.cx - u.x * hw + n.x * hh, y: box.cy - u.y * hw + n.y * hh }
  const nMid = { x: (nw.x + ne.x) / 2, y: (nw.y + ne.y) / 2 }
  const eMid = { x: (ne.x + se.x) / 2, y: (ne.y + se.y) / 2 }
  const sMid = { x: (se.x + sw.x) / 2, y: (se.y + sw.y) / 2 }
  const wMid = { x: (sw.x + nw.x) / 2, y: (sw.y + nw.y) / 2 }
  let rotate = { x: nMid.x - n.x * handleSize * 2.4, y: nMid.y - n.y * handleSize * 2.4 }
  // mantiene el mango de rotacion dentro del documento para que sea accesible
  if (docW && docH) {
    const margin = Math.max(handleSize, 6)
    rotate = {
      x: Math.min(Math.max(rotate.x, margin), docW - margin),
      y: Math.min(Math.max(rotate.y, margin), docH - margin),
    }
  }
  return { u, n, nw, ne, se, sw, nMid, eMid, sMid, wMid, rotate }
}

function hitTestTransformHandle(
  p: { x: number; y: number },
  box: TransformBox,
  zoom: number,
  docW: number,
  docH: number
): TransformHandle | null {
  const th = 9 / zoom
  const g = boxGeometry(box, th, docW, docH)
  const near = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) =>
    Math.abs(a.x - b.x) <= t && Math.abs(a.y - b.y) <= t
  if (near(p, g.rotate, th * 1.4)) return 'rotate'
  if (near(p, g.nw, th)) return 'nw'
  if (near(p, g.ne, th)) return 'ne'
  if (near(p, g.se, th)) return 'se'
  if (near(p, g.sw, th)) return 'sw'
  if (near(p, g.nMid, th)) return 'n'
  if (near(p, g.eMid, th)) return 'e'
  if (near(p, g.sMid, th)) return 's'
  if (near(p, g.wMid, th)) return 'w'
  return null
}

function pointInRotatedRect(p: { x: number; y: number }, box: TransformBox): boolean {
  const dx = p.x - box.cx
  const dy = p.y - box.cy
  const c = Math.cos(-box.rot)
  const s = Math.sin(-box.rot)
  const lx = dx * c - dy * s
  const ly = dx * s + dy * c
  return Math.abs(lx) <= box.w / 2 && Math.abs(ly) <= box.h / 2
}

/** ajusta la caja al arrastrar un tirador de esquina o borde */
function applyTransformHandle(
  updateBox: (patch: Partial<TransformBox>) => void,
  d: DragState,
  p: { x: number; y: number },
  shift: boolean
) {
  const handle = d.handle!
  const box0 = d.boxStart!
  const g0 = boxGeometry(box0, 0)
  const dotU = (vx: number, vy: number) => vx * g0.u.x + vy * g0.u.y
  const dotN = (vx: number, vy: number) => vx * g0.n.x + vy * g0.n.y

  if (handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw') {
    const fixed = handle === 'nw' ? g0.se : handle === 'ne' ? g0.sw : handle === 'se' ? g0.nw : g0.ne
    const vx = p.x - fixed.x
    const vy = p.y - fixed.y
    const du = dotU(vx, vy)
    const dn = dotN(vx, vy)
    let wNew = Math.max(8, Math.abs(du))
    let hNew = Math.max(8, Math.abs(dn))
    if (shift) {
      // mantiene la proporcion de la caja inicial
      const k = Math.max(wNew / Math.max(1, box0.w), hNew / Math.max(1, box0.h))
      wNew = Math.max(8, box0.w * k)
      hNew = Math.max(8, box0.h * k)
    }
    const su = handle === 'ne' || handle === 'se' ? 1 : -1
    const sn = handle === 'se' || handle === 'sw' ? 1 : -1
    const cx = fixed.x + (g0.u.x * su * (du >= 0 ? 1 : -1) * wNew) / 2 + (g0.n.x * sn * (dn >= 0 ? 1 : -1) * hNew) / 2
    const cy = fixed.y + (g0.u.y * su * (du >= 0 ? 1 : -1) * wNew) / 2 + (g0.n.y * sn * (dn >= 0 ? 1 : -1) * hNew) / 2
    updateBox({ w: wNew, h: hNew, cx, cy })
    return
  }

  if (handle === 'n' || handle === 's') {
    const fixed = handle === 'n' ? g0.sMid : g0.nMid
    const dn = dotN(p.x - fixed.x, p.y - fixed.y)
    const hNew = Math.max(8, Math.abs(dn))
    updateBox({ h: hNew, cx: fixed.x + (g0.n.x * dn) / 2, cy: fixed.y + (g0.n.y * dn) / 2 })
    return
  }

  if (handle === 'e' || handle === 'w') {
    const fixed = handle === 'e' ? g0.wMid : g0.eMid
    const du = dotU(p.x - fixed.x, p.y - fixed.y)
    const wNew = Math.max(8, Math.abs(du))
    updateBox({ w: wNew, cx: fixed.x + (g0.u.x * du) / 2, cy: fixed.y + (g0.u.y * du) / 2 })
  }
}

function rectFromPoints(x0: number, y0: number, x1: number, y1: number): Rect {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  }
}

function normalizeRect(r: Rect): Rect {
  return r
}

/** copia de seguridad de la capa activa para el tampon de clonar y mover */
function snapshotOfActiveLayer(st: ReturnType<typeof useEditor.getState>): HTMLCanvasElement | null {
  const layer = paintTargetLayer(st)
  if (!layer) return null
  const c = document.createElement('canvas')
  c.width = layer.canvas.width
  c.height = layer.canvas.height
  c.getContext('2d')!.drawImage(layer.canvas, 0, 0)
  return c
}

/**
 * Capa donde se puede pintar: la activa si es de pixeles; si la activa es de
 * ajuste (no pintable), el trazo cae en la capa de pixeles mas cercana por
 * debajo, que es la capa a la que ese ajuste afecta.
 */
function paintTargetLayer(st: ReturnType<typeof useEditor.getState>): Layer | null {
  const idx = st.layers.findIndex((l) => l.id === st.activeLayerId)
  if (idx < 0) return null
  const active = st.layers[idx]
  if (active.kind === 'pixel') return active
  for (let i = idx - 1; i >= 0; i--) {
    if (st.layers[i].kind === 'pixel') return st.layers[i]
  }
  return null
}

export function CanvasStage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const compositeRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const antsOffsetRef = useRef(0)
  const spaceDownRef = useRef(false)
  const cloneSourceRef = useRef<{ x: number; y: number } | null>(null)
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; screenX: number; screenY: number; value: string } | null>(null)
  const textInputRef = useRef<HTMLTextAreaElement>(null)

  const width = useEditor((s) => s.width)
  const height = useEditor((s) => s.height)
  const layers = useEditor((s) => s.layers)
  const rev = useEditor((s) => s.rev)
  const zoom = useEditor((s) => s.zoom)
  const panX = useEditor((s) => s.panX)
  const panY = useEditor((s) => s.panY)
  const fitRequest = useEditor((s) => s.fitRequest)
  const activeTool = useEditor((s) => s.activeTool)
  const selection = useEditor((s) => s.selection)
  const cropRect = useEditor((s) => s.cropRect)
  const transform = useEditor((s) => s.transform)
  const penPath = useEditor((s) => s.penPath)

  const store = useEditor.getState

  // ---------- Composicion de capas en el canvas visible ----------
  useEffect(() => {
    const canvas = compositeRef.current
    if (!canvas || !width || !height) return
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    const st = store()
    compositeLayers(ctx, st.layers, width, height, st.transform)
  }, [layers, rev, width, height, store])

  // ---------- Overlay: selecciones y previsualizaciones ----------
  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current
    if (!canvas || !width || !height) return
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, width, height)
    const st = store()
    const lw = 1 / st.zoom

    // hormigas en marcha: rect/ellipse/lasso usan ruta; wand/invert usan contorno
    if (st.selection) {
      if (st.selection.edgeCanvas) {
        ctx.globalAlpha = 0.18
        ctx.fillStyle = '#ffffff'
        ctx.drawImage(st.selection.maskCanvas, 0, 0)
        ctx.globalAlpha = 1
        ctx.filter = 'brightness(0)'
        ctx.drawImage(st.selection.edgeCanvas, -1, 0)
        ctx.drawImage(st.selection.edgeCanvas, 0, -1)
        ctx.filter = 'none'
        ctx.drawImage(st.selection.edgeCanvas, 0, 0)
      } else {
        ctx.lineWidth = lw
        ctx.strokeStyle = 'rgba(0,0,0,0.9)'
        ctx.setLineDash([4 / st.zoom, 4 / st.zoom])
        ctx.lineDashOffset = -antsOffsetRef.current / st.zoom
        ctx.stroke(st.selection.path)
        ctx.strokeStyle = 'rgba(255,255,255,0.95)'
        ctx.lineDashOffset = (-antsOffsetRef.current + 4) / st.zoom
        ctx.stroke(st.selection.path)
        ctx.setLineDash([])
      }
    }

    // area de recorte
    if (st.cropRect) {
      const r = st.cropRect
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(0, 0, width, height)
      ctx.clearRect(r.x, r.y, r.w, r.h)
      // repinta el contenido dentro del rect para simular ventana
      const comp = compositeRef.current
      if (comp) {
        ctx.drawImage(comp, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
      }
      ctx.strokeStyle = '#fbbf24'
      ctx.lineWidth = lw
      ctx.strokeRect(r.x, r.y, r.w, r.h)
      const corner = Math.min(r.w, r.h) * 0.2
      ctx.strokeStyle = '#fbbf24'
      ctx.lineWidth = 2 / st.zoom
      // esquinas estilo guia
      ctx.beginPath()
      ctx.moveTo(r.x, r.y + corner); ctx.lineTo(r.x, r.y); ctx.lineTo(r.x + corner, r.y)
      ctx.moveTo(r.x + r.w - corner, r.y); ctx.lineTo(r.x + r.w, r.y); ctx.lineTo(r.x + r.w, r.y + corner)
      ctx.moveTo(r.x + r.w, r.y + r.h - corner); ctx.lineTo(r.x + r.w, r.y + r.h); ctx.lineTo(r.x + r.w - corner, r.y + r.h)
      ctx.moveTo(r.x + corner, r.y + r.h); ctx.lineTo(r.x, r.y + r.h); ctx.lineTo(r.x, r.y + r.h - corner)
      ctx.stroke()
    }

    // caja de transformacion libre con tiradores
    if (st.transform) {
      const t = st.transform
      const hs = 8 / st.zoom
      const g = boxGeometry(t.box, hs, width, height)
      ctx.lineWidth = 1 / st.zoom
      ctx.strokeStyle = '#fbbf24'
      ctx.beginPath()
      ctx.moveTo(g.nw.x, g.nw.y)
      ctx.lineTo(g.ne.x, g.ne.y)
      ctx.lineTo(g.se.x, g.se.y)
      ctx.lineTo(g.sw.x, g.sw.y)
      ctx.closePath()
      ctx.stroke()
      // brazo y mango de rotacion
      ctx.beginPath()
      ctx.moveTo(g.nMid.x, g.nMid.y)
      ctx.lineTo(g.rotate.x, g.rotate.y)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(g.rotate.x, g.rotate.y, hs * 0.6, 0, Math.PI * 2)
      ctx.fillStyle = '#fbbf24'
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'
      ctx.stroke()
      // tiradores: esquinas y puntos medios
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'
      for (const c of [g.nw, g.ne, g.se, g.sw, g.nMid, g.eMid, g.sMid, g.wMid]) {
        ctx.fillRect(c.x - hs / 2, c.y - hs / 2, hs, hs)
        ctx.strokeRect(c.x - hs / 2, c.y - hs / 2, hs, hs)
      }
    }

    // trazado de trabajo de la pluma vectorial
    if (activeTool === 'pen' && st.penPath && st.penPath.points.length > 0) {
      const pp = st.penPath
      const p2d = penPathToPath2D(pp)
      ctx.lineWidth = 1.2 / st.zoom
      ctx.strokeStyle = 'rgba(251,191,36,0.95)'
      if (pp.closed) {
        ctx.fillStyle = 'rgba(251,191,36,0.12)'
        ctx.fill(p2d)
      }
      ctx.stroke(p2d)
      // tiradores de bezier
      for (const a of pp.points) {
        if (a.hIn) {
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(a.hIn.x, a.hIn.y)
          ctx.strokeStyle = 'rgba(125,211,252,0.8)'
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(a.hIn.x, a.hIn.y, 3 / st.zoom, 0, Math.PI * 2)
          ctx.fillStyle = '#7dd3fc'
          ctx.fill()
        }
        if (a.hOut) {
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(a.hOut.x, a.hOut.y)
          ctx.strokeStyle = 'rgba(125,211,252,0.8)'
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(a.hOut.x, a.hOut.y, 3 / st.zoom, 0, Math.PI * 2)
          ctx.fillStyle = '#7dd3fc'
          ctx.fill()
        }
      }
      // anclas
      const as = 6 / st.zoom
      for (const a of pp.points) {
        ctx.fillStyle = '#ffffff'
        ctx.strokeStyle = 'rgba(0,0,0,0.85)'
        ctx.fillRect(a.x - as / 2, a.y - as / 2, as, as)
        ctx.strokeRect(a.x - as / 2, a.y - as / 2, as, as)
      }
      // goma elástica hacia el cursor
      if (!dragRef.current && st.cursorPos && !pp.closed) {
        const last = pp.points[pp.points.length - 1]
        ctx.setLineDash([3 / st.zoom, 3 / st.zoom])
        ctx.beginPath()
        ctx.moveTo(last.x, last.y)
        ctx.lineTo(st.cursorPos.x, st.cursorPos.y)
        ctx.strokeStyle = 'rgba(251,191,36,0.5)'
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    // previsualizacion de la herramienta en curso
    const d = dragRef.current
    if (d && d.moved) {
      ctx.strokeStyle = 'rgba(251,191,36,0.9)'
      ctx.fillStyle = 'rgba(251,191,36,0.15)'
      ctx.lineWidth = lw
      if (d.tool === 'rect-select') {
        const r = rectFromPoints(d.startX, d.startY, d.lastX, d.lastY)
        ctx.fillRect(r.x, r.y, r.w, r.h)
        ctx.strokeRect(r.x, r.y, r.w, r.h)
      } else if (d.tool === 'ellipse-select') {
        const r = rectFromPoints(d.startX, d.startY, d.lastX, d.lastY)
        ctx.beginPath()
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      } else if (d.tool === 'lasso') {
        ctx.beginPath()
        ctx.moveTo(d.points[0].x, d.points[0].y)
        for (const p of d.points.slice(1)) ctx.lineTo(p.x, p.y)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      } else if (d.tool === 'crop') {
        const r = rectFromPoints(d.startX, d.startY, d.lastX, d.lastY)
        ctx.strokeRect(r.x, r.y, r.w, r.h)
      } else if (d.tool === 'shape-rect') {
        const r = rectFromPoints(d.startX, d.startY, d.lastX, d.lastY)
        ctx.strokeStyle = st.foreground
        ctx.strokeRect(r.x, r.y, r.w, r.h)
      } else if (d.tool === 'shape-ellipse') {
        const r = rectFromPoints(d.startX, d.startY, d.lastX, d.lastY)
        ctx.strokeStyle = st.foreground
        ctx.beginPath()
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2)
        ctx.stroke()
      } else if (d.tool === 'shape-line') {
        ctx.strokeStyle = st.foreground
        ctx.lineWidth = st.shapeStrokeWidth
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(d.startX, d.startY)
        ctx.lineTo(d.lastX, d.lastY)
        ctx.stroke()
      } else if (d.tool === 'gradient') {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = lw
        ctx.beginPath()
        ctx.moveTo(d.startX, d.startY)
        ctx.lineTo(d.lastX, d.lastY)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(d.startX, d.startY, 3 / st.zoom, 0, Math.PI * 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(d.lastX, d.lastY, 3 / st.zoom, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  }, [width, height, store, activeTool])

  // animacion de hormigas en marcha
  useEffect(() => {
    if (!selection && !cropRect) return
    let raf = 0
    const tick = () => {
      antsOffsetRef.current = (antsOffsetRef.current + 0.5) % 8
      drawOverlay()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [selection, cropRect, drawOverlay])

  useEffect(() => {
    drawOverlay()
  }, [drawOverlay, zoom, selection, cropRect, rev, transform, penPath])

  // ---------- Ajuste inicial a pantalla ----------
  useEffect(() => {
    const container = containerRef.current
    if (!container || !width || !height) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    const z = Math.min((cw - 64) / width, (ch - 64) / height, 2)
    const zoomFit = Math.max(0.02, z)
    store().setView(zoomFit, (cw - width * zoomFit) / 2, (ch - height * zoomFit) / 2)
  }, [fitRequest, width, height])

  // ---------- tecla Space para mano temporal ----------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spaceDownRef.current) {
        const t = e.target as HTMLElement
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
        spaceDownRef.current = true
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDownRef.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // ---------- coordenadas de documento ----------
  const getDocPoint = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = overlayRef.current!.getBoundingClientRect()
    const st = store()
    return {
      x: (e.clientX - rect.left) / st.zoom,
      y: (e.clientY - rect.top) / st.zoom,
    }
  }

  // ---------- Pintado con pincel / borrador ----------
  const paintSegment = useCallback(
    (
      from: { x: number; y: number },
      to: { x: number; y: number },
      isEraser: boolean,
      overrideColor?: string,
      overrideAlpha?: number
    ) => {
      const st = store()
      const layer = paintTargetLayer(st)
      if (!layer) return
      const d = dragRef.current
      if (!d) return

      const size = isEraser ? st.eraserSize : st.activeTool === 'pencil' ? st.pencilSize : st.brushSize
      const hardness = isEraser ? st.eraserHardness : st.brushHardness
      const opacity = overrideAlpha ?? ((isEraser ? st.eraserOpacity : st.brushOpacity) / 100)
      const color = overrideColor ?? st.foreground

      if (!d.strokeCanvas) {
        d.strokeCanvas = document.createElement('canvas')
        d.strokeCanvas.width = width
        d.strokeCanvas.height = height
      }
      if (!d.layerSnapshot) {
        d.layerSnapshot = document.createElement('canvas')
        d.layerSnapshot.width = layer.canvas.width
        d.layerSnapshot.height = layer.canvas.height
        d.layerSnapshot.getContext('2d')!.drawImage(layer.canvas, 0, 0)
      }
      const sctx = d.strokeCanvas.getContext('2d')!
      sctx.strokeStyle = color
      sctx.lineWidth = Math.max(1, size)
      sctx.lineCap = 'round'
      sctx.lineJoin = 'round'
      sctx.beginPath()
      sctx.moveTo(from.x, from.y)
      sctx.lineTo(to.x, to.y)
      sctx.stroke()

      if (st.selection) {
        const sc = d.strokeCanvas!
        sc.getContext('2d')!.globalCompositeOperation = 'destination-in'
        sc.getContext('2d')!.drawImage(st.selection.maskCanvas, 0, 0)
        sc.getContext('2d')!.globalCompositeOperation = 'source-over'
      }

      // reconstruye la capa desde la instantanea y dibuja el trazo completo:
      // evita que la opacidad se acumule en tramos largos
      const ctx = layer.canvas.getContext('2d')!
      ctx.save()
      ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
      ctx.drawImage(d.layerSnapshot, 0, 0)
      if (isEraser) ctx.globalCompositeOperation = 'destination-out'
      ctx.globalAlpha = opacity
      const blurPx = (1 - hardness / 100) * size * 0.25
      if (blurPx > 0.4) ctx.filter = `blur(${blurPx}px)`
      ctx.drawImage(d.strokeCanvas!, 0, 0)
      ctx.restore()
      st.markDirty()
    },
    [width, height, store]
  )

  // ---------- Pincel mezclador ----------
  const mixerSegment = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const st = store()
      const d = dragRef.current
      if (!d || !d.paint) return
      const size = st.mixerSize
      const radius = Math.max(2, size / 2)
      const wet = st.mixerWet / 100
      const load = st.mixerLoad / 100

      // toma el color medio del lienzo bajo el pincel y lo mezcla con la pintura
      const comp = compositeRef.current
      if (comp && wet > 0) {
        const sampled = sampleAverageColor(comp, to.x, to.y, Math.max(2, radius * 0.55))
        const k = wet * 0.5
        d.paint = {
          r: Math.round(d.paint.r * (1 - k) + sampled.r * k),
          g: Math.round(d.paint.g * (1 - k) + sampled.g * k),
          b: Math.round(d.paint.b * (1 - k) + sampled.b * k),
        }
      }

      const alpha = 0.25 + 0.75 * load
      paintSegment(from, to, false, `rgb(${d.paint.r},${d.paint.g},${d.paint.b})`, alpha)
    },
    [store, paintSegment]
  )

  // ---------- Estampado de herramientas de retoque ----------
  // aplica la funcion de retoque a lo largo del trazo con espaciado proporcional al radio
  const retouchSegment = useCallback(
    (
      from: { x: number; y: number },
      to: { x: number; y: number }
    ) => {
      const st = store()
      const layer = paintTargetLayer(st)
      if (!layer) return
      const d = dragRef.current
      if (!d) return
      const tool = d.tool

      const size =
        tool === 'heal'
          ? st.healSize
          : tool === 'clone'
            ? st.cloneSize
            : tool === 'dodge'
              ? st.dodgeSize
              : tool === 'burn'
                ? st.burnSize
                : tool === 'blur-brush'
                  ? st.blurBrushSize
                  : st.sharpenBrushSize
      const radius = Math.max(2, size / 2)
      const strength =
        tool === 'heal'
          ? st.healStrength
          : tool === 'dodge' || tool === 'burn'
            ? st.dodgeExposure === undefined ? 25 : tool === 'burn' ? st.burnExposure : st.dodgeExposure
            : tool === 'blur-brush'
              ? st.blurBrushStrength
              : st.sharpenBrushStrength

      const selMask = st.selection ? st.selection.mask : null

      const dist = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2)
      const spacing = Math.max(1, radius / 3)
      const steps = Math.max(1, Math.ceil(dist / spacing))

      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const x = from.x + (to.x - from.x) * t
        const y = from.y + (to.y - from.y) * t
        const opts = {
          x,
          y,
          radius,
          hardness: 50,
          strength,
          selectionMask: selMask,
        }
        if (tool === 'heal') {
          healStamp(layer.canvas, opts)
        } else if (tool === 'blur-brush' || tool === 'sharpen-brush') {
          blurSharpenStamp(layer.canvas, opts, tool === 'blur-brush' ? 'blur' : 'sharpen')
        } else if (tool === 'dodge' || tool === 'burn') {
          dodgeBurnStamp(
            layer.canvas,
            opts,
            tool === 'dodge' ? 'dodge' : 'burn',
            tool === 'dodge' ? st.dodgeRange : st.burnRange
          )
        } else if (tool === 'clone') {
          if (!d.layerSnapshot || !d.cloneSource) continue
          const s = d.cloneSource
          // canvas local de estampado: evita mutar el estado del arrastre
          const stamp = document.createElement('canvas')
          stamp.width = Math.ceil(radius * 2)
          stamp.height = Math.ceil(radius * 2)
          const sc = stamp.getContext('2d')!
          // dibuja la porcion del snapshot alineada con el origen del clon
          sc.drawImage(d.layerSnapshot, x - s.x - radius, y - s.y - radius)
          // enmascara con un circulo suave
          sc.globalCompositeOperation = 'destination-in'
          const grad = sc.createRadialGradient(radius, radius, radius * 0.2, radius, radius, radius)
          grad.addColorStop(0, 'rgba(0,0,0,1)')
          grad.addColorStop(1, 'rgba(0,0,0,0)')
          sc.fillStyle = grad
          sc.fillRect(0, 0, stamp.width, stamp.height)
          sc.globalCompositeOperation = 'source-over'

          const ctx = layer.canvas.getContext('2d')!
          ctx.save()
          if (st.selection) ctx.clip(st.selection.path)
          ctx.globalAlpha = st.cloneOpacity / 100
          ctx.drawImage(stamp, x - radius, y - radius)
          ctx.restore()
        }
      }
      st.markDirty()
    },
    [store]
  )

  // ---------- eventos de puntero ----------
  const onPointerDown = (e: React.PointerEvent) => {
    if (!width || !height) return
    const st = store()
    const p = getDocPoint(e)
    const isHand = activeTool === 'hand' || spaceDownRef.current || e.button === 1
    try {
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // punteros sinteticos o invalidos: el flujo sigue funcionando sin captura
    }

    // transformacion libre activa: captura todos los gestos del lienzo
    if (!isHand && st.transform) {
      const t = st.transform
      const hit = hitTestTransformHandle(p, t.box, st.zoom, st.width, st.height)
      dragRef.current = {
        tool: 'transform',
        startX: p.x,
        startY: p.y,
        lastX: p.x,
        lastY: p.y,
        points: [],
        layerSnapshot: null,
        strokeCanvas: null,
        moved: false,
        cloneSource: null,
        penMovedPx: 0,
        paint: null,
        handle: hit ?? (pointInRotatedRect(p, t.box) ? 'move' : null),
        boxStart: { ...t.box },
      }
      return
    }

    if (isHand) {
      dragRef.current = {
        tool: 'hand',
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        points: [],
        layerSnapshot: null,
        strokeCanvas: null,
        moved: false,
        cloneSource: null,
        penMovedPx: 0,
        paint: null,
        handle: null,
        boxStart: null,
      }
      return
    }

    switch (activeTool) {
      case 'zoom': {
        const factor = e.altKey ? 1 / 1.5 : 1.5
        const newZoom = Math.max(0.02, Math.min(16, st.zoom * factor))
        // mantiene el punto bajo el cursor
        const containerRect = containerRef.current!.getBoundingClientRect()
        const ox = e.clientX - containerRect.left
        const oy = e.clientY - containerRect.top
        const nx = ox - ((ox - st.panX) * newZoom) / st.zoom
        const ny = oy - ((oy - st.panY) * newZoom) / st.zoom
        st.setView(newZoom, nx, ny)
        break
      }
      case 'eyedropper': {
        const comp = compositeRef.current
        if (!comp) return
        const x = Math.floor(p.x)
        const y = Math.floor(p.y)
        if (x < 0 || y < 0 || x >= comp.width || y >= comp.height) return
        const data = comp.getContext('2d')!.getImageData(x, y, 1, 1).data
        const hex = `#${[data[0], data[1], data[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`
        if (e.altKey) st.patch({ background: hex })
        else st.patch({ foreground: hex })
        break
      }
      case 'text': {
        const containerRect = containerRef.current!.getBoundingClientRect()
        setTextDraft({
          x: p.x,
          y: p.y,
          screenX: e.clientX - containerRect.left,
          screenY: e.clientY - containerRect.top,
          value: '',
        })
        setTimeout(() => textInputRef.current?.focus(), 30)
        break
      }
      case 'fill': {
        st.applyFloodFill(Math.floor(p.x), Math.floor(p.y), st.foreground, st.fillTolerance)
        break
      }
      case 'wand': {
        st.applyWandSelection(Math.floor(p.x), Math.floor(p.y), st.wandTolerance, st.wandContiguous)
        break
      }
      case 'clone': {
        // Alt + clic define el punto de origen del clon
        if (e.altKey) {
          cloneSourceRef.current = { x: p.x, y: p.y }
          break
        }
        if (!cloneSourceRef.current) break
        dragRef.current = {
          tool: 'clone',
          startX: p.x,
          startY: p.y,
          lastX: p.x,
          lastY: p.y,
          points: [p],
          layerSnapshot: snapshotOfActiveLayer(st),
          strokeCanvas: null,
          moved: false,
          cloneSource: cloneSourceRef.current,
          penMovedPx: 0,
          paint: null,
          handle: null,
          boxStart: null,
        }
        // estampa el primer toque
        retouchSegment(p, p)
        break
      }
      case 'heal':
      case 'dodge':
      case 'burn':
      case 'blur-brush':
      case 'sharpen-brush': {
        dragRef.current = {
          tool: activeTool,
          startX: p.x,
          startY: p.y,
          lastX: p.x,
          lastY: p.y,
          points: [p],
          layerSnapshot: null,
          strokeCanvas: null,
          moved: false,
          cloneSource: null,
          penMovedPx: 0,
          paint: null,
          handle: null,
          boxStart: null,
        }
        retouchSegment(p, p)
        break
      }
      case 'pen': {
        // clic sobre el primer ancla cierra el trazado
        const pp = st.penPath
        if (pp && pp.points.length >= 3) {
          const first = pp.points[0]
          if (Math.hypot(p.x - first.x, p.y - first.y) < 10 / st.zoom) {
            st.penClosePath()
            drawOverlay()
            break
          }
        }
        st.penAddPoint(p)
        dragRef.current = {
          tool: 'pen',
          startX: p.x,
          startY: p.y,
          lastX: p.x,
          lastY: p.y,
          points: [],
          layerSnapshot: null,
          strokeCanvas: null,
          moved: false,
          cloneSource: null,
          penMovedPx: 0,
          paint: null,
          handle: null,
          boxStart: null,
        }
        break
      }
      case 'mixer': {
        dragRef.current = {
          tool: 'mixer',
          startX: p.x,
          startY: p.y,
          lastX: p.x,
          lastY: p.y,
          points: [p],
          layerSnapshot: null,
          strokeCanvas: null,
          moved: false,
          cloneSource: null,
          penMovedPx: 0,
          paint: hexToRgb(st.foreground),
          handle: null,
          boxStart: null,
        }
        mixerSegment(p, p)
        break
      }
      default: {
        dragRef.current = {
          tool: activeTool,
          startX: p.x,
          startY: p.y,
          lastX: p.x,
          lastY: p.y,
          points: [p],
          layerSnapshot: null,
          strokeCanvas: null,
          moved: false,
          cloneSource: null,
          penMovedPx: 0,
          paint: null,
          handle: null,
          boxStart: null,
        }
        if (activeTool === 'move') {
          const layer = st.layers.find((l) => l.id === st.activeLayerId)
          if (layer && layer.kind === 'pixel') {
            dragRef.current.layerSnapshot = document.createElement('canvas')
            dragRef.current.layerSnapshot.width = layer.canvas.width
            dragRef.current.layerSnapshot.height = layer.canvas.height
            dragRef.current.layerSnapshot.getContext('2d')!.drawImage(layer.canvas, 0, 0)
          }
        }
        break
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!width || !height) return
    const st = store()
    const p = getDocPoint(e)
    st.setCursorPos({ x: Math.floor(p.x), y: Math.floor(p.y) })

    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.lastX
    const dy = e.clientY - d.lastY
    d.lastX = activeTool === 'hand' ? e.clientX : p.x
    d.lastY = activeTool === 'hand' ? e.clientY : p.y
    d.moved = true

    switch (d.tool) {
      case 'hand': {
        st.setView(st.zoom, st.panX + dx, st.panY + dy)
        break
      }
      case 'brush':
      case 'eraser': {
        paintSegment({ x: d.startX, y: d.startY }, p, d.tool === 'eraser')
        d.startX = p.x
        d.startY = p.y
        drawOverlay()
        break
      }
      case 'heal':
      case 'dodge':
      case 'burn':
      case 'blur-brush':
      case 'sharpen-brush':
      case 'clone': {
        retouchSegment({ x: d.startX, y: d.startY }, p)
        d.startX = p.x
        d.startY = p.y
        break
      }
      case 'mixer': {
        mixerSegment({ x: d.startX, y: d.startY }, p)
        d.startX = p.x
        d.startY = p.y
        break
      }
      case 'pen': {
        d.penMovedPx = Math.hypot(p.x - d.startX, p.y - d.startY)
        d.moved = d.penMovedPx > 2
        // tirador de curva: hOut hacia el cursor, hIn espejado
        st.penSetLastHandles({ x: p.x, y: p.y })
        drawOverlay()
        break
      }
      case 'transform': {
        const t = st.transform
        if (!t || !d.boxStart || !d.handle) break
        if (d.handle === 'move') {
          st.updateTransformBox({
            cx: d.boxStart.cx + (p.x - d.startX),
            cy: d.boxStart.cy + (p.y - d.startY),
          })
        } else if (d.handle === 'rotate') {
          const a0 = Math.atan2(d.startY - d.boxStart.cy, d.startX - d.boxStart.cx)
          const a1 = Math.atan2(p.y - d.boxStart.cy, p.x - d.boxStart.cx)
          let rot = d.boxStart.rot + (a1 - a0)
          if (e.shiftKey) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12)
          st.updateTransformBox({ rot })
        } else {
          applyTransformHandle(st.updateTransformBox, d, p, e.shiftKey)
        }
        drawOverlay()
        break
      }
      case 'move': {
        if (!d.layerSnapshot) return
        const layer = st.layers.find((l) => l.id === st.activeLayerId)
        if (!layer) return
        const totalDx = Math.round(p.x - d.startX)
        const totalDy = Math.round(p.y - d.startY)
        const ctx = layer.canvas.getContext('2d')!
        ctx.clearRect(0, 0, st.width, st.height)
        ctx.drawImage(d.layerSnapshot, totalDx, totalDy)
        st.markDirty()
        break
      }
      case 'lasso': {
        d.points.push(p)
        drawOverlay()
        break
      }
      default: {
        drawOverlay()
        break
      }
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const st = store()
    const d = dragRef.current
    if (!d) return
    const p = getDocPoint(e)
    dragRef.current = null

    switch (d.tool) {
      case 'hand':
        break
      case 'brush':
      case 'eraser':
        // solo registra el paso si el trazo se aplico a una capa de pixeles
        if (d.layerSnapshot) st.pushHistory(d.tool === 'brush' ? 'Pincel' : 'Borrador')
        break
      case 'mixer':
        if (d.layerSnapshot) st.pushHistory('Pincel mezclador')
        break
      case 'pen':
        // sin arrastre: ancla de esquina (sin tiradores); con arrastre: punto suave
        if (d.penMovedPx < 4) st.penSetLastCorner()
        drawOverlay()
        break
      case 'transform':
        // la transformacion se confirma con Enter o con los botones de la barra
        break
      case 'heal':
        if (d.layerSnapshot) st.pushHistory('Pincel corrector')
        break
      case 'clone':
        if (d.layerSnapshot) st.pushHistory('Tampon de clonar')
        break
      case 'dodge':
        if (d.layerSnapshot) st.pushHistory('Sobreexponer')
        break
      case 'burn':
        if (d.layerSnapshot) st.pushHistory('Subexponer')
        break
      case 'blur-brush':
        if (d.layerSnapshot) st.pushHistory('Desenfocar')
        break
      case 'sharpen-brush':
        if (d.layerSnapshot) st.pushHistory('Enfocar')
        break
      case 'move':
        st.pushHistory('Mover capa')
        break
      case 'rect-select': {
        const r = rectFromPoints(d.startX, d.startY, p.x, p.y)
        if (r.w < 2 || r.h < 2) {
          st.deselect()
        } else {
          const path = new Path2D()
          path.rect(r.x, r.y, r.w, r.h)
          st.setSelection(makeSelection('rect', path, st.width, st.height))
        }
        break
      }
      case 'ellipse-select': {
        const r = rectFromPoints(d.startX, d.startY, p.x, p.y)
        if (r.w < 2 || r.h < 2) {
          st.deselect()
        } else {
          const path = new Path2D()
          path.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2)
          st.setSelection(makeSelection('ellipse', path, st.width, st.height))
        }
        break
      }
      case 'lasso': {
        if (d.points.length < 3) {
          st.deselect()
        } else {
          const path = new Path2D()
          path.moveTo(d.points[0].x, d.points[0].y)
          for (const pt of d.points.slice(1)) path.lineTo(pt.x, pt.y)
          path.closePath()
          st.setSelection(makeSelection('lasso', path, st.width, st.height))
        }
        break
      }
      case 'crop': {
        const r = rectFromPoints(d.startX, d.startY, p.x, p.y)
        if (r.w < 4 || r.h < 4) st.setCropRect(null)
        else st.setCropRect(normalizeRect(r))
        drawOverlay()
        break
      }
      case 'shape-rect':
      case 'shape-ellipse':
      case 'shape-line': {
        const kind = d.tool.replace('shape-', '') as 'rect' | 'ellipse' | 'line'
        st.commitShape(kind, d.startX, d.startY, p.x, p.y)
        break
      }
      case 'gradient': {
        st.commitGradient(d.startX, d.startY, p.x, p.y)
        break
      }
    }
    drawOverlay()
  }

  // ---------- rueda: pan y zoom ----------
  const onWheel = (e: React.WheelEvent) => {
    const st = store()
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const newZoom = Math.max(0.02, Math.min(16, st.zoom * factor))
      const containerRect = containerRef.current!.getBoundingClientRect()
      const ox = e.clientX - containerRect.left
      const oy = e.clientY - containerRect.top
      const nx = ox - ((ox - st.panX) * newZoom) / st.zoom
      const ny = oy - ((oy - st.panY) * newZoom) / st.zoom
      st.setView(newZoom, nx, ny)
    } else {
      st.setView(st.zoom, st.panX - e.deltaX, st.panY - e.deltaY)
    }
  }

  // ---------- arrastrar y soltar imagen ----------
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) void store().openImageFile(file)
  }

  const commitText = () => {
    if (!textDraft) return
    if (textDraft.value.trim()) {
      store().commitText(textDraft.value, textDraft.x, textDraft.y)
    }
    setTextDraft(null)
  }

  if (!width || !height) {
    return (
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center bg-[#191919] text-muted-foreground text-sm"
      >
        <div className="text-center space-y-3">
          <p>Abre una imagen o crea un documento nuevo para empezar</p>
          <button
            type="button"
            className="text-xs underline underline-offset-4 hover:text-foreground"
            onClick={() => store().setDialog('new-doc')}
          >
            Crear documento nuevo
          </button>
        </div>
      </div>
    )
  }

  const dispW = width * zoom
  const dispH = height * zoom

  return (
    <div
      ref={containerRef}
      className="flex-1 relative overflow-hidden bg-[#191919]"
      onWheel={onWheel}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div
        className="absolute left-0 top-0"
        style={{ transform: `translate3d(${panX}px, ${panY}px, 0)` }}
      >
        {/* sombra y tablero de transparencia */}
        <div
          className="absolute bg-[#191919]"
          style={{
            left: -12,
            top: -12,
            width: dispW + 24,
            height: dispH + 24,
            boxShadow: '0 4px 24px rgba(0,0,0,0.55)',
          }}
        />
        <div
          className="absolute editor-checkerboard"
          style={{ width: dispW, height: dispH }}
          aria-hidden
        />
        <canvas
          ref={compositeRef}
          className="absolute left-0 top-0"
          style={{
            width: dispW,
            height: dispH,
            imageRendering: zoom >= 3 ? 'pixelated' : 'auto',
          }}
        />
        <canvas
          ref={overlayRef}
          className="absolute left-0 top-0 touch-none"
          style={{ width: dispW, height: dispH, cursor: cursorForTool(activeTool) }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => store().setCursorPos(null)}
        />
      </div>

      {/* editor de texto flotante */}
      {textDraft && (
        <textarea
          ref={textInputRef}
          className="absolute z-20 bg-[#2a2a2a] text-foreground border border-amber-500 rounded px-2 py-1 text-sm resize-none outline-none"
          style={{
            left: textDraft.screenX,
            top: textDraft.screenY,
            minWidth: 180,
            minHeight: 44,
          }}
          value={textDraft.value}
          placeholder="Escribe el texto..."
          onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commitText()
            }
            if (e.key === 'Escape') setTextDraft(null)
          }}
          onBlur={commitText}
        />
      )}
    </div>
  )
}

function cursorForTool(tool: string): string {
  switch (tool) {
    case 'hand':
      return 'grab'
    case 'zoom':
      return 'zoom-in'
    case 'text':
      return 'text'
    case 'move':
      return 'move'
    case 'eyedropper':
      return 'crosshair'
    case 'fill':
      return 'crosshair'
    case 'gradient':
      return 'crosshair'
    case 'crop':
      return 'crosshair'
    case 'brush':
      return 'crosshair'
    case 'pencil':
      return 'crosshair'
    case 'mixer':
      return 'crosshair'
    case 'pen':
      return 'crosshair'
    case 'eraser':
      return 'cell'
    default:
      return 'default'
  }
}
