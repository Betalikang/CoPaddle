"""内部接口的请求/响应模型（pydantic v2）。

脚手架阶段只定义各端点的最小输入输出契约；字段随 S2–S5 期实现逐步补齐。
权威数据结构以规格书 S1（47 表）与 S2（9 个内部接口）为准。
"""

from pydantic import BaseModel, Field

# ---------- 分组（B-06 支撑）----------


class StudentProfile(BaseModel):
    """求解输入：单个学生的画像摘要。"""

    id: str
    skills: dict[str, int] = Field(default_factory=dict, description="能力维度 -> 0-5 水平")
    class_id: str | None = None


class GroupingWeights(BaseModel):
    """四维目标权重，取值 0–2（规格书 S4.2）。"""

    skill_cover: float = 1.2
    weak_tie: float = 0.8
    balance: float = 1.0
    history_avoid: float = 1.0


class GroupingSolveRequest(BaseModel):
    course_id: str
    students: list[StudentProfile]
    num_groups: int = Field(ge=1)
    min_group_size: int = Field(ge=1)
    max_group_size: int = Field(ge=1)
    forbidden_pairs: list[tuple[str, str]] = Field(default_factory=list)
    required_pairs: list[tuple[str, str]] = Field(default_factory=list)
    # 社交联系图（弱连接引入度输入）与历史同组对（历史规避输入）
    edges: list[tuple[str, str, float]] = Field(default_factory=list)
    history_pairs: list[tuple[str, str]] = Field(default_factory=list)
    weights: GroupingWeights = Field(default_factory=GroupingWeights)
    time_limit_seconds: float = Field(default=10.0, gt=0, le=30)


class GroupingPlanScores(BaseModel):
    skill_cover: float = 0.0
    weak_tie: float = 0.0
    balance: float = 0.0
    history_avoid: float = 0.0
    total: float = 0.0


class GroupingPlan(BaseModel):
    label: str
    strategy: str
    groups: list[list[str]]
    scores: GroupingPlanScores
    explanation: str = ""


class GroupingSolveResponse(BaseModel):
    run_id: str = ""
    status: str  # running | ok | infeasible | timeout | error
    plans: list[GroupingPlan] = Field(default_factory=list)
    detail: str = ""
    degraded: bool = False  # True = 贪心兜底（快速模式）


class PreviewMoveRequest(BaseModel):
    """拖动预演（规格书 S4.3）：绝不重新求解，内存重算四维得分。

    user_id 从 from_group 移到 to_group；若同时给 swap_with，则为两人互换。
    """

    plan_groups: list[list[str]]
    user_id: str
    from_group: int
    to_group: int
    swap_with: str | None = None
    students: list[StudentProfile] = Field(default_factory=list)
    num_groups: int = Field(ge=1)
    min_group_size: int = Field(ge=1)
    max_group_size: int = Field(ge=1)
    forbidden_pairs: list[tuple[str, str]] = Field(default_factory=list)
    required_pairs: list[tuple[str, str]] = Field(default_factory=list)
    allow_cross_class: bool = False
    edges: list[tuple[str, str, float]] = Field(default_factory=list)
    history_pairs: list[tuple[str, str]] = Field(default_factory=list)
    weights: GroupingWeights = Field(default_factory=GroupingWeights)


class MoveViolation(BaseModel):
    code: str
    message: str


class PreviewMoveResponse(BaseModel):
    ok: bool
    violations: list[MoveViolation] = Field(default_factory=list)
    deltas: dict[str, float] = Field(default_factory=dict)
    total_before: float = 0.0
    total_after: float = 0.0
    # score 端点填充：给定方案的四维得分（0–100）
    scores: dict[str, float] = Field(default_factory=dict)


# ---------- 图算法（B-08/B-10 支撑）----------


class TaskNode(BaseModel):
    id: str
    title: str = ""
    deps: list[str] = Field(default_factory=list)
    est_hours: float = Field(default=1.0, ge=0)
    status: str = "todo"
    due_at: str | None = None


class CriticalPathRequest(BaseModel):
    tasks: list[TaskNode]


class CriticalPathResponse(BaseModel):
    path: list[str]
    total_hours: float


class ImpactRequest(BaseModel):
    tasks: list[TaskNode]
    delayed_task_id: str
    delay_days: float = Field(default=1.0, ge=0)


class ImpactResponse(BaseModel):
    affected: list[str]
    est_delay_days: float


# ---------- 健康度 / 归因 / LLM ----------


class HealthComputeRequest(BaseModel):
    group_id: str
    tasks: list[TaskNode] = Field(default_factory=list)
    member_ids: list[str] = Field(default_factory=list)
    last_signal_at: dict[str, str] = Field(default_factory=dict, description="user_id -> ISO 时间")


class HealthComputeResponse(BaseModel):
    blocked_score: float = 100.0
    idle_score: float = 100.0
    overload_score: float = 100.0
    overall: float = 100.0
    diagnosis: list[str] = Field(default_factory=list)


class AttributionComputeRequest(BaseModel):
    group_id: str
    member_ids: list[str] = Field(default_factory=list)


class AttributionMemberResult(BaseModel):
    user_id: str
    point: float = 0.0
    low: float = 0.0
    high: float = 0.0
    confidence: str = "low"  # low | medium | high
    fair_share_ratio: float = 0.0
    warning: str = ""


class AttributionComputeResponse(BaseModel):
    members: list[AttributionMemberResult] = Field(default_factory=list)


class DecomposeRequest(BaseModel):
    """LLM 调用点 1：作业要求 -> 任务 DAG + 协作契约（规格书 S6.1）。"""

    assignment_text: str = Field(min_length=1)
    group_size: int = Field(default=4, ge=1)
    course_name: str = ""
    remaining_days: int | None = None


class DecomposedTask(BaseModel):
    id: str
    title: str
    deps: list[str] = Field(default_factory=list)
    est_hours: float = Field(default=2.0, ge=0)
    skills: list[str] = Field(default_factory=list)
    deliverable: str = ""
    milestone: str = ""


class ContractGlossaryItem(BaseModel):
    term: str
    definition: str
    unit: str = ""


class DecomposeContract(BaseModel):
    glossary: list[ContractGlossaryItem] = Field(default_factory=list)
    interfaces: list[str] = Field(default_factory=list)
    format: str = ""


class DecomposeResponse(BaseModel):
    tasks: list[DecomposedTask] = Field(default_factory=list)
    contract: DecomposeContract = Field(default_factory=DecomposeContract)
    validation_problems: list[str] = Field(default_factory=list)
    model: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0


class ConflictRequest(BaseModel):
    """LLM 调用点 2：语义冲突归因（规格书 S6.2）。"""

    text_a: str = Field(min_length=1)
    text_b: str = Field(min_length=1)
    author_a: str = ""
    author_b: str = ""
    contract_terms: list[ContractGlossaryItem] = Field(default_factory=list)


class ConflictResponse(BaseModel):
    kind: str = "无冲突"  # 口径不一致|接口不匹配|结论实质矛盾|内容重复|无冲突
    severity: str = "low"
    reason: str = ""
    suggestion: str = ""
    merged_text: str = ""
    model: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
