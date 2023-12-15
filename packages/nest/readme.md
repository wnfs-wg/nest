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
import { MemoryBlockstore } from 'blockstore-core/memory'
```

Scenario 1:
🚀 Create a new file system, create a new file and read it back.

```ts
const fs = await FileSystem.create({ blockstore: new MemoryBlockstore() })

await fs.write(
  Path.file('private', 'file'),
  'utf8',
  '🪺'
)

const contents = await fs.read(Path.file('private', 'file'), 'utf8')
```

Scenario 2:
🛰️ Listen to commit and/or publish events.

_A commit is a (optionally verified) modification to the file system,
and publishes are the debounced events resulting from the commits._

This will allow us the store the latest state of our file system,
for this we need what we call the data root. This is the top-level CID
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
  fsPointer
})
```

Scenario 3:
🧳 Load a file system from a previous pointer.

```ts
// `blockstore` from scenario 1 & `fsPointer` from scenario 2
const fs = await FileSystem.fromCID(fsPointer, { blockstore })
```

## Docs

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
