import type { PBLink, PBNode } from '@ipld/dag-pb'
import type { Blockstore } from 'interface-blockstore'

import * as DagPB from '@ipld/dag-pb'
import * as Raw from 'multiformats/codecs/raw'
import * as Uint8Arrays from 'uint8arrays'

import { webcrypto } from 'iso-base/crypto'
import { CID } from 'multiformats'
import { PrivateForest, PublicDirectory } from 'wnfs'

import * as Unix from '../unix.js'
import * as Store from '../store.js'
import * as Version from '../version.js'

import { RootBranch } from '../path.js'
import { makeRngInterface } from '../rng.js'
import type { RootTree } from '../root-tree.js'

// CLASS

export class BasicRootTree implements RootTree {
  readonly #blockstore: Blockstore
  readonly #exchangeRoot: PublicDirectory
  readonly #unix: PBNode
  readonly #version: string

  publicRoot: PublicDirectory
  privateForest: PrivateForest

  constructor({
    blockstore,
    exchangeRoot,
    publicRoot,
    privateForest,
    unix,
    version,
  }: {
    blockstore: Blockstore
    exchangeRoot: PublicDirectory
    publicRoot: PublicDirectory
    privateForest: PrivateForest
    unix: PBNode
    version: string
  }) {
    this.#blockstore = blockstore
    this.#exchangeRoot = exchangeRoot
    this.#unix = unix
    this.#version = version

    this.publicRoot = publicRoot
    this.privateForest = privateForest
  }

  /**
   * Create a new root tree.
   */
  static async create(blockstore: Blockstore): Promise<BasicRootTree> {
    const currentTime = new Date()

    return new BasicRootTree({
      blockstore,

      exchangeRoot: new PublicDirectory(currentTime),
      publicRoot: new PublicDirectory(currentTime),
      privateForest: await createPrivateForest(),
      unix: Unix.createDirectory(currentTime),
      version: Version.latest,
    })
  }

  /**
   * Load an existing root tree.
   */
  static async fromCID(
    cid: CID,
    blockstore: Blockstore
  ): Promise<BasicRootTree> {
    const currentTime = new Date()
    const wnfsStore = Store.wnfsStoreInterface(blockstore)

    // Retrieve links
    const links = await linksFromCID(cid, blockstore)

    // Retrieve all pieces
    async function handleLink<T>(
      name: string,
      present: (cid: CID) => Promise<T>,
      missing: () => T | Promise<T>
    ): Promise<T> {
      if (links[name] === undefined) {
        console.warn(
          `Missing '${name}' link in the root tree from '${cid.toString()}'. Creating a new link.`
        )
        return await missing()
      }

      return await present(links[name])
    }

    const exchangeRoot = await handleLink(
      RootBranch.Exchange,
      async (cid) => await PublicDirectory.load(cid.bytes, wnfsStore),
      () => new PublicDirectory(currentTime)
    )

    const publicRoot = await handleLink(
      RootBranch.Public,
      async (cid) => await PublicDirectory.load(cid.bytes, wnfsStore),
      () => new PublicDirectory(currentTime)
    )

    const privateForest = await handleLink(
      RootBranch.Private,
      async (cid) => await PrivateForest.load(cid.bytes, wnfsStore),
      async () => await createPrivateForest()
    )

    const unix = await handleLink(
      RootBranch.Unix,
      async (cid) => await Unix.load(cid, blockstore),
      () => Unix.createDirectory(currentTime)
    )

    const version = await handleLink(
      RootBranch.Version,
      async (cid) => {
        return new TextDecoder().decode(Raw.decode(await blockstore.get(cid)))
      },
      () => Version.latest
    )

    // Compose
    return new BasicRootTree({
      blockstore,

      exchangeRoot,
      publicRoot,
      privateForest,
      unix,
      version,
    })
  }

  async commit(_privateForest: PrivateForest): Promise<BasicRootTree> {
    throw new Error('Not implemented!')

    // const unixTree = await changes.reduce(async (oldRootPromise, change) => {
    //   const oldRoot = await oldRootPromise

    //   if (!Path.isPartition('public', change.path)) {
    //     return oldRoot
    //   }

    //   const path = Path.removePartition(change.path)

    //   if (change.type === 'removed') {
    //     return Unix.removeNodeFromTree(
    //       oldRoot,
    //       path,
    //       context.#dependencies.depot
    //     )
    //   }

    //   const contentCID =
    //     Path.isFile(change.path) &&
    //     Path.isPartitionedNonEmpty<Path.Public>(change.path)
    //       ? await context.contentCID(change.path).then((a) => a ?? undefined)
    //       : undefined

    //   return Unix.insertNodeIntoTree(
    //     oldRoot,
    //     path,
    //     context.#dependencies.depot,
    //     contentCID
    //   )
    // }, Promise.resolve(context.#rootTree.unix))
  }

  async store(): Promise<CID> {
    const wnfsStore = Store.wnfsStoreInterface(this.#blockstore)

    // Store all pieces
    const exchangeRoot = await this.#exchangeRoot.store(wnfsStore)
    const privateForest = await this.privateForest.store(wnfsStore)
    const publicRoot = await this.publicRoot.store(wnfsStore)
    const unixTree = await Store.store(
      DagPB.encode(this.#unix),
      DagPB.code,
      this.#blockstore
    )

    const version = await Store.store(
      Raw.encode(new TextEncoder().encode(this.#version)),
      Raw.code,
      this.#blockstore
    )

    // Store root tree
    const links = [
      {
        Name: RootBranch.Exchange,
        Hash: CID.decode(exchangeRoot),
      },
      {
        Name: RootBranch.Private,
        Hash: CID.decode(privateForest),
      },
      {
        Name: RootBranch.Public,
        Hash: CID.decode(publicRoot),
      },
      {
        Name: RootBranch.Unix,
        Hash: unixTree,
      },
      {
        Name: RootBranch.Version,
        Hash: version,
      },
    ]

    const node = DagPB.createNode(new Uint8Array([8, 1]), links)

    // Fin
    return await Store.store(DagPB.encode(node), DagPB.code, this.#blockstore)
  }
}

// ㊙️

/**
 * Create a new `PrivateForest`
 */
async function createPrivateForest(): Promise<PrivateForest> {
  const rng = makeRngInterface()

  const rsaKey = await webcrypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: { name: 'SHA-256' },
    },
    false,
    ['sign', 'verify']
  )

  const rsaMod = await webcrypto.subtle
    .exportKey('jwk', rsaKey.publicKey)
    .then((a) => {
      if (typeof a.n === 'string') return a.n
      else throw new Error('Expected public RSA key to have `n` property')
    })
    .then((n) => Uint8Arrays.fromString(n, 'base64url'))

  return new PrivateForest(rng, rsaMod)
}

/**
 * Retrieve the links of a root tree.
 */
export async function linksFromCID(
  cid: CID,
  blockstore: Blockstore
): Promise<Record<string, CID>> {
  // Get the root node,
  // which is stored as DAG-PB.
  const node = DagPB.decode(await blockstore.get(cid))

  return node.Links.reduce((acc: Record<string, CID>, link: PBLink) => {
    return typeof link.Name === 'string'
      ? { ...acc, [link.Name]: link.Hash }
      : acc
  }, {})
}
