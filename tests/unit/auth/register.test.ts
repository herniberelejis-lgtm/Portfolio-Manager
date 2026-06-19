import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/register/route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe('POST /api/register', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hashes the password before storing the user', async () => {
    (prisma.user.findUnique as any).mockResolvedValue(null);
    (prisma.user.create as any).mockImplementation(({ data }: any) => ({
      id: 'user_1',
      email: data.email,
      passwordHash: data.passwordHash,
    }));

    const req = new Request('http://localhost/api/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'sup3rSecret!' }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.user.email).toBe('test@example.com');
    expect(body.user).not.toHaveProperty('passwordHash');

    const capturedData = (prisma.user.create as any).mock.calls[0][0].data;
    const isValidHash = await bcrypt.compare('sup3rSecret!', capturedData.passwordHash);
    expect(isValidHash).toBe(true);
  });

  it('rejects registration if email already exists', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'existing' });

    const req = new Request('http://localhost/api/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'sup3rSecret!' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
  });
});
