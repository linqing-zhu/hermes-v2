import type { CSSProperties } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { agentGlyph, type KanbanCardData } from '../data/cyber'

export function KanbanCard({ card, overlay = false }: { card: KanbanCardData; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
    disabled: overlay,
  })

  const style: CSSProperties = {
    ['--accent' as string]: card.accent,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging && !overlay ? 0.3 : 1,
  }

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      className={`kanban-card ${card.column === 'running' ? 'is-working' : ''} ${overlay ? 'is-overlay' : ''}`}
      style={style}
      {...(overlay ? {} : listeners)}
      {...(overlay ? {} : attributes)}
    >
      <span className="kanban-card__glyph">{agentGlyph(card.agentName)}</span>
      <div className="kanban-card__meta">
        <strong>{card.agentName}</strong>
        <span>{card.task}</span>
      </div>
    </div>
  )
}
