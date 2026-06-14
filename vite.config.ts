import { execFile } from 'node:child_process'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const execFileAsync = promisify(execFile)
const viteEnv = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '')

// Cross-platform local Hermes layout: Windows `%LOCALAPPDATA%\hermes`, else `~/.hermes`.
const isWindows = process.platform === 'win32'
const localHermesHome = isWindows
  ? path.join(process.env.LOCALAPPDATA ?? '', 'hermes')
  : path.join(os.homedir(), '.hermes')
const hermesConfigPath = path.join(localHermesHome, 'config.yaml')
const hermesPythonPath = isWindows
  ? path.join(localHermesHome, 'hermes-agent', 'venv', 'Scripts', 'python.exe')
  : path.join(localHermesHome, 'hermes-agent', 'venv', 'bin', 'python')
const localSystem = isWindows ? 'win' : process.platform === 'darwin' ? 'macos' : 'linux'

function readHermesConfigValue(key: string) {
  if (!hermesConfigPath || !fs.existsSync(hermesConfigPath)) {
    return ''
  }

  const file = fs.readFileSync(hermesConfigPath, 'utf8')
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matcher = new RegExp(`^${escapedKey}:\\s*(.+)$`, 'm')
  const match = file.match(matcher)

  return match?.[1]?.trim() ?? ''
}

// Local node connection, auto-detected from the machine running `npm run dev`.
const hermesApiKey = readHermesConfigValue('API_SERVER_KEY')
const hermesHost = readHermesConfigValue('API_SERVER_HOST') || '127.0.0.1'
const hermesPort = readHermesConfigValue('API_SERVER_PORT') || '8642'
const hermesTargetHost = hermesHost === '0.0.0.0' ? '127.0.0.1' : hermesHost
const hermesApiTarget = `http://${hermesTargetHost}:${hermesPort}`
// The web console gets its OWN session (not the Feishu ou_ id) so it doesn't share memory.
const hermesSessionKey = readEnv('HERMES_SESSION_KEY') || 'web-console'
const hermes1SessionKey = hermesSessionKey

type HermesInstanceId = 'hermes1' | 'hermes2' | 'hermes3'
type SkillBridgeConfig =
  | {
      mode: 'local'
      system: string
      name: string
    }
  | {
      mode: 'remote'
      system: string
      name: string
      baseUrl: string
      token?: string
    }
  | {
      mode: 'unconfigured'
      system: string
      name: string
      envKey: string
    }

function normalizeUrl(url: string) {
  return url.trim().replace(/\/+$/, '')
}

function maskSessionKey(value: string) {
  if (!value) {
    return '未配置'
  }

  if (value.length <= 10) {
    return value
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function readEnv(name: string) {
  return (process.env[name] ?? viteEnv[name] ?? '').trim()
}

function readBridgeEnv(name: string) {
  return normalizeUrl(readEnv(name))
}

type ObsidianNote = {
  title: string
  path: string
  relativePath: string
  mtime: number
  size: number
  preview: string
}

function titleFromMarkdown(filePath: string, content: string) {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (heading) return heading
  return path.basename(filePath).replace(/\.(md|markdown)$/i, '')
}

function previewFromMarkdown(content: string) {
  return content
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#+\s+/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#-]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 180)
}

function scanObsidianNotes(rootInput: string) {
  const root = path.resolve(rootInput.trim())
  if (!root || !fs.existsSync(root)) {
    throw new Error('目录不存在')
  }
  const stat = fs.statSync(root)
  if (!stat.isDirectory()) {
    throw new Error('请输入 Obsidian vault 的文件夹路径')
  }

  const notes: ObsidianNote[] = []
  const maxNotes = 300
  const maxDirs = 2000
  let dirCount = 0
  let truncated = false

  const walk = (dir: string) => {
    if (notes.length >= maxNotes || dirCount >= maxDirs) {
      truncated = true
      return
    }
    dirCount += 1
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (notes.length >= maxNotes) {
        truncated = true
        return
      }
      if (entry.name.startsWith('.obsidian') || entry.name === '.git' || entry.name === 'node_modules') continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (!entry.isFile() || !/\.(md|markdown)$/i.test(entry.name)) continue
      try {
        const fileStat = fs.statSync(fullPath)
        const content = fs.readFileSync(fullPath, 'utf8')
        notes.push({
          title: titleFromMarkdown(fullPath, content),
          path: fullPath,
          relativePath: path.relative(root, fullPath),
          mtime: fileStat.mtimeMs,
          size: fileStat.size,
          preview: previewFromMarkdown(content),
        })
      } catch {
        // Ignore unreadable notes and continue scanning the vault.
      }
    }
  }

  walk(root)
  notes.sort((a, b) => b.mtime - a.mtime)
  return { root, notes, truncated }
}

function readObsidianNote(rootInput: string, relativePathInput: string) {
  const root = path.resolve(rootInput.trim())
  const filePath = path.resolve(root, relativePathInput)
  const relative = path.relative(root, filePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('笔记路径不在 Obsidian 目录内')
  }
  if (!/\.(md|markdown)$/i.test(filePath)) {
    throw new Error('只能打开 Markdown 笔记')
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error('笔记不存在')
  }
  const content = fs.readFileSync(filePath, 'utf8')
  return {
    title: titleFromMarkdown(filePath, content),
    path: filePath,
    relativePath: relative,
    content,
  }
}

// #region debug-point A:proxy-session-key
function readDebugServerConfig() {
  const envPath = path.join(process.cwd(), '.dbg', 'hermes-memory-header.env')
  let url = 'http://127.0.0.1:7777/event'
  let sessionId = 'hermes-memory-header'

  try {
    const envText = fs.readFileSync(envPath, 'utf8')
    url =
      envText.match(/^DEBUG_SERVER_URL=(.+)$/m)?.[1]?.trim() ??
      url
    sessionId =
      envText.match(/^DEBUG_SESSION_ID=(.+)$/m)?.[1]?.trim() ??
      sessionId
  } catch {
    // Ignore missing env file during normal development.
  }

  return { url, sessionId }
}

function reportDebugEvent(hypothesisId: 'A' | 'B' | 'C' | 'D', msg: string, data: Record<string, unknown>) {
  const { url, sessionId } = readDebugServerConfig()
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sessionId,
      runId: 'pre-fix',
      hypothesisId,
      location: 'vite.config.ts',
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {})
}

function withProxyDebug(instanceId: HermesInstanceId, expectedSessionKey: string | null) {
  return {
    configure(proxy: any) {
      proxy.on('proxyReq', (proxyReq: any, req: IncomingMessage) => {
        const forwardedSessionKey = proxyReq.getHeader('X-Hermes-Session-Key')
        reportDebugEvent('A', 'proxy request forwarded', {
          instanceId,
          method: req.method ?? null,
          url: req.url ?? null,
          expectedSessionKey,
          browserSessionKey:
            typeof req.headers['x-hermes-session-key'] === 'string'
              ? req.headers['x-hermes-session-key']
              : null,
          forwardedSessionKey:
            typeof forwardedSessionKey === 'string' ? forwardedSessionKey : null,
        })
      })

      proxy.on('proxyRes', (proxyRes: IncomingMessage, req: IncomingMessage) => {
        reportDebugEvent('D', 'proxy response received', {
          instanceId,
          method: req.method ?? null,
          url: req.url ?? null,
          statusCode: proxyRes.statusCode ?? null,
        })
      })
    },
  }
}
// #endregion

const skillBridgeConfigs: Record<HermesInstanceId, SkillBridgeConfig> = {
  hermes1: {
    mode: 'local',
    system: 'win',
    name: '真维斯_win',
  },
  hermes2: readBridgeEnv('HERMES2_SKILL_BRIDGE_URL')
    ? {
        mode: 'remote',
        system: 'ubuntu',
        name: '贾维斯_ubuntu',
        baseUrl: readBridgeEnv('HERMES2_SKILL_BRIDGE_URL'),
        token: readEnv('HERMES2_SKILL_BRIDGE_TOKEN') || undefined,
      }
    : {
        mode: 'unconfigured',
        system: 'ubuntu',
        name: '贾维斯_ubuntu',
        envKey: 'HERMES2_SKILL_BRIDGE_URL',
      },
  hermes3: readBridgeEnv('HERMES3_SKILL_BRIDGE_URL')
    ? {
        mode: 'remote',
        system: 'macos',
        name: '李维斯_macos',
        baseUrl: readBridgeEnv('HERMES3_SKILL_BRIDGE_URL'),
        token: readEnv('HERMES3_SKILL_BRIDGE_TOKEN') || undefined,
      }
    : {
        mode: 'unconfigured',
        system: 'macos',
        name: '李维斯_macos',
        envKey: 'HERMES3_SKILL_BRIDGE_URL',
      },
}

const skillConfigReadScript = String.raw`
import json
import sys

from hermes_cli.config import load_config
from hermes_cli.skills_config import get_disabled_skills

platform = sys.argv[1] if len(sys.argv) > 1 else "api_server"
config = load_config()
disabled = sorted(get_disabled_skills(config, platform))
print(json.dumps({"platform": platform, "disabledSkillNames": disabled}, ensure_ascii=False))
`

const skillConfigWriteScript = String.raw`
import json
import sys

from hermes_cli.config import load_config
from hermes_cli.skills_config import get_disabled_skills, save_disabled_skills

platform = sys.argv[1]
skill_name = sys.argv[2]
enabled = sys.argv[3].lower() == "true"

config = load_config()
disabled = set(get_disabled_skills(config, platform))

if enabled:
    disabled.discard(skill_name)
else:
    disabled.add(skill_name)

save_disabled_skills(config, disabled, platform)
print(json.dumps({"platform": platform, "disabledSkillNames": sorted(disabled)}, ensure_ascii=False))
`

const kanbanListScript = String.raw`
import json
import sys

from hermes_cli.kanban import get_board, list_tasks, create_board

board_name = sys.argv[1] if len(sys.argv) > 1 else "default"

try:
    board = get_board(board_name)
except Exception:
    board = create_board(board_name)

tasks = list_tasks(board)
print(json.dumps([t.to_dict() for t in tasks], ensure_ascii=False))
`

async function runHermesPython(script: string, args: string[]) {
  if (!fs.existsSync(hermesPythonPath)) {
    throw new Error('未找到本机 Hermes Python 环境，无法启用技能桥接。')
  }

  const { stdout } = await execFileAsync(hermesPythonPath, ['-c', script, ...args], {
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', HERMES_HOME: localHermesHome },
  })

  return stdout.trim()
}

const kanbanTasksScript = [
  'import json, hermes_cli.kanban_db as d',
  'conn = d.connect()',
  'g = lambda t, k: (t[k] if isinstance(t, dict) else getattr(t, k, None))',
  'print(json.dumps([{"id": g(t, "id"), "title": g(t, "title"), "assignee": g(t, "assignee"), "status": g(t, "status"), "created_at": g(t, "created_at"), "completed_at": g(t, "completed_at")} for t in d.list_tasks(conn)], ensure_ascii=False))',
].join('\n')

function parseKanbanStdout(stdout: string) {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('['))
    .pop()
  if (!line) return []
  try {
    return JSON.parse(line) as Array<Record<string, unknown>>
  } catch {
    return []
  }
}

async function readRemoteKanban(alias: string) {
  const remoteCmd =
    `H="$HOME/.hermes"; PY="$H/hermes-agent/venv/bin/python"; [ -x "$PY" ] || PY=python3; ` +
    `PYTHONIOENCODING=utf-8 HERMES_HOME="$H" "$PY" -c '${kanbanTasksScript}'`
  const { stdout } = await execFileAsync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', alias, remoteCmd],
    { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 },
  )
  return parseKanbanStdout(stdout)
}

// SAFE kanban write-back. Only three whitelisted operations are ever issued —
// `create` (create_task), `complete` (complete_task), `block` (block_task) —
// each delegating to the official `hermes_cli.kanban_db` functions, NOT raw SQL.
// Those functions enforce Hermes' own guarded status transitions (e.g. complete
// only fires from running|ready|blocked), so arbitrary cross-column hard writes
// are impossible. The JSON payload is passed base64-encoded so it is shell-safe
// over SSH; the script below contains only double quotes for the same reason.
const ALLOWED_KANBAN_OPS = ['create', 'complete', 'block'] as const
type KanbanWriteOp = (typeof ALLOWED_KANBAN_OPS)[number]

const kanbanWriteScript = String.raw`
import base64, json, sys
import hermes_cli.kanban_db as d

op = sys.argv[1]
payload = json.loads(base64.b64decode(sys.argv[2]).decode("utf-8"))
conn = d.connect()

if op == "create":
    # create_task lands a task in 'ready' (no parents) or 'triage' (triage=True).
    # We never pass initial_status (that path is only for blocked|running). 'triage'
    # is the safe default — it parks for a specifier; 'ready' is claimable by the
    # dispatcher (real token cost), so it is an explicit opt-in.
    status = payload.get("initial_status") or "triage"
    kwargs = dict(
        title=payload["title"],
        body=(payload.get("body") or None),
        assignee=(payload.get("assignee") or None),
        created_by=(payload.get("created_by") or "control-center"),
        priority=int(payload.get("priority") or 0),
    )
    if status != "ready":
        kwargs["triage"] = True
    tid = d.create_task(conn, **kwargs)
    landed = d.get_task(conn, tid)
    print(json.dumps({"ok": True, "op": op, "id": tid, "status": (landed.status if landed is not None else status)}, ensure_ascii=False))
elif op == "complete":
    ok = d.complete_task(conn, payload["id"], result=(payload.get("result") or None))
    print(json.dumps({"ok": bool(ok), "op": op, "id": payload["id"]}, ensure_ascii=False))
elif op == "block":
    ok = d.block_task(conn, payload["id"], reason=(payload.get("reason") or None))
    print(json.dumps({"ok": bool(ok), "op": op, "id": payload["id"]}, ensure_ascii=False))
else:
    print(json.dumps({"ok": False, "error": "unknown op: " + str(op)}, ensure_ascii=False))
`

function parseKanbanWriteStdout(stdout: string): Record<string, unknown> {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .pop()
  if (!line) {
    return { ok: false, error: '写回脚本无有效输出' }
  }
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return { ok: false, error: '写回脚本输出无法解析' }
  }
}

async function runRemoteKanbanWrite(alias: string, op: KanbanWriteOp, b64: string) {
  const remoteCmd =
    `H="$HOME/.hermes"; PY="$H/hermes-agent/venv/bin/python"; [ -x "$PY" ] || PY=python3; ` +
    `PYTHONIOENCODING=utf-8 HERMES_HOME="$H" "$PY" -c '${kanbanWriteScript}' ${op} ${b64}`
  const { stdout } = await execFileAsync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', alias, remoteCmd],
    { windowsHide: true, timeout: 25000, maxBuffer: 4 * 1024 * 1024 },
  )
  return parseKanbanWriteStdout(stdout)
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function readJsonBody(req: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let raw = ''

    req.on('data', (chunk) => {
      raw += chunk
    })

    req.on('end', () => {
      if (!raw) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(raw) as Record<string, unknown>)
      } catch {
        reject(new Error('请求体不是合法的 JSON'))
      }
    })

    req.on('error', reject)
  })
}

function getSkillBridgeConfig(instanceId: string) {
  if (instanceId === 'hermes1' || instanceId === 'hermes2' || instanceId === 'hermes3') {
    return skillBridgeConfigs[instanceId]
  }

  return null
}

function buildOfficeRuntimeConfig() {
  return {
    officeName: 'Hermes 办公室',
    mode: 'local_dispatch_center' as const,
    memory: {
      sessionHeader: 'X-Hermes-Session-Key',
      sessionKeyStrategy: '网页经本地代理注入会话暗号（本机自动，远程节点在配置里填写）',
    },
    dispatch: {
      intervalSeconds: 60,
      failureLimit: 2,
      autoDecompose: true,
      staleTimeoutSeconds: 14_400,
    },
    // The auto-detected local node (this machine). Remote nodes are user-added in 配置.
    localNode: {
      id: 'local',
      name: '本机 Hermes',
      system: localSystem,
      host: `${hermesTargetHost}:${hermesPort}`,
      proxyPrefix: '/hermes-api',
      sessionKeyPreview: maskSessionKey(hermes1SessionKey),
      detected: fs.existsSync(hermesConfigPath),
    },
  }
}

function readProfileModel(configText: string) {
  const block = configText.match(/^model:\s*\n((?:[ \t]+.*\n?)+)/m)?.[1] ?? ''
  const model = block.match(/^[ \t]+default:\s*(.+)$/m)?.[1]?.trim() ?? ''
  const provider =
    block.match(/^[ \t]+provider:\s*(.+)$/m)?.[1]?.trim() ??
    configText.match(/^[ \t]*provider:\s*(.+)$/m)?.[1]?.trim() ??
    ''
  return { model, provider }
}

function readLocalProfiles() {
  const dir = path.join(localHermesHome, 'profiles')
  if (!fs.existsSync(dir)) {
    return []
  }

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      let model = ''
      let provider = ''
      try {
        const cfg = fs.readFileSync(path.join(dir, entry.name, 'config.yaml'), 'utf8')
        ;({ model, provider } = readProfileModel(cfg))
      } catch {
        // A profile without a readable config still counts as an agent.
      }
      return { id: entry.name, name: entry.name, model, provider }
    })
}

// Routing for the fs/ssh bridges (profiles, kanban). The local node reads this
// machine directly; a remote node is reached only if the user configured a
// passwordless SSH alias for it. Validate the alias to a safe charset.
const SAFE_SSH_ALIAS = /^[\w.@-]{1,64}$/

type BridgeRoute = { local: boolean; alias: string | null; error?: string }

function readBridgeRoute(params: URLSearchParams | Record<string, unknown>): BridgeRoute {
  const get = (k: string): string =>
    params instanceof URLSearchParams
      ? params.get(k) ?? ''
      : typeof params[k] === 'string'
        ? (params[k] as string)
        : ''
  const source = get('source')
  const ssh = get('ssh').trim()
  if (source === 'local' || (!source && !ssh)) return { local: true, alias: null }
  if (ssh) {
    if (!SAFE_SSH_ALIAS.test(ssh)) return { local: false, alias: null, error: 'ssh 别名含非法字符' }
    return { local: false, alias: ssh }
  }
  return { local: false, alias: null, error: '缺少 source=local 或 ssh=<别名>' }
}

const remoteProfilesScript = [
  'D="$HOME/.hermes/profiles"; [ -d "$D" ] || exit 0;',
  'for p in "$D"/*/; do [ -d "$p" ] || continue;',
  'n=$(basename "$p"); c="$p/config.yaml"; m=""; pr="";',
  'if [ -f "$c" ]; then',
  "m=$(grep -A3 '^model:' \"$c\" | grep 'default:' | head -1 | sed 's/.*default:[[:space:]]*//');",
  "pr=$(grep -A3 '^model:' \"$c\" | grep 'provider:' | head -1 | sed 's/.*provider:[[:space:]]*//');",
  'fi;',
  "printf '%s\\t%s\\t%s\\n' \"$n\" \"$m\" \"$pr\";",
  'done',
].join(' ')

async function readRemoteProfiles(alias: string) {
  const { stdout } = await execFileAsync(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=8',
      '-o',
      'StrictHostKeyChecking=no',
      alias,
      remoteProfilesScript,
    ],
    { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
  )

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, model = '', provider = ''] = line.split('\t')
      return { id: name, name, model: model.trim(), provider: provider.trim() }
    })
}

// --- create a sub-agent by template-copying an existing profile's config.yaml ---
// Profile names become directory names, so they are restricted to a safe charset.
const SAFE_PROFILE_NAME = /^[\w一-龥-]{1,32}$/
const SAFE_MODEL = /^[\w.\-:/]{1,64}$/

/** Overwrite default/provider inside the top-level `model:` block, preserving the rest. */
function applyModelOverride(text: string, model: string, provider: string) {
  if (!model && !provider) return text
  return text.replace(/^(model:[ \t]*\n)([\s\S]*?)(?=^\S)/m, (_whole, head: string, block: string) => {
    let b = block
    if (model) b = b.replace(/^([ \t]+default:[ \t]*).*$/m, `$1${model}`)
    if (provider) b = b.replace(/^([ \t]+provider:[ \t]*).*$/m, `$1${provider}`)
    return head + b
  })
}

function createLocalProfile(name: string, template: string, model: string, provider: string) {
  const dir = path.join(localHermesHome, 'profiles')
  const templateCfg = path.join(dir, template, 'config.yaml')
  const newDir = path.join(dir, name)
  if (!fs.existsSync(templateCfg)) throw new Error(`模板 profile 不存在：${template}`)
  if (fs.existsSync(newDir)) throw new Error(`profile 已存在：${name}`)
  let cfg = fs.readFileSync(templateCfg, 'utf8')
  cfg = applyModelOverride(cfg, model, provider)
  fs.mkdirSync(newDir, { recursive: true })
  fs.writeFileSync(path.join(newDir, 'config.yaml'), cfg, 'utf8')
}

/** Create the first profile from the root config.yaml (no existing profiles to template). */
function createLocalFirstProfile(name: string, model: string, provider: string) {
  const dir = path.join(localHermesHome, 'profiles')
  const rootCfg = hermesConfigPath
  const newDir = path.join(dir, name)
  if (!fs.existsSync(rootCfg)) throw new Error('主配置文件 config.yaml 不存在')
  if (fs.existsSync(newDir)) throw new Error(`profile 已存在：${name}`)
  let cfg = fs.readFileSync(rootCfg, 'utf8')
  cfg = applyModelOverride(cfg, model, provider)
  fs.mkdirSync(newDir, { recursive: true })
  fs.writeFileSync(path.join(newDir, 'config.yaml'), cfg, 'utf8')
}

async function createRemoteFirstProfile(alias: string, name: string, model: string, provider: string) {
  // Copy the root config.yaml as the first profile template
  const cmd =
    `D="$HOME/.hermes/profiles"; ` +
    `mkdir -p "$D" && ` +
    `N="$D/${name}"; ` +
    `[ -e "$N" ] && { echo EXISTS; exit 0; }; ` +
    `mkdir -p "$N" && ` +
    `cp "$HOME/.hermes/config.yaml" "$N/config.yaml"`
  const { stdout: mkdirOut } = await execFileAsync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', alias, cmd],
    { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 },
  )
  const mkdirResult = mkdirOut.trim()
  if (mkdirResult.includes('EXISTS')) throw new Error(`profile 已存在：${name}`)

  // Now apply model override via python
  const overrideCmd =
    `D="$HOME/.hermes/profiles"; PY="$HOME/.hermes/hermes-agent/venv/bin/python"; [ -x "$PY" ] || PY=python3; ` +
    `PYTHONIOENCODING=utf-8 "$PY" -c '${remoteProfileOverrideScript}' "$D/${name}/config.yaml" "${model}" "${provider}" && echo OK`
  const { stdout } = await execFileAsync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', alias, overrideCmd],
    { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 },
  )
  const out = stdout.trim()
  if (!out.includes('OK')) throw new Error(`远程创建失败：${out || '(无输出)'}`)
}

// Remote override runs in python for robust in-place YAML line edits (no yaml dep).
const remoteProfileOverrideScript = String.raw`
import sys, re
p = sys.argv[1]
model = sys.argv[2] if len(sys.argv) > 2 else ""
provider = sys.argv[3] if len(sys.argv) > 3 else ""
t = open(p, encoding="utf-8").read()
def repl(m):
    b = m.group(2)
    if model:
        b = re.sub(r"(?m)^([ \t]+default:[ \t]*).*$", lambda x: x.group(1) + model, b, count=1)
    if provider:
        b = re.sub(r"(?m)^([ \t]+provider:[ \t]*).*$", lambda x: x.group(1) + provider, b, count=1)
    return m.group(1) + b
t = re.sub(r"(?ms)^(model:[ \t]*\n)(.*?)(?=^\S)", repl, t, count=1)
open(p, "w", encoding="utf-8").write(t)
`

async function createRemoteProfile(
  alias: string,
  name: string,
  template: string,
  model: string,
  provider: string,
) {
  // name/template are SAFE_PROFILE_NAME-validated; model/provider SAFE_MODEL — no shell metachars.
  const cmd =
    `D="$HOME/.hermes/profiles"; PY="$HOME/.hermes/hermes-agent/venv/bin/python"; [ -x "$PY" ] || PY=python3; ` +
    `N="$D/${name}"; T="$D/${template}"; ` +
    `[ -d "$T" ] || { echo NOTEMPLATE; exit 0; }; ` +
    `[ -e "$N" ] && { echo EXISTS; exit 0; }; ` +
    `mkdir -p "$N" && cp "$T/config.yaml" "$N/config.yaml" && ` +
    `PYTHONIOENCODING=utf-8 "$PY" -c '${remoteProfileOverrideScript}' "$N/config.yaml" "${model}" "${provider}" && echo OK`
  const { stdout } = await execFileAsync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', alias, cmd],
    { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 },
  )
  const out = stdout.trim()
  if (out.includes('NOTEMPLATE')) throw new Error(`模板 profile 不存在：${template}`)
  if (out.includes('EXISTS')) throw new Error(`profile 已存在：${name}`)
  if (!out.includes('OK')) throw new Error(`远程创建失败：${out || '(无输出)'}`)
}

async function relaySkillBridgeRequest(
  config: Extract<SkillBridgeConfig, { mode: 'remote' }>,
  req: IncomingMessage,
  body?: Record<string, unknown>,
) {
  const url = `${config.baseUrl}/skills-config`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`
  }

  const response = await fetch(url, {
    method: req.method,
    headers,
    body:
      req.method === 'PATCH'
        ? JSON.stringify({
            ...body,
            platform: 'api_server',
          })
        : undefined,
  })

  const text = await response.text()
  return {
    status: response.status,
    body: text,
  }
}

function createSkillsBridgePlugin(): Plugin {
  return {
    name: 'hermes-skills-bridge',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ? new URL(req.url, 'http://127.0.0.1') : null
        if (!url) {
          next()
          return
        }

        if (url.pathname === '/local-bridge/runtime-config') {
          if (req.method !== 'GET') {
            writeJson(res, 405, { error: 'Method Not Allowed' })
            return
          }

          writeJson(res, 200, buildOfficeRuntimeConfig())
          return
        }

        // Persist custom nodes to disk so they survive browser changes.
        const nodesJsonPath = path.join(localHermesHome, 'web-nodes.json')

        function readNodesFromDisk() {
          try {
            if (fs.existsSync(nodesJsonPath)) {
              const raw = fs.readFileSync(nodesJsonPath, 'utf8')
              return JSON.parse(raw)
            }
          } catch {
            // ignore
          }
          return []
        }

        function writeNodesToDisk(nodes: unknown) {
          try {
            const dir = path.dirname(nodesJsonPath)
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(nodesJsonPath, JSON.stringify(nodes, null, 2), 'utf8')
          } catch {
            // ignore
          }
        }

        if (url.pathname === '/local-bridge/nodes') {
          if (req.method === 'GET') {
            writeJson(res, 200, readNodesFromDisk())
            return
          }
          if (req.method === 'PUT') {
            try {
              const body = await readJsonBody(req)
              writeNodesToDisk(body)
              writeJson(res, 200, { ok: true })
            } catch (err) {
              writeJson(res, 500, { error: err instanceof Error ? err.message : '保存节点失败' })
            }
            return
          }
          writeJson(res, 405, { error: 'Method Not Allowed' })
          return
        }

        if (url.pathname === '/local-bridge/obsidian-notes') {
          if (req.method !== 'GET') {
            writeJson(res, 405, { error: 'Method Not Allowed' })
            return
          }
          const root = url.searchParams.get('root') || ''
          if (!root.trim()) {
            writeJson(res, 400, { error: '缺少 Obsidian 目录' })
            return
          }
          try {
            writeJson(res, 200, scanObsidianNotes(root))
          } catch (error) {
            writeJson(res, 400, { error: error instanceof Error ? error.message : '读取 Obsidian 笔记失败' })
          }
          return
        }

        if (url.pathname === '/local-bridge/obsidian-note') {
          if (req.method !== 'GET') {
            writeJson(res, 405, { error: 'Method Not Allowed' })
            return
          }
          const root = url.searchParams.get('root') || ''
          const file = url.searchParams.get('file') || ''
          if (!root.trim() || !file.trim()) {
            writeJson(res, 400, { error: '缺少笔记路径' })
            return
          }
          try {
            writeJson(res, 200, readObsidianNote(root, file))
          } catch (error) {
            writeJson(res, 400, { error: error instanceof Error ? error.message : '读取 Markdown 笔记失败' })
          }
          return
        }

        if (url.pathname === '/local-bridge/kanban/list') {
          if (req.method !== 'GET') {
            writeJson(res, 405, { error: 'Method Not Allowed' })
            return
          }

          const board = url.searchParams.get('board') || 'default'
          try {
            const stdout = await runHermesPython(kanbanListScript, [board])
            writeJson(res, 200, JSON.parse(stdout))
          } catch (error) {
            writeJson(res, 500, {
              error: error instanceof Error ? error.message : 'Kanban 数据获取失败',
            })
          }
          return
        }

        if (url.pathname === '/local-bridge/profiles') {
          // POST = create a sub-agent (template-copy an existing profile + optional model override).
          if (req.method === 'POST') {
            try {
              const body = await readJsonBody(req)
              const route = readBridgeRoute(body)
              const name = (typeof body.name === 'string' ? body.name : '').trim()
              const template = (typeof body.template === 'string' ? body.template : '').trim()
              const model = (typeof body.model === 'string' ? body.model : '').trim()
              const provider = (typeof body.provider === 'string' ? body.provider : '').trim()

              if (!SAFE_PROFILE_NAME.test(name)) {
                writeJson(res, 400, { error: '名字只能用 字母/数字/汉字/下划线/-，1–32 位' })
                return
              }
              if (template && !SAFE_PROFILE_NAME.test(template)) {
                writeJson(res, 400, { error: '模板 profile 无效' })
                return
              }
              // When no template is specified (empty string → first profile for this node),
              // create from the root config.yaml as the base template.
              if (!template) {
                if (route.local) {
                  createLocalFirstProfile(name, model, provider)
                } else {
                  await createRemoteFirstProfile(route.alias as string, name, model, provider)
                }
                writeJson(res, 200, { ok: true, name })
                return
              }
              if (model && !SAFE_MODEL.test(model)) {
                writeJson(res, 400, { error: '模型名包含非法字符' })
                return
              }
              if (provider && !SAFE_MODEL.test(provider)) {
                writeJson(res, 400, { error: 'provider 包含非法字符' })
                return
              }

              if (route.error) {
                writeJson(res, 400, { error: route.error })
                return
              }
              if (route.local) {
                createLocalProfile(name, template, model, provider)
              } else {
                await createRemoteProfile(route.alias as string, name, template, model, provider)
              }
              writeJson(res, 200, { ok: true, name })
            } catch (error) {
              writeJson(res, 500, {
                error: error instanceof Error ? error.message : '创建 profile 失败',
              })
            }
            return
          }

          if (req.method !== 'GET') {
            writeJson(res, 405, { error: 'Method Not Allowed' })
            return
          }

          const route = readBridgeRoute(url.searchParams)
          // local = this machine (fs); remote requires a configured SSH alias.
          if (route.local) {
            writeJson(res, 200, { available: true, agents: readLocalProfiles() })
            return
          }
          if (!route.alias) {
            writeJson(res, 200, { available: false, reason: route.error ?? '未配置 SSH 别名', agents: [] })
            return
          }

          try {
            const agents = await readRemoteProfiles(route.alias)
            writeJson(res, 200, { available: true, agents })
          } catch (error) {
            writeJson(res, 200, {
              available: false,
              reason: `SSH 读取失败（该机离线或未开 SSH）：${error instanceof Error ? error.message : String(error)}`,
              agents: [],
            })
          }
          return
        }

        if (url.pathname === '/local-bridge/kanban') {
          if (req.method !== 'GET') {
            writeJson(res, 405, { error: 'Method Not Allowed' })
            return
          }

          const route = readBridgeRoute(url.searchParams)
          if (!route.local && !route.alias) {
            writeJson(res, 200, { available: false, reason: route.error ?? '未配置 SSH 别名', tasks: [] })
            return
          }
          try {
            const tasks = route.local
              ? parseKanbanStdout(await runHermesPython(kanbanTasksScript, []))
              : await readRemoteKanban(route.alias as string)
            writeJson(res, 200, { available: true, tasks })
          } catch (error) {
            writeJson(res, 200, {
              available: false,
              reason: error instanceof Error ? error.message : String(error),
              tasks: [],
            })
          }
          return
        }

        if (url.pathname === '/local-bridge/kanban/write') {
          if (req.method !== 'POST') {
            writeJson(res, 405, { error: 'Method Not Allowed' })
            return
          }

          try {
            const body = await readJsonBody(req)
            const route = readBridgeRoute(body)
            const op = typeof body.op === 'string' ? body.op : ''
            if (!ALLOWED_KANBAN_OPS.includes(op as KanbanWriteOp)) {
              writeJson(res, 400, { error: `不允许的看板操作：${op || '(空)'}` })
              return
            }
            if (route.error || (!route.local && !route.alias)) {
              writeJson(res, 400, { error: route.error ?? '未配置 SSH 别名' })
              return
            }
            const payload =
              body.payload && typeof body.payload === 'object'
                ? (body.payload as Record<string, unknown>)
                : {}
            const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')

            const result = route.local
              ? parseKanbanWriteStdout(await runHermesPython(kanbanWriteScript, [op, b64]))
              : await runRemoteKanbanWrite(route.alias as string, op as KanbanWriteOp, b64)
            writeJson(res, 200, { ...result })
          } catch (error) {
            writeJson(res, 500, {
              error: error instanceof Error ? error.message : '看板写回执行失败',
            })
          }
          return
        }

        // Generic forward proxy for user-added remote nodes' HTTP API: keeps the
        // API key server-side, dodges CORS, and pipes the upstream response
        // (works for both JSON and SSE chat streams).
        if (url.pathname === '/local-bridge/forward') {
          if (req.method !== 'POST') {
            writeJson(res, 405, { error: 'Method Not Allowed' })
            return
          }
          try {
            const body = await readJsonBody(req)
            const baseUrl = typeof body.baseUrl === 'string' ? normalizeUrl(body.baseUrl) : ''
            const apiKey = typeof body.apiKey === 'string' ? body.apiKey : ''
            const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey : ''
            const targetPath = typeof body.path === 'string' ? body.path : ''
            const method = typeof body.method === 'string' ? body.method : 'GET'
            const timeoutMs = typeof body.timeoutMs === 'number' ? body.timeoutMs : 20000

            if (!/^https?:\/\//.test(baseUrl)) {
              writeJson(res, 400, { error: 'baseUrl 非法（需 http(s)://host:port）' })
              return
            }
            if (!targetPath.startsWith('/')) {
              writeJson(res, 400, { error: 'path 必须以 / 开头' })
              return
            }

            const headers: Record<string, string> = {}
            if (apiKey) headers.Authorization = `Bearer ${apiKey}`
            if (sessionKey) headers['X-Hermes-Session-Key'] = sessionKey
            if (typeof body.accept === 'string') headers.Accept = body.accept
            let payload: string | undefined
            if (body.body !== undefined && body.body !== null) {
              payload = typeof body.body === 'string' ? body.body : JSON.stringify(body.body)
              headers['Content-Type'] = 'application/json'
            }

            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), timeoutMs)
            try {
              const upstream = await fetch(`${baseUrl}${targetPath}`, {
                method,
                headers,
                body: payload,
                signal: controller.signal,
              })
              res.statusCode = upstream.status
              const ct = upstream.headers.get('content-type')
              if (ct) res.setHeader('Content-Type', ct)
              if (upstream.body) {
                Readable.fromWeb(upstream.body as never).pipe(res)
              } else {
                res.end()
              }
            } finally {
              clearTimeout(timer)
            }
          } catch (error) {
            if (!res.headersSent) {
              writeJson(res, 502, {
                error: error instanceof Error ? error.message : '转发失败（目标离线？）',
              })
            }
          }
          return
        }

        if (url.pathname !== '/local-bridge/skills-config') {
          next()
          return
        }

        try {
          const requestBody = req.method === 'PATCH' ? await readJsonBody(req) : null
          const instanceId =
            req.method === 'GET'
              ? url.searchParams.get('instanceId') ?? ''
              : (typeof requestBody?.instanceId === 'string' ? requestBody.instanceId : '')

          if (!instanceId) {
            writeJson(res, 400, { error: '缺少 instanceId' })
            return
          }

          const bridgeConfig = getSkillBridgeConfig(instanceId)
          if (!bridgeConfig) {
            writeJson(res, 400, { error: `未知实例：${instanceId}` })
            return
          }

          if (req.method === 'GET') {
            if (bridgeConfig.mode === 'unconfigured') {
              writeJson(res, 200, {
                editable: false,
                platform: 'api_server',
                disabledSkillNames: [],
                message: `${bridgeConfig.name} (${bridgeConfig.system}) 尚未配置远程 skill bridge 地址，请先设置 ${bridgeConfig.envKey}。`,
              })
              return
            }

            if (bridgeConfig.mode === 'local') {
              const stdout = await runHermesPython(skillConfigReadScript, ['api_server'])
              writeJson(res, 200, {
                editable: true,
                ...(JSON.parse(stdout) as Record<string, unknown>),
              })
              return
            }

            const relayed = await relaySkillBridgeRequest(bridgeConfig, req)
            res.statusCode = relayed.status
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(relayed.body)
            return
          }

          if (req.method === 'PATCH') {
            const body = requestBody ?? {}
            const skillName = typeof body.skillName === 'string' ? body.skillName : ''
            const enabled = typeof body.enabled === 'boolean' ? body.enabled : null

            if (!skillName || enabled === null) {
              writeJson(res, 400, { error: '缺少必要参数 instanceId / skillName / enabled' })
              return
            }

            if (bridgeConfig.mode === 'unconfigured') {
              writeJson(res, 403, {
                error: `${bridgeConfig.name} (${bridgeConfig.system}) 尚未配置远程 skill bridge 地址，暂不可直接勾选技能。`,
              })
              return
            }

            if (bridgeConfig.mode === 'local') {
              const stdout = await runHermesPython(skillConfigWriteScript, [
                'api_server',
                skillName,
                String(enabled),
              ])
              writeJson(res, 200, {
                editable: true,
                ...(JSON.parse(stdout) as Record<string, unknown>),
              })
              return
            }

            const relayed = await relaySkillBridgeRequest(bridgeConfig, req, body)
            res.statusCode = relayed.status
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(relayed.body)
            return
          }

          writeJson(res, 405, { error: 'Method Not Allowed' })
        } catch (error) {
          writeJson(res, 500, {
            error: error instanceof Error ? error.message : '技能桥接执行失败',
          })
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), createSkillsBridgePlugin()],
  server: {
    proxy: {
      // Only the auto-detected local node uses a static proxy; remote nodes the
      // user adds at runtime route through /local-bridge/forward instead.
      '/hermes-api': {
        target: hermesApiTarget,
        changeOrigin: true,
        rewrite: (urlPath) => urlPath.replace(/^\/hermes-api/, ''),
        ...withProxyDebug('hermes1', hermes1SessionKey),
        headers: {
          ...(hermesApiKey
            ? {
                Authorization: `Bearer ${hermesApiKey}`,
              }
            : {}),
          'X-Hermes-Session-Key': hermes1SessionKey,
        },
      },
    },
  },
})
