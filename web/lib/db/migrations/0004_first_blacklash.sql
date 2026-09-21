CREATE TABLE "artifact_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_id" integer NOT NULL,
	"seq" smallint NOT NULL,
	"kind" varchar(20) DEFAULT 'paragraph' NOT NULL,
	"author_id" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" varchar(64),
	"word_count" integer DEFAULT 0 NOT NULL,
	"source_task_id" integer,
	"revised_by" integer,
	"revised_count" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"artifact_id" integer NOT NULL,
	"version_no" smallint NOT NULL,
	"content" text,
	"storage_path" text,
	"file_size" integer,
	"checksum" varchar(64),
	"diff_summary" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"task_id" integer,
	"title" varchar(200) NOT NULL,
	"type" varchar(20) DEFAULT 'document' NOT NULL,
	"current_version_id" integer,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"is_final_deliverable" boolean DEFAULT false NOT NULL,
	"created_by" integer NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "attribution_appeals" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"appellant_id" integer NOT NULL,
	"reason" text NOT NULL,
	"evidence_text" text,
	"attachments" jsonb,
	"status" varchar(20) DEFAULT 'submitted' NOT NULL,
	"handler_id" integer,
	"result_note" text,
	"handled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"reviewer_id" integer NOT NULL,
	"adjusted_low" numeric(5, 2),
	"adjusted_high" numeric(5, 2),
	"final_note" text,
	"is_locked" boolean DEFAULT false NOT NULL,
	"reviewed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contribution_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"snapshot_at" timestamp DEFAULT now() NOT NULL,
	"comp" jsonb,
	"low_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"high_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"confidence" varchar(20) DEFAULT 'low' NOT NULL,
	"peer_median" numeric(3, 2),
	"on_time_count" integer DEFAULT 0 NOT NULL,
	"delay_count" integer DEFAULT 0 NOT NULL,
	"rework_count" integer DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"fair_share_ratio" numeric(5, 3) DEFAULT '0' NOT NULL,
	"warning" text
);
--> statement-breakpoint
CREATE TABLE "evidence_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"snapshot_id" integer NOT NULL,
	"source" varchar(20) NOT NULL,
	"ref_type" varchar(30),
	"ref_id" integer,
	"weight" numeric(4, 3) DEFAULT '1.000' NOT NULL,
	"value" numeric(6, 3) DEFAULT '0' NOT NULL,
	"note" text,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segment_edits" (
	"id" serial PRIMARY KEY NOT NULL,
	"segment_id" integer NOT NULL,
	"editor_id" integer NOT NULL,
	"edit_type" varchar(20) NOT NULL,
	"delta_chars" integer DEFAULT 0 NOT NULL,
	"before_hash" varchar(64),
	"after_hash" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_segments" ADD CONSTRAINT "artifact_segments_version_id_artifact_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."artifact_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_segments" ADD CONSTRAINT "artifact_segments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_segments" ADD CONSTRAINT "artifact_segments_source_task_id_tasks_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_segments" ADD CONSTRAINT "artifact_segments_revised_by_users_id_fk" FOREIGN KEY ("revised_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_appeals" ADD CONSTRAINT "attribution_appeals_snapshot_id_contribution_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."contribution_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_appeals" ADD CONSTRAINT "attribution_appeals_appellant_id_users_id_fk" FOREIGN KEY ("appellant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_appeals" ADD CONSTRAINT "attribution_appeals_handler_id_users_id_fk" FOREIGN KEY ("handler_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_reviews" ADD CONSTRAINT "attribution_reviews_snapshot_id_contribution_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."contribution_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_reviews" ADD CONSTRAINT "attribution_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_snapshots" ADD CONSTRAINT "contribution_snapshots_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_snapshots" ADD CONSTRAINT "contribution_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_snapshot_id_contribution_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."contribution_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_edits" ADD CONSTRAINT "segment_edits_segment_id_artifact_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."artifact_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_edits" ADD CONSTRAINT "segment_edits_editor_id_users_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_segments_version_seq_idx" ON "artifact_segments" USING btree ("version_id","seq");--> statement-breakpoint
CREATE INDEX "artifact_segments_author_idx" ON "artifact_segments" USING btree ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_versions_uniq" ON "artifact_versions" USING btree ("artifact_id","version_no");--> statement-breakpoint
CREATE INDEX "artifacts_group_status_idx" ON "artifacts" USING btree ("group_id","status");--> statement-breakpoint
CREATE INDEX "attribution_appeals_status_idx" ON "attribution_appeals" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_snapshots_uniq" ON "contribution_snapshots" USING btree ("group_id","user_id","snapshot_at");--> statement-breakpoint
CREATE INDEX "evidence_items_snapshot_idx" ON "evidence_items" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "evidence_items_user_idx" ON "evidence_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "segment_edits_segment_idx" ON "segment_edits" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "segment_edits_editor_idx" ON "segment_edits" USING btree ("editor_id");