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
    await expect(e2e.page.getByRole('button', { name: 'project', exact: true })).toBeVisible()
  })

  test('shows platform tags for global and project installations', async ({ e2e }) => {
    await e2e.page.getByRole('button', { name: '全局安装', exact: true }).click()
    await expect(e2e.page.getByRole('listitem').filter({ hasText: 'call-api' }).getByText('Codex', { exact: true })).toBeVisible()
    await e2e.page.getByRole('button', { name: /添加项目/ }).click()
    await e2e.page.getByRole('button', { name: 'project', exact: true }).click()
    await expect(e2e.page.getByRole('listitem').filter({ hasText: 'call-api' }).getByText('Claude Code', { exact: true })).toBeVisible()
  })

  test('switching branches leaves the configured checkout untouched', async ({ e2e }) => {
    await e2e.page.getByRole('button', { name: '选择分支' }).click()
    await expect(e2e.page.getByRole('menuitem', { name: 'feature/demo' })).toBeVisible()
    await e2e.page.getByRole('heading', { name: '中央仓库' }).click()
    await expect(e2e.page.getByRole('menuitem', { name: 'feature/demo' })).toBeHidden()
    await e2e.page.getByRole('button', { name: '选择分支' }).click()
    await e2e.page.getByRole('menuitem', { name: 'feature/demo' }).click()
    await expect(e2e.page.getByText('分支：feature/demo⌄')).toBeVisible()
    await expect(readFile(`${e2e.repo}/.git/HEAD`, 'utf8')).resolves.toContain('refs/heads/main')
  })

  test('refreshes central assets immediately after saving repository settings', async ({ e2e }) => {
    await expect(e2e.page.getByRole('listitem').filter({ hasText: 'demo' }).first()).toBeVisible()
    await e2e.page.getByRole('button', { name: '设置' }).click()
    const settings = e2e.page.getByRole('dialog', { name: '设置' })
    await expect(settings).toBeVisible()
    const path = settings.getByLabel('本地仓库路径')
    await expect(path).toHaveValue(e2e.repo)
    await path.fill(e2e.alternateRepo)
    await settings.getByRole('button', { name: '保存并刷新' }).click()
    await expect(settings.getByText('配置已保存，中央仓库已刷新')).toBeVisible()
    await settings.getByRole('button', { name: '完成' }).click()

    await expect(e2e.page.getByRole('listitem').filter({ hasText: 'replacement' }).first()).toBeVisible()
    await expect(e2e.page.getByRole('listitem').filter({ hasText: 'demo' })).toHaveCount(0)
  })

  test('scrolls only the settings content while the dialog chrome stays fixed', async ({ e2e }) => {
    await e2e.page.getByRole('button', { name: '设置' }).click()
    const dialog = e2e.page.getByRole('dialog', { name: '设置' })
    const panel = dialog.locator('.settings-dialog')
    const header = panel.locator('.el-dialog__header')
    const content = panel.locator('.settings-content')
    const footer = panel.locator('.el-dialog__footer')
    await expect(dialog).toBeVisible()
    await e2e.page.waitForTimeout(250)

    const before = await Promise.all([panel, header, footer].map((locator) => (
      locator.evaluate((element) => element.getBoundingClientRect().top)
    )))
    await content.hover()
    await e2e.page.mouse.wheel(0, 10_000)
    const after = await Promise.all([panel, header, footer].map((locator) => (
      locator.evaluate((element) => element.getBoundingClientRect().top)
    )))

    expect(await content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    expect(await dialog.evaluate((element) => element.scrollTop)).toBe(0)
    for (let index = 0; index < before.length; index += 1) {
      expect(Math.abs(after[index] - before[index])).toBeLessThan(1)
    }
  })

  test('toggles a built-in Agent without losing the other built-ins', async ({ e2e }) => {
    await e2e.page.getByRole('button', { name: '设置' }).click()
    const dialog = e2e.page.getByRole('dialog', { name: '设置' })
    const antigravity = dialog.getByRole('switch', { name: '启用 Antigravity' })
    await expect(antigravity).toBeChecked()
    await antigravity.scrollIntoViewIfNeeded()
    await e2e.page.waitForTimeout(250)

    await dialog.locator('.agent-row').filter({ hasText: 'Antigravity' }).locator('.el-switch').click()

    await expect(antigravity).not.toBeChecked()
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(dialog.getByRole('switch', { name: /^启用 / })).toHaveCount(4)

    await dialog.getByRole('button', { name: '完成' }).click()
    await e2e.page.getByRole('button', { name: '设置' }).click()
    await expect(e2e.page.getByRole('dialog', { name: '设置' }).getByRole('switch', { name: '启用 Antigravity' })).not.toBeChecked()
  })

  test('opens readable asset details in a wide drawer', async ({ e2e }) => {
    await e2e.page.getByRole('button', { name: /添加项目/ }).click()
    await e2e.page.getByRole('button', { name: '中央仓库' }).click()

    const columnCount = await e2e.page.getByTestId('app-shell').evaluate((element) => (
      getComputedStyle(element).gridTemplateColumns.split(' ').length
    ))
    expect(columnCount).toBe(2)

    const row = e2e.page.getByRole('listitem').filter({ hasText: 'demo' }).first()
    await row.click()
    const drawer = e2e.page.getByRole('dialog', { name: 'demo' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('tab', { name: '预览' })).toBeVisible()

    const width = await drawer.evaluate((element) => element.getBoundingClientRect().width)
    expect(width).toBeGreaterThanOrEqual(600)

    const bodyOverflow = await drawer.locator('.el-drawer__body').evaluate((element) => getComputedStyle(element).overflowY)
    const panelOverflow = await drawer.locator('.el-tabs__content').evaluate((element) => getComputedStyle(element).overflowY)
    expect(bodyOverflow).toBe('hidden')
    expect(panelOverflow).toBe('auto')

    await drawer.getByRole('tab', { name: /安装状态/ }).click()
    await expect(drawer.getByText('Global · 全局')).toBeVisible()
    await expect(drawer.getByText('project · 项目')).toBeVisible()
    await drawer.locator('.installation-scope-filter .el-radio-button').filter({ hasText: '全局' }).click()
    const middleLocation = drawer.locator('.status-location').nth(1)
    const compactLayout = await middleLocation.evaluate((element) => {
      const style = getComputedStyle(element)
      const name = element.querySelector('.status-location-copy strong')!.getBoundingClientRect()
      const path = element.querySelector('.status-location-copy code')!.getBoundingClientRect()
      return {
        columns: style.gridTemplateColumns.split(' ').length,
        radius: style.borderRadius,
        nameTop: Math.round(name.top),
        pathTop: Math.round(path.top),
      }
    })
    expect(compactLayout.columns).toBeGreaterThanOrEqual(6)
    expect(compactLayout.radius).toBe('0px')
    expect(Math.abs(compactLayout.nameTop - compactLayout.pathTop)).toBeLessThanOrEqual(2)
    await drawer.getByRole('tab', { name: '预览' }).click()

    await drawer.getByRole('button', { name: /close/i }).click()
    await expect(drawer).toBeHidden()
    await expect(row).toHaveClass(/selected/)

    await row.click()
    await expect(drawer).toBeVisible()
  })
})
