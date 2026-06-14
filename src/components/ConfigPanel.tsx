import { useEffect, useState } from 'react'
import { MAX_MOUNT, type HermesNode } from '../data/cyber'
import { createProfile, type HermesProfileAgent, type HermesProfilesResponse } from '../services/hermes'

function agentInitial(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return 'A'
  const word = trimmed.match(/[\p{L}\p{N}]+/u)?.[0] ?? trimmed
  return word.slice(0, 1).toUpperCase()
}

function agentHue(name: string) {
  let hash = 0
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360
  }
  return hash
}

function AgentAvatar({ agent, size = 'list' }: { agent: HermesProfileAgent; size?: 'list' | 'detail' }) {
  return (
    <span
      className={`agent-avatar agent-avatar--${size}`}
      style={{ ['--avatar-hue' as string]: agentHue(agent.name) }}
      aria-hidden="true"
    >
      <span className="agent-avatar__initial">{agentInitial(agent.name)}</span>
      <span className="agent-avatar__spark" />
    </span>
  )
}

export function ConfigPanel({
  node,
  profiles,
  loading,
  mounted,
  onSave,
  onCreated,
  onOpenChat,
  onClose,
}: {
  node: HermesNode
  profiles: HermesProfilesResponse | null
  loading: boolean
  mounted: string[]
  onSave: (ids: string[]) => void
  onCreated: () => void
  onOpenChat: () => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<string[]>(mounted)

  useEffect(() => {
    setSelected(mounted)
  }, [mounted, node.id])

  const toggle = (id: string) => {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      if (current.length >= MAX_MOUNT) return current
      return [...current, id]
    })
  }

  const agents = profiles?.agents ?? []

  // --- create a new sub-agent (template-copy) -----------------------------
  const [createOpen, setCreateOpen] = useState(false)
  const [cName, setCName] = useState('')
  const [cTemplate, setCTemplate] = useState('')
  const [cModel, setCModel] = useState('')
  const [cBusy, setCBusy] = useState(false)
  const [cError, setCError] = useState<string | null>(null)

  // --- agent detail view ------------------------------------------------
  const [detailAgentId, setDetailAgentId] = useState<string | null>(null)

  const openCreate = () => {
    const first = agents[0]
    setCTemplate(first?.id ?? '')
    setCModel(first?.model ?? 'deepseek-chat')
    setCName('')
    setCError(null)
    setCreateOpen(true)
  }

  const pickTemplate = (id: string) => {
    setCTemplate(id)
    setCModel(agents.find((a) => a.id === id)?.model ?? '')
  }

  const submitCreate = async () => {
    setCBusy(true)
    setCError(null)
    try {
      const res = await createProfile(node.id, {
        name: cName.trim(),
        template: cTemplate,
        model: cModel.trim() || undefined,
      })
      if (res.ok) {
        setCreateOpen(false)
        onCreated()
      } else {
        setCError(res.error ?? '创建失败')
      }
    } catch (error) {
      let msg = error instanceof Error ? error.message : '创建失败'
      try {
        msg = (JSON.parse(msg) as { error?: string }).error ?? msg
      } catch {
        // raw message
      }
      setCError(msg)
    } finally {
      setCBusy(false)
    }
  }

  const detailAgent = agents.find((a) => a.id === detailAgentId) ?? null

  const [closeClick, setCloseClick] = useState<{ x: number; y: number } | null>(null)

  return (
    <div
      className="config-panel__backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          setCloseClick({ x: e.clientX, y: e.clientY })
        }
      }}
      onMouseUp={(e) => {
        if (closeClick && Math.abs(e.clientX - closeClick.x) < 8 && Math.abs(e.clientY - closeClick.y) < 8) {
          onClose()
        }
        setCloseClick(null)
      }}
    >
      <aside className="config-panel" onClick={(e) => { e.stopPropagation() }} onMouseDown={(e) => { setCloseClick(null); e.stopPropagation() }}>
        {/* Sticky header with close button */}
        <header className="config-panel__header" style={{ ['--accent' as string]: node.accent }}>
          <div>
            <h2>{node.name}</h2>
            <p>
              {node.system} · {node.host} · 选择要派驻的 agent（最多 {MAX_MOUNT} 个）
            </p>
          </div>
          <div className="dialog-header-actions">
            <button type="button" className="dialog-chat-btn" onClick={onOpenChat} title="打开对话">
              💬
            </button>
            <button type="button" className="config-panel__close" onClick={onClose}>
              ×
            </button>
          </div>
        </header>

        <div className="config-panel__body">
          {/* Agent detail card */}
          {detailAgent ? (
            <div className="agent-detail">
              <button
                type="button"
                className="agent-detail__back"
                onClick={() => setDetailAgentId(null)}
              >
                ← 返回列表
              </button>
              <div className="agent-detail__card">
                <div className="agent-detail__head">
                  <span className="agent-detail__glyph" style={{ ['--accent' as string]: node.accent }}>
                    <AgentAvatar agent={detailAgent} size="detail" />
                  </span>
                  <div>
                    <h3>{detailAgent.name}</h3>
                    <span className="agent-detail__id">ID: {detailAgent.id}</span>
                  </div>
                </div>

                <div className="agent-detail__section">
                  <h4>模型配置</h4>
                  <dl>
                    <dt>模型</dt>
                    <dd>{detailAgent.model || '（继承节点默认）'}</dd>
                    <dt>Provider</dt>
                    <dd>{detailAgent.provider || '（继承节点默认）'}</dd>
                  </dl>
                </div>

                <div className="agent-detail__section">
                  <h4>节点信息</h4>
                  <dl>
                    <dt>所属节点</dt>
                    <dd>{node.name}（{node.system} · {node.host}）</dd>
                    <dt>节点类型</dt>
                    <dd>{node.kind === 'local' ? '本机（自动识别）' : '远程'}</dd>
                    {node.sshAlias ? (
                      <>
                        <dt>SSH 别名</dt>
                        <dd>{node.sshAlias}</dd>
                      </>
                    ) : null}
                  </dl>
                </div>

                <div className="agent-detail__section">
                  <h4>配置文件</h4>
                  <p className="agent-detail__path">
                    路径：<code>~/.hermes/profiles/{detailAgent.id}/config.yaml</code>
                    <br />（如需修改技能列表、系统提示词等，请直接编辑该文件）
                  </p>
                </div>

                <p className="agent-detail__note">
                  技能启用/禁用请在「技能广场」中操作。模型变更请编辑上述配置文件中的 <code>model:</code> 块后重启 Agent。
                </p>
              </div>
            </div>
          ) : createOpen ? (
            <div className="config-create">
              <div className="config-create__title">
                {agents.length === 0
                  ? '创建第一个子 agent（基于主配置模板）'
                  : '新建子 agent（复制模板）'}
              </div>
              <label className="config-create__field">
                <span>名字</span>
                <input
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                  placeholder="字母/数字/汉字/-/_，1–32 位"
                  autoFocus
                />
              </label>
              {agents.length > 0 ? (
                <label className="config-create__field">
                  <span>复制模板</span>
                <select value={cTemplate} onChange={(e) => pickTemplate(e.target.value)}>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              ) : null}
              <label className="config-create__field">
                <span>模型（可改）</span>
                <input value={cModel} onChange={(e) => setCModel(e.target.value)} placeholder="如 deepseek-chat" />
              </label>
              <p className="config-create__note">将以该节点主配置为模板创建首个 agent。技能(skill)配置将在下一步加入。</p>
              {cError ? <p className="config-create__error">{cError}</p> : null}
              <div className="config-create__actions">
                <button type="button" className="config-btn config-btn--ghost" onClick={() => setCreateOpen(false)}>
                  取消
                </button>
                <button
                  type="button"
                  className="config-btn"
                  disabled={cBusy || !cName.trim() || (agents.length > 0 && !cTemplate)}
                  onClick={() => void submitCreate()}
                >
                  {cBusy ? '创建中…' : '创建'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="config-create__open"
              onClick={openCreate}
            >
              ＋ 新建子 agent
            </button>
          )}

          {!detailAgent ? (
            loading ? (
              <div className="config-hint">正在读取 profile…</div>
            ) : !profiles?.available ? (
              <div className="config-hint">{profiles?.reason ?? '无法读取该 Hermes 的 profile。'}</div>
            ) : agents.length === 0 ? (
              <div className="config-hint">该 Hermes 尚未创建任何 agent（profiles 目录为空）。</div>
            ) : (
              <ul className="config-list">
                {agents.map((agent) => {
                  const checked = selected.includes(agent.id)
                  const disabled = !checked && selected.length >= MAX_MOUNT
                  return (
                    <li key={agent.id}>
                      <label className={`config-item ${checked ? 'is-checked' : ''} ${disabled ? 'is-disabled' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(agent.id)}
                        />
                        <span
                          className="config-item__glyph"
                          style={{ ['--accent' as string]: node.accent }}
                          onClick={(e) => {
                            e.preventDefault()
                            setDetailAgentId(agent.id)
                          }}
                          title="点击查看 agent 详情"
                        >
                          <AgentAvatar agent={agent} />
                        </span>
                        <span
                          className="config-item__meta"
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => {
                            e.preventDefault()
                            setDetailAgentId(agent.id)
                          }}
                          title="点击查看 agent 详情"
                        >
                          <strong>{agent.name}</strong>
                          <span>
                            {agent.model || '默认模型'}
                            {agent.provider ? ` · ${agent.provider}` : ''}
                            <em className="config-item__detail-hint"> · 详情</em>
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )
          ) : null}
        </div>

        {!detailAgent ? (
          <footer className="config-panel__footer">
            <span>
              已选 {selected.length} / {MAX_MOUNT}
            </span>
            <div>
              <button type="button" className="config-btn config-btn--ghost" onClick={onClose}>
                取消
              </button>
              <button type="button" className="config-btn" onClick={() => onSave(selected)}>
                保存派驻
              </button>
            </div>
          </footer>
        ) : null}
      </aside>
    </div>
  )
}
