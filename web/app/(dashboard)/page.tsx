import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getUser } from '@/lib/db/queries';
import { Button } from '@/components/ui/button';
import { courseNavGroups } from '@/lib/course-nav';

/**
 * 共桨产品首页。已登录用户直接进入课程工作台。
 *
 * ===== 这一版为什么长这样 =====
 * 上一版是「居中大标题 + 三张图标卡 + 四张步骤卡 + 渐变 CTA」，也就是任何 SaaS 落地页的默认骨架。
 * 问题不在美观，在于它没有说出产品是什么：CoPaddle 真正的资产是**可核对的东西**——
 * 求解器给出的分组方案与违规项、任务 DAG 与依赖边、贡献区间账本。这些都能摊开逐条查。
 *
 * 所以这一版：
 * - 左对齐、像一份文件而不是一张广告；留白靠网格与横线组织，不靠卡片浮起；
 * - 全页只有一处"用力"：Hero 下方那条**航道**（五段流水线），加载时从左展开一次。
 *   其余部分刻意安静——每段都 fade-in、每张卡都 hover 抬起，是最容易被看出是生成式的痕迹；
 * - 文案里出现的是代码里真实存在的常量（200 人精确求解上限、120 秒 AI 上限、
 *   四维权重、方案 A/B/C），不是"赋能""闭环"这类填充词。
 */

/** 航道分段：与 lib/course-nav.ts 的五组导航同源，改导航这里不会漂。 */
const LANE = [
  { key: 'setup', artifact: '名单、技能卡、分组策略' },
  { key: 'grouping', artifact: '三套方案 + 违规项' },
  { key: 'execution', artifact: '任务 DAG 与协作契约' },
  { key: 'collab', artifact: '健康度、冲突、重规划' },
  { key: 'review', artifact: '贡献区间账本与互评' }
];

/** 取五个分组的显示名，避免在页面上再抄一遍中文。 */
function laneStations() {
  const groups = courseNavGroups(0, 'teacher');
  return LANE.map((seg) => {
    const hit = groups.find((g) => g.key === seg.key);
    return { label: hit?.label ?? seg.key, artifact: seg.artifact };
  });
}

export default async function HomePage() {
  const user = await getUser();
  if (user) {
    redirect('/dashboard');
  }

  const stations = laneStations();

  return (
    <main className="flex-1">
      {/* ---------- Hero：左对齐，像文件抬头 ---------- */}
      <section className="border-b">
        <div className="mx-auto max-w-6xl px-4 pb-14 pt-16 sm:px-6 sm:pt-24 lg:px-8">
          <h1 className="max-w-3xl text-display font-bold text-balance">
            分组不是目的，
            <br />
            让责任落到人头上才是。
          </h1>

          <div className="mt-8 grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:items-start lg:gap-16">
            <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              共桨把一门课的小组协作摊成一条可以逐条核对的流水线：约束求解器先算出技能互补、弱连接引入、
              组间均衡、历史规避都满足的分组；AI 读作业要求产出任务 DAG 与协作契约；
              过程中按阻塞、失联、过载三维健康度报警并给出带代价的重规划方案；
              最后按交付物溯源生成贡献区间账本——系统只给依据，分数归教师。
            </p>

            <div className="flex flex-col items-start gap-3 md:items-end">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href="/sign-in">进入课程工作台</Link>
              </Button>
              <Link
                href="#pipeline"
                className="text-sm font-medium text-foreground/70 underline-offset-4 hover:text-foreground hover:underline"
              >
                先看这条流水线是怎么走的
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- 航道：全页唯一的"用力"之处 ---------- */}
      <section id="pipeline" className="border-b bg-card">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <h2 className="text-title font-semibold">
              五段航道，每一段都留下可查的记录
            </h2>
            <p className="text-sm text-muted-foreground">
              左侧栏按同一顺序排列，任意一段都能直接进去
            </p>
          </div>

          {/* 横向航道（>=sm）。竖线版本给窄屏，两版共用同一份数据 */}
          <ol className="mt-10 hidden sm:grid sm:grid-cols-5">
            {stations.map((station, index) => (
              <li key={station.label} className="relative flex flex-col">
                {/* 线在文字上方一格，节点压在线上 */}
                <div className="relative flex h-6 items-center">
                  <span
                    className="animate-lane absolute inset-x-0 top-1/2 h-px bg-foreground/25"
                    style={{ animationDelay: `${index * 120}ms` }}
                    aria-hidden
                  />
                  <span
                    className="animate-lane-dot relative z-10 size-2.5 rounded-full border border-foreground bg-background"
                    style={{ animationDelay: `${index * 120 + 220}ms` }}
                    aria-hidden
                  />
                </div>
                <p className="mt-3 pr-4 text-sm font-semibold">{station.label}</p>
                <p className="mt-1 pr-4 text-xs leading-relaxed text-muted-foreground">
                  {station.artifact}
                </p>
              </li>
            ))}
          </ol>

          {/* 竖向航道（<sm）：竖线穿过节点，避免窄屏横向挤压 */}
          <ol className="mt-8 border-l border-foreground/25 sm:hidden">
            {stations.map((station) => (
              <li key={station.label} className="relative pl-5 pb-5 last:pb-0">
                <span
                  className="absolute -left-[5px] top-1.5 size-2.5 rounded-full border border-foreground bg-background"
                  aria-hidden
                />
                <p className="text-sm font-semibold">{station.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {station.artifact}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- 求解：把"约束"讲成具体的数字 ---------- */}
      <section className="border-b">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
          <h2 className="text-title max-w-2xl font-semibold">
            分组由约束求解器给出，不是打乱重排
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            四个目标同时优化，硬约束不满足的方案直接不产出——而不是产出一个「差不多」的结果再让你猜哪里不对。
            规模上限也是明说的事：学生数超过 200 人会退化为快速模式，结果不再保证最优。
          </p>

          <dl className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            <Spec term="技能互补" desc="组内技能画像覆盖度，弱势技能必须有人兜" />
            <Spec term="弱连接引入" desc="把历史上没合作过的人放到一组，避免小圈子固化" />
            <Spec term="组间均衡" desc="各组综合能力均值不拉开档，避免一强多弱" />
            <Spec term="历史规避" desc="按历史同组边降权，避免同一批人反复成组" />
          </dl>

          <p className="mt-8 max-w-2xl text-sm text-muted-foreground">
            三套方案并排给出，每个方案都带自己的硬约束违规项与四维得分。拖动成员微调时先做预演——
            预演阶段不落库，只有确认应用才写进正式小组，所以"看了一眼"不会污染数据。
          </p>
        </div>
      </section>

      {/* ---------- 三个角色：横线分栏，不做三张同构卡 ---------- */}
      <section className="border-b bg-card">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
          <h2 className="text-title max-w-2xl font-semibold">
            三个角色，各自拿到一件可执行的东西
          </h2>

          <div className="mt-10 divide-y border-y">
            <Role
              role="教师与助教"
              title="过程里可以介入的合法理由"
              points={[
                '生成前先诊断规模是否可行，差几个人、该改成多少，直接给到可以填的数值',
                '三套方案对比四维得分与违规项，选定后才生成正式小组',
                '健康度按阻塞 / 失联 / 过载三维算，低于阈值或诊断非空才进预警中心',
                '终审贡献账本并调分；成绩按 CSV 导出'
              ]}
            />
            <Role
              role="队长"
              title="一句「不是我针对你，是系统判定的阻塞」"
              points={[
                '确认并微调 AI 拆解出的任务 DAG，补依赖边',
                '按主责 / 协作 / 审阅指派，队长只能管本组',
                '重规划不是拍脑袋：方案 A 重新分配、B 缩减范围、C 组间补位，各有代价说明',
                '缩减范围会在同一事务里把被砍任务流转为已取消，要么全成要么全不生效'
              ]}
            />
            <Role
              role="队员"
              title="看得见的规则与申诉入口"
              points={[
                '我的部分：负责什么、依赖谁、什么时候必须交',
                '交付物在平台内分段撰写，写入即溯源',
                '贡献账本以区间呈现，不把估计说成定论；对归因有异议可以走申诉',
                '互评轮次开放后按轮次提交，异常数据会被单独标出'
              ]}
            />
          </div>
        </div>
      </section>

      {/* ---------- 归因：讲清"系统只给依据" ---------- */}
      <section className="border-b">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16">
            <div>
              <h2 className="text-title max-w-xl font-semibold">
                贡献是一段区间，不是一个用来排名的分数
              </h2>
              <p className="mt-3 max-w-xl text-muted-foreground">
                把谁的活算到谁头上，本来就带着不确定性。共桨输出的是每个人贡献占比的上下界，
                并附上支撑这个区间的交付物证据；系统不替你下判断，也不假装那是个精确值。
              </p>
              <p className="mt-3 max-w-xl text-sm text-muted-foreground">
                证据权重可调（产出 / 过程 / 同伴），改动后重新计算的是区间，不是结论——
                最终怎么给分，仍然是任课教师的决定。
              </p>
            </div>

            {/* 区间示意：明确标注为示意图，不伪造具体数值 */}
            <figure className="rounded-md border bg-card p-5">
              <figcaption className="text-xs text-muted-foreground">
                账本呈现方式示意（非真实数据）
              </figcaption>
              <div className="mt-4 space-y-4">
                <IntervalRow label="成员 A" from={18} to={34} />
                <IntervalRow label="成员 B" from={22} to={31} />
                <IntervalRow label="成员 C" from={12} to={26} />
              </div>
              <p className="mt-5 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                每段区间都能下钻到具体交付物与 diff 归属；区间越窄说明证据越充分，越宽说明该成员的贡献缺乏可溯源产出。
              </p>
            </figure>
          </div>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="flex flex-col items-start gap-6 border-l-2 border-brand pl-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">
                把同学之间不好意思说的话，交给中立的系统去说
              </h2>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                共桨不让人际关系更热闹，而是让协作责任变得可见、可分配、可追溯。
              </p>
            </div>
            <Button asChild size="lg" className="shrink-0">
              <Link href="/sign-in">进入课程工作台</Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>共桨 CoPaddle · AI 小组协作调度系统</span>
          <span>AI 拆解服务端上限 120 秒；超时会明确报错，不会静默失败</span>
        </div>
      </footer>
    </main>
  );
}

/** 一个求解目标：术语在上、解释在下。术语本身是信息，所以不做标题化的装饰。 */
function Spec({ term, desc }: { term: string; desc: string }) {
  return (
    <div className="border-t border-foreground/15 pt-3">
      <dt className="text-sm font-semibold">{term}</dt>
      <dd className="mt-1 text-xs leading-relaxed text-muted-foreground">{desc}</dd>
    </div>
  );
}

/** 角色一段：左列是身份与用途，右列是它能做的具体动作——用横线分隔，不用卡片。 */
function Role({
  role,
  title,
  points
}: {
  role: string;
  title: string;
  points: string[];
}) {
  return (
    <div className="grid gap-3 py-7 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:gap-10">
      <div>
        <p className="text-sm font-semibold text-brand">{role}</p>
        <p className="mt-1 text-lg font-semibold leading-snug">{title}</p>
      </div>
      <ul className="space-y-2">
        {points.map((point) => (
          <li key={point} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" aria-hidden />
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 贡献区间示意条。
 *
 * 用绝对定位的两根竖线夹出区间，而不是 progress bar：
 * 这个产品要表达的是"上下界"，一根填充条会被读成"完成了百分之多少"。
 */
function IntervalRow({ label, from, to }: { label: string; from: number; to: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {from}%–{to}%
        </span>
      </div>
      <div className="relative mt-1.5 h-2 rounded-full bg-muted">
        <span
          className="absolute inset-y-0 rounded-full bg-brand/70"
          style={{ left: `${from}%`, width: `${to - from}%` }}
          aria-hidden
        />
      </div>
    </div>
  );
}