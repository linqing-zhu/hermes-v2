import { useEffect, useState } from 'react'
import type { HermesInstanceId, HermesJobWithInstance } from '../services/hermes'
import { getJobs } from '../services/hermes'

export function JobList({
  nodes,
  onClose,
}: {
  nodes: { id: HermesInstanceId; name: string; accent: string }[]
  onClose: () => void
}) {
  const [activeNode, setActiveNode] = useState<string>(nodes[0]?.id ?? '')
  const [jobs, setJobs] = useState<HermesJobWithInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getJobs(activeNode)
      .then((data) => {
        if (cancelled) return
        setJobs(data)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '加载任务列表失败')
        setJobs([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeNode])

  const activeNodeInfo = nodes.find((n) => n.id === activeNode)

  const scheduleLabel = (job: HermesJobWithInstance): string => {
    if (job.schedule_display) return job.schedule_display
    if (job.schedule?.display) return job.schedule.display
    if (job.schedule) return `${job.schedule.kind}: ${job.schedule.expr}`
    return '手动'
  }

  const stateLabel = (state: string): string => {
    const map: Record<string, string> = {
      idle: '空闲',
      running: '运行中',
      paused: '已暂停',
      error: '异常',
      completed: '已完成',
    }
    return map[state] ?? state
  }

  const stateClass = (state: string): string => {
    if (state === 'running') return 'job-state--running'
    if (state === 'paused') return 'job-state--paused'
    if (state === 'error') return 'job-state--error'
    return ''
  }

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
        className="panel-sheet panel-sheet--jobs"
        style={{ ['--accent' as string]: activeNodeInfo?.accent ?? '#4e8bff' }}
        onClick={(e) => { e.stopPropagation() }}
        onMouseDown={(e) => { setCloseClick(null); e.stopPropagation() }}
      >
        <header className="panel-sheet__header">
          <h2>自动任务</h2>
          <p>各 Hermes 节点的定时任务与 Cron 作业</p>
          <div className="dialog-header-actions">
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
            <div className="panel-hint">正在读取任务列表…</div>
          ) : error ? (
            <div className="panel-hint panel-hint--error">{error}</div>
          ) : jobs.length === 0 ? (
            <div className="panel-empty">
              <span className="panel-empty__icon">⏱️</span>
              <strong>暂无自动任务</strong>
              <p>该节点没有配置定时任务。</p>
            </div>
          ) : (
            <ul className="job-list">
              {jobs.map((job) => (
                <li key={job.id} className="job-item">
                  <div className="job-item__meta">
                    <strong className="job-item__name">{job.name}</strong>
                    {job.prompt ? (
                      <span className="job-item__prompt" title={job.prompt}>
                        {job.prompt.slice(0, 80)}
                        {job.prompt.length > 80 ? '…' : ''}
                      </span>
                    ) : null}
                    <div className="job-item__tags">
                      {job.model ? <span className="job-item__tag">{job.model}</span> : null}
                      {job.profile ? <span className="job-item__tag">{job.profile}</span> : null}
                    </div>
                  </div>
                  <div className="job-item__info">
                    <span className="job-item__schedule">{scheduleLabel(job)}</span>
                    <span className={`job-item__state ${stateClass(job.state)}`}>
                      {job.enabled ? '✅' : '⏸️'} {stateLabel(job.state)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
