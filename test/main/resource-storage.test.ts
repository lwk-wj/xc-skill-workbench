import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assetStorePathForRoot,
  repositoryCachePathForRoot,
  resourceRootFromAssetStore,
} from '../../src/shared/resource-storage.js'

describe('resource storage paths', () => {
  it('places repositories and the managed store beside each other under the selected root', () => {
    const root = join('/tmp', 'xc-resources')

    expect(assetStorePathForRoot(root)).toBe(join(root, 'store'))
    expect(repositoryCachePathForRoot(root)).toBe(join(root, 'repositories'))
  })

  it('keeps legacy direct store paths selectable as their future resource root', () => {
    expect(resourceRootFromAssetStore('/tmp/legacy-assets')).toBe('/tmp/legacy-assets')
    expect(resourceRootFromAssetStore('/tmp/xc-resources/store')).toBe('/tmp/xc-resources')
  })
})
