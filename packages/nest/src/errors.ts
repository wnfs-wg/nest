import * as Path from './path.js'

export function throwNoAccess(
  path: Path.DistinctivePath<Path.Segments>,
  accessType?: string
): never {
  throw new Error(
    `Expected to have ${
      typeof accessType === 'string' ? accessType + ' ' : ''
    }access to the path '${Path.toPosix(path)}'`
  )
}

export function throwInvalidPartition(
  path: Path.Distinctive<Path.Segments>
): never {
  throw new Error(
    `Expected either a public or private path, got '${Path.toPosix(path)}'`
  )
}
