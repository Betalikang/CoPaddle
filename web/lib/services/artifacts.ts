import { createHash } from 'node:crypto';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/drizzle';
import {
  artifactSegments,
  artifactVersions,
  artifacts,
  groups,
  segmentEdits
} from '../db/schema';

/** 段落提交输入（前端编辑器每次保存提交完整段落数组）。 */
export type SegmentInput = {
  seq: number;
  kind?: string;
  content: string;
  sourceTaskId?: number | null;
};

/** 中文字数：去空白后的字符数（归因的字数口径）。 */
export function wordCount(text: string): number {
  return text.replace(/\s+/gu, '').length;
}

function hashContent(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

/**
 * 保存新版本（规格书 B-13）：提交段落数组 → 服务端 diff → 写
 * artifact_segments 与 segment_edits。段落归属由「平台内撰写」行为天然
 * 沉淀，不靠学生自报（搭便车者会填表也没用）。
 *
 * diff 规则（按 seq 对齐）：
 * - 新 seq（上一版没有）→ create，author = 提交人
 * - seq 存在且 hash 相同 → 原样保留（author 不变）
 * - seq 存在且 hash 不同 → revise：revised_by = 提交人，revised_count+1
 * - 上一版有而本版没有的 seq → delete 记录，不写入新版本
 */
export async function saveVersion(
  artifactId: number,
  userId: number,
  segments: SegmentInput[]
) {
  return db.transaction(async (tx) => {
    const [artifact] = await tx
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, artifactId))
      .limit(1);
    if (!artifact) throw new Error('交付物不存在');

    // 上一版本（取当前最新版）
    const [prevVersion] = await tx
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, artifactId))
      .orderBy(desc(artifactVersions.versionNo))
      .limit(1);

    const prevSegments = prevVersion
      ? await tx
          .select()
          .from(artifactSegments)
          .where(eq(artifactSegments.versionId, prevVersion.id))
          .orderBy(asc(artifactSegments.seq))
      : [];
    const prevBySeq = new Map(prevSegments.map((s) => [s.seq, s]));

    const versionNo = (prevVersion?.versionNo ?? 0) + 1;
    const [version] = await tx
      .insert(artifactVersions)
      .values({
        artifactId,
        versionNo,
        content: segments.map((s) => s.content).join('\n'),
        createdBy: userId
      })
      .returning();

    let diffSummaryCreate = 0;
    let diffSummaryRevise = 0;
    let diffSummaryDelete = 0;

    for (const seg of segments) {
      const hash = hashContent(seg.content);
      const prev = prevBySeq.get(seg.seq);
      if (!prev) {
        const [inserted] = await tx
          .insert(artifactSegments)
          .values({
            versionId: version.id,
            seq: seg.seq,
            kind: seg.kind ?? 'paragraph',
            authorId: userId,
            content: seg.content,
            contentHash: hash,
            wordCount: wordCount(seg.content),
            sourceTaskId: seg.sourceTaskId ?? null
          })
          .returning();
        await tx.insert(segmentEdits).values({
          segmentId: inserted.id,
          editorId: userId,
          editType: 'create',
          deltaChars: wordCount(seg.content),
          afterHash: hash
        });
        diffSummaryCreate++;
      } else if (prev.contentHash !== hash) {
        // 内容变化：保留原作者，提交人成为修订者
        const [inserted] = await tx
          .insert(artifactSegments)
          .values({
            versionId: version.id,
            seq: seg.seq,
            kind: seg.kind ?? prev.kind,
            authorId: prev.authorId,
            content: seg.content,
            contentHash: hash,
            wordCount: wordCount(seg.content),
            sourceTaskId: prev.sourceTaskId,
            revisedBy: userId,
            revisedCount: prev.revisedCount + 1
          })
          .returning();
        await tx.insert(segmentEdits).values({
          segmentId: inserted.id,
          editorId: userId,
          editType: 'revise',
          deltaChars: wordCount(seg.content) - prev.wordCount,
          beforeHash: prev.contentHash,
          afterHash: hash
        });
        diffSummaryRevise++;
      } else {
        // 未变化：沿用归属
        await tx.insert(artifactSegments).values({
          versionId: version.id,
          seq: seg.seq,
          kind: seg.kind ?? prev.kind,
          authorId: prev.authorId,
          content: seg.content,
          contentHash: hash,
          wordCount: prev.wordCount,
          sourceTaskId: prev.sourceTaskId,
          revisedBy: prev.revisedBy,
          revisedCount: prev.revisedCount
        });
      }
    }

    // 被删除的段落
    for (const prev of prevSegments) {
      if (!segments.some((s) => s.seq === prev.seq)) {
        // 在历史版本上记录 delete（新版本已无该段）
        await tx.insert(segmentEdits).values({
          segmentId: prev.id,
          editorId: userId,
          editType: 'delete',
          deltaChars: -prev.wordCount,
          beforeHash: prev.contentHash
        });
        diffSummaryDelete++;
      }
    }

    await tx
      .update(artifactVersions)
      .set({
        diffSummary: `新增 ${diffSummaryCreate} 段 / 修订 ${diffSummaryRevise} 段 / 删除 ${diffSummaryDelete} 段`
      })
      .where(eq(artifactVersions.id, version.id));

    await tx
      .update(artifacts)
      .set({ currentVersionId: version.id })
      .where(eq(artifacts.id, artifactId));

    return {
      versionId: version.id,
      versionNo,
      diffSummary: `新增 ${diffSummaryCreate} 段 / 修订 ${diffSummaryRevise} 段 / 删除 ${diffSummaryDelete} 段`
    };
  });
}

/** 交付物所属课程 id（API 层课程归属鉴权用）。 */
export async function getArtifactCourseId(artifactId: number): Promise<number | null> {
  const [row] = await db
    .select({ courseId: groups.courseId })
    .from(artifacts)
    .innerJoin(groups, eq(groups.id, artifacts.groupId))
    .where(eq(artifacts.id, artifactId))
    .limit(1);
  return row?.courseId ?? null;
}

export async function createArtifact(
  groupId: number,
  userId: number,
  input: { title: string; type?: string; taskId?: number; isFinalDeliverable?: boolean }
) {
  const [artifact] = await db
    .insert(artifacts)
    .values({
      groupId,
      taskId: input.taskId ?? null,
      title: input.title,
      type: input.type ?? 'document',
      isFinalDeliverable: input.isFinalDeliverable ?? false,
      createdBy: userId
    })
    .returning();
  return artifact;
}

export async function listArtifacts(groupId: number) {
  const rows = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.groupId, groupId), isNull(artifacts.deletedAt)))
    .orderBy(desc(artifacts.id));
  return rows;
}

/** 交付物详情：当前版本 + 各成员字数占比（溯源入口）。 */
export async function getArtifact(artifactId: number) {
  const [artifact] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, artifactId))
    .limit(1);
  if (!artifact) return null;

  const versions = await db
    .select()
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, artifactId))
    .orderBy(desc(artifactVersions.versionNo));

  const current = versions[0] ?? null;
  let segments: (typeof artifactSegments.$inferSelect)[] = [];
  if (current) {
    segments = await db
      .select()
      .from(artifactSegments)
      .where(eq(artifactSegments.versionId, current.id))
      .orderBy(asc(artifactSegments.seq));
  }

  // 各成员字数占比（主责口径）
  const byAuthor = new Map<number, number>();
  for (const s of segments) {
    byAuthor.set(s.authorId, (byAuthor.get(s.authorId) ?? 0) + s.wordCount);
  }
  const totalWords = [...byAuthor.values()].reduce((a, b) => a + b, 0);

  return { artifact, versions, current, segments, authorStats: { byAuthor, totalWords } };
}

/** 段落列表（含归属人、修订次数、来源任务）。 */
export async function getSegments(artifactId: number) {
  const [current] = await db
    .select()
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, artifactId))
    .orderBy(desc(artifactVersions.versionNo))
    .limit(1);
  if (!current) return [];
  return db
    .select()
    .from(artifactSegments)
    .where(eq(artifactSegments.versionId, current.id))
    .orderBy(asc(artifactSegments.seq));
}

/** 汇编终稿：把组内交付物按模板合成一份完整文档（生成新 artifact）。 */
export async function compileFinal(groupId: number, userId: number) {
  const rows = await db
    .select({
      title: artifacts.title,
      type: artifacts.type,
      id: artifacts.id
    })
    .from(artifacts)
    .where(and(eq(artifacts.groupId, groupId), isNull(artifacts.deletedAt)))
    .orderBy(artifacts.id);

  if (rows.length === 0) throw new Error('没有可汇编的交付物');

  const parts: string[] = [];
  for (const row of rows) {
    const [current] = await db
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, row.id))
      .orderBy(desc(artifactVersions.versionNo))
      .limit(1);
    parts.push(`## ${row.title}\n\n${current?.content ?? ''}`);
  }

  const [final] = await db
    .insert(artifacts)
    .values({
      groupId,
      title: '小组终稿',
      type: 'document',
      isFinalDeliverable: true,
      createdBy: userId,
      status: 'review'
    })
    .returning();

  await db.insert(artifactVersions).values({
    artifactId: final.id,
    versionNo: 1,
    content: parts.join('\n\n'),
    diffSummary: '汇编生成',
    createdBy: userId
  });

  return final;
}

/**
 * 提交终稿至教师：提交后段落归属冻结，任何修改走新版本且不改变已提交快照
 * （规格书 S4.1）。
 */
export async function submitFinal(artifactId: number) {
  const [artifact] = await db
    .update(artifacts)
    .set({ status: 'submitted' })
    .where(eq(artifacts.id, artifactId))
    .returning();
  return artifact;
}
