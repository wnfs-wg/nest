import { webcrypto } from 'iso-base/crypto'

export interface Rng {
  randomBytes: (count: number) => Uint8Array
}

export function makeRngInterface(): Rng {
  return {
    /** Returns random bytes of specified length */
    randomBytes(count: number): Uint8Array {
      return webcrypto.getRandomValues(new Uint8Array(count))
    },
  }
}
