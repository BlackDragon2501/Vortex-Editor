// Motor neuronal LaMa para inpainting (eliminacion de texto y marcas de agua).
//
// 100% local: el modelo (big-lama, port ONNX de Carve/LaMa-ONNX, Apache-2.0,
// 208 MB) se descarga UNA sola vez desde HuggingFace y queda guardado en el
// almacenamiento privado del navegador (OPFS, con respaldo IndexedDB). A partir
// de ahi todo corre offline en el dispositivo: GPU via WebGPU, o CPU via WASM
// SIMD como respaldo. Nada sale del navegador durante la inferencia.
//
// NOTA sobre bundles de ORT-web: para WebGPU se carga el bundle dedicado
// ort.webgpu.min.js. El bundle por defecto (ort.min.js) tiene un bug
// off-by-one en la operacion Slice con paso negativo (clampa end a 0 en vez
// de -1) que rompe el modelo LaMa en WebGPU: el kernel Add de las capas FFC
// falla en plena ejecucion con ORT_FAIL ("error code 6"). El bundle webgpu
// no tiene ese bug; el path WASM de cualquier bundle es correcto. Ademas,
// si la GPU falla en plena ejecucion, se reintenta automaticamente en CPU
// sin perder las teselas ya procesadas.
//
// Detalles verificados empiricamente contra lama_fp32.onnx:
//   input  'image'  float32 [1,3,512,512]  valores 0..1
//   input  'mask'   float32 [1,1,512,512]  binario 0/1, 1 = hueco a rellenar
//   output 'output' float32 [1,3,512,512]  valores 0..255
//   La forma de entrada es FIJA en 512x512 -> procesamiento por teselas.

export type LamaProgress =
  | { stage: 'idle' }
  | { stage: 'checking' }
  | { stage: 'downloading'; loaded: number; total: number }
  | { stage: 'reading-cache' }
  | { stage: 'saving' }
  | { stage: 'loading-model' }
  | { stage: 'engine'; backend: 'webgpu' | 'wasm' }
  | { stage: 'tiles'; done: number; total: number }
  | { stage: 'done' }
  | { stage: 'error'; message: string }

const MODEL_URL = 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx'
export const LAMA_MODEL_BYTES = 208044816
const MODEL_CACHE_NAME = 'lama_fp32_208044816.onnx'
const OPFS_DIR = 'vortex-editor-models'
const ORT_VERSION = '1.31.1'
const ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`

const TILE = 512
const STRIDE = TILE - 64 // solape de 64 px para mezcla sin costuras
const CONTEXT_PAD = 64 // contexto alrededor de la seleccion
const DILATE_RADIUS = 2 // dilata la mascara para cubrir bordes antialiased
const MAX_TILES = 220

// ---------------------------------------------------------------- almacenamiento

async function opfsReadModel(): Promise<ArrayBuffer | null> {
  try {
    if (!navigator.storage?.getDirectory) return null
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(OPFS_DIR)
    const file = await dir.getFileHandle(MODEL_CACHE_NAME)
    const blob = await file.getFile()
    if (blob.size !== LAMA_MODEL_BYTES) return null
    return await blob.arrayBuffer()
  } catch {
    return null
  }
}

async function opfsWriteModel(chunks: Uint8Array[]): Promise<boolean> {
  try {
    if (!navigator.storage?.getDirectory) return false
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true })
    const handle = await dir.getFileHandle(MODEL_CACHE_NAME, { create: true })
    const writable = await handle.createWritable()
    for (const c of chunks) await writable.write(c)
    await writable.close()
    // valida el tamanio escrito
    const blob = await (await dir.getFileHandle(MODEL_CACHE_NAME)).getFile()
    return blob.size === LAMA_MODEL_BYTES
  } catch {
    return false
  }
}

function idbOpen(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('vortex-editor', 1)
      req.onupgradeneeded = () => {
        try {
          req.result.createObjectStore('models')
        } catch {
          /* ya existe */
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function idbReadModel(): Promise<ArrayBuffer | null> {
  const db = await idbOpen()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('models', 'readonly')
      const req = tx.objectStore('models').get(MODEL_CACHE_NAME)
      req.onsuccess = () => {
        const v = req.result as Blob | ArrayBuffer | undefined
        if (!v) return resolve(null)
        if (v instanceof Blob) {
          if (v.size !== LAMA_MODEL_BYTES) return resolve(null)
          v.arrayBuffer().then((b) => resolve(b)).catch(() => resolve(null))
        } else {
          if (v.byteLength !== LAMA_MODEL_BYTES) return resolve(null)
          resolve(v)
        }
      }
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function idbWriteModel(chunks: Uint8Array[]): Promise<boolean> {
  const db = await idbOpen()
  if (!db) return false
  return new Promise((resolve) => {
    try {
      const blob = new Blob(chunks as unknown as BlobPart[])
      if (blob.size !== LAMA_MODEL_BYTES) return resolve(false)
      const tx = db.transaction('models', 'readwrite')
      tx.objectStore('models').put(blob, MODEL_CACHE_NAME)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}

/** Estado del modelo en el almacenamiento local del dispositivo. */
export async function lamaModelCached(): Promise<boolean> {
  const opfs = await opfsReadModel()
  if (opfs) return true
  const idb = await idbReadModel()
  return idb !== null
}

/**
 * Descarga el modelo con progreso y lo guarda en OPFS (o IndexedDB).
 * Si ya esta en cache, no hace nada.
 */
export async function prefetchLamaModel(onProgress: (p: LamaProgress) => void): Promise<void> {
  onProgress({ stage: 'checking' })
  if (await lamaModelCached()) {
    onProgress({ stage: 'done' })
    return
  }
  onProgress({ stage: 'downloading', loaded: 0, total: LAMA_MODEL_BYTES })
  const res = await fetch(MODEL_URL, { mode: 'cors' })
  if (!res.ok || !res.body) throw new Error(`No se pudo descargar el modelo (HTTP ${res.status})`)
  const total = Number(res.headers.get('content-length')) || LAMA_MODEL_BYTES
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onProgress({ stage: 'downloading', loaded, total })
  }
  if (loaded !== LAMA_MODEL_BYTES) throw new Error('Descarga incompleta del modelo')
  onProgress({ stage: 'saving' })
  const saved = (await opfsWriteModel(chunks)) || (await idbWriteModel(chunks))
  if (!saved) throw new Error('No se pudo guardar el modelo en el almacenamiento del dispositivo')
  onProgress({ stage: 'done' })
}

// ---------------------------------------------------------------- worker ORT

interface VortexLamaWorker extends Worker {
  __ready?: boolean
}

let cachedWorker: VortexLamaWorker | null = null
let cachedBackend: 'webgpu' | 'wasm' | null = null
let creatingPromise: Promise<VortexLamaWorker> | null = null

function buildWorkerSource(useWebgpuBundle: boolean): string {
  // Worker clasico por Blob: carga ORT-web desde CDN (mismo patron que el
  // runtime de Tesseract.js en Vortex Lens) y ejecuta la sesion fuera del hilo
  // de la UI para que el progreso siga animando. El bundle elegido depende del
  // backend preferido (ver NOTA arriba sobre el bug de Slice en el default).
  const bundle = useWebgpuBundle ? `${ORT_CDN}ort.webgpu.min.js` : `${ORT_CDN}ort.min.js`
  return `
var ort = null
var session = null

function post(m) { self.postMessage(m) }

async function createSession(model, preferBackend) {
  importScripts('${bundle}')
  ort = self.ort
  ort.env.wasm.wasmPaths = '${ORT_CDN}'
  var threadsOk = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated
  ort.env.wasm.numThreads = threadsOk ? Math.min(4, navigator.hardwareConcurrency || 4) : 1
  ort.env.wasm.proxy = false
  var eps = ['wasm']
  if (preferBackend === 'webgpu' && self.navigator && self.navigator.gpu) {
    try {
      var adapter = await self.navigator.gpu.requestAdapter()
      if (adapter) eps = ['webgpu']
    } catch (e) { /* sin WebGPU */ }
  }
  try {
    session = await ort.InferenceSession.create(model, {
      executionProviders: eps,
      graphOptimizationLevel: 'all',
    })
  } catch (err) {
    if (eps[0] === 'webgpu') {
      eps = ['wasm']
      session = await ort.InferenceSession.create(model, {
        executionProviders: eps,
        graphOptimizationLevel: 'all',
      })
    } else {
      throw err
    }
  }
  return eps[0]
}

self.onmessage = async function (e) {
  var msg = e.data
  try {
    if (msg.type === 'create') {
      var backend = await createSession(msg.model, msg.preferBackend)
      post({ type: 'ready', backend: backend })
    } else if (msg.type === 'run') {
      var image = new ort.Tensor('float32', msg.image, [1, 3, 512, 512])
      var mask = new ort.Tensor('float32', msg.mask, [1, 1, 512, 512])
      var out = await session.run({ image: image, mask: mask })
      var data = out.output.data
      post({ type: 'tile', index: msg.index, data: data }, [data.buffer])
    }
  } catch (err) {
    post({ type: 'error', message: String((err && err.message) || err) })
  }
}
`
}

function createLamaWorker(model: ArrayBuffer, preferBackend: 'webgpu' | 'wasm'): Promise<VortexLamaWorker> {
  if (creatingPromise) return creatingPromise
  creatingPromise = new Promise((resolve, reject) => {
    let worker: VortexLamaWorker
    try {
      const blob = new Blob([buildWorkerSource(preferBackend === 'webgpu')], { type: 'text/javascript' })
      worker = new Worker(URL.createObjectURL(blob)) as VortexLamaWorker
    } catch (err) {
      creatingPromise = null
      reject(new Error('No se pudo iniciar el motor local: ' + String(err)))
      return
    }
    const timeout = setTimeout(() => {
      cleanup()
      creatingPromise = null
      reject(new Error('El motor local tardo demasiado en inicializarse'))
    }, 120000)
    const cleanup = () => {
      clearTimeout(timeout)
      worker.removeEventListener('message', onMsg)
      worker.removeEventListener('error', onErr)
    }
    const onMsg = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'ready') {
        cachedBackend = msg.backend
        worker.__ready = true
        cleanup()
        creatingPromise = null
        resolve(worker)
      } else if (msg.type === 'error') {
        cleanup()
        creatingPromise = null
        worker.terminate()
        reject(new Error(msg.message))
      }
    }
    const onErr = () => {
      cleanup()
      creatingPromise = null
      reject(new Error('Fallo al cargar el runtime de IA (CDN)'))
    }
    worker.addEventListener('message', onMsg)
    worker.addEventListener('error', onErr)
    worker.postMessage({ type: 'create', model, preferBackend }, [model])
  })
  return creatingPromise
}

function runTile(worker: VortexLamaWorker, image: Float32Array, mask: Float32Array, index: number): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'tile' && msg.index === index) {
        worker.removeEventListener('message', onMsg)
        resolve(msg.data as Float32Array)
      } else if (msg.type === 'error') {
        worker.removeEventListener('message', onMsg)
        reject(new Error(msg.message))
      }
    }
    worker.addEventListener('message', onMsg)
    worker.postMessage({ type: 'run', image, mask, index }, [image.buffer, mask.buffer])
  })
}

/** Backend activo de la sesion en cache ('webgpu' | 'wasm' | null). */
export function lamaActiveBackend(): 'webgpu' | 'wasm' | null {
  return cachedWorker && cachedWorker.__ready ? cachedBackend : null
}

// ---------------------------------------------------------------- utilidades

/** Convierte errores crudos de ORT/WebGPU en mensajes legibles para el usuario. */
function describeLamaError(err: unknown): Error {
  const raw = String((err instanceof Error ? err.message : err) || '')
  if (/error code\s*=\s*\d+|ORT_FAIL|kernel|WebGPU|GPUBuffer|GPU device|binary op/i.test(raw)) {
    return new Error(
      'La GPU de tu dispositivo no pudo ejecutar el motor neuronal (ya se reintento en CPU y fallo tambien). ' +
      'Usa el motor clasico (rapido, sin descarga) o reduce el tamano de la seleccion. Detalle: ' + raw.slice(0, 160)
    )
  }
  if (/OOM|abort|memory|allocat/i.test(raw)) {
    return new Error(
      'Tu dispositivo se quedo sin memoria al procesar con IA. Cierra otras pestanas o usa el motor clasico. Detalle: ' + raw.slice(0, 160)
    )
  }
  return err instanceof Error ? err : new Error(raw)
}

function reflectIndex(i: number, n: number): number {
  if (n === 1) return 0
  const p = 2 * n - 2
  let j = i % p
  if (j < 0) j += p
  return j < n ? j : p - j
}

function dilateMask(mask: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
  let cur = new Uint8ClampedArray(mask)
  let tmp = new Uint8ClampedArray(mask.length)
  for (let pass = 0; pass < radius; pass++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        tmp[p] = Math.max(cur[p], x > 0 ? cur[p - 1] : 0, x < w - 1 ? cur[p + 1] : 0)
      }
    }
    // vertical
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        cur[p] = Math.max(tmp[p], y > 0 ? tmp[p - w] : 0, y < h - 1 ? tmp[p + w] : 0)
      }
    }
  }
  return cur
}

interface TileSpec {
  tx: number
  ty: number
  tw: number
  th: number
}

function buildTiles(rw: number, rh: number): TileSpec[] {
  const xs: number[] = []
  if (rw <= TILE) {
    xs.push(0)
  } else {
    for (let x = 0; x + TILE < rw; x += STRIDE) xs.push(x)
    const last = rw - TILE
    if (xs[xs.length - 1] !== last) xs.push(last)
  }
  const ys: number[] = []
  if (rh <= TILE) {
    ys.push(0)
  } else {
    for (let y = 0; y + TILE < rh; y += STRIDE) ys.push(y)
    const last = rh - TILE
    if (ys[ys.length - 1] !== last) ys.push(last)
  }
  const tiles: TileSpec[] = []
  for (const ty of ys) {
    for (const tx of xs) {
      const tw = Math.min(TILE, rw - tx)
      const th = Math.min(TILE, rh - ty)
      tiles.push({ tx, ty, tw, th })
    }
  }
  return tiles
}

// ---------------------------------------------------------------- pipeline

/**
 * Inpainting neuronal LaMa sobre un canvas composite usando la mascara del
 * editor (255 = pixel a rellenar). Escribe el resultado SOLO en los pixeles
 * del hueco. Devuelve false si el usuario no tenia marca o si algo fallo
 * (el error se propaga via excepcion con mensaje legible).
 */
export async function lamaInpaint(
  canvas: HTMLCanvasElement,
  mask: Uint8ClampedArray,
  onProgress: (p: LamaProgress) => void
): Promise<boolean> {
  const w = canvas.width
  const h = canvas.height
  const ctx = canvas.getContext('2d')!

  // 1. bbox de la mascara + contexto
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  let holeCount = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] > 127) {
        holeCount++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0 || holeCount === 0) return false
  const rx0 = Math.max(0, minX - CONTEXT_PAD)
  const ry0 = Math.max(0, minY - CONTEXT_PAD)
  const rx1 = Math.min(w, maxX + 1 + CONTEXT_PAD)
  const ry1 = Math.min(h, maxY + 1 + CONTEXT_PAD)
  const rw = rx1 - rx0
  const rh = ry1 - ry0

  // 2. region de pixels del composite
  const region = ctx.getImageData(rx0, ry0, rw, rh)
  const regionMask = new Uint8ClampedArray(rw * rh)
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      regionMask[y * rw + x] = mask[(ry0 + y) * w + (rx0 + x)] > 127 ? 255 : 0
    }
  }
  const maskDilated = dilateMask(regionMask, rw, rh, DILATE_RADIUS)

  // 3. teselas que tocan el hueco (dilatado)
  const allTiles = buildTiles(rw, rh)
  const tiles = allTiles.filter((t) => {
    for (let y = t.ty; y < t.ty + t.th; y += 4) {
      for (let x = t.tx; x < t.tx + t.tw; x += 4) {
        if (maskDilated[y * rw + x] > 0) return true
      }
    }
    return false
  })
  if (tiles.length > MAX_TILES) {
    throw new Error('La zona seleccionada es demasiado grande para el motor neuronal; usa el motor clasico')
  }

  // 4. modelo: cache OPFS/IndexedDB o descarga
  onProgress({ stage: 'checking' })
  let model = await opfsReadModel()
  if (!model) model = await idbReadModel()
  if (!model) {
    await prefetchLamaModel(onProgress)
    onProgress({ stage: 'reading-cache' })
    model = (await opfsReadModel()) || (await idbReadModel())
    if (!model) throw new Error('No se pudo recuperar el modelo desde el almacenamiento local')
  }

  // 5. worker + sesion (WebGPU con respaldo WASM). Si crear la sesion con
  // WebGPU falla (adapter inestable, driver), se reintenta en CPU.
  const ensureWorker = async (prefer: 'webgpu' | 'wasm') => {
    onProgress({ stage: 'loading-model' })
    let m = await opfsReadModel()
    if (!m) m = await idbReadModel()
    if (!m) throw new Error('No se pudo recuperar el modelo desde el almacenamiento local')
    cachedWorker = await createLamaWorker(m, prefer)
  }
  try {
    if (!cachedWorker || !cachedWorker.__ready) await ensureWorker('webgpu')
  } catch {
    cachedWorker = null
    cachedBackend = null
    await ensureWorker('wasm')
  }
  model = null // liberar la copia local; el worker carga la suya desde el almacenamiento
  onProgress({ stage: 'engine', backend: cachedBackend || 'wasm' })

  // 6. ejecucion por teselas con acumulador ponderado. Si la GPU falla en
  // plena ejecucion (kernel WebGPU, driver), se reintenta UNA vez en CPU
  // (WASM SIMD) sin perder las teselas ya procesadas: los pesos acumulados
  // son validos con cualquier backend (salidas numericamente equivalentes).
  const sumV = new Float32Array(rw * rh * 3)
  const sumW = new Float32Array(rw * rh)
  let done = 0
  const runRemaining = async () => {
    for (; done < tiles.length; done++) {
      const t = tiles[done]
      const { tx, ty, tw, th } = t
      const image = new Float32Array(3 * TILE * TILE)
      const tileMask = new Float32Array(TILE * TILE)
      for (let y = 0; y < TILE; y++) {
        const sy = reflectIndex(y, th)
        for (let x = 0; x < TILE; x++) {
          const sx = reflectIndex(x, tw)
          const s = sy * tw + sx
          const d = y * TILE + x
          const p = s * 4
          image[d * 3] = region.data[p] / 255
          image[d * 3 + 1] = region.data[p + 1] / 255
          image[d * 3 + 2] = region.data[p + 2] / 255
          tileMask[d] = maskDilated[s] > 0 ? 1 : 0
        }
      }
      const out = await runTile(cachedWorker!, image, tileMask, done)
      // pesos de mezcla: rampa de 0 a 1 en los bordes con solape; los bordes que
      // coinciden con el borde de la region mantienen peso 1 (sin rampa)
      for (let y = 0; y < th; y++) {
        const dEdgeTop = ty === 0 ? Number.MAX_SAFE_INTEGER : y
        const dEdgeBottom = ty + th >= rh ? Number.MAX_SAFE_INTEGER : th - 1 - y
        const wy = Math.min(1, Math.min(dEdgeTop, dEdgeBottom) / 64)
        for (let x = 0; x < tw; x++) {
          const dEdgeLeft = tx === 0 ? Number.MAX_SAFE_INTEGER : x
          const dEdgeRight = tx + tw >= rw ? Number.MAX_SAFE_INTEGER : tw - 1 - x
          const wgt = Math.min(wy, Math.min(1, Math.min(dEdgeLeft, dEdgeRight) / 64))
          const s = y * tw + x
          if (maskDilated[s] === 0 || wgt <= 0) continue
          const d = (y * TILE + x) * 3
          const p = s * 3
          sumV[p] += out[d] * wgt
          sumV[p + 1] += out[d + 1] * wgt
          sumV[p + 2] += out[d + 2] * wgt
          sumW[s] += wgt
        }
      }
      onProgress({ stage: 'tiles', done: done + 1, total: tiles.length })
    }
  }
  let retried = false
  try {
    await runRemaining()
  } catch (err) {
    if (retried || cachedBackend !== 'webgpu') throw describeLamaError(err)
    retried = true
    try { cachedWorker?.terminate() } catch { /* ya muerto */ }
    cachedWorker = null
    cachedBackend = null
    await ensureWorker('wasm')
    onProgress({ stage: 'engine', backend: cachedBackend || 'wasm' })
    try {
      await runRemaining()
    } catch (err2) {
      throw describeLamaError(err2)
    }
  }

  // 7. escritura del resultado solo en los pixeles del hueco original
  for (let p = 0; p < rw * rh; p++) {
    if (regionMask[p] === 0 || sumW[p] === 0) continue
    const q = p * 4
    region.data[q] = Math.max(0, Math.min(255, Math.round(sumV[p * 3] / sumW[p])))
    region.data[q + 1] = Math.max(0, Math.min(255, Math.round(sumV[p * 3 + 1] / sumW[p])))
    region.data[q + 2] = Math.max(0, Math.min(255, Math.round(sumV[p * 3 + 2] / sumW[p])))
    region.data[q + 3] = Math.max(region.data[q + 3], 255)
  }
  ctx.putImageData(region, rx0, ry0)
  onProgress({ stage: 'done' })
  return true
}
