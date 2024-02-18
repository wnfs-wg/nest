import type { Blockstore } from 'interface-blockstore'
import type { CID } from 'multiformats'
import type { PBLink, PBNode } from '@ipld/dag-pb'

import * as DagPB from '@ipld/dag-pb'
import * as Uint8arrays from 'uint8arrays'
import { UnixFS } from 'ipfs-unixfs'
import { exporter } from 'ipfs-unixfs-exporter'
import { importBytes as importer } from 'ipfs-unixfs-importer'
import all from 'it-all'

import * as Path from './path.js'
import * as Store from './store.js'

/**
 * Create a UnixFS directory.
 */
export function createDirectory(
  currentTime: Date,
  links: PBLink[] = []
): PBNode {
  const unixDir = new UnixFS({
    type: 'directory',
    mtime: { secs: BigInt(Math.round(currentTime.getTime() / 1000)) },
  })

  return DagPB.createNode(unixDir.marshal(), links)
}

/**
 * Get the bytes of a UnixFS file.
 */
export async function exportFile(
  cid: CID,
  store: Blockstore,
  options?: { offset?: number; length?: number }
): Promise<Uint8Array> {
  const offset = options?.offset
  const length = options?.length

  const fsEntry = await exporter(cid, store)

  if (fsEntry.type === 'file' || fsEntry.type === 'raw') {
    return Uint8arrays.concat(await all(fsEntry.content({ offset, length })))
  } else {
    throw new Error(
      `Expected a file, found a '${fsEntry.type}' (CID: ${cid.toString()})`
    )
  }
}

/**
 * Get the CID for some file bytes.
 */
export async function importFile(
  bytes: Uint8Array,
  store: Blockstore
): Promise<CID> {
  const { cid } = await importer(bytes, store)
  return cid
}

/**
 * Insert a node into UnixFS tree, creating directories when needed
 * and overwriting content.
 */
export async function insertNodeIntoTree(
  node: PBNode,
  path: Path.Distinctive<Path.Segments>,
  store: Blockstore,
  fileCID?: CID
): Promise<PBNode> {
  const pathKind = Path.kind(path)
  const pathParts = Path.unwrap(path)
  const name = pathParts[0]
  const link = node.Links.find((l) => l.Name === name)

  // Directory
  // ---------
  if (Path.length(path) > 1) {
    const dirNode: PBNode =
      link?.Hash === undefined
        ? createDirectory(new Date())
        : await load(link.Hash, store)

    const newDirNode = await insertNodeIntoTree(
      dirNode,
      Path.fromKind(pathKind, ...pathParts.slice(1)),
      store,
      fileCID
    )

    const dirCID = await Store.store(
      DagPB.encode(newDirNode),
      DagPB.code,
      store
    )

    const links =
      link === undefined
        ? addLink(node.Links, name, dirCID)
        : replaceLinkHash(node.Links, name, dirCID)

    return { ...node, Links: links }
  }

  // Last part of path
  // -----------------
  // Directory
  if (pathKind === 'directory') {
    if (link !== undefined) return node

    const dirNode = createDirectory(new Date())
    const dirCID = await Store.store(DagPB.encode(dirNode), DagPB.code, store)

    const links = addLink(node.Links, name, dirCID)
    return { ...node, Links: links }
  }

  // File
  if (fileCID === undefined)
    throw new Error('Need a file CID when adding a UnixFS file')

  const links =
    link === undefined
      ? addLink(node.Links, name, fileCID)
      : replaceLinkHash(node.Links, name, fileCID)

  return { ...node, Links: links }
}

/**
 * Load a UnixFS node.
 */
export async function load(cid: CID, store: Blockstore): Promise<PBNode> {
  return DagPB.decode(await store.get(cid))
}

/**
 * Remove a node from a UnixFS tree.
 */
export async function removeNodeFromTree(
  node: PBNode,
  path: Path.Distinctive<Path.Segments>,
  store: Blockstore
): Promise<PBNode> {
  const pathKind = Path.kind(path)
  const pathParts = Path.unwrap(path)
  const name = pathParts[0]
  const link = node.Links.find((l) => l.Name === name)

  // Directory
  // ---------
  if (Path.length(path) > 1) {
    let dirNode: PBNode

    if (link?.Hash === undefined) {
      return node
    } else {
      dirNode = await load(link.Hash, store)
    }

    const newDirNode = await removeNodeFromTree(
      dirNode,
      Path.fromKind(pathKind, ...pathParts.slice(1)),
      store
    )

    const dirCID = await Store.store(
      DagPB.encode(newDirNode),
      DagPB.code,
      store
    )

    const links =
      link === undefined
        ? addLink(node.Links, name, dirCID)
        : replaceLinkHash(node.Links, name, dirCID)

    return { ...node, Links: links }
  }

  // Last part of path
  // -----------------
  if (link === undefined) return node
  return { ...node, Links: node.Links.filter((l) => l.Name !== name) }
}

// ㊙️

function addLink(links: PBLink[], name: string, hash: CID): PBLink[] {
  return [...links, DagPB.createLink(name, 0, hash)].sort(linkSorter)
}

function replaceLinkHash(links: PBLink[], name: string, hash: CID): PBLink[] {
  return links.map((l) => (l.Name === name ? { ...l, Hash: hash } : l))
}

function linkSorter(a: PBLink, b: PBLink): number {
  if ((a.Name ?? '') > (b.Name ?? '')) return 1
  if ((a.Name ?? '') < (b.Name ?? '')) return -1
  return 0
}
