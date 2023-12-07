import type { BlockStore } from 'wnfs'

import type * as Path from './path.js'

// TODO: import * as Unix from "./unix.js"

import { searchLatest } from './common.js'
import type { Rng } from './rng.js'
import type { RootTree } from './root-tree.js'
import type { MutationType } from './types.js'
import type {
  MountedPrivateNodes,
  PrivateNodeQueryResult,
  WnfsPrivateResult,
  WnfsPublicResult,
} from './types/internal.js'

// 🏔️

export const TYPES: Record<string, MutationType> = {
  ADDED_OR_UPDATED: 'added-or-updated',
  REMOVED: 'removed',
}

// PUBLIC

export interface PublicParams {
  blockStore: BlockStore
  pathSegments: Path.Segments
  rootTree: RootTree
}

export type Public = (params: PublicParams) => Promise<WnfsPublicResult>

export const publicCreateDirectory = () => {
  return async (params: PublicParams): Promise<WnfsPublicResult> => {
    return await params.rootTree.publicRoot.mkdir(
      params.pathSegments,
      new Date(),
      params.blockStore
    )
  }
}

export const publicRemove = () => {
  return async (params: PublicParams): Promise<WnfsPublicResult> => {
    return await params.rootTree.publicRoot.rm(
      params.pathSegments,
      params.blockStore
    )
  }
}

export const publicWrite = (bytes: Uint8Array) => {
  return async (params: PublicParams): Promise<WnfsPublicResult> => {
    const cid = await Unix.importFile(bytes, params.dependencies.depot)

    return await params.rootTree.publicRoot.write(
      params.pathSegments,
      cid.bytes,
      new Date(),
      params.blockStore
    )
  }
}

// PRIVATE

export type PrivateParams = {
  blockStore: BlockStore
  privateNodes: MountedPrivateNodes
  rng: Rng
  rootTree: RootTree
} & PrivateNodeQueryResult

export type Private = (params: PrivateParams) => Promise<WnfsPrivateResult>

export const privateCreateDirectory = () => {
  return async (params: PrivateParams): Promise<WnfsPrivateResult> => {
    if (params.node.isFile())
      throw new Error('Cannot create a directory inside a file')

    return await params.node
      .asDir()
      .mkdir(
        params.remainder,
        searchLatest(),
        new Date(),
        params.rootTree.privateForest,
        params.blockStore,
        params.rng
      )
  }
}

export const privateRemove = () => {
  return async (params: PrivateParams): Promise<WnfsPrivateResult> => {
    if (params.node.isFile()) {
      throw new Error('Cannot self-destruct')
    }

    return await params.node
      .asDir()
      .rm(
        params.remainder,
        searchLatest(),
        params.rootTree.privateForest,
        params.blockStore
      )
  }
}

export const privateWrite = (bytes: Uint8Array) => {
  return async (params: PrivateParams): Promise<WnfsPrivateResult> => {
    if (params.node.isFile()) {
      throw new Error('Cannot write into a PrivateFile directly')
    }

    return await params.node
      .asDir()
      .write(
        params.remainder,
        searchLatest(),
        bytes,
        new Date(),
        params.rootTree.privateForest,
        params.blockStore,
        params.rng
      )
  }
}
