import { MAX_MOUNT, type HermesNode, type LinkState, type NodeLinks } from '../data/cyber'
import type { HermesProfileAgent } from '../services/hermes'
import type { AgentStatus } from '../types/hermes'
import { SeatedBoss } from './office/SeatedBoss'

const statusLabel: Record<AgentStatus, string> = { online: '在线', busy: '忙碌', idle: '空闲' }
const linkLabel: Record<LinkState, string> = { up: '在线', warn: '重连', down: '断开', unknown: '未知' }

function LinkBadge({ label, state }: { label: string; state: LinkState }) {
  return (
    <span className={`link-badge link-badge--${state}`} title={`${label}：${linkLabel[state]}`}>
      <i className="link-badge__dot" />
      {label}
    </span>
  )
}

export function HermesRow({
  node,
  status,
  reachable,
  links,
  agents,
  outKeys,
  onConfigure,
  onChat,
  onAgentClick,
}: {
  node: HermesNode
  status: AgentStatus
  reachable: boolean
  links: NodeLinks
  agents: HermesProfileAgent[]
  outKeys: Set<string>
  onConfigure: () => void
  onChat: () => void
  onAgentClick: (agent: HermesProfileAgent) => void
}) {
  return (
    <div className="hermes-row" style={{ ['--accent' as string]: node.accent }}>
      <button type="button" className={`node-card ${reachable ? '' : 'is-offline'}`} onClick={onChat}>
        <strong className="node-card__name">{node.name}</strong>
        <SeatedBoss accent={node.accent} className="node-card__stage" />
        <div className="node-card__status">
          <em className={`node-status node-status--${status}`}>
            {reachable ? statusLabel[status] : '离线'}
          </em>
          <LinkBadge label="网关" state={links.gate} />
          <LinkBadge label="飞书" state={links.feishu} />
        </div>
      </button>

      <div className="desk-slots">
        {agents.map((agent) => {
          const out = outKeys.has(`${node.id}:${agent.id}`)
          return (
            <button
              key={agent.id}
              type="button"
              className={`desk-slot desk-slot--filled ${out ? 'is-out' : ''}`}
              onClick={() => onAgentClick(agent)}
              title={`${agent.name}${agent.model ? ` · ${agent.model}` : ''}${out ? ' — 出勤中' : ' — 点击派发任务'}`}
            >
              <span className="desk-slot__imgwrap">
                <img
                  src="/avatars/agent-horse-seated.svg"
                  alt=""
                  className="desk-slot__img desk-slot__img--seated"
                />
                <img
                  src="/avatars/agent-desk-empty.svg"
                  alt=""
                  className="desk-slot__img desk-slot__img--out"
                />
              </span>
              <span className="desk-slot__name">
                {agent.name}
                {out ? <em className="desk-slot__tag">出勤中</em> : null}
              </span>
            </button>
          )
        })}

        {agents.length < MAX_MOUNT ? (
          <button type="button" className="desk-slot desk-slot--empty" onClick={onConfigure}>
            <img src="/avatars/agent-desk-empty.svg" alt="" className="desk-slot__img desk-slot__img--empty" />
            <span className="desk-slot__overlay">
              <span className="desk-slot__plus">+</span>
              派驻 agent
            </span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
