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

/**
 * Fixed left panel mirroring DonePanel — lists recent sessions grouped by node.
 * Click → opens ChatDialog for that session. Active session is highlighted.
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
  const recentSessions = sessions
    .filter((s) => s.last_active)
    .sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0))
    .slice(0, 50)

  const grouped = new Map<HermesInstanceId, HermesSessionWithInstance[]>()
  for (const s of recentSessions) {
    const list = grouped.get(s.instanceId) || []
    list.push(s)
    grouped.set(s.instanceId, list)
  }

  const active = activeSession

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
            return (
              <div key={nodeId} className="chat-panel__group">
                <span
                  className="chat-panel__node"
                  style={{ ['--accent' as string]: node?.accent }}
                >
                  <i
                    className="chat-panel__node-dot"
                    style={{ background: node?.accent ?? '#4e8bff' }}
                  />
                  {node?.name ?? nodeId}
                </span>
                {nodeSessions.slice(0, 8).map((s) => {
                  const isActive =
                    active?.instanceId === nodeId && active?.sessionId === s.id
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`chat-panel__item ${isActive ? 'is-active' : ''}`}
                      onClick={() => onSelect(s.instanceId, s.id)}
                    >
                      <span className="chat-panel__item-title">
                        {sessionTitle(s)}
                      </span>
                      <span className="chat-panel__item-meta">
                        {s.model ? `${s.model}` : ''}
                        {s.message_count ? ` · ${s.message_count} 条` : ''}
                        {' · '}
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
