'use client';

import useSWR from 'swr';
import { use, useEffect, useMemo, useState } from 'react';
import { Search, Upload, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Pager } from '@/components/ui/pager';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { ClassShell, GroupPanelInClass } from '@/components/class-shell';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type Enrollment = {
  id: number;
  role: string;
  status: string;
  classId: number | null;
  className: string | null;
  user: { id: number; name: string | null; email: string; studentNo: string | null };
};

const ROLE_LABEL: Record<string, string> = {
  teacher: '教师',
  assistant: '助教',
  captain: '队长',
  member: '队员'
};

const CSV_TEMPLATE = 'name,email,student_no,class_name';

/** 名单管理（规格书 P-05）：可编辑表格 + CSV 导入（逐行校验报告）+ 技能卡填写进度。 */
export default function RosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: enrollData, error, isLoading, mutate } = useSWR<{ enrollments: Enrollment[] }>(
    `/api/courses/${id}/enrollments`,
    fetcher
  );
  const { data: cardData } = useSWR<{ filled: number; total: number }>(
    `/api/courses/${id}/skill-cards`,
    fetcher
  );
  const { data: classData, mutate: mutateClasses } = useSWR<{
    classes: { id: number; name: string; memberCount: number; groupCount: number }[];
  }>(`/api/courses/${id}/classes`, fetcher);

  const enrollments = enrollData?.enrollments ?? [];
  const classes = classData?.classes ?? [];

  // 班级筛选与课程页同一套；支持 ?classId= 直达（从班级卡片「名单管理」跳入）
  const [keyword, setKeyword] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [classFilter, setClassFilter] = useState('all');
  const [editing, setEditing] = useState<Enrollment | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('classId');
    if (q) setClassFilter(q);
  }, []);

  // 筛选变化回到第一页
  useEffect(() => {
    setPage(1);
  }, [roleFilter, classFilter, keyword]);

  /** 队长指派（P-05 理想链路）：教师点一下，该学生本号登录即有队长权限。 */
  async function toggleCaptain(e: Enrollment, role: 'captain' | 'member') {
    const res = await fetch(`/api/enrollments/${e.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role })
    });
    if (!res.ok) {
      window.alert((await res.json()).error ?? '操作失败');
      return;
    }
    mutate();
    mutateClasses();
  }

  const filtered = useMemo(() => {
    return enrollments.filter((e) => {
      if (roleFilter !== 'all' && e.role !== roleFilter) return false;
      if (classFilter !== 'all' && String(e.classId ?? '') !== classFilter) return false;
      if (keyword) {
        const k = keyword.toLowerCase();
        return (
          (e.user.name ?? '').toLowerCase().includes(k) ||
          e.user.email.toLowerCase().includes(k) ||
          (e.user.studentNo ?? '').toLowerCase().includes(k)
        );
      }
      return true;
    });
  }, [enrollments, roleFilter, classFilter, keyword]);

  // 长名单分页（119 人规模一页放不下）
  const PAGE_SIZE = 20;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <section className="flex-1">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg lg:text-2xl font-medium">名单管理</h1>
          {cardData && (
            <p className="text-sm text-muted-foreground">
              技能卡填写进度：{cardData.filled} / {cardData.total} ·
              学生用本人账号登录后即获得此处设置的角色权限（设谁为队长，谁的本号就是队长）
            </p>
          )}
        </div>
        <ImportDialog courseId={id} onDone={() => { mutate(); mutateClasses(); }} />
      </div>

      {/* 班级设计：与名单管理同一套 classId，班级在此维护 */}
      <ClassPanel
        courseId={id}
        classes={classes}
        onChanged={() => {
          mutateClasses();
          mutate();
        }}
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="flex-1 min-w-48">
            <Label className="mb-1 block">搜索</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="姓名 / 学号 / 邮箱"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label className="mb-1 block">角色</Label>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="teacher">教师</SelectItem>
                <SelectItem value="assistant">助教</SelectItem>
                <SelectItem value="captain">队长</SelectItem>
                <SelectItem value="member">队员</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1 block">班级</Label>
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            在册成员（{filtered.length} / {enrollments.length}）
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <Skeleton className="h-40" />}
          {error && <p className="text-sm text-destructive">名单加载失败。</p>}
          {!isLoading && !error && filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              没有匹配的成员。用右上角「导入 CSV」批量加入。
            </p>
          )}
          {filtered.length > 0 && (
            <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>学号</TableHead>
                  <TableHead>姓名</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>班级</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="tabular-nums">{e.user.studentNo ?? '—'}</TableCell>
                    <TableCell>{e.user.name ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{e.user.email}</TableCell>
                    <TableCell>{e.className ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={e.role === 'teacher' ? 'default' : 'outline'}>
                        {ROLE_LABEL[e.role] ?? e.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {e.role === 'captain' ? (
                          <Button variant="ghost" size="sm" onClick={() => toggleCaptain(e, 'member')}>
                            取消队长
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => toggleCaptain(e, 'captain')}>
                            设为队长
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setEditing(e)}>
                          <UserCog className="mr-1 h-4 w-4" />
                          编辑
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager page={safePage} pageCount={pageCount} onPage={setPage} />
            </>
          )}
        </CardContent>
      </Card>

      {editing && (
        <EditMemberDialog
          enrollment={editing}
          classes={classes}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            mutate();
            mutateClasses();
          }}
        />
      )}
    </section>
  );
}

/** 班级管理面板：班级 + 名单 + 本班小组管理（嵌在班级卡片内）。 */
function ClassPanel({
  courseId,
  classes,
  onChanged
}: {
  courseId: string;
  classes: { id: number; name: string; memberCount: number; groupCount: number }[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const { data: groupsData, mutate: mutateGroups } = useSWR<{
    groups: {
      id: number;
      name: string;
      status: string;
      classId: number | null;
      members: { userId: number; name: string | null; duty: string }[];
    }[];
  }>(`/api/courses/${courseId}/groups`, fetcher);

  const allGroups = groupsData?.groups ?? [];

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) {
      setMsg('请填写班级名称');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`/api/courses/${courseId}/classes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed })
      });
      const body = await res.json().catch(() => ({ error: '响应不是 JSON' }));
      if (!res.ok) {
        setMsg(body.error ?? `创建失败（HTTP ${res.status}）`);
        return;
      }
      setName('');
      setOpen(false);
      setMsg('');
      onChanged();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '网络错误，创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function rename(c: { id: number; name: string }) {
    const next = window.prompt('班级名称', c.name);
    if (!next || next.trim() === c.name) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/classes/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next.trim() })
      });
      const body = await res.json().catch(() => ({ error: '响应不是 JSON' }));
      if (!res.ok) setMsg(body.error ?? '改名失败');
      else {
        setMsg('');
        onChanged();
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '网络错误');
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: { id: number; name: string; groupCount: number }) {
    const active = allGroups.filter((g) => g.classId === c.id && g.status === 'active').length;
    if (active > 0) {
      setMsg(`「${c.name}」仍有 ${active} 个进行中小组，请先在下方解散`);
      return;
    }
    if (!window.confirm(`删除班级「${c.name}」？成员将回到未分班，不会移出名单。`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/classes/${c.id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({ error: '响应不是 JSON' }));
      if (!res.ok) setMsg(body.error ?? '删除失败');
      else {
        setMsg('');
        onChanged();
        void mutateGroups();
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '网络错误');
    } finally {
      setBusy(false);
    }
  }

  async function dissolveGroup(groupId: number, gname: string) {
    if (!window.confirm(`解散「${gname}」？成员将回池，小组任务与交付物归档。`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/dissolve`, { method: 'POST' });
      const body = await res.json().catch(() => ({ error: '响应不是 JSON' }));
      if (!res.ok) setMsg(body.error ?? '解散失败');
      else {
        setMsg('');
        void mutateGroups();
        onChanged();
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '网络错误');
    } finally {
      setBusy(false);
    }
  }

  function toggleGroups(key: string) {
    setOpenGroups((m) => ({ ...m, [key]: !m[key] }));
  }

  return (
    <Card className="mb-4">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base">班级与名单（{classes.length} 班）</CardTitle>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) {
              setMsg('');
              setName('');
            }
          }}
        >
          <DialogTrigger asChild>
            <Button type="button" size="sm" variant="outline">
              新建班级
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>新建班级</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="new-class-name">班级名称</Label>
                <Input
                  id="new-class-name"
                  placeholder="如：数字媒体本24-1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void create();
                    }
                  }}
                />
              </div>
              {msg && <p className="text-sm text-destructive">{msg}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button type="button" disabled={busy || !name.trim()} onClick={() => void create()}>
                  {busy ? '创建中…' : '创建'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          班级、名单、小组在同一处维护：成员用编辑分班，小组管理在本班卡片内。
        </p>
        {msg && !open && <p className="text-sm text-destructive">{msg}</p>}
        {classes.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            还没有班级。点「新建班级」，或在 CSV 导入时带上 class_name 自动建班。
          </p>
        )}
        <div className="space-y-3">
          {classes.map((c) => {
            const key = `c${c.id}`;
            const groups = allGroups.filter((g) => g.classId === c.id);
            const active = groups.filter((g) => g.status === 'active').length;
            const dissolved = groups.filter((g) => g.status === 'dissolved').length;
            return (
              <ClassShell
                key={c.id}
                classInfo={c}
                actions={
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      disabled={busy}
                      onClick={() => void rename(c)}
                    >
                      改名
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-destructive"
                      disabled={busy}
                      onClick={() => void remove(c)}
                    >
                      删除
                    </Button>
                  </>
                }
              >
                <GroupPanelInClass
                  open={openGroups[key] ?? false}
                  onToggle={() => toggleGroups(key)}
                  activeCount={active}
                  dissolvedCount={dissolved}
                >
                  {groups.length === 0 ? (
                    <p className="py-3 text-center text-sm text-muted-foreground">
                      本班还没有小组。到「分组工作台」生成并选定方案。
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {groups.map((g) => (
                        <div
                          key={g.id}
                          className="rounded-md border bg-background px-3 py-2 text-sm"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{g.name}</span>
                            <Badge variant={g.status === 'active' ? 'default' : 'secondary'}>
                              {g.status === 'active' ? '进行中' : g.status === 'dissolved' ? '已解散' : g.status}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {g.members.length} 人
                            </span>
                            {g.status === 'active' && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="ml-auto h-7 px-2 text-destructive"
                                disabled={busy}
                                onClick={() => void dissolveGroup(g.id, g.name)}
                              >
                                解散
                              </Button>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {g.members
                              .map((m) => `${m.name ?? `#${m.userId}`}${m.duty === 'lead' ? '（组长）' : ''}`)
                              .join('、') || '（无成员）'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </GroupPanelInClass>
              </ClassShell>
            );
          })}
        </div>
        {(() => {
          const ungrouped = allGroups.filter((g) => g.classId == null);
          if (ungrouped.length === 0) return null;
          const active = ungrouped.filter((g) => g.status === 'active').length;
          const dissolved = ungrouped.filter((g) => g.status === 'dissolved').length;
          return (
            <ClassShell
              classInfo={{ id: 0, name: '未分班小组', memberCount: 0, groupCount: active }}
              hint="跨班或尚未写入班级归属的小组"
            >
              <GroupPanelInClass
                open={openGroups.none ?? false}
                onToggle={() => toggleGroups('none')}
                activeCount={active}
                dissolvedCount={dissolved}
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  {ungrouped.map((g) => (
                    <div key={g.id} className="rounded-md border bg-background px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{g.name}</span>
                        <Badge variant={g.status === 'active' ? 'default' : 'secondary'}>
                          {g.status === 'active' ? '进行中' : g.status === 'dissolved' ? '已解散' : g.status}
                        </Badge>
                        {g.status === 'active' && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="ml-auto h-7 px-2 text-destructive"
                            disabled={busy}
                            onClick={() => void dissolveGroup(g.id, g.name)}
                          >
                            解散
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </GroupPanelInClass>
            </ClassShell>
          );
        })()}
      </CardContent>
    </Card>
  );
}

function ImportDialog({ courseId, onDone }: { courseId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [report, setReport] = useState<{
    total: number;
    added: number;
    skipped: number;
    errors: { row: number; message: string }[];
  } | null>(null);
  const [error, setError] = useState('');

  async function submit() {
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/courses/${courseId}/enrollments/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv })
      });
      if (!res.ok) throw new Error((await res.json()).error ?? '导入失败');
      const body = await res.json();
      setReport(body.report);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setSubmitting(false);
    }
  }

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ''));
    reader.readAsText(file, 'utf-8');
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Upload className="mr-1 h-4 w-4" />
          导入 CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>批量导入名单</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            表头：<code className="rounded bg-muted px-1">{CSV_TEMPLATE}</code>
            （class_name 可省略；已存在的学生自动跳过，不覆盖）
          </p>
          <Input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <Textarea
            rows={8}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={`${CSV_TEMPLATE}\n张三,zhangsan@example.com,20260001,数媒本24-1`}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          {report && (
            <div className="rounded-md border p-3 text-sm">
              <p>
                共 {report.total} 行：新增 <strong>{report.added}</strong>，跳过{' '}
                <strong>{report.skipped}</strong>
              </p>
              {report.errors.length > 0 && (
                <ul className="mt-2 max-h-32 overflow-auto text-destructive">
                  {report.errors.map((e, i) => (
                    <li key={i}>第 {e.row} 行：{e.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>关闭</Button>
            <Button disabled={submitting || !csv.trim()} onClick={submit}>
              {submitting ? '导入中…' : '开始导入'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditMemberDialog({
  enrollment,
  classes,
  onClose,
  onDone
}: {
  enrollment: Enrollment;
  classes: { id: number; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [role, setRole] = useState(enrollment.role);
  const [classId, setClassId] = useState(enrollment.classId ? String(enrollment.classId) : 'none');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/enrollments/${enrollment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          classId: classId === 'none' ? null : Number(classId)
        })
      });
      if (!res.ok) throw new Error((await res.json()).error ?? '保存失败');
      onDone();
    } catch {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>编辑成员：{enrollment.user.name ?? enrollment.user.email}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>角色</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="member">队员</SelectItem>
                <SelectItem value="captain">队长</SelectItem>
                <SelectItem value="assistant">助教</SelectItem>
                <SelectItem value="teacher">教师</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>班级</Label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">未分班</SelectItem>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button disabled={saving} onClick={save}>{saving ? '保存中…' : '保存'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
