import { useEffect, useState } from 'react'
import type { AgentDefinition, ThemePreference, XcSkillsConfig } from '../../../../shared/ipc.js'
import { CustomAgentForm } from './CustomAgentForm'
import { ThemeControl } from './ThemeControl'
import { ErrorNotice } from '../../components/ErrorNotice'

type SettingsViewProps = { onClose: () => void }

export function SettingsView({ onClose }: SettingsViewProps) {
  const [theme, setTheme] = useState<ThemePreference>('system')
  const [config, setConfig] = useState<XcSkillsConfig>({})
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [showAgentForm, setShowAgentForm] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let active = true
    void Promise.all([window.xcSkills.preferences.getTheme(), window.xcSkills.repositories.getConfig(), window.xcSkills.agents.list()]).then(([nextTheme, nextConfig, nextAgents]) => {
      if (!active) return
      setTheme(nextTheme); setConfig(nextConfig); setAgents(nextAgents)
    }).catch((reason: unknown) => { if (active) setError(reason) })
    return () => { active = false }
  }, [])

  const changeTheme = async (next: ThemePreference): Promise<void> => {
    try { await window.xcSkills.preferences.setTheme(next); setTheme(next) } catch (reason) { setError(reason) }
  }
  const saveAgent = async (agent: AgentDefinition): Promise<void> => {
    try {
      const nextAgents = await window.xcSkills.agents.saveCustom(agent)
      setAgents(nextAgents); setShowAgentForm(false); setError(null)
    } catch (reason) { setError(reason) }
  }
  const removeAgent = async (agent: AgentDefinition): Promise<void> => {
    if (agent.builtIn) return
    if (!window.confirm(`移除 Agent ${agent.name}？`)) return
    try { setAgents(await window.xcSkills.agents.removeCustom(agent.id)) } catch (reason) { setError(reason) }
  }
  const toggleAgent = async (agent: AgentDefinition): Promise<void> => {
    try {
      const next = await window.xcSkills.agents.saveCustom({ ...agent, enabled: !agent.enabled })
      setAgents(next)
    } catch (reason) { setError(reason) }
  }
  return <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="设置">
    <section className="settings-view">
      <header className="settings-header"><div><h2>设置</h2><p className="subtitle">应用偏好与 Agent 配置</p></div><button type="button" aria-label="关闭设置" onClick={onClose}>×</button></header>
      {Boolean(error) && <ErrorNotice error={error as Error} />}
      <div className="settings-content">
        <section className="settings-section"><h3>外观</h3><ThemeControl value={theme} onChange={changeTheme} /></section>
        <section className="settings-section"><h3>CLI 仓库</h3><dl className="config-list">
          <div><dt>模式</dt><dd>{config.mode === 'remote' ? '远程' : '本地'}</dd></div>
          <div><dt>仓库路径</dt><dd>{config.repoPath ?? '未配置'}</dd></div>
          <div><dt>仓库 URL</dt><dd>{config.remoteUrl ?? '未配置'}</dd></div>
          <div><dt>默认分支</dt><dd>{config.defaultBranch ?? '未配置'}</dd></div>
          <div><dt>默认分组</dt><dd>{config.defaultGroups?.join('、') || '全部分组'}</dd></div>
        </dl></section>
        <section className="settings-section"><div className="section-heading"><h3>Agents</h3><button type="button" onClick={() => setShowAgentForm(true)}>添加自定义 Agent</button></div>
          <div className="agent-list">{agents.map((agent) => <div className={!agent.enabled ? 'agent-row disabled' : 'agent-row'} key={agent.id}><div><strong>{agent.name}</strong><small>{agent.id}{agent.builtIn ? ' · 内置' : ' · 自定义'}</small></div><div className="agent-actions"><label><input type="checkbox" checked={agent.enabled} onChange={() => void toggleAgent(agent)} />启用</label>{!agent.builtIn && <button type="button" onClick={() => void removeAgent(agent)}>移除</button>}</div></div>)}</div>
          {showAgentForm && <CustomAgentForm onSave={saveAgent} onCancel={() => setShowAgentForm(false)} />}
        </section>
      </div>
      <footer className="settings-footer"><button type="button" onClick={onClose}>完成</button></footer>
    </section>
  </div>
}
