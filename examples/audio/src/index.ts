import { IDBBlockstore } from 'blockstore-idb'
import { Path } from '@wnfs-wg/nest'
import * as FS from './fs.ts'
import mime from 'mime'

////////
// 🗄️ //
////////

const blockstore = new IDBBlockstore('blockstore')
await blockstore.open()

const fs = await FS.load({ blockstore })

////////
// 📣 //
////////

const state = document.querySelector('#state')
if (!state) throw new Error('Expected a #state element to exist')

function note(msg: string) {
  if (state) state.innerHTML = msg
}

////////
// 💁 //
////////

const fi: HTMLInputElement | null = document.querySelector('#file-input')

if (fi)
  fi.addEventListener('change', (event: Event) => {
    if (fi?.files?.length !== 1) return
    const file: File = fi.files[0]

    const reader = new FileReader()

    note('Reading file')
    console.log('File selected', file)

    reader.onload = (event: any) => {
      const data: ArrayBuffer = event.target.result
      createAudio(file.name, data)
    }

    reader.readAsArrayBuffer(file)
  })

////////
// 🎵 //
////////

async function createAudio(fileName: string, fileData: ArrayBuffer) {
  const mimeType = mime.getType(fileName)
  if (!mimeType || !mimeType.startsWith('audio/'))
    throw new Error('Not an audio file')

  console.log('Audio mimetype', mimeType)

  // File
  note('Adding file to WNFS')

  const path = Path.file('private', fileName)

  if ((await fs.exists(path)) === false) {
    const { dataRoot } = await fs.write(path, 'bytes', new Uint8Array(fileData))
    FS.savePointer(dataRoot)
  }

  const fileSize = await fs.size(path)

  console.log('File size (WNFS)', fileSize)

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

  // Audio frames
  if (!mediainfo.media.track[1]?.FrameCount)
    throw new Error('Failed to determine audio frame count')
  if (!mediainfo.media.track[1]?.StreamSize)
    throw new Error('Failed to determine audio stream size')
  const audioFrameCount = mediainfo.media.track[1]?.FrameCount
  const audioStreamSize = mediainfo.media.track[1]?.StreamSize
  const audioFrameSize = Math.ceil(audioStreamSize / audioFrameCount)

  console.log('Audio frame count', audioFrameCount)
  console.log('Audio stream size', audioStreamSize)
  console.log('Audio frame size', audioFrameSize)

  // Buffering
  const bufferSize = 512 * 1024 // 512 KB
  const metadataSize = mediainfo?.media?.track[0]?.StreamSize || 0

  let loading = false
  let seeking = false

  let sourceBuffer: SourceBuffer
  let buffered: { start: number; end: number } = {
    start: 0,
    end: 0,
  }

  async function loadNext() {
    if (
      src.readyState !== 'open' ||
      sourceBuffer.updating ||
      seeking ||
      loading
    )
      return

    loading = true

    let start = buffered.end
    let end = start + bufferSize
    let reachedEnd = false

    if (end > fileSize) {
      end = fileSize
      reachedEnd = true
    }

    buffered.end = end

    note(`Loading bytes, offset: ${start} - length: ${end - start}`)
    console.log(`Loading bytes from ${start} to ${end}`)

    const buffer = await fs.read(path, 'bytes', {
      offset: start,
      length: end - start,
    })

    sourceBuffer.appendBuffer(buffer)

    loading = false

    if (reachedEnd) {
      sourceBuffer.addEventListener('updateend', () => src.endOfStream(), {
        once: true,
      })
    }
  }

  globalThis.loadNext = loadNext

  // Media source
  note('Setting up media source')

  const src = new MediaSource()

  src.addEventListener('sourceopen', () => {
    if (src.sourceBuffers.length > 0) return
    src.duration = audioDuration

    sourceBuffer = src.addSourceBuffer(mimeType)
    sourceBuffer.mode = 'sequence'

    // Load initial frames
    loadNext()
  })

  // Create audio
  const audio = new Audio()
  audio.src = URL.createObjectURL(src)
  audio.controls = true
  audio.volume = 0.5

  audio.addEventListener('seeking', () => {
    if (seeking) return
    seeking = true

    const time = audio.currentTime
    console.log(
      `Seeking to ${Math.round((time / audio.duration) * 100)}%`,
      time
    )

    function abortAndRemove() {
      if (src.readyState === 'open') sourceBuffer.abort()
      sourceBuffer.addEventListener('updateend', nextUp, { once: true })
      sourceBuffer.remove(0, Infinity)
    }

    // `loadNext` is reading from WNFS, wait until it is finished.
    // TODO: Find a better way to manage this, ideally we should be
    //       able to cancel this so that the resulting
    //       `sourceBuffer.appendBuffer` call never happens.
    if (loading) {
      sourceBuffer.addEventListener('updateend', () => abortAndRemove(), {
        once: true,
      })
    } else {
      abortAndRemove()
    }

    async function nextUp() {
      sourceBuffer.timestampOffset = time

      const frame = Math.floor((time / audio.duration) * audioFrameCount)

      const buffer = await fs.read(path, 'bytes', {
        offset: metadataSize + frame * audioFrameSize,
        length: bufferSize,
      })

      const headerStart = getHeaderStart(buffer)
      console.log('Header start', headerStart)

      buffered.start = metadataSize + frame * audioFrameSize + headerStart
      buffered.end = buffered.start

      seeking = false
      loadNext()
    }
  })

  audio.addEventListener('timeupdate', () => {
    if (audio.seeking) return
    if (audio.currentTime + 60 > sourceBuffer.timestampOffset) loadNext()
  })

  audio.addEventListener('waiting', () => {
    console.log('Audio element is waiting for data')
    loadNext()
  })

  document.body.appendChild(audio)
}

////////
// 🛠️ //
////////

async function mediaInfoClient(covers: boolean) {
  const MediaInfoFactory = await import('mediainfo.js').then((a) => a.default)

  return await MediaInfoFactory({
    coverData: covers,
    full: true,
    locateFile: () => {
      return new URL('mediainfo.js/MediaInfoModule.wasm', import.meta.url)
        .pathname
    },
  })
}

function getHeaderStart(buffer: Uint8Array) {
  let headerStart = 0
  const SyncByte1 = 0xff
  const SyncByte2 = 0xfb
  const SyncByte3 = 0x90 // 224
  const SyncByte4 = 0x64 // 64

  for (let i = 0; i + 1 < buffer.length; i++) {
    if (
      buffer[i] === SyncByte1 &&
      buffer[i + 1] === SyncByte2 &&
      buffer[i + 2] === SyncByte3 &&
      buffer[i + 3] === SyncByte4
    ) {
      return i
    }
  }

  for (let i = 0; i + 1 < buffer.length; i++) {
    if (
      buffer[i] === SyncByte1 &&
      buffer[i + 1] === SyncByte2 &&
      buffer[i + 2] === 224 &&
      buffer[i + 3] === 64
    ) {
      return i
    }
  }

  for (let i = 0; i + 1 < buffer.length; i++) {
    if (
      buffer[i] === SyncByte1 &&
      buffer[i + 1] === SyncByte2 &&
      buffer[i + 2] === SyncByte3
    ) {
      return i
    }
  }

  for (let i = 0; i + 1 < buffer.length; i++) {
    if (buffer[i] === SyncByte1 && buffer[i + 1] === SyncByte2) {
      return i
    }
  }

  return headerStart
}
