/**
 * 任务页三块（DAG / 清单+看板 / 协作契约）与原 page.tsx 共用的类型、常量与格式化工具。
 *
 * 纯数据模块：没有 JSX、没有 React 依赖，服务端组件和客户端组件都能安全导入。
 */

export type Task = {
  id: number;
  code: string;
  title: string;
  description: string | null;
  milestone: string | null;
  orderIndex: number;
  status: string;
  estHours: string;
  actualHours: string | null;
  dueAt: string | null;
  deliverableType: string;
  priority: string;
  onCriticalPath: boolean;
  blockedReason: string | null;
};

export type Dep = { taskId: number; dependsOnId: number };

export type Assignment = { id: number; taskId: number; userId: number; raci: string };

export type PlanData = {
  plan: {
    id: number;
    validated: boolean;
    validateProblems: string[] | null;
    assignmentTitle: string | null;
    llmModel: string | null;
  } | null;
  tasks: Task[];
  deps: Dep[];
  assignments: Assignment[];
};

export type ContractData = {
  latest: { id: number; version: number; publishedAt: string | null };
  versions: { id: number; version: number; publishedAt: string | null }[];
  glossary: { id: number; term: string; definition: string; unit: string | null }[];
  acceptances: { userId: number; acceptedAt: string }[];
} | null;

export type Member = { userId: number; name: string | null; studentNo: string | null };

export const STATUS_LABEL: Record<string, string> = {
  todo: '待启动',
  doing: '进行中',
  blocked: '阻塞',
  reviewing: '审阅中',
  done: '已完成',
  cancelled: '已取消'
};

export const STATUS_COLOR: Record<string, string> = {
  todo: '#a1a1aa',
  doing: '#3b82f6',
  blocked: '#ef4444',
  reviewing: '#f59e0b',
  done: '#22c55e',
  cancelled: '#71717a'
};

export const NEXT_STATUS: Record<string, string[]> = {
  todo: ['doing', 'blocked'],
  doing: ['reviewing', 'blocked'],
  blocked: ['doing'],
  reviewing: ['done', 'doing'],
  done: [],
  cancelled: []
};

export const RACI_LABEL: Record<string, string> = {
  lead: '主责',
  reviewer: '审阅',
  contributor: '协作'
};

export const RACI_ORDER = ['lead', 'reviewer', 'contributor'];

export const OPEN_STATUS = ['todo', 'doing', 'blocked', 'reviewing'];

/** numeric 列在 drizzle 里是字符串，统一换算成数字再求和。 */
export function hoursOf(value: string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function toDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(value: string | null): string {
  const d = toDate(value);
  if (!d) return '—';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 距截止天数（今天为 0，已过期为负）。 */
export function daysLeft(value: string | null): number | null {
  const d = toDate(value);
  if (!d) return null;
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d.getTime() - startOfToday.getTime()) / 86400000);
}

export function dueText(value: string | null, status: string): { text: string; className: string } {
  const d = daysLeft(value);
  if (d === null) return { text: '未设截止', className: 'text-muted-foreground' };
  if (status === 'done' || status === 'cancelled') {
    return { text: fmtDate(value), className: 'text-muted-foreground' };
  }
  if (d < 0) return { text: `${fmtDate(value)} · 逾期 ${-d} 天`, className: 'text-destructive' };
  if (d === 0) return { text: `${fmtDate(value)} · 今天到期`, className: 'text-warning' };
  if (d <= 3) return { text: `${fmtDate(value)} · 剩 ${d} 天`, className: 'text-warning' };
  return { text: fmtDate(value), className: 'text-muted-foreground' };
}