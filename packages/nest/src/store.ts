import type { Blockstore } from 'interface-blockstore'

import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'

// 🧩

export interface WnfsBlockStore {
  getBlock: (cid: Uint8Array) => Promise<Uint8Array | undefined>
  putBlock: (bytes: Uint8Array, code: number) => Promise<Uint8Array>
}

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

    async putBlock(bytes: Uint8Array, code: number): Promise<Uint8Array> {
      const c = await cid(bytes, code)
      await blockstore.put(c, bytes)
      return c.bytes
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
