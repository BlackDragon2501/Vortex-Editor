// Operaciones sobre un proyecto concreto de Vórtex Editor.

import { NextResponse } from 'next/server'
import { ensureSchema, getDB } from '@/lib/db'

const MAX_DATA_BYTES = 64 * 1024 * 1024

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    await ensureSchema()
    const project = await getDB().editorProject.findUnique({
      where: { id },
      select: { id: true, name: true, width: true, height: true, data: true, updatedAt: true },
    })
    if (!project) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })
    return NextResponse.json({ project })
  } catch (err) {
    console.error('GET /api/projects/[id]', err)
    return NextResponse.json({ error: 'No se pudo cargar el proyecto' }, { status: 500 })
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const body = await req.json()
    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : undefined
    const width = body?.width === undefined ? undefined : Number(body.width)
    const height = body?.height === undefined ? undefined : Number(body.height)
    const thumbnail = typeof body?.thumbnail === 'string' ? body.thumbnail : undefined
    const data = typeof body?.data === 'string' ? body.data : undefined
    if (data !== undefined) {
      if (!data.startsWith('{')) {
        return NextResponse.json({ error: 'Datos de proyecto invalidos' }, { status: 400 })
      }
      if (data.length > MAX_DATA_BYTES) {
        return NextResponse.json({ error: 'El proyecto es demasiado grande para guardarlo' }, { status: 413 })
      }
    }
    const project = await getDB().editorProject.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(width !== undefined && Number.isFinite(width) ? { width: Math.round(width) } : {}),
        ...(height !== undefined && Number.isFinite(height) ? { height: Math.round(height) } : {}),
        ...(thumbnail !== undefined ? { thumbnail } : {}),
        ...(data !== undefined ? { data } : {}),
      },
      select: { id: true, name: true, updatedAt: true },
    })
    return NextResponse.json({ project })
  } catch (err) {
    console.error('PUT /api/projects/[id]', err)
    return NextResponse.json({ error: 'No se pudo actualizar el proyecto' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    await getDB().editorProject.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/projects/[id]', err)
    return NextResponse.json({ error: 'No se pudo eliminar el proyecto' }, { status: 500 })
  }
}
