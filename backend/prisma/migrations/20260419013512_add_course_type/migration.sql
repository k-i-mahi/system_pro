-- CreateEnum
CREATE TYPE "CourseType" AS ENUM ('THEORY', 'LAB');

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "courseType" "CourseType" NOT NULL DEFAULT 'THEORY';
