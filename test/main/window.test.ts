import { describe, expect, it } from 'vitest'
import { createWindowOptions } from '../../src/main/window.js'

describe('createWindowOptions', () => {
  it('hardens the BrowserWindow web preferences', () => {
    expect(createWindowOptions('/tmp/preload.js').webPreferences).toMatchObject({
      preload: '/tmp/preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    })
  })
})
