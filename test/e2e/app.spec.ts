import { test, expect } from './fixtures'
import { readFile } from 'node:fs/promises'

test.describe('desktop smoke workflows', () => {
  test('imports config and renders the central browser', async ({ e2e }) => {
    await expect(e2e.page.getByText('XC Skills')).toBeVisible()
    await expect(e2e.page.getByRole('button', { name: '中央仓库' })).toBeVisible()
    await expect(e2e.page.getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'true')
  })

  test('test-injected directory chooser adds a project', async ({ e2e }) => {
    await e2e.page.getByRole('button', { name: /添加项目/ }).click()
    await expect(e2e.page.getByRole('button', { name: 'project' })).toBeVisible()
  })

  test('switching branches leaves the configured checkout untouched', async ({ e2e }) => {
    await e2e.page.getByRole('button', { name: '选择分支' }).click()
    await e2e.page.getByRole('option', { name: 'feature/demo' }).click()
    await expect(e2e.page.getByText('分支：feature/demo⌄')).toBeVisible()
    await expect(readFile(`${e2e.repo}/.git/HEAD`, 'utf8')).resolves.toContain('refs/heads/main')
  })
})
