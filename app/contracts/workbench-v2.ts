// 工作台契约 v2：聊天、工作、专家三个功能的页面用的。字段以 knowbench-backend 的接口为真源。
// 这些写法由 `tests/unit/workbench-contract-samples.test.ts` 对着预览样例（真后端录下来的返回）逐份检查。
import { z } from 'zod'

export const WORKBENCH_CONTRACT_VERSION = 2 as const

const uuid = z.uuid()
const record = z.record(z.string(), z.unknown())

// 三种对话：聊天、工作、专家（0017，所有者 2026-10-11）
export const conversationKindSchema = z.enum(['chat', 'work', 'expert'])
export type ConversationKind = z.infer<typeof conversationKindSchema>

export const conversationSchema = z
  .object({
    id: uuid,
    kind: conversationKindSchema,
    project_id: uuid.nullable(),
    title: z.string().nullable(),
    environment_id: uuid.nullable(),
    project_root: z.string().nullable(),
    thread_id: z.string().nullable(),
    wheel: z.enum(['user', 'advisor']),
    active_task_id: uuid.nullable(),
    created_at: z.string(),
    last_active_at: z.string().nullable(),
  })
  .loose()
export type Conversation = z.infer<typeof conversationSchema>

export const conversationsSchema = z.object({ sessions: z.array(conversationSchema) }).loose()

// 这段对话里等着用户答复的事。能选什么、每一项怎么说，由后端给
export const waitingSchema = z
  .object({
    id: uuid,
    kind: z.string(),
    prompt: z
      .object({
        options: z.array(z.object({ id: z.string(), label: z.string() }).loose()).optional(),
      })
      .loose(),
  })
  .loose()
export type Waiting = z.infer<typeof waitingSchema>

export const conversationViewSchema = z
  .object({ session: conversationSchema, pending_interactions: z.array(waitingSchema) })
  .loose()

export const workspaceSchema = z
  .object({
    environment_id: uuid,
    environment_name: z.string(),
    online: z.boolean(),
    root: z.string(),
  })
  .loose()
export type Workspace = z.infer<typeof workspaceSchema>
export const workspacesSchema = z.object({ workspaces: z.array(workspaceSchema) }).loose()

export const projectSchema = z
  .object({
    id: uuid,
    environment_id: uuid,
    workspace_root: z.string(),
    path: z.string(),
    title: z.string(),
    directory: z.string(),
    archived: z.boolean(),
    conversations: z.number().int(),
    last_active_at: z.string().nullable(),
    environment_name: z.string(),
    online: z.boolean(),
  })
  .loose()
export type Project = z.infer<typeof projectSchema>
export const projectsSchema = z.object({ projects: z.array(projectSchema) }).loose()

const namedSchema = z.object({ id: uuid, title: z.string().nullable() }).loose()

export const pendingSchema = z
  .object({
    interaction_id: uuid,
    kind: z.string(),
    status: z.string(),
    where: z
      .object({
        project: namedSchema.nullable(),
        conversation: namedSchema.extend({ kind: conversationKindSchema }).loose().nullable(),
        about: z.string().nullable(),
      })
      .loose(),
    why: z.string().nullable(),
    created_at: z.string(),
  })
  .loose()
export type Pending = z.infer<typeof pendingSchema>
export const pendingListSchema = z.object({ interactions: z.array(pendingSchema) }).loose()

export const machineSchema = z
  .object({
    id: uuid,
    name: z.string(),
    status: z.string(),
    roots: z.array(z.string()),
    agent_version: z.string().nullable().optional(),
    codex_version: z.string().nullable().optional(),
    last_seen_at: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    // 0.5.2 起（账 143）：设备编号认「这台电脑上的这一份本地 link」；主机名对不上第一次登记的，配置像是拷来的
    device_id: z.string().nullable().optional(),
    host: z.string().nullable().optional(),
    os: z.string().nullable().optional(),
    first_host: z.string().nullable().optional(),
    // 这台机器自己定的上限：只能在那台机器上改，网页只显示
    ceiling: z
      .object({ sandbox: z.string().optional(), network: z.boolean().optional() })
      .loose()
      .optional(),
  })
  .loose()
export type Machine = z.infer<typeof machineSchema>
export const machinesSchema = z.object({ environments: z.array(machineSchema) }).loose()

// 打开工作台时的核对（账 143）：配给当前账号的那份本地 link 在哪台机器上（带编号乙）、配置像不像拷来的、令牌哪天到期
export const localLinkSchema = z
  .object({
    assigned: machineSchema.nullable(),
    copied: z.boolean(),
    token_expires_at: z.string().nullable(),
  })
  .loose()
export type LocalLink = z.infer<typeof localLinkSchema>

export const sandboxesSchema = z
  .object({ sandboxes: z.array(z.object({ id: uuid, status: z.string() }).loose()) })
  .loose()

// ---------------- 事件 ----------------
export const conversationEventSchema = z
  .object({
    id: uuid,
    session_id: uuid,
    cursor: z.number().int(),
    kind: z.string(),
    type: z.string(),
    payload: record,
    task_id: uuid.nullable(),
    attempt_id: uuid.nullable(),
    created_at: z.string(),
  })
  .loose()
export type ConversationEvent = z.infer<typeof conversationEventSchema>

export const eventsPageSchema = z
  .object({ events: z.array(conversationEventSchema), next_cursor: z.number().int().nullable() })
  .loose()

// ---------------- 花费 ----------------
const tokensSchema = z.object({
  input: z.number().int(),
  cached_input: z.number().int(),
  cache_write: z.number().int(),
  output: z.number().int(),
  total: z.number().int(),
})
export type Tokens = z.infer<typeof tokensSchema>

// 每一条用量事件里带的金额。没有单价的模型：priced 为 false，金额是空的
export const callCostSchema = z
  .object({
    currency: z.string(),
    model: z.string().nullable(),
    priced: z.boolean(),
    call: z.string().nullable(),
    turn: z.string().nullable(),
    call_tokens: tokensSchema,
    turn_tokens: tokensSchema,
    estimated: z.boolean(),
  })
  .loose()
export type CallCost = z.infer<typeof callCostSchema>

export const usageSchema = z
  .object({
    price: z
      .object({
        model: z.string().nullable(),
        priced: z.boolean(),
        currency: z.string(),
        as_of: z.string(),
        per_million: z
          .object({
            input: z.string(),
            cached_input: z.string(),
            cache_write: z.string(),
            output: z.string(),
          })
          .nullable(),
        source: z.string(),
        estimated: z.boolean(),
      })
      .loose(),
    cost: z.string().nullable(),
    tokens: tokensSchema,
    calls: z.number().int(),
    turns: z.array(
      z
        .object({
          turn_id: z.string().nullable(),
          calls: z.number().int(),
          cost: z.string().nullable(),
          tokens: tokensSchema,
          at: z.string().nullable().optional(),
        })
        .loose(),
    ),
  })
  .loose()
export type Usage = z.infer<typeof usageSchema>

// ---------------- 改动类请求的答复 ----------------
export const createdConversationSchema = z.object({ session_id: uuid }).loose()
export const turnAcceptedSchema = z.object({ request_id: z.string() }).loose()
export const acceptedSchema = z.object({}).loose()

export const problemSchema = z.object({ code: z.string() }).loose()

// ---------------- 专家：委托的步骤与进度 ----------------
const checkSchema = z
  .object({
    label: z.string(),
    pass: z.boolean().nullable().optional(),
    message: z.string().optional(),
  })
  .loose()

const afterRejectionSchema = z
  .object({
    reworks: z.number().int(),
    then: z.string(),
    back_to: z.number().int().nullable(),
    text: z.string(),
  })
  .loose()

const attemptSchema = z
  .object({
    attempt_id: z.string(),
    n: z.number().int(),
    outcome: z.string(),
    spent: z.string(),
    checks: z.array(checkSchema),
    tools: z.record(z.string(), z.number()),
    // 只有单取一步的时候才带：交回了什么、过程
    // 一次都还没交回的时候是空的
    returned: z
      .object({
        artifact: z.string().nullable(),
        content: z.unknown(),
        raw: z.string().nullable().optional(),
        // 字段各叫什么。没登记的字段不在里面
        labels: z.record(z.string(), z.string()).optional(),
      })
      .loose()
      .nullable()
      .optional(),
    process: z
      .array(
        z
          .object({
            kind: z.string(),
            name: z.string(),
            dataset: z.string().nullable(),
            brief: z.string(),
            ok: z.boolean(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose()
export type Attempt = z.infer<typeof attemptSchema>

export const stepStatusSchema = z.enum([
  'pending',
  'running',
  'accepted',
  'reworking',
  'went_back',
  'redo',
  'waiting',
  'failed',
  'cancelled',
  'not_reached',
])
export type StepStatus = z.infer<typeof stepStatusSchema>

export const runStepSchema = z
  .object({
    index: z.number().int(),
    title: z.string(),
    summary: z.string(),
    why: z.string(),
    uses: z.array(z.object({ step: z.number().int().nullable(), title: z.string() }).loose()),
    tools: z.array(z.string()),
    checks: z.array(checkSchema),
    after_rejection: afterRejectionSchema,
    status: stepStatusSchema,
    attempts: z.array(attemptSchema),
    times: z.number().int(),
    rejected: z.number().int(),
    spent: z.string(),
    data: z
      .object({
        dataset: z.string().nullable().optional(),
        data_version: z.string().nullable().optional(),
        as_of: z.string().nullable().optional(),
      })
      .loose()
      .nullable(),
  })
  .loose()
export type RunStep = z.infer<typeof runStepSchema>

const budgetSchema = z
  .object({
    currency: z.string(),
    used: z.string(),
    running: z.string(),
    spent: z.string(),
    estimated: z.boolean(),
  })
  .loose()

export const runSheetSchema = z
  .object({
    task_id: uuid,
    session_id: uuid,
    project_id: uuid.nullable(),
    expert: z.object({ id: z.string(), name: z.string() }).loose(),
    question: z.string(),
    state: z.string(),
    state_word: z.string().nullable(),
    waiting_reason: z.string().nullable(),
    // 用户点了停止、还没收住（正在打断那一轮）
    cancel_requested: z.boolean().optional(),
    reason_text: z.string(),
    budget: budgetSchema,
    data: z
      .object({
        dataset: z.string().nullable().optional(),
        data_version: z.string().nullable().optional(),
        as_of: z.string().nullable().optional(),
      })
      .loose()
      .nullable(),
    // 请专家时选的、钉进这件委托的数据（SDD 0042）
    chosen_data: z
      .array(
        z
          .object({
            need: z.string().nullable(),
            name: z.string(),
            source: z.enum(['cloud', 'local']),
          })
          .loose(),
      )
      .optional(),
    started_at: z.string().nullable(),
    ended_at: z.string().nullable(),
    active_interaction_id: uuid.nullable(),
  })
  .loose()
export type RunSheet = z.infer<typeof runSheetSchema>

// 现在在干什么、为什么、没有卡住。话是后端写的；页面只按两个时间算「做了多久」「多久没动静」
export const nowSchema = z
  .object({
    step: z
      .object({
        index: z.number().int(),
        of: z.number().int(),
        title: z.string(),
        summary: z.string(),
        why: z.string(),
      })
      .loose(),
    doing: z.object({ code: z.string(), text: z.string() }).loose(),
    redo: z.string().nullable(),
    since: z.string().nullable(),
    last_event_at: z.string().nullable(),
    held: z.boolean(),
  })
  .loose()
export type Now = z.infer<typeof nowSchema>

export const runSchema = z
  .object({
    task: runSheetSchema,
    now: nowSchema.nullable(),
    position: z
      .object({ step: z.number().int(), of: z.number().int(), title: z.string() })
      .loose()
      .nullable(),
    steps: z.array(runStepSchema),
  })
  .loose()
export type Run = z.infer<typeof runSchema>

export const runStepDetailSchema = z.object({ step: runStepSchema }).loose()

// ---------------- 审查面：专家停下来问我 ----------------
export const reviewSchema = z
  .object({
    interaction: z
      .object({
        interaction_id: uuid,
        kind: z.string(),
        status: z.string(),
        where: z
          .object({
            step: z.object({ index: z.number().int(), title: z.string() }).loose().nullable(),
            about: z.string().nullable(),
          })
          .loose(),
        why: z.string().nullable(),
        failed: z.array(z.object({ label: z.string(), message: z.string() }).loose()),
        missing_data: z
          .object({ security_code: z.string(), dataset: z.string().nullable() })
          .loose()
          .nullable(),
        pending: z
          .object({
            title: z.string(),
            question: z.string(),
            options: z.array(
              z.object({ id: z.string(), label: z.string(), consequence: z.string() }).loose(),
            ),
          })
          .loose(),
        validity: z.object({ expires_at: z.string().nullable(), after_expiry: z.string() }).loose(),
        decision: z.object({ decided: z.boolean(), chosen: z.string().nullable() }).loose(),
        // 工具级审批与提问卡多带的：哪一步、后面谁依赖、刚拒绝过、问题清单
        subject: z
          .object({
            command: z.string().nullable().optional(),
            cwd: z.string().nullable().optional(),
            after_decline: z.boolean().optional(),
            dependents: z
              .array(z.object({ step_id: z.string(), title: z.string() }).loose())
              .optional(),
            questions: z
              .array(
                z
                  .object({
                    id: z.string(),
                    header: z.string(),
                    question: z.string(),
                    options: z.array(
                      z.object({ label: z.string(), description: z.string() }).loose(),
                    ),
                    is_other: z.boolean(),
                    is_secret: z.boolean(),
                  })
                  .loose(),
              )
              .optional(),
          })
          .loose()
          .optional(),
      })
      .loose(),
  })
  .loose()
export type Review = z.infer<typeof reviewSchema>['interaction']

// 一段对话里请过的专家（新的在前）。dossier = 这一次在项目目录里写的底稿：按对话、按次各一格，
// 路径相对项目目录；文件在用户电脑上，是真源，经本机回环口读（所有者 2026-10-14）
export const taskDossierSchema = z
  .object({ folder: z.string(), expert: z.string(), files: z.array(z.string()) })
  .loose()
export type TaskDossier = z.infer<typeof taskDossierSchema>

export const tasksSchema = z
  .object({
    tasks: z.array(
      z
        .object({
          id: uuid,
          state: z.string(),
          created_at: z.string().optional(),
          dossier: taskDossierSchema.nullable().optional(),
        })
        .loose(),
    ),
  })
  .loose()

// ---------------- 专家首页与请专家 ----------------
export const packSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    tagline: z.string(),
    solves: z.string(),
    does_not_solve: z.string(),
    input: z.string(),
    output: z.string(),
    uses_our_data: z.boolean(),
    // 筹备中的专家：看得见、请不了（所有者 2026-10-13 定先占位）
    status: z.enum(['ready', 'preparing']).optional(),
    // 内置专家，或用户从 knowmart 请来的自己的分身（SDD 0027 P4）
    source: z.enum(['builtin', 'knowbot']).optional(),
    preparing_note: z.string().optional(),
    steps: z.array(
      z
        .object({
          index: z.number().int(),
          title: z.string(),
          summary: z.string(),
          after_rejection: z.object({ text: z.string() }).loose(),
        })
        .loose(),
    ),
  })
  .loose()
export type Pack = z.infer<typeof packSchema>
export const packsSchema = z.object({ packs: z.array(packSchema) }).loose()
export const pinnedKnowbotSchema = z.object({ pack: packSchema }).loose()

const delegationRowSchema = z
  .object({
    task_id: uuid,
    session_id: uuid,
    project_id: uuid.nullable(),
    question: z.string(),
    expert: z.string(),
    state: z.string(),
    state_word: z.string().nullable(),
    position: z
      .object({ step: z.number().int(), of: z.number().int(), title: z.string() })
      .loose()
      .nullable(),
    budget: z.object({ currency: z.string(), spent: z.string() }).loose(),
    ended_at: z.string().nullable(),
    reason_text: z.string().optional(),
  })
  .loose()
export type DelegationRow = z.infer<typeof delegationRowSchema>

const waitingRowSchema = z
  .object({
    interaction_id: uuid,
    kind: z.string(),
    where: z
      .object({
        project: z.object({ id: uuid, title: z.string().nullable() }).loose().nullable(),
        conversation: z
          .object({ id: uuid, title: z.string().nullable(), kind: conversationKindSchema })
          .loose()
          .nullable(),
        task: z.object({ id: uuid, question: z.string(), expert: z.string() }).loose().nullable(),
        step: z.object({ index: z.number().int(), title: z.string() }).loose().nullable(),
        about: z.string().nullable(),
      })
      .loose(),
    why: z.string().nullable(),
    failed: z.array(z.object({ label: z.string(), message: z.string() }).loose()),
    expires_at: z.string().nullable().optional(),
  })
  .loose()
export type WaitingRow = z.infer<typeof waitingRowSchema>

export const overviewSchema = z
  .object({
    waiting: z.array(waitingRowSchema),
    running: z.array(delegationRowSchema),
    returned: z.array(delegationRowSchema),
  })
  .loose()

export const projectDetailSchema = z
  .object({
    project: projectSchema.omit({ conversations: true, last_active_at: true }).loose(),
    active_task_id: uuid.nullable(),
    conversations: z.array(
      z
        .object({
          id: uuid,
          kind: conversationKindSchema,
          title: z.string().nullable(),
          active_task_id: uuid.nullable(),
          last_active_at: z.string().nullable(),
        })
        .loose(),
    ),
    tasks: z.array(
      z
        .object({
          id: uuid,
          session_id: uuid,
          expert: z.string(),
          state: z.string(),
          state_word: z.string().nullable(),
          question: z.string().nullable(),
          spent: z.string(),
          currency: z.string(),
          created_at: z.string(),
          ended_at: z.string().nullable(),
        })
        .loose(),
    ),
  })
  .loose()
export type ProjectDetail = z.infer<typeof projectDetailSchema>

export const delegatedSchema = z.object({ task_id: uuid, session_id: uuid.optional() }).loose()

// 单独的审查面还要知道这件事在哪：哪个项目、哪段对话
export const reviewPlaceSchema = z
  .object({
    interaction: z
      .object({
        where: z
          .object({
            project: z.object({ id: uuid, title: z.string().nullable() }).loose().nullable(),
            conversation: z
              .object({ id: uuid, title: z.string().nullable(), kind: conversationKindSchema })
              .loose()
              .nullable(),
            task: z
              .object({ id: uuid, question: z.string(), expert: z.string() })
              .loose()
              .nullable(),
          })
          .loose(),
        subject: z
          .object({
            command: z.string().nullable().optional(),
            cwd: z.string().nullable().optional(),
          })
          .loose(),
      })
      .loose(),
  })
  .loose()

export const createdProjectSchema = z.object({ id: uuid }).loose()

// ---------------- 云端知识库（SDD 0042）：真源在 knowbase，经后端凭用户令牌转交 ----------------
export const cloudItemSchema = z
  .object({
    item_id: z.string(),
    name: z.string(),
    media_type: z.string(),
    size_bytes: z.number().int(),
    sha256: z.string(),
    origin: z.enum(['upload', 'collect', 'purchase']),
    created_at: z.string(),
  })
  .loose()
export type CloudItem = z.infer<typeof cloudItemSchema>
export const cloudListSchema = z.object({ items: z.array(cloudItemSchema) }).loose()
export const cloudCreatedSchema = z.object({ item: cloudItemSchema }).loose()

// ---------------- 请专家用自己的数据（SDD 0042 第五节）----------------
// 专家的数据需求声明：每样要什么格式、几份、必填还是可选；请专家时按它从本地或云端知识库选
export const dataFormatSchema = z.enum(['pdf', 'excel', 'csv', 'text'])
export type DataFormat = z.infer<typeof dataFormatSchema>
export const dataNeedSchema = z
  .object({
    key: z.string(),
    name: z.string(),
    description: z.string(),
    formats: z.array(dataFormatSchema),
    required: z.boolean(),
    min_count: z.number().int(),
    max_count: z.number().int(),
    tables: z.array(
      z.object({ sheet: z.string().nullable(), columns: z.array(z.string()) }).loose(),
    ),
  })
  .loose()
export type DataNeed = z.infer<typeof dataNeedSchema>
// 选的一份：云端是资料编号，本地是路径；name 只给页面看
export const dataChoiceSchema = z
  .object({
    need: z.string(),
    source: z.enum(['cloud', 'local']),
    name: z.string().optional(),
    item_id: z.string().optional(),
    path: z.string().optional(),
  })
  .loose()
export type DataChoice = z.infer<typeof dataChoiceSchema>
// 这段对话选用的云端知识库（SDD 0042 第四节）：凭「会话」运行授权，到期要再选
export const sessionCloudDataSchema = z
  .object({
    items: z.array(
      z
        .object({
          item_id: z.string(),
          name: z.string(),
          media_type: z.string(),
          size_bytes: z.number().int(),
          sha256: z.string(),
        })
        .loose(),
    ),
    expires_at: z.string().nullable(),
  })
  .loose()
export type SessionCloudData = z.infer<typeof sessionCloudDataSchema>
export const dataNeedsSchema = z
  .object({ needs: z.array(dataNeedSchema), last: z.array(dataChoiceSchema) })
  .loose()

// ---------------- 长期记忆：关于这位用户的几条事实（0019 §四）----------------
export const memorySchema = z
  .object({
    id: uuid,
    kind: z.enum(['fact', 'judgement']),
    text: z.string(),
    enabled: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose()
export type Memory = z.infer<typeof memorySchema>
export const memoriesSchema = z.object({ memories: z.array(memorySchema) }).loose()
export const memoryMadeSchema = z.object({ memory: memorySchema }).loose()

// ---------------- 代理回环口（0022 乙案，账 87）：那台电脑上的文件与设置，不经工作台 ----------------
// 工作台只发票：网页拿它去敲 127.0.0.1:47811
export const localTicketSchema = z
  .object({ ticket: z.string(), expires_at: z.number().int(), relay_user: z.string() })
  .loose()
export type LocalTicket = z.infer<typeof localTicketSchema>

// 代理回环口的 /local/v1/info
export const localInfoSchema = z
  .object({
    agent: z.string().optional(),
    version: z.string().optional(),
    userId: z.string(),
    roots: z.array(z.string()),
    libraryDir: z.string().nullable().optional(),
    capabilities: z.array(z.string()).optional(),
    lastSettingsChange: z.string().nullable().optional(),
  })
  .loose()
export type LocalInfo = z.infer<typeof localInfoSchema>

export const directoryEntrySchema = z
  .object({
    name: z.string(),
    type: z.enum(['file', 'dir', 'link', 'other']),
    size: z.number().int().nullable().optional(),
    mtime: z.number().nullable().optional(),
  })
  .loose()
export type DirectoryEntry = z.infer<typeof directoryEntrySchema>
export const directorySchema = z
  .object({
    path: z.string(),
    entries: z.array(directoryEntrySchema),
    truncated: z.boolean().optional(),
  })
  .loose()
export type Directory = z.infer<typeof directorySchema>

export const localSettingsSchema = z
  .object({
    machineName: z.string().optional(),
    roots: z.array(z.string()),
    rootChoices: z.array(z.string()).optional(),
    ceiling: z.object({ sandbox: z.string(), network: z.boolean() }).loose(),
    autostart: z.boolean().optional(),
    libraryDir: z.string().nullable().optional(),
    version: z.string().optional(),
    lastSettingsChange: z.string().nullable().optional(),
  })
  .loose()
export type LocalSettings = z.infer<typeof localSettingsSchema>
