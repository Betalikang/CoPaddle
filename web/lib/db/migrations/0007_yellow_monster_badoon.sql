CREATE TABLE "peer_review_anomalies" (
	"id" serial PRIMARY KEY NOT NULL,
	"round_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	"type" varchar(30) NOT NULL,
	"payload" jsonb,
	"severity" varchar(20) DEFAULT 'medium' NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "peer_review_rounds" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"open_at" timestamp,
	"close_at" timestamp,
	"status" varchar(20) DEFAULT 'scheduled' NOT NULL,
	"is_anonymous" boolean DEFAULT true NOT NULL,
	"dimensions" jsonb,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "peer_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"round_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	"reviewer_id" integer NOT NULL,
	"reviewee_id" integer NOT NULL,
	"scores" jsonb NOT NULL,
	"comment" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "peer_review_anomalies" ADD CONSTRAINT "peer_review_anomalies_round_id_peer_review_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."peer_review_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_review_anomalies" ADD CONSTRAINT "peer_review_anomalies_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_review_rounds" ADD CONSTRAINT "peer_review_rounds_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_review_rounds" ADD CONSTRAINT "peer_review_rounds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_round_id_peer_review_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."peer_review_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_reviewee_id_users_id_fk" FOREIGN KEY ("reviewee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "peer_review_rounds_course_status_idx" ON "peer_review_rounds" USING btree ("course_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "peer_reviews_uniq" ON "peer_reviews" USING btree ("round_id","reviewer_id","reviewee_id");