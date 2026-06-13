import { useDroppable } from '@dnd-kit/core'
import {
  boardColumns,
  type KanbanCardData,
  type KanbanColumnDef,
  type RealTask,
} from '../data/cyber'
import { KanbanCard } from './KanbanCard'
import { KanbanTaskCard } from './KanbanTaskCard'

function KanbanColumn({
  column,
  cards,
  tasks,
}: {
  column: KanbanColumnDef
  cards: KanbanCardData[]
  tasks: RealTask[]
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  const total = cards.length + tasks.length

  return (
    <div className="kanban-col" style={{ ['--col' as string]: column.head }}>
      <header className="kanban-col__head" title={column.desc}>
        <span className="kanban-col__title">{column.title}</span>
        <span className="kanban-col__count">{total}</span>
        <button type="button" className="kanban-col__add" aria-label="新建任务">
          +
        </button>
      </header>
      <div ref={setNodeRef} className={`kanban-col__body ${isOver ? 'is-over' : ''}`}>
        {total === 0 ? (
          <span className="kanban-col__empty">— 无任务 —</span>
        ) : (
          <>
            {tasks.map((task) => (
              <KanbanTaskCard key={task.id} task={task} />
            ))}
            {cards.map((card) => (
              <KanbanCard key={card.id} card={card} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

export function KanbanRow({ cards, tasks }: { cards: KanbanCardData[]; tasks: RealTask[] }) {
  return (
    <section className="kanban-row">
      {boardColumns.map((column) => (
        <KanbanColumn
          key={column.id}
          column={column}
          cards={cards.filter((card) => card.column === column.id)}
          tasks={tasks.filter((task) => task.status === column.id)}
        />
      ))}
    </section>
  )
}
