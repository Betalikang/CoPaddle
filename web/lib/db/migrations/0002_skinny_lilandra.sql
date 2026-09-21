CREATE TABLE "group_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"duty" varchar(20) DEFAULT 'contributor' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp,
	"leave_reason" text
);
--> statement-breakpoint
CREATE TABLE "grouping_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"label" varchar(20) NOT NULL,
	"strategy" varchar(30) NOT NULL,
	"total_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"score_skill_cover" numeric(5, 2) DEFAULT '0' NOT NULL,
	"score_weak_tie" numeric(5, 2) DEFAULT '0' NOT NULL,
	"score_balance" numeric(5, 2) DEFAULT '0' NOT NULL,
	"score_history_avoid" numeric(5, 2) DEFAULT '0' NOT NULL,
	"explanation" text,
	"groups" jsonb NOT NULL,
	"original_groups" jsonb NOT NULL,
	"weights" jsonb,
	"is_selected" boolean DEFAULT false NOT NULL,
	"selected_at" timestamp,
	"selected_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grouping_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"triggered_by" integer NOT NULL,
	"mode" varchar(20) DEFAULT 'cpsat' NOT NULL,
	"params" jsonb,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"solver_status" varchar(20),
	"duration_ms" integer,
	"solutions_found" integer DEFAULT 0 NOT NULL,
	"error_detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"plan_id" integer,
	"name" varchar(50) DEFAULT '' NOT NULL,
	"captain_id" integer,
	"status" varchar(20) DEFAULT 'forming' NOT NULL,
	"merged_into" integer,
	"milestone_progress" numeric(4, 3) DEFAULT '0' NOT NULL,
	"formed_at" timestamp DEFAULT now() NOT NULL,
	"dissolved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grouping_plans" ADD CONSTRAINT "grouping_plans_run_id_grouping_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."grouping_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grouping_plans" ADD CONSTRAINT "grouping_plans_selected_by_users_id_fk" FOREIGN KEY ("selected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grouping_runs" ADD CONSTRAINT "grouping_runs_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grouping_runs" ADD CONSTRAINT "grouping_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_plan_id_grouping_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."grouping_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_captain_id_users_id_fk" FOREIGN KEY ("captain_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_active_uniq" ON "group_members" USING btree ("group_id","user_id","left_at");--> statement-breakpoint
CREATE INDEX "group_members_user_idx" ON "group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "grouping_plans_run_idx" ON "grouping_plans" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "grouping_runs_course_created_idx" ON "grouping_runs" USING btree ("course_id","created_at");--> statement-breakpoint
CREATE INDEX "groups_course_status_idx" ON "groups" USING btree ("course_id","status");