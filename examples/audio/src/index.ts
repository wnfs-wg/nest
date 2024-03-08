import { IDBBlockstore } from 'blockstore-idb'
import { Path } from '@wnfs-wg/nest'
import * as FS from './fs.ts'
import mime from 'mime'

// FS
// --

const blockstore = new IDBBlockstore('blockstore')
await blockstore.open()

const fs = await FS.load({ blockstore })

// STATE NODE
// ----------

const state = document.querySelector('#state')
if (!state) throw new Error('Expected a #state element to exist')

function note(msg: string) {
  if (state) state.innerHTML = msg
}

// FILE INPUT
// ----------

const fi: HTMLInputElement | null = document.querySelector('#file-input')

if (fi)
  fi.addEventListener('change', (event: Event) => {
    if (fi?.files?.length !== 1) return
    const file: File = fi.files[0]

    const reader = new FileReader()

    note('Reading file')

    reader.onload = (event: any) => {
      const data: ArrayBuffer = event.target.result
      init(file.name, data)
    }

    reader.readAsArrayBuffer(file)
  })

async function init(fileName: string, fileData: ArrayBuffer) {
  const mimeType = mime.getType(fileName)
  if (!mimeType || !mimeType.startsWith('audio/'))
    throw new Error('Not an audio file')

  console.log('Audio mimetype', mimeType)

  // File
  note('Adding file to WNFS')

  const path = Path.file('private', fileName)
  const { dataRoot } = await fs.write(path, 'bytes', new Uint8Array(fileData))

  FS.savePointer(dataRoot)
  const fileSize = await fs.size(path)

  // Audio metadata
  note('Looking up audio metadata')

  const mediainfo = await (
    await mediaInfoClient(true)
  ).analyzeData(
    async (): Promise<number> => {
      return fileSize
    },
    async (chunkSize: number, offset: number): Promise<Uint8Array> => {
      if (chunkSize === 0) return new Uint8Array()
      return fs.read(path, 'bytes', { offset, length: chunkSize })
    }
  )

  // Audio duration
  const audioDuration = mediainfo?.media?.track[0]?.Duration
  if (!audioDuration) throw new Error('Failed to determine audio duration')

  console.log('Audio duration', audioDuration)
  console.log('Audio metadata', mediainfo.media.track)

  // Buffering
  const bufferSize = 512 * 1024 // 512 KB
  const metadataSize = mediainfo?.media?.track[0]?.StreamSize

  let start = 0
  let end = 0
  let sourceBuffer: SourceBuffer

  async function loadNext() {
    if (src.readyState === 'closed' || sourceBuffer.updating) return

    if (end >= fileSize) {
      note('Loaded all audio data')
      if (src.readyState === 'open') src.endOfStream()
      return
    }

    start = end
    end =
      start === 0
        ? metadataSize === undefined
          ? bufferSize
          : metadataSize
        : start + bufferSize
    if (end >= fileSize) end = fileSize

    note(`Loading bytes, offset: ${start} - length: ${end - start}`)

    const buffer = await fs.read(path, 'bytes', {
      offset: start,
      length: end - start,
    })

    sourceBuffer.appendBuffer(buffer)
  }

  // Media source
  note('Setting up media source')

  const src = new MediaSource()

  src.addEventListener('sourceopen', () => {
    if (src.sourceBuffers.length > 0) return
    console.log('src.readyState', src.readyState)

    if (src.readyState == 'open') {
      src.duration = audioDuration

      sourceBuffer = src.addSourceBuffer(mimeType)
      sourceBuffer.addEventListener('updateend', () => loadNext(), {
        once: true,
      })

      note('Loading initial audio buffer')
      loadNext()
    }
  })

  // Create audio
  const audio = new Audio()
  audio.src = URL.createObjectURL(src)
  audio.controls = true
  audio.volume = 0.5
  // audio.preload = 'metadata'

  audio.addEventListener('seeking', () => {
    if (src.readyState === 'open') {
      // Abort current segment append.
      sourceBuffer.abort()
    }

    // TODO:
    // How do we determine what byte offset to load from based on the time.
    // start = n

    loadNext()
  })

  audio.addEventListener('progress', () => loadNext())

  document.body.appendChild(audio)
}

// AUDIO
// -----

async function mediaInfoClient(covers: boolean) {
  const MediaInfoFactory = await import('mediainfo.js').then((a) => a.default)

  return await MediaInfoFactory({
    coverData: covers,
    locateFile: () => {
      return new URL('mediainfo.js/MediaInfoModule.wasm', import.meta.url)
        .pathname
    },
  })
}
