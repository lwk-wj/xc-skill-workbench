// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomAgentForm } from '../../src/renderer/src/features/settings/CustomAgentForm'
import { ErrorNotice } from '../../src/renderer/src/components/ErrorNotice'

describe('settings controls', () => {
  afterEach(cleanup)
  it('validates custom agent ids and relative asset directories', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<CustomAgentForm onSave={onSave} onCancel={vi.fn()} />)
    await user.type(screen.getByLabelText('Agent ID'), '../bad')
    await user.type(screen.getByLabelText('显示名称'), 'Demo')
    await user.type(screen.getByLabelText('项目基础目录'), '/tmp/project')
    await user.type(screen.getByLabelText('全局基础目录'), '/tmp/global')
    await user.type(screen.getByLabelText('Skills 相对目录'), '/absolute')
    await user.type(screen.getByLabelText('Rules 相对目录'), '../rules')
    await user.type(screen.getByLabelText('Workflows 相对目录'), 'workflows')
    await user.click(screen.getByRole('button', { name: '保存 Agent' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/ID|相对目录/)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('maps structured errors to concise actionable guidance', () => {
    render(<ErrorNotice error={{ code: 'PERMISSION_DENIED', path: '/tmp/private', message: 'secret details' }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('在 Finder 中检查权限')
    expect(screen.getByRole('alert')).not.toHaveTextContent('secret details')
    expect(screen.getByText('/tmp/private')).toBeInTheDocument()
  })
})
