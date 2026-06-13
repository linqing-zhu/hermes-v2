export type AgentStatus = 'online' | 'busy' | 'idle'
export type TaskStatus = 'running' | 'scheduled' | 'paused' | 'done' | 'error'
export type ChatRole = 'user' | 'assistant' | 'tool'

export type HermesSessionSummary = {
  id: string
  source: string | null
  user_id: string | null
  model: string | null
  title: string | null
  started_at: number | null
  ended_at: number | null
  end_reason?: string | null
  message_count: number
  tool_call_count: number
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_tokens?: number | null
  cache_write_tokens?: number | null
  reasoning_tokens?: number | null
  estimated_cost_usd?: number | null
  actual_cost_usd?: number | null
  api_call_count?: number | null
  parent_session_id?: string | null
  last_active?: number | null
  preview?: string | null
  has_system_prompt?: boolean
  has_model_config?: boolean
}

export type HermesSessionsResponse = {
  object: string
  data: HermesSessionSummary[]
  limit: number
  offset: number
  has_more: boolean
}

export type HermesSessionDetailResponse = {
  object: string
  session: HermesSessionSummary
}

export type HermesMessageItem = {
  id: number | string
  session_id: string
  role: string
  content: string
  tool_call_id: string | null
  tool_calls: unknown[] | null
  tool_name: string | null
  timestamp: number | null
  token_count: number | null
  finish_reason: string | null
  reasoning: string | null
  reasoning_content: string | null
}

export type HermesSessionMessagesResponse = {
  object: string
  session_id: string
  data: HermesMessageItem[]
}

export type HermesSessionChatResponse = {
  object: string
  session_id: string
  message: {
    role: string
    content: string
  }
  usage?: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
}

export type HermesStreamEvent =
  // --- text streaming ---
  | {
      type: 'assistant.delta'
      data: {
        message_id?: string
        delta?: string
        session_id?: string
        run_id?: string
        seq?: number
        ts?: number
      }
    }
  | {
      type: 'assistant.completed'
      data: {
        session_id?: string
        message_id?: string
        content?: string
        completed?: boolean
        partial?: boolean
        interrupted?: boolean
        run_id?: string
        seq?: number
        ts?: number
      }
    }
  | {
      type: 'run.completed'
      data: {
        session_id?: string
        message_id?: string
        completed?: boolean
        messages?: Array<{
          role: string
          content: string
          finish_reason?: string
          reasoning?: string
          reasoning_content?: string
        }>
        usage?: {
          input_tokens: number
          output_tokens: number
          total_tokens: number
        }
        run_id?: string
        seq?: number
        ts?: number
      }
    }
  | {
      type: 'run.started'
      data: {
        session_id?: string
        run_id?: string
        user_message?: { id?: string; role?: string; content?: string }
      }
    }
  | {
      type: 'message.started'
      data: {
        session_id?: string
        run_id?: string
        message?: {
          id?: string
          role?: string
        }
      }
    }
  // --- tool lifecycle ---
  | {
      type: 'tool.started' | 'tool.pending' | 'tool.calling' | 'tool.running'
      data: {
        session_id?: string
        run_id?: string
        tool_call?: { id?: string; tool_name?: string; function?: { name?: string }; arguments?: unknown }
        tool?: { id?: string; name?: string }
        tool_name?: string
        name?: string
        args?: unknown
        preview?: string
        tool_call_id?: string
        call_id?: string
        id?: string
      }
    }
  | {
      type: 'tool.progress'
      data: {
        session_id?: string
        run_id?: string
        delta?: string
        tool_call?: { id?: string; tool_name?: string; function?: { name?: string }; arguments?: unknown }
        tool?: { id?: string; name?: string }
        tool_name?: string
        name?: string
        tool_call_id?: string
      }
    }
  | {
      type: 'tool.completed'
      data: {
        session_id?: string
        run_id?: string
        tool_call?: { id?: string; tool_name?: string; function?: { name?: string }; arguments?: unknown }
        tool?: { id?: string; name?: string }
        tool_name?: string
        name?: string
        tool_call_id?: string
        result_preview?: string
        result?: string
        output?: string
        message?: string
      }
    }
  | {
      type: 'tool.failed'
      data: {
        session_id?: string
        run_id?: string
        tool_call?: { id?: string; tool_name?: string; function?: { name?: string }; arguments?: unknown }
        tool_name?: string
        name?: string
        tool_call_id?: string
        error?: { message?: string }
        message?: string
      }
    }
  | {
      type: 'artifact.created'
      data: {
        session_id?: string
        run_id?: string
        artifact?: { title?: string; path?: string }
        tool_name?: string
        tool_call_id?: string
        path?: string
      }
    }
  | {
      type: 'memory.updated'
      data: {
        session_id?: string
        run_id?: string
        message?: string
        target?: string
        tool_call_id?: string
      }
    }
  | {
      type: 'skill.loaded'
      data: {
        session_id?: string
        run_id?: string
        skill?: { name?: string }
        skill_name?: string
        tool_call_id?: string
      }
    }
  // --- approval ---
  | {
      type: 'approval.required' | 'tool.approval' | 'exec.approval'
      data: {
        session_id?: string
        run_id?: string
        approval_id?: string
        approvalId?: string
        id?: string
        command?: string
        action?: string
        tool?: string
        description?: string
        context?: string
        input?: string
        agent_name?: string
        agent_id?: string
      }
    }
  // --- error ---
  | {
      type: 'error'
      data: {
        session_id?: string
        run_id?: string
        error?: { message?: string }
        message?: string
      }
    }
  // --- catch-all for unknown events ---
  | {
      type: string
      data: Record<string, unknown>
    }

export type HermesJob = {
  id: string
  name: string
  prompt: string | null
  skills: string[]
  skill: string | null
  model: string | null
  provider: string | null
  base_url: string | null
  script: string | null
  no_agent: boolean
  context_from: string | null
  schedule:
    | {
        kind: string
        expr: string
        display: string
      }
    | null
  schedule_display: string | null
  repeat:
    | {
        times: number | null
        completed: number | null
      }
    | null
  enabled: boolean
  state: string
  paused_at: string | null
  paused_reason: string | null
  created_at: string | null
  next_run_at: string | null
  last_run_at: string | null
  last_status: string | null
  last_error: string | null
  last_delivery_error: string | null
  deliver: string | null
  origin: string | null
  enabled_toolsets: string[] | null
  workdir: string | null
  profile: string | null
}

export type HermesJobsResponse = {
  jobs: HermesJob[]
}

export type HermesSkill = {
  name: string
  description: string | null
  category: string | null
}

export type HermesToolset = {
  name: string
  label: string
  description: string | null
  enabled: boolean
  configured: boolean
  tools: string[]
}

export type HermesListResponse<T> = {
  object: string
  platform?: string
  data: T[]
}
