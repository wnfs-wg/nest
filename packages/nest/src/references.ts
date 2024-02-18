import type { Blockstore } from 'interface-blockstore'
import type { PublicNode } from 'wnfs'

import { CID } from 'multiformats/cid'

import type * as Path from './path.js'
import type { RootTree } from './root-tree.js'

import * as Store from './store.js'
import { pathSegmentsWithoutPartition } from './common.js'

export async function contentCID(
  blockstore: Blockstore,
  rootTree: RootTree,
  path: Path.File<Path.Partitioned<Path.Public>>
): Promise<CID | undefined> {
  const wnfsBlockstore = Store.wnfs(blockstore)
  const result = await rootTree
    .publicRoot()
    .getNode(pathSegmentsWithoutPartition(path), wnfsBlockstore)

  const maybeNode: PublicNode | undefined = result ?? undefined
  return maybeNode?.isFile() === true
    ? CID.decode(
        await maybeNode
          .asFile()
          .getRawContentCid(wnfsBlockstore)
          .then((u) => u as Uint8Array)
      )
    : undefined
}

export async function capsuleCID(
  blockstore: Blockstore,
  rootTree: RootTree,
  path: Path.Distinctive<Path.Partitioned<Path.Public>>
): Promise<CID | undefined> {
  const wnfsBlockstore = Store.wnfs(blockstore)
  const result = await rootTree
    .publicRoot()
    .getNode(pathSegmentsWithoutPartition(path), wnfsBlockstore)

  const maybeNode: PublicNode | undefined = result ?? undefined
  return maybeNode === undefined
    ? undefined
    : CID.decode(
        maybeNode.isFile()
          ? ((await maybeNode.asFile().store(wnfsBlockstore)) as Uint8Array)
          : ((await maybeNode.asDir().store(wnfsBlockstore)) as Uint8Array)
      )
}
