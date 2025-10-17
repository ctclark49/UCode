// pages/api/ai/v2/execute.ts
// Enhanced AI API endpoint with full GKE integration

import { NextApiRequest, NextApiResponse } from 'next';
import { APIConnector } from '../../../../lib/ai-core/integration/api-connector';
import { withAuth } from '../../../../lib/auth-middleware';

// Initialize connector singleton
let apiConnector: APIConnector;

function getAPIConnector(): APIConnector {
  if (!apiConnector) {
    apiConnector = new APIConnector({
      anthropicKey: process.env.ANTHROPIC_API_KEY,
      openaiKey: process.env.OPENAI_API_KEY,
      gkeOrchestratorUrl: process.env.GKE_ORCHESTRATOR_URL,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_SERVICE_KEY
    });
    
    // Setup cleanup on server shutdown
    process.on('SIGTERM', async () => {
      console.log('Cleaning up AI resources...');
      const sessions = apiConnector.getActiveSessions();
      for (const session of sessions) {
        await apiConnector.endSession(session.sessionId);
      }
    });
  }
  
  return apiConnector;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Validate request body
  if (!req.body.prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }
  
  try {
    const connector = getAPIConnector();
    
    // Handle the request through unified connector
    await connector.handleRequest(req, res);
    
  } catch (error: any) {
    console.error('AI API error:', error);
    
    // Don't send response if streaming already started
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'An error occurred processing your request',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
}

// Apply authentication middleware
export default withAuth(handler);

// Configure API route
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb'
    },
    responseLimit: false,
    // Increase timeout for long-running AI operations
    externalResolver: true
  }
};