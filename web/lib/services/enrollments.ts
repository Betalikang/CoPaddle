import { and, eq, sql } from 'drizzle-orm';
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

/**
 * 单个加入名单。S1 简化策略：教师代建账号（随机密码占位，学生首次登录走密码重置），
 * 标记 user.status='invited'；完整的邮件邀请接受流属 B-16 期。
 */
export async function addEnrollment(
  courseId: number,
  input: AddEnrollmentInput
): Promise<{ userId: number; membership: CourseMembership; created: boolean }> {
  return db.transaction(async (tx) => {
    let user =
      input.email !== undefined
        ? (
            await tx
              .select()
              .from(users)
              .where(eq(users.email, input.email))
              .limit(1)
          )[0]
        : (
            await tx
              .select()
              .from(users)
              .where(eq(users.studentNo, input.studentNo!))
              .limit(1)
          )[0];

    const created = !user;
    if (!user) {
      // 随机密码占位：不可登录，需走密码重置后才能使用（status=invited）
      const placeholder = `invited-${crypto.randomUUID()}`;
      const [inserted] = await tx
        .insert(users)
        .values({
          email:
            input.email ??
            `${input.studentNo}@invited.local`,
          studentNo: input.studentNo ?? null,
          name: input.name ?? null,
          passwordHash: placeholder,
          status: 'invited',
          role: 'member'
        })
        .returning();
      user = inserted;
    }

    const [membership] = await tx
      .insert(courseMemberships)
      .values({
        courseId,
        userId: user.id,
        role: input.role ?? 'member',
        classId: input.classId ?? null,
        status: 'active'
      })
      .onConflictDoNothing({
        target: [courseMemberships.courseId, courseMemberships.userId]
      })
      .returning();

    // 已在名单中时 onConflictDoNothing 不返回行，回查一次
    const finalMembership =
      membership ??
      (
        await tx
          .select()
          .from(courseMemberships)
          .where(
            and(
              eq(courseMemberships.courseId, courseId),
              eq(courseMemberships.userId, user.id)
            )
          )
          .limit(1)
      )[0];

    return { userId: user.id, membership: finalMembership, created };
  });
}

export async function listEnrollments(courseId: number): Promise<EnrollmentRow[]> {
  const rows = await db
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

  return rows.map((r) => ({ ...r.membership, user: r.user, className: r.className }));
}

export type CsvImportReport = {
  total: number;
  added: number;
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
    return { total: 0, added: 0, skipped: 0, errors: [{ row: 0, message: '空文件' }] };
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
      skipped: 0,
      errors: [{ row: 1, message: '缺少 email 列表头' }]
    };
  }

  const report: CsvImportReport = { total: lines.length - 1, added: 0, skipped: 0, errors: [] };

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
      if (result.created) {
        report.added++;
      } else {
        report.skipped++; // 已存在，跳过（不覆盖）
      }
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
