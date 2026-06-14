import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
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
  | {
      kind: 'text'
      id: string
      role: 'user' | 'assistant' | 'tool'
      text: string
      streaming?: boolean
      thinking?: string
      tools?: ToolCall[]
      images?: string[]
    }
  | { kind: 'approval'; id: string; approvalId: string; action: string; context: string; agentName: string }

type TextBlock = Extract<ChatBlock, { kind: 'text' }>

function blockId(): string {
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function normalizeRole(role: string): 'user' | 'assistant' | 'tool' {
  const normalized = role.trim().toLowerCase()
  if (['user', 'human', 'local', 'client', 'owner', 'me'].includes(normalized)) return 'user'
  if (['tool', 'function', 'tool_result', 'toolresult'].includes(normalized)) return 'tool'
  return 'assistant'
}

function messageText(message: HermesMessageItem): string {
  const content = message.content?.trim()
  if (content) return content
  if (message.tool_name) return `调用工具：${message.tool_name}`
  return ''
}

function messageThinking(message: HermesMessageItem): string {
  return message.reasoning_content?.trim() || message.reasoning?.trim() || ''
}

function historyToolFromMessage(message: HermesMessageItem): ToolCall {
  const content = message.content?.trim()
  let parsed: Record<string, unknown> = {}
  if (content) {
    try {
      parsed = JSON.parse(content) as Record<string, unknown>
    } catch {
      parsed = {}
    }
  }
  const command = typeof parsed.command === 'string' ? parsed.command : ''
  const output = typeof parsed.output === 'string' ? parsed.output : ''
  const status = typeof parsed.status === 'string' ? parsed.status : ''
  const toolName =
    message.tool_name?.trim() ||
    (typeof parsed.tool_name === 'string' ? parsed.tool_name : '') ||
    (command ? 'terminal' : 'tool')
  const result = output || content || status
  return {
    id: String(message.tool_call_id || message.id),
    name: toolName,
    phase: status === 'error' ? 'error' : 'complete',
    preview: command ? command.slice(0, 120) : undefined,
    result: result ? result.slice(0, 4000) : undefined,
  }
}

function readFinal(event: HermesStreamEvent): string | null {
  const data = event.data as Record<string, unknown>
  if (event.type === 'assistant.completed' && typeof data.content === 'string') return data.content
  if (event.type === 'run.completed' && Array.isArray(data.messages)) {
    const last = [...(data.messages as Array<{ role?: string; content?: string }>)]
      .reverse()
      .find((item) => item.role === 'assistant' && typeof item.content === 'string')
    return last?.content || null
  }
  return null
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function getToolName(data: Record<string, unknown>): string {
  const toolCall = readRecord(data.tool_call)
  const tool = readRecord(data.tool)
  const fn = readRecord(toolCall.function)
  return (
    (typeof toolCall.tool_name === 'string' ? toolCall.tool_name : '') ||
    (typeof toolCall.name === 'string' ? toolCall.name : '') ||
    (typeof data.tool_name === 'string' ? data.tool_name : '') ||
    (typeof fn.name === 'string' ? fn.name : '') ||
    (typeof tool.name === 'string' ? tool.name : '') ||
    (typeof data.name === 'string' ? data.name : '') ||
    'tool'
  )
}

function getToolCallId(data: Record<string, unknown>, runId: string | undefined, name: string): string {
  const toolCall = readRecord(data.tool_call)
  const tool = readRecord(data.tool)
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
    try {
      return JSON.parse(trimmed)
    } catch {
      return value
    }
  }
  return value
}

function getToolArgs(data: Record<string, unknown>): unknown {
  const toolCall = readRecord(data.tool_call)
  const fn = readRecord(toolCall.function)
  return parseJsonIfPossible(toolCall.arguments ?? fn.arguments ?? data.args)
}

function getToolResultPreview(data: Record<string, unknown>): string {
  const raw = data.result_preview ?? data.result ?? data.output ?? data.message
  if (typeof raw === 'string') return raw
  if (raw === undefined || raw === null) return ''
  try {
    return JSON.stringify(raw, null, 2)
  } catch {
    return String(raw)
  }
}

function getErrorMessage(data: Record<string, unknown>): string {
  const err = readRecord(data.error)
  return (typeof err.message === 'string' ? err.message : '') ||
    (typeof data.message === 'string' ? data.message : '') ||
    '未知错误'
}

function isSkillEvent(eventType: string, toolName: string, data: Record<string, unknown>): boolean {
  const skill = readRecord(data.skill)
  return (
    eventType.includes('skill') ||
    toolName.toLowerCase().includes('skill') ||
    typeof data.skill_name === 'string' ||
    typeof skill.name === 'string'
  )
}

function getSkillDetail(data: Record<string, unknown>, fallbackName = 'skill') {
  const skill = readRecord(data.skill)
  const name =
    (typeof skill.name === 'string' ? skill.name : '') ||
    (typeof data.skill_name === 'string' ? data.skill_name : '') ||
    (typeof data.name === 'string' ? data.name : '') ||
    fallbackName
  const detail: Record<string, unknown> = { name }
  for (const key of ['description', 'category', 'path', 'version']) {
    if (typeof skill[key] === 'string' && skill[key]) detail[key] = skill[key]
  }
  return {
    name,
    result: Object.keys(detail).length > 1 ? JSON.stringify(detail, null, 2) : `Loaded skill: ${name}`,
  }
}

function isThinkingTool(name: string): boolean {
  return name === '_thinking' || name === 'think' || name === 'thinking'
}

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
  const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({})
  const logRef = useRef<HTMLDivElement | null>(null)
  const skipHistoryLoadRef = useRef<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const dragState = useRef<{ startX: number; startY: number; left: number; top: number } | null>(null)
  const [closeClick, setCloseClick] = useState<{ x: number; y: number } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const [sessions, setSessions] = useState<HermesSessionWithInstance[]>([])
  const currentSession = useMemo(
    () => sessions.find((s) => s.id === sessionId) ?? null,
    [sessions, sessionId],
  )

  const scrollToBottom = useCallback(() => {
    if (scrollFrameRef.current !== null) return
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      const el = logRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [])

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    getSessions(instanceId)
      .then((data) => {
        if (!cancelled) setSessions(data.sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0)))
      })
      .catch(() => {
        if (!cancelled) setSessions([])
      })
    return () => { cancelled = true }
  }, [instanceId])

  useEffect(() => {
    if (!sessionId) {
      setBlocks([])
      setLoading(false)
      return
    }
    if (skipHistoryLoadRef.current === sessionId) {
      skipHistoryLoadRef.current = null
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
            .map((item) => {
              const role = normalizeRole(item.role)
              if (role === 'tool') {
                return {
                  kind: 'text' as const,
                  id: String(item.id),
                  role: 'assistant' as const,
                  text: '',
                  tools: [historyToolFromMessage(item)],
                }
              }
              return {
                kind: 'text' as const,
                id: String(item.id),
                role,
                text: messageText(item),
                thinking: role === 'assistant' ? messageThinking(item) : undefined,
              }
            })
            .filter((b) => b.text || b.thinking || (b.tools?.length ?? 0) > 0),
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

  const handleSend = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setError('')
    setDraft('')
    requestAnimationFrame(() => inputRef.current?.focus())

    const userBlock: ChatBlock = { kind: 'text', id: blockId(), role: 'user', text }
    const assistantBlockId = blockId()
    const assistantBlock: ChatBlock = {
      kind: 'text',
      id: assistantBlockId,
      role: 'assistant',
      text: '',
      streaming: true,
      thinking: '',
      tools: [],
    }
    setBlocks((cur) => [...cur, userBlock, assistantBlock])
    scrollToBottom()

    const updateAssistant = (fn: (block: TextBlock) => TextBlock) => {
      setBlocks((cur) =>
        cur.map((b) => {
          if (b.kind !== 'text' || b.id !== assistantBlockId || b.role !== 'assistant') return b
          return fn(b)
        }),
      )
    }

    const upsertTool = (tool: ToolCall, options?: { appendResult?: boolean }) => {
      updateAssistant((b) => {
        const tools = [...(b.tools ?? [])]
        const index = tools.findIndex((item) => item.id === tool.id)
        if (index >= 0) {
          const previous = tools[index]
          tools[index] = {
            ...previous,
            ...tool,
            args: tool.args ?? previous.args,
            preview: tool.preview ?? previous.preview,
            result: options?.appendResult
              ? `${previous.result ?? ''}${tool.result ?? ''}`
              : tool.result ?? previous.result,
            errorMessage: tool.errorMessage ?? previous.errorMessage,
          }
        }
        else tools.push(tool)
        return { ...b, tools }
      })
    }

    try {
      let activeSessionId = sessionId
      if (!activeSessionId) {
        const session = await createSession(instanceId)
        activeSessionId = session.id
        skipHistoryLoadRef.current = session.id
        setSessionId(session.id)
        getSessions(instanceId)
          .then((data) => setSessions(data.sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0))))
          .catch(() => {})
      }

      let buffer = ''
      let final: string | null = null
      let runId: string | undefined
      let pendingText: string | null = null
      let textFrame: number | null = null
      const scheduleAssistantText = (textValue: string) => {
        pendingText = textValue
        if (textFrame !== null) return
        textFrame = requestAnimationFrame(() => {
          textFrame = null
          if (pendingText === null) return
          const nextText = pendingText
          pendingText = null
          updateAssistant((b) => ({ ...b, text: nextText }))
          scrollToBottom()
        })
      }
      const flushAssistantText = () => {
        if (textFrame !== null) {
          cancelAnimationFrame(textFrame)
          textFrame = null
        }
        if (pendingText === null) return
        const nextText = pendingText
        pendingText = null
        updateAssistant((b) => ({ ...b, text: nextText }))
      }

      await streamSessionChat(instanceId, activeSessionId, text, {
        onEvent: (event) => {
          const data = event.data as Record<string, unknown>
          const evtRunId = typeof data.run_id === 'string' && data.run_id.trim() ? data.run_id : runId
          if (evtRunId && !runId) runId = evtRunId

          if (event.type === 'assistant.delta') {
            const delta = typeof data.delta === 'string' ? data.delta : ''
            if (!delta) return
            buffer += delta
            scheduleAssistantText(buffer)
            return
          }

          if (['tool.started', 'tool.pending', 'tool.calling', 'tool.running'].includes(event.type)) {
            const rawToolName = getToolName(data)
            const callId = getToolCallId(data, runId, rawToolName)
            const phase: ToolCall['phase'] = event.type === 'tool.pending' || event.type === 'tool.started' ? 'pending' : 'calling'
            const skillInfo = isSkillEvent(event.type, rawToolName, data) ? getSkillDetail(data, rawToolName) : null
            if (isThinkingTool(rawToolName)) {
              updateAssistant((b) => ({ ...b, thinking: b.thinking || '' }))
              return
            }
            upsertTool({
              id: callId,
              name: skillInfo ? 'skill' : rawToolName,
              args: getToolArgs(data),
              preview: skillInfo?.name ?? (typeof data.preview === 'string' ? data.preview : undefined),
              phase,
            })
            scrollToBottom()
            return
          }

          if (event.type === 'tool.progress') {
            const delta = typeof data.delta === 'string' ? data.delta : ''
            if (!delta) return
            const rawToolName = getToolName(data)
            const callId = getToolCallId(data, runId, rawToolName)
            if (isThinkingTool(rawToolName)) {
              updateAssistant((b) => ({ ...b, thinking: `${b.thinking ?? ''}${delta}` }))
              scrollToBottom()
              return
            }
            const skillInfo = isSkillEvent(event.type, rawToolName, data) ? getSkillDetail(data, rawToolName) : null
            upsertTool({
              id: callId,
              name: skillInfo ? 'skill' : rawToolName,
              args: getToolArgs(data),
              preview: skillInfo?.name,
              phase: 'progress',
              result: delta,
            }, { appendResult: true })
            scrollToBottom()
            return
          }

          if (event.type === 'tool.completed') {
            const rawToolName = getToolName(data)
            const callId = getToolCallId(data, runId, rawToolName)
            const result = getToolResultPreview(data)
            if (isThinkingTool(rawToolName)) {
              if (result) updateAssistant((b) => ({ ...b, thinking: result }))
              return
            }
            const skillInfo = isSkillEvent(event.type, rawToolName, data) ? getSkillDetail(data, rawToolName) : null
            upsertTool({
              id: callId,
              name: skillInfo ? 'skill' : rawToolName,
              args: getToolArgs(data),
              preview: skillInfo?.name,
              phase: 'complete',
              result: (skillInfo?.result ?? result).slice(0, 4000),
            })
            scrollToBottom()
            return
          }

          if (event.type === 'tool.failed') {
            const rawToolName = getToolName(data)
            const callId = getToolCallId(data, runId, rawToolName)
            upsertTool({
              id: callId,
              name: rawToolName,
              phase: 'error',
              errorMessage: getErrorMessage(data),
            })
            scrollToBottom()
            return
          }

          if (event.type === 'skill.loaded') {
            const skillInfo = getSkillDetail(data, 'Skill loaded')
            upsertTool({
              id: (typeof data.tool_call_id === 'string' && data.tool_call_id) || blockId(),
              name: 'skill',
              phase: 'complete',
              preview: skillInfo.name,
              result: skillInfo.result,
            })
            scrollToBottom()
            return
          }

          if (event.type === 'artifact.created' || event.type === 'memory.updated') {
            const artifact = readRecord(data.artifact)
            const result =
              (typeof artifact.title === 'string' ? artifact.title : '') ||
              (typeof artifact.path === 'string' ? artifact.path : '') ||
              (typeof data.path === 'string' ? data.path : '') ||
              (typeof data.message === 'string' ? data.message : '') ||
              (event.type === 'memory.updated' ? 'Memory updated' : 'Artifact created')
            upsertTool({
              id: (typeof data.tool_call_id === 'string' && data.tool_call_id) || blockId(),
              name: event.type === 'memory.updated' ? 'memory' : (typeof data.tool_name === 'string' ? data.tool_name : 'artifact'),
              phase: 'complete',
              result,
            })
            scrollToBottom()
            return
          }

          if (event.type === 'approval.required' || event.type === 'tool.approval' || event.type === 'exec.approval') {
            const approvalId =
              (typeof data.approval_id === 'string' ? data.approval_id : '') ||
              (typeof data.approvalId === 'string' ? data.approvalId : '') ||
              (typeof data.id === 'string' ? data.id : '') ||
              blockId()
            setBlocks((cur) => {
              const approvalBlock: ChatBlock = {
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
              }
              const assistantIndex = cur.findIndex((b) => b.kind === 'text' && b.id === assistantBlockId)
              if (assistantIndex < 0) return [...cur, approvalBlock]
              return [
                ...cur.slice(0, assistantIndex),
                approvalBlock,
                ...cur.slice(assistantIndex),
              ]
            })
            scrollToBottom()
            return
          }

          if (event.type === 'assistant.completed') {
            const content = readFinal(event)
            if (!content) return
            flushAssistantText()
            buffer = content
            updateAssistant((b) => ({ ...b, text: buffer, streaming: false }))
            scrollToBottom()
            return
          }

          if (event.type === 'run.completed') {
            const content = readFinal(event)
            if (content) final = content
            return
          }

          if (event.type === 'error') {
            setError(getErrorMessage(data))
          }
        },
      })

      const output = (final ?? buffer).trim() || '（没有返回文本内容）'
      flushAssistantText()
      updateAssistant((b) => ({ ...b, text: output, streaming: false }))
      scrollToBottom()
    } catch (err) {
      // If a stream fails between animation frames, keep whatever was already buffered.
      setError(err instanceof Error ? err.message : '发送失败')
      updateAssistant((b) => ({ ...b, text: b.text || '（发送失败）', streaming: false }))
    } finally {
      setSending(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  const onHeaderMouseDown = (e: ReactMouseEvent) => {
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
    const el = dialogRef.current
    if (!ds || !el) return
    el.style.transform = `translate(${e.clientX - ds.startX}px, ${e.clientY - ds.startY}px)`
  }

  const onDragUp = () => {
    document.removeEventListener('mousemove', onDragMove)
    document.removeEventListener('mouseup', onDragUp)
    dragState.current = null
  }

  const renderTool = (tool: ToolCall) => {
    const phaseLabel =
      tool.phase === 'pending' ? '准备中' :
      tool.phase === 'calling' ? '调用中' :
      tool.phase === 'progress' ? '执行中' :
      tool.phase === 'complete' ? '已完成' :
      tool.phase === 'error' ? '失败' : '...'
    const isRunning = tool.phase !== 'complete' && tool.phase !== 'error'
    const isExpanded = expandedBlocks[tool.id] ?? false
    const hasDetails = tool.args != null || Boolean(tool.preview || tool.result || tool.errorMessage)
    const displayName = tool.name === 'skill' ? `view skill${tool.preview ? `: ${tool.preview}` : ''}` : tool.name
    return (
      <div key={tool.id} className={`chat-tool ${isRunning ? 'is-running' : ''} ${tool.phase === 'error' ? 'is-error' : ''}`}>
        <button
          type="button"
          className="chat-tool__head"
          onClick={() => setExpandedBlocks((current) => ({ ...current, [tool.id]: !isExpanded }))}
        >
          <span className="chat-tool__icon">{tool.phase === 'error' ? '!' : tool.phase === 'complete' ? '✓' : '⚡'}</span>
          <strong className="chat-tool__name">{displayName}</strong>
          <span className="chat-tool__phase">{phaseLabel}</span>
          <span className="chat-tool__chevron">{isExpanded ? '⌃' : '›'}</span>
        </button>
        {isExpanded && tool.args != null ? (
          <pre className="chat-tool__args">{typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2)}</pre>
        ) : null}
        {isExpanded && tool.preview ? <p className="chat-tool__preview">{tool.preview}</p> : null}
        {isExpanded && tool.result ? <pre className="chat-tool__result">{tool.result}</pre> : null}
        {isExpanded && tool.errorMessage ? <p className="chat-tool__error">{tool.errorMessage}</p> : null}
        {isExpanded && !hasDetails ? <p className="chat-tool__empty">No detail available for this tool call</p> : null}
      </div>
    )
  }

  const renderThinking = (id: string, thinking: string, streaming?: boolean, hasAnswer?: boolean) => {
    if (!streaming || hasAnswer) return null
    const isExpanded = expandedBlocks[`${id}:thinking`] ?? false
    return (
      <div className={`chat-thinking ${isExpanded ? 'is-expanded' : ''}`}>
        <button
          type="button"
          className="chat-thinking__head"
          onClick={() => setExpandedBlocks((current) => ({ ...current, [`${id}:thinking`]: !isExpanded }))}
        >
          <span className="chat-thinking__dots" aria-hidden="true"><i /><i /><i /></span>
          <strong>Thinking<span className="chat-thinking__trail">......</span></strong>
          <span className="chat-thinking__chevron">{isExpanded ? '⌃' : '›'}</span>
        </button>
        {isExpanded ? <p className="chat-thinking__text">{thinking || 'No detail available yet.'}</p> : null}
      </div>
    )
  }

  return (
    <div
      className="chat-dialog__backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setCloseClick({ x: e.clientX, y: e.clientY })
      }}
      onMouseUp={(e) => {
        if (closeClick && Math.abs(e.clientX - closeClick.x) < 8 && Math.abs(e.clientY - closeClick.y) < 8) onClose()
        setCloseClick(null)
      }}
    >
      <div className="chat-dialog" ref={dialogRef} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => { setCloseClick(null); e.stopPropagation() }}>
        <header className="chat-dialog__header" onMouseDown={onHeaderMouseDown} style={{ cursor: 'move', userSelect: 'none' }}>
          <div>
            <h2>{currentSession ? (currentSession.title || currentSession.preview || '(无标题)') : instance?.name ?? instanceId}</h2>
            <p>
              {instance?.system} · {instance?.host}
              {sessionId ? ` · ${currentSession?.model || '未知模型'}` : ' · 新会话'}
            </p>
          </div>
          <div className="chat-dialog__header-actions">
            <button type="button" className="chat-dialog__close" onClick={onClose}>×</button>
          </div>
        </header>

        <div className="chat-dialog__log" ref={logRef}>
          {loading ? (
            <div className="chat-dialog__hint">正在加载历史消息...</div>
          ) : blocks.length ? (
            blocks.map((block, index) => {
              if (block.kind === 'approval') {
                return (
                  <div key={block.id} className="chat-approval">
                    <div className="chat-approval__head">
                      <span className="chat-approval__icon">⚠</span>
                      <strong>{block.agentName} 需要审批</strong>
                    </div>
                    <p className="chat-approval__action">{block.action}</p>
                    {block.context ? <pre className="chat-approval__context">{block.context}</pre> : null}
                    <p className="chat-approval__hint">请在 Hermes 终端中回复审批请求（approve/reject）。</p>
                  </div>
                )
              }

              if (block.role === 'assistant' && block.streaming && !block.text.trim() && !(block.thinking || block.tools?.length)) {
                return null
              }

              const previous = blocks[index - 1]
              const isHermesSide = block.role === 'assistant' || block.role === 'tool'
              const previousIsHermesSide = previous?.kind === 'text' && (previous.role === 'assistant' || previous.role === 'tool')
              const showRole = !isHermesSide || !previousIsHermesSide
              const roleLabel = block.role === 'user' ? '你' : instance?.name
              const processBlocks = block.role === 'assistant' ? (
                <div className="chat-process-stack">
                  {renderThinking(block.id, block.thinking ?? '', block.streaming, Boolean(block.text.trim()))}
                  {(block.tools ?? []).map(renderTool)}
                </div>
              ) : null
              const shouldShowText = block.text.trim() || block.streaming

              return (
                <div key={block.id} className={`chat-bubble chat-bubble--${block.role} ${isHermesSide ? 'chat-bubble--hermes' : ''} ${!showRole ? 'is-continuation' : ''}`}>
                  {showRole ? <span className="chat-bubble__role">{roleLabel}</span> : null}
                  {processBlocks}
                  {shouldShowText ? (
                    <p>
                      {block.text}
                      {block.streaming ? <span className="chat-bubble__caret" /> : null}
                    </p>
                  ) : null}
                </div>
              )
            })
          ) : (
            <div className="chat-dialog__hint">
              {sessionId ? '该会话暂无消息。' : '开始一段新对话，输入消息并按 Enter 发送。'}
            </div>
          )}
        </div>

        {error ? <p className="chat-dialog__error">{error}</p> : null}

        <div className="chat-dialog__composer">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleSend()
              }
            }}
            placeholder={sessionId ? '继续对话...（Enter 发送）' : `和 ${instance?.name ?? 'Hermes'} 说点什么...（Enter 发送）`}
            rows={2}
            disabled={sending}
          />
          <button
            type="button"
            className="chat-dialog__send"
            onClick={() => void handleSend()}
            disabled={sending || !draft.trim()}
          >
            {sending ? '发送中...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  )
}
