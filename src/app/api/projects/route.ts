// API de proyectos de Vórtex Editor.
// GET    /api/projects        -> lista (sin datos pesados)
// POST   /api/projects        -> guarda un proyecto nuevo
// GET    /api/projects/:id    -> carga el proyecto completo
// PUT    /api/projects/:id    -> sobrescribe un proyecto existente
// DELETE /api/projects/:id    -> elimina un proyecto

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const MAX_DATA_BYTES = 64 * 1024 * 1024 // 64 MB por proyecto

export async function GET() {
  try {
    const projects = await db.editorProject.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        width: true,
        height: true,
        thumbnail: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return NextResponse.json({ projects })
  } catch (err) {
    console.error('GET /api/projects', err)
    return NextResponse.json({ error: 'No se pudo leer la biblioteca de proyectos' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : 'Proyecto Vórtex'
    const width = Number(body?.width)
    const height = Number(body?.height)
    const thumbnail = typeof body?.thumbnail === 'string' ? body.thumbnail : ''
    const data = typeof body?.data === 'string' ? body.data : ''
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      return NextResponse.json({ error: 'Dimensiones invalidas' }, { status: 400 })
    }
    if (!data.startsWith('{')) {
      return NextResponse.json({ error: 'Datos de proyecto invalidos' }, { status: 400 })
    }
    if (data.length > MAX_DATA_BYTES) {
      return NextResponse.json({ error: 'El proyecto es demasiado grande para guardarlo' }, { status: 413 })
    }
    const project = await db.editorProject.create({
      data: { name, width: Math.round(width), height: Math.round(height), thumbnail, data },
      select: { id: true, name: true, updatedAt: true },
    })
    return NextResponse.json({ project }, { status: 201 })
  } catch (err) {
    console.error('POST /api/projects', err)
    return NextResponse.json({ error: 'No se pudo guardar el proyecto' }, { status: 500 })
  }
}
