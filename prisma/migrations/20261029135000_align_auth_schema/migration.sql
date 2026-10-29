BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'id'
    ) THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'userId'
        ) THEN
            RAISE EXCEPTION 'User contains both id and userId; manual reconciliation is required';
        END IF;
        ALTER TABLE "User" RENAME COLUMN "id" TO "userId";
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'AdminUser' AND column_name = 'adminID'
    ) THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'AdminUser' AND column_name = 'adminId'
        ) THEN
            RAISE EXCEPTION 'AdminUser contains both adminID and adminId; manual reconciliation is required';
        END IF;
        ALTER TABLE "AdminUser" RENAME COLUMN "adminID" TO "adminId";
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'User_id_key'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'User_userId_key'
    ) THEN
        ALTER INDEX "User_id_key" RENAME TO "User_userId_key";
    END IF;
END $$;

ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "addressLine1" VARCHAR(255),
    ADD COLUMN IF NOT EXISTS "addressLine2" VARCHAR(255),
    ADD COLUMN IF NOT EXISTS "city" VARCHAR(100),
    ADD COLUMN IF NOT EXISTS "postcode" VARCHAR(10);

UPDATE "User"
SET "addressLine1" = COALESCE("addressLine1", ''),
    "addressLine2" = COALESCE("addressLine2", ''),
    "city" = COALESCE("city", ''),
    "postcode" = COALESCE("postcode", '')
WHERE "addressLine1" IS NULL OR "addressLine2" IS NULL
   OR "city" IS NULL OR "postcode" IS NULL;

ALTER TABLE "User"
    ALTER COLUMN "addressLine1" SET NOT NULL,
    ALTER COLUMN "addressLine2" SET NOT NULL,
    ALTER COLUMN "city" SET NOT NULL,
    ALTER COLUMN "postcode" SET NOT NULL;

COMMIT;
