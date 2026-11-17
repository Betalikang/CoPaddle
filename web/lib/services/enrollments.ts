import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/drizzle';
import {
  CourseMembership,
  classes,
  courseMemberships,
  users
} from '../db/schema';
import type { AddEnrollmentInput } from '@/lib/validation/courses';

export type EnrollmentRow = CourseMembership & {
  user: { id: number; name: string | null; email: string; studentNo: string | null };
  className: string | null;
};

/** 单个加入名单的结果。`created` 仍表示「是否新建了账号」，路由与既有测试依赖它。 */
export type AddEnrollmentResult = {
  userId: number;
  membership: CourseMembership;
  /** 是否新建了 users 行（API 用它决定 201/200） */
  created: boolean;
  /** 成员记录本身是新建还是更新——报表按这个口径统计 */
  membershipStatus: 'created' | 'updated';
  /** 命中的是软删账号，已显式恢复 */
  restored: boolean;
};

/**
 * 单个加入名单。S1 简化策略：教师代建账号（随机密码占位，学生首次登录走密码重置），
 * 标记 user.status='invited'；完整的邮件邀请接受流属 B-16 期。
 *
 * 三个口径要点：
 * 1. 查重同时按 email 与 studentNo（有值才比）：只按 email 查会让「学号已存在、邮箱换了」的行
 *    撞 users_student_no_unique 直接报错。学号是教务侧的权威身份，两个账号各命中一条时以学号为准
 *    （说明库里已有两个半截账号，这里不抛错——加入名单路由没有 try/catch，抛错会变成 500）。
 * 2. 命中软删账号时**显式恢复**，而不是静默复用或报错：复用会让成员永远登录不上
 *    （getUser() 过滤 deleted_at），报错会变成 500。恢复 = 清空 deletedAt + 状态置 invited，
 *    并在返回值 `restored` 与 CSV 报告的 restored 计数里如实注明。
 * 3. 成员记录已存在时不再 onConflictDoNothing 静默跳过，而是把班级/状态更新到最新。
 */
export async function addEnrollment(
  courseId: number,
  input: AddEnrollmentInput
): Promise<AddEnrollmentResult> {
  return db.transaction(async (tx) => {
    // ---- 身份查重：邮箱 + 学号 ----
    const matches: SQL[] = [];
    if (input.email) matches.push(eq(users.email, input.email));
    if (input.studentNo) matches.push(eq(users.studentNo, input.studentNo));
    const candidates = matches.length
      ? await tx
          .select()
          .from(users)
          .where(or(...matches))
          .limit(5)
      : [];

    // 学号优先：同一个人换了邮箱时，学号命中的才是同一个学生
    const matched =
      (input.studentNo ? candidates.find((u) => u.studentNo === input.studentNo) : undefined) ??
      (input.email ? candidates.find((u) => u.email === input.email) : undefined);

    let user = matched;
    let created = false;
    let restored = false;

    if (user) {
      if (user.deletedAt) {
        // 软删账号被重新录用：显式恢复，避免「看着在读却登录不了」
        const [restoredUser] = await tx
          .update(users)
          .set({ deletedAt: null, status: 'invited' })
          .where(eq(users.id, user.id))
          .returning();
        user = restoredUser;
        restored = true;
      }
    } else {
      // 随机密码占位：不可登录，需走密码重置后才能使用（status=invited）
      const placeholder = `invited-${crypto.randomUUID()}`;
      const [inserted] = await tx
        .insert(users)
        .values({
          // email notNull unique：没给邮箱时用学号/随机串造占位邮箱，不能留空
          email:
            input.email ??
            (input.studentNo
              ? `${input.studentNo}@invited.local`
              : `${crypto.randomUUID()}@invited.local`),
          studentNo: input.studentNo ?? null,
          name: input.name ?? null,
          passwordHash: placeholder,
          status: 'invited',
          role: 'member'
        })
        .returning();
      user = inserted;
      created = true;
    }

    if (!user) throw new Error('名单导入：账号写入失败');

    // ---- 成员记录：存在则更新，不存在则新建 ----
    const [existing] = await tx
      .select()
      .from(courseMemberships)
      .where(and(eq(courseMemberships.courseId, courseId), eq(courseMemberships.userId, user.id)))
      .limit(1);

    if (existing) {
      // 已在名单里不是「跳过」：把班级/状态更新到最新，重复导入才不会让分班永远停在旧值
      const [updated] = await tx
        .update(courseMemberships)
        .set({
          // 班级只在显式给出时覆盖，避免二次导入把已有分班清空
          classId: input.classId ?? existing.classId,
          status: 'active',
          role: input.role ?? existing.role
        })
        .where(eq(courseMemberships.id, existing.id))
        .returning();
      return {
        userId: user.id,
        membership: updated,
        created,
        membershipStatus: 'updated' as const,
        restored
      };
    }

    const [insertedMembership] = await tx
      .insert(courseMemberships)
      .values({
        courseId,
        userId: user.id,
        role: input.role ?? 'member',
        classId: input.classId ?? null,
        status: 'active'
      })
      .returning();

    return {
      userId: user.id,
      membership: insertedMembership,
      created,
      membershipStatus: 'created' as const,
      restored
    };
  });
}

export async function listEnrollments(
  courseId: number,
  page?: { offset: number; limit: number }
): Promise<EnrollmentRow[]> {
  const base = db
    .select({
      membership: courseMemberships,
      user: {
        id: users.id,
        name: users.name,
        email: users.email,
        studentNo: users.studentNo
      },
      className: classes.name
    })
    .from(courseMemberships)
    .innerJoin(users, eq(courseMemberships.userId, users.id))
    .leftJoin(classes, eq(courseMemberships.classId, classes.id))
    .where(
      and(
        eq(courseMemberships.courseId, courseId),
        eq(courseMemberships.status, 'active')
      )
    )
    .orderBy(sql`${users.studentNo} NULLS LAST, ${users.id}`);

  // 只有客户端显式给分页参数时才截断（默认返回全量，保持既有页面行为）
  const rows = page ? await base.offset(page.offset).limit(page.limit) : await base;

  return rows.map((r) => ({ ...r.membership, user: r.user, className: r.className }));
}

export type CsvImportReport = {
  total: number;
  /** 新增的成员记录数（口径按 membership，而不是「新建了几个账号」） */
  added: number;
  /** 已存在成员记录、本次被更新（分班/状态）的行数 */
  updated: number;
  /** 命中的软删账号被恢复的行数（已计入 added/updated） */
  restored: number;
  skipped: number;
  errors: { row: number; message: string }[];
};

/**
 * CSV 批量导入：表头 name,email,student_no,class_name。
 * 逐行校验，失败行跳过并进报告（规格书 B-03：返回逐行校验报告）。
 */
export async function importEnrollmentsCsv(
  courseId: number,
  csvText: string
): Promise<CsvImportReport> {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return {
      total: 0,
      added: 0,
      updated: 0,
      restored: 0,
      skipped: 0,
      errors: [{ row: 0, message: '空文件' }]
    };
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const colIndex = (name: string) => header.indexOf(name);
  const iName = colIndex('name');
  const iEmail = colIndex('email');
  const iStudentNo = colIndex('student_no');
  const iClassName = colIndex('class_name');

  if (iEmail === -1) {
    return {
      total: 0,
      added: 0,
      updated: 0,
      restored: 0,
      skipped: 0,
      errors: [{ row: 1, message: '缺少 email 列表头' }]
    };
  }

  const report: CsvImportReport = {
    total: lines.length - 1,
    added: 0,
    updated: 0,
    restored: 0,
    skipped: 0,
    errors: []
  };

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const email = (cols[iEmail] ?? '').trim();
    const name = iName >= 0 ? (cols[iName] ?? '').trim() : '';
    const studentNo = iStudentNo >= 0 ? (cols[iStudentNo] ?? '').trim() : '';
    const className = iClassName >= 0 ? (cols[iClassName] ?? '').trim() : '';

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      report.errors.push({ row: i + 1, message: `email 无效："${email}"` });
      report.skipped++;
      continue;
    }

    try {
      // 班级不存在则顺带创建（教师导入时通常是新班级）
      let classId: number | undefined;
      if (className) {
        const existing = await db
          .select()
          .from(classes)
          .where(and(eq(classes.courseId, courseId), eq(classes.name, className)))
          .limit(1);
        if (existing[0]) {
          classId = existing[0].id;
        } else {
          const [created] = await db
            .insert(classes)
            .values({ courseId, name: className })
            .returning();
          classId = created.id;
        }
      }

      const result = await addEnrollment(courseId, {
        email,
        name: name || undefined,
        studentNo: studentNo || undefined,
        classId
      });
      if (result.membershipStatus === 'created') {
        report.added++;
      } else {
        // 已存在账号导入第二门课 / 重复导入：成员记录被更新，如实计入「更新」而不是「跳过」
        report.updated++;
      }
      if (result.restored) report.restored++;
    } catch (err) {
      report.errors.push({
        row: i + 1,
        message: err instanceof Error ? err.message : '未知错误'
      });
      report.skipped++;
    }
  }

  return report;
}

/** 简易 CSV 行切分（支持双引号包裹的逗号字段）。 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
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
