-- Rename existing columns to snake_case so any existing users keep their password hashes and creation times
ALTER TABLE "User" RENAME COLUMN "passwordHash" TO "password_hash";
ALTER TABLE "User" RENAME COLUMN "createdAt" TO "created_at";

-- Temporary empty-string defaults let NOT NULL columns be added to tables that already contain users
ALTER TABLE "User"
ADD COLUMN "forename" VARCHAR(100) NOT NULL DEFAULT '',
ADD COLUMN "surname" VARCHAR(100) NOT NULL DEFAULT '',
ADD COLUMN "modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "User"
ALTER COLUMN "forename" DROP DEFAULT,
ALTER COLUMN "surname" DROP DEFAULT;

-- Existing users were never modified, so their modified_at should match created_at
UPDATE "User" SET "modified_at" = "created_at";
