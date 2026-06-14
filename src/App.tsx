import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import './App.css'
import {
  getDashboardData,
  getKanban,
  getOfficeRuntimeConfig,
  getProfiles,
  loadNodes,
  saveNodes,
  setNodeRegistry,
  writeKanban,
  type HermesDashboardData,
  type HermesInstanceId,
  type HermesProfileAgent,
  type HermesProfilesResponse,
  type HermesSessionWithInstance,
  type KanbanCreatePayload,
} from './services/hermes'
import type { AgentStatus } from './types/hermes'
import { NavSidebar, type SidebarAction } from './components/NavSidebar'
import { KanbanRow } from './components/KanbanRow'
import { KanbanCard } from './components/KanbanCard'
import { KanbanTaskCard } from './components/KanbanTaskCard'
import { DonePanel, type DoneItem } from './components/DonePanel'
import { HermesRow } from './components/HermesRow'
import { ConfigPanel } from './components/ConfigPanel'
import { DispatchModal } from './components/DispatchModal'
import { SkillGallery } from './components/SkillGallery'
import { JobList } from './components/JobList'
import { StandingHorse } from './components/office/StandingHorse'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ChatPanel } from './components/ChatPanel'
import { ChatDialog } from './components/ChatDialog'
import {
  NODE_ACCENTS,
  boardColumns,
  doneColumn,
  type HermesNode,
  type KanbanCardData,
  type LinkState,
  type NodeLinks,
  type RealTask,
} from './data/cyber'

const MOUNT_STORAGE_KEY = 'cyber:mount-map'
const KANBAN_STORAGE_KEY = 'cyber:kanban'
const DISMISSED_STORAGE_KEY = 'cyber:dismissed-tasks'
const LOCAL_NAME_KEY = 'cyber:local-name'
const LOCAL_NODE_KEY = 'cyber:local-node'

/** User-renamed local node name (local node is auto-detected, but the name is editable & persisted). */
function loadLocalName(): string | null {
  try {
    return localStorage.getItem(LOCAL_NAME_KEY) || null
  } catch {
    return null
  }
}

function loadLocalNodeOverride(): Partial<Pick<HermesNode, 'name' | 'host' | 'system' | 'apiKey' | 'sessionKey' | 'sshAlias'>> {
  try {
    const raw = localStorage.getItem(LOCAL_NODE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveLocalNodeOverride(node: HermesNode) {
  try {
    localStorage.setItem(LOCAL_NAME_KEY, node.name)
    localStorage.setItem(LOCAL_NODE_KEY, JSON.stringify({
      name: node.name,
      host: node.host,
      system: node.system,
      apiKey: node.apiKey,
      sessionKey: node.sessionKey,
      sshAlias: node.sshAlias,
    }))
  } catch {
    // ignore
  }
}

/** User-added remote nodes — now loaded from server (disk-persisted), with localStorage fallback for migration. */
async function loadCustomNodes(): Promise<HermesNode[]> {
  try {
    const nodes = (await loadNodes()) as HermesNode[]
    if (Array.isArray(nodes) && nodes.length > 0) {
      return nodes.filter((n) => n && n.id && n.kind === 'remote')
    }
  } catch {
    // server unavailable — try legacy localStorage
  }
  try {
    const raw = localStorage.getItem('cyber:nodes')
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as HermesNode[]).filter((n) => n && n.id && n.kind === 'remote') : []
  } catch {
    return []
  }
}

function readLinkState(raw: unknown): LinkState {
  const s = typeof raw === 'string' ? raw : ''
  if (s === 'connected' || s === 'running') return 'up'
  if (s === 'retrying' || s === 'connecting' || s === 'degraded') return 'warn'
  if (s === 'disconnected' || s === 'stopped' || s === 'error' || s === 'failed') return 'down'
  return 'unknown'
}

function readNodeLinks(payload: Record<string, unknown> | null | undefined): NodeLinks {
  if (!payload) return { gate: 'unknown', feishu: 'unknown' }
  const platforms = payload.platforms as Record<string, { state?: unknown }> | undefined
  return {
    gate: readLinkState(payload.gateway_state),
    feishu: readLinkState(platforms?.feishu?.state),
  }
}

type MountMap = Record<HermesInstanceId, string[]>

function loadMountMap(): MountMap {
  try {
    const raw = localStorage.getItem(MOUNT_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as MountMap) : {}
  } catch {
    return {}
  }
}

function loadKanban(): KanbanCardData[] {
  try {
    const raw = localStorage.getItem(KANBAN_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as KanbanCardData[]) : []
  } catch {
    return []
  }
}

function loadDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

function sessionAge(session: HermesSessionWithInstance): number {
  const last = session.last_active ?? session.started_at ?? 0
  return last ? Date.now() / 1000 - last : Number.POSITIVE_INFINITY
}

/** Epoch (ms) embedded in a local card id `card-<ms>-<rand>`, for newest-first sort. */
function cardTimestamp(id: string): number {
  const m = id.match(/^card-(\d+)-/)
  return m ? Number(m[1]) : 0
}

function App() {
  const [dashboard, setDashboard] = useState<HermesDashboardData | null>(null)
  const inFlight = useRef(false)

  // Dynamic node list: auto-detected local node + user-added remote nodes.
  const [localNode, setLocalNode] = useState<HermesNode | null>(null)
  const [customNodes, setCustomNodes] = useState<HermesNode[]>([])
  const nodes = useMemo<HermesNode[]>(
    () => (localNode ? [localNode, ...customNodes] : customNodes),
    [localNode, customNodes],
  )

  const [profiles, setProfiles] = useState<Record<HermesInstanceId, HermesProfilesResponse | null>>({})
  const [profilesLoading, setProfilesLoading] = useState(true)

  const [mountMap, setMountMap] = useState<MountMap>(() => loadMountMap())
  const [kanban, setKanban] = useState<KanbanCardData[]>(() => loadKanban())
  const [realTasks, setRealTasks] = useState<RealTask[]>([])
  const [dismissedTaskIds, setDismissedTaskIds] = useState<string[]>(() => loadDismissed())
  const [configHermes, setConfigHermes] = useState<HermesInstanceId | null>(null)
  const [dispatchTarget, setDispatchTarget] = useState<{ agent: HermesProfileAgent; node: HermesNode } | null>(null)
  const [chatTarget, setChatTarget] = useState<{ instanceId: HermesInstanceId; sessionId: string | null } | null>(null)
  const [skillGalleryOpen, setSkillGalleryOpen] = useState(false)
  const [jobListOpen, setJobListOpen] = useState(false)
  const [activeCardId, setActiveCardId] = useState<string | null>(null)
  const [writeNotice, setWriteNotice] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // --- data loading -------------------------------------------------------

  // Register the node list for API routing whenever it changes (runs before fetches).
  useEffect(() => {
    setNodeRegistry(
      nodes.map((n) => ({
        id: n.id,
        name: n.name,
        kind: n.kind,
        system: n.system,
        host: n.host,
        baseUrl: n.kind === 'remote' || n.apiKey || (n.kind === 'local' && n.host !== '127.0.0.1:8642')
          ? (n.host.startsWith('http') ? n.host : `http://${n.host}`)
          : undefined,
        apiKey: n.apiKey,
        sessionKey: n.sessionKey,
        sshAlias: n.sshAlias,
      })),
    )
  }, [nodes])

  useEffect(() => {
    // Persist custom nodes to server (disk file). Don't overwrite with empty on first load.
    const timeout = setTimeout(() => {
      if (customNodes.length > 0) {
        saveNodes(customNodes).catch(() => {})
      }
    }, 500)
    return () => clearTimeout(timeout)
  }, [customNodes])

  // Auto-detect the local node from the dev server (cross-platform).
  useEffect(() => {
    let cancelled = false
    getOfficeRuntimeConfig()
      .then((cfg) => {
        if (cancelled) return
        const override = loadLocalNodeOverride()
        setLocalNode({
          id: cfg.localNode.id,
          name: override.name ?? loadLocalName() ?? cfg.localNode.name,
          host: cfg.localNode.host,
          system: cfg.localNode.system,
          accent: NODE_ACCENTS[0],
          kind: 'local',
          ...override,
        })
      })
      .catch(() => {
        if (!cancelled) {
          const override = loadLocalNodeOverride()
          setLocalNode({ id: 'local', name: override.name ?? loadLocalName() ?? '本机 Hermes', host: '127.0.0.1:8642', system: 'local', accent: NODE_ACCENTS[0], kind: 'local', ...override })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Load custom nodes from server on mount (with legacy localStorage migration).
  useEffect(() => {
    let cancelled = false
    loadCustomNodes()
      .then((nodes) => {
        if (cancelled) return
        if (nodes.length > 0) setCustomNodes(nodes)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const loadDashboard = useCallback(async (ids: HermesInstanceId[]) => {
    if (inFlight.current || ids.length === 0) return
    inFlight.current = true
    try {
      setDashboard(await getDashboardData(ids))
    } catch {
      // keep last snapshot
    } finally {
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    const ids = nodes.map((n) => n.id)
    void loadDashboard(ids)
    const id = window.setInterval(() => void loadDashboard(ids), 5000)
    return () => window.clearInterval(id)
  }, [loadDashboard, nodes])

  useEffect(() => {
    if (nodes.length === 0) return
    let cancelled = false
    setProfilesLoading(true)
    Promise.all(nodes.map((node) => getProfiles(node.id).catch(() => null))).then((results) => {
      if (cancelled) return
      const next: Record<HermesInstanceId, HermesProfilesResponse | null> = {}
      results.forEach((result, index) => {
        next[nodes[index].id] = result
      })
      setProfiles(next)
      setProfilesLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [nodes])

  useEffect(() => {
    try {
      localStorage.setItem(MOUNT_STORAGE_KEY, JSON.stringify(mountMap))
    } catch {
      // ignore
    }
  }, [mountMap])

  useEffect(() => {
    try {
      localStorage.setItem(KANBAN_STORAGE_KEY, JSON.stringify(kanban))
    } catch {
      // ignore
    }
  }, [kanban])

  useEffect(() => {
    try {
      localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(dismissedTaskIds))
    } catch {
      // ignore
    }
  }, [dismissedTaskIds])

  // Live mirror of each node's real kanban.db (local node via python, remote via SSH).
  const refreshRealTasks = useCallback(async () => {
    const results = await Promise.all(
      nodes.map(async (node) => {
        try {
          const res = await getKanban(node.id)
          return res.tasks.map<RealTask>((task) => ({
            id: `${node.id}:${task.id}`,
            taskId: task.id,
            title: task.title,
            assignee: task.assignee,
            status: task.status,
            nodeId: node.id,
            accent: node.accent,
            createdAt: task.created_at ?? 0,
            completedAt: task.completed_at ?? null,
          }))
        } catch {
          return []
        }
      }),
    )
    setRealTasks(results.flat())
  }, [nodes])

  useEffect(() => {
    void refreshRealTasks()
    const id = window.setInterval(() => void refreshRealTasks(), 8000)
    return () => window.clearInterval(id)
  }, [refreshRealTasks])

  // Sidebar action handler
  const handleSidebarAction = useCallback(
    (action: SidebarAction) => {
      switch (action.type) {
        case 'new-chat': {
          setChatTarget({ instanceId: nodes[0]?.id ?? 'local', sessionId: null })
          break
        }
        case 'skill-gallery': {
          setSkillGalleryOpen(true)
          break
        }
        case 'job-list': {
          setJobListOpen(true)
          break
        }
        case 'chat-session': {
          setChatTarget({ instanceId: action.instanceId, sessionId: action.sessionId })
          break
        }
      }
    },
    [nodes],
  )

  // Auto-dismiss the write-back toast.
  useEffect(() => {
    if (!writeNotice) return
    const id = window.setTimeout(() => setWriteNotice(null), 4500)
    return () => window.clearTimeout(id)
  }, [writeNotice])

  // --- derived ------------------------------------------------------------

  const sessions = dashboard?.sessions ?? []
  const health = dashboard?.health ?? []

  const isWebSession = useCallback((session: HermesSessionWithInstance) => {
    const source = (session.source ?? '').trim().toLowerCase()
    if (!source) return true
    if (source.includes('feishu') || source.includes('lark')) return false
    if (source.includes('clb') || source.includes('clib')) return false
    if (source.includes('web') || source.includes('api') || source.includes('console') || source.includes('studio')) return true
    return false
  }, [])

  const openNodeChat = useCallback(
    (instanceId: HermesInstanceId = nodes[0]?.id ?? 'local') => {
      const nodeSessions = sessions
        .filter((s) => s.instanceId === instanceId)
        .sort((a, b) => (b.last_active ?? b.started_at ?? 0) - (a.last_active ?? a.started_at ?? 0))
      const targetSession = nodeSessions.find(isWebSession) ?? nodeSessions[0] ?? null
      setChatTarget({
        instanceId,
        sessionId: targetSession?.id ?? null,
      })
    },
    [isWebSession, nodes, sessions],
  )

  const instanceStatus = useMemo(() => {
    const map = new Map<HermesInstanceId, { status: AgentStatus; reachable: boolean }>()
    for (const node of nodes) {
      const reachable = health.find((item) => item.instanceId === node.id)?.reachable ?? false
      if (!reachable) {
        map.set(node.id, { status: 'idle', reachable: false })
        continue
      }
      const freshest = Math.min(
        ...sessions.filter((s) => s.instanceId === node.id).map(sessionAge),
        Number.POSITIVE_INFINITY,
      )
      const status: AgentStatus = freshest <= 120 ? 'busy' : freshest <= 20 * 60 ? 'online' : 'idle'
      map.set(node.id, { status, reachable: true })
    }
    return map
  }, [health, sessions, nodes])

  const mountedAgents = useCallback(
    (instanceId: HermesInstanceId): HermesProfileAgent[] => {
      const pool = profiles[instanceId]?.agents ?? []
      return (mountMap[instanceId] ?? [])
        .map((id) => pool.find((agent) => agent.id === id))
        .filter((agent): agent is HermesProfileAgent => Boolean(agent))
    },
    [mountMap, profiles],
  )

  // Active local dispatches drive the 走动区: a dispatched agent's horse stands
  // under its task's column, leaving an empty desk behind until the task is done.
  const activeDispatches = useMemo(
    () => kanban.filter((card) => card.column !== doneColumn.id),
    [kanban],
  )

  // Real kanban.db tasks with an assignee also drive the 走动区: the assigned agent
  // leaves its desk and its horse stands under the task's live status column,
  // moving as Hermes advances the task (triage→ready→running→…). Polling keeps it live.
  const boardColIds = useMemo(() => new Set(boardColumns.map((c) => c.id)), [])
  const realDispatches = useMemo(
    () =>
      realTasks.filter(
        (t) => t.assignee && t.status !== doneColumn.id && boardColIds.has(t.status),
      ),
    [realTasks, boardColIds],
  )

  // Match a task's assignee to a node's profile agent by id OR name — real
  // kanban.db tasks may store the assignee either way depending on who created it.
  const resolveAgent = useCallback(
    (instanceId: HermesInstanceId, assignee: string | null): HermesProfileAgent | undefined =>
      profiles[instanceId]?.agents.find((a) => a.id === assignee || a.name === assignee),
    [profiles],
  )

  const resolveAgentName = useCallback(
    (instanceId: HermesInstanceId, assignee: string | null): string =>
      resolveAgent(instanceId, assignee)?.name ?? assignee ?? '未知',
    [resolveAgent],
  )

  const outKeys = useMemo(
    () =>
      new Set([
        ...activeDispatches.map((card) => `${card.nodeId}:${card.agentId}`),
        // Use the resolved agent id so the desk (keyed by agent.id) empties even
        // when the task stored the assignee as a name.
        ...realDispatches.map(
          (task) => `${task.nodeId}:${resolveAgent(task.nodeId, task.assignee)?.id ?? task.assignee}`,
        ),
      ]),
    [activeDispatches, realDispatches, resolveAgent],
  )

  const nodeLinks = useCallback(
    (instanceId: HermesInstanceId): NodeLinks =>
      readNodeLinks(health.find((h) => h.instanceId === instanceId)?.payload),
    [health],
  )

  const refreshNodeData = useCallback(async () => {
    const ids = nodes.map((n) => n.id)
    await Promise.all([
      loadDashboard(ids),
      refreshRealTasks(),
      Promise.all(nodes.map((node) => getProfiles(node.id).catch(() => null))).then((results) => {
        const next: Record<HermesInstanceId, HermesProfilesResponse | null> = {}
        results.forEach((result, index) => {
          next[nodes[index].id] = result
        })
        setProfiles(next)
      }),
    ])
  }, [loadDashboard, nodes, refreshRealTasks])

  // node CRUD — the local node is auto-detected, but can be manually overridden.
  const addNode = useCallback(
    (draft: { name: string; host: string; system: string; apiKey?: string; sessionKey?: string; sshAlias?: string }) => {
      setCustomNodes((cur) => {
        const id = `node-${Date.now().toString(36)}`
        const accent = NODE_ACCENTS[(cur.length + 1) % NODE_ACCENTS.length]
        return [...cur, { id, accent, kind: 'remote' as const, ...draft }]
      })
    },
    [],
  )

  const updateNode = useCallback(
    (id: HermesInstanceId, draft: Partial<Pick<HermesNode, 'name' | 'host' | 'system' | 'apiKey' | 'sessionKey' | 'sshAlias'>>) => {
      if (localNode && id === localNode.id) {
        setLocalNode((cur) => {
          if (!cur) return cur
          const next = { ...cur, ...draft }
          saveLocalNodeOverride(next)
          return next
        })
        window.setTimeout(() => void refreshNodeData(), 0)
        return
      }
      setCustomNodes((cur) => {
        const next = cur.map((n) => (n.id === id ? { ...n, ...draft } : n))
        window.setTimeout(() => void refreshNodeData(), 0)
        return next
      })
    },
    [localNode, refreshNodeData],
  )

  const removeNode = useCallback((id: HermesInstanceId) => {
    setCustomNodes((cur) => cur.filter((n) => n.id !== id))
    setMountMap((cur) => {
      const next = { ...cur }
      delete next[id]
      return next
    })
  }, [])

  // Offline notice: prompt once when a node transitions reachable → unreachable.
  const prevReachable = useRef<Record<string, boolean>>({})
  useEffect(() => {
    for (const h of health) {
      if (prevReachable.current[h.instanceId] === true && !h.reachable) {
        const name = nodes.find((n) => n.id === h.instanceId)?.name ?? h.instanceId
        setWriteNotice({ tone: 'warn', text: `节点「${name}」已离线` })
      }
      prevReachable.current[h.instanceId] = h.reachable
    }
  }, [health, nodes])

  // 已完成: newest-completed first, with user-dismissed real tasks hidden.
  const dismissedSet = useMemo(() => new Set(dismissedTaskIds), [dismissedTaskIds])
  const doneItems = useMemo<DoneItem[]>(() => {
    const local: DoneItem[] = kanban
      .filter((c) => c.column === doneColumn.id)
      .map((card) => ({ kind: 'card', key: card.id, time: cardTimestamp(card.id), card }))
    const real: DoneItem[] = realTasks
      .filter((t) => t.status === doneColumn.id && !dismissedSet.has(t.id))
      .map((task) => ({
        kind: 'task',
        key: task.id,
        time: (task.completedAt ?? task.createdAt ?? 0) * 1000,
        task,
      }))
    return [...local, ...real].sort((a, b) => b.time - a.time)
  }, [kanban, realTasks, dismissedSet])

  const handleSaveMount = (instanceId: HermesInstanceId, ids: string[]) => {
    setMountMap((current) => ({ ...current, [instanceId]: ids }))
    setConfigHermes(null)
  }

  const reloadProfile = useCallback(async (instanceId: HermesInstanceId) => {
    const res = await getProfiles(instanceId).catch(() => null)
    setProfiles((current) => ({ ...current, [instanceId]: res }))
  }, [])

  const handleDispatch = (agent: HermesProfileAgent, node: HermesNode, task: string) => {
    setKanban((current) => [
      ...current,
      {
        id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        agentId: agent.id,
        agentName: agent.name,
        nodeId: node.id,
        accent: node.accent,
        task,
        column: 'todo',
      },
    ])
    setDispatchTarget(null)
  }

  // 已完成 list: X closes an item. Local cards are removed; real done tasks are
  // hidden locally (kept out of view across polls via the dismissed set).
  const dismissDoneItem = useCallback((item: DoneItem) => {
    if (item.kind === 'card') {
      setKanban((current) => current.filter((card) => card.id !== item.card.id))
    } else {
      setDismissedTaskIds((current) =>
        current.includes(item.task.id) ? current : [...current, item.task.id],
      )
    }
  }, [])

  // SAFE write-back to a real kanban.db: drag a 实时 card → 已完成 (complete_task)
  // or → 阻塞 (block_task). The official functions enforce valid transitions, so
  // an invalid move just returns ok:false instead of corrupting task state.
  const applyRealWrite = useCallback(
    async (taskCard: RealTask, op: 'complete' | 'block') => {
      const targetStatus = op === 'complete' ? 'done' : 'blocked'
      const verb = op === 'complete' ? '完成' : '阻塞'
      // Optimistic move; the next poll reconciles with the real db.
      setRealTasks((current) =>
        current.map((t) => (t.id === taskCard.id ? { ...t, status: targetStatus } : t)),
      )
      try {
        const res = await writeKanban(taskCard.nodeId, op, { id: taskCard.taskId })
        if (res.ok) {
          setWriteNotice({ tone: 'ok', text: `已写回 ${taskCard.nodeId}：${verb}「${taskCard.title}」` })
        } else {
          setWriteNotice({
            tone: 'warn',
            text: `「${taskCard.title}」当前状态不允许${verb}（Hermes 官方校验拒绝）`,
          })
        }
      } catch (error) {
        setWriteNotice({
          tone: 'err',
          text: `写回失败：${error instanceof Error ? error.message : String(error)}`,
        })
      } finally {
        void refreshRealTasks()
      }
    },
    [refreshRealTasks],
  )

  const handleCreateReal = useCallback(
    async (agent: HermesProfileAgent, node: HermesNode, payload: KanbanCreatePayload) => {
      setDispatchTarget(null)
      try {
        const res = await writeKanban(node.id, 'create', payload)
        if (res.ok) {
          setWriteNotice({
            tone: 'ok',
            text: `已在 ${node.name} 创建真实任务（${res.status ?? payload.initial_status ?? 'todo'}）→ ${agent.name}`,
          })
        } else {
          setWriteNotice({ tone: 'warn', text: `创建失败：${res.error ?? '未知原因'}` })
        }
      } catch (error) {
        setWriteNotice({
          tone: 'err',
          text: `创建失败：${error instanceof Error ? error.message : String(error)}`,
        })
      } finally {
        void refreshRealTasks()
      }
    },
    [refreshRealTasks],
  )

  const handleDragStart = (event: DragStartEvent) => setActiveCardId(String(event.active.id))

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveCardId(null)
    const { active, over } = event
    if (!over) return
    const id = String(active.id)
    const target = String(over.id)

    // Real tasks (from kanban.db) only accept 已完成 / 阻塞 — no arbitrary moves.
    const realTask = realTasks.find((t) => t.id === id)
    if (realTask) {
      if (target === realTask.status) return
      if (target === 'done') void applyRealWrite(realTask, 'complete')
      else if (target === 'blocked') void applyRealWrite(realTask, 'block')
      else
        setWriteNotice({
          tone: 'warn',
          text: '实时任务只允许拖到「已完成」或「阻塞」，其它流转请在 Hermes 内进行',
        })
      return
    }

    // Local dispatch cards move freely (purely client-side state).
    setKanban((current) =>
      current.map((card) => (card.id === id ? { ...card, column: target } : card)),
    )
  }

  const configNode = nodes.find((node) => node.id === configHermes) ?? null
  const activeCard = kanban.find((card) => card.id === activeCardId) ?? null
  const activeRealTask = realTasks.find((task) => task.id === activeCardId) ?? null

  // Test a remote node's connection: try health check through forward proxy.
  const testNodeConnection = useCallback(
    async (host: string, apiKey?: string, sessionKey?: string): Promise<{ ok: boolean; message: string }> => {
      const baseUrl = host.startsWith('http') ? host : `http://${host}`
      try {
        const res = await fetch('/local-bridge/forward', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseUrl,
            apiKey: apiKey ?? '',
            sessionKey: sessionKey ?? 'web-console',
            path: '/api/sessions?limit=1',
            method: 'GET',
            timeoutMs: 8000,
          }),
        })
        if (!res.ok) {
          const text = await res.text()
          if (res.status === 401 || res.status === 403) {
            return { ok: false, message: `HTTP ${res.status} — API Key 不正确或未授权` }
          }
          return { ok: false, message: `HTTP ${res.status} — ${text.slice(0, 100) || '连接失败'}` }
        }
        const json = await res.json() as Record<string, unknown>
        const sessionCount = Array.isArray(json.data) ? (json.data as unknown[]).length : 0
        return {
          ok: true,
          message: `连接成功 — API 正常，当前有 ${sessionCount} 个会话`,
        }
      } catch {
        return { ok: false, message: '连接失败 — 请检查 IP 和端口是否正确，该节点是否在线' }
      }
    },
    [],
  )

  // -----------------------------------------------------------------------

  return (
    <div className="cyber">
      <NavSidebar
        nodes={nodes}
        onAction={handleSidebarAction}
        onAddNode={addNode}
        onUpdateNode={updateNode}
        onRemoveNode={removeNode}
        onTestNode={testNodeConnection}
        onRefreshNodes={refreshNodeData}
      />

      <ErrorBoundary>
      <main className="cyber-main">
        <header className="cyber-header">
          <h1>Multi-Agent 控制中心</h1>
          <p>看板 · 调度区 · Hermes1/2/3 节点与派驻 agent · 点 agent 派发任务、拖拽跨列</p>
        </header>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="cyber-body">
            <ChatPanel
              sessions={sessions}
              active={chatTarget}
              nodes={nodes.map((n) => ({ id: n.id, name: n.name, accent: n.accent }))}
              onSelect={(instanceId, sessionId) =>
                setChatTarget({ instanceId, sessionId })
              }
            />
            <div className="cyber-left">
              <KanbanRow cards={kanban} tasks={realTasks} />

        <section className="staging">
          <div className="staging__head">
            <strong>调度区</strong>
            <span>出勤中的 agent — 跟随任务停在所在列下方，完成后回到工位</span>
          </div>
          <div className="staging__lane">
            {boardColumns.map((col) => (
              <div className="staging__cell" key={col.id}>
                {activeDispatches
                  .filter((card) => card.column === col.id)
                  .map((card) => (
                    <div
                      key={card.id}
                      className={`walk-agent ${card.column === 'running' ? 'is-working' : ''}`}
                      style={{ ['--accent' as string]: card.accent }}
                      title={`${card.agentName} · ${card.task}`}
                    >
                      <StandingHorse accent={card.accent} className="walk-agent__horse" />
                      <span className="walk-agent__name">{card.agentName}</span>
                    </div>
                  ))}
                {realDispatches
                  .filter((task) => task.status === col.id)
                  .map((task) => {
                    const name = resolveAgentName(task.nodeId, task.assignee)
                    return (
                      <div
                        key={task.id}
                        className={`walk-agent ${task.status === 'running' ? 'is-working' : ''}`}
                        style={{ ['--accent' as string]: task.accent }}
                        title={`${name} · ${task.title}（真实任务）`}
                      >
                        <StandingHorse accent={task.accent} className="walk-agent__horse" />
                        <span className="walk-agent__name">{name}</span>
                      </div>
                    )
                  })}
              </div>
            ))}
          </div>
        </section>

        <section className="nodes">
          {nodes.map((node) => {
            const info = instanceStatus.get(node.id) ?? { status: 'idle' as AgentStatus, reachable: false }
            return (
              <HermesRow
                key={node.id}
                node={node}
                status={info.status}
                reachable={info.reachable}
                links={nodeLinks(node.id)}
                agents={mountedAgents(node.id)}
                outKeys={outKeys}
                onConfigure={() => setConfigHermes(node.id)}
                onChat={() => openNodeChat(node.id)}
                onAgentClick={(agent) => setDispatchTarget({ agent, node })}
              />
            )
          })}
        </section>
            </div>

            <DonePanel column={doneColumn} items={doneItems} onDismiss={dismissDoneItem} />
          </div>

          <DragOverlay dropAnimation={null}>
            {activeCard ? (
              <KanbanCard card={activeCard} overlay />
            ) : activeRealTask ? (
              <KanbanTaskCard task={activeRealTask} overlay />
            ) : null}
          </DragOverlay>
        </DndContext>
      </main>
      </ErrorBoundary>

      {configNode ? (
        <ErrorBoundary key={configNode.id}>
        <ConfigPanel
          node={configNode}
          profiles={profiles[configNode.id] ?? null}
          loading={profilesLoading}
          mounted={mountMap[configNode.id] ?? []}
          onSave={(ids) => handleSaveMount(configNode.id, ids)}
          onCreated={() => void reloadProfile(configNode.id)}
          onOpenChat={() => openNodeChat(configNode.id)}
          onClose={() => setConfigHermes(null)}
        />
        </ErrorBoundary>
      ) : null}

      {dispatchTarget ? (
        <DispatchModal
          agent={dispatchTarget.agent}
          node={dispatchTarget.node}
          onDispatch={(task) => handleDispatch(dispatchTarget.agent, dispatchTarget.node, task)}
          onCreateReal={(payload) =>
            void handleCreateReal(dispatchTarget.agent, dispatchTarget.node, payload)
          }
          onChat={() => {
            setChatTarget({
              instanceId: dispatchTarget.node.id,
              sessionId: sessions.find((s) => s.instanceId === dispatchTarget.node.id)?.id ?? null,
            })
            setDispatchTarget(null)
          }}
          onConfigure={() => {
            setConfigHermes(dispatchTarget.node.id)
            setDispatchTarget(null)
          }}
          onClose={() => setDispatchTarget(null)}
        />
      ) : null}

      {chatTarget ? (
        <ChatDialog
          instanceId={chatTarget.instanceId}
          initialSessionId={chatTarget.sessionId}
          onClose={() => setChatTarget(null)}
        />
      ) : null}

      {skillGalleryOpen ? (
        <SkillGallery
          nodes={nodes.map((n) => ({ id: n.id, name: n.name, accent: n.accent }))}
          onOpenChat={(instanceId) => openNodeChat(instanceId)}
          onClose={() => setSkillGalleryOpen(false)}
        />
      ) : null}

      {jobListOpen ? (
        <JobList
          nodes={nodes.map((n) => ({ id: n.id, name: n.name, accent: n.accent }))}
          onOpenChat={(instanceId) => openNodeChat(instanceId)}
          onClose={() => setJobListOpen(false)}
        />
      ) : null}

      {writeNotice ? (
        <div className={`write-notice write-notice--${writeNotice.tone}`} role="status">
          {writeNotice.text}
        </div>
      ) : null}

      <footer className="cyber-footer">
        <span>Hermes 办公室 · Multi-Agent 控制中心 v2</span>
      </footer>
    </div>
  )
}

export default App
