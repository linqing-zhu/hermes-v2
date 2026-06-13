import { useEffect, useState } from 'react'
import { navGroups, type HermesNode } from '../data/cyber'
import type { HermesInstanceId } from '../services/hermes'
import {
  MessageCirclePlus,
  Clock,
  Puzzle,
  Package,
  FileText,
  Image,
  Monitor,
  Settings,
} from 'lucide-react'

const ICON_MAP: Record<string, typeof MessageCirclePlus> = {
  'message-circle-plus': MessageCirclePlus,
  'clock': Clock,
  'puzzle': Puzzle,
  'package': Package,
  'file-text': FileText,
  'image': Image,
  'monitor': Monitor,
}
const ICON_SIZE = 16

const USERNAME_KEY = 'cyber:username'

function loadUsername() {
  try {
    return localStorage.getItem(USERNAME_KEY) || '朱林情'
  } catch {
    return '朱林情'
  }
}

export type SidebarAction =
  | { type: 'new-chat'; instanceId?: HermesInstanceId }
  | { type: 'skill-gallery' }
  | { type: 'job-list' }
  | { type: 'chat-session'; instanceId: HermesInstanceId; sessionId: string }

export type NavSidebarProps = {
  nodes: HermesNode[]
  onAction: (action: SidebarAction) => void
  onAddNode: (draft: AddNodeDraft) => void
  onUpdateNode: (id: HermesInstanceId, draft: Partial<AddNodeDraft>) => void
  onRemoveNode: (id: string) => void
  onTestNode: (host: string, apiKey?: string, sessionKey?: string) => Promise<{ ok: boolean; message: string }>
}

type AddNodeDraft = {
  name: string
  host: string
  system: string
  apiKey?: string
  sessionKey?: string
  sshAlias?: string
}

/** A copy-to-clipboard prompt card — paste the text into a Hermes chat to have
 *  Hermes set things up for you. */
function PromptCard({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // clipboard unavailable — user can still select the text manually
    }
  }
  return (
    <div className="prompt-card">
      <div className="prompt-card__head">
        <span className="prompt-card__label">{label}</span>
        <button type="button" className="prompt-card__copy" onClick={() => void copy()}>
          {copied ? '已复制 ✓' : '复制'}
        </button>
      </div>
      <p className="prompt-card__text">{text}</p>
    </div>
  )
}

/**
 * Collapsed icon rail that expands on hover. All nav items have real click
 * handlers. Recent sessions live in the left-hand ChatPanel, not here.
 */
export function NavSidebar({
  nodes,
  onAction,
  onAddNode,
  onUpdateNode,
  onRemoveNode,
  onTestNode,
}: NavSidebarProps) {
  const [username, setUsername] = useState(loadUsername)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draftName, setDraftName] = useState(username)

  // add-node form
  const [nName, setNName] = useState('')
  const [nHost, setNHost] = useState('')
  const [nSystem, setNSystem] = useState('ubuntu')
  const [nApiKey, setNApiKey] = useState('')
  const [nSessionKey, setNSessionKey] = useState('')
  const [nSshAlias, setNSshAlias] = useState('')

  // delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  // test result toast
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)

  // 本机首次配置指引开关
  const [localHelpOpen, setLocalHelpOpen] = useState(false)

  // Edit node inline state
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editHost, setEditHost] = useState('')
  const [editSystem, setEditSystem] = useState('ubuntu')
  const [editApiKey, setEditApiKey] = useState('')
  const [editSessionKey, setEditSessionKey] = useState('')
  const [editSshAlias, setEditSshAlias] = useState('')

  const openSettings = () => {
    setDraftName(username)
    setSettingsOpen(true)
  }

  const saveUsername = () => {
    const name = draftName.trim() || '李君陌'
    setUsername(name)
    try {
      localStorage.setItem(USERNAME_KEY, name)
    } catch {
      // ignore
    }
  }

  const submitNode = () => {
    const name = nName.trim()
    const host = nHost.trim()
    if (!name || !host) return
    setTesting(false)
    setTestResult(null)
    onAddNode({
      name,
      host,
      system: nSystem,
      apiKey: nApiKey.trim() || undefined,
      sessionKey: nSessionKey.trim() || undefined,
      sshAlias: nSshAlias.trim() || undefined,
    })
    setNName('')
    setNHost('')
    setNApiKey('')
    setNSessionKey('')
    setNSshAlias('')
  }

  const handleTestConnection = async () => {
    const host = nHost.trim() || editHost.trim()
    const apiKey = (nApiKey || editApiKey).trim() || undefined
    const sessionKey = (nSessionKey || editSessionKey).trim() || undefined
    if (!host) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await onTestNode(host, apiKey, sessionKey)
      setTestResult(res)
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : '检测失败' })
    } finally {
      setTesting(false)
    }
  }

  // Auto-clear test result
  useEffect(() => {
    if (!testResult) return
    const id = window.setTimeout(() => setTestResult(null), 12000)
    return () => window.clearTimeout(id)
  }, [testResult])

  return (
    <>
      <aside className="nav-rail">
        <div className="nav-rail__brand">
          <span className="nav-rail__logo">H</span>
          <span className="nav-label nav-rail__brandtext">
            <strong>Hermes办公室</strong>
            <em>智能员工工作区</em>
          </span>
        </div>

        <label className="nav-search">
          <span className="nav-item__icon" />
          <input className="nav-label" placeholder="搜索" disabled />
        </label>

        <nav className="nav-groups">
          {navGroups.map((group, index) => (
            <div key={group.title ?? index} className="nav-group">
              {group.title ? <p className="nav-group__title nav-label">{group.title}</p> : null}
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-item ${item.comingSoon ? 'is-disabled' : ''}`}
                  title={item.tooltip ?? item.label}
                  onClick={() => {
                    if (item.comingSoon) return
                    if (item.id === 'new-chat') onAction({ type: 'new-chat' })
                    if (item.id === 'skills') onAction({ type: 'skill-gallery' })
                    if (item.id === 'auto-task') onAction({ type: 'job-list' })
                  }}
                >
                  <span className="nav-item__icon">
                    {(() => {
                      const Icon = ICON_MAP[item.icon]
                      return Icon ? <Icon size={ICON_SIZE} strokeWidth={1.5} /> : item.icon
                    })()}
                  </span>
                  <span className="nav-label">
                    {item.label}
                    {item.comingSoon ? (
                      <em className="nav-label__soon">即将上线</em>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          ))}

        </nav>

        <div className="nav-rail__foot">
          <button type="button" className="nav-item" onClick={openSettings}>
            <span className="nav-item__icon nav-item__icon--gear">
              <Settings size={16} strokeWidth={1.5} />
            </span>
            <span className="nav-label">配置</span>
          </button>
          <div className="nav-user">
            <div className="nav-user__avatar">{username.slice(0, 1)}</div>
            <div className="nav-user__meta nav-label">
              <strong>{username}</strong>
              <span>在线</span>
            </div>
            <i className="nav-user__dot" />
          </div>
        </div>
      </aside>

      {deleteTarget ? (
        <div className="settings__backdrop" onClick={() => setDeleteTarget(null)}>
          <div className="settings settings--confirm" onClick={(e) => e.stopPropagation()}>
            <h3>确认删除节点</h3>
            <p>确定要删除节点「{deleteTarget.name}」吗？此操作不可撤销。</p>
            <div className="settings__actions">
              <button type="button" className="config-btn config-btn--ghost" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button
                type="button"
                className="config-btn config-btn--danger"
                onClick={() => {
                  onRemoveNode(deleteTarget.id)
                  setDeleteTarget(null)
                }}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="settings__backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="settings" onClick={(e) => e.stopPropagation()}>
            <header className="settings__header">
              <h2>配置</h2>
              <button type="button" className="settings__close" onClick={() => setSettingsOpen(false)}>
                ×
              </button>
            </header>

            <label className="settings__field">
              <span>用户名称</span>
              <div className="settings__row">
                <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="李君陌" />
                <button type="button" className="config-btn" onClick={saveUsername}>
                  保存
                </button>
              </div>
            </label>

            <div className="settings__section">
              <div className="settings__section-title">Hermes 节点管理</div>
              <p className="settings__section-help">
                每个远程节点通过 HTTP 网关通信（对话/状态/健康检查）。若要读取该节点的看板和子 agent 列表，还需在<strong>本机</strong>（运行此网页的电脑）配置免密 SSH 别名。
              </p>
              <PromptCard
                label="对本机 Hermes 说（查找 / 配置 SSH 别名）"
                text="帮我查看本机 ~/.ssh/config 里已经配置了哪些 SSH 别名（Host）。如果我要连的远程机器还没有别名，请帮我新增一个：Host 名我来定，HostName 填远程机器 IP，User 填登录用户名，IdentityFile 指向对应私钥；加好后运行 ssh <别名> echo ok 验证免密登录成功。"
              />
              <ul className="settings__nodes">
                {nodes.map((node) => {
                  const isEditing = editingNodeId === node.id
                  return (
                    <li key={node.id} className="settings__node">
                      <i className="settings__node-dot" style={{ background: node.accent }} />
                      {isEditing ? (
                        node.kind === 'local' ? (
                          <div className="settings__node-edit">
                            <input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              placeholder="名称"
                              autoFocus
                            />
                            <div className="settings__node-actions">
                              <button
                                type="button"
                                className="config-btn config-btn--ghost"
                                onClick={() => setEditingNodeId(null)}
                              >
                                取消
                              </button>
                              <button
                                type="button"
                                className="config-btn"
                                disabled={!editName.trim()}
                                onClick={() => {
                                  onUpdateNode(node.id, { name: editName.trim() || node.name })
                                  setEditingNodeId(null)
                                }}
                              >
                                保存
                              </button>
                            </div>
                          </div>
                        ) : (
                        <div className="settings__node-edit">
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="名称"
                            autoFocus
                          />
                          <input
                            value={editHost}
                            onChange={(e) => setEditHost(e.target.value)}
                            placeholder="IP:端口"
                          />
                          <select value={editSystem} onChange={(e) => setEditSystem(e.target.value)}>
                            <option value="ubuntu">ubuntu</option>
                            <option value="macos">macos</option>
                            <option value="win">win</option>
                            <option value="linux">linux</option>
                          </select>
                          <input
                            value={editApiKey}
                            onChange={(e) => setEditApiKey(e.target.value)}
                            placeholder="API key"
                          />
                          <input
                            value={editSessionKey}
                            onChange={(e) => setEditSessionKey(e.target.value)}
                            placeholder="会话暗号（可空）"
                          />
                          <input
                            value={editSshAlias}
                            onChange={(e) => setEditSshAlias(e.target.value)}
                            placeholder="SSH 别名（可空，填了才能读看板和子agent）"
                          />
                          <div className="settings__node-actions">
                            <button
                              type="button"
                              className={`config-btn config-btn--ghost ${testing ? 'is-loading' : ''}`}
                              disabled={testing || !editHost.trim()}
                              onClick={() => void handleTestConnection()}
                            >
                              {testing ? '检测中…' : '🔍 检测'}
                            </button>
                            <button
                              type="button"
                              className="config-btn config-btn--ghost"
                              onClick={() => setEditingNodeId(null)}
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              className="config-btn"
                              disabled={!editName.trim() || !editHost.trim()}
                              onClick={() => {
                                onUpdateNode(node.id, {
                                  name: editName.trim() || node.name,
                                  host: editHost.trim() || node.host,
                                  system: editSystem,
                                  apiKey: editApiKey.trim() || undefined,
                                  sessionKey: editSessionKey.trim() || undefined,
                                  sshAlias: editSshAlias.trim() || undefined,
                                })
                                setEditingNodeId(null)
                              }}
                            >
                              保存
                            </button>
                          </div>
                          {testResult ? (
                            <div className={`settings__test-result ${testResult.ok ? 'is-ok' : 'is-err'}`}>
                              {testResult.ok ? '✅ ' : '❌ '}
                              {testResult.message}
                            </div>
                          ) : null}
                        </div>
                        )
                      ) : (
                        <span className="settings__node-meta">
                          <strong>{node.name}</strong>
                          <em>
                            {node.kind === 'local' ? '本机 · 自动识别' : `${node.system} · ${node.host}`}
                            {node.kind === 'remote' && node.sshAlias ? ` · SSH:${node.sshAlias}` : ''}
                            {node.kind === 'remote' && !node.sshAlias ? ' · 无SSH(仅对话/状态)' : ''}
                          </em>
                        </span>
                      )}
                      {node.kind === 'remote' && !isEditing ? (
                        <div className="settings__node-btns">
                          <button
                            type="button"
                            className="settings__node-edit-btn"
                            title="编辑节点配置"
                            onClick={() => {
                              setEditName(node.name)
                              setEditHost(node.host)
                              setEditSystem(node.system)
                              setEditApiKey(node.apiKey ?? '')
                              setEditSessionKey(node.sessionKey ?? '')
                              setEditSshAlias(node.sshAlias ?? '')
                              setEditingNodeId(node.id)
                            }}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="settings__node-del"
                            onClick={() => setDeleteTarget({ id: node.id, name: node.name })}
                          >
                            删除
                          </button>
                        </div>
                      ) : node.kind === 'local' ? (
                        <div className="settings__node-btns">
                          <button
                            type="button"
                            className="settings__node-edit-btn"
                            title="重命名本机"
                            onClick={() => {
                              setEditName(node.name)
                              setEditingNodeId(node.id)
                            }}
                          >
                            ✎ 编辑
                          </button>
                          <button
                            type="button"
                            className="settings__node-edit-btn"
                            title="本机配置指引"
                            onClick={() => setLocalHelpOpen((v) => !v)}
                          >
                            {localHelpOpen ? '收起' : '说明'}
                          </button>
                          <span className="settings__node-tag">自动</span>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>

              {localHelpOpen ? (
                <div className="settings__local-help">
                  <PromptCard
                    label="对本机 Hermes 说（开启 API Server）"
                    text="帮我给这台机器开启 API Server，端口用 8642，生成一个随机 API Key 保存到 .env 里，然后重启 gateway"
                  />
                </div>
              ) : null}

              <div className="settings__addnode">
                <div className="settings__addnode-title">添加远程节点</div>
                <p className="settings__section-help settings__section-help--dim">
                  填写另一台运行 Hermes 的机器的连接信息。名称随意；系统类型决定技能/看板脚本的参数。
                </p>
                <label className="settings__addnode-label">名称</label>
                <input value={nName} onChange={(e) => setNName(e.target.value)} placeholder="如 我的服务器" />
                <label className="settings__addnode-label">地址</label>
                <input value={nHost} onChange={(e) => setNHost(e.target.value)} placeholder="IP:端口（如 192.168.1.9:8642）" />
                <label className="settings__addnode-label">操作系统</label>
                <select value={nSystem} onChange={(e) => setNSystem(e.target.value)}>
                  <option value="ubuntu">ubuntu</option>
                  <option value="macos">macos</option>
                  <option value="win">win</option>
                  <option value="linux">linux</option>
                </select>
                <label className="settings__addnode-label">API Key（Bearer Token）</label>
                <input value={nApiKey} onChange={(e) => setNApiKey(e.target.value)} placeholder="该节点 config.yaml 中的 API_SERVER_KEY" />
                <label className="settings__addnode-label">会话暗号（可选）</label>
                <input value={nSessionKey} onChange={(e) => setNSessionKey(e.target.value)} placeholder="X-Hermes-Session-Key，留空则为 web-console" />
                <label className="settings__addnode-label">SSH 别名（可选）</label>
                <input value={nSshAlias} onChange={(e) => setNSshAlias(e.target.value)} placeholder="~/.ssh/config 中的 Host 名，填了才能读该节点的看板和子 agent" />
                <p className="settings__section-help settings__section-help--dim">
                  不填 SSH 别名：只能对话 + 查看状态。<br />
                  填写 SSH 别名：额外支持看板读写、子 agent 创建/列表。
                </p>
                <div className="settings__addnode-actions">
                  <button
                    type="button"
                    className={`config-btn config-btn--ghost ${testing ? 'is-loading' : ''}`}
                    disabled={testing || !nHost.trim()}
                    onClick={() => void handleTestConnection()}
                  >
                    {testing ? '检测中…' : '🔍 检测连接'}
                  </button>
                  <button type="button" className="config-btn" disabled={!nName.trim() || !nHost.trim()} onClick={submitNode}>
                    添加节点
                  </button>
                </div>
                {testResult ? (
                  <div className={`settings__test-result ${testResult.ok ? 'is-ok' : 'is-err'}`}>
                    {testResult.ok ? '✅ ' : '❌ '}
                    {testResult.message}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
