// NextAuth configuration - to be fully implemented with Google & GitHub OAuth
import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import GitHubProvider from 'next-auth/providers/github';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || 'placeholder',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'placeholder',
    }),
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID || 'placeholder',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || 'placeholder',
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // Create/update user in Supabase
      const { data, error } = await supabase
        .from('users')
        .upsert({
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'email'
        });

      return true;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub;
      }
      return session;
    }
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export default NextAuth(authOptions);
