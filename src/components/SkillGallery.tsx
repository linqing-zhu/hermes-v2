import { useEffect, useState } from 'react'
import type { HermesInstanceId } from '../services/hermes'
import type { HermesSkillWithInstance } from '../services/hermes'
import { getSkills, setSkillEnabled } from '../services/hermes'

type SkillWithState = HermesSkillWithInstance & { enabled: boolean; toggling: boolean }

export function SkillGallery({
  nodes,
  onOpenChat,
  onClose,
}: {
  nodes: { id: HermesInstanceId; name: string; accent: string }[]
  onOpenChat: (instanceId: HermesInstanceId) => void
  onClose: () => void
}) {
  const [activeNode, setActiveNode] = useState<string>(nodes[0]?.id ?? '')
  const [skills, setSkills] = useState<SkillWithState[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async (nodeId: string) => {
    setLoading(true)
    setError('')
    try {
      const data = await getSkills(nodeId)
      // Build enabled set from... we don't get enabled state from /v1/skills directly,
      // so assume all returned skills are enabled. The toggle writes through.
      setSkills(
        data.map((s) => ({ ...s, enabled: true, toggling: false })),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载技能失败')
      setSkills([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(activeNode)
  }, [activeNode])

  const handleToggle = async (skill: SkillWithState) => {
    const newEnabled = !skill.enabled
    // Optimistic update
    setSkills((cur) =>
      cur.map((s) => (s.name === skill.name ? { ...s, enabled: newEnabled, toggling: true } : s)),
    )
    try {
      await setSkillEnabled(activeNode, skill.name, newEnabled)
    } catch (err) {
      // Revert
      setSkills((cur) =>
        cur.map((s) =>
          s.name === skill.name
            ? { ...s, enabled: !newEnabled, toggling: false }
            : s,
        ),
      )
      setError(err instanceof Error ? err.message : '切换技能状态失败')
    } finally {
      setSkills((cur) =>
        cur.map((s) =>
          s.name === skill.name ? { ...s, toggling: false } : s,
        ),
      )
    }
  }

  const activeNodeInfo = nodes.find((n) => n.id === activeNode)

  const [closeClick, setCloseClick] = useState<{ x: number; y: number } | null>(null)

  return (
    <div
      className="panel-overlay"
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
      <div
        className="panel-sheet panel-sheet--skills"
        style={{ ['--accent' as string]: activeNodeInfo?.accent ?? '#4e8bff' }}
        onClick={(e) => { e.stopPropagation() }}
        onMouseDown={(e) => { setCloseClick(null); e.stopPropagation() }}
      >
        <header className="panel-sheet__header">
          <h2>技能广场</h2>
          <p>浏览和启用/禁用各 Hermes 节点的技能</p>
          <div className="dialog-header-actions">
            <button type="button" className="dialog-chat-btn" onClick={() => onOpenChat(activeNode)} title="打开对话">
              💬
            </button>
            <button type="button" className="panel-sheet__close" onClick={onClose}>
              ×
            </button>
          </div>
        </header>

        <nav className="panel-sheet__tabs">
          {nodes.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`panel-sheet__tab ${n.id === activeNode ? 'is-active' : ''}`}
              style={{ ['--accent' as string]: n.accent }}
              onClick={() => setActiveNode(n.id)}
            >
              <span className="panel-sheet__tab-dot" style={{ background: n.accent }} />
              {n.name}
            </button>
          ))}
        </nav>

        <div className="panel-sheet__body">
          {loading ? (
            <div className="panel-hint">正在读取技能列表…</div>
          ) : error ? (
            <div className="panel-hint panel-hint--error">{error}</div>
          ) : skills.length === 0 ? (
            <div className="panel-empty">
              <span className="panel-empty__icon">🧩</span>
              <strong>暂无技能</strong>
              <p>该节点未配置任何技能，或技能 API 不可用。</p>
            </div>
          ) : (
            <ul className="skill-list">
              {skills.map((skill) => (
                <li key={skill.name} className="skill-item">
                  <div className="skill-item__meta">
                    <strong className="skill-item__name">{skill.name}</strong>
                    {skill.description ? (
                      <span className="skill-item__desc">{skill.description}</span>
                    ) : null}
                    {skill.category ? (
                      <span className="skill-item__cat">{skill.category}</span>
                    ) : null}
                  </div>
                  <label className="skill-item__toggle">
                    <input
                      type="checkbox"
                      checked={skill.enabled}
                      disabled={skill.toggling}
                      onChange={() => handleToggle(skill)}
                    />
                    <span className={`skill-item__switch ${skill.enabled ? 'is-on' : ''}`}>
                      <i className="skill-item__knob" />
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
