import type {
  PrivateDirectory,
  PrivateForest,
  PrivateNode,
  PublicDirectory,
} from 'wnfs'
import type * as Path from '../path.js'

// 🧩

export type MountedPrivateNodes = Record<string, MountedPrivateNode>

export interface MountedPrivateNode {
  node: PrivateNode
  path: Path.Distinctive<Path.Segments>
}

export type PrivateNodeQueryResult = MountedPrivateNode & {
  remainder: Path.Segments
}

export interface WnfsPrivateResult {
  rootDir: PrivateDirectory
  forest: PrivateForest
}
export interface WnfsPublicResult {
  rootDir: PublicDirectory
}
