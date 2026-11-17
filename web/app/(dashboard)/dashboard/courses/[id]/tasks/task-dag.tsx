'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Button } from '@/components/ui/button';
import { Callout, Panel } from '@/components/page-shell';
import {
  STATUS_COLOR,
  STATUS_LABEL,
  daysLeft,
  hoursOf,
  type Dep,
  type Task
} from './task-shared';

/* ---------------------------------------------------------------------------
 * DAG 画布
 *
 * 旧实现固定 x = 层 × 260、y = 同层序号 × 110：9 个任务的链排成 1780px 宽的一条，
 * 容器只有 1100×418，fitView 被宽度限死到 0.515，12px 的正文最后渲染成 6.2px，
 * 等于看不清。而且同层单节点一律顶到 y=0，T3→T5 这种边要斜穿半张图。
 *
 * 现在：
 *   1) 长链题竖向排、宽扇出题横向排——两种朝向各算一次适配缩放，取大的；
 *   2) 同层居中 + 重心排序（barycenter 上下各扫两轮）减少连线交叉；
 *   3) 节点固定 210×64，自定义节点组件（memo），标题单行截断、悬停看全名；
 *   4) 关键路径只标真正的链上那条边（按关键前驱判定），不再"两端关键就标红"；
 *      前序已完成的边转绿、目标被阻塞的边虚线；
 *   5) 依赖成环的任务单独排到末端并给出提示，不再静默混进第 0 层。
 * ------------------------------------------------------------------------- */

const DAG_NODE_W = 210;
const DAG_NODE_H = 64;
const DAG_PITCH_X = DAG_NODE_W + 36;
const DAG_PITCH_Y = DAG_NODE_H + 22;

type DagNodeData = {
  code: string;
  title: string;
  status: string;
  hours: string;
  critical: boolean;
  overdue: boolean;
  lead: string | null;
  active: boolean;
  vertical: boolean;
};

/** 自定义节点：固定尺寸，保证布局里算的间距和实际渲染一致。 */
const DagTaskNode = memo(function DagTaskNode({ data }: NodeProps<DagNodeData>) {
  const color = STATUS_COLOR[data.status] ?? '#a1a1aa';
  const full = `${data.code} ${data.title} · ${STATUS_LABEL[data.status] ?? data.status} · ${data.hours}h`;
  return (
    <div
      title={full}
      className="flex h-[64px] w-[210px] flex-col justify-center gap-0.5 rounded-lg border-2 bg-card px-2.5 py-1.5 text-left"
      style={{
        borderColor: color,
        /*
          选中态的环用 var(--brand)，不用写死的浅橙 rgba(253,186,116,0.9)。
          写死的值在深色主题下是唯一一处「浅色版的橙」，压在夜底上比周围都亮，
          而换色板时它又不会跟着变——这类残留只能靠跟着主题变量走才不复发。
          boxShadow 里的 var() 在元素自身计算，能正确取到所在 .dark 上下文的值。
        */
        boxShadow: data.active
          ? '0 0 0 3px var(--brand)'
          : data.critical
            ? '0 0 0 3px rgba(239,68,68,0.12)'
            : '0 1px 2px rgba(0,0,0,0.05)'
      }}
    >
      <Handle
        type="target"
        position={data.vertical ? Position.Top : Position.Left}
        className="!h-1 !w-1 !min-w-0 !border-0 !bg-transparent"
      />
      <Handle
        type="source"
        position={data.vertical ? Position.Bottom : Position.Right}
        className="!h-1 !w-1 !min-w-0 !border-0 !bg-transparent"
      />
      <div className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="font-mono text-[10px] font-semibold text-muted-foreground">{data.code}</span>
        {data.critical && (
          <span className="rounded bg-danger/10 px-1.5 text-[10px] font-medium text-danger">
            关键
          </span>
        )}
        {data.overdue && (
          <span className="rounded bg-warning/10 px-1.5 text-[10px] font-medium text-warning">
            逾期
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {data.hours}h
        </span>
      </div>
      <div className="truncate text-[12px] font-medium leading-4 text-foreground">{data.title}</div>
      <div className="truncate text-[10px] leading-3 text-muted-foreground">
        {STATUS_LABEL[data.status] ?? data.status}
        {data.lead ? ` · ${data.lead}` : ''}
      </div>
    </div>
  );
});

const DAG_NODE_TYPES = { task: DagTaskNode };

type DagOrient = 'lr' | 'tb';

/**
 * 分层 + 排序 + 定位。层号取最长路径（关键路径判定也依赖它），
 * 朝向按"哪种排法在给定容器里缩放更大"选。
 */
function buildDag(
  tasks: Task[],
  deps: Dep[],
  opts: {
    activeId: number | null;
    paneW: number;
    paneH: number;
    leadOf: (t: Task) => string | null;
    critOnly: boolean;
  }
): {
  nodes: Node[];
  edges: Edge[];
  cyclic: Task[];
  criticalIds: number[];
  orient: DagOrient;
  grid: boolean;
} {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ups = new Map<number, number[]>();
  const downs = new Map<number, number[]>();
  for (const t of tasks) {
    ups.set(t.id, []);
    downs.set(t.id, []);
  }
  for (const d of deps) {
    if (!byId.has(d.taskId) || !byId.has(d.dependsOnId) || d.taskId === d.dependsOnId) continue;
    ups.get(d.taskId)!.push(d.dependsOnId);
    downs.get(d.dependsOnId)!.push(d.taskId);
  }

  // Kahn + 最长路径：一趟 O(n + e)，顺便把成环的任务挑出来
  const indeg = new Map<number, number>();
  for (const t of tasks) indeg.set(t.id, ups.get(t.id)!.length);
  const level = new Map<number, number>();
  const queue: number[] = tasks.filter((t) => (indeg.get(t.id) ?? 0) === 0).map((t) => t.id);
  for (const id of queue) level.set(id, 0);
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    for (const nxt of downs.get(id) ?? []) {
      level.set(nxt, Math.max(level.get(nxt) ?? 0, (level.get(id) ?? 0) + 1));
      const left = (indeg.get(nxt) ?? 0) - 1;
      indeg.set(nxt, left);
      if (left === 0) queue.push(nxt);
    }
  }
  const cyclic = tasks.filter((t) => !level.has(t.id));
  const maxLv = [...level.values()].reduce((a, b) => Math.max(a, b), 0);
  const cyclicLv = maxLv + 1;
  for (const t of cyclic) level.set(t.id, cyclicLv);

  const layerCount = maxLv + 1 + (cyclic.length ? 1 : 0);
  const layers: number[][] = Array.from({ length: layerCount }, () => []);
  for (const t of tasks) layers[level.get(t.id) ?? 0].push(t.id);
  // 层内初始顺序按任务排序号，保证每次渲染稳定
  for (const layer of layers) layer.sort((a, b) => (byId.get(a)!.orderIndex - byId.get(b)!.orderIndex) || a - b);

  // 重心排序：上下各扫两轮，减少连线交叉
  const posInLayer = new Map<number, number>();
  const syncPos = () => layers.forEach((l) => l.forEach((id, i) => posInLayer.set(id, i)));
  syncPos();
  for (let pass = 0; pass < 2; pass++) {
    for (let li = 1; li < layers.length; li++) {
      const layer = layers[li];
      const bc = new Map<number, number>();
      for (const id of layer) {
        const anchors = (ups.get(id) ?? [])
          .filter((u) => (level.get(u) ?? 0) < li)
          .map((u) => posInLayer.get(u));
        bc.set(id, anchors.length ? anchors.reduce<number>((a, b) => a + (b ?? 0), 0) / anchors.length : posInLayer.get(id) ?? 0);
      }
      layer.sort((a, b) => (bc.get(a)! - bc.get(b)!) || (posInLayer.get(a)! - posInLayer.get(b)!));
      layer.forEach((id, i) => posInLayer.set(id, i));
    }
    for (let li = layers.length - 2; li >= 0; li--) {
      const layer = layers[li];
      const bc = new Map<number, number>();
      for (const id of layer) {
        const anchors = (downs.get(id) ?? [])
          .filter((v) => (level.get(v) ?? 0) > li)
          .map((v) => posInLayer.get(v));
        bc.set(id, anchors.length ? anchors.reduce<number>((a, b) => a + (b ?? 0), 0) / anchors.length : posInLayer.get(id) ?? 0);
      }
      layer.sort((a, b) => (bc.get(a)! - bc.get(b)!) || (posInLayer.get(a)! - posInLayer.get(b)!));
      layer.forEach((id, i) => posInLayer.set(id, i));
    }
  }

  // 朝向：两种排法各算适配缩放，取大的（容器宽时宽扇出横排、链式竖排）
  const maxCross = layers.reduce((a, l) => Math.max(a, l.length), 1);
  const dims = (o: DagOrient) => ({
    w:
      o === 'lr'
        ? (layers.length - 1) * DAG_PITCH_X + DAG_NODE_W
        : (maxCross - 1) * DAG_PITCH_X + DAG_NODE_W,
    h:
      o === 'lr'
        ? (maxCross - 1) * DAG_PITCH_Y + DAG_NODE_H
        : (layers.length - 1) * DAG_PITCH_Y + DAG_NODE_H
  });
  const fitOf = (o: DagOrient) => {
    const d = dims(o);
    return Math.min(opts.paneW / Math.max(d.w, 1), opts.paneH / Math.max(d.h, 1));
  };
  // 完全没有依赖关系时排网格，别拉成一条两千像素的横条
  const flat = layers.length <= 1;
  const orient: DagOrient = flat ? 'tb' : fitOf('tb') > fitOf('lr') ? 'tb' : 'lr';

  const pos = new Map<number, { x: number; y: number }>();
  if (flat) {
    const cols = Math.max(1, Math.min(tasks.length, Math.floor(opts.paneW / DAG_PITCH_X)));
    tasks.forEach((t, i) => {
      pos.set(t.id, { x: (i % cols) * DAG_PITCH_X, y: Math.floor(i / cols) * DAG_PITCH_Y });
    });
  } else {
    const crossPitch = orient === 'lr' ? DAG_PITCH_Y : DAG_PITCH_X;
    const alongPitch = orient === 'lr' ? DAG_PITCH_X : DAG_PITCH_Y;
    layers.forEach((layer, li) => {
      const span = (layer.length - 1) * crossPitch;
      const start = ((maxCross - 1) * crossPitch - span) / 2;
      layer.forEach((id, i) => {
        const cross = start + i * crossPitch;
        const along = li * alongPitch;
        pos.set(id, orient === 'lr' ? { x: along, y: cross } : { x: cross, y: along });
      });
    });
  }

  // 关键路径：每个关键任务只在"关键前驱"里取层号最大的那一个作为链上前驱，
  // 这样标红的是一条链，而不是所有两端都关键的边。
  const critPred = new Map<number, number>();
  for (const t of tasks) {
    if (!t.onCriticalPath) continue;
    const cands = (ups.get(t.id) ?? []).filter((u) => byId.get(u)?.onCriticalPath);
    if (!cands.length) continue;
    critPred.set(
      t.id,
      cands.reduce((a, b) => ((level.get(a) ?? 0) >= (level.get(b) ?? 0) ? a : b))
    );
  }

  const nodes: Node[] = tasks.map((t) => ({
    id: String(t.id),
    type: 'task',
    position: pos.get(t.id) ?? { x: 0, y: 0 },
    draggable: false,
    data: {
      code: t.code,
      title: t.title,
      status: t.status,
      hours: String(Number(hoursOf(t.estHours).toFixed(1))),
      critical: !!t.onCriticalPath,
      overdue: t.status !== 'done' && t.status !== 'cancelled' && (daysLeft(t.dueAt) ?? 0) < 0,
      lead: opts.leadOf(t),
      active: opts.activeId === t.id,
      vertical: orient === 'tb'
    }
  }));

  const edges: Edge[] = [];
  const seenEdge = new Set<string>();
  for (const d of deps) {
    const src = byId.get(d.dependsOnId);
    const dst = byId.get(d.taskId);
    if (!src || !dst || src.id === dst.id) continue;
    // task_deps 没有唯一约束，重复边会让两条线重叠、key 冲突
    const key = `${src.id}-${dst.id}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    const critical = critPred.get(dst.id) === src.id;
    const satisfied = src.status === 'done';
    const color = critical ? '#ef4444' : satisfied ? '#22c55e' : '#94a3b8';
    edges.push({
      id: `e${src.id}-${dst.id}`,
      source: String(src.id),
      target: String(dst.id),
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15, color },
      style: {
        stroke: color,
        strokeWidth: critical ? 2.2 : 1.5,
        strokeDasharray: dst.status === 'blocked' && !critical ? '5 4' : undefined
      },
      animated: critical && dst.status !== 'done'
    });
  }

  // 「只看关键路径」：不隐藏节点（会让布局跳变），只压暗非关键的一半，路径更突出
  if (opts.critOnly) {
    for (const n of nodes) {
      const d = n.data as DagNodeData;
      if (!d.critical && !d.active) n.style = { ...n.style, opacity: 0.22 };
    }
    for (const e of edges) {
      const critical = critPred.get(Number(e.target)) === Number(e.source);
      if (!critical) e.style = { ...e.style, opacity: 0.18 };
    }
  }

  return {
    nodes,
    edges,
    cyclic,
    criticalIds: tasks.filter((t) => t.onCriticalPath).map((t) => t.id),
    orient,
    grid: flat
  };
}

/**
 * 任务 DAG 面板：画布尺寸测量、朝向选择、fitView、「只看关键路径」都在组件内自管理，
 * 页面只负责给数据与两个回调（点节点定位任务行 / 点空白取消高亮）。
 */
export default function TaskDag({
  tasks,
  deps,
  leadOf,
  highlightId,
  onSelectTask,
  onClearHighlight,
  fitKey
}: {
  tasks: Task[];
  deps: Dep[];
  leadOf: (t: Task) => string | null;
  highlightId: number | null;
  onSelectTask: (id: number) => void;
  onClearHighlight: () => void;
  /** 换小组时重新适配画布：原实现把 group?.id 放进 fitView 的依赖里 */
  fitKey?: string | number;
}) {
  // DAG 画布实际尺寸：用 ResizeObserver 量，朝向按真实宽高选（手机和宽屏差很多）
  const paneRef = useRef<HTMLDivElement | null>(null);
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const [paneSize, setPaneSize] = useState({ w: 1100, h: 430 });
  const [critOnly, setCritOnly] = useState(false);
  useEffect(() => {
    const el = paneRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return;
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      setPaneSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tasks.length]);

  const dag = useMemo(
    () =>
      buildDag(tasks, deps, {
        activeId: highlightId,
        paneW: paneSize.w,
        paneH: paneSize.h,
        leadOf,
        critOnly
      }),
    [tasks, deps, highlightId, paneSize.w, paneSize.h, leadOf, critOnly]
  );
  const { nodes, edges } = dag;

  // fitView 只在挂载时生效一次：换小组、画布尺寸或朝向变了要重新适配
  useEffect(() => {
    if (!tasks.length) return;
    const timer = setTimeout(
      () => rfRef.current?.fitView({ padding: 0.06, duration: 200 }),
      80
    );
    return () => clearTimeout(timer);
  }, [tasks.length, fitKey, dag.orient]);

  const handleNodeClick = useCallback(
    (_: unknown, node: Node) => onSelectTask(Number(node.id)),
    [onSelectTask]
  );

  return (
    <Panel
      title="任务 DAG"
      hint={
        dag.grid
          ? '还没有依赖关系，先按任务顺序排列；加依赖后会自动分层'
          : dag.orient === 'tb'
            ? '自上而下 = 先后顺序；节点配色 = 状态，红边 = 关键路径，绿边 = 前序已完成'
            : '从左到右 = 先后顺序；节点配色 = 状态，红边 = 关键路径，绿边 = 前序已完成'
      }
      actions={
        dag.criticalIds.length > 0 ? (
          <Button
            size="sm"
            variant={critOnly ? 'default' : 'outline'}
            title="压暗与关键路径无关的任务，方便看清主链"
            onClick={() => setCritOnly((v) => !v)}
          >
            只看关键路径
          </Button>
        ) : undefined
      }
    >
      {dag.cyclic.length > 0 && (
        <div className="mb-2">
          <Callout tone="warn" title="依赖成环，这部分排不出先后">
            环上的任务（{dag.cyclic.map((t) => t.code).join('、')}
            ）已单独排在末端。删掉其中一条依赖即可恢复。
          </Callout>
        </div>
      )}
      <div
        ref={paneRef}
        className="h-[440px] rounded border md:h-[540px]"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={DAG_NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.06 }}
          minZoom={0.2}
          maxZoom={1.8}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          onInit={(inst) => {
            rfRef.current = inst;
          }}
          onNodeClick={handleNodeClick}
          onPaneClick={() => onClearHighlight()}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
          {tasks.length > 12 && (
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => STATUS_COLOR[(n.data as DagNodeData)?.status] ?? '#a1a1aa'}
            />
          )}
        </ReactFlow>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {Object.entries(STATUS_LABEL)
          .filter(([k]) => k !== 'cancelled')
          .map(([k, label]) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: STATUS_COLOR[k] }}
              />
              {label}
            </span>
          ))}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 rounded bg-danger" />
          关键路径
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 rounded bg-success" />
          前序已完成
        </span>
        <span className="text-muted-foreground/70">
          · 点击节点定位到下方任务行，点空白处取消高亮
        </span>
      </div>
    </Panel>
  );
}