// NextAuth configuration with proper UUID-based user management
import NextAuthModule from 'next-auth';
import GoogleProviderModule from 'next-auth/providers/google';
import GitHubProviderModule from 'next-auth/providers/github';
import { createOrUpdateUser, getUserByEmail } from '../../../lib/supabase-database';

// Handle both ESM and CJS module formats for next-auth
const NextAuth = NextAuthModule.default || NextAuthModule;
const GoogleProvider = GoogleProviderModule.default || GoogleProviderModule;
const GitHubProvider = GitHubProviderModule.default || GitHubProviderModule;

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
      try {
        // Use proper UUID-based user creation (not OAuth provider ID)
        const userData = {
          email: user.email,
          name: user.name || profile?.name || user.email?.split('@')[0],
          image: user.image,
          provider: account?.provider || 'oauth'
        };

        const dbUser = await createOrUpdateUser(userData);

        if (dbUser) {
          // Assign the database UUID back to the user object
          // This ensures session callbacks use the correct ID
          user.id = dbUser.id;
          return true;
        }

        console.error('[NextAuth] Failed to create/update user in database');
        return false;
      } catch (error) {
        console.error('[NextAuth] signIn error:', error);
        return false;
      }
    },
    async jwt({ token, user }) {
      // On initial sign in, user object is available with database UUID
      if (user?.id) {
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session?.user) {
        // Prefer the stored userId from JWT token
        if (token.userId) {
          session.user.id = token.userId;
        }
        // Always fetch fresh user data to get current subscription_tier
        if (session.user.email) {
          try {
            const dbUser = await getUserByEmail(session.user.email);
            if (dbUser) {
              session.user.id = dbUser.id || token.userId;
              session.user.subscription_tier = dbUser.subscription_tier;
            }
          } catch (error) {
            console.error('[NextAuth] session lookup error:', error);
          }
        }
      }
      return session;
    }
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export default NextAuth(authOptions);
