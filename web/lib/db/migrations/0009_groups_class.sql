ALTER TABLE "groups" ADD COLUMN "class_id" integer;
--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "groups_class_idx" ON "groups" ("class_id");
