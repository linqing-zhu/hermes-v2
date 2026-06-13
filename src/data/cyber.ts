import type { HermesInstanceId } from '../services/hermes'

export type HermesNode = {
  id: HermesInstanceId
  name: string
  host: string
  system: string
  accent: string
  /** 'local' = auto-detected this machine; 'remote' = user-added in 配置. */
  kind: 'local' | 'remote'
  apiKey?: string
  sessionKey?: string
  /** Optional passwordless SSH alias — enables reading this node's profiles/kanban. */
  sshAlias?: string
}

/** Accent palette cycled through as nodes are added. */
export const NODE_ACCENTS = ['#4f8cff', '#7458ff', '#44c99d', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899']

/** Max agents a single Hermes can mount onto its desks. */
export const MAX_MOUNT = 8

export type KanbanCardData = {
  id: string
  agentId: string
  agentName: string
  nodeId: HermesInstanceId
  accent: string
  task: string
  column: string
}

export type KanbanColumnDef = {
  id: string
  title: string
  /** Solid header-bar color, per the user's kanban design mockup. */
  head: string
  dot: string
  desc: string
}

/** Mirrors Hermes' own kanban columns (triage→blocked); header colors per the user's mockup. */
export const kanbanColumns: KanbanColumnDef[] = [
  { id: 'triage', title: '待分类', head: '#8D8D8F', dot: '#8D8D8F', desc: '原始想法 — 规范制定者将完善规格' },
  { id: 'todo', title: '待办', head: '#755BCE', dot: '#755BCE', desc: '等待依赖项或未分配' },
  { id: 'scheduled', title: '已调度', head: '#009EE1', dot: '#009EE1', desc: '等待已知的时间延迟或已调度的跟进' },
  { id: 'ready', title: '就绪', head: '#EBAA4E', dot: '#EBAA4E', desc: '依赖项已满足；分配一个配置文件以便调度' },
  { id: 'running', title: '进行中', head: '#41AA66', dot: '#41AA66', desc: '已被工作者认领 — 执行中' },
  { id: 'blocked', title: '阻塞', head: '#E60012', dot: '#E60012', desc: '工作者请求人工输入' },
  { id: 'done', title: '已完成', head: '#10B981', dot: '#10B981', desc: '任务已完成归档' },
]

export const DONE_COLUMN_ID = 'done'

/** The six active columns shown in the top board row (待分类 → 阻塞). */
export const boardColumns: KanbanColumnDef[] = kanbanColumns.filter(
  (column) => column.id !== DONE_COLUMN_ID,
)

/** 已完成 — pulled out into the tall right-hand panel. */
export const doneColumn: KanbanColumnDef =
  kanbanColumns.find((column) => column.id === DONE_COLUMN_ID) ?? kanbanColumns[kanbanColumns.length - 1]

/** Connection state of a node's gateway / IM platform, from /health/detailed. */
export type LinkState = 'up' | 'warn' | 'down' | 'unknown'
export type NodeLinks = { gate: LinkState; feishu: LinkState }

export type RealTask = {
  id: string
  /** Raw kanban.db task id (without the `nodeId:` prefix), used for write-back. */
  taskId: string
  title: string
  assignee: string | null
  status: string
  nodeId: HermesInstanceId
  accent: string
  /** Epoch seconds, for ordering the 已完成 list newest-first. */
  createdAt: number
  completedAt: number | null
}

export const navGroups: { title?: string; items: { id: string; label: string; icon: string; tooltip?: string; comingSoon?: boolean }[] }[] = [
  {
    items: [
      { id: 'new-chat', label: '新建对话', icon: 'message-circle-plus' },
      { id: 'auto-task', label: '自动任务', icon: 'clock' },
      { id: 'skills', label: '技能广场', icon: 'puzzle' },
    ],
  },
  {
    title: '本地知识库',
    items: [
      { id: 'apps', label: '应用', icon: 'package', comingSoon: true, tooltip: '即将上线' },
      { id: 'docs', label: '文档', icon: 'file-text', comingSoon: true, tooltip: '即将上线' },
      { id: 'gallery', label: '图库', icon: 'image', comingSoon: true, tooltip: '即将上线' },
      { id: 'pc', label: '此电脑', icon: 'monitor', comingSoon: true, tooltip: '即将上线' },
    ],
  },
]

/** Unified sub-agent logo — all agents share one horse glyph (per user request). */
export function agentGlyph(_name?: string): string {
  return '🐴'
}
