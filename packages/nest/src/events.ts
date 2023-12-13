import type { CID } from 'multiformats/cid'
import type { DistinctivePath, Partition, Partitioned } from './path.js'
import type { MutationType } from './types.js'

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type Events = {
  'local-change': {
    dataRoot: CID
    path: DistinctivePath<Partitioned<Partition>>
    type: MutationType
  }
  publish: { dataRoot: CID }
}

export type Listener<
  EventMap extends Record<string, unknown>,
  Name extends keyof EventMap,
> = (eventData: EventMap[Name]) => void | Promise<void>
