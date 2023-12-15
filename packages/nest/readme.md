# Nest 🪺

[![npm (scoped)](https://img.shields.io/npm/v/%40fission-codes/eslint-config)](https://www.npmjs.com/package/@fission-codes/eslint-config)
[![GitHub Workflow Status (with event)](https://img.shields.io/github/actions/workflow/status/fission-codes/stack/eslint-config.yml)](https://github.com/fission-codes/stack/actions/workflows/eslint-config.yml)

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

```js
import { module } from '@wnfs-wg/nest'
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
