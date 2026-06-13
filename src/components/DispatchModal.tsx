import { useState } from 'react'
import { agentGlyph, type HermesNode } from '../data/cyber'
import type { HermesProfileAgent } from '../services/hermes'
import type { KanbanCreatePayload } from '../services/hermes'

type RealStatus = NonNullable<KanbanCreatePayload['initial_status']>

const REAL_STATUS_OPTIONS: { value: RealStatus; label: string; hint: string }[] = [
  { value: 'triage', label: '待分类 triage（安全）', hint: '停在待分类列，交给规范制定者完善规格，不会自动执行' },
  { value: 'ready', label: '就绪 ready', hint: '可被调度守护进程认领并执行（会真实消耗 token）' },
]

export function DispatchModal({
  agent,
  node,
  onDispatch,
  onCreateReal,
  onChat,
  onConfigure,
  onClose,
}: {
  agent: HermesProfileAgent
  node: HermesNode
  onDispatch: (task: string) => void
  onCreateReal: (payload: KanbanCreatePayload) => void
  onChat: () => void
  onConfigure: () => void
  onClose: () => void
}) {
  const [task, setTask] = useState('')
  const [target, setTarget] = useState<'local' | 'real'>('local')
  const [realStatus, setRealStatus] = useState<RealStatus>('triage')
  const trimmed = task.trim()

  const handleSubmit = () => {
    if (!trimmed) return
    if (target === 'local') {
      onDispatch(trimmed)
      return
    }
    onCreateReal({
      title: trimmed,
      assignee: agent.id,
      initial_status: realStatus,
      created_by: 'control-center',
    })
  }

  const [closeClick, setCloseClick] = useState<{ x: number; y: number } | null>(null)

  return (
    <div
      className="dispatch__backdrop"
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
      <div className="dispatch" style={{ ['--accent' as string]: node.accent }} onClick={(e) => { e.stopPropagation() }} onMouseDown={(e) => { setCloseClick(null); e.stopPropagation() }}>
        <header className="dispatch__header">
          <span className="dispatch__glyph">{agentGlyph(agent.name)}</span>
          <div>
            <h2>{agent.name}</h2>
            <p>
              {node.name} · {agent.model || '默认模型'}
            </p>
          </div>
          <button type="button" className="dispatch__close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="dispatch__seg" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={target === 'local'}
            className={`dispatch__seg-btn ${target === 'local' ? 'is-active' : ''}`}
            onClick={() => setTarget('local')}
          >
            本地看板
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={target === 'real'}
            className={`dispatch__seg-btn ${target === 'real' ? 'is-active' : ''}`}
            onClick={() => setTarget('real')}
          >
            真实看板 kanban.db
          </button>
        </div>

        <label className="dispatch__field">
          <span>任务描述</span>
          <textarea
            value={task}
            onChange={(event) => setTask(event.target.value)}
            placeholder={
              target === 'local'
                ? `让 ${agent.name} 做什么？派发后会进入看板「待办」列…`
                : `写入 ${node.name} 的真实 kanban.db，assignee=${agent.id}…`
            }
            rows={3}
            autoFocus
          />
        </label>

        {target === 'real' ? (
          <label className="dispatch__field">
            <span>初始状态</span>
            <select
              className="dispatch__select"
              value={realStatus}
              onChange={(event) => setRealStatus(event.target.value as RealStatus)}
            >
              {REAL_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <small className="dispatch__hint">
              {REAL_STATUS_OPTIONS.find((opt) => opt.value === realStatus)?.hint}
            </small>
          </label>
        ) : null}

        <footer className="dispatch__footer">
          <button type="button" className="dispatch__btn dispatch__btn--ghost" onClick={onChat}>
            直接对话
          </button>
          <button type="button" className="dispatch__btn dispatch__btn--ghost" onClick={onConfigure}>
            查看配置
          </button>
          <button type="button" className="dispatch__btn" disabled={!trimmed} onClick={handleSubmit}>
            {target === 'local' ? '派发到看板' : '写入真实看板'}
          </button>
        </footer>
      </div>
    </div>
  )
}
