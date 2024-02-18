import type { CID } from 'multiformats/cid'
import type { Blockstore } from 'interface-blockstore'
import type {
  AccessKey,
  PrivateDirectory,
  PrivateFile,
  PublicDirectory,
  PublicNode,
} from 'wnfs'

import { PrivateNode } from 'wnfs'

import * as Store from './store.js'
import * as Path from './path.js'
import * as Unix from './unix.js'

import type { Partitioned } from './path.js'
import type { Rng } from './rng.js'
import type { RootTree } from './root-tree.js'
import type { DirectoryItem, DirectoryItemWithKind } from './types.js'
import type {
  MountedPrivateNodes,
  PrivateNodeQueryResult,
} from './types/internal.js'

import { searchLatest } from './common.js'
import { findPrivateNode } from './mounts.js'

// PUBLIC

export interface PublicParams {
  blockstore: Blockstore
  pathSegments: Path.Segments
  rootTree: RootTree
}

export type Public<T> = (params: PublicParams) => Promise<T>
export type PublicContext = Omit<PublicParams, 'pathSegments'>

export async function publicQuery<T>(
  path: Path.Distinctive<Partitioned<Path.Public>>,
  qry: Public<T>,
  context: PublicContext
): Promise<T> {
  return await qry({
    blockstore: context.blockstore,
    pathSegments: Path.unwrap(Path.removePartition(path)),
    rootTree: context.rootTree,
  })
}

export const publicExists = () => {
  return async (params: PublicParams): Promise<boolean> => {
    const result = await params.rootTree
      .publicRoot()
      .getNode(params.pathSegments, Store.wnfs(params.blockstore))

    return result !== null && result !== undefined
  }
}

export const publicListDirectory = () => {
  return async (params: PublicParams): Promise<DirectoryItem[]> => {
    return await params.rootTree
      .publicRoot()
      .ls(params.pathSegments, Store.wnfs(params.blockstore))
  }
}

export const publicListDirectoryWithKind = () => {
  return async (params: PublicParams): Promise<DirectoryItemWithKind[]> => {
    const dir: PublicDirectory =
      params.pathSegments.length === 0
        ? params.rootTree.publicRoot()
        : await params.rootTree
            .publicRoot()
            .getNode(params.pathSegments, Store.wnfs(params.blockstore))
            .then((a) => a.asDir())
    const items: DirectoryItem[] = await dir.ls(
      [],
      Store.wnfs(params.blockstore)
    )

    const promises = items.map(async (item): Promise<DirectoryItemWithKind> => {
      const node: PublicNode = await dir.lookupNode(
        item.name,
        Store.wnfs(params.blockstore)
      )

      const kind = node.isDir() ? Path.Kind.Directory : Path.Kind.File

      return {
        ...item,
        kind,
        path: Path.combine(
          Path.directory('public', ...params.pathSegments),
          Path.fromKind(kind, item.name)
        ),
      }
    })

    return await Promise.all(promises)
  }
}

export const publicRead = (options?: { offset?: number; length?: number }) => {
  return async (params: PublicParams): Promise<Uint8Array> => {
    const wnfsBlockStore = Store.wnfs(params.blockstore)

    const node: PublicNode | null | undefined = await params.rootTree
      .publicRoot()
      .getNode(params.pathSegments, wnfsBlockStore)

    if (node === null || node === undefined) {
      throw new Error('Failed to find public node')
    } else if (node.isDir()) {
      throw new Error('Expected node to be a file')
    }

    return await node
      .asFile()
      .readAt(
        options?.offset ?? 0,
        options?.length ?? undefined,
        wnfsBlockStore
      )
  }
}

export const publicReadFromCID = (
  cid: CID,
  options?: { offset?: number; length?: number }
) => {
  return async (context: PublicContext): Promise<Uint8Array> => {
    return await Unix.exportFile(cid, context.blockstore, options)
  }
}

// PRIVATE

export type PrivateParams = {
  blockstore: Blockstore
  privateNodes: MountedPrivateNodes
  rng: Rng
  rootTree: RootTree
} & PrivateNodeQueryResult

export type Private<T> = (params: PrivateParams) => Promise<T>
export type PrivateContext = Omit<PrivateParams, keyof PrivateNodeQueryResult>

export async function privateQuery<T>(
  path: Path.Distinctive<Partitioned<Path.Private>>,
  qry: Private<T>,
  context: PrivateContext
): Promise<T> {
  const priv = findPrivateNode(path, context.privateNodes)

  // Perform mutation
  return await qry({
    ...priv,
    blockstore: context.blockstore,
    privateNodes: context.privateNodes,
    rng: context.rng,
    rootTree: context.rootTree,
  })
}

export const privateExists = () => {
  return async (params: PrivateParams): Promise<boolean> => {
    if (params.node.isFile()) return true

    const result = await params.node
      .asDir()
      .getNode(
        params.remainder,
        searchLatest(),
        params.rootTree.privateForest(),
        Store.wnfs(params.blockstore)
      )

    return result !== null && result !== undefined
  }
}

export const privateListDirectory = () => {
  return async (params: PrivateParams): Promise<DirectoryItem[]> => {
    if (params.node.isFile()) throw new Error('Cannot list a file')
    const { result } = await params.node
      .asDir()
      .ls(
        params.remainder,
        searchLatest(),
        params.rootTree.privateForest(),
        Store.wnfs(params.blockstore)
      )
    return result
  }
}

export const privateListDirectoryWithKind = () => {
  return async (params: PrivateParams): Promise<DirectoryItemWithKind[]> => {
    if (params.node.isFile()) throw new Error('Cannot list a file')

    const dir: PrivateDirectory =
      params.remainder.length === 0
        ? params.node.asDir()
        : await params.node
            .asDir()
            .getNode(
              params.remainder,
              searchLatest(),
              params.rootTree.privateForest(),
              Store.wnfs(params.blockstore)
            )
            .then((a) => a.asDir())
    const items: DirectoryItem[] = await dir
      .ls(
        [],
        searchLatest(),
        params.rootTree.privateForest(),
        Store.wnfs(params.blockstore)
      )
      .then((a) => a.result)

    const parentPath = Path.combine(
      Path.directory('private', ...Path.unwrap(params.path)),
      Path.directory(...params.remainder)
    )

    if (!Path.isDirectory(parentPath)) {
      throw new Error("Didn't expect a file path")
    }

    const promises = items.map(
      async (item: DirectoryItem): Promise<DirectoryItemWithKind> => {
        const node: PrivateNode = await dir.lookupNode(
          item.name,
          searchLatest(),
          params.rootTree.privateForest(),
          Store.wnfs(params.blockstore)
        )

        const kind = node.isDir() ? Path.Kind.Directory : Path.Kind.File

        return {
          ...item,
          kind,
          path: Path.combine(parentPath, Path.fromKind(kind, item.name)),
        }
      }
    )

    return await Promise.all(promises)
  }
}

export const privateRead = (options?: { offset?: number; length?: number }) => {
  return async (params: PrivateParams): Promise<Uint8Array> => {
    let node

    if (params.node.isDir()) {
      if (params.remainder.length === 0) {
        throw new Error('Expected node to be a file')
      }

      const tmpNode: PrivateNode | null | undefined = await params.node
        .asDir()
        .getNode(
          params.remainder,
          searchLatest(),
          params.rootTree.privateForest(),
          Store.wnfs(params.blockstore)
        )

      if (tmpNode === null || tmpNode === undefined) {
        throw new Error('Failed to find private node')
      } else if (tmpNode.isDir()) {
        throw new Error('Expected node to be a file')
      }

      node = tmpNode
    } else {
      node = params.node
    }

    return await node
      .asFile()
      .readAt(
        options?.offset ?? 0,
        options?.length ?? undefined,
        params.rootTree.privateForest(),
        Store.wnfs(params.blockstore)
      )
  }
}

export const privateReadFromAccessKey = (
  accessKey: AccessKey,
  options?: { offset?: number; length?: number }
) => {
  return async (context: PrivateContext): Promise<Uint8Array> => {
    // Retrieve node
    const node = await PrivateNode.load(
      accessKey,
      context.rootTree.privateForest(),
      Store.wnfs(context.blockstore)
    )

    if (node.isFile() === true) {
      const file: PrivateFile = node.asFile()

      // TODO: Respect the offset and length options when available in rs-wnfs
      return await file.readAt(
        options?.offset ?? 0,
        options?.length ?? undefined,
        context.rootTree.privateForest(),
        Store.wnfs(context.blockstore)
      )
    } else {
      throw new Error('Expected a file, found a directory')
    }
  }
}
