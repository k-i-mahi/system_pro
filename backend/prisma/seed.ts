import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database with realistic KUET-like demo data...');

  const passwordHash = await bcrypt.hash('Password123', 12);

  // Clear old demo data first so this script is rerunnable.
  await prisma.$transaction(async (tx) => {
    await tx.attendanceRecord.deleteMany();
    await tx.examAttempt.deleteMany();
    await tx.topicProgress.deleteMany();
    await tx.material.deleteMany();
    await tx.topic.deleteMany();
    await tx.scheduleSlot.deleteMany();
    await tx.enrollment.deleteMany();
    await tx.notification.deleteMany();
    await tx.announcement.deleteMany();
    await tx.markUpload.deleteMany();
    await tx.communityMember.deleteMany();
    await tx.community.deleteMany();
    await tx.course.deleteMany();
    await tx.user.deleteMany({
      where: {
        email: {
          in: [
            'tutor@copilot.dev',
            'student@copilot.dev',
            'student2@copilot.dev',
            'mahi@gmail.com',
            'mahi.2107076@kuet.ac.bd',
            'sumaiya.2107080@kuet.ac.bd',
            'shawon@kuet.ac.bd',
          ],
        },
      },
    });
  });

  const tutor = await prisma.user.create({
    data: {
      name: 'Md. Nazirul Hasan Shawon',
      email: 'shawon@kuet.ac.bd',
      universityName: 'Khulna University of Engineering and Technology',
      passwordHash,
      role: 'TUTOR',
      session: 'Faculty',
      department: 'Computer Science and Engineering',
      language: 'en',
      timezone: 'Asia/Dhaka',
      timeFormat: 'H24',
      dateFormat: 'DD_MM_YYYY',
    },
  });

  const s1 = await prisma.user.create({
    data: {
      name: 'Khadimul Islam Mahi',
      email: 'mahi.2107076@kuet.ac.bd',
      universityName: 'Khulna University of Engineering and Technology',
      passwordHash,
      role: 'STUDENT',
      rollNumber: '2107076',
      session: '2021-2022',
      department: 'Computer Science and Engineering',
      language: 'en',
      timezone: 'Asia/Dhaka',
      timeFormat: 'H24',
      dateFormat: 'DD_MM_YYYY',
    },
  });

  const s2 = await prisma.user.create({
    data: {
      name: 'Sumaiya Akter',
      email: 'sumaiya.2107080@kuet.ac.bd',
      universityName: 'Khulna University of Engineering and Technology',
      passwordHash,
      role: 'STUDENT',
      rollNumber: '2107080',
      session: '2021-2022',
      department: 'Computer Science and Engineering',
      language: 'en',
      timezone: 'Asia/Dhaka',
      timeFormat: 'H24',
      dateFormat: 'DD_MM_YYYY',
    },
  });

  await prisma.user.create({
    data: {
      name: 'Khadimul Islam Mahi',
      email: 'mahi@gmail.com',
      universityName: 'Khulna University of Engineering and Technology',
      passwordHash,
      role: 'STUDENT',
      rollNumber: '2107076',
      session: '2021-2022',
      department: 'Computer Science and Engineering',
      language: 'en',
      timezone: 'Asia/Dhaka',
      timeFormat: 'H24',
      dateFormat: 'DD_MM_YYYY',
    },
  });

  const cse3200 = await prisma.course.create({
    data: {
      courseCode: 'CSE 3200',
      courseName: 'System Development Project',
      courseType: 'THEORY',
      category: 'Project',
      level: 'Advanced',
      duration: '16 Weeks',
      rating: 4.8,
      studentCount: 2,
    },
  });

  const cse3210 = await prisma.course.create({
    data: {
      courseCode: 'CSE 3210',
      courseName: 'System Development Project Lab',
      courseType: 'LAB',
      category: 'Lab',
      level: 'Advanced',
      duration: '16 Weeks',
      rating: 4.7,
      studentCount: 2,
    },
  });

  const commTheory = await prisma.community.create({
    data: {
      name: 'CSE 3200 Project Classroom',
      description: 'Theory coordination, docs, and sprint updates',
      courseId: cse3200.id,
      createdBy: tutor.id,
      courseCode: cse3200.courseCode,
      session: '2021-2022',
      department: 'Computer Science and Engineering',
      university: 'Khulna University of Engineering and Technology',
    },
  });

  const commLab = await prisma.community.create({
    data: {
      name: 'CSE 3210 Project Lab Classroom',
      description: 'Lab deliverables, demo videos and marksheet support',
      courseId: cse3210.id,
      createdBy: tutor.id,
      courseCode: cse3210.courseCode,
      session: '2021-2022',
      department: 'Computer Science and Engineering',
      university: 'Khulna University of Engineering and Technology',
    },
  });

  await prisma.communityMember.createMany({
    data: [
      { communityId: commTheory.id, userId: tutor.id, role: 'TUTOR' },
      { communityId: commTheory.id, userId: s1.id, role: 'STUDENT' },
      { communityId: commTheory.id, userId: s2.id, role: 'STUDENT' },
      { communityId: commLab.id, userId: tutor.id, role: 'TUTOR' },
      { communityId: commLab.id, userId: s1.id, role: 'STUDENT' },
      { communityId: commLab.id, userId: s2.id, role: 'STUDENT' },
    ],
  });

  await prisma.enrollment.createMany({
    data: [
      { userId: s1.id, courseId: cse3200.id, ctScore1: 18, ctScore2: 19, ctScore3: 17 },
      { userId: s2.id, courseId: cse3200.id, ctScore1: 16, ctScore2: 15, ctScore3: 17 },
      { userId: s1.id, courseId: cse3210.id, labScore: 44 },
      { userId: s2.id, courseId: cse3210.id, labScore: 41 },
    ],
  });

  const topicA = await prisma.topic.create({
    data: {
      courseId: cse3200.id,
      title: 'Project Requirements and Scope',
      description: 'Problem statement, feasibility and scope definition',
      weekNumber: 1,
      orderIndex: 0,
      status: 'DONE',
      sessionDate: new Date('2026-04-01T10:00:00.000Z'),
    },
  });

  const topicB = await prisma.topic.create({
    data: {
      courseId: cse3200.id,
      title: 'Architecture and API Design',
      description: 'System architecture, service boundaries and API contracts',
      weekNumber: 3,
      orderIndex: 1,
      status: 'IN_PROGRESS',
      sessionDate: new Date('2026-04-10T10:00:00.000Z'),
    },
  });

  const topicC = await prisma.topic.create({
    data: {
      courseId: cse3210.id,
      title: 'Routine OCR and Parsing Lab',
      description: 'OCR pipeline validation and course-code extraction',
      weekNumber: 2,
      orderIndex: 0,
      status: 'DONE',
      sessionDate: new Date('2026-04-06T10:00:00.000Z'),
    },
  });

  const topicD = await prisma.topic.create({
    data: {
      courseId: cse3210.id,
      title: 'Realtime Notifications and SocketIO Lab',
      description: 'Reminder scheduler and live event delivery checks',
      weekNumber: 4,
      orderIndex: 1,
      status: 'IN_PROGRESS',
      sessionDate: new Date('2026-04-18T10:00:00.000Z'),
    },
  });

  await prisma.topicProgress.createMany({
    data: [
      { userId: s1.id, topicId: topicA.id, expertiseLevel: 0.88, studyMinutes: 160, examScore: 0.86, alpha: 9, beta: 2, lastStudied: new Date('2026-04-16') },
      { userId: s1.id, topicId: topicB.id, expertiseLevel: 0.56, studyMinutes: 75, alpha: 6, beta: 5, lastStudied: new Date('2026-04-20') },
      { userId: s2.id, topicId: topicA.id, expertiseLevel: 0.74, studyMinutes: 120, examScore: 0.79, alpha: 8, beta: 4, lastStudied: new Date('2026-04-17') },
      { userId: s2.id, topicId: topicC.id, expertiseLevel: 0.69, studyMinutes: 95, alpha: 7, beta: 4, lastStudied: new Date('2026-04-20') },
    ],
  });

  const slotTheory = await prisma.scheduleSlot.create({
    data: {
      courseId: cse3200.id,
      dayOfWeek: 'MON',
      startTime: '09:00',
      endTime: '10:30',
      type: 'CLASS',
      room: 'CSE 305',
    },
  });

  const slotLab = await prisma.scheduleSlot.create({
    data: {
      courseId: cse3210.id,
      dayOfWeek: 'WED',
      startTime: '14:00',
      endTime: '16:00',
      type: 'LAB',
      room: 'Software Lab-2',
    },
  });

  await prisma.attendanceRecord.createMany({
    data: [
      { userId: s1.id, slotId: slotTheory.id, date: new Date('2026-04-07'), present: true },
      { userId: s1.id, slotId: slotTheory.id, date: new Date('2026-04-14'), present: true },
      { userId: s1.id, slotId: slotTheory.id, date: new Date('2026-04-21'), present: false },
      { userId: s2.id, slotId: slotTheory.id, date: new Date('2026-04-07'), present: true },
      { userId: s2.id, slotId: slotTheory.id, date: new Date('2026-04-14'), present: false },
      { userId: s2.id, slotId: slotTheory.id, date: new Date('2026-04-21'), present: true },
      { userId: s1.id, slotId: slotLab.id, date: new Date('2026-04-09'), present: true },
      { userId: s1.id, slotId: slotLab.id, date: new Date('2026-04-16'), present: true },
      { userId: s1.id, slotId: slotLab.id, date: new Date('2026-04-23'), present: false },
      { userId: s2.id, slotId: slotLab.id, date: new Date('2026-04-09'), present: true },
      { userId: s2.id, slotId: slotLab.id, date: new Date('2026-04-16'), present: true },
      { userId: s2.id, slotId: slotLab.id, date: new Date('2026-04-23'), present: true },
    ],
  });

  await prisma.examAttempt.createMany({
    data: [
      {
        userId: s1.id,
        topicId: topicA.id,
        score: 8,
        totalQ: 10,
        timeTaken: 520,
        questions: [
          { q: 'What is project scope?', options: ['Boundary', 'Budget', 'Tool', 'Language'], correct: 'Boundary', userAnswer: 'Boundary' },
        ],
      },
      {
        userId: s2.id,
        topicId: topicC.id,
        score: 7,
        totalQ: 10,
        timeTaken: 610,
        questions: [
          { q: 'OCR pipeline first step?', options: ['Upload', 'Parse', 'Embed', 'Notify'], correct: 'Upload', userAnswer: 'Upload' },
        ],
      },
    ],
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: s1.id,
        type: 'CLASS_REMINDER',
        title: 'CSE 3200 starts soon',
        body: 'System Development Project starts at 09:00 in CSE 305.',
        isRead: false,
      },
      {
        userId: s2.id,
        type: 'MATERIAL_UPLOAD_PROMPT',
        title: 'Upload class material',
        body: 'Please upload your lab notes for CSE 3210 after class.',
        isRead: false,
      },
    ],
  });

  await prisma.announcement.createMany({
    data: [
      {
        communityId: commTheory.id,
        authorId: tutor.id,
        title: 'Project Report Draft Deadline',
        body: 'Submit your Chapter 1-3 draft by April 28, 2026.',
      },
      {
        communityId: commLab.id,
        authorId: tutor.id,
        title: 'Socket Lab Checkpoint',
        body: 'Demonstrate live reminder notifications in next lab.',
      },
    ],
  });

  console.log('Seeding complete.');
  console.log('Login credentials:');
  console.log('  Tutor:   shawon@kuet.ac.bd / Password123');
  console.log('  Student: mahi@gmail.com / Password123');
  console.log('  Student: mahi.2107076@kuet.ac.bd / Password123');
  console.log('  Student: sumaiya.2107080@kuet.ac.bd / Password123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
