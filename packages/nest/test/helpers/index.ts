import assert from 'assert'
import all from 'it-all'

import type { Blockstore } from 'interface-blockstore'

import * as fc from 'fast-check'
import * as UnixExporter from 'ipfs-unixfs-exporter'
import * as Uint8Arrays from 'uint8arrays'

import type { FileSystem } from '../../src/class.js'
import { linksFromCID } from '../../src/root-tree/basic.js'
import * as Path from '../../src/path.js'

// PATHS

export function arbitraryDirectoryPath<P extends Path.Partition>(
  partition: P
): fc.Arbitrary<Path.Directory<Path.PartitionedNonEmpty<P>>> {
  return fc
    .array(arbitraryPathSegment(), { minLength: 1, maxLength: 8 })
    .map((array) => {
      const path: Path.Directory<Path.PartitionedNonEmpty<P>> = {
        directory: [partition, ...array] as any,
      }
      return path
    })
}

export function arbitraryFilePath<P extends Path.Partition>(
  partition: P
): fc.Arbitrary<Path.File<Path.PartitionedNonEmpty<P>>> {
  return fc
    .array(arbitraryPathSegment(), { minLength: 1, maxLength: 8 })
    .map((array) => {
      const path: Path.File<Path.PartitionedNonEmpty<P>> = {
        file: [partition, ...array] as any,
      }
      return path
    })
}

export function arbitraryPathSegment(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.webSegment().filter((segment) => segment.length > 0),
    fc.constantFrom('a', 'b', 'c') // to generate more 'collisions'
  )
}

// UNIX

export async function assertUnixFsDirectory(
  opts: { blockstore: Blockstore },
  fs: FileSystem,
  path: Path.Directory<Path.Partitioned<Path.Public>>
): Promise<void> {
  const dataRoot = await fs.calculateDataRoot()

  const rootTree = await linksFromCID(dataRoot, opts.blockstore)
  const unixRoot = rootTree.unix

  const pathString = Path.toPosix(Path.removePartition(path), {
    absolute: true,
  })
  const entry = await UnixExporter.exporter(
    `${unixRoot.toString()}${pathString}`,
    opts.blockstore
  )

  assert.equal(entry.type, 'directory')
}

export async function assertUnixFsFile(
  opts: { blockstore: Blockstore },
  fs: FileSystem,
  path: Path.File<Path.Partitioned<Path.Public>>,
  bytes: Uint8Array
): Promise<void> {
  const dataRoot = await fs.calculateDataRoot()

  const rootTree = await linksFromCID(dataRoot, opts.blockstore)
  const unixRoot = rootTree.unix

  const pathString = Path.toPosix(Path.removePartition(path), {
    absolute: true,
  })
  const entry = await UnixExporter.exporter(
    `${unixRoot.toString()}${pathString}`,
    opts.blockstore
  )
  const unixBytes = Uint8Arrays.concat(await all(entry.content()))

  assert.equal(Uint8Arrays.equals(unixBytes, bytes), true)
}

export async function assertUnixNodeRemoval(
  opts: { blockstore: Blockstore },
  fs: FileSystem,
  path: Path.Distinctive<Path.Partitioned<Path.Public>>
): Promise<void> {
  const dataRoot = await fs.calculateDataRoot()

  const rootTree = await linksFromCID(dataRoot, opts.blockstore)
  const unixRoot = rootTree.unix

  const pathString = Path.toPosix(Path.removePartition(path), {
    absolute: true,
  })

  try {
    const _entry = await UnixExporter.exporter(
      `${unixRoot.toString()}${pathString}`,
      opts.blockstore
    )
  } catch (error: any) {
    assert(error.toString(), 'File does not exist')
  }
}
