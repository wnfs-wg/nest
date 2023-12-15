# Nest 🪺

[![npm (scoped)](https://img.shields.io/npm/v/%40fission-codes/eslint-config)](https://www.npmjs.com/package/@fission-codes/eslint-config)
[![GitHub Workflow Status (with event)](https://img.shields.io/github/actions/workflow/status/fission-codes/stack/eslint-config.yml)](https://github.com/fission-codes/stack/actions/workflows/eslint-config.yml)

A layer around the `wnfs` package that provides a `FileSystem` class, a root tree, mounts, transactions and some other essentials.

## Features

- A file system class that allows for an easy-to-use mutable API.
- A root tree, holding references to all the needed individual parts (public fs, private forest, exchange, etc)
- A unix-fs compatibility layer for the public file system (allows for public files to be viewed through, for example, IPFS gateways)
- A mounting system for private nodes, mount specific paths.
- Provides a transaction system, rewinding the state if an error occurs.
- Creates a private forest automatically with a RSA modules using the Web Crypto API (supported on multiple platforms)
- Ability to verify commits to the file system. If a commit, aka. modification, is not verified, it will result in a no-op.
- And more: typed paths, events, path helpers, data casting, …

## Installation

```bash
pnpm install @wnfs-wg/nest
```

## Usage

```ts
import { FileSystem, Path } from '@wnfs-wg/nest'

// Provide some block store of the `Blockstore` type from the `interface-blockstore` package
import { IDBBlockstore } from 'blockstore-idb'
```

Scenario 1:<br />
🚀 Create a new file system, create a new file and read it back.

```ts
const blockstore = new IDBBlockstore('path/to/store')
await blockstore.open()

const fs = await FileSystem.create({
  blockstore
})

// Create the private node of which we'll keep the encryption key around.
const { capsuleKey } = await fs.mountPrivateNode({
  path: Path.root() // ie. root private directory
})

// Write & Read
await fs.write(
  Path.file('private', 'file'),
  'utf8',
  '🪺'
)

const contents = await fs.read(
  Path.file('private', 'file'),
  'utf8'
)
```

Scenario 2:<br />
🛰️ Listen to commit and/or publish events.

_A commit is a (optionally verified) modification to the file system,<br />
and publishes are the debounced events resulting from the commits._

This will allow us the store the latest state of our file system,<br />
for this we need what we call the data root. This is the top-level CID<br />
of our root tree, the pointer to our file system.

```ts
let fsPointer: CID = await fs.calculateDataRoot()

// When we make a modification to the file system a verification is performed.
await fs.write(
  Path.file('private', 'file'),
  'utf8',
  '🪺'
)

// If the commit is approved, the changes are reflected in the file system and
// the `commit` and `publish` events are emitted.
fs.on('commit', ({ dataRoot, modifications }) => {
  // Commit approved and performed ✅
})

fs.on('publish', ({ dataRoot }) => {
  // Commit approved and performed ✅
  // Debounced and delayed ✅
  fsPointer = dataRoot
})
```

Scenario 3:<br />
🧳 Load a file system from a previous pointer.

```ts
// `blockstore` from scenario 1
// `fsPointer` from scenario 2
const fs = await FileSystem.fromCID(fsPointer, { blockstore })

// `capsuleKey` from scenario 1
await fs.mountPrivateNode({
  path: Path.root(),
  capsuleKey
})
```

## Actions

### Queries

```ts
fs.exists
fs.listDirectory // alias: fs.ls
fs.read
```

### Mutations

```ts
fs.copy // alias: fs.cp
fs.move // alias: fs.mv
fs.createDirectory
fs.createFile
fs.ensureDirectory // alias: fs.mkdir
fs.remove // alias: fs.rm
fs.rename
fs.write
```

## Transactions

```ts
const result: Promise<
  | { modifications: Modification[]; dataRoot: CID }
  | 'no-op'
> = fs.transaction(t => {
  t.write(…)
  t.read(…)
  t.write(…)
  // You can use all the same methods as with the `fs` interface
})
```

## Commit verification

This exists so you can approve modifications to the file system.

```ts
import { Modification } from '@wnfs-wg/nest'

const fs = FileSystem.create({
  blockstore,
  onCommit: (modifications: Modification[]): { commit: boolean } => {
    // For example, check if I have access to all paths.
    const satisfied = modifications.every(m => ALLOWED_PATHS.includes( Path.toPosix(m.path) ))
    if (satisfied) return { commit: true }
    else return { commit: false }
  }
})
```

When you make a modification through the `transaction` method and the commit ends up not being approved, this will result in a `"no-op"` string. In the case of using a regular mutation method such as `write` it will produce an error.

## Docs

```ts
FileSystem.create
FileSystem.fromCID

fs.mountPrivateNode
fs.mountPrivateNodes
fs.unmountPrivateNode

fs.exists
fs.listDirectory
fs.ls
fs.read

fs.copy
fs.cp
fs.move
fs.mv
fs.createDirectory
fs.createFile
fs.ensureDirectory
fs.mkdir
fs.remove
fs.rm
fs.rename
fs.write

fs.transaction
fs.calculateDataRoot

fs.contentCID
fs.capsuleCID
fs.capsuleKey

fs.on
fs.onAny
fs.off
fs.offAny
fs.once
fs.anyEvent
fs.events

Path.directory
Path.file
Path.fromKind
Path.root
Path.appData

Path.fromPosix
Path.toPosix

Path.combine
Path.isDirectory
Path.isFile
Path.isOnRootBranch
Path.isPartition
Path.isPartitioned
Path.isPartitionedNonEmpty
Path.isRootDirectory
Path.isSamePartition
Path.isSameKind
Path.kind
Path.length
Path.map
Path.parent
Path.removePartition
Path.replaceTerminus
Path.rootBranch
Path.terminus
Path.unwrap
Path.withPartition
```

TODO:
Check <https://fission-codes.github.io/stack>

## Contributing

Read contributing guidelines [here](../../.github/CONTRIBUTING.md).

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/@wnfs-wg/nest)

## License

This project is licensed under either of

- Apache License, Version 2.0, ([LICENSE-APACHE](../../LICENSE-APACHE) or
  [http://www.apache.org/licenses/LICENSE-2.0][apache])
- MIT license ([LICENSE-MIT](../../LICENSE-MIT) or
  [http://opensource.org/licenses/MIT][mit])

at your option.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally
submitted for inclusion in the work by you, as defined in the Apache-2.0
license, shall be dual licensed as above, without any additional terms or
conditions.

[apache]: https://www.apache.org/licenses/LICENSE-2.0
[mit]: http://opensource.org/licenses/MIT
