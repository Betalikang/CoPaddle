'use client';

import useSWR from 'swr';
import { use, useMemo, useState } from 'react';
import { Search, Upload, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
  const { data: classData } = useSWR<{ classes: { id: number; name: string }[] }>(
    `/api/courses/${id}/classes`,
    fetcher
  );

  const enrollments = enrollData?.enrollments ?? [];
  const classes = classData?.classes ?? [];

  const [keyword, setKeyword] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [classFilter, setClassFilter] = useState('all');
  const [editing, setEditing] = useState<Enrollment | null>(null);

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

  return (
    <section className="flex-1 p-4 lg:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg lg:text-2xl font-medium">名单管理</h1>
          {cardData && (
            <p className="text-sm text-muted-foreground">
              技能卡填写进度：{cardData.filled} / {cardData.total}
            </p>
          )}
        </div>
        <ImportDialog courseId={id} onDone={() => mutate()} />
      </div>

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
                {filtered.map((e) => (
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
                      <Button variant="ghost" size="sm" onClick={() => setEditing(e)}>
                        <UserCog className="mr-1 h-4 w-4" />
                        编辑
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
          }}
        />
      )}
    </section>
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
