import { compare, satisfies } from 'compare-versions'

export const isSupported = (
  fsVersion: string
): true | 'too-high' | 'too-low' => {
  if (satisfies(fsVersion, `^${latest}`)) {
    return true
  } else if (compare(fsVersion, latest, '>')) {
    return 'too-high'
  }

  return 'too-low'
}

// VERSIONS

export const v1 = '1.0.0'
export const latest = v1

export const supported = [latest]
