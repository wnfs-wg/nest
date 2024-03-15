import type { CodecHeader, MimeType } from 'codec-parser'
import type { MediaInfo, MediaInfoType } from 'mediainfo.js'
import type { MPEGDecodedAudio } from 'mpg123-decoder'

import * as Uint8Arr from 'uint8arrays'
import { IDBBlockstore } from 'blockstore-idb'
import { Path } from '@wnfs-wg/nest'
import CodecParser from 'codec-parser'

// @ts-expect-error No type defs
import MSEAudioWrapper from 'mse-audio-wrapper'

import * as FS from './fs.js'

// 🗄️

const blockstore = new IDBBlockstore('blockstore')
await blockstore.open()

const fs = await FS.load({ blockstore })

// 📣

const state = document.querySelector('#state')
if (state === null) throw new Error('Expected a #state element to exist')

function note(msg: string): void {
  if (state !== null) state.innerHTML = msg
}

// 💁

const fi: HTMLInputElement | null = document.querySelector('#file-input')

if (fi !== null)
  fi.addEventListener('change', (event: Event) => {
    if (fi?.files?.length !== 1) return
    const file: File = fi.files[0]

    note('Reading file')
    console.log('File selected', file)

    file
      .arrayBuffer()
      .then(async (data) => {
        await createAudio(file.name, file.type, data)
      })
      .catch(console.error)
  })

// 🎵

async function createAudio(
  fileName: string,
  mimeType: string,
  fileData: ArrayBuffer
): Promise<void> {
  // File
  note('Adding file to WNFS')

  const path = Path.file('private', fileName)

  if (!(await fs.exists(path))) {
    const { dataRoot } = await fs.write(path, 'bytes', new Uint8Array(fileData))
    await FS.savePointer(dataRoot)
  }

  const fileSize = await fs.size(path)

  console.log('File size (WNFS)', fileSize)

  // Audio metadata
  note('Looking up audio metadata')

  const mediaClient = await mediaInfoClient(true)
  const mediainfo = await mediaClient.analyzeData(
    async (): Promise<number> => {
      return fileSize
    },
    async (chunkSize: number, offset: number): Promise<Uint8Array> => {
      if (chunkSize === 0) return new Uint8Array()
      return await fs.read(path, 'bytes', { offset, length: chunkSize })
    }
  )

  // Audio duration
  const audioDuration = mediainfo?.media?.track[0]?.Duration
  if (audioDuration === undefined)
    throw new Error('Failed to determine audio duration')

  console.log('Audio duration', audioDuration)
  console.log('Audio metadata', mediainfo.media?.track)

  // Audio frames
  if (mediainfo.media?.track[1]?.FrameCount === undefined)
    throw new Error('Failed to determine audio frame count')
  if (mediainfo.media?.track[1]?.StreamSize === undefined)
    throw new Error('Failed to determine audio stream size')
  const audioFrameCount = mediainfo.media.track[1]?.FrameCount
  const audioStreamSize = mediainfo.media.track[1]?.StreamSize
  const audioFrameSize = Math.ceil(audioStreamSize / audioFrameCount)
  const metadataSize = mediainfo?.media?.track[0]?.StreamSize ?? 0

  console.log('Audio frame count', audioFrameCount)
  console.log('Audio stream size', audioStreamSize)
  console.log('Audio frame size', audioFrameSize)

  // Try to create media source first
  let supportsMediaSource = false

  // try {
  //   const { supported } = createMediaSource({
  //     audioDuration,
  //     audioFrameCount,
  //     audioFrameSize,
  //     fileSize,
  //     path,
  //     metadataSize,
  //     mimeType,
  //   })

  //   supportsMediaSource = supported
  // } catch (error) {
  //   console.error('Failed to create media source', error)
  // }

  // If that failed, decode the audio via wasm
  if (supportsMediaSource) return

  const { supported } = await createWebAudio({
    audioDuration,
    audioFrameCount,
    audioFrameSize,
    fileSize,
    mediainfo,
    path,
    metadataSize,
    mimeType,
  })

  if (!supported)
    throw new Error('Did not implement a decoder for this type of audio yet')
}

// 🛠️

async function mediaInfoClient(covers: boolean): Promise<MediaInfo> {
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

// MEDIA STREAM
//
// Let the browser decode the audio.

function createMediaSource({
  audioDuration,
  audioFrameCount,
  audioFrameSize,
  fileSize,
  metadataSize,
  mimeType,
  path,
}: {
  audioDuration: number
  audioFrameCount: number
  audioFrameSize: number
  fileSize: number
  metadataSize: number
  mimeType: string
  path: Path.File<Path.PartitionedNonEmpty<Path.Private>>
}): { supported: boolean } {
  if (window.MediaSource === undefined) {
    return { supported: false }
  }

  // Create audio wrapper which enables support for some unsupported audio containers
  console.log('Audio mimetype', mimeType)
  const audioWrapper = new MSEAudioWrapper(mimeType)

  // Detect support
  if (!MediaSource.isTypeSupported(mimeType)) {
    return { supported: false }
  }

  // Buffering
  const bufferSize = 512 * 1024 // 512 KB

  let loading = false
  let seeking = false

  let sourceBuffer: SourceBuffer
  const buffered: { start: number; end: number } = {
    start: 0,
    end: 0,
  }

  async function loadNext(): Promise<void> {
    if (
      src.readyState !== 'open' ||
      sourceBuffer.updating ||
      seeking ||
      loading
    )
      return

    loading = true

    const start = buffered.end
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

    sourceBuffer.appendBuffer(
      Uint8Arr.concat([...audioWrapper.iterator(buffer)] as Uint8Array[])
    )

    loading = false

    if (reachedEnd) {
      sourceBuffer.addEventListener(
        'updateend',
        () => {
          if (!sourceBuffer.updating) src.endOfStream()
        },
        {
          once: true,
        }
      )
    }
  }

  // Media source
  note('Setting up media source')

  const src = new MediaSource()

  src.addEventListener('sourceopen', () => {
    if (src.sourceBuffers.length > 0) return
    src.duration = audioDuration

    sourceBuffer = src.addSourceBuffer(mimeType)
    sourceBuffer.mode = 'sequence'

    // Load initial frames
    loadNext().catch(console.error)
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

    function abortAndRemove(): void {
      if (src.readyState === 'open') sourceBuffer.abort()
      sourceBuffer.addEventListener('updateend', nextUp, { once: true })
      sourceBuffer.remove(0, Number.POSITIVE_INFINITY)
    }

    // `loadNext` is reading from WNFS, wait until it is finished.
    // TODO: Find a better way to manage this, ideally we should be
    //       able to cancel this so that the resulting
    //       `sourceBuffer.appendBuffer` call never happens.
    if (loading) {
      sourceBuffer.addEventListener('updateend', abortAndRemove, {
        once: true,
      })
    } else {
      abortAndRemove()
    }

    function nextUp(): void {
      if (audioDuration !== undefined && !sourceBuffer.updating)
        src.duration = audioDuration
      sourceBuffer.timestampOffset = time

      const frame = Math.floor((time / audio.duration) * audioFrameCount)

      buffered.start = metadataSize + frame * audioFrameSize
      buffered.end = buffered.start

      seeking = false
      loadNext().catch(console.error)
    }
  })

  audio.addEventListener('timeupdate', () => {
    if (audio.seeking) return
    if (audio.currentTime + 60 > sourceBuffer.timestampOffset)
      loadNext().catch(console.error)
  })

  audio.addEventListener('waiting', () => {
    console.log('Audio element is waiting for data')
    loadNext().catch(console.error)
  })

  document.body.append(audio)

  return { supported: true }
}

// WEB AUDIO
//
// Decode the audio via WASM.
//
// NOTES:
// https://github.com/WebAudio/web-audio-api/issues/2227
//
// ⚠️ This code assumes the audio bytes will be loaded in before
//    the current audio segment ends.

async function createWebAudio({
  audioDuration,
  audioFrameCount,
  audioFrameSize,
  fileSize,
  mediainfo,
  metadataSize,
  mimeType,
  path,
}: {
  audioDuration: number
  audioFrameCount: number
  audioFrameSize: number
  fileSize: number
  mediainfo: MediaInfoType
  metadataSize: number
  mimeType: string
  path: Path.File<Path.PartitionedNonEmpty<Path.Private>>
}): Promise<{ supported: boolean }> {
  const audioContext = new AudioContext()

  // Correct mime type
  let correctedMimeType: MimeType

  const codec = mediainfo.media?.track
    .find((a) => a.StreamKind === 'Audio')
    ?.Format?.toLowerCase()

  switch (codec) {
    case 'mpeg':
    case 'mpeg audio': {
      correctedMimeType = 'audio/mpeg'
      break
    }
    default: {
      return { supported: false }
    }
  }

  // Create codec parser
  const codecParser = new CodecParser(correctedMimeType, {
    // @ts-expect-error Faulty type definitions
    onCodecHeader: (codecHeaderData: CodecHeader) => {
      console.log(codecHeaderData)
    },
  })

  const sampleRate = mediainfo.media?.track.find(
    (a) => a.StreamKind === 'Audio'
  )?.SamplingRate

  if (sampleRate === undefined)
    throw new Error('Failed to determine sample rate')

  // Create decoder
  const { MPEGDecoderWebWorker } = await import('mpg123-decoder')
  const decoder = new MPEGDecoderWebWorker()

  await decoder.ready

  // Buffering
  const bufferSize = 512 * 1024
  const buffered: {
    start: number
    end: number
    reachedEnd: boolean
    samples: number
    sampleOffset: number
    time: number
  } = {
    start: 0,
    end: 0,
    reachedEnd: false,
    samples: 0,
    sampleOffset: 0,
    time: 0,
  }

  let loading = false

  async function loadNext(): Promise<MPEGDecodedAudio | undefined> {
    if (loading) return
    loading = true

    if (sampleRate === undefined)
      throw new Error('Failed to determine sample rate')

    const start = buffered.end
    let end = start + bufferSize
    let reachedEnd = false

    if (end > fileSize) {
      end = fileSize
      reachedEnd = true
    }

    note(`Loading bytes, offset: ${start} - length: ${end - start}`)
    console.log(`Loading bytes from ${start} to ${end}`)

    const bytes = await fs.read(path, 'bytes', {
      offset: start,
      length: end - start,
    })

    const frames: Array<{ data: Uint8Array }> = [
      // @ts-expect-error No type defs
      ...codecParser.parseChunk(bytes),
    ]

    const decoded = await decoder.decodeFrames(frames.map((f) => f.data))

    buffered.end = end
    buffered.reachedEnd = reachedEnd
    buffered.samples += decoded.samplesDecoded
    buffered.time = (buffered.samples - buffered.sampleOffset) / sampleRate

    loading = false

    return decoded
  }

  // Audio
  const audio = new Audio()
  audio.controls = true
  audio.volume = 0.5

  document.body.append(audio)

  // Create media stream and attach it to the audio element
  const mediaStream = audioContext.createMediaStreamDestination()
  mediaStream.channelCount = audioContext.destination.maxChannelCount
  audio.srcObject = mediaStream.stream

  // Create audio buffer
  const initialDecoded = await loadNext()
  if (initialDecoded === undefined)
    throw new Error('Failed to load initial frames')

  const { channelData } = initialDecoded
  const audioBuffer = audioContext.createBuffer(
    channelData.length,
    audioDuration * sampleRate,
    sampleRate
  )

  for (const [idx, channel] of channelData.entries()) {
    audioBuffer.getChannelData(idx).set(channel)
  }

  // Create buffer source
  let source = audioContext.createBufferSource()
  source.buffer = audioBuffer
  source.connect(mediaStream)
  source.start(0, audio.currentTime, audioDuration)

  // Audio events
  audio.addEventListener('timeupdate', () => {
    onTimeUpdate().catch(console.error)
  })

  async function onTimeUpdate(): Promise<void> {
    if (audio.seeking || buffered.reachedEnd) return
    if (audio.currentTime + 60 > buffered.time) {
      const beforeSamples = buffered.samples
      const decodedAudio = await loadNext()
      if (decodedAudio === undefined) return

      const { channelData } = decodedAudio

      for (const [idx, channel] of channelData.entries()) {
        audioBuffer.copyToChannel(channel, idx, beforeSamples)
      }

      source.stop(0)
      source.disconnect()

      source = audioContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(mediaStream)
      source.start(
        0, // buffered.sampleOffset / sampleRate / scalingFactor,
        audio.currentTime,
        audioDuration
      )
    }
  }

  // Fin
  return { supported: true }
}
