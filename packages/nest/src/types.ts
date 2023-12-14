import type { CID } from 'multiformats'
import type * as Path from './path.js'

export type AnySupportedDataType<V> =
  | Uint8Array
  | Record<string | number | symbol, V>
  | string

export type CommitVerifier = (
  changes: Modification[]
) => Promise<{ commit: boolean }>

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

export interface Modification {
  path: Path.Distinctive<Path.Partitioned<Path.Partition>>
  type: MutationType
}

export interface MutationOptions {
  skipPublish?: boolean
}

export type MutationResult<
  P extends Path.Partition,
  Extension = unknown,
> = P extends Path.Public
  ? PublicMutationResult<Extension>
  : P extends Path.Private
    ? PrivateMutationResult<Extension>
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

export type NOOP = 'no-op'

export type PublicMutationResult<Extension = unknown> = {
  capsuleCID: CID
  contentCID: CID
  dataRoot: CID
} & Extension

export type PrivateMutationResult<Extension = unknown> = {
  capsuleKey: Uint8Array
  dataRoot: CID
} & Extension
