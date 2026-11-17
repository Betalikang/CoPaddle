-- 唯一约束修复（优化计划第 10 项）：先清重，再建约束。
--
-- 为什么必须清重：这两张表在生产库上可能已经存在重复行。
-- 直接在脏数据上建唯一索引会让 migrate 中途失败，而 migrate 是按条目顺序执行的，
-- 失败后库停在「索引没建成、前面的 DDL 已生效」的半途状态，比不改更糟。
-- 所以每条 CREATE 前面先跑一次幂等的去重 DELETE。

-- 1) group_members：同一人同一组的多条「在册」记录只保留一条。
--    保留优先级：duty='lead' 的一律保留 → 其余按 id 最小（最早加入）。
--    旧索引 unique(group_id, user_id, left_at) 在 Postgres 下等同于没有约束：
--    NULL 在唯一索引里互不相等，所以 left_at 为空的重复行可以无限插入。
DELETE FROM "group_members" a
USING "group_members" b
WHERE a."left_at" IS NULL
  AND b."left_at" IS NULL
  AND a."group_id" = b."group_id"
  AND a."user_id" = b."user_id"
  AND (
    CASE WHEN a."duty" = 'lead' THEN 0 ELSE 1 END,
    a."id"
  ) > (
    CASE WHEN b."duty" = 'lead' THEN 0 ELSE 1 END,
    b."id"
  );--> statement-breakpoint

-- 2) task_deps：同一条依赖边只保留一条（没有主键，用 ctid 定序）。
--    重复边会污染健康度的阻塞判定与环检测。
DELETE FROM "task_deps" a
USING "task_deps" b
WHERE a."task_id" = b."task_id"
  AND a."depends_on_id" = b."depends_on_id"
  AND a.ctid > b.ctid;--> statement-breakpoint

DROP INDEX "group_members_active_uniq";--> statement-breakpoint
CREATE UNIQUE INDEX "task_deps_edge_uniq" ON "task_deps" USING btree ("task_id","depends_on_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_active_uniq" ON "group_members" USING btree ("group_id","user_id") WHERE "group_members"."left_at" is null;