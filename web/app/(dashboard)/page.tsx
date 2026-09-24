import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpenCheck,
  ClipboardList,
  GitBranch,
  Users
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getUser } from '@/lib/db/queries';

/** 共桨产品首页。已登录用户直接进入课程工作台。 */
export default async function HomePage() {
  const user = await getUser();
  if (user) {
    redirect('/dashboard');
  }

  return (
    <main>
      {/* Hero：整屏主视觉，重心略偏上 */}
      <section className="min-h-[calc(100dvh-4rem)] flex items-center justify-center pt-10 pb-28 sm:pb-32">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white tracking-tight sm:text-5xl md:text-6xl lg:text-7xl leading-[1.35]">
            共桨 CoPaddle
            <span className="block mt-3 sm:mt-4 md:mt-5 text-orange-500">让多人协作成为一条流水线</span>
          </h1>
          <p className="mt-8 max-w-3xl mx-auto text-base text-gray-500 dark:text-gray-400 sm:text-lg md:text-xl leading-relaxed">
            面向高校小组协作的 AI 调度系统。教师、队长、队员三端，一个持续在线的调度中枢——
            把「一次性分工」变成有据可查、可调度、可归因的协作流水线。
          </p>
        </div>
      </section>

      {/* 三个被授权的稀缺能力 */}
      <section className="py-16 bg-white dark:bg-gray-950">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white text-center">
            三个角色，三种被授权的稀缺能力
          </h2>
          <div className="mt-10 grid gap-8 lg:grid-cols-3">
            <RoleCard
              icon={<BookOpenCheck className="h-6 w-6" />}
              role="教师"
              title="拿到过程里可介入的合法理由"
              points={[
                'AI 生成三套分组方案，拖动微调实时看得分',
                '过程中查看小组健康度与预警',
                '一键救火：重分 / 补位 / 降规模',
                '终审贡献账本并最终调分'
              ]}
            />
            <RoleCard
              icon={<Users className="h-6 w-6" />}
              role="队长"
              title="拿到「不是我在针对你，是系统判定的阻塞」"
              points={[
                '确认并微调 AI 生成的任务 DAG',
                '指定主责 / 协作 / 审阅人',
                '查看组内阻塞与负载失衡',
                '发起重规划（附 AI 方案背书）'
              ]}
            />
            <RoleCard
              icon={<ClipboardList className="h-6 w-6" />}
              role="队员"
              title="拿到看得见的透明规则与申诉权"
              points={[
                '看清「我负责什么 / 依赖谁 / 何时必须交」',
                '在平台内产出交付物（自动溯源）',
                '申请延期、请求支援、发起冲突仲裁',
                '查看自己的贡献账本与申诉入口'
              ]}
            />
          </div>
        </div>
      </section>

      {/* 核心链路 */}
      <section className="py-16 bg-gray-50 dark:bg-gray-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white text-center">
            分组只是入口，真正的产品是一直在线调度中枢
          </h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <StepCard step="01" title="多目标最优分组" desc="技能互补 + 弱连接引入 + 组间公平 + 历史规避，约束求解器保证合法" />
            <StepCard step="02" title="任务拆解与契约" desc="AI 读作业要求，产出任务 DAG 与协作契约，抑制冲突于未然" />
            <StepCard step="03" title="进度感知与重规划" desc="关键路径监控，滞后即预警，给出带代价说明的重规划决策包" />
            <StepCard step="04" title="贡献归因账本" desc="交付物级溯源 + 区间估计 + 证据下钻，系统只给依据，评分归教师" />
          </div>
        </div>
      </section>

      {/* 底部 CTA */}
      <section className="py-16">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <GitBranch className="mx-auto h-10 w-10 text-orange-500" />
          <h2 className="mt-4 text-2xl font-bold text-gray-900 dark:text-white">
            把同学之间「不好意思说的话」，交给中立的系统去说
          </h2>
          <p className="mt-3 text-gray-500 dark:text-gray-400">
            共桨不让人际关系更热闹，而是让协作责任变得可见、可分配、可追溯——用制度设计替代人情消耗。
          </p>
          <Button asChild size="lg" className="mt-6 rounded-full">
            <Link href="/sign-in">
              进入课程工作台
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
        </div>
      </section>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        共桨 CoPaddle · AI 多人协作调度系统
      </footer>
    </main>
  );
}

function RoleCard({
  icon,
  role,
  title,
  points
}: {
  icon: React.ReactNode;
  role: string;
  title: string;
  points: string[];
}) {
  return (
    <div className="rounded-lg border p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-orange-500 text-white">
          {icon}
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{role}端</p>
          <p className="font-medium">{title}</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
        {points.map((p) => (
          <li key={p} className="flex gap-2">
            <span className="text-orange-500">·</span>
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepCard({ step, title, desc }: { step: string; title: string; desc: string }) {
  return (
    <div className="rounded-lg border bg-white dark:bg-gray-900 p-5">
      <p className="text-2xl font-bold text-orange-500">{step}</p>
      <p className="mt-2 font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
