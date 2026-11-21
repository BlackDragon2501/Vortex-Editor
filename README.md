# Vórtex Editor

Editor de imágenes profesional de **Vortex Company**: capas (16 modos de fusión), capas de
ajuste, curvas/niveles, historial (24 pasos), selecciones, filtros, herramientas de dibujo,
transformación libre y exportación/importación de proyectos. **Gratis, sin anuncios y 100%
local**: tus imágenes no se suben a ningún servidor.

## Desarrollo

```bash
bun install
bun run dev        # http://localhost:3000
bun run lint
bun run db:push    # crea la base de datos SQLite local (proyectos guardados)
```

Copia `.env.example` a `.env` para configurar la ruta de la base de datos local.

## Base de datos

Los proyectos guardados ("Biblioteca") usan Prisma + SQLite vía `/api/projects`.
Para producción real en Vercel, la SQLite local no persiste: sustituye el datasource
por un proveedor gestionado (Neon/Supabase/etc.) ajustando `prisma/schema.prisma`.

## Despliegue en Vercel

1. Sube este repositorio a GitHub (ya está preparado como repo independiente).
2. Importa el repo en Vercel (framework: Next.js detectado automáticamente).
3. Copia la URL entregada por Vercel en el portal Vórtex Studio
   (`repos/vortex-portal/src/lib/apps.ts` → `APP_URLS.editor`).

## Suite Vórtex

- Portal: **Vórtex Studio** (hub con las URLs de cada app)
- Apps: **Vórtex Editor**, **Vórtex PDF**, Vórtex Music (independiente)

---

Derechos Reservados © 2026 Vortex Company. Todos los derechos reservados. Vórtex Studio
Soporte: vortexmusic.soporte.app@gmail.com
