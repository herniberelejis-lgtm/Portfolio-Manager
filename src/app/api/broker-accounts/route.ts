import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { broker, label } = await req.json();
  if (!['cocos', 'bullmarket'].includes(broker)) {
    return Response.json({ error: 'Invalid broker' }, { status: 400 });
  }

  const account = await prisma.brokerAccount.create({
    data: { userId: (session.user as any).id, broker, label },
  });

  return Response.json({ account }, { status: 201 });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accounts = await prisma.brokerAccount.findMany({
    where: { userId: (session.user as any).id },
  });

  return Response.json({ accounts });
}
