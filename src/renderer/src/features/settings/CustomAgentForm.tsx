import { useMemo, useState } from 'react'
import type { AgentDefinition } from '../../../../shared/ipc.js'

type CustomAgentFormProps = {
  agent?: AgentDefinition
  onSave: (agent: AgentDefinition) => void | Promise<void>
  onCancel?: () => void
}

type FormState = {
  id: string
  name: string
  projectBaseDir: string
  globalBaseDir: string
  skills: string
  rules: string
  workflows: string
  enabled: boolean
}

const initialState = (agent?: AgentDefinition): FormState => ({
  id: agent?.id ?? '', name: agent?.name ?? '', projectBaseDir: agent?.projectBaseDir ?? '', globalBaseDir: agent?.globalBaseDir ?? '',
  skills: agent?.assetDirs.skills ?? 'skills', rules: agent?.assetDirs.rules ?? 'rules', workflows: agent?.assetDirs.workflows ?? 'workflows', enabled: agent?.enabled ?? true,
})

const isAbsolute = (value: string): boolean => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
const relativeDirectoryError = (value: string): string | null => {
  const normalized = value.trim().replaceAll('\\', '/')
  if (!normalized) return '目录不能为空'
  if (isAbsolute(normalized)) return '必须填写相对目录'
  if (normalized.split('/').some((part) => part === '..')) return '目录不能包含 ..'
  if (normalized.includes('\0')) return '目录包含无效字符'
  return null
}
const resolveDirectory = (base: string, value: string): string => `${base.replace(/[\\/]$/, '')}/${value.trim().replaceAll('\\', '/').replace(/^\/+/, '')}`

export function CustomAgentForm({ agent, onSave, onCancel }: CustomAgentFormProps) {
  const [form, setForm] = useState<FormState>(() => initialState(agent))
  const [error, setError] = useState<string | null>(null)
  const editingBuiltIn = Boolean(agent?.builtIn)
  const update = (field: keyof FormState, value: string | boolean): void => setForm((current) => ({ ...current, [field]: value }))
  const errors = useMemo(() => {
    const messages: string[] = []
    if (!/^[A-Za-z0-9._:-]+$/.test(form.id.trim())) messages.push('Agent ID 只能包含字母、数字、点、下划线、冒号或短横线')
    if (!form.name.trim()) messages.push('显示名称不能为空')
    if (!isAbsolute(form.projectBaseDir.trim())) messages.push('项目基础目录必须是绝对路径')
    if (!isAbsolute(form.globalBaseDir.trim())) messages.push('全局基础目录必须是绝对路径')
    for (const [label, value] of [['Skills', form.skills], ['Rules', form.rules], ['Workflows', form.workflows]] as const) {
      const message = relativeDirectoryError(value)
      if (message) messages.push(`${label} 相对目录${message}`)
    }
    return messages
  }, [form])
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (errors.length > 0) { setError(errors[0] ?? '请检查表单'); return }
    setError(null)
    await onSave({
      id: form.id.trim(), name: form.name.trim(), projectBaseDir: form.projectBaseDir.trim(), globalBaseDir: form.globalBaseDir.trim(),
      assetDirs: { skills: resolveDirectory(form.globalBaseDir, form.skills), rules: resolveDirectory(form.globalBaseDir, form.rules), workflows: resolveDirectory(form.globalBaseDir, form.workflows) },
      builtIn: agent?.builtIn ?? false, enabled: form.enabled,
    })
  }
  return <form className="custom-agent-form" onSubmit={(event) => void submit(event)}>
    <h3>{agent ? '编辑 Agent' : '添加自定义 Agent'}</h3>
    {error && <div role="alert" className="form-error">{error}</div>}
    <label>Agent ID<input aria-label="Agent ID" value={form.id} readOnly={editingBuiltIn} onChange={(event) => update('id', event.target.value)} /></label>
    <label>显示名称<input aria-label="显示名称" value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
    <label>项目基础目录<input aria-label="项目基础目录" placeholder="/Users/me/project" value={form.projectBaseDir} onChange={(event) => update('projectBaseDir', event.target.value)} /></label>
    <label>全局基础目录<input aria-label="全局基础目录" placeholder="/Users/me/.agent" value={form.globalBaseDir} onChange={(event) => update('globalBaseDir', event.target.value)} /></label>
    <fieldset><legend>资源相对目录</legend>
      <label>Skills 相对目录<input aria-label="Skills 相对目录" value={form.skills} onChange={(event) => update('skills', event.target.value)} /></label>
      <label>Rules 相对目录<input aria-label="Rules 相对目录" value={form.rules} onChange={(event) => update('rules', event.target.value)} /></label>
      <label>Workflows 相对目录<input aria-label="Workflows 相对目录" value={form.workflows} onChange={(event) => update('workflows', event.target.value)} /></label>
    </fieldset>
    <label className="checkbox-label"><input type="checkbox" checked={form.enabled} onChange={(event) => update('enabled', event.target.checked)} />启用 Agent</label>
    <div className="form-actions"><button type="submit">保存 Agent</button>{onCancel && <button type="button" onClick={onCancel}>取消</button>}</div>
  </form>
}

