import type { Blockstore } from 'interface-blockstore'

import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'

import * as Codecs from './codecs.js'

// 🧩

export interface WnfsBlockStore {
  getBlock: (cid: Uint8Array) => Promise<Uint8Array | undefined>
  putBlock: (bytes: Uint8Array, code: number) => Promise<Uint8Array>
}

// 🛠️

export async function cid(bytes: Uint8Array, codecId: number): Promise<CID> {
  const codec = Codecs.getByCode(codecId)
  const multihash = await sha256.digest(bytes)

  return CID.createV1(codec.code, multihash)
}

export function wnfsStoreInterface(blockstore: Blockstore): WnfsBlockStore {
  return {
    async getBlock(cid: Uint8Array): Promise<Uint8Array | undefined> {
      const decodedCid = CID.decode(cid)
      return await blockstore.get(decodedCid)
    },

    async putBlock(bytes: Uint8Array, codecId: number): Promise<Uint8Array> {
      await blockstore.put(await cid(bytes, codecId), bytes)
      return bytes
    },
  }
}

export async function store(
  bytes: Uint8Array,
  codecId: Codecs.CodecIdentifier,
  blockstore: Blockstore
): Promise<CID> {
  const codec = Codecs.getByIdentifier(codecId)
  const c = await cid(bytes, codec.code)

  await blockstore.put(c, bytes)

  return c
}
