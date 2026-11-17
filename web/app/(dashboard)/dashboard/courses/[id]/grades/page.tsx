'use client';

import { TeacherGate } from '@/components/course-role-gate';
import useSWR from 'swr';
import { use, useState } from 'react';
import { Check, Download, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout, PageShell, Panel } from '@/components/page-shell';
import { QueryError } from '@/components/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, describeApiError, swrFetcher, type ApiErrorKind } from '@/lib/api/client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';

const COLUMNS = [
  { key: 'student_no', label: '学号' },
  { key: 'name', label: '姓名' },
  { key: 'group', label: '小组' },
  { key: 'duty', label: '角色' },
  { key: 'low', label: '贡献区间低' },
  { key: 'high', label: '贡献区间高' },
  { key: 'review_low', label: '终审低' },
  { key: 'review_high', label: '终审高' },
  { key: 'peer_median', label: '互评中位数' },
  { key: 'task_rate', label: '任务完成率' }
];

/** 列 key → 表头文案（与服务端导出的表头一致，用来在预览里定位列）。 */
const COLUMN_LABEL: Record<string, string> = Object.fromEntries(
  COLUMNS.map((c) => [c.key, c.label])
);

/**
 * 解析单条 CSV 记录（RFC 4180）：引号内的逗号不切分，`""` 还原成一个引号。
 * 服务端导出已按规范给含逗号 / 引号 / 换行的字段加引号，裸 `split(',')` 会让整行错位（审计 #52）。
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** 切成记录：引号内的换行属于字段内容，不能当作行分隔。 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let record = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    // 每对 `""` 会翻转两次、状态不变，所以这里只需按引号奇偶切换
    if (ch === '"') quoted = !quoted;
    if (ch === '\n' && !quoted) {
      const line = record.replace(/\r$/, '');
      if (line.trim() !== '') rows.push(parseCsvLine(line));
      record = '';
      continue;
    }
    record += ch;
  }
  const tail = record.replace(/\r$/, '');
  if (tail.trim() !== '') rows.push(parseCsvLine(tail));
  return rows;
}

/** 服务端 `error` 字段 → 可展示文案；非字符串 / 空串视为没有（与 client.ts 同口径）。 */
function serverErrorText(body: unknown): string {
  const raw = (body as { error?: unknown } | null)?.error;
  if (typeof raw !== 'string') return '';
  const text = raw.trim();
  if (!text) return '';
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/** 把错误响应体读成 JSON（读不出就保留原文），用来取服务端的 `error` 文案。 */
async function readErrorBody(res: Response): Promise<unknown> {
  const raw = await res.text().catch(() => '');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function kindByStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  return 'http';
}

/** 状态码兜底文案：拿不到服务端 error 时也别只说「失败」（口径同 client.ts）。 */
function statusHint(status: number): string {
  if (status === 401) return '登录已过期，请重新登录';
  if (status === 403) return '没有访问权限';
  if (status === 404) return '内容不存在或已被删除';
  return `请求失败（HTTP ${status}）`;
}

/** 从 Content-Disposition 取文件名，取不到就用兜底名。 */
function filenameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get('Content-Disposition') ?? '';
  const raw = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1]?.trim();
  if (!raw) return fallback;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * 拉取导出接口并校验它确实是 CSV 文件。
 *
 * 导出走的是文件流，不能复用 `apiFetch`（它按 JSON 解析）。但抛出的仍是
 * client.ts 的 `ApiError`，页面文案统一由 `describeApiError` 产出，不另立一套措辞。
 * 关键约束：403/404 的 `{ error }` 响应、以及 2xx 却返回 HTML 登录页/JSON 的情况，
 * 都必须在这里抛错——绝不能让浏览器把错误响应当成文件存下来（计划 P2-7）。
 */
async function fetchCsvResponse(url: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new ApiError({ kind: 'network', message: '网络连接失败，请检查网络后重试' });
  }

  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new ApiError({
      kind: kindByStatus(res.status),
      status: res.status,
      body,
      message: serverErrorText(body) || statusHint(res.status)
    });
  }

  // 2xx 但 Content-Type 不是文件：多半是登录跳转页或 `{ error }` 假成功
  const contentType = res.headers.get('Content-Type') ?? '';
  if (!/csv|excel|octet-stream/i.test(contentType)) {
    const body = await readErrorBody(res);
    throw new ApiError({
      kind: 'invalid-response',
      status: res.status,
      body,
      message: serverErrorText(body) || '服务端返回的不是 CSV 文件，请稍后重试'
    });
  }

  return res;
}

/** 成绩导出（规格书 P-23）：勾选列 → 预览前 10 行 → 下载 CSV。 */
function GradeExportBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [cols, setCols] = useState<string[]>(COLUMNS.map((c) => c.key));
  const [preview, setPreview] = useState<string[][] | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [downloadOk, setDownloadOk] = useState('');

  const { data, error, isLoading, mutate } = useSWR<{
    groups: { id: number; name: string; members: { userId: number; name: string | null; studentNo: string | null; duty: string }[] }[];
  }>(`/api/courses/${id}/groups`, swrFetcher);

  function toggle(key: string) {
    setCols((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
    // 列变了，上一次的下载结果/错误已经不代表当前选择
    setDownloadError('');
    setDownloadOk('');
  }

  // 选中的列要真正进入导出 URL（审计 #51）：不传 cols 时服务端回落到原来的 10 列
  function exportUrl() {
    return cols.length > 0
      ? `/api/courses/${id}/grade-export?cols=${encodeURIComponent(cols.join(','))}`
      : `/api/courses/${id}/grade-export`;
  }

  async function loadPreview() {
    setPreviewError('');
    setPreviewing(true);
    try {
      const res = await fetchCsvResponse(exportUrl());
      const text = await res.text();
      const rows = parseCsvRows(text.replace(/^\uFEFF/, ''));
      const header = rows[0] ?? [];
      const idx = cols.map((k) => header.indexOf(COLUMN_LABEL[k] ?? k));
      const body = rows
        .slice(1, 11)
        .map((r) => idx.map((i) => (i >= 0 ? (r[i] ?? '') : '')));
      setPreview([idx.map((i) => (i >= 0 ? (header[i] ?? '') : '')), ...body]);
    } catch (e) {
      setPreview(null);
      setPreviewError(`预览失败：${describeApiError(e)}`);
    } finally {
      setPreviewing(false);
    }
  }

  /**
   * 下载改为 fetch + blob（计划 P2-7）。
   *
   * 原来的 `window.open(url)` 让浏览器直接跳转：403/404 时新标签页打开的是
   * `{ error: '没有访问权限' }` 的 JSON，用户看到一片乱码，却以为文件下载了。
   * 现在先判状态码与 Content-Type，只有确认是 CSV 才落盘，否则在本页显示错误文案。
   */
  async function download() {
    if (downloading) return;
    setDownloadError('');
    setDownloadOk('');
    setDownloading(true);
    let revoke: (() => void) | null = null;
    try {
      const res = await fetchCsvResponse(exportUrl());
      const blob = await res.blob();
      const filename = filenameFrom(res, `grades-${id}.csv`);
      const objectUrl = URL.createObjectURL(blob);
      revoke = () => URL.revokeObjectURL(objectUrl);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setDownloadOk(`已开始下载 ${filename}`);
    } catch (e) {
      setDownloadError(`下载失败：${describeApiError(e)}`);
    } finally {
      // 立刻 revoke 会让部分浏览器还没读到内容，留一拍再释放
      if (revoke) setTimeout(revoke, 10_000);
      setDownloading(false);
    }
  }

  const totalMembers = (data?.groups ?? []).reduce((n, g) => n + g.members.length, 0);

  const crumbs = [
    { label: '课程工作台', href: '/dashboard' },
    { label: '课程', href: `/dashboard/courses/${id}` },
    { label: '成绩导出' }
  ];

  return (
    <PageShell
      title="成绩导出"
      breadcrumbs={crumbs}
      description="勾选需要的列，预览确认无误后下载 CSV。"
      width="wide"
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadPreview()}
            disabled={isLoading || previewing || cols.length === 0}
          >
            <FileSpreadsheet className="mr-1 h-4 w-4" />
            {previewing ? '预览中…' : '预览前 10 行'}
          </Button>
          <Button
            size="sm"
            onClick={() => void download()}
            disabled={cols.length === 0 || downloading}
          >
            <Download className="mr-1 h-4 w-4" />
            {downloading ? '下载中…' : '下载 CSV'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Panel
          title="导出列"
          hint={`共 ${totalMembers} 名学生；点按下方按钮切换列（Tab 聚焦，空格 / 回车切换）${preview ? '，改完重新预览' : ''}`}
        >
          <div className="flex flex-wrap gap-2" role="group" aria-label="导出列选择">
            {COLUMNS.map((c) => {
              const active = cols.includes(c.key);
              return (
                <Button
                  key={c.key}
                  type="button"
                  variant={active ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={active}
                  onClick={() => toggle(c.key)}
                  className="select-none"
                >
                  <Check
                    className={active ? 'mr-1 h-4 w-4' : 'mr-1 h-4 w-4 opacity-0'}
                    aria-hidden="true"
                  />
                  {c.label}
                </Button>
              );
            })}
          </div>
          {cols.length === 0 && (
            <p className="mt-3 text-xs text-warning" role="alert">
              至少选一列才能预览或下载。
            </p>
          )}
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {`已选中 ${cols.length} 列：${COLUMNS.filter((c) => cols.includes(c.key))
              .map((c) => c.label)
              .join('、')}`}
          </p>
        </Panel>

        {error && (
          <QueryError error={error} onRetry={() => void mutate()} title="小组成员加载失败" />
        )}

        {previewError && <Callout tone="danger">{previewError}</Callout>}

        {downloadError && (
          <div role="alert" aria-atomic="true">
            <Callout tone="danger">{downloadError}</Callout>
          </div>
        )}

        {downloadOk && (
          <div aria-live="polite" aria-atomic="true">
            <Callout tone="success">{downloadOk}</Callout>
          </div>
        )}

        {isLoading && <Skeleton className="h-32 w-full" />}

        {preview && (
          <Panel title="预览" hint="前 10 行，仅用于核对列顺序" bodyClassName="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {preview[0].map((h, i) => (
                    <TableHead key={i} className="h-auto py-1 pr-3 font-medium text-muted-foreground">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.slice(1).map((row, ri) => (
                  <TableRow key={ri}>
                    {row.map((cell, ci) => (
                      <TableCell key={ci} className="py-1 pr-3 tabular-nums">
                        {cell || '—'}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
        )}

        <p className="text-xs text-muted-foreground">
          贡献为系统给出的区间（不给单一分数）；终审低/高为教师调整后的值；互评中位数取最近已关闭轮次。
        </p>
      </div>
    </PageShell>
  );
}

/** 页面级角色闸门：非教师/助教直链访问时给出明确说明。 */
export default function GradeExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <TeacherGate courseId={id} title="成绩导出">
      <GradeExportBody params={params} />
    </TeacherGate>
  );
}
