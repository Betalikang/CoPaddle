'use client';

import useSWR from 'swr';
import { use, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

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

/** 成绩导出（规格书 P-23）：勾选列 → 预览前 10 行 → 下载 CSV。 */
export default function GradeExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [cols, setCols] = useState<string[]>(COLUMNS.map((c) => c.key));
  const [preview, setPreview] = useState<string[][] | null>(null);

  const { data, isLoading } = useSWR<{
    groups: { id: number; name: string; members: { userId: number; name: string | null; studentNo: string | null; duty: string }[] }[];
  }>(`/api/courses/${id}/groups`, fetcher);

  function toggle(key: string) {
    setCols((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function loadPreview() {
    const res = await fetch(`/api/courses/${id}/grade-export`);
    const text = await res.text();
    const rows = text
      .replace(/^\uFEFF/, "")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(","));
    const header = rows[0] ?? [];
    const idx = cols.map((k) => {
      const map: Record<string, string> = {
        student_no: '学号',
        name: '姓名',
        group: '小组',
        duty: '角色',
        low: '贡献区间低',
        high: '贡献区间高',
        review_low: '终审低',
        review_high: '终审高',
        peer_median: '互评中位数',
        task_rate: '任务完成率'
      };
      return header.indexOf(map[k]);
    });
    const body = rows.slice(1, 11).map((r) => idx.map((i) => (i >= 0 ? r[i] : "")));
    setPreview([idx.map((i) => (i >= 0 ? header[i] : "")), ...body]);
  }

  function download() {
    window.open(`/api/courses/${id}/grade-export`, "_blank");
  }

  const totalMembers = (data?.groups ?? []).reduce((n, g) => n + g.members.length, 0);

  return (
    <section className="flex-1">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg lg:text-2xl font-medium">成绩导出</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadPreview} disabled={isLoading}>
            <FileSpreadsheet className="mr-1 h-4 w-4" />
            预览前 10 行
          </Button>
          <Button onClick={download}>
            <Download className="mr-1 h-4 w-4" />
            下载 CSV
          </Button>
        </div>
      </div>

      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">导出列（共 {totalMembers} 名学生）</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {COLUMNS.map((c) => (
            <Badge
              key={c.key}
              variant={cols.includes(c.key) ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => toggle(c.key)}
            >
              {c.label}
            </Badge>
          ))}
        </CardContent>
      </Card>

      {isLoading && <Skeleton className="h-32" />}

      {preview && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">预览</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  {preview[0].map((h, i) => (
                    <th key={i} className="py-1 pr-3 text-left font-medium text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(1).map((row, ri) => (
                  <tr key={ri} className="border-b last:border-0">
                    {row.map((cell, ci) => (
                      <td key={ci} className="py-1 pr-3 tabular-nums">
                        {cell || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        贡献为系统给出的区间（不给单一分数）；终审低/高为教师调整后的值；互评中位数取最近已关闭轮次。
      </p>
    </section>
  );
}
