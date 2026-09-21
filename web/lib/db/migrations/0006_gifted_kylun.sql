CREATE TABLE "conflict_attributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"conflict_id" integer NOT NULL,
	"kind" varchar(24),
	"severity" varchar(20),
	"reason" text,
	"suggestion" text,
	"merged_text" text,
	"llm_model" varchar(50),
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"raw_response" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conflict_resolutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"conflict_id" integer NOT NULL,
	"action" varchar(20) NOT NULL,
	"actor_id" integer NOT NULL,
	"note" text,
	"applied_payload" jsonb,
	"resolved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conflicts" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"task_id" integer,
	"type" varchar(20) NOT NULL,
	"severity" varchar(20) DEFAULT 'medium' NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"detected_by" varchar(20) DEFAULT 'auto' NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"title" varchar(200) DEFAULT '' NOT NULL,
	"summary" text,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "group_health_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"snapshot_at" timestamp DEFAULT now() NOT NULL,
	"blocked_score" numeric(5, 1) DEFAULT '100' NOT NULL,
	"idle_score" numeric(5, 1) DEFAULT '100' NOT NULL,
	"overload_score" numeric(5, 1) DEFAULT '100' NOT NULL,
	"on_track_ratio" numeric(4, 3) DEFAULT '1.000' NOT NULL,
	"critical_delay_days" numeric(4, 1) DEFAULT '0' NOT NULL,
	"open_conflicts" integer DEFAULT 0 NOT NULL,
	"unassigned_tasks" integer DEFAULT 0 NOT NULL,
	"diagnosis" jsonb
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "progress_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"task_id" integer,
	"user_id" integer NOT NULL,
	"signal_type" varchar(30) NOT NULL,
	"weight" numeric(3, 2) DEFAULT '1.00' NOT NULL,
	"payload" jsonb,
	"observed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replan_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"trigger_type" varchar(30) NOT NULL,
	"trigger_task_id" integer,
	"trigger_payload" jsonb,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"adopted_option_id" integer,
	"handled_by" integer,
	"handled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replan_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"label" varchar(50) NOT NULL,
	"action" varchar(30) NOT NULL,
	"payload" jsonb,
	"cost_summary" text,
	"est_impact_days" numeric(4, 1) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conflict_attributions" ADD CONSTRAINT "conflict_attributions_conflict_id_conflicts_id_fk" FOREIGN KEY ("conflict_id") REFERENCES "public"."conflicts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_resolutions" ADD CONSTRAINT "conflict_resolutions_conflict_id_conflicts_id_fk" FOREIGN KEY ("conflict_id") REFERENCES "public"."conflicts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_resolutions" ADD CONSTRAINT "conflict_resolutions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_health_snapshots" ADD CONSTRAINT "group_health_snapshots_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_signals" ADD CONSTRAINT "progress_signals_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_signals" ADD CONSTRAINT "progress_signals_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_signals" ADD CONSTRAINT "progress_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replan_events" ADD CONSTRAINT "replan_events_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replan_events" ADD CONSTRAINT "replan_events_trigger_task_id_tasks_id_fk" FOREIGN KEY ("trigger_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replan_events" ADD CONSTRAINT "replan_events_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replan_options" ADD CONSTRAINT "replan_options_event_id_replan_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."replan_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conflicts_group_status_idx" ON "conflicts" USING btree ("group_id","status");--> statement-breakpoint
CREATE INDEX "group_health_snapshots_group_snapshot_idx" ON "group_health_snapshots" USING btree ("group_id","snapshot_at");--> statement-breakpoint
CREATE UNIQUE INDEX "milestones_group_order_uniq" ON "milestones" USING btree ("group_id","order_index");--> statement-breakpoint
CREATE INDEX "progress_signals_group_observed_idx" ON "progress_signals" USING btree ("group_id","observed_at");--> statement-breakpoint
CREATE INDEX "progress_signals_user_idx" ON "progress_signals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "replan_events_group_status_idx" ON "replan_events" USING btree ("group_id","status");