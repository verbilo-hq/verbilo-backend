-- VER-37: GDPR support fields on User
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "User" ALTER COLUMN "cognitoId" DROP NOT NULL;
