import type { Blockstore } from 'interface-blockstore'

import { CID, FileSystem, Path } from '@wnfs-wg/nest'

import * as IDB from 'idb-keyval'
import * as Uint8Arr from 'uint8arrays'

/////////////////
// FILE SYSTEM //
/////////////////

export async function load({
  blockstore,
}: {
  blockstore: Blockstore
}): Promise<FileSystem> {
  const dataRoot = await IDB.get('fs-pointer')
  const storedKey = await IDB.get('capsule-key')

  const fs =
    dataRoot === undefined
      ? await FileSystem.create({ blockstore })
      : await FileSystem.fromCID(CID.parse(dataRoot), { blockstore })

  // Create new or load existing private directory at the root
  if (dataRoot && storedKey) {
    await fs.mountPrivateNode({
      path: Path.root(),
      capsuleKey: Uint8Arr.fromString(storedKey, 'base64'),
    })
  } else {
    const { capsuleKey } = await fs.mountPrivateNode({
      path: Path.root(),
    })

    IDB.set('capsule-key', Uint8Arr.toString(capsuleKey, 'base64'))
    savePointer(await fs.calculateDataRoot())
  }

  // Fin
  return fs
}

export async function savePointer(dataRoot: CID): Promise<void> {
  await IDB.set('fs-pointer', dataRoot.toString())
}
