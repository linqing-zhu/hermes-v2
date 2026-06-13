import type { CSSProperties } from 'react'
import { useDraggable } from '@dnd-kit/core'
import type { RealTask } from '../data/cyber'

/**
 * Card mirroring a real task from a Hermes kanban.db. Draggable — but only the
 * 「已完成」/「阻塞」 columns accept the drop (handled in App via the official
 * complete_task / block_task write-back). Other columns ignore it.
 */
export function KanbanTaskCard({ task, overlay = false }: { task: RealTask; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: overlay,
  })

  const style: CSSProperties = {
    ['--accent' as string]: task.accent,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging && !overlay ? 0.3 : 1,
  }

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      className={`kanban-task ${overlay ? 'is-overlay' : ''}`}
      style={style}
      title={`${task.title}${task.assignee ? ` · ${task.assignee}` : ''} — 拖到「已完成」或「阻塞」可写回 Hermes`}
      {...(overlay ? {} : listeners)}
      {...(overlay ? {} : attributes)}
    >
      <p className="kanban-task__title">{task.title}</p>
      <div className="kanban-task__foot">
        <span className="kanban-task__assignee">{task.assignee || '未分配'}</span>
        <span className="kanban-task__live">实时</span>
      </div>
    </div>
  )
}
