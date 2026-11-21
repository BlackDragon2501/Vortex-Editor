'use client'

import { useEffect, useRef } from 'react'
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from '@/components/ui/menubar'
import { useEditor } from '@/lib/editor/store'
import { PORTAL_URL } from '@/lib/portal'
import { PROJECT_EXT } from '@/lib/editor/project'
import { VortexLogo } from './Branding'
import { House } from 'lucide-react'

export function MenuBar() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)
  const store = useEditor()

  const handleOpenFile = () => {
    fileInputRef.current?.click()
  }

  const handleOpenProject = () => {
    projectInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void store.openImageFile(file)
    e.target.value = ''
  }

  const handleProjectChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void store.importProjectFile(file)
    e.target.value = ''
  }

  // el atajo Ctrl+O emite este evento desde EditorShell
  useEffect(() => {
    const handler = () => handleOpenFile()
    window.addEventListener('image-editor:open-file', handler)
    return () => window.removeEventListener('image-editor:open-file', handler)
  }, [])

  return (
    <div className="flex items-center gap-1 border-b border-border bg-[#1c1c1c] px-2 h-9 shrink-0">
      {/* abrir el portal Vórtex Studio cuando su URL de Vercel esté configurada (src/lib/portal.ts) */}
      {PORTAL_URL && (
        <a
          href={PORTAL_URL}
          target="_blank"
          rel="noopener,noreferrer"
          className="p-1.5 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground"
          aria-label="Abrir Vórtex Studio"
          title="Abrir Vórtex Studio"
        >
          <House className="w-4 h-4" />
        </a>
      )}
      <div className="flex items-center gap-2 pr-3 mr-1 border-r border-border">
        <VortexLogo className="w-5 h-5" />
        <span className="text-xs font-semibold tracking-wide text-foreground">
          <span className="text-violet-400">Vórtex</span> Editor
        </span>
      </div>

      <Menubar className="border-none bg-transparent h-8 shadow-none">
        <MenubarMenu>
          <MenubarTrigger className="text-xs">Archivo</MenubarTrigger>
          <MenubarContent align="start">
            <MenubarItem onClick={() => store.setDialog('new-doc')}>
              Nuevo documento <MenubarShortcut>Ctrl+N</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={handleOpenFile}>
              Abrir imagen... <MenubarShortcut>Ctrl+O</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={handleOpenProject}>
              Importar proyecto ({PROJECT_EXT})
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem
              onClick={() => void store.saveProjectToCloud()}
              disabled={!store.width || store.cloudBusy}
            >
              Guardar en la nube <MenubarShortcut>Ctrl+Alt+S</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => store.setDialog('projects')}>
              Biblioteca de proyectos... <MenubarShortcut>Ctrl+Shift+O</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={store.exportProjectFile} disabled={!store.width}>
              Exportar proyecto ({PROJECT_EXT})
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={() => store.setDialog('export')}>
              Exportar imagen... <MenubarShortcut>Ctrl+S</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="text-xs">Editar</MenubarTrigger>
          <MenubarContent align="start">
            <MenubarItem onClick={store.undo} disabled={store.historyIndex <= 0}>
              Deshacer <MenubarShortcut>Ctrl+Z</MenubarShortcut>
            </MenubarItem>
            <MenubarItem
              onClick={store.redo}
              disabled={store.historyIndex >= store.history.length - 1}
            >
              Rehacer <MenubarShortcut>Ctrl+Shift+Z</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem
              onClick={store.enterTransform}
              disabled={!store.activeLayerId || !store.layers.some((l) => l.id === store.activeLayerId && l.kind === 'pixel') || !!store.transform}
            >
              Transformacion libre <MenubarShortcut>Ctrl+T</MenubarShortcut>
            </MenubarItem>
            {!!store.transform && (
              <MenubarItem onClick={store.commitTransform}>
                Aplicar transformacion <MenubarShortcut>Enter</MenubarShortcut>
              </MenubarItem>
            )}
            <MenubarSeparator />
            <MenubarItem onClick={() => store.fillSelection(store.foreground)}>
              Rellenar con color frontal
            </MenubarItem>
            <MenubarItem onClick={store.deleteSelectionPixels}>
              Borrar <MenubarShortcut>Supr</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => store.setDialog('inpaint')} disabled={!store.selection}>
              Relleno segun contenido (IA)...
            </MenubarItem>
            <MenubarItem onClick={store.applyAutoEnhance} disabled={!store.activeLayerId}>
              Mejora automatica (IA)
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={store.selectAll}>
              Seleccionar todo <MenubarShortcut>Ctrl+A</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={store.deselect} disabled={!store.selection}>
              Deseleccionar <MenubarShortcut>Ctrl+D</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="text-xs">Seleccion</MenubarTrigger>
          <MenubarContent align="start">
            <MenubarItem onClick={store.selectAll}>
              Seleccionar todo <MenubarShortcut>Ctrl+A</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={store.deselect} disabled={!store.selection}>
              Deseleccionar <MenubarShortcut>Ctrl+D</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={store.invertSelection}>Invertir seleccion <MenubarShortcut>Shift+Ctrl+I</MenubarShortcut></MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="text-xs">Capa</MenubarTrigger>
          <MenubarContent align="start">
            <MenubarItem onClick={store.addLayer}>Nueva capa</MenubarItem>
            <MenubarItem
              onClick={() => store.activeLayerId && store.duplicateLayer(store.activeLayerId)}
              disabled={!store.activeLayerId}
            >
              Duplicar capa
            </MenubarItem>
            <MenubarItem
              onClick={() => store.activeLayerId && store.deleteLayer(store.activeLayerId)}
              disabled={!store.activeLayerId || store.layers.length <= 1}
            >
              Eliminar capa
            </MenubarItem>
            <MenubarSeparator />
            <MenubarSub>
              <MenubarSubTrigger className="text-xs">Nueva capa de ajuste</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarItem onClick={() => store.addAdjustmentLayer('brightness-contrast')}>
                  Brillo y contraste...
                </MenubarItem>
                <MenubarItem onClick={() => store.addAdjustmentLayer('levels')}>
                  Niveles...
                </MenubarItem>
                <MenubarItem onClick={() => store.addAdjustmentLayer('curves')}>
                  Curvas...
                </MenubarItem>
                <MenubarItem onClick={() => store.addAdjustmentLayer('hue-saturation')}>
                  Tono y saturacion...
                </MenubarItem>
                <MenubarItem onClick={() => store.addAdjustmentLayer('color-balance')}>
                  Balance de color...
                </MenubarItem>
                <MenubarItem onClick={() => store.addAdjustmentLayer('vibrance')}>
                  Intensidad (Vibrance)...
                </MenubarItem>
                <MenubarItem onClick={() => store.addAdjustmentLayer('grayscale')}>
                  Blanco y negro
                </MenubarItem>
                <MenubarItem onClick={() => store.addAdjustmentLayer('invert')}>
                  Invertir colores
                </MenubarItem>
                <MenubarItem onClick={() => store.addAdjustmentLayer('sepia')}>Sepia</MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSeparator />
            <MenubarItem onClick={store.mergeDown} disabled={!store.activeLayerId || store.layers.findIndex((l) => l.id === store.activeLayerId) <= 0}>
              Combinar hacia abajo
            </MenubarItem>
            <MenubarItem onClick={store.flattenImage} disabled={store.layers.length <= 1}>
              Aplanar imagen
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="text-xs">Imagen</MenubarTrigger>
          <MenubarContent align="start">
            <MenubarItem onClick={() => store.setDialog('image-size')}>Tamano de imagen...</MenubarItem>
            <MenubarItem onClick={() => store.setDialog('canvas-size')}>Tamano de lienzo...</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={() => store.rotateDoc('cw')}>
              Rotar 90 grados CW <MenubarShortcut />
            </MenubarItem>
            <MenubarItem onClick={() => store.rotateDoc('ccw')}>Rotar 90 grados CCW</MenubarItem>
            <MenubarItem onClick={() => store.flipDoc('h')}>Voltear horizontal</MenubarItem>
            <MenubarItem onClick={() => store.flipDoc('v')}>Voltear vertical</MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="text-xs">Ajuste</MenubarTrigger>
          <MenubarContent align="start">
            <MenubarItem onClick={() => store.setDialog('brightness-contrast')}>
              Brillo / Contraste...
            </MenubarItem>
            <MenubarItem onClick={() => store.setDialog('levels')}>
              Niveles... <MenubarShortcut>Ctrl+L</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => store.setDialog('curves')}>
              Curvas... <MenubarShortcut>Ctrl+M</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => store.setDialog('hue-saturation')}>
              Tono / Saturacion...
            </MenubarItem>
            <MenubarItem onClick={() => store.setDialog('color-balance')}>
              Balance de color...
            </MenubarItem>
            <MenubarItem onClick={() => store.setDialog('vibrance')}>
              Intensidad (Vibrance)...
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={() => store.applyCssFilter('Escala de grises', 'grayscale(1)')}>
              Escala de grises
            </MenubarItem>
            <MenubarItem onClick={() => store.applyCssFilter('Invertir', 'invert(1)')}>
              Invertir colores
            </MenubarItem>
            <MenubarItem onClick={() => store.applyCssFilter('Sepia', 'sepia(1)')}>Sepia</MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="text-xs">Filtro</MenubarTrigger>
          <MenubarContent align="start">
            <MenubarItem onClick={() => store.setDialog('blur')}>Desenfoque gaussiano...</MenubarItem>
            <MenubarItem
              onClick={() =>
                store.applyKernelFilter('Enfocar', [0, -1, 0, -1, 5, -1, 0, -1, 0])
              }
            >
              Enfocar
            </MenubarItem>
            <MenubarItem onClick={() => store.setDialog('pixelate')}>Pixelar...</MenubarItem>
            <MenubarItem onClick={() => store.setDialog('noise')}>Anadir ruido...</MenubarItem>
            <MenubarSeparator />
            <MenubarItem
              onClick={() =>
                store.applyKernelFilter('Relieve', [-2, -1, 0, -1, 1, 1, 0, 1, 2])
              }
            >
              Relieve
            </MenubarItem>
            <MenubarItem
              onClick={() =>
                store.applyKernelFilter('Detectar bordes', [0, 1, 0, 1, -4, 1, 0, 1, 0])
              }
            >
              Detectar bordes
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="text-xs">Ver</MenubarTrigger>
          <MenubarContent align="start">
            <MenubarItem onClick={() => store.patch({ zoom: Math.min(16, store.zoom * 1.25) })}>
              Acercar <MenubarShortcut>Ctrl++</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => store.patch({ zoom: Math.max(0.02, store.zoom / 1.25) })}>
              Alejar <MenubarShortcut>Ctrl+-</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={store.requestFit}>
              Ajustar a pantalla <MenubarShortcut>Ctrl+0</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={() => store.patch({ zoom: 1 })}>
              Tamano real 100% <MenubarShortcut>Ctrl+1</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="text-xs">Ayuda</MenubarTrigger>
          <MenubarContent align="start">
            <MenubarItem onClick={() => store.setDialog('about')}>
              Acerca de Vórtex Editor
            </MenubarItem>
            <MenubarItem onClick={() => store.setDialog('privacy')}>
              Políticas de Privacidad
            </MenubarItem>
            <MenubarItem onClick={() => store.setDialog('terms')}>
              Términos y Servicios
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="hidden md:inline max-w-40 truncate" title={store.docName}>
          {store.docName}
          {store.projectId ? '' : ' *'}
        </span>
        <span className="hidden md:inline">
          {store.width} x {store.height} px
        </span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        aria-label="Abrir archivo de imagen"
      />
      <input
        ref={projectInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleProjectChange}
        aria-label="Importar proyecto de Vórtex Editor"
      />
    </div>
  )
}
