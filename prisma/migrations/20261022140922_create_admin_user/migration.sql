-- CreateTable
CREATE TABLE "AdminUser" (
    "adminID" SERIAL NOT NULL,
    "forename" VARCHAR(100) NOT NULL,
    "surname" VARCHAR(100) NOT NULL,
    "email" TEXT NOT NULL,
    "role" VARCHAR(50) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("adminID")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");
