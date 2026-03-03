import { stripe } from '../../../lib/stripe';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    
    if (!session) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { customerId } = req.body;
    
    if (!customerId) {
      return res.status(400).json({ error: 'Customer ID required' });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.NEXT_PUBLIC_DOMAIN}/billing`,
    });

    res.status(200).json({ url: portalSession.url });
  } catch (error) {
    console.error('Customer portal error:', error);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
}