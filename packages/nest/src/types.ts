import type { CID } from 'multiformats'
import type * as Path from './path.js'

export type AnySupportedDataType<V> =
  | Uint8Array
  | Record<string | number | symbol, V>
  | string

export interface DataRootChange {
  dataRoot: CID
}

export type DataType = 'bytes' | 'json' | 'utf8'

export type DataForType<D extends DataType, V = unknown> = D extends 'bytes'
  ? Uint8Array
  : D extends 'json'
    ? Record<string | number | symbol, V>
    : D extends 'utf8'
      ? string
      : never

export interface DirectoryItem {
  metadata: { created: number; modified: number }
  name: string
}

export type DirectoryItemWithKind = DirectoryItem & {
  kind: Path.Kind
  path: Path.Distinctive<Path.PartitionedNonEmpty<Path.Partition>>
}

export interface FileSystemChange {
  path: Path.Distinctive<Path.Partitioned<Path.Partition>>
  type: MutationType
}

export interface MutationOptions {
  skipPublish?: boolean
}

export type MutationResult<P extends Path.Partition> = P extends Path.Public
  ? PublicMutationResult
  : P extends Path.Private
    ? PrivateMutationResult
    : never

export type MutationType = 'added-or-updated' | 'removed'

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

export type PublicMutationResult = DataRootChange & {
  capsuleCID: CID
  contentCID: CID
}

export type PrivateMutationResult = DataRootChange & {
  capsuleKey: Uint8Array
}
