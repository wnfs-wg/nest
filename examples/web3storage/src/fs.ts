import type { Blockstore } from 'interface-blockstore'
import type { Client } from '@web3-storage/w3up-client/types'

import { CID, FileSystem, Path } from '@wnfs-wg/nest'
import * as IDB from 'idb-keyval'

// 🧩

export type SaveLocation = 'local' | 'remote'

// 🚀

/**
 *
 * @param root0
 * @param root0.blockstore
 * @param root0.client
 */
export async function load({
  blockstore,
  client,
}: {
  blockstore: Blockstore
  client: Client
}): Promise<FileSystem> {
  // WNFS can mount individual private nodes, in this case we mount the root private node
  const privatePath = Path.root()

  // State
  const dataRoot = await Pointer.lookup({ client })
  const storedKey = await Keys.lookup({ path: privatePath })

  // Create or load file system
  const fs =
    dataRoot === undefined
      ? await FileSystem.create({ blockstore })
      : await FileSystem.fromCID(dataRoot, { blockstore })

  if (dataRoot === undefined) console.log('Creating new file system')
  else console.log('Loading file system from CID:', dataRoot.toString())

  // Create new or load existing private directory at the root
  if (storedKey === undefined) {
    const { capsuleKey } = await fs.mountPrivateNode({
      path: Path.root(),
    })

    await Keys.save({ key: capsuleKey, path: Path.root() })
    await Pointer.save({ dataRoot: await fs.calculateDataRoot(), client })
  } else {
    await fs.mountPrivateNode({
      path: privatePath,
      capsuleKey: storedKey,
    })
  }

  // Fin
  return fs
}

// 💁 MANAGEMENT

export const Identity = {
  PATH: Path.file('public', '.well-known', 'did'),

  async assign({ did, fs }: { did: string; fs: FileSystem }): Promise<void> {
    await fs.write(this.PATH, 'utf8', did)
  },

  async lookup({ fs }: { fs: FileSystem }): Promise<string | undefined> {
    if (await fs.exists(this.PATH)) return await fs.read(this.PATH, 'utf8')
    return undefined
  },
}

// 🔐 MANAGEMENT

export const Keys = {
  async lookup({
    path,
  }: {
    path: Path.Directory<Path.Segments>
  }): Promise<Uint8Array | undefined> {
    return await IDB.get(`fs.keys.path:/${Path.toPosix(path)}`)
  },

  async save({
    key,
    path,
  }: {
    key: Uint8Array
    path: Path.Directory<Path.Segments>
  }): Promise<void> {
    await IDB.set(`fs.keys.path:/${Path.toPosix(path)}`, key)
  },
}

// 👉 MANAGEMENT

export const Pointer = {
  NAME: 'fs.pointer',

  async delete({
    client,
    location,
  }: {
    client: Client
    location?: SaveLocation
  }): Promise<void> {
    if (location === undefined || location === 'remote') {
      const list = await client.capability.upload.list()
      const promises = list.results.map(async (result) => {
        return await client.capability.upload.remove(result.root)
      })

      await Promise.all(promises)
    }

    if (location === undefined || location === 'local') {
      await IDB.del(this.NAME)
    }
  },

  async lookup({ client }: { client: Client }): Promise<CID | undefined> {
    const list =
      navigator.onLine && client.currentSpace() !== undefined
        ? await client.capability.upload.list()
        : undefined

    if (list?.results[0] !== undefined) {
      return CID.decode(list.results[0].root.bytes)
    }

    // Fallback
    const value = await IDB.get(this.NAME)
    if (typeof value === 'string') return CID.parse(value)

    // Error
    if (client.currentSpace() !== undefined) {
      throw new Error(
        "Expected a Web3Storage upload to be present, but couldn't find any."
      )
    }

    // New file system
    return undefined
  },

  async save({
    client,
    dataRoot,
    location,
  }: {
    client: Client
    dataRoot: CID
    location?: SaveLocation
  }): Promise<void> {
    if (location === 'local' || location === undefined) {
      await IDB.set(this.NAME, dataRoot.toString())
    }

    // Save remotely?
    if (
      location !== 'remote' ||
      location === undefined ||
      client.currentSpace() === undefined
    )
      return

    // Remove existing uploads
    await this.delete({ client, location: 'remote' })

    // Create new upload
    await client.capability.upload.add(dataRoot, [])

    console.log(`✅ Saved remote pointer`)
  },
}
