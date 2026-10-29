CREATE TABLE "RefreshSession" (
    "id" TEXT NOT NULL,
    "principalId" INTEGER NOT NULL,
    "principalKind" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RefreshSession_expiresAt_idx" ON "RefreshSession"("expiresAt");
