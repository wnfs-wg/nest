import type { Blockstore } from 'interface-blockstore'
import type { CID } from 'multiformats'
import type { PrivateForest, PublicDirectory } from 'wnfs'

/**
 * The tree that ties different file systems together.
 */
export abstract class RootTree {
  abstract privateForest: PrivateForest
  abstract publicRoot: PublicDirectory

  abstract commit(privateForest: PrivateForest): Promise<this>
  abstract store(): Promise<CID>

  static async create(_blockstore: Blockstore): Promise<RootTree> {
    throw new Error('Not implemented!')
  }

  static async fromCID(_blockstore: Blockstore, _cid: CID): Promise<RootTree> {
    throw new Error('Not implemented!')
  }
}
