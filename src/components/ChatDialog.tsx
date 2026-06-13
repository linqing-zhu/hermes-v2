import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createSession,
  getNodeConn,
  getSessionMessages,
  getSessions,
  streamSessionChat,
  type HermesInstanceId,
  type HermesSessionWithInstance,
} from '../services/hermes'
import type { HermesMessageItem, HermesStreamEvent } from '../types/hermes'

// --- chat message model ---

type ToolCall = {
  id: string
  name: string
  args?: unknown
  preview?: string
  phase: 'pending' | 'calling' | 'progress' | 'complete' | 'error'
  result?: string
  errorMessage?: string
}

type ChatBlock =
  | { kind: 'text'; id: string; role: 'user' | 'assistant' | 'tool'; text: string; streaming?: boolean }
  | { kind: 'thinking'; id: string; text: string }
  | { kind: 'tool'; id: string; tool: ToolCall }
  | { kind: 'approval'; id: string; approvalId: string; action: string; context: string; agentName: string }

function blockId(): string {
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

// --- helpers ---

function normalizeRole(role: string): 'user' | 'assistant' | 'tool' {
  if (role === 'user') return 'user'
  if (role === 'tool') return 'tool'
  return 'assistant'
}

function messageText(message: HermesMessageItem): string {
  const content = message.content?.trim()
  if (content) return content
  if (message.tool_name) return `调用工具：${message.tool_name}`
  if (message.reasoning_content?.trim()) return message.reasoning_content.trim()
  return ''
}

function readDelta(event: HermesStreamEvent): string {
  const data = event.data as Record<string, unknown>
  if (event.type === 'assistant.delta' && typeof data.delta === 'string') return data.delta
  return ''
}

function readFinal(event: HermesStreamEvent): string | null {
  const data = event.data as Record<string, unknown>
  if (event.type === 'assistant.completed' && typeof data.content === 'string') return data.content
  if (event.type === 'run.completed' && Array.isArray(data.messages)) {
    const last = [...(data.messages as Array<{ role?: string; content?: string }>)]
      .reverse()
      .find((item) => item.role === 'assistant' && typeof item.content === 'string')
    if (last?.content) return last.content
  }
  return null
}

function getToolName(data: Record<string, unknown>): string {
  const toolCall = (data.tool_call ?? {}) as Record<string, unknown>
  const tool = (data.tool ?? {}) as Record<string, unknown>
  const fn = (toolCall.function ?? {}) as Record<string, unknown>
  return (
    (typeof toolCall.tool_name === 'string' ? toolCall.tool_name : '') ||
    (typeof data.tool_name === 'string' ? data.tool_name : '') ||
    (typeof fn.name === 'string' ? fn.name : '') ||
    (typeof tool.name === 'string' ? tool.name : '') ||
    (typeof data.name === 'string' ? data.name : '') ||
    'tool'
  )
}

function getToolCallId(data: Record<string, unknown>, runId: string | undefined, name: string): string {
  const toolCall = (data.tool_call ?? {}) as Record<string, unknown>
  const tool = (data.tool ?? {}) as Record<string, unknown>
  return (
    (typeof toolCall.id === 'string' ? toolCall.id : '') ||
    (typeof tool.id === 'string' ? tool.id : '') ||
    (typeof data.tool_call_id === 'string' ? data.tool_call_id : '') ||
    (typeof data.call_id === 'string' ? data.call_id : '') ||
    (typeof data.id === 'string' ? data.id : '') ||
    `${runId ?? 'run'}:${name}`
  )
}

function parseJsonIfPossible(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return value
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return JSON.parse(trimmed) } catch { return value }
  }
  return value
}

function getToolArgs(data: Record<string, unknown>): unknown {
  const toolCall = (data.tool_call ?? {}) as Record<string, unknown>
  const fn = (toolCall.function ?? {}) as Record<string, unknown>
  return parseJsonIfPossible(toolCall.arguments ?? fn.arguments ?? data.args)
}

function getToolResultPreview(data: Record<string, unknown>): string {
  const raw = data.result_preview ?? data.result ?? data.output ?? data.message
  if (typeof raw === 'string') return raw
  if (raw === undefined || raw === null) return ''
  try { return JSON.stringify(raw, null, 2) } catch { return String(raw) }
}

function getErrorMessage(data: Record<string, unknown>): string {
  const err = data.error as Record<string, unknown> | undefined
  return (typeof err?.message === 'string' ? err.message : '') ||
    (typeof data.message === 'string' ? data.message : '') ||
    '未知错误'
}

// --- component ---

export function ChatDialog({
  instanceId,
  initialSessionId,
  onClose,
}: {
  instanceId: HermesInstanceId
  initialSessionId?: string | null
  onClose: () => void
}) {
  const instance = getNodeConn(instanceId)
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null)
  const [blocks, setBlocks] = useState<ChatBlock[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(Boolean(initialSessionId))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const logRef = useRef<HTMLDivElement | null>(null)

  // Session list for switching
  const [sessions, setSessions] = useState<HermesSessionWithInstance[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [showSessionList, setShowSessionList] = useState(false)
  const currentSession = useMemo(
    () => sessions.find((s) => s.id === sessionId) ?? null,
    [sessions, sessionId],
  )

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = logRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [])

  // Load session list on open.
  useEffect(() => {
    let cancelled = false
    setSessionsLoading(true)
    getSessions(instanceId)
      .then((data) => {
        if (cancelled) return
        setSessions(data.sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0)))
      })
      .catch(() => {
        if (!cancelled) setSessions([])
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false)
      })
    return () => { cancelled = true }
  }, [instanceId])

  // Load history for the chosen session.
  useEffect(() => {
    if (!sessionId) {
      setBlocks([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    getSessionMessages(instanceId, sessionId)
      .then((items) => {
        if (cancelled) return
        setBlocks(
          items
            .map((item) => ({
              kind: 'text' as const,
              id: String(item.id),
              role: normalizeRole(item.role),
              text: messageText(item),
            }))
            .filter((b) => b.text),
        )
        scrollToBottom()
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载历史消息失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [instanceId, sessionId, scrollToBottom])

  // --- send handler with full SSE event processing ---

  const handleSend = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setError('')
    setDraft('')

    const userBlock: ChatBlock = { kind: 'text', id: blockId(), role: 'user', text }
    const assistantBlockId = blockId()
    setBlocks((cur) => [...cur, userBlock, { kind: 'text', id: assistantBlockId, role: 'assistant', text: '', streaming: true }])
    scrollToBottom()

    try {
      let activeSessionId = sessionId
      if (!activeSessionId) {
        const session = await createSession(instanceId)
        activeSessionId = session.id
        setSessionId(session.id)
        getSessions(instanceId).then((data) =>
          setSessions(data.sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0))),
        ).catch(() => {})
      }

      let buffer = ''
      let final: string | null = null
      let runId: string | undefined
      const toolBlocks: Map<string, ChatBlock> = new Map() // toolCallId → ChatBlock
      const thinkingBlocks: Map<string, ChatBlock> = new Map() // toolCallId → ChatBlock

      const applyBlocks = (fn: (cur: ChatBlock[]) => ChatBlock[]) => {
        setBlocks(fn)
      }

      await streamSessionChat(instanceId, activeSessionId, text, {
        onEvent: (event) => {
          const data = event.data as Record<string, unknown>
          const evtRunId: string | undefined =
            typeof data.run_id === 'string' && data.run_id.trim() ? data.run_id : runId
          if (evtRunId && !runId) runId = evtRunId

          // --- text delta ---
          if (event.type === 'assistant.delta') {
            const delta = readDelta(event)
            if (delta) {
              buffer += delta
              applyBlocks((cur) =>
                cur.map((b) => (b.id === assistantBlockId && b.kind === 'text' ? { ...b, text: buffer } : b)),
              )
              scrollToBottom()
            }
            return
          }

          // --- tool events ---
          const toolEventTypes = ['tool.started', 'tool.pending', 'tool.calling', 'tool.running']
          if (toolEventTypes.includes(event.type)) {
            const toolName = getToolName(data)
            const callId = getToolCallId(data, runId, toolName)
            const phase: ToolCall['phase'] = (event.type === 'tool.pending' || event.type === 'tool.started') ? 'pending' : 'calling'

            // If progress comes for _thinking, route to thinking block
            if (toolName === '_thinking' || toolName === 'think') {
              if (!thinkingBlocks.has(callId)) {
                const tb: ChatBlock = { kind: 'thinking', id: blockId(), text: '' }
                thinkingBlocks.set(callId, tb)
                applyBlocks((cur) => [...cur, tb!])
              }
              return
            }

            if (!toolBlocks.has(callId)) {
              const tb: ChatBlock = {
                kind: 'tool',
                id: blockId(),
                tool: {
                  id: callId,
                  name: toolName,
                  args: getToolArgs(data),
                  preview: typeof data.preview === 'string' ? data.preview : undefined,
                  phase,
                },
              }
              toolBlocks.set(callId, tb)
              applyBlocks((cur) => [...cur, tb!])
              scrollToBottom()
            } else {
              const existing = toolBlocks.get(callId)!
              applyBlocks((cur) =>
                cur.map((b) =>
                  b.id === existing.id && b.kind === 'tool'
                    ? { ...b, tool: { ...b.tool, phase, args: b.tool.args ?? getToolArgs(data) } }
                    : b,
                ),
              )
            }
            return
          }

          // --- tool progress ---
          if (event.type === 'tool.progress') {
            const delta = typeof data.delta === 'string' ? data.delta : ''
            if (!delta) return
            const toolName = getToolName(data)
            const callId = getToolCallId(data, runId, toolName)

            if (toolName === '_thinking' || toolName === 'think') {
              let tb = thinkingBlocks.get(callId)
              if (!tb) {
                tb = { kind: 'thinking', id: blockId(), text: delta }
                thinkingBlocks.set(callId, tb)
                applyBlocks((cur) => [...cur, tb!])
              } else {
                const tid = tb.id
                applyBlocks((cur) =>
                  cur.map((b) => (b.id === tid && b.kind === 'thinking' ? { ...b, text: b.text + delta } : b)),
                )
              }
              scrollToBottom()
              return
            }

            let tb = toolBlocks.get(callId)
            if (!tb) {
              tb = {
                kind: 'tool',
                id: blockId(),
                tool: { id: callId, name: toolName, phase: 'calling', args: getToolArgs(data) },
              }
              toolBlocks.set(callId, tb)
              applyBlocks((cur) => [...cur, tb!])
            }
            const tid = tb.id
            applyBlocks((cur) =>
              cur.map((b) =>
                b.id === tid && b.kind === 'tool'
                  ? { ...b, tool: { ...b.tool, phase: 'progress', result: (b.tool.result ?? '') + delta } }
                  : b,
              ),
            )
            scrollToBottom()
            return
          }

          // --- tool completed ---
          if (event.type === 'tool.completed') {
            const toolName = getToolName(data)
            const callId = getToolCallId(data, runId, toolName)
            const result = getToolResultPreview(data)

            if (toolName === '_thinking' || toolName === 'think') {
              if (result) {
                const tb = thinkingBlocks.get(callId)
                if (tb) {
                  applyBlocks((cur) =>
                    cur.map((b) => (b.id === tb!.id && b.kind === 'thinking' ? { ...b, text: result } : b)),
                  )
                }
              }
              return
            }

            let tb = toolBlocks.get(callId)
            if (!tb) {
              tb = {
                kind: 'tool',
                id: blockId(),
                tool: { id: callId, name: toolName, phase: 'complete', args: getToolArgs(data), result: result.slice(0, 4000) },
              }
              toolBlocks.set(callId, tb)
              applyBlocks((cur) => [...cur, tb!])
            } else {
              const tid = tb.id
              applyBlocks((cur) =>
                cur.map((b) =>
                  b.id === tid && b.kind === 'tool'
                    ? { ...b, tool: { ...b.tool, phase: 'complete' as const, result: result.slice(0, 4000) } }
                    : b,
                ),
              )
            }
            scrollToBottom()
            return
          }

          // --- tool failed ---
          if (event.type === 'tool.failed') {
            const toolName = getToolName(data)
            const callId = getToolCallId(data, runId, toolName)
            const errMsg = getErrorMessage(data)
            let tb = toolBlocks.get(callId)
            if (!tb) {
              tb = {
                kind: 'tool',
                id: blockId(),
                tool: { id: callId, name: toolName, phase: 'error', errorMessage: errMsg },
              }
              toolBlocks.set(callId, tb)
              applyBlocks((cur) => [...cur, tb!])
            } else {
              const tid = tb.id
              applyBlocks((cur) =>
                cur.map((b) =>
                  b.id === tid && b.kind === 'tool'
                    ? { ...b, tool: { ...b.tool, phase: 'error' as const, errorMessage: errMsg } }
                    : b,
                ),
              )
            }
            scrollToBottom()
            return
          }

          // --- artifacts / memory / skills (all rendered as tool cards) ---
          if (event.type === 'artifact.created') {
            const artifact = (data.artifact ?? {}) as Record<string, unknown>
            const result =
              (typeof artifact.title === 'string' ? artifact.title : '') ||
              (typeof artifact.path === 'string' ? artifact.path : '') ||
              (typeof data.path === 'string' ? data.path : '') ||
              'Artifact created'
            const toolName = (typeof data.tool_name === 'string' ? data.tool_name : '') || 'artifact'
            applyBlocks((cur) => [
              ...cur,
              {
                kind: 'tool',
                id: blockId(),
                tool: { id: blockId(), name: toolName, phase: 'complete' as const, result },
              },
            ])
            scrollToBottom()
            return
          }

          if (event.type === 'memory.updated') {
            const result = (typeof data.message === 'string' ? data.message : '') ||
              `Updated ${typeof data.target === 'string' ? data.target : 'memory'}`
            applyBlocks((cur) => [
              ...cur,
              { kind: 'tool', id: blockId(), tool: { id: blockId(), name: 'memory', phase: 'complete' as const, result } },
            ])
            scrollToBottom()
            return
          }

          if (event.type === 'skill.loaded') {
            const skill = (data.skill ?? {}) as Record<string, unknown>
            const result = (typeof skill.name === 'string' ? skill.name : '') ||
              (typeof data.skill_name === 'string' ? data.skill_name : '') ||
              'Skill loaded'
            applyBlocks((cur) => [
              ...cur,
              { kind: 'tool', id: blockId(), tool: { id: blockId(), name: 'skill', phase: 'complete' as const, result } },
            ])
            scrollToBottom()
            return
          }

          // --- approval ---
          if (event.type === 'approval.required' || event.type === 'tool.approval' || event.type === 'exec.approval') {
            const approvalId =
              (typeof data.approval_id === 'string' ? data.approval_id : '') ||
              (typeof data.approvalId === 'string' ? data.approvalId : '') ||
              (typeof data.id === 'string' ? data.id : '') ||
              blockId()
            applyBlocks((cur) => [
              ...cur,
              {
                kind: 'approval',
                id: blockId(),
                approvalId,
                action:
                  (typeof data.command === 'string' ? data.command : '') ||
                  (typeof data.action === 'string' ? data.action : '') ||
                  (typeof data.tool === 'string' ? data.tool : '') ||
                  '危险命令需要审批',
                context:
                  (typeof data.description === 'string' ? data.description : '') ||
                  (typeof data.context === 'string' ? data.context : '') ||
                  (typeof data.input === 'string' ? data.input : '') ||
                  '',
                agentName:
                  (typeof data.agent_name === 'string' ? data.agent_name : '') ||
                  (typeof data.agent_id === 'string' ? data.agent_id : '') ||
                  'Agent',
              },
            ])
            scrollToBottom()
            return
          }

          // --- assistant completed ---
          if (event.type === 'assistant.completed') {
            const content = readFinal(event)
            if (content && content !== buffer) {
              buffer = content
              applyBlocks((cur) =>
                cur.map((b) => (b.id === assistantBlockId && b.kind === 'text' ? { ...b, text: buffer, streaming: false } : b)),
              )
              scrollToBottom()
            }
            return
          }

          // --- run completed ---
          if (event.type === 'run.completed') {
            const content = readFinal(event)
            if (content) final = content
            return
          }

          // --- error ---
          if (event.type === 'error') {
            const errMsg = getErrorMessage(data)
            setError(errMsg)
            return
          }
        },
      })

      // Finalize the assistant text block
      const output = (final ?? buffer).trim() || '（没有返回文本内容）'
      setBlocks((cur) =>
        cur.map((b) =>
          b.id === assistantBlockId && b.kind === 'text' ? { ...b, text: output, streaming: false } : b,
        ),
      )
      scrollToBottom()
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败')
      setBlocks((cur) =>
        cur.map((b) =>
          b.id === assistantBlockId && b.kind === 'text'
            ? { ...b, text: b.text || '（发送失败）', streaming: false }
            : b,
        ),
      )
    } finally {
      setSending(false)
    }
  }

  const switchSession = (sid: string) => {
    setSessionId(sid)
    setShowSessionList(false)
  }

  const handleNewSession = async () => {
    setSessionId(null)
    setBlocks([])
    setShowSessionList(false)
    setError('')
  }

  // --- render ---

  const dialogRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ startX: number; startY: number; left: number; top: number } | null>(null)

  const onHeaderMouseDown = (e: React.MouseEvent) => {
    const el = dialogRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragState.current = { startX: e.clientX, startY: e.clientY, left: rect.left, top: rect.top }
    el.style.transition = 'none'
    document.addEventListener('mousemove', onDragMove)
    document.addEventListener('mouseup', onDragUp)
    e.preventDefault()
  }

  const onDragMove = (e: MouseEvent) => {
    const ds = dragState.current
    if (!ds) return
    const el = dialogRef.current
    if (!el) return
    const dx = e.clientX - ds.startX
    const dy = e.clientY - ds.startY
    el.style.transform = `translate(${dx}px, ${dy}px)`
  }

  const onDragUp = () => {
    document.removeEventListener('mousemove', onDragMove)
    document.removeEventListener('mouseup', onDragUp)
    dragState.current = null
  }

  const [closeClick, setCloseClick] = useState<{ x: number; y: number } | null>(null)

  return (
    <div
      className="chat-dialog__backdrop"
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
      <div className="chat-dialog" ref={dialogRef} onClick={(e) => { e.stopPropagation() }} onMouseDown={(e) => { setCloseClick(null); e.stopPropagation() }}>
        <header className="chat-dialog__header" onMouseDown={onHeaderMouseDown} style={{ cursor: 'move', userSelect: 'none' }}>
          <div>
            <h2>
              {currentSession
                ? (currentSession.title || currentSession.preview || '(无标题)')
                : instance?.name ?? instanceId}
            </h2>
            <p>
              {instance?.system} · {instance?.host}
              {sessionId
                ? ` · ${currentSession?.model || '未知模型'}`
                : ' · 新会话'}
            </p>
          </div>
          <div className="chat-dialog__header-actions">
            <button
              type="button"
              className="chat-dialog__sessions-btn"
              onClick={() => setShowSessionList((v) => !v)}
              title="切换会话"
            >
              💬
            </button>
            <button type="button" className="chat-dialog__close" onClick={onClose}>
              ×
            </button>
          </div>
        </header>

        {/* Session picker dropdown */}
        {showSessionList ? (
          <div className="chat-dialog__session-picker">
            <button
              type="button"
              className="chat-dialog__new-session-btn"
              onClick={() => void handleNewSession()}
            >
              ＋ 新建会话
            </button>
            {sessionsLoading ? (
              <div className="chat-dialog__hint">加载会话列表…</div>
            ) : sessions.length === 0 ? (
              <div className="chat-dialog__hint">暂无历史会话</div>
            ) : (
              <ul className="chat-dialog__session-list">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`chat-dialog__session-item ${s.id === sessionId ? 'is-active' : ''}`}
                      onClick={() => switchSession(s.id)}
                    >
                      <span className="chat-dialog__session-title">
                        {s.title || s.preview || '(无标题)'}
                      </span>
                      <span className="chat-dialog__session-meta">
                        {s.model ? `${s.model}` : ''}
                        {s.message_count ? ` · ${s.message_count} 条消息` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        <div className="chat-dialog__log" ref={logRef}>
          {loading ? (
            <div className="chat-dialog__hint">正在加载历史消息…</div>
          ) : blocks.length ? (
            blocks.map((block) => {
              if (block.kind === 'tool') {
                const t = block.tool
                const phaseIcon =
                  t.phase === 'error' ? '❌' :
                  t.phase === 'complete' ? '✅' :
                  t.phase === 'progress' || t.phase === 'calling' ? '⚙' :
                  '⏳'
                const phaseLabel =
                  t.phase === 'pending' ? '准备中' :
                  t.phase === 'calling' ? '调用中' :
                  t.phase === 'progress' ? '执行中' :
                  t.phase === 'complete' ? '已完成' :
                  t.phase === 'error' ? '失败' : '…'
                const isRunning = t.phase !== 'complete' && t.phase !== 'error'
                return (
                  <div key={block.id} className={`chat-tool ${isRunning ? 'is-running' : ''} ${t.phase === 'error' ? 'is-error' : ''}`}>
                    <div className="chat-tool__head">
                      <span className="chat-tool__icon">{phaseIcon}</span>
                      <strong className="chat-tool__name">{t.name}</strong>
                      <span className="chat-tool__phase">{phaseLabel}</span>
                    </div>
                    {t.args != null ? (
                      <pre className="chat-tool__args">
                        {typeof t.args === 'string' ? t.args : JSON.stringify(t.args, null, 2)}
                      </pre>
                    ) : null}
                    {t.preview ? (
                      <p className="chat-tool__preview">{t.preview}</p>
                    ) : null}
                    {t.result ? (
                      <pre className="chat-tool__result">{t.result}</pre>
                    ) : null}
                    {t.errorMessage ? (
                      <p className="chat-tool__error">{t.errorMessage}</p>
                    ) : null}
                  </div>
                )
              }

              if (block.kind === 'thinking') {
                return (
                  <div key={block.id} className="chat-thinking">
                    <span className="chat-thinking__label">💭 思考中</span>
                    <p className="chat-thinking__text">{block.text}</p>
                  </div>
                )
              }

              if (block.kind === 'approval') {
                return (
                  <div key={block.id} className="chat-approval">
                    <div className="chat-approval__head">
                      <span className="chat-approval__icon">⚠️</span>
                      <strong>{block.agentName} 需要审批</strong>
                    </div>
                    <p className="chat-approval__action">{block.action}</p>
                    {block.context ? (
                      <pre className="chat-approval__context">{block.context}</pre>
                    ) : null}
                    <p className="chat-approval__hint">
                      请在 Hermes 终端中回复审批请求（approve/reject）
                    </p>
                  </div>
                )
              }

              // text block
              return (
                <div key={block.id} className={`chat-bubble chat-bubble--${block.role}`}>
                  <span className="chat-bubble__role">
                    {block.role === 'user' ? '你' : block.role === 'tool' ? '工具' : instance?.name}
                  </span>
                  <p>
                    {block.text}
                    {block.streaming ? <span className="chat-bubble__caret" /> : null}
                  </p>
                </div>
              )
            })
          ) : (
            <div className="chat-dialog__hint">
              {sessionId ? '该会话暂无消息。' : '开始一段新对话 — 输入消息并按 Enter 发送。'}
            </div>
          )}
        </div>

        {error ? <p className="chat-dialog__error">{error}</p> : null}

        <div className="chat-dialog__composer">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleSend()
              }
            }}
            placeholder={sessionId ? `继续对话…（Enter 发送）` : `和 ${instance?.name ?? 'Hermes'} 说点什么…（Enter 发送）`}
            rows={2}
            disabled={sending}
          />
          <button
            type="button"
            className="chat-dialog__send"
            onClick={() => void handleSend()}
            disabled={sending || !draft.trim()}
          >
            {sending ? '发送中…' : '发送'}
          </button>
        </div>
      </div>
    </div>
  )
}
