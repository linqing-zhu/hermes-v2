import type {
  HermesJob,
  HermesJobsResponse,
  HermesListResponse,
  HermesMessageItem,
  HermesSessionDetailResponse,
  HermesSessionMessagesResponse,
  HermesSessionSummary,
  HermesSessionsResponse,
  HermesSkill,
  HermesStreamEvent,
  HermesToolset,
} from '../types/hermes'

export type HermesInstanceId = string

export type HermesSessionWithInstance = HermesSessionSummary & { instanceId: HermesInstanceId }
export type HermesJobWithInstance = HermesJob & { instanceId: HermesInstanceId }
export type HermesSkillWithInstance = HermesSkill & { instanceId: HermesInstanceId }
export type HermesToolsetWithInstance = HermesToolset & { instanceId: HermesInstanceId }

export type HermesInstanceHealth = {
  instanceId: HermesInstanceId
  reachable: boolean
  detailed: boolean
  message: string
  payload: Record<string, unknown> | null
  checkedAt: number
}

export type HermesSkillConfigBridgeState = {
  editable: boolean
  platform: string
  disabledSkillNames: string[]
  message?: string
}

export type HermesOfficeLocalNode = {
  id: string
  name: string
  system: string
  host: string
  proxyPrefix: string
  sessionKeyPreview: string
  detected: boolean
}

export type HermesOfficeRuntimeConfig = {
  officeName: string
  mode: 'local_dispatch_center'
  memory: { sessionHeader: string; sessionKeyStrategy: string }
  dispatch: { intervalSeconds: number; failureLimit: number; autoDecompose: boolean; staleTimeoutSeconds: number }
  localNode: HermesOfficeLocalNode
}

// --- runtime node registry & routing -------------------------------------
// Local node → static /hermes-api proxy (key injected server-side). Remote nodes
// (user-added) → /local-bridge/forward (key sent from browser, piped server-side).
export type HermesNodeConn = {
  id: HermesInstanceId
  name: string
  kind: 'local' | 'remote'
  system?: string
  host?: string
  baseUrl?: string
  apiKey?: string
  sessionKey?: string
  sshAlias?: string
}

let nodeRegistry: Record<string, HermesNodeConn> = {}

export function setNodeRegistry(nodes: HermesNodeConn[]) {
  nodeRegistry = Object.fromEntries(nodes.map((n) => [n.id, n]))
}

export function getNodeConn(id: HermesInstanceId): HermesNodeConn | undefined {
  return nodeRegistry[id]
}

function conn(id: HermesInstanceId): HermesNodeConn {
  return nodeRegistry[id] ?? { id, name: id, kind: 'local' }
}

type NodeFetchInit = {
  method?: string
  jsonBody?: unknown
  accept?: string
  timeoutMs?: number
  signal?: AbortSignal
}

async function nodeFetch(id: HermesInstanceId, apiPath: string, init: NodeFetchInit = {}): Promise<Response> {
  const c = conn(id)
  const { method = 'GET', jsonBody, accept, timeoutMs, signal } = init

  let effectiveSignal = signal
  let timer: ReturnType<typeof setTimeout> | undefined
  if (timeoutMs && !signal) {
    const ctrl = new AbortController()
    timer = setTimeout(() => ctrl.abort(), timeoutMs)
    effectiveSignal = ctrl.signal
  }

  try {
    if (c.kind === 'local') {
      const headers: Record<string, string> = {}
      if (jsonBody !== undefined) headers['Content-Type'] = 'application/json'
      if (accept) headers.Accept = accept
      return await fetch(`/hermes-api${apiPath}`, {
        method,
        headers,
        body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
        signal: effectiveSignal,
      })
    }
    return await fetch('/local-bridge/forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: c.baseUrl,
        apiKey: c.apiKey,
        sessionKey: c.sessionKey,
        path: apiPath,
        method,
        body: jsonBody,
        accept,
        timeoutMs,
      }),
      signal: effectiveSignal,
    })
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function bridgeRouteQuery(id: HermesInstanceId): string {
  const c = conn(id)
  if (c.kind === 'local') return 'source=local'
  return c.sshAlias ? `ssh=${encodeURIComponent(c.sshAlias)}` : 'source=remote'
}

function bridgeRouteBody(id: HermesInstanceId): Record<string, string> {
  const c = conn(id)
  if (c.kind === 'local') return { source: 'local' }
  return c.sshAlias ? { ssh: c.sshAlias } : { source: 'remote' }
}

export class HermesHttpError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'HermesHttpError'
    this.status = status
  }
}

async function fetchLocalBridge<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)

  if (!response.ok) {
    const message = await response.text()
    throw new HermesHttpError(message || `本地桥接请求失败：${response.status}`, response.status)
  }

  return (await response.json()) as T
}

/** Load custom nodes from the server (persisted to disk, not localStorage). */
export async function loadNodes(): Promise<unknown[]> {
  return fetchLocalBridge<unknown[]>('/local-bridge/nodes')
}

/** Save custom nodes to the server (disk-persisted). */
export async function saveNodes(nodes: unknown): Promise<void> {
  await fetch('/local-bridge/nodes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(nodes),
  })
}

async function fetchHermesResponse(instanceId: HermesInstanceId, path: string, init?: NodeFetchInit) {
  return nodeFetch(instanceId, path, { timeoutMs: 8000, ...init })
}

async function fetchHermes<T>(instanceId: HermesInstanceId, path: string): Promise<T> {
  const response = await fetchHermesResponse(instanceId, path)

  if (!response.ok) {
    const message = await response.text()
    throw new HermesHttpError(message || `Hermes API 请求失败：${response.status}`, response.status)
  }

  return (await response.json()) as T
}

function tryParsePayload(responseText: string, contentType: string | null) {
  if (!responseText) {
    return null
  }

  if (contentType?.includes('application/json')) {
    return JSON.parse(responseText) as Record<string, unknown>
  }

  return {
    text: responseText,
  }
}

export async function getSessions(instanceId: HermesInstanceId) {
  const response = await fetchHermes<HermesSessionsResponse>(instanceId, '/api/sessions')
  return response.data.map((session) => ({
    ...session,
    instanceId,
  }))
}

export async function getJobs(instanceId: HermesInstanceId) {
  const response = await fetchHermes<HermesJobsResponse>(instanceId, '/api/jobs')
  return response.jobs.map((job) => ({
    ...job,
    instanceId,
  }))
}

export async function createSession(instanceId: HermesInstanceId) {
  const response = await nodeFetch(instanceId, '/api/sessions', { method: 'POST', jsonBody: {} })

  if (!response.ok) {
    const text = await response.text()
    throw new HermesHttpError(text || `Hermes 创建会话失败：${response.status}`, response.status)
  }

  const data = (await response.json()) as HermesSessionDetailResponse
  return {
    ...data.session,
    instanceId,
  }
}

export async function getSessionMessages(instanceId: HermesInstanceId, sessionId: string) {
  const response = await fetchHermes<HermesSessionMessagesResponse>(
    instanceId,
    `/api/sessions/${sessionId}/messages`,
  )
  return response.data
}

export async function getSkills(instanceId: HermesInstanceId) {
  const response = await fetchHermes<HermesListResponse<HermesSkill>>(instanceId, '/v1/skills')
  return response.data.map((skill) => ({
    ...skill,
    instanceId,
  }))
}

export async function getToolsets(instanceId: HermesInstanceId) {
  const response = await fetchHermes<HermesListResponse<HermesToolset>>(instanceId, '/v1/toolsets')
  return response.data.map((toolset) => ({
    ...toolset,
    instanceId,
  }))
}

export async function getInstanceHealth(instanceId: HermesInstanceId): Promise<HermesInstanceHealth> {
  const healthPaths: Array<{ path: string; detailed: boolean }> = [
    { path: '/health/detailed', detailed: true },
    { path: '/health', detailed: false },
  ]

  for (const item of healthPaths) {
    try {
      const response = await fetchHermesResponse(instanceId, item.path, { timeoutMs: 6000 })
      const responseText = await response.text()

      if (!response.ok) {
        continue
      }

      return {
        instanceId,
        reachable: true,
        detailed: item.detailed,
        message: 'ok',
        payload: tryParsePayload(responseText, response.headers.get('content-type')),
        checkedAt: Date.now(),
      }
    } catch {
      // Try the fallback endpoint below.
    }
  }

  return {
    instanceId,
    reachable: false,
    detailed: false,
    message: 'unreachable',
    payload: null,
    checkedAt: Date.now(),
  }
}

export async function getOfficeRuntimeConfig() {
  return fetchLocalBridge<HermesOfficeRuntimeConfig>('/local-bridge/runtime-config')
}

export type HermesProfileAgent = {
  id: string
  name: string
  model: string
  provider: string
}

export type HermesProfilesResponse = {
  instance: HermesInstanceId
  available: boolean
  reason?: string
  agents: HermesProfileAgent[]
}

export async function getProfiles(instanceId: HermesInstanceId): Promise<HermesProfilesResponse> {
  const res = await fetchLocalBridge<Omit<HermesProfilesResponse, 'instance'>>(
    `/local-bridge/profiles?${bridgeRouteQuery(instanceId)}`,
  )
  return { instance: instanceId, ...res }
}

export type CreateProfilePayload = {
  name: string
  template: string
  model?: string
  provider?: string
}

/** Create a sub-agent by template-copying an existing profile's config.yaml. */
export async function createProfile(instanceId: HermesInstanceId, payload: CreateProfilePayload) {
  return fetchLocalBridge<{ ok: boolean; name: string; error?: string }>('/local-bridge/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...bridgeRouteBody(instanceId), ...payload }),
  })
}

export type HermesKanbanTask = {
  id: string
  title: string
  assignee: string | null
  status: string
  created_at?: number
  completed_at?: number | null
}

export type HermesKanbanResponse = {
  instance: HermesInstanceId
  available: boolean
  reason?: string
  tasks: HermesKanbanTask[]
}

export async function getKanban(instanceId: HermesInstanceId): Promise<HermesKanbanResponse> {
  const res = await fetchLocalBridge<Omit<HermesKanbanResponse, 'instance'>>(
    `/local-bridge/kanban?${bridgeRouteQuery(instanceId)}`,
  )
  return { instance: instanceId, ...res }
}

// SAFE write-back — only these three operations exist; each maps to an official
// hermes_cli.kanban_db function on the backend. No arbitrary cross-column writes.
export type KanbanWriteOp = 'create' | 'complete' | 'block'

export type KanbanCreatePayload = {
  title: string
  body?: string | null
  assignee?: string | null
  created_by?: string
  priority?: number
  initial_status?: 'triage' | 'ready'
}

export type KanbanMutatePayload = {
  id: string
  result?: string | null
  reason?: string | null
}

export type KanbanWriteResult = {
  instance?: HermesInstanceId
  ok: boolean
  op?: KanbanWriteOp
  id?: string
  status?: string
  error?: string
}

export async function writeKanban(
  instance: HermesInstanceId,
  op: KanbanWriteOp,
  payload: KanbanCreatePayload | KanbanMutatePayload,
): Promise<KanbanWriteResult> {
  return fetchLocalBridge<KanbanWriteResult>('/local-bridge/kanban/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...bridgeRouteBody(instance), op, payload }),
  })
}

export async function setSkillEnabled(instanceId: HermesInstanceId, skillName: string, enabled: boolean) {
  return fetchLocalBridge<HermesSkillConfigBridgeState>('/local-bridge/skills-config', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      instanceId,
      skillName,
      enabled,
    }),
  })
}

type StreamChatOptions = {
  onEvent: (event: HermesStreamEvent) => void
  signal?: AbortSignal
}

function parseSseBlock(block: string) {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)

  let eventType = 'message'
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.slice('event:'.length).trim()
      continue
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim())
    }
  }

  if (!dataLines.length) {
    return null
  }

  const payload = dataLines.join('\n')

  return {
    type: eventType,
    data: JSON.parse(payload) as Record<string, unknown>,
  } satisfies HermesStreamEvent
}

export async function streamSessionChat(
  instanceId: HermesInstanceId,
  sessionId: string,
  message: string,
  options: StreamChatOptions,
) {
  const response = await nodeFetch(instanceId, `/api/sessions/${sessionId}/chat/stream`, {
    method: 'POST',
    jsonBody: { message },
    accept: 'text/event-stream',
    signal: options.signal,
  })

  if (!response.ok || !response.body) {
    const text = await response.text()
    throw new HermesHttpError(
      text || `Hermes Stream Chat 请求失败：${response.status}`,
      response.status,
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })

    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      const parsed = parseSseBlock(block)

      if (parsed) {
        options.onEvent(parsed)
      }
    }
  }

  const finalText = decoder.decode()
  if (finalText) {
    buffer += finalText
  }

  if (buffer.trim()) {
    const parsed = parseSseBlock(buffer)

    if (parsed) {
      options.onEvent(parsed)
    }
  }
}

export async function getDashboardData(nodeIds: HermesInstanceId[]): Promise<{
  sessions: HermesSessionWithInstance[]
  health: HermesInstanceHealth[]
}> {
  const result = await Promise.all(
    nodeIds.map(async (id) => {
      const [sessions, health] = await Promise.allSettled([
        getSessions(id),
        getInstanceHealth(id),
      ])

      return {
        sessions: sessions.status === 'fulfilled' ? sessions.value : [],
        health:
          health.status === 'fulfilled'
            ? health.value
            : {
                instanceId: id,
                reachable: false,
                detailed: false,
                message: 'unreachable',
                payload: null,
                checkedAt: Date.now(),
              },
      }
    }),
  )

  return {
    sessions: result.flatMap((item) => item.sessions),
    health: result.map((item) => item.health),
  }
}

export type HermesDashboardData = Awaited<ReturnType<typeof getDashboardData>>
export type HermesSessionMessages = HermesMessageItem[]

export type KanbanStatus = 'triage' | 'todo' | 'scheduled' | 'ready' | 'running' | 'blocked' | 'review' | 'done'
