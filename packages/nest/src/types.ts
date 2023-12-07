import type { CID } from 'multiformats'
import type * as Path from './path/index.js'

/** @group File System */
export type AnySupportedDataType<V> =
  | Uint8Array
  | Record<string | number | symbol, V>
  | string

/** @group File System */
export interface DataRootChange {
  dataRoot: CID
  publishingStatus: Promise<PublishingStatus>
}

/** @group File System */
export type DataType = 'bytes' | 'json' | 'utf8'

/** @group File System */
export type DataForType<D extends DataType, V = unknown> = D extends 'bytes'
  ? Uint8Array
  : D extends 'json'
    ? Record<string | number | symbol, V>
    : D extends 'utf8'
      ? string
      : never

/** @group File System */
export interface DirectoryItem {
  metadata: { created: number; modified: number }
  name: string
}

/** @group File System */
export type DirectoryItemWithKind = DirectoryItem & {
  kind: Path.Kind
  path: Path.Distinctive<Path.PartitionedNonEmpty<Path.Partition>>
}

/** @group File System */
export interface MutationOptions {
  skipPublish?: boolean
}

/** @group File System */
export type MutationResult<P extends Path.Partition> = P extends Path.Public
  ? PublicMutationResult
  : P extends Path.Private
    ? PrivateMutationResult
    : never

/** @group File System */
export type MutationType = 'added-or-updated' | 'removed'

/** @group File System */
export type PartitionDiscovery<P extends Path.Partition> = P extends Path.Public
  ? {
      name: 'public'
      path: Path.File<Path.Partitioned<Path.Public>>
      segments: Path.Segments
    }
  : P extends Path.Private
    ? {
        name: 'private'
        path: Path.File<Path.Partitioned<Path.Private>>
        segments: Path.Segments
      }
    : never

/** @group File System */
export type PartitionDiscoveryNonEmpty<P extends Path.Partition> =
  P extends Path.Public
    ? {
        name: 'public'
        path: Path.File<Path.PartitionedNonEmpty<Path.Public>>
        segments: Path.Segments
      }
    : P extends Path.Private
      ? {
          name: 'private'
          path: Path.File<Path.PartitionedNonEmpty<Path.Private>>
          segments: Path.Segments
        }
      : never

/** @group File System */
export type PublicMutationResult = DataRootChange & {
  capsuleCID: CID
  contentCID: CID
}

/** @group File System */
export type PrivateMutationResult = DataRootChange & {
  capsuleKey: Uint8Array
}

/** @group File System */
export interface TransactionResult {
  changes: Array<{
    path: Path.Distinctive<Path.Partitioned<Path.Partition>>
    type: MutationType
  }>
  dataRoot: CID
  publishingStatus: Promise<PublishingStatus>
}

/** @group File System */
export type PublishingStatus =
  | { persisted: true }
  | { persisted: false; reason: string }
