import { useState } from 'react'
import type { HermesInstanceId, HermesSessionWithInstance } from '../services/hermes'

function timeAgo(ts: number | null): string {
  if (!ts) return ''
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}

function sessionTitle(s: HermesSessionWithInstance): string {
  return s.title || s.preview || '(无标题)'
}

function sourceLabel(source: string | null | undefined): string {
  const normalized = (source || '').trim().toLowerCase()
  if (!normalized) return 'Web'
  if (normalized.includes('feishu') || normalized.includes('lark')) return '飞书'
  if (normalized.includes('clib') || normalized.includes('clb')) return 'CLB'
  if (normalized.includes('web') || normalized.includes('api') || normalized.includes('console')) return 'Web'
  return source || 'Web'
}

/**
 * Left conversation panel. Sessions stay grouped by Hermes node; each session
 * carries its own source tag so Web / Feishu / CLB can coexist in one group.
 */
export function ChatPanel({
  sessions,
  active: activeSession,
  nodes,
  onSelect,
}: {
  sessions: HermesSessionWithInstance[]
  active: { instanceId: HermesInstanceId; sessionId: string | null } | null
  nodes: { id: HermesInstanceId; name: string; accent: string }[]
  onSelect: (instanceId: HermesInstanceId, sessionId: string) => void
}) {
  const [collapsed, setCollapsed] = useState<Record<HermesInstanceId, boolean>>({})

  const recentSessions = sessions
    .filter((s) => s.last_active)
    .sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0))
    .slice(0, 80)

  const grouped = new Map<HermesInstanceId, HermesSessionWithInstance[]>()
  for (const session of recentSessions) {
    const list = grouped.get(session.instanceId) || []
    list.push(session)
    grouped.set(session.instanceId, list)
  }

  return (
    <aside className="chat-panel">
      <header className="done-panel__head">
        <span className="done-panel__title">对话</span>
        <span className="done-panel__count">{recentSessions.length}</span>
      </header>
      <div className="done-panel__body">
        {recentSessions.length === 0 ? (
          <span className="kanban-col__empty">— 暂无对话 —</span>
        ) : (
          [...grouped.entries()].map(([nodeId, nodeSessions]) => {
            const node = nodes.find((n) => n.id === nodeId)
            const isCollapsed = collapsed[nodeId] ?? false
            return (
              <div key={nodeId} className={`chat-panel__group ${isCollapsed ? 'is-collapsed' : ''}`}>
                <button
                  type="button"
                  className="chat-panel__node"
                  style={{ ['--accent' as string]: node?.accent }}
                  onClick={() =>
                    setCollapsed((current) => ({ ...current, [nodeId]: !(current[nodeId] ?? false) }))
                  }
                  title={isCollapsed ? '展开历史对话' : '折叠历史对话'}
                >
                  <span className="chat-panel__chevron">{isCollapsed ? '▸' : '▾'}</span>
                  <i
                    className="chat-panel__node-dot"
                    style={{ background: node?.accent ?? '#4e8bff' }}
                  />
                  <span className="chat-panel__node-name">{node?.name ?? nodeId}</span>
                  <span className="chat-panel__node-count">{nodeSessions.length}</span>
                </button>
                {isCollapsed ? null : nodeSessions.slice(0, 12).map((s) => {
                  const isActive =
                    activeSession?.instanceId === nodeId && activeSession?.sessionId === s.id
                  return (
                    <button
                      key={`${s.instanceId}:${s.id}`}
                      type="button"
                      className={`chat-panel__item ${isActive ? 'is-active' : ''}`}
                      onClick={() => onSelect(s.instanceId, s.id)}
                    >
                      <span className="chat-panel__item-title">
                        {sessionTitle(s)}
                      </span>
                      <span className="chat-panel__item-meta">
                        <span className="chat-panel__source" style={{ ['--accent' as string]: node?.accent ?? '#4e8bff' }}>
                          {sourceLabel(s.source)}
                        </span>
                        {s.message_count ? `${s.message_count} 条 · ` : ''}
                        {timeAgo(s.last_active ?? null)}
                      </span>
                    </button>
                  )
                })}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
