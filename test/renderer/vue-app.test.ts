// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import VueApp from '../../src/renderer/src/VueApp.vue'
import { renderTestApp } from '../../src/renderer/src/app/render-test-app'

describe('Vue renderer scaffold', () => {
  it('mounts with Pinia and Element Plus', () => {
    renderTestApp(VueApp)
    expect(screen.getByTestId('vue-app')).toHaveTextContent('XC Skills')
  })
})
