import type { Blockstore } from 'interface-blockstore'
import type { BlockStore as WnfsBlockStore } from 'wnfs'

import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'

// 🧩

export type { BlockStore as WnfsBlockStore } from 'wnfs'

// 🛠️

export async function cid(bytes: Uint8Array, code: number): Promise<CID> {
  const multihash = await sha256.digest(bytes)
  return CID.createV1(code, multihash)
}

export function wnfs(blockstore: Blockstore): WnfsBlockStore {
  return {
    async getBlock(cid: Uint8Array): Promise<Uint8Array | undefined> {
      const decodedCid = CID.decode(cid)
      return await blockstore.get(decodedCid)
    },

    async hasBlock(cid: Uint8Array): Promise<boolean> {
      const decodedCid = CID.decode(cid)
      return await blockstore.has(decodedCid)
    },

    async putBlockKeyed(cid: Uint8Array, bytes: Uint8Array): Promise<void> {
      const decodedCid = CID.decode(cid)
      await blockstore.put(decodedCid, bytes)
    },

    // Don't hash blocks with the rs-wnfs default Blake 3, sha256 has better support
    async putBlock(bytes: Uint8Array, codec: number): Promise<Uint8Array> {
      const hash = await sha256.digest(bytes)
      const cid = CID.create(1, codec, hash)
      await blockstore.put(cid, bytes)
      return cid.bytes
    },
  }
}

export async function store(
  bytes: Uint8Array,
  code: number,
  blockstore: Blockstore
): Promise<CID> {
  const c = await cid(bytes, code)
  await blockstore.put(c, bytes)
  return c
}
