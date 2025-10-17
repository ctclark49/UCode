// pages/api/ai/unified.ts
// Main AI endpoint using the unified orchestration system

import { NextApiRequest, NextApiResponse } from 'next';
import { getOrchestrator } from '../../../lib/ai-core/orchestrator-singleton';

// Using proper singleton from orchestrator-singleton.js

// Simple in-memory rate limiting (for MVP)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const limit = 100; // requests per hour
  const window = 3600000; // 1 hour in ms
  
  const current = rateLimitMap.get(identifier);
  
  if (!current || current.resetTime < now) {
    rateLimitMap.set(identifier, { count: 1, resetTime: now + window });
    return true;
  }
  
  if (current.count >= limit) {
    return false;
  }
  
  current.count++;
  return true;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get identifier for rate limiting (use IP address as fallback)
    const identifier = req.headers['x-forwarded-for'] as string || 
                      req.socket.remoteAddress || 
                      'anonymous';

    // Check rate limit
    if (!checkRateLimit(identifier)) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded. Please try again later.' 
      });
    }

    // Parse request body
    const {
      prompt,
      mode = 'simple',
      projectId,
      files = {},
      images = [],
      preferences = {},
      context = {},
      stream = false
    } = req.body;

    // Validate required fields
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Set up streaming if requested
    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
    }

    // Create AI request
    const aiRequest = {
      prompt,
      mode,
      userId: identifier,
      projectId: projectId || `project_${Date.now()}`,
      sessionId: req.headers['x-session-id'] as string || `session_${Date.now()}`,
      files,
      images,
      preferences: {
        framework: preferences.framework || 'nextjs',
        styling: preferences.styling || 'tailwind',
        database: preferences.database || 'supabase',
        deployment: preferences.deployment || 'vercel',
        language: preferences.language || 'typescript'
      },
      context
    };

    // Get orchestrator instance
    const ai = await getOrchestrator();

    // Process request
    if (stream) {
      // Stream response
      const streamHandler = (chunk: any) => {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      };

      ai.on('progress', streamHandler);
      
      try {
        const response = await ai.processRequest({ ...aiRequest, mode: 'stream' });
        res.write(`data: ${JSON.stringify({ type: 'complete', result: response })}\n\n`);
      } catch (error: any) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      } finally {
        ai.off('progress', streamHandler);
        res.end();
      }
    } else {
      // Regular response
      const response = await ai.processRequest(aiRequest);
      
      // Return appropriate response based on mode
      if (response.error) {
        return res.status(500).json({ 
          error: response.error,
          details: process.env.NODE_ENV === 'development' ? response.details : undefined
        });
      }

      return res.status(200).json(response);
    }
  } catch (error: any) {
    console.error('AI endpoint error:', error);
    
    // Check if it's a configuration error
    if (error.message?.includes('API key') || error.message?.includes('environment')) {
      return res.status(500).json({
        error: 'AI service is not properly configured. Please check your environment variables.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
    
    return res.status(500).json({
      error: 'An error occurred while processing your request',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb'
    },
    responseLimit: false
  }
};