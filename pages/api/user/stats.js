import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { 
  getUserUsageStats, 
  getUserByEmail,
  createOrUpdateUser 
} from '../../../lib/database';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  
  if (!session) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Get user from database, create if not found
    let user = await getUserByEmail(session.user.email.toLowerCase());
    if (!user) {
      console.log(`User not found in stats, creating user: ${session.user.email}`);
      // Create user if not found (handles in-memory database resets)
      user = await createOrUpdateUser({
        email: session.user.email.toLowerCase(),
        name: session.user.name || session.user.email.split('@')[0]
      });
    }

    const stats = await getUserUsageStats(user.id);
    
    res.status(200).json({
      success: true,
      stats: stats
    });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({ error: 'Failed to fetch user statistics' });
  }
}