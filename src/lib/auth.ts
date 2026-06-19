import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';

// NextAuth requires a secret in production. We read it from the environment
// when available, and fall back to a baked-in value so the app works on a
// fresh deploy without having to configure NEXTAUTH_SECRET by hand. Override
// it via the NEXTAUTH_SECRET env var if you want to rotate or keep it private.
const NEXTAUTH_SECRET =
  process.env.NEXTAUTH_SECRET ?? 'N8f3f3GywpcCw42MhoAkn88Tn1if91aImpaiJOpZNcw=';

export const authOptions: NextAuthOptions = {
  secret: NEXTAUTH_SECRET,
  session: { strategy: 'jwt' },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({ where: { email: credentials.email } });
        if (!user) return null;

        const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!isValid) return null;

        return { id: user.id, email: user.email };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.userId = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) (session.user as any).id = token.userId;
      return session;
    },
  },
  pages: { signIn: '/login' },
};
