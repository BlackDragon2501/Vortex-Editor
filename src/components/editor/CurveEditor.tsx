'use client'

// Editor de curvas interactivo estilo Photoshop: puntos arrastrables con
// interpolacion cubica monotona, histograma de fondo y rejilla de tonos.

import { useCallback, useEffect, useRef } from 'react'
import type { CurvePoint } from '@/lib/editor/types'
import { buildLUT } from '@/lib/editor/adjustments'
import { cn } from '@/lib/utils'

const SIZE = 255 // espacio logico 0-255

export function HistogramCanvas({
  histogram,
  className,
  height = 48,
}: {
  histogram: { r: number[]; g: number[]; b: number[]; max: number } | null
  className?: string
  height?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const w = 256
    canvas.width = w
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, w, height)
    if (!histogram) return
    // barras por canal con mezcla aditiva tipo pantalla
    const drawChannel = (data: number[], color: string) => {
      ctx.globalCompositeOperation = 'screen'
      ctx.fillStyle = color
      for (let v = 0; v < 256; v++) {
        const hgt = Math.sqrt(data[v] / histogram.max) * height
        if (hgt <= 0) continue
        ctx.fillRect(v, height - hgt, 1, hgt)
      }
    }
    drawChannel(histogram.r, 'rgba(255,64,64,0.85)')
    drawChannel(histogram.g, 'rgba(64,255,110,0.85)')
    drawChannel(histogram.b, 'rgba(90,120,255,0.85)')
    ctx.globalCompositeOperation = 'source-over'
  }, [histogram, height])

  return <canvas ref={ref} className={cn('block rounded-[3px] bg-black/50 border border-border', className)} style={{ width: 256, height }} aria-label="Histograma" />
}

interface CurveEditorProps {
  points: CurvePoint[]
  onChange: (points: CurvePoint[]) => void
  histogram?: { r: number[]; g: number[]; b: number[]; lum: number[]; max: number } | null
  channel?: 'rgb' | 'r' | 'g' | 'b'
  className?: string
}

export function CurveEditor({ points, onChange, histogram, channel = 'rgb', className }: CurveEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragIndexRef = useRef<number | null>(null)
  const size = 280
  const pad = 10
  const inner = size - pad * 2

  // convierte coordenadas de documento (0-255) a pixeles SVG (y invertida)
  const toSvg = useCallback(
    (p: CurvePoint): { x: number; y: number } => ({
      x: pad + (p.x / SIZE) * inner,
      y: pad + (1 - p.y / SIZE) * inner,
    }),
    [inner]
  )
  const fromSvg = useCallback(
    (sx: number, sy: number): CurvePoint => ({
      x: Math.max(0, Math.min(255, Math.round(((sx - pad) / inner) * SIZE))),
      y: Math.max(0, Math.min(255, Math.round(((1 - (sy - pad) / inner)) * SIZE))),
    }),
    [inner]
  )

  const sorted = [...points].sort((a, b) => a.x - b.x)

  // traza la curva con la misma LUT que aplicara el motor
  const lut = buildLUT(sorted)
  let d = ''
  for (let v = 0; v <= 255; v += 2) {
    const pt = toSvg({ x: v, y: lut[v] })
    d += `${v === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)} `
  }

  const pointerPos = (e: PointerEvent | React.PointerEvent): { sx: number; sy: number } | null => {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    const scale = size / rect.width
    return {
      sx: (e.clientX - rect.left) * scale,
      sy: (e.clientY - rect.top) * scale,
    }
  }

  const handlePointerDown = (e: React.PointerEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    const realIdx = points.findIndex((p) => p === sorted[index])
    const isEndpoint = sorted[index].x === 0 || sorted[index].x === 255
    if (!isEndpoint && (e.detail === 2 || e.button === 2)) {
      // doble clic o clic derecho: elimina el punto
      e.preventDefault()
      const next = points.filter((_, i) => i !== realIdx)
      onChange(next)
      return
    }
    dragIndexRef.current = realIdx
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const idx = dragIndexRef.current
      if (idx === null || idx >= points.length) return
      const pos = pointerPos(e)
      if (!pos) return
      const p = fromSvg(pos.sx, pos.sy)
      const isEndpoint = points[idx].x === 0 || points[idx].x === 255
      const next = points.map((pt, i) => {
        if (i !== idx) return pt
        if (isEndpoint) return { x: pt.x, y: p.y } // extremos solo mueven verticalmente
        // limita entre vecinos para mantener el orden
        const prev = points[idx - 1]
        const nextPt = points[idx + 1]
        const minX = prev ? Math.max(prev.x + 1, 1) : 1
        const maxX = nextPt ? Math.min(nextPt.x - 1, 254) : 254
        return { x: Math.max(minX, Math.min(maxX, p.x)), y: p.y }
      })
      onChange(next)
    }
    const up = () => {
      dragIndexRef.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [points, onChange, fromSvg])

  const handleBackgroundClick = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const pos = pointerPos(e)
    if (!pos) return
    const p = fromSvg(pos.sx, pos.sy)
    // no anade si esta demasiado cerca de un punto existente
    if (sorted.some((q) => Math.abs(q.x - p.x) < 6 && Math.abs(q.y - p.y) < 18)) return
    const next = [...points, p].sort((a, b) => a.x - b.x)
    const newIdx = next.indexOf(p)
    onChange(next)
    // el gesto continua como arrastre del punto recien creado
    dragIndexRef.current = newIdx
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }

  const channelColor =
    channel === 'r' ? '#f87171' : channel === 'g' ? '#4ade80' : channel === 'b' ? '#60a5fa' : '#fbbf24'

  return (
    <div className={cn('select-none', className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        className="block rounded-[4px] bg-black/55 border border-border touch-none cursor-crosshair"
        onPointerDown={handleBackgroundClick}
        onContextMenu={(e) => e.preventDefault()}
        role="application"
        aria-label="Editor de curvas"
      >
        {/* histograma de fondo */}
        {histogram && (
          <g opacity="0.35">
            {histogram.lum.map((count, v) => {
              if (v % 2 !== 0 || count <= 0) return null
              const hgt = Math.sqrt(count / histogram.max) * inner
              return (
                <rect
                  key={v}
                  x={pad + (v / SIZE) * inner}
                  y={pad + inner - hgt}
                  width={inner / 128}
                  height={hgt}
                  fill="#9ca3af"
                />
              )
            })}
          </g>
        )}
        {/* rejilla de cuartos */}
        <g stroke="#3f3f46" strokeWidth="1" strokeDasharray="3 3">
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={`v${f}`} x1={pad + inner * f} y1={pad} x2={pad + inner * f} y2={pad + inner} />
          ))}
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={`h${f}`} x1={pad} y1={pad + inner * f} x2={pad + inner} y2={pad + inner * f} />
          ))}
        </g>
        {/* borde */}
        <rect x={pad} y={pad} width={inner} height={inner} fill="none" stroke="#52525b" strokeWidth="1" />
        {/* diagonal de referencia */}
        <line x1={pad} y1={pad + inner} x2={pad + inner} y2={pad} stroke="#52525b" strokeWidth="1" strokeDasharray="4 4" />
        {/* curva */}
        <path d={d} fill="none" stroke={channelColor} strokeWidth="2" strokeLinecap="round" />
        {/* puntos de control */}
        {sorted.map((p, i) => {
          const s = toSvg(p)
          const isEndpoint = p.x === 0 || p.x === 255
          return (
            <circle
              key={`${p.x}-${i}`}
              cx={s.x}
              cy={s.y}
              r={isEndpoint ? 4 : 5.5}
              fill={isEndpoint ? '#18181b' : channelColor}
              stroke={channelColor}
              strokeWidth="2"
              className="cursor-grab"
              style={{ pointerEvents: 'all' }}
              onPointerDown={(e) => handlePointerDown(e, i)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (!isEndpoint) {
                  const realIdx = points.findIndex((q) => q === p)
                  if (realIdx >= 0) onChange(points.filter((_, k) => k !== realIdx))
                }
              }}
            />
          )
        })}
      </svg>
      <p className="mt-1.5 text-[10.5px] text-muted-foreground leading-relaxed">
        Clic: anadir punto - Arrastrar: mover - Doble clic o clic derecho: eliminar
      </p>
    </div>
  )
}
