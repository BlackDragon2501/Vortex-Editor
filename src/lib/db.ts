// Cliente Prisma de Vórtex Editor con creación diferida (lazy).
//
// ¿Por qué no se instancia `db` al arrancar el módulo?
// - En `next build` (Vercel) los módulos de ruta se importan al recolectar
//   datos de página: instanciar Prisma ahí sin DATABASE_URL rompería el build.
//   Con getDB() la instancia se crea en la primera petición, nunca en el build.
//
// ¿Por qué ensureSchema()?
// - En Vercel la única carpeta escribible es /tmp y es EFÍMERA: cada instancia
//   fría arranca con un archivo SQLite nuevo y vacío. ensureSchema() crea la
//   tabla en el primer uso, sin migraciones, para que la API funcione siempre.
//   Para persistencia real y duradera, usar un Postgres gestionado (Neon,
//   Supabase) o Turso ajustando prisma/schema.prisma (ver README).

import { PrismaClient } from '@prisma/client'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const globalForPrisma = globalThis as unknown as {
  __vortexEditorPrisma?: PrismaClient
  __vortexEditorSchemaReady?: boolean
}

// DDL equivalente al modelo EditorProject de prisma/schema.prisma.
// CREATE TABLE IF NOT EXISTS: idempotente, no toca bases ya migradas (local).
const EDITOR_PROJECT_DDL = `
CREATE TABLE IF NOT EXISTS "EditorProject" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "thumbnail" TEXT NOT NULL,
  "data" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
)`

function prepareSqliteFile() {
  const url = process.env.DATABASE_URL ?? ''
  const match = /^file:(.+)$/.exec(url)
  if (!match) return
  const path = resolve(match[1].replace(/^\/\//, '/'))
  try {
    mkdirSync(dirname(path), { recursive: true })
    if (!existsSync(path)) writeFileSync(path, '') // 0 bytes = base SQLite vacía válida
  } catch {
    // Sistema de archivos de solo lectura: el error real lo dará la consulta.
  }
}

export function getDB(): PrismaClient {
  if (!globalForPrisma.__vortexEditorPrisma) {
    globalForPrisma.__vortexEditorPrisma = new PrismaClient({
      log: process.env.NODE_ENV === 'production' ? [] : ['query'],
    })
  }
  return globalForPrisma.__vortexEditorPrisma
}

export async function ensureSchema(): Promise<void> {
  if (globalForPrisma.__vortexEditorSchemaReady) return
  prepareSqliteFile()
  await getDB().$executeRawUnsafe(EDITOR_PROJECT_DDL)
  globalForPrisma.__vortexEditorSchemaReady = true
}
