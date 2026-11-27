CREATE TABLE "SocialAccount" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SocialAccount_provider_providerAccountId_key"
ON "SocialAccount"("provider", "providerAccountId");

CREATE INDEX "SocialAccount_userId_idx"
ON "SocialAccount"("userId");

ALTER TABLE "SocialAccount"
ADD CONSTRAINT "SocialAccount_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
