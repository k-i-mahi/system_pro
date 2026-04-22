-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DateFormat" ADD VALUE 'DD_MM_YYYY';
ALTER TYPE "DateFormat" ADD VALUE 'MM_DD_YYYY';
ALTER TYPE "DateFormat" ADD VALUE 'YYYY_MM_DD';
