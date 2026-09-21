CREATE TABLE "contract_acceptances" (
	"contract_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"accepted_at" timestamp DEFAULT now() NOT NULL,
	"device" varchar(100)
);
--> statement-breakpoint
CREATE TABLE "contract_glossary" (
	"id" serial PRIMARY KEY NOT NULL,
	"contract_id" integer NOT NULL,
	"term" varchar(100) NOT NULL,
	"definition" text,
	"unit" varchar(50),
	"scope" varchar(100),
	"example" text
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"version" smallint DEFAULT 1 NOT NULL,
	"generated_by" varchar(20) DEFAULT 'g1' NOT NULL,
	"format_spec" text,
	"published_at" timestamp,
	"published_by" integer
);
--> statement-breakpoint
CREATE TABLE "task_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"raci" varchar(20) DEFAULT 'contributor' NOT NULL,
	"assigned_by" integer,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"accepted_at" timestamp,
	"workload_share" numeric(5, 4)
);
--> statement-breakpoint
CREATE TABLE "task_deps" (
	"task_id" integer NOT NULL,
	"depends_on_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"assignment_title" varchar(200),
	"assignment_text" text,
	"assignment_file_url" text,
	"llm_model" varchar(50),
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"validated" boolean DEFAULT true NOT NULL,
	"validate_problems" jsonb
);
--> statement-breakpoint
CREATE TABLE "task_status_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"from_status" varchar(20),
	"to_status" varchar(20) NOT NULL,
	"actor_id" integer,
	"note" text,
	"evidence_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	"code" varchar(10) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"milestone" varchar(100),
	"order_index" integer DEFAULT 0 NOT NULL,
	"est_hours" numeric(5, 1) DEFAULT '2.0' NOT NULL,
	"actual_hours" numeric(5, 1),
	"status" varchar(20) DEFAULT 'todo' NOT NULL,
	"deliverable_type" varchar(20) DEFAULT 'document' NOT NULL,
	"priority" varchar(20) DEFAULT 'normal' NOT NULL,
	"due_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"blocked_reason" text,
	"on_critical_path" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "contract_acceptances" ADD CONSTRAINT "contract_acceptances_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_acceptances" ADD CONSTRAINT "contract_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_glossary" ADD CONSTRAINT "contract_glossary_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_deps" ADD CONSTRAINT "task_deps_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_deps" ADD CONSTRAINT "task_deps_depends_on_id_tasks_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_plans" ADD CONSTRAINT "task_plans_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_status_events" ADD CONSTRAINT "task_status_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_status_events" ADD CONSTRAINT "task_status_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_plan_id_task_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."task_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contracts_group_version_idx" ON "contracts" USING btree ("group_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "task_assignments_uniq" ON "task_assignments" USING btree ("task_id","user_id","raci");--> statement-breakpoint
CREATE INDEX "task_deps_task_idx" ON "task_deps" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_plans_group_generated_idx" ON "task_plans" USING btree ("group_id","generated_at");--> statement-breakpoint
CREATE INDEX "task_status_events_task_created_idx" ON "task_status_events" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_group_status_idx" ON "tasks" USING btree ("group_id","status");--> statement-breakpoint
CREATE INDEX "tasks_due_at_idx" ON "tasks" USING btree ("due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_plan_code_uniq" ON "tasks" USING btree ("plan_id","code");