ALTER TABLE "Tournament"
  ADD COLUMN "slug" TEXT;

UPDATE "Tournament"
SET "slug" = LOWER(REGEXP_REPLACE(TRIM("name"), '[^a-zA-Z0-9]+', '-', 'g'));

UPDATE "Tournament"
SET "slug" = COALESCE(NULLIF(TRIM(BOTH '-' FROM "slug"), ''), 'tournament');

WITH ranked AS (
  SELECT
    "id",
    "guildId",
    "slug",
    ROW_NUMBER() OVER (PARTITION BY "guildId", "slug" ORDER BY "createdAt", "id") AS row_num
  FROM "Tournament"
)
UPDATE "Tournament" t
SET "slug" = CASE
  WHEN ranked.row_num = 1 THEN ranked.slug
  ELSE ranked.slug || '-' || ranked.row_num
END
FROM ranked
WHERE ranked."id" = t."id";

ALTER TABLE "Tournament"
  ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX "Tournament_guildId_slug_key" ON "Tournament"("guildId", "slug");
