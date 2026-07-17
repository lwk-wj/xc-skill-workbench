import { describe, expect, it } from 'vitest'
import pkg from '../../package.json'

describe('Vue renderer cutover', () => {
  it('does not ship React renderer dependencies', () => {
    expect(pkg.dependencies).not.toHaveProperty('react')
    expect(pkg.dependencies).not.toHaveProperty('react-dom')
    expect(pkg.dependencies).not.toHaveProperty('zustand')
    expect(pkg.devDependencies).not.toHaveProperty('@vitejs/plugin-react')
    expect(pkg.devDependencies).not.toHaveProperty('@testing-library/react')
  })
})
