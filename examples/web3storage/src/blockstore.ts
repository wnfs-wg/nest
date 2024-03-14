import type { Blockstore } from 'interface-blockstore'
import type { Client } from '@web3-storage/w3up-client/types'
import type { CID } from '@wnfs-wg/nest'

import { IDBBlockstore } from 'blockstore-idb'
import { CAR } from '@web3-storage/upload-client'

import type { Block, Tracker } from './tracker.js'

// 📦

/**
 *
 * @param root0
 * @param root0.tracker
 * @param root0.idbName
 */
export async function create({
  tracker,
  idbName,
}: {
  tracker: Tracker
  idbName: string
}): Promise<Blockstore> {
  const levelIDB = new IDBBlockstore(idbName)
  await levelIDB.open()

  const store: Blockstore = {
    async get(key: CID): Promise<Uint8Array> {
      if (await levelIDB.has(key)) {
        return await levelIDB.get(key)
      }

      // TODO: Can we use CAR files to get a bunch of blocks at once?
      return await fetch(`https://${key.toString()}.ipfs.w3s.link/?format=raw`)
        .then(async (r) => {
          if (r.ok) return await r.arrayBuffer()
          throw new Error('Failed to fetch block from gateway')
        })
        .then((r) => new Uint8Array(r))
        .then(async (r) => {
          await store.put(key, r)
          return r
        })
        .catch(async (error) => {
          if (await levelIDB.has(key)) {
            console.error(error)
            return await levelIDB.get(key)
          }
          throw error
        })
    },

    async put(key: CID, value: Uint8Array): Promise<CID> {
      await levelIDB.put(key, value)

      // Depot tracker
      const block = { bytes: value, cid: key.toV1() }
      await tracker.track(key, block)

      // Fin
      return key
    },

    getAll() {
      return levelIDB.getAll()
    },

    delete: async (a) => {
      await levelIDB.delete(a)
    },

    deleteMany: (a, b) => levelIDB.deleteMany(a, b),
    getMany: (a, b) => levelIDB.getMany(a, b),
    has: async (a) => await levelIDB.has(a),
    putMany: (a, b) => levelIDB.putMany(a, b),
  }

  return store
}

// 🌊

/**
 *
 * @param root0
 * @param root0.client
 * @param root0.tracker
 */
export async function flush({
  client,
  tracker,
}: {
  client: Client
  tracker: Tracker
}): Promise<void> {
  // Only flush if remote is ready
  if (client.currentSpace() === undefined) return

  // Get blocks and store them on W3S
  const blocks = await tracker.flush()
  await store({ blocks, client })
}

/**
 *
 * @param root0
 * @param root0.blocks
 * @param root0.client
 */
export async function store({
  blocks,
  client,
}: {
  blocks: Block[]
  client: Client
}): Promise<void> {
  console.log(
    'Storing blocks remotely:',
    blocks.map(({ bytes, cid }) => {
      return {
        bytes,
        cid: cid.toString(),
      }
    })
  )

  // Add blocks to store
  const carFile = await CAR.encode(blocks)
  await client.capability.store.add(carFile)

  console.log('✅ Blocks stored remotely')
}

// 🧩

export { type Blockstore as Type } from 'interface-blockstore'
