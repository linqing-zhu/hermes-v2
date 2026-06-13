import { useDroppable } from '@dnd-kit/core'
import type { KanbanCardData, KanbanColumnDef, RealTask } from '../data/cyber'
import { KanbanCard } from './KanbanCard'
import { KanbanTaskCard } from './KanbanTaskCard'

/** One entry in the 已完成 list — either a local dispatch card or a real task. */
export type DoneItem =
  | { kind: 'card'; key: string; time: number; card: KanbanCardData }
  | { kind: 'task'; key: string; time: number; task: RealTask }

/**
 * 已完成 — tall, sticky, scrollable right-hand panel. Items arrive newest-first
 * (sorted by the caller); each has an X to drop it from the list. Still a droppable
 * `done` target so dragging a 实时 card here fires complete_task.
 */
export function DonePanel({
  column,
  items,
  onDismiss,
}: {
  column: KanbanColumnDef
  items: DoneItem[]
  onDismiss: (item: DoneItem) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  return (
    <aside className="done-panel" style={{ ['--col' as string]: column.head }}>
      <header className="done-panel__head" title={column.desc}>
        <span className="done-panel__title">{column.title}</span>
        <span className="done-panel__count">{items.length}</span>
      </header>
      <div ref={setNodeRef} className={`done-panel__body ${isOver ? 'is-over' : ''}`}>
        {items.length === 0 ? (
          <span className="kanban-col__empty">— 无任务 —</span>
        ) : (
          items.map((item) => (
            <div className="done-item" key={item.key}>
              {item.kind === 'card' ? (
                <KanbanCard card={item.card} />
              ) : (
                <KanbanTaskCard task={item.task} />
              )}
              <button
                type="button"
                className="done-item__x"
                title="从已完成列表移除"
                onClick={() => onDismiss(item)}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
