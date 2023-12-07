import type {
  AccessKey,
  BlockStore,
  PrivateDirectory,
  PrivateFile,
  PublicDirectory,
  PublicNode,
} from 'wnfs'

import { PrivateNode } from 'wnfs'
import { CID } from 'multiformats'

import * as Path from './path/index.js'

import type { Partitioned } from './path/index.js'
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
  blockStore: BlockStore
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
    blockStore: context.blockStore,
    pathSegments: Path.unwrap(Path.removePartition(path)),
    rootTree: context.rootTree,
  })
}

export const publicExists = () => {
  return async (params: PublicParams): Promise<boolean> => {
    const result = await params.rootTree.publicRoot.getNode(
      params.pathSegments,
      params.blockStore
    )

    return result !== null && result !== undefined
  }
}

export const publicListDirectory = () => {
  return async (params: PublicParams): Promise<DirectoryItem[]> => {
    return params.rootTree.publicRoot.ls(params.pathSegments, params.blockStore)
  }
}

export const publicListDirectoryWithKind = () => {
  return async (params: PublicParams): Promise<DirectoryItemWithKind[]> => {
    const dir: PublicDirectory =
      params.pathSegments.length === 0
        ? params.rootTree.publicRoot
        : await params.rootTree.publicRoot
            .getNode(params.pathSegments, params.blockStore)
            .then((a) => a.asDir())
    const items: DirectoryItem[] = await dir.ls([], params.blockStore)

    const promises = items.map(async (item): Promise<DirectoryItemWithKind> => {
      const node: PublicNode = await dir.lookupNode(
        item.name,
        params.blockStore
      )
      const kind = node.isDir() === true ? Path.Kind.Directory : Path.Kind.File

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
    const result = await params.rootTree.publicRoot.read(
      params.pathSegments,
      params.blockStore
    )

    return await publicReadFromCID(CID.decode(result), options)(params)
  }
}

export const publicReadFromCID = (
  cid: CID,
  options?: { offset: number; length: number }
) => {
  return async (context: PublicContext): Promise<Uint8Array> => {
    // TODO:
    // return Unix.exportFile(cid, context.dependencies.depot, options)
    return new Uint8Array()
  }
}

// PRIVATE

export type PrivateParams = {
  blockStore: BlockStore
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
    blockStore: context.blockStore,
    privateNodes: context.privateNodes,
    rng: context.rng,
    rootTree: context.rootTree,
  })
}

export const privateExists = () => {
  return async (params: PrivateParams): Promise<boolean> => {
    if (params.node.isFile() === true) return true

    const result = await params.node
      .asDir()
      .getNode(
        params.remainder,
        searchLatest(),
        params.rootTree.privateForest,
        params.blockStore
      )

    return result !== null && result !== undefined
  }
}

export const privateListDirectory = () => {
  return async (params: PrivateParams): Promise<DirectoryItem[]> => {
    if (params.node.isFile() === true) throw new Error('Cannot list a file')
    const { result } = await params.node
      .asDir()
      .ls(
        params.remainder,
        searchLatest(),
        params.rootTree.privateForest,
        params.blockStore
      )
    return result
  }
}

export const privateListDirectoryWithKind = () => {
  return async (params: PrivateParams): Promise<DirectoryItemWithKind[]> => {
    if (params.node.isFile() === true) throw new Error('Cannot list a file')

    const dir: PrivateDirectory =
      params.remainder.length === 0
        ? params.node.asDir()
        : await params.node
            .asDir()
            .getNode(
              params.remainder,
              searchLatest(),
              params.rootTree.privateForest,
              params.blockStore
            )
            .then((a) => a.asDir())
    const items: DirectoryItem[] = await dir
      .ls([], searchLatest(), params.rootTree.privateForest, params.blockStore)
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
          params.rootTree.privateForest,
          params.blockStore
        )

        const kind =
          node.isDir() === true ? Path.Kind.Directory : Path.Kind.File

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

export const privateRead = (options?: { offset: number; length: number }) => {
  return async (params: PrivateParams): Promise<Uint8Array> => {
    // TODO: Respect `offset` and `length` options when private streaming API is exposed in rs-wnfs
    // const offset = options?.offset
    // const length = options?.length

    let bytes

    if (params.node.isFile() === true) {
      bytes = await params.node
        .asFile()
        .getContent(params.rootTree.privateForest, params.blockStore)
    } else {
      const { result } = await params.node
        .asDir()
        .read(
          params.remainder,
          searchLatest(),
          params.rootTree.privateForest,
          params.blockStore
        )
      bytes = result
    }

    return bytes
  }
}

export const privateReadFromAccessKey = (
  accessKey: AccessKey,
  options?: { offset: number; length: number }
) => {
  return async (context: PrivateContext): Promise<Uint8Array> => {
    // TODO: Respect `offset` and `length` options when private streaming API is exposed in rs-wnfs
    // const offset = options?.offset
    // const length = options?.length

    // Retrieve node
    const node = await PrivateNode.load(
      accessKey,
      context.rootTree.privateForest,
      context.blockStore
    )

    if (node.isFile() === true) {
      const file: PrivateFile = node.asFile()

      // TODO: Respect the offset and length options when available in rs-wnfs
      return file.getContent(context.rootTree.privateForest, context.blockStore)
    } else {
      throw new Error('Expected a file, found a directory')
    }
  }
}
