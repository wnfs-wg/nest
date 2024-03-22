import { CID } from '@wnfs-wg/nest'
import * as IDB from 'idb-keyval'

// TRACKER

export interface Block {
  cid: CID
  bytes: Uint8Array
}

export class Tracker {
  readonly #idbName: string
  #table: Record<string, Block | { flushed: true }>

  constructor(
    idbName: string,
    table: Record<string, Block | { flushed: true }>
  ) {
    this.#idbName = idbName
    this.#table = table
  }

  static async create({ idbName }: { idbName: string }): Promise<Tracker> {
    const table: unknown = await IDB.get(idbName)
    if (table === null || table === undefined) return new Tracker(idbName, {})
    if (!Array.isArray(table))
      throw new Error("Stored table doesn't have the correct type")

    const reconstructedTable: Record<string, Block | { flushed: true }> = {}

    for (const [k, v] of table) {
      if (
        v !== null &&
        typeof v === 'object' &&
        'bytes' in v &&
        'cid' in v &&
        v.bytes instanceof Uint8Array &&
        typeof v.cid === 'string'
      ) {
        reconstructedTable[k] = {
          bytes: v.bytes,
          cid: CID.parse(v.cid as string),
        }
      } else if (v !== null && 'flushed' in v) {
        reconstructedTable[k] = {
          flushed: true,
        }
      }
    }

    return new Tracker(idbName, reconstructedTable)
  }

  async flush(): Promise<Block[]> {
    const blocks: Block[] = []

    for (const [k, v] of Object.entries(this.#table)) {
      if ('bytes' in v) {
        blocks.push(v)
        this.#table[k] = { flushed: true }
      }
    }

    return blocks
  }

  async track(cid: CID, block: Block): Promise<void> {
    this.#table[cid.toString()] = block
    await this.store()
  }

  private async store(): Promise<void> {
    await IDB.set(
      this.#idbName,
      Object.entries(this.#table).map(([k, v]) => {
        if ('cid' in v) return [k, { bytes: v.bytes, cid: v.cid.toString() }]
        return [k, v]
      })
    )
  }
}
