import type { Blockstore } from 'interface-blockstore'
import type {
  AccessKey,
  PrivateDirectory,
  PrivateFile,
  PublicDirectory,
  PublicNode,
} from 'wnfs'

import { PrivateNode } from 'wnfs'
import { CID } from 'multiformats/cid'

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

export const publicRead = (options?: { offset: number; length: number }) => {
  return async (params: PublicParams): Promise<Uint8Array> => {
    const result = await params.rootTree
      .publicRoot()
      .read(params.pathSegments, Store.wnfs(params.blockstore))

    return await publicReadFromCID(CID.decode(result), options)(params)
  }
}

export const publicReadFromCID = (
  cid: CID,
  options?: { offset: number; length: number }
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

export const privateRead = (_options?: { offset: number; length: number }) => {
  return async (params: PrivateParams): Promise<Uint8Array> => {
    // TODO: Respect `offset` and `length` options when private streaming API is exposed in rs-wnfs
    // const offset = options?.offset
    // const length = options?.length

    let bytes

    if (params.node.isFile()) {
      bytes = await params.node
        .asFile()
        .getContent(
          params.rootTree.privateForest(),
          Store.wnfs(params.blockstore)
        )
    } else {
      const { result } = await params.node
        .asDir()
        .read(
          params.remainder,
          searchLatest(),
          params.rootTree.privateForest(),
          Store.wnfs(params.blockstore)
        )
      bytes = result
    }

    return bytes
  }
}

export const privateReadFromAccessKey = (
  accessKey: AccessKey,
  _options?: { offset: number; length: number }
) => {
  return async (context: PrivateContext): Promise<Uint8Array> => {
    // TODO: Respect `offset` and `length` options when private streaming API is exposed in rs-wnfs
    // const offset = options?.offset
    // const length = options?.length

    // Retrieve node
    const node = await PrivateNode.load(
      accessKey,
      context.rootTree.privateForest(),
      Store.wnfs(context.blockstore)
    )

    if (node.isFile() === true) {
      const file: PrivateFile = node.asFile()

      // TODO: Respect the offset and length options when available in rs-wnfs
      return await file.getContent(
        context.rootTree.privateForest(),
        Store.wnfs(context.blockstore)
      )
    } else {
      throw new Error('Expected a file, found a directory')
    }
  }
}
