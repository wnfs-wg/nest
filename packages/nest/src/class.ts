import type { Blockstore } from 'interface-blockstore'
import type { PublicDirectory, PublicFile } from 'wnfs'

import { CID } from 'multiformats/cid'
import { AccessKey, PrivateDirectory, PrivateFile, PrivateNode } from 'wnfs'

import debounce from 'debounce'
import Emittery, {
  type EmitteryOncePromise,
  type OmnipresentEventData,
  type UnsubscribeFunction,
} from 'emittery'

import type {
  AnySupportedDataType,
  CommitVerifier,
  DataForType,
  DataType,
  DirectoryItem,
  DirectoryItemWithKind,
  Modification,
  MutationOptions,
  MutationResult,
  NOOP,
  PrivateMutationResult,
  PublicMutationResult,
} from './types.js'

import type {
  MountedPrivateNode,
  MountedPrivateNodes,
} from './types/internal.js'

import type { Events, Listener } from './events.js'

import * as Path from './path.js'
import * as Rng from './rng.js'
import * as Store from './store.js'

import type { RootTree } from './root-tree.js'
import type {
  Partition,
  Partitioned,
  PartitionedNonEmpty,
  Private,
  Public,
} from './path.js'

import { searchLatest } from './common.js'
import { partition as determinePartition, findPrivateNode } from './mounts.js'
import { TransactionContext } from './transaction.js'
import { BasicRootTree } from './root-tree/basic.js'

// OPTIONS

export interface Options {
  blockstore: Blockstore
  onCommit?: CommitVerifier
  rootTreeClass?: typeof RootTree
  settleTimeBeforePublish?: number
}

export class FileSystem {
  readonly #blockstore: Blockstore
  readonly #debouncedDataRootUpdate: debounce.DebouncedFunction<any>
  readonly #eventEmitter: Emittery<Events>
  readonly #onCommit: CommitVerifier
  readonly #rng: Rng.Rng

  #privateNodes: MountedPrivateNodes = {}
  #rootTree: RootTree

  /** @hidden */
  constructor(
    blockstore: Blockstore,
    onCommit: CommitVerifier | undefined,
    rootTree: RootTree,
    settleTimeBeforePublish: number
  ) {
    this.#blockstore = blockstore
    this.#eventEmitter = new Emittery<Events>()
    this.#onCommit = onCommit ?? (async () => ({ commit: true }))
    this.#rng = Rng.makeRngInterface()
    this.#rootTree = rootTree

    this.#debouncedDataRootUpdate = debounce(
      async (...dataRoots: CID[]): Promise<void> => {
        const dataRoot = dataRoots.at(-1)
        if (dataRoot !== undefined) {
          await this.#eventEmitter.emit('publish', { dataRoot })
        }
      },
      settleTimeBeforePublish
    )
  }

  // INITIALISATION
  // --------------

  /**
   * Creates a file system with an empty public tree & an empty private tree at the root.
   */
  static async create(opts: Options): Promise<FileSystem> {
    const { blockstore, onCommit, rootTreeClass, settleTimeBeforePublish } =
      opts
    const rootTree = await (rootTreeClass ?? BasicRootTree).create(blockstore)

    return new FileSystem(
      blockstore,
      onCommit,
      rootTree,
      settleTimeBeforePublish ?? 2500
    )
  }

  /**
   * Loads an existing file system from a CID.
   */
  static async fromCID(cid: CID, opts: Options): Promise<FileSystem> {
    const { blockstore, onCommit, rootTreeClass, settleTimeBeforePublish } =
      opts

    const rootTree = await (rootTreeClass ?? BasicRootTree).fromCID(
      blockstore,
      cid
    )

    return new FileSystem(
      blockstore,
      onCommit,
      rootTree,
      settleTimeBeforePublish ?? 2500
    )
  }

  // EVENTS
  // ------

  /**
   * {@inheritDoc events.EmitterClass.on}
   *
   * @group Events
   */
  on = <Name extends keyof Events>(
    eventName: Name,
    listener: Listener<Events, Name>
  ): UnsubscribeFunction => this.#eventEmitter.on(eventName, listener)

  /**
   * {@inheritDoc events.EmitterClass.onAny}
   *
   * @group Events
   */
  onAny = (
    listener: (
      eventName: keyof Events,
      eventData: Events[keyof Events]
    ) => void | Promise<void>
  ): UnsubscribeFunction => this.#eventEmitter.onAny(listener)

  /**
   * {@inheritDoc events.EmitterClass.off}
   *
   * @group Events
   */
  off = <Name extends keyof Events>(
    eventName: Name,
    listener: Listener<Events, Name>
  ): void => {
    this.#eventEmitter.off(eventName, listener)
  }

  /**
   * {@inheritDoc events.EmitterClass.offAny}
   *
   * @group Events
   */
  offAny = (
    listener: (
      eventName: keyof Events,
      eventData: Events[keyof Events]
    ) => void | Promise<void>
  ): void => {
    this.#eventEmitter.offAny(listener)
  }

  /**
   * {@inheritDoc events.EmitterClass.once}
   *
   * @group Events
   */
  once = <Name extends keyof Events>(
    eventName: Name
  ): EmitteryOncePromise<(Events & OmnipresentEventData)[Name]> =>
    this.#eventEmitter.once(eventName)

  /**
   * {@inheritDoc events.EmitterClass.anyEvent}
   *
   * @group Events
   */
  anyEvent = (): AsyncIterable<[keyof Events, Events[keyof Events]]> =>
    this.#eventEmitter.anyEvent()

  /**
   * {@inheritDoc events.EmitterClass.events}
   *
   * @group Events
   */
  events = <Name extends keyof Events>(
    eventName: Name
  ): AsyncIterable<Events[Name]> => this.#eventEmitter.events(eventName)

  // MOUNTS
  // ------

  /**
   * Mount a private node onto the file system.
   *
   * @group Mounting
   */
  async mountPrivateNode(node: {
    path: Path.Distinctive<Path.Segments>
    capsuleKey?: Uint8Array
  }): Promise<{
    path: Path.Distinctive<Path.Segments>
    capsuleKey: Uint8Array
  }> {
    const mounts = await this.mountPrivateNodes([node])
    return mounts[0]
  }

  /**
   * Mount private nodes onto the file system.
   *
   * When a `capsuleKey` is not given,
   * it will create the given path instead of trying to load it.
   *
   * @group Mounting
   */
  async mountPrivateNodes(
    nodes: Array<{
      path: Path.Distinctive<Path.Segments>
      capsuleKey?: Uint8Array
    }>
  ): Promise<
    Array<{
      path: Path.Distinctive<Path.Segments>
      capsuleKey: Uint8Array
    }>
  > {
    const newNodes = await Promise.all(
      nodes.map(
        async ({ path, capsuleKey }): Promise<[string, MountedPrivateNode]> => {
          let privateNode: PrivateNode

          if (capsuleKey === null || capsuleKey === undefined) {
            privateNode = Path.isFile(path)
              ? new PrivateFile(
                  this.#rootTree.privateForest().emptyName(),
                  new Date(),
                  this.#rng
                ).asNode()
              : new PrivateDirectory(
                  this.#rootTree.privateForest().emptyName(),
                  new Date(),
                  this.#rng
                ).asNode()
          } else {
            const accessKey = AccessKey.fromBytes(capsuleKey)
            privateNode = await PrivateNode.load(
              accessKey,
              this.#rootTree.privateForest(),
              Store.wnfs(this.#blockstore)
            )
          }

          return [
            // Use absolute paths so that you can retrieve the root: privateNodes["/"]
            Path.toPosix(path, { absolute: true }),
            { node: privateNode, path },
          ]
        }
      )
    )

    this.#privateNodes = {
      ...this.#privateNodes,
      ...Object.fromEntries(newNodes),
    }

    return await Promise.all(
      newNodes.map(async ([_, n]: [string, MountedPrivateNode]) => {
        const storeResult = await n.node.store(
          this.#rootTree.privateForest(),
          Store.wnfs(this.#blockstore),
          this.#rng
        )
        const [accessKey, privateForest] = storeResult

        this.#rootTree = await this.#rootTree.replacePrivateForest(
          privateForest,
          [
            {
              path: Path.withPartition('private', n.path),
              type: 'added-or-updated',
            },
          ]
        )

        return {
          path: n.path,
          capsuleKey: accessKey.toBytes(),
        }
      })
    )
  }

  /**
   * Unmount a private node from the file system.
   *
   * @group Mounting
   */
  unmountPrivateNode(path: Path.Distinctive<Path.Segments>): void {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete this.#privateNodes[Path.toPosix(path)]
  }

  // QUERY
  // -----

  /** @group Querying */
  async contentCID(
    path: Path.File<Partitioned<Public>>
  ): Promise<CID | undefined> {
    return await this.#transactionContext().contentCID(path)
  }

  /** @group Querying */
  async capsuleCID(
    path: Path.Distinctive<Partitioned<Public>>
  ): Promise<CID | undefined> {
    return await this.#transactionContext().capsuleCID(path)
  }

  /** @group Querying */
  async capsuleKey(
    path: Path.Distinctive<Partitioned<Private>>
  ): Promise<Uint8Array | undefined> {
    return await this.#transactionContext().capsuleKey(path)
  }

  /** @group Querying */
  async exists(
    path: Path.Distinctive<Partitioned<Partition>>
  ): Promise<boolean> {
    return await this.#transactionContext().exists(path)
  }

  /** @group Querying */
  async listDirectory(
    path: Path.Directory<Partitioned<Partition>>,
    listOptions: { withItemKind: true }
  ): Promise<DirectoryItemWithKind[]>
  async listDirectory(
    path: Path.Directory<Partitioned<Partition>>,
    listOptions: { withItemKind: false }
  ): Promise<DirectoryItem[]>
  async listDirectory(
    path: Path.Directory<Partitioned<Partition>>
  ): Promise<DirectoryItem[]>
  async listDirectory(
    path: Path.Directory<Partitioned<Partition>>,
    listOptions?: { withItemKind: boolean }
  ): Promise<DirectoryItem[] | DirectoryItemWithKind[]> {
    return await this.#transactionContext().listDirectory(path, listOptions)
  }

  /** @group Querying */
  ls = this.listDirectory

  /** @group Querying */
  async read<D extends DataType, V = unknown>(
    path:
      | Path.File<PartitionedNonEmpty<Partition>>
      | { contentCID: CID }
      | { capsuleCID: CID }
      | {
          capsuleKey: Uint8Array
        },
    dataType: D,
    options?: { offset: number; length: number }
  ): Promise<DataForType<D, V>>
  async read<V = unknown>(
    path:
      | Path.File<PartitionedNonEmpty<Partition>>
      | { contentCID: CID }
      | { capsuleCID: CID }
      | {
          capsuleKey: Uint8Array
        },
    dataType: DataType,
    options?: { offset: number; length: number }
  ): Promise<AnySupportedDataType<V>> {
    return await this.#transactionContext().read<DataType, V>(
      path,
      dataType,
      options
    )
  }

  // MUTATIONS
  // ---------

  /** @group Mutating */
  async copy<From extends Partition, To extends Partition>(
    from: Path.Distinctive<PartitionedNonEmpty<From>>,
    to: Path.File<PartitionedNonEmpty<To>> | Path.Directory<Partitioned<To>>,
    mutationOptions?: MutationOptions
  ): Promise<MutationResult<To>>
  async copy(
    from: Path.Distinctive<PartitionedNonEmpty<Partition>>,
    to:
      | Path.File<PartitionedNonEmpty<Partition>>
      | Path.Directory<Partitioned<Partition>>,
    mutationOptions: MutationOptions = {}
  ): Promise<MutationResult<Partition>> {
    return await this.#infusedTransaction(
      async (t) => {
        await t.copy(from, to)
      },
      to,
      mutationOptions
    )
  }

  /** @group Mutating */
  cp = this.copy

  /** @group Mutating */
  async createDirectory<P extends Partition>(
    path: Path.Directory<PartitionedNonEmpty<P>>,
    mutationOptions?: MutationOptions
  ): Promise<
    MutationResult<P, { path: Path.Directory<PartitionedNonEmpty<Partition>> }>
  >
  async createDirectory(
    path: Path.Directory<PartitionedNonEmpty<Partition>>,
    mutationOptions: MutationOptions = {}
  ): Promise<
    MutationResult<
      Partition,
      { path: Path.Directory<PartitionedNonEmpty<Partition>> }
    >
  > {
    let finalPath = path

    const mutationResult = await this.#infusedTransaction(
      async (t) => {
        const creationResult = await t.createDirectory(path)
        finalPath = creationResult.path
      },
      path,
      mutationOptions
    )

    return {
      ...mutationResult,
      path: finalPath,
    }
  }

  /** @group Mutating */
  async createFile<P extends Partition, D extends DataType, V = unknown>(
    path: Path.File<PartitionedNonEmpty<P>>,
    dataType: DataType,
    data: DataForType<D, V>,
    mutationOptions?: MutationOptions
  ): Promise<
    MutationResult<P, { path: Path.File<PartitionedNonEmpty<Partition>> }>
  >
  async createFile<D extends DataType, V = unknown>(
    path: Path.File<PartitionedNonEmpty<Partition>>,
    dataType: DataType,
    data: DataForType<D, V>,
    mutationOptions: MutationOptions = {}
  ): Promise<
    MutationResult<
      Partition,
      { path: Path.File<PartitionedNonEmpty<Partition>> }
    >
  > {
    let finalPath = path

    const mutationResult = await this.#infusedTransaction(
      async (t) => {
        const creationResult = await t.createFile(path, dataType, data)
        finalPath = creationResult.path
      },
      path,
      mutationOptions
    )

    return {
      ...mutationResult,
      path: finalPath,
    }
  }

  /** @group Mutating */
  async ensureDirectory<P extends Partition>(
    path: Path.Directory<PartitionedNonEmpty<P>>,
    mutationOptions?: MutationOptions
  ): Promise<MutationResult<P>>
  async ensureDirectory(
    path: Path.Directory<PartitionedNonEmpty<Partition>>,
    mutationOptions: MutationOptions = {}
  ): Promise<MutationResult<Partition>> {
    return await this.#infusedTransaction(
      async (t) => {
        await t.ensureDirectory(path)
      },
      path,
      mutationOptions
    )
  }

  /** @group Mutating */
  mkdir = this.ensureDirectory

  /** @group Mutating */
  async move<From extends Partition, To extends Partition>(
    from: Path.Distinctive<PartitionedNonEmpty<From>>,
    to: Path.File<PartitionedNonEmpty<To>> | Path.Directory<Partitioned<To>>,
    mutationOptions?: MutationOptions
  ): Promise<MutationResult<To>>
  async move(
    from: Path.Distinctive<PartitionedNonEmpty<Partition>>,
    to:
      | Path.File<PartitionedNonEmpty<Partition>>
      | Path.Directory<Partitioned<Partition>>,
    mutationOptions: MutationOptions = {}
  ): Promise<MutationResult<Partition>> {
    return await this.#infusedTransaction(
      async (t) => {
        await t.move(from, to)
      },
      to,
      mutationOptions
    )
  }

  /** @group Mutating */
  mv = this.move

  /** @group Mutating */
  async remove(
    path: Path.Distinctive<PartitionedNonEmpty<Partition>>,
    mutationOptions: MutationOptions = {}
  ): Promise<NOOP | { dataRoot: CID }> {
    const transactionResult = await this.transaction(async (t) => {
      await t.remove(path)
    }, mutationOptions)

    if (transactionResult === 'no-op') {
      return 'no-op'
    }

    return {
      dataRoot: transactionResult.dataRoot,
    }
  }

  /** @group Mutating */
  rm = this.remove

  /** @group Mutating */
  async rename<P extends Partition>(
    path: Path.Distinctive<PartitionedNonEmpty<P>>,
    newName: string,
    mutationOptions?: MutationOptions
  ): Promise<MutationResult<P>>
  async rename(
    path: Path.Distinctive<PartitionedNonEmpty<Partition>>,
    newName: string,
    mutationOptions: MutationOptions = {}
  ): Promise<MutationResult<Partition>> {
    return await this.#infusedTransaction(
      async (t) => {
        await t.rename(path, newName)
      },
      Path.replaceTerminus(path, newName),
      mutationOptions
    )
  }

  /** @group Mutating */
  async write<P extends Partition, D extends DataType, V = unknown>(
    path: Path.File<PartitionedNonEmpty<P>>,
    dataType: DataType,
    data: DataForType<D, V>,
    mutationOptions?: MutationOptions
  ): Promise<MutationResult<P>>
  async write<D extends DataType, V = unknown>(
    path: Path.File<PartitionedNonEmpty<Partition>>,
    dataType: DataType,
    data: DataForType<D, V>,
    mutationOptions: MutationOptions = {}
  ): Promise<MutationResult<Partition>> {
    return await this.#infusedTransaction(
      async (t) => {
        await t.write(path, dataType, data)
      },
      path,
      mutationOptions
    )
  }

  // TRANSACTIONS
  // ------------

  /** @group Transacting */
  async transaction(
    handler: (t: TransactionContext) => Promise<void>,
    mutationOptions: MutationOptions = {}
  ): Promise<
    | {
        modifications: Modification[]
        dataRoot: CID
      }
    | NOOP
  > {
    const context = this.#transactionContext()

    // Execute handler
    await handler(context)

    // Commit transaction
    const commitResult = await TransactionContext.commit(context)
    if (commitResult === 'no-op') return 'no-op'

    const { modifications, privateNodes, rootTree } = commitResult

    this.#privateNodes = privateNodes
    this.#rootTree = rootTree

    // Determine data root
    const dataRoot = await this.calculateDataRoot()

    // Emit events
    await this.#eventEmitter.emit('commit', {
      dataRoot,
      modifications: [...modifications],
    })

    // Publish
    if (
      mutationOptions.skipPublish === false ||
      mutationOptions.skipPublish === undefined
    ) {
      await this.#publish(dataRoot)
    }

    // Fin
    return {
      modifications,
      dataRoot,
    }
  }

  // 🛠️

  /** @group Misc */
  async calculateDataRoot(): Promise<CID> {
    return await this.#rootTree.store()
  }

  // ㊙️  ▒▒  MUTATIONS

  async #infusedTransaction(
    handler: (t: TransactionContext) => Promise<void>,
    path: Path.Distinctive<Partitioned<Public>>,
    mutationOptions?: MutationOptions
  ): Promise<PublicMutationResult>
  async #infusedTransaction(
    handler: (t: TransactionContext) => Promise<void>,
    path: Path.Distinctive<Partitioned<Private>>,
    mutationOptions?: MutationOptions
  ): Promise<PrivateMutationResult>
  async #infusedTransaction(
    handler: (t: TransactionContext) => Promise<void>,
    path: Path.Distinctive<Partitioned<Partition>>,
    mutationOptions?: MutationOptions
  ): Promise<MutationResult<Partition>>
  async #infusedTransaction(
    handler: (t: TransactionContext) => Promise<void>,
    path: Path.Distinctive<Partitioned<Partition>>,
    mutationOptions: MutationOptions = {}
  ): Promise<MutationResult<Partition>> {
    const transactionResult = await this.transaction(handler, mutationOptions)

    if (transactionResult === 'no-op') {
      throw new Error(
        'The transaction was a no-op, most likely as a result of the commit not being approved by the `onCommit` verifier.'
      )
    }

    const dataRoot = transactionResult.dataRoot
    const partition = determinePartition(path)

    switch (partition.name) {
      case 'public': {
        const node =
          partition.segments.length === 0
            ? this.#rootTree.publicRoot().asNode()
            : await this.#rootTree
                .publicRoot()
                .getNode(partition.segments, Store.wnfs(this.#blockstore))
        if (node === null || node === undefined)
          throw new Error('Failed to find needed public node for infusion')

        const fileOrDir: PublicFile | PublicDirectory =
          node.isFile() === true ? node.asFile() : node.asDir()

        const capsuleCID = await fileOrDir
          .store(Store.wnfs(this.#blockstore))
          .then((a) => CID.decode(a))
        const contentCID =
          node.isFile() === true
            ? CID.decode(node.asFile().contentCid())
            : capsuleCID

        return {
          dataRoot,
          capsuleCID,
          contentCID,
        }
      }

      case 'private': {
        const priv = findPrivateNode(partition.path, this.#privateNodes)
        const accessKey = priv.node.isFile()
          ? await priv.node
              .asFile()
              .store(
                this.#rootTree.privateForest(),
                Store.wnfs(this.#blockstore),
                this.#rng
              )
          : await (priv.remainder.length === 0
              ? Promise.resolve(priv.node)
              : priv.node
                  .asDir()
                  .getNode(
                    priv.remainder,
                    searchLatest(),
                    this.#rootTree.privateForest(),
                    Store.wnfs(this.#blockstore)
                  )
            )
              .then((node) => {
                if (node === null || node === undefined)
                  throw new Error(
                    'Failed to find needed private node for infusion'
                  )
                return node.store(
                  this.#rootTree.privateForest(),
                  Store.wnfs(this.#blockstore)
                )
              })
              .then(([key]) => key)

        return {
          dataRoot,
          capsuleKey: accessKey.toBytes(),
        }
      }
    }
  }

  #transactionContext(): TransactionContext {
    return new TransactionContext(
      this.#blockstore,
      this.#onCommit,
      { ...this.#privateNodes },
      this.#rng,
      this.#rootTree.clone()
    )
  }

  // ㊙️  ▒▒  PUBLISHING

  async #publish(dataRoot: CID): Promise<void> {
    await this.#debouncedDataRootUpdate(dataRoot)
  }
}
