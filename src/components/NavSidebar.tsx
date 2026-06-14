import { useEffect, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { navGroups, type HermesNode } from '../data/cyber'
import {
  getObsidianNote,
  getObsidianNotes,
  type HermesInstanceId,
  type ObsidianNoteContent,
  type ObsidianNoteItem,
} from '../services/hermes'
import {
  MessageCirclePlus,
  Puzzle,
  FileText,
  RefreshCw,
  Search,
  Settings,
  ChevronRight,
  Folder,
} from 'lucide-react'

const ICON_MAP: Record<string, typeof MessageCirclePlus> = {
  'message-circle-plus': MessageCirclePlus,
  'puzzle': Puzzle,
  'file-text': FileText,
}
const ICON_SIZE = 16

const USERNAME_KEY = 'cyber:username'
const OBSIDIAN_ROOT_KEY = 'cyber:obsidian-root'

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
  onRefreshNodes: () => Promise<void>
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

function loadObsidianRoot() {
  try {
    return localStorage.getItem(OBSIDIAN_ROOT_KEY) || ''
  } catch {
    return ''
  }
}

// --- Obsidian note tree --------------------------------------------------
type ObsidianTreeNode = {
  name: string
  /** Folder path (joined with '/') for keying/expansion; files use note.relativePath. */
  path: string
  note?: ObsidianNoteItem
  children: ObsidianTreeNode[]
}

/** Build a folder tree from notes' relativePaths (split on / or \). */
function buildNoteTree(notes: ObsidianNoteItem[]): ObsidianTreeNode[] {
  const root: ObsidianTreeNode = { name: '', path: '', children: [] }
  for (const note of notes) {
    const parts = note.relativePath.split(/[\\/]/).filter(Boolean)
    let cur = root
    parts.forEach((seg, i) => {
      const isLeaf = i === parts.length - 1
      const segPath = parts.slice(0, i + 1).join('/')
      let child = cur.children.find((c) =>
        isLeaf ? c.note?.relativePath === note.relativePath : !c.note && c.name === seg,
      )
      if (!child) {
        child = { name: seg, path: segPath, children: [], note: isLeaf ? note : undefined }
        cur.children.push(child)
      }
      cur = child
    })
  }
  // folders first, then files; alphabetical within each group.
  const sortRec = (n: ObsidianTreeNode) => {
    n.children.sort((a, b) => {
      const af = a.note ? 1 : 0
      const bf = b.note ? 1 : 0
      if (af !== bf) return af - bf
      return a.name.localeCompare(b.name, 'zh-CN')
    })
    n.children.forEach(sortRec)
  }
  sortRec(root)
  return root.children
}

function ObsidianPanel({ onClose }: { onClose: () => void }) {
  const [root, setRoot] = useState(loadObsidianRoot)
  const [notes, setNotes] = useState<ObsidianNoteItem[]>([])
  const [selectedPath, setSelectedPath] = useState('')
  const [activeNote, setActiveNote] = useState<ObsidianNoteContent | null>(null)
  const [loading, setLoading] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const tree = useMemo(() => buildNoteTree(notes), [notes])
  const toggleFolder = (path: string) =>
    setExpanded((cur) => {
      const next = new Set(cur)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const refresh = async () => {
    const trimmed = root.trim()
    if (!trimmed) {
      setError('先输入 Obsidian vault 目录')
      return
    }
    setLoading(true)
    setError('')
    try {
      localStorage.setItem(OBSIDIAN_ROOT_KEY, trimmed)
      const data = await getObsidianNotes(trimmed)
      setRoot(data.root)
      setNotes(data.notes)
      setTruncated(data.truncated)
      if (data.notes.length) {
        void openNote(data.notes[0])
      } else {
        setSelectedPath('')
        setActiveNote(null)
      }
    } catch (err) {
      setNotes([])
      setTruncated(false)
      setError(err instanceof Error ? err.message : '读取笔记失败')
    } finally {
      setLoading(false)
    }
  }

  const openNote = async (note: ObsidianNoteItem) => {
    setSelectedPath(note.relativePath)
    // expand ancestor folders so the opened note is visible in the tree
    const parts = note.relativePath.split(/[\\/]/).filter(Boolean)
    if (parts.length > 1) {
      setExpanded((cur) => {
        const next = new Set(cur)
        for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join('/'))
        return next
      })
    }
    setOpening(true)
    setError('')
    try {
      const data = await getObsidianNote(root.trim(), note.relativePath)
      setActiveNote(data)
    } catch (err) {
      setActiveNote(null)
      setError(err instanceof Error ? err.message : '打开笔记失败')
    } finally {
      setOpening(false)
    }
  }

  useEffect(() => {
    if (root.trim()) void refresh()
    // Run once when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const renderNodes = (nodes: ObsidianTreeNode[], depth: number): ReactNode =>
    nodes.map((node) => {
      if (node.note) {
        const note = node.note
        return (
          <button
            key={note.path}
            type="button"
            className={`knowledge-tree__file ${selectedPath === note.relativePath ? 'is-active' : ''}`}
            style={{ ['--depth' as string]: depth }}
            onClick={() => void openNote(note)}
            title={note.title}
          >
            <FileText size={13} className="knowledge-tree__icon" />
            <span className="knowledge-tree__label">{note.title}</span>
          </button>
        )
      }
      const open = expanded.has(node.path)
      return (
        <div key={`dir:${node.path}`} className="knowledge-tree__group">
          <button
            type="button"
            className="knowledge-tree__folder"
            style={{ ['--depth' as string]: depth }}
            onClick={() => toggleFolder(node.path)}
          >
            <ChevronRight size={13} className={`knowledge-tree__chevron ${open ? 'is-open' : ''}`} />
            <Folder size={13} className="knowledge-tree__icon" />
            <span className="knowledge-tree__label">{node.name}</span>
          </button>
          {open ? renderNodes(node.children, depth + 1) : null}
        </div>
      )
    })

  return (
    <div className="settings__backdrop" onClick={onClose}>
      <div className="knowledge-panel" onClick={(e) => e.stopPropagation()}>
        <header className="knowledge-panel__header">
          <div>
            <h2>Obsidian 文档</h2>
            <p>输入 vault 目录后读取本机 Markdown 笔记。</p>
          </div>
          <button type="button" className="settings__close" onClick={onClose}>×</button>
        </header>

        <div className="knowledge-panel__toolbar">
          <input
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            placeholder="例如 C:\Users\你\Documents\Obsidian\我的库"
          />
          <button type="button" className="config-btn knowledge-panel__refresh" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={14} />
            {loading ? '刷新中' : '刷新'}
          </button>
        </div>

        {error ? <p className="knowledge-panel__error">{error}</p> : null}
        {truncated ? <p className="knowledge-panel__notice">笔记较多，已显示最近 300 条。</p> : null}

        <div className="knowledge-panel__workspace">
          <aside className="knowledge-tree">
            {notes.length ? (
              renderNodes(tree, 0)
            ) : (
              <div className="knowledge-panel__empty">
                {loading ? '正在读取笔记...' : '输入 Obsidian 目录后点击刷新。'}
              </div>
            )}
          </aside>

          <main className="knowledge-reader">
            {opening ? (
              <div className="knowledge-panel__empty">正在打开笔记...</div>
            ) : activeNote ? (
              <>
                <header className="knowledge-reader__head">
                  <h3>{activeNote.title}</h3>
                  <span>{activeNote.relativePath}</span>
                </header>
                <article className="knowledge-reader__markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeNote.content}</ReactMarkdown>
                </article>
              </>
            ) : (
              <div className="knowledge-panel__empty">从左侧选择一篇 Markdown 笔记。</div>
            )}
          </main>
        </div>
      </div>
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
  onRefreshNodes,
}: NavSidebarProps) {
  const [username, setUsername] = useState(loadUsername)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [obsidianOpen, setObsidianOpen] = useState(false)
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
    const name = draftName.trim() || '朱林情'
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
      if (res.ok) {
        await onRefreshNodes()
      }
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
          <span className="nav-item__icon nav-item__icon--search">
            <Search size={ICON_SIZE} strokeWidth={1.8} />
          </span>
          <input className="nav-label" placeholder="搜索" disabled />
        </label>

        <nav className="nav-groups">
          {navGroups.map((group, index) => {
            const items = group.items.filter((item) => !['auto-task', 'apps', 'gallery', 'pc'].includes(item.id))
            if (!items.length) return null
            const groupTitle = items.some((item) => item.id === 'docs') ? '本地知识库' : group.title
            return (
            <div key={group.title ?? index} className="nav-group">
              {groupTitle ? <p className="nav-group__title nav-label">{groupTitle}</p> : null}
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-item ${item.comingSoon && item.id !== 'docs' ? 'is-disabled' : ''}`}
                  title={item.id === 'docs' ? '打开 Obsidian 笔记' : item.tooltip ?? item.label}
                  onClick={() => {
                    if (item.id === 'docs') {
                      setObsidianOpen(true)
                      return
                    }
                    if (item.comingSoon) return
                    if (item.id === 'new-chat') onAction({ type: 'new-chat' })
                    if (item.id === 'skills') onAction({ type: 'skill-gallery' })
                    if (item.id === 'auto-task') onAction({ type: 'job-list' })
                  }}
                >
                  <span className={`nav-item__icon nav-item__icon--${item.id}`}>
                    {(() => {
                      const Icon = ICON_MAP[item.icon]
                      return Icon ? <Icon size={ICON_SIZE} strokeWidth={1.8} /> : item.icon
                    })()}
                  </span>
                  <span className="nav-label">
                    {item.id === 'docs' ? '文档' : item.label}
                    {item.comingSoon && item.id !== 'docs' ? (
                      <em className="nav-label__soon">即将上线</em>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          )})}

        </nav>

        <div className="nav-rail__foot">
          <button type="button" className="nav-item" onClick={openSettings}>
            <span className="nav-item__icon nav-item__icon--settings">
              <Settings size={16} strokeWidth={1.8} />
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

      {obsidianOpen ? <ObsidianPanel onClose={() => setObsidianOpen(false)} /> : null}

      {settingsOpen ? (
        <div className="settings__backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="settings" onClick={(e) => e.stopPropagation()}>
            <header className="settings__header">
              <h2>配置</h2>
              <div className="dialog-header-actions">
                <button type="button" className="settings__close" onClick={() => setSettingsOpen(false)}>
                  ×
                </button>
              </div>
            </header>

            <label className="settings__field">
              <span>用户名称</span>
              <div className="settings__row">
                <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="朱林情" />
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
                      ) : (
                        <span className="settings__node-meta">
                          <strong>{node.name}</strong>
                          <em>
                            {node.kind === 'local' ? `本机 · ${node.system} · ${node.host}` : `${node.system} · ${node.host}`}
                            {node.kind === 'remote' && node.sshAlias ? ` · SSH:${node.sshAlias}` : ''}
                            {node.kind === 'remote' && !node.sshAlias ? ' · 无SSH(仅对话/状态)' : ''}
                          </em>
                        </span>
                      )}
                      {!isEditing ? (
                        <div className="settings__node-btns">
                          <button
                            type="button"
                            className="settings__node-edit-btn"
                            title={node.kind === 'local' ? '编辑本机 IP / 端口 / API Key' : '编辑节点配置'}
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
                            {node.kind === 'local' ? '✎ 编辑连接' : '✎'}
                          </button>
                          {node.kind === 'remote' ? (
                            <button
                              type="button"
                              className="settings__node-del"
                              onClick={() => setDeleteTarget({ id: node.id, name: node.name })}
                            >
                              删除
                            </button>
                          ) : null}
                          {node.kind === 'local' ? (
                          <button
                            type="button"
                            className="settings__node-edit-btn"
                            title="本机配置指引"
                            onClick={() => setLocalHelpOpen((v) => !v)}
                          >
                            {localHelpOpen ? '收起' : '说明'}
                          </button>
                          ) : null}
                          {node.kind === 'local' ? <span className="settings__node-tag">自动</span> : null}
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
