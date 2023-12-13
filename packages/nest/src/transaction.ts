import type { PrivateForest, PrivateNode } from 'wnfs'
import type { Blockstore } from 'interface-blockstore'

import { CID } from 'multiformats/cid'
import { AccessKey, PublicFile } from 'wnfs'

import * as Path from './path.js'
import * as Mutations from './mutations.js'
import * as Queries from './queries.js'
import * as References from './references.js'
import * as Store from './store.js'

import type {
  Partition,
  Partitioned,
  PartitionedNonEmpty,
  Private,
  Public,
} from './path.js'

import { addOrIncreaseNameNumber, searchLatest } from './common.js'

import { dataFromBytes, dataToBytes } from './data.js'
import { partition as determinePartition, findPrivateNode } from './mounts.js'
import type { Rng } from './rng.js'
import type { RootTree } from './root-tree.js'

import type {
  AnySupportedDataType,
  DataForType,
  DataType,
  DirectoryItem,
  DirectoryItemWithKind,
  MutationType,
} from './types.js'

import type {
  MountedPrivateNodes,
  PrivateNodeQueryResult,
} from './types/internal.js'

// CLASS

/** @group File System */
export class TransactionContext {
  readonly #blockstore: Blockstore
  readonly #rng: Rng

  #privateNodes: MountedPrivateNodes
  #rootTree: RootTree

  readonly #changes: Set<{
    type: MutationType
    path: Path.Distinctive<Partitioned<Partition>>
  }>

  /** @internal */
  constructor(
    blockstore: Blockstore,
    privateNodes: MountedPrivateNodes,
    rng: Rng,
    rootTree: RootTree
  ) {
    this.#blockstore = blockstore
    this.#privateNodes = privateNodes
    this.#rng = rng
    this.#rootTree = rootTree

    this.#changes = new Set()
  }

  /** @internal */
  static async commit(context: TransactionContext): Promise<{
    changes: Array<{
      path: Path.Distinctive<Partitioned<Partition>>
      type: MutationType
    }>
    privateNodes: MountedPrivateNodes
    rootTree: RootTree
  }> {
    const changes = [...context.#changes]

    // Private forest
    const newForest = await changes.reduce(
      async (oldForestPromise, change): Promise<PrivateForest> => {
        const oldForest = await oldForestPromise

        if (!Path.isPartition('private', change.path)) {
          return oldForest
        }

        const maybeNode = findPrivateNode(
          change.path as Path.Distinctive<Path.Partitioned<Path.Private>>,
          context.#privateNodes
        )

        const [_newAccessKey, newForest] = await maybeNode.node.store(
          oldForest,
          Store.wnfs(context.#blockstore),
          context.#rng
        )
        return newForest
      },
      Promise.resolve(context.#rootTree.privateForest())
    )

    // Replace forest
    const rootTree = await context.#rootTree.replacePrivateForest(
      newForest,
      changes
    )

    // Fin
    return {
      changes: changes,
      privateNodes: context.#privateNodes,
      rootTree: rootTree,
    }
  }

  // QUERIES

  /** @group Querying */
  async contentCID(
    path: Path.File<Partitioned<Public>>
  ): Promise<CID | undefined> {
    return await References.contentCID(this.#blockstore, this.#rootTree, path)
  }

  /** @group Querying */
  async capsuleCID(
    path: Path.Distinctive<Partitioned<Public>>
  ): Promise<CID | undefined> {
    return await References.capsuleCID(this.#blockstore, this.#rootTree, path)
  }

  /** @group Querying */
  async capsuleKey(
    path: Path.Distinctive<Partitioned<Private>>
  ): Promise<Uint8Array | undefined> {
    let priv: PrivateNodeQueryResult

    try {
      priv = findPrivateNode(path, this.#privateNodes)
    } catch {
      return undefined
    }

    return priv.remainder.length === 0 || priv.node.isFile()
      ? await priv.node
          .store(
            this.#rootTree.privateForest(),
            Store.wnfs(this.#blockstore),
            this.#rng
          )
          .then(([accessKey]: [AccessKey, PrivateForest]) =>
            accessKey.toBytes()
          )
      : await priv.node
          .asDir()
          .getNode(
            priv.remainder,
            searchLatest(),
            this.#rootTree.privateForest(),
            Store.wnfs(this.#blockstore)
          )
          .then(async (result: PrivateNode | undefined) => {
            return result === undefined
              ? undefined
              : await result
                  .store(
                    this.#rootTree.privateForest(),
                    Store.wnfs(this.#blockstore),
                    this.#rng
                  )
                  .then(([accessKey]: [AccessKey, PrivateForest]) =>
                    accessKey.toBytes()
                  )
          })
  }

  /** @group Querying */
  async exists(
    path: Path.Distinctive<Partitioned<Partition>>
  ): Promise<boolean> {
    return await this.#query(path, {
      public: Queries.publicExists(),
      private: Queries.privateExists(),
    })
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
  ): Promise<DirectoryItem[] | DirectoryItemWithKind[]>
  async listDirectory(
    path: Path.Directory<Partitioned<Partition>>,
    listOptions?: { withItemKind: boolean }
  ): Promise<DirectoryItem[] | DirectoryItemWithKind[]> {
    if (listOptions?.withItemKind === true) {
      return await this.#query(path, {
        public: Queries.publicListDirectoryWithKind(),
        private: Queries.privateListDirectoryWithKind(),
      })
    }

    return await this.#query(path, {
      public: Queries.publicListDirectory(),
      private: Queries.privateListDirectory(),
    })
  }

  /** @group Querying */
  ls = this.listDirectory

  /** @group Querying */
  async read<D extends DataType, V = unknown>(
    arg:
      | Path.File<PartitionedNonEmpty<Partition>>
      | { contentCID: CID }
      | { capsuleCID: CID }
      | {
          capsuleKey: Uint8Array
        },
    dataType: DataType,
    options?: { offset: number; length: number }
  ): Promise<DataForType<D, V>>
  async read<V = unknown>(
    arg:
      | Path.File<PartitionedNonEmpty<Partition>>
      | { contentCID: CID }
      | { capsuleCID: CID }
      | {
          capsuleKey: Uint8Array
        },
    dataType: DataType,
    options?: { offset: number; length: number }
  ): Promise<AnySupportedDataType<V>> {
    let bytes

    if ('contentCID' in arg) {
      // Public content from content CID
      bytes = await Queries.publicReadFromCID(
        arg.contentCID,
        options
      )(this.#publicContext())
    } else if ('capsuleCID' in arg) {
      // Public content from capsule CID
      const publicFile: PublicFile = await PublicFile.load(
        arg.capsuleCID.bytes,
        Store.wnfs(this.#blockstore)
      )

      return await this.read<DataType, V>(
        { contentCID: CID.decode(publicFile.contentCid()) },
        dataType,
        options
      )
    } else if ('capsuleKey' in arg) {
      // Private content from capsule key
      bytes = await Queries.privateReadFromAccessKey(
        AccessKey.fromBytes(arg.capsuleKey),
        options
      )(this.#privateContext())
    } else if ('file' in arg || 'directory' in arg) {
      // Public or private from path
      bytes = await this.#query(arg, {
        public: Queries.publicRead(options),
        private: Queries.privateRead(options),
      })
    } else {
      // ⚠️
      throw new Error('Invalid argument')
    }

    return dataFromBytes(dataType, bytes)
  }

  // MUTATIONS

  /** @group Mutating */
  async copy(
    fromParam: Path.Distinctive<PartitionedNonEmpty<Partition>>,
    toParam:
      | Path.File<PartitionedNonEmpty<Partition>>
      | Path.Directory<Partitioned<Partition>>
  ): Promise<void> {
    const from = fromParam
    let to = toParam

    if (Path.isDirectory(fromParam) && Path.isFile(toParam))
      throw new Error('Cannot copy a directory to a file')
    if (Path.isFile(fromParam) && Path.isDirectory(toParam))
      to = Path.combine(toParam, Path.file(Path.terminus(from)))

    if (Path.isFile(from) && Path.isFile(to)) {
      await this.#manualCopyFile(from, to)
      return
    } else if (Path.isDirectory(from) && Path.isDirectory(to)) {
      await this.#manualCopyDirectory(from, to)
      return
    }

    // NOOP
    throw new Error(
      `Copy no-op, from '${Path.toPosix(from)}' to '${Path.toPosix(to)}'`
    )
  }

  /** @group Mutating */
  cp = this.copy

  /** @group Mutating */
  async createDirectory(
    path: Path.Directory<PartitionedNonEmpty<Partition>>
  ): Promise<{ path: Path.Directory<PartitionedNonEmpty<Partition>> }> {
    if (await this.exists(path)) {
      const newPath = addOrIncreaseNameNumber(path)
      return await this.createDirectory(newPath)
    } else {
      await this.ensureDirectory(path)
      return { path: path }
    }
  }

  /** @group Mutating */
  async createFile<D extends DataType, V = unknown>(
    path: Path.File<PartitionedNonEmpty<Partition>>,
    dataType: DataType,
    data: DataForType<D, V>
  ): Promise<{ path: Path.File<PartitionedNonEmpty<Partition>> }> {
    if (await this.exists(path)) {
      const newPath = addOrIncreaseNameNumber(path)
      return await this.createFile(newPath, dataType, data)
    } else {
      await this.write(path, dataType, data)
      return { path: path }
    }
  }

  /** @group Mutating */
  async ensureDirectory(
    path: Path.Directory<PartitionedNonEmpty<Partition>>
  ): Promise<void> {
    const partition = determinePartition(path)

    switch (partition.name) {
      case 'public': {
        await this.#publicMutation(
          partition.path,
          Mutations.publicCreateDirectory(),
          Mutations.TYPES.ADDED_OR_UPDATED
        )
        break
      }

      case 'private': {
        await this.#privateMutation(
          partition.path,
          Mutations.privateCreateDirectory(),
          Mutations.TYPES.ADDED_OR_UPDATED
        )
        break
      }
    }
  }

  mkdir = this.ensureDirectory

  async move(
    fromParam: Path.Distinctive<PartitionedNonEmpty<Partition>>,
    toParam:
      | Path.File<PartitionedNonEmpty<Partition>>
      | Path.Directory<Partitioned<Partition>>
  ): Promise<void> {
    const from = fromParam
    let to = toParam

    if (Path.isDirectory(fromParam) && Path.isFile(toParam))
      throw new Error('Cannot move a directory to a file')
    if (Path.isFile(fromParam) && Path.isDirectory(toParam))
      to = Path.combine(toParam, Path.file(Path.terminus(from)))

    await this.#manualMove(from, to)
  }

  /** @group Mutating */
  mv = this.move

  /** @group Mutating */
  async remove(
    path: Path.Distinctive<PartitionedNonEmpty<Partition>>
  ): Promise<void> {
    const partition = determinePartition(path)

    switch (partition.name) {
      case 'public': {
        await this.#publicMutation(
          partition.path,
          Mutations.publicRemove(),
          Mutations.TYPES.REMOVED
        )
        break
      }

      case 'private': {
        await this.#privateMutation(
          partition.path,
          Mutations.privateRemove(),
          Mutations.TYPES.REMOVED
        )
        break
      }
    }
  }

  /** @group Mutating */
  rm = this.remove

  /** @group Mutating */
  async rename(
    path: Path.Distinctive<PartitionedNonEmpty<Partition>>,
    newName: string
  ): Promise<void> {
    const fromPath = path
    const toPath = Path.replaceTerminus(fromPath, newName)

    await this.move(fromPath, toPath)
  }

  /** @group Mutating */
  async write<D extends DataType, V = unknown>(
    path: Path.File<PartitionedNonEmpty<Partition>>,
    dataType: DataType,
    data: DataForType<D, V>
  ): Promise<void> {
    const bytes = dataToBytes<V>(dataType, data)
    const partition = determinePartition(path)

    switch (partition.name) {
      case 'public': {
        await this.#publicMutation(
          partition.path,
          Mutations.publicWrite(bytes),
          Mutations.TYPES.ADDED_OR_UPDATED
        )
        break
      }

      case 'private': {
        await this.#privateMutation(
          partition.path,
          Mutations.privateWrite(bytes),
          Mutations.TYPES.ADDED_OR_UPDATED
        )
        break
      }
    }
  }

  // ㊙️  ▒▒  QUERIES

  async #query<T>(
    path: Path.Distinctive<Partitioned<Partition>>,
    queryFunctions: {
      public: Queries.Public<T>
      private: Queries.Private<T>
    }
  ): Promise<T> {
    const partition = determinePartition(path)

    switch (partition.name) {
      case 'public': {
        return await Queries.publicQuery(
          partition.path,
          queryFunctions.public,
          this.#publicContext()
        )
      }

      case 'private': {
        return await Queries.privateQuery(
          partition.path,
          queryFunctions.private,
          this.#privateContext()
        )
      }
    }
  }

  // ㊙️  ▒▒  MUTATIONS

  async #manualCopyFile(
    from: Path.File<PartitionedNonEmpty<Partition>>,
    to: Path.File<PartitionedNonEmpty<Partition>>
  ): Promise<void> {
    await this.write(to, 'bytes', await this.read(from, 'bytes'))
  }

  async #manualCopyDirectory(
    from: Path.Directory<PartitionedNonEmpty<Partition>>,
    to: Path.Directory<Partitioned<Partition>>
  ): Promise<void> {
    if (Path.isPartitionedNonEmpty(to)) await this.ensureDirectory(to)

    // Copies everything under `fromDir/` to `toDir/`
    // eg. `public/docs/fromDir/a/b/c.txt` -> `private/docs/toDir/a/b/c.txt`
    const listing = await this.listDirectory(from, { withItemKind: true })
    if (listing.length === 0) return

    await listing.reduce(
      async (
        acc: Promise<void>,
        item: DirectoryItemWithKind
      ): Promise<void> => {
        await acc

        item.kind === 'directory'
          ? await this.#manualCopyDirectory(
              Path.combine(from, Path.directory(item.name)),
              Path.combine(to, Path.directory(item.name))
            )
          : await this.#manualCopyFile(
              Path.combine(from, Path.file(item.name)),
              Path.combine(to, Path.file(item.name))
            )
      },
      Promise.resolve()
    )
  }

  async #manualMove(
    from: Path.Distinctive<PartitionedNonEmpty<Partition>>,
    to:
      | Path.File<PartitionedNonEmpty<Partition>>
      | Path.Directory<Partitioned<Partition>>
  ): Promise<void> {
    await this.copy(from, to)
    await this.remove(from)
  }

  async #publicMutation(
    path: Path.Distinctive<Partitioned<Public>>,
    mut: Mutations.Public,
    mutType: MutationType
  ): Promise<void> {
    const change = {
      type: mutType,
      path: path,
    }

    const result = await mut({
      blockstore: this.#blockstore,
      pathSegments: Path.unwrap(Path.removePartition(path)),
      rootTree: this.#rootTree,
    })

    // Replace public root
    this.#rootTree = await this.#rootTree.replacePublicRoot(result.rootDir, [
      change,
    ])

    // Mark node as changed
    this.#changes.add(change)
  }

  async #privateMutation(
    path: Path.Distinctive<Partitioned<Private>>,
    mut: Mutations.Private,
    mutType: MutationType
  ): Promise<void> {
    const priv = findPrivateNode(path, this.#privateNodes)
    const change = {
      type: mutType,
      path: path,
    }

    // Perform mutation
    const result = await mut({
      ...priv,
      blockstore: this.#blockstore,
      privateNodes: this.#privateNodes,
      rng: this.#rng,
      rootTree: this.#rootTree,
    })

    // Mark node as changed
    this.#changes.add(change)

    // Replace forest
    this.#rootTree = await this.#rootTree.replacePrivateForest(result.forest, [
      change,
    ])

    // Replace private node
    const nodePosix = Path.toPosix(priv.path, { absolute: true })
    const node = result.rootDir.asNode()

    this.#privateNodes[nodePosix] = {
      node,
      path: priv.path,
    }
  }

  // ㊙️

  #publicContext(): Queries.PublicContext {
    return {
      blockstore: this.#blockstore,
      rootTree: this.#rootTree,
    }
  }

  #privateContext(): Queries.PrivateContext {
    return {
      blockstore: this.#blockstore,
      privateNodes: this.#privateNodes,
      rng: this.#rng,
      rootTree: this.#rootTree,
    }
  }
}
