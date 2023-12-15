import type { CID } from 'multiformats/cid'
import type { Modification } from './types.js'

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type Events = {
  commit: {
    dataRoot: CID
    modifications: Modification[]
  }
  publish: { dataRoot: CID }
}

export type Listener<
  EventMap extends Record<string, unknown>,
  Name extends keyof EventMap,
> = (eventData: EventMap[Name]) => void | Promise<void>
