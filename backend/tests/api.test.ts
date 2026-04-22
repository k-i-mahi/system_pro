import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';

let app: express.Express;
// Shared token for seeded student user – login once, reuse everywhere
let studentToken: string;

beforeAll(async () => {
  // Set env before importing
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://copilot:copilot@localhost:5432/copilot_db';
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/0';
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || '3zviJgTePxMdBYIbP3QbiicGRbU6lb23JxvpBdjNSVI=';
  process.env.CORS_ORIGINS = 'http://localhost:5173';
  process.env.NODE_ENV = 'test';

  const { default: appModule } = await import('../src/index.js');
  app = appModule;

  // Connect prisma for tests
  const { prisma } = await import('../src/config/database.js');
  await prisma.$connect();

  // Login the seeded student user once
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'student@copilot.dev', password: 'Password123' });
  studentToken = loginRes.body.data.accessToken;
}, 30000);

describe('Auth API', () => {
  const testEmail = `test-${Date.now()}@copilot.dev`;
  const testPassword = 'Password123';
  let accessToken: string;
  let refreshToken: string;

  it('POST /api/auth/register - creates a new user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test User',
        email: testEmail,
        password: testPassword,
        universityName: 'Test University',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(testEmail);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
  });

  it('POST /api/auth/register - rejects duplicate email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Duplicate',
        email: testEmail,
        password: testPassword,
        universityName: 'Test University',
      });

    expect(res.status).toBe(409);
  });

  it('POST /api/auth/login - authenticates user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmail, password: testPassword });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    expect(res.body.data.user.email).toBe(testEmail);

    accessToken = res.body.data.accessToken;
    refreshToken = res.body.data.refreshToken;
  });

  it('POST /api/auth/login - rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmail, password: 'WrongPassword1' });

    expect(res.status).toBe(401);
  });

  it('POST /api/auth/login - validates input', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'notanemail', password: '' });

    expect(res.status).toBe(400);
  });

  it('GET /api/auth/me - returns current user', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(testEmail);
  });

  it('GET /api/auth/me - rejects missing token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/refresh - rotates tokens', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();

    accessToken = res.body.data.accessToken;
    refreshToken = res.body.data.refreshToken;
  });

  it('POST /api/auth/logout - blacklists token', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
  });

  it('GET /api/auth/me - rejects blacklisted token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(401);
  });
});

describe('Courses API', () => {
  it('GET /api/courses - lists all courses', async () => {
    const res = await request(app)
      .get('/api/courses')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('GET /api/courses/my-courses - lists enrolled courses', async () => {
    const res = await request(app)
      .get('/api/courses/my-courses')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(3);
    // Check scores are included
    const cs101 = res.body.data.find((c: any) => c.courseCode === 'CS 101');
    expect(cs101).toBeDefined();
    expect(cs101.ctScore1).toBe(17);
    expect(cs101.progress).toBeDefined();
  });

  it('GET /api/courses/:courseId - returns course detail', async () => {
    const res = await request(app)
      .get('/api/courses/seed-course-1')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.courseCode).toBe('CS 101');
    expect(Array.isArray(res.body.data.topics)).toBe(true);
    expect(res.body.data.topics.length).toBe(4);
    // Check enrollment scores
    expect(res.body.data.enrollment).toBeDefined();
  });

  it('GET /api/courses/:courseId - returns 404 for missing course', async () => {
    const res = await request(app)
      .get('/api/courses/nonexistent-id')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(404);
  });
});

describe('Routine API', () => {
  it('GET /api/routine - returns schedule slots', async () => {
    const res = await request(app)
      .get('/api/routine')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    // Verify DayOfWeek uses 3-letter codes
    const days = res.body.data.map((s: any) => s.dayOfWeek);
    for (const d of days) {
      expect(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']).toContain(d);
    }
  });
});

describe('Health Check', () => {
  it('GET /health - returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

/* ───────────────────────────── Community API ──────────────────────────── */
describe('Community API', () => {
  let threadId: string;

  it('GET /api/community/threads - lists threads', async () => {
    const res = await request(app)
      .get('/api/community/threads')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /api/community/threads - creates thread', async () => {
    const res = await request(app)
      .post('/api/community/threads')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ title: 'Test Thread', body: 'This is a test thread body', tags: ['test'] });

    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Test Thread');
    threadId = res.body.data.id;
  });

  it('POST /api/community/threads - validates required fields', async () => {
    const res = await request(app)
      .post('/api/community/threads')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('GET /api/community/threads/:id - gets thread detail', async () => {
    const res = await request(app)
      .get(`/api/community/threads/${threadId}`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Test Thread');
    expect(Array.isArray(res.body.data.posts)).toBe(true);
  });

  it('POST /api/community/threads/:id/posts - creates reply', async () => {
    const res = await request(app)
      .post(`/api/community/threads/${threadId}/posts`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ content: 'Test reply content' });

    expect(res.status).toBe(201);
    expect(res.body.data.content).toBe('Test reply content');
  });

  it('POST /api/community/threads/:id/like - likes thread', async () => {
    const res = await request(app)
      .post(`/api/community/threads/${threadId}/like`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect([200, 201]).toContain(res.status);
  });

  it('POST /api/community/threads/:id/like - idempotent on duplicate', async () => {
    const res = await request(app)
      .post(`/api/community/threads/${threadId}/like`)
      .set('Authorization', `Bearer ${studentToken}`);

    // Should not error - P2002 is handled gracefully
    expect([200, 201]).toContain(res.status);
  });

  it('DELETE /api/community/threads/:id/like - unlikes thread', async () => {
    const res = await request(app)
      .delete(`/api/community/threads/${threadId}/like`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
  });

  it('GET /api/community/threads?tab=my-courses - filters by enrolled courses', async () => {
    const res = await request(app)
      .get('/api/community/threads?tab=my-courses')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('DELETE /api/community/threads/:id - deletes own thread', async () => {
    const res = await request(app)
      .delete(`/api/community/threads/${threadId}`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
  });
});

/* ───────────────────────────── Settings API ──────────────────────────── */
describe('Settings API', () => {

  it('GET /api/settings - returns user settings', async () => {
    const res = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('language');
    expect(res.body.data).toHaveProperty('timezone');
    expect(res.body.data).toHaveProperty('dateFormat');
    expect(res.body.data).toHaveProperty('timeFormat');
    expect(res.body.data).toHaveProperty('notifChat');
  });

  it('PATCH /api/settings/general - updates general settings', async () => {
    const res = await request(app)
      .patch('/api/settings/general')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ language: 'bn', timezone: 'Asia/Dhaka', dateFormat: 'DD_MM_YYYY' });

    expect(res.status).toBe(200);
    expect(res.body.data.language).toBe('bn');
    expect(res.body.data.timezone).toBe('Asia/Dhaka');
    expect(res.body.data.dateFormat).toBe('DD_MM_YYYY');
  });

  it('PATCH /api/settings/password - rejects wrong current password', async () => {
    const res = await request(app)
      .patch('/api/settings/password')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ oldPassword: 'WrongPassword1', newPassword: 'NewPass123!' });

    expect(res.status).toBe(400);
  });

  it('PATCH /api/settings/password - rejects same password', async () => {
    const res = await request(app)
      .patch('/api/settings/password')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ oldPassword: 'Password123', newPassword: 'Password123' });

    expect(res.status).toBe(400);
  });

  it('PATCH /api/settings/notifications - updates notification preferences', async () => {
    const res = await request(app)
      .patch('/api/settings/notifications')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ notifChat: false, notifNewestUpdate: true });

    expect(res.status).toBe(200);
    expect(res.body.data.notifChat).toBe(false);
  });
});

/* ───────────────────────────── Profile API ───────────────────────────── */
describe('Profile API', () => {

  it('GET /api/profile - returns user profile', async () => {
    const res = await request(app)
      .get('/api/profile')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('name');
    expect(res.body.data).toHaveProperty('email');
    expect(res.body.data).toHaveProperty('universityName');
    expect(res.body.data).toHaveProperty('bio');
  });

  it('PATCH /api/profile - updates profile', async () => {
    const res = await request(app)
      .patch('/api/profile')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ name: 'Updated Student', bio: 'Test bio' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Student');
    expect(res.body.data.bio).toBe('Test bio');
  });

  it('PATCH /api/profile - rejects empty name', async () => {
    const res = await request(app)
      .patch('/api/profile')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ name: '' });

    expect(res.status).toBe(400);
  });

  it('GET /api/profile - rejects unauthenticated', async () => {
    const res = await request(app).get('/api/profile');
    expect(res.status).toBe(401);
  });
});

/* ─────────────────────────── Notifications API ──────────────────────── */
describe('Notifications API', () => {

  it('GET /api/notifications - lists notifications', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /api/notifications/unread-count - returns count', async () => {
    const res = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.data.count).toBe('number');
  });

  it('PATCH /api/notifications/read-all - marks all as read', async () => {
    const res = await request(app)
      .patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
  });

  it('GET /api/notifications - rejects unauthenticated', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });
});

/* ──────────────────────────── Analytics API ──────────────────────────── */
describe('Analytics API', () => {

  it('GET /api/analytics/overview - returns stats', async () => {
    const res = await request(app)
      .get('/api/analytics/overview')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('totalCourses');
    expect(res.body.data).toHaveProperty('avgAttendance');
    expect(res.body.data).toHaveProperty('avgCT');
    expect(res.body.data).toHaveProperty('topicsMastered');
    expect(res.body.data).toHaveProperty('totalTopics');
  });

  it('GET /api/analytics/courses/:courseId - returns course analytics', async () => {
    const res = await request(app)
      .get('/api/analytics/courses/seed-course-1')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('enrollment');
    expect(res.body.data).toHaveProperty('topicAnalytics');
    expect(res.body.data).toHaveProperty('attendanceData');
    expect(res.body.data).toHaveProperty('examHistory');
  });

  it('GET /api/analytics/overview - rejects unauthenticated', async () => {
    const res = await request(app).get('/api/analytics/overview');
    expect(res.status).toBe(401);
  });
});
