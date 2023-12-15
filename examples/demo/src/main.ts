import { CID, FileSystem, Path } from '@wnfs-wg/nest'
import { IDBBlockstore } from 'blockstore-idb'
import * as uint8arrays from 'uint8arrays'

declare global {
  var _fs: FileSystem
  var _Path: typeof Path
}

// HTML
const h1 = document.querySelector('h1')
if (h1 === null) throw new Error('Expected to find a h1 element')

// Blockstore
const blockstore = new IDBBlockstore('path/to/store')
await blockstore.open()

// Load existing file system or create a new one
const dataRoot = localStorage.getItem('fs-pointer')
const storedKey = localStorage.getItem('capsule-key')

const fs =
  dataRoot === null
    ? await FileSystem.create({ blockstore })
    : await FileSystem.fromCID(CID.parse(dataRoot), { blockstore })

globalThis._fs = fs
globalThis._Path = Path

// Create new private directory at the root
const { capsuleKey } = await fs.mountPrivateNode({
  path: Path.root(),
  capsuleKey:
    storedKey === null
      ? undefined
      : uint8arrays.fromString(storedKey, 'base64'),
})

// Read from or write to the file system
const filePath = Path.file('private', 'init')

if (await fs.exists(filePath)) {
  h1.textContent = 'Time first seen: ' + (await fs.read(filePath, 'utf8'))
} else {
  const dateTime = new Date().toString()
  const result = await fs.write(filePath, 'utf8', dateTime)

  localStorage.setItem('fs-pointer', result.dataRoot.toString())
  localStorage.setItem(
    'capsule-key',
    uint8arrays.toString(capsuleKey, 'base64')
  )

  // eslint-disable-next-line no-console
  h1.textContent = 'Time first seen: ' + dateTime
}
