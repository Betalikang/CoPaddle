import {
  AlertTriangle,
  BookOpenCheck,
  ClipboardCheck,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  GitBranch,
  GitMerge,
  ListChecks,
  ScanSearch,
  Settings,
  Users,
  type LucideIcon
} from 'lucide-react';

/**
 * 课程内导航的**数据层**。
 *
 * 刻意放在 lib/ 而不是和组件同一个文件：组件文件带 'use client'，
 * 一旦把 courseNavGroups 写在里面，服务端组件调用它就会报
 * 「Attempted to call courseNavGroups() from the server but it is on the client」。
 * 导航配置本身是纯数据，服务端与客户端都应该能读。
 */

export type CourseRole = 'teacher' | 'assistant' | 'captain' | 'member';

export type CourseNavItem = {
  href: string;
  label: string;
  /** 一句话说明，课程首页列表里显示一行 */
  desc: string;
  icon: LucideIcon;
  /** 不填 = 四种角色都可见 */
  roles?: CourseRole[];
};

export type CourseNavGroup = {
  key: string;
  label: string;
  items: CourseNavItem[];
};

const TEACHER_SIDE: CourseRole[] = ['teacher', 'assistant'];
const STUDENT_SIDE: CourseRole[] = ['captain', 'member'];

export function isTeacherSide(role: string): boolean {
  return role === 'teacher' || role === 'assistant';
}

/**
 * 按角色裁剪后的导航树；空组会被丢掉。
 *
 * 原来 12 个入口平铺在课程首页，进任何子页都要先回首页。
 * 这里按「准备 → 分组 → 执行 → 协作 → 复盘」的推进顺序分组，一个入口只写一次。
 */
export function courseNavGroups(courseId: string | number, role: string): CourseNavGroup[] {
  const base = `/dashboard/courses/${courseId}`;
  const all: CourseNavGroup[] = [
    {
      key: 'setup',
      label: '准备',
      items: [
        {
          href: `${base}/roster`,
          label: '名单与班级',
          desc: '班级、名单、技能卡填写进度',
          icon: Users,
          roles: TEACHER_SIDE
        },
        {
          href: `${base}/settings`,
          label: '分组策略',
          desc: '组数规模、四维权重、证据权重',
          icon: Settings,
          roles: TEACHER_SIDE
        },
        {
          href: `${base}/skill-card`,
          label: '我的技能卡',
          desc: '30 秒填完的能力自评',
          icon: FileSpreadsheet
        }
      ]
    },
    {
      key: 'grouping',
      label: '分组',
      items: [
        {
          href: `${base}/grouping`,
          label: '分组工作台',
          desc: '三方案对比、拖拽微调、硬约束拦截',
          icon: GitBranch,
          roles: TEACHER_SIDE
        }
      ]
    },
    {
      key: 'execution',
      label: '执行',
      items: [
        {
          href: `${base}/tasks`,
          label: '任务与契约',
          desc: '任务 DAG、分工指派、协作契约',
          icon: ListChecks
        },
        {
          href: '/dashboard/my-tasks',
          label: '我的部分',
          desc: '我负责什么、依赖谁、何时必须交',
          icon: BookOpenCheck,
          roles: STUDENT_SIDE
        },
        {
          href: `${base}/artifacts`,
          label: '交付物',
          desc: '分段撰写、diff 归属、汇编终稿',
          icon: FileText
        }
      ]
    },
    {
      key: 'collab',
      label: '协作',
      items: [
        {
          href: `${base}/alerts`,
          label: '健康度与预警',
          desc: '三维健康度、待处理预警',
          icon: AlertTriangle,
          roles: TEACHER_SIDE
        },
        {
          href: `${base}/conflicts`,
          label: '冲突中心',
          desc: '依赖冲突、退回对齐或重指派',
          icon: ScanSearch
        },
        {
          href: `${base}/replans`,
          label: '重规划',
          desc: '三方案决策包与采纳',
          icon: GitMerge
        }
      ]
    },
    {
      key: 'review',
      label: '复盘',
      items: [
        {
          href: `${base}/contributions`,
          label: '贡献账本',
          desc: '区间估计、贡献构成、证据下钻',
          icon: ClipboardList
        },
        {
          href: `${base}/reviews`,
          label: '互评轮次',
          desc: '轮次管理、完成率、异常检测',
          icon: ClipboardCheck,
          roles: TEACHER_SIDE
        },
        {
          href: `${base}/reviews/mine`,
          label: '我的互评',
          desc: '给组内成员评分',
          icon: ClipboardCheck,
          roles: STUDENT_SIDE
        },
        {
          href: `${base}/grades`,
          label: '成绩导出',
          desc: '导出成绩 CSV',
          icon: FileSpreadsheet,
          roles: TEACHER_SIDE
        }
      ]
    }
  ];

  return all
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.roles || item.roles.includes(role as CourseRole))
    }))
    .filter((group) => group.items.length > 0);
}
