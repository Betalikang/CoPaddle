CREATE TABLE "classes" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"major" varchar(100),
	"grade" varchar(20),
	"advisor" varchar(50),
	"member_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "constraints" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"type" varchar(30) NOT NULL,
	"member_a" integer NOT NULL,
	"member_b" integer NOT NULL,
	"note" text,
	"created_by" integer,
	"approved_by" integer,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"inviter_id" integer NOT NULL,
	"email" varchar(255) NOT NULL,
	"token" varchar(64) NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"class_id" integer,
	"expires_at" timestamp,
	"accepted_at" timestamp,
	"accepted_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "course_invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "course_memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"class_id" integer,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_settings" (
	"course_id" integer PRIMARY KEY NOT NULL,
	"group_count" integer DEFAULT 8 NOT NULL,
	"min_group_size" integer DEFAULT 3 NOT NULL,
	"max_group_size" integer DEFAULT 6 NOT NULL,
	"allow_cross_class" boolean DEFAULT false NOT NULL,
	"require_contract" boolean DEFAULT true NOT NULL,
	"require_peer_review" boolean DEFAULT true NOT NULL,
	"w_skill_cover" numeric(3, 2) DEFAULT '1.20' NOT NULL,
	"w_weak_tie" numeric(3, 2) DEFAULT '0.80' NOT NULL,
	"w_balance" numeric(3, 2) DEFAULT '1.00' NOT NULL,
	"w_history_avoid" numeric(3, 2) DEFAULT '1.00' NOT NULL,
	"w_artifact" numeric(3, 2) DEFAULT '0.50' NOT NULL,
	"w_process" numeric(3, 2) DEFAULT '0.30' NOT NULL,
	"w_peer" numeric(3, 2) DEFAULT '0.20' NOT NULL,
	"fair_share_threshold" numeric(3, 2) DEFAULT '0.14' NOT NULL,
	"delay_trigger_days" integer DEFAULT 2 NOT NULL,
	"idle_trigger_days" integer DEFAULT 3 NOT NULL,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"ai_model" varchar(50) DEFAULT 'deepseek-chat' NOT NULL,
	"ai_monthly_budget_cents" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(32),
	"term" varchar(20) DEFAULT '2026-2027-1' NOT NULL,
	"teacher_id" integer NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"start_at" timestamp,
	"end_at" timestamp,
	"cover_url" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "member_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"cap_coding" smallint DEFAULT 0 NOT NULL,
	"cap_writing" smallint DEFAULT 0 NOT NULL,
	"cap_design" smallint DEFAULT 0 NOT NULL,
	"cap_speech" smallint DEFAULT 0 NOT NULL,
	"cap_data" smallint DEFAULT 0 NOT NULL,
	"cap_research" smallint DEFAULT 0 NOT NULL,
	"cap_leadership" smallint DEFAULT 0 NOT NULL,
	"on_time_rate" numeric(4, 3) DEFAULT '1.000' NOT NULL,
	"avg_delay_days" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"rework_rate" numeric(4, 3) DEFAULT '0.000' NOT NULL,
	"help_count" integer DEFAULT 0 NOT NULL,
	"lead_count" integer DEFAULT 0 NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"is_first_timer" boolean DEFAULT true NOT NULL,
	"source" varchar(20) DEFAULT 'default' NOT NULL,
	"confidence" numeric(3, 2) DEFAULT '0.50' NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"skill" varchar(32) NOT NULL,
	"level" smallint DEFAULT 0 NOT NULL,
	"source" varchar(20) DEFAULT 'skill_card' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"skills" jsonb,
	"availability" jsonb,
	"prefer_roles" jsonb,
	"prefer_teammates" jsonb,
	"avoid_teammates" jsonb,
	"self_note" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_edges" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"user_a" integer NOT NULL,
	"user_b" integer NOT NULL,
	"edge_type" varchar(20) NOT NULL,
	"weight" numeric(4, 2) DEFAULT '1.00' NOT NULL,
	"last_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "student_no" varchar(32);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locale" varchar(10) DEFAULT 'zh-CN' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constraints" ADD CONSTRAINT "constraints_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constraints" ADD CONSTRAINT "constraints_member_a_users_id_fk" FOREIGN KEY ("member_a") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constraints" ADD CONSTRAINT "constraints_member_b_users_id_fk" FOREIGN KEY ("member_b") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constraints" ADD CONSTRAINT "constraints_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constraints" ADD CONSTRAINT "constraints_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_invitations" ADD CONSTRAINT "course_invitations_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_invitations" ADD CONSTRAINT "course_invitations_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_invitations" ADD CONSTRAINT "course_invitations_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_invitations" ADD CONSTRAINT "course_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_memberships" ADD CONSTRAINT "course_memberships_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_memberships" ADD CONSTRAINT "course_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_memberships" ADD CONSTRAINT "course_memberships_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_settings" ADD CONSTRAINT "course_settings_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_skills" ADD CONSTRAINT "member_skills_profile_id_member_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."member_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_cards" ADD CONSTRAINT "skill_cards_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_cards" ADD CONSTRAINT "skill_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_edges" ADD CONSTRAINT "social_edges_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_edges" ADD CONSTRAINT "social_edges_user_a_users_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_edges" ADD CONSTRAINT "social_edges_user_b_users_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "classes_course_name_uniq" ON "classes" USING btree ("course_id","name");--> statement-breakpoint
CREATE INDEX "constraints_course_status_idx" ON "constraints" USING btree ("course_id","status");--> statement-breakpoint
CREATE INDEX "course_invitations_token_idx" ON "course_invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "course_invitations_email_idx" ON "course_invitations" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "course_memberships_course_user_uniq" ON "course_memberships" USING btree ("course_id","user_id");--> statement-breakpoint
CREATE INDEX "course_memberships_role_idx" ON "course_memberships" USING btree ("role");--> statement-breakpoint
CREATE INDEX "course_memberships_class_id_idx" ON "course_memberships" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "courses_teacher_id_idx" ON "courses" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "courses_status_idx" ON "courses" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "member_profiles_course_user_uniq" ON "member_profiles" USING btree ("course_id","user_id");--> statement-breakpoint
CREATE INDEX "member_skills_skill_idx" ON "member_skills" USING btree ("skill");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_cards_course_user_uniq" ON "skill_cards" USING btree ("course_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_edges_uniq" ON "social_edges" USING btree ("course_id","user_a","user_b","edge_type");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_student_no_unique" UNIQUE("student_no");