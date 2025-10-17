// pages/api/ai/orchestrate-enhanced.js
// Enhanced AI orchestration endpoint with proper K8s and external service integration

import { getSession } from 'next-auth/react';
import { getOrchestrator } from '../../../lib/ai-core/orchestrator-singleton';
import { initializeK8sClient } from '../../../lib/ai-core/k8s-orchestrator-config';
import { CostEstimator } from '../../../lib/ai-core/cost-estimator';
import { createRateLimiter } from '../../../middleware/rate-limiter';

// Initialize services
let k8sClient = null;
let costEstimator = null;

async function initializeServices() {
  // Get orchestrator singleton
  const orchestrator = await getOrchestrator();
  
  // Initialize cost estimator
  if (!costEstimator) {
    costEstimator = new CostEstimator();
  }

  try {
    // Initialize K8s client with proper authentication if needed
    if (!k8sClient) {
      console.log('Initializing K8s client...');
      const k8sConfig = await initializeK8sClient();
      k8sClient = k8sConfig;
    }
    
    console.log('✅ Services initialized successfully');
    console.log('- K8s method:', k8sClient?.method || 'none');
    console.log('- Orchestrator: Using singleton instance');
    
    return orchestrator;
  } catch (error) {
    console.error('Failed to initialize services:', error);
    // Return orchestrator singleton anyway
    return orchestrator;
  }
}

export default async function handler(req, res) {
  // Enable CORS for WebSocket upgrades
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-id');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check authentication
    const session = await getSession({ req });
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      prompt,
      mode = 'advanced',
      files = {},
      images = [],
      context = {},
      preferences = {},
      projectId = 'default',
      stream = false,
      dryRun = false,
      complexity = 'moderate'
    } = req.body;

    // Validate required fields
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    
    // Get user tier for cost estimation
    const userTier = session.user.subscription || 'starter';
    
    // Perform cost estimation
    const estimate = await costEstimator.estimateRequestCost(
      { 
        prompt, 
        mode, 
        complexity,
        userId: session.user.id || session.user.email
      },
      userTier
    );
    
    // Check if request is within limits
    if (!estimate.withinLimits) {
      return res.status(400).json({
        error: 'Request exceeds cost limits',
        estimate,
        suggestion: estimate.recommendation === 'simplify_request' 
          ? 'Please simplify your request or break it into smaller parts'
          : 'Please upgrade your plan or wait for limit reset'
      });
    }
    
    // Handle dry-run request
    if (dryRun) {
      return res.status(200).json({
        success: true,
        dryRun: true,
        estimate,
        message: 'Dry run complete - request would be processed'
      });
    }

    // Get or initialize orchestrator
    const aiOrchestrator = await initializeServices();
    
    if (!aiOrchestrator) {
      throw new Error('Failed to initialize AI orchestrator');
    }

    // Create request object with all context
    const aiRequest = {
      prompt,
      mode,
      userId: session.user.id || session.user.email,
      projectId,
      sessionId: req.headers['x-session-id'] || `session_${Date.now()}`,
      files,
      images,
      context: {
        ...context,
        k8sAvailable: !!k8sClient?.k8sApi,
        executionMode: process.env.AGENT_EXECUTION_MODE || 'local'
      },
      preferences
    };

    console.log('Processing AI request:', {
      userId: aiRequest.userId,
      projectId: aiRequest.projectId,
      mode: aiRequest.mode,
      promptLength: prompt.length,
      filesCount: Object.keys(files).length,
      k8sAvailable: aiRequest.context.k8sAvailable
    });

    // Process request based on mode
    let response;
    
    if (mode === 'stream' && stream) {
      // For streaming, we'll need to upgrade to WebSocket
      // This is handled by the websocket endpoint
      return res.status(200).json({
        success: true,
        message: 'Use WebSocket endpoint for streaming',
        websocketUrl: '/api/ai/websocket',
        sessionId: aiRequest.sessionId
      });
    } else {
      // Process synchronously
      response = await aiOrchestrator.processRequest(aiRequest);
    }

    // Add execution metadata
    const enhancedResponse = {
      success: true,
      ...response,
      metadata: {
        ...response.metadata,
        k8sEnabled: !!k8sClient?.k8sApi,
        executionMode: aiRequest.context.executionMode,
        timestamp: new Date().toISOString()
      }
    };

    // Log token usage and record cost if available
    if (response.tokensUsed || response.metadata?.tokensUsed) {
      const tokensUsed = response.tokensUsed || response.metadata.tokensUsed;
      console.log('Tokens used:', tokensUsed);
      
      // Record actual usage for billing
      if (costEstimator && tokensUsed) {
        await costEstimator.recordUsage(
          session.user.id || session.user.email,
          {
            model: estimate.model,
            inputTokens: tokensUsed.input || Math.floor(tokensUsed * 0.3),
            outputTokens: tokensUsed.output || Math.floor(tokensUsed * 0.7),
            cost: response.metadata?.cost || estimate.estimatedCost
          }
        );
      }
    }

    return res.status(200).json(enhancedResponse);

  } catch (error) {
    console.error('AI orchestration error:', error);
    
    // Determine error type and status code
    const statusCode = error.message?.includes('Rate limit') ? 429 :
                      error.message?.includes('Unauthorized') ? 401 :
                      error.message?.includes('Invalid') ? 400 : 500;

    // Provide helpful error messages
    let errorMessage = error.message || 'Failed to process AI request';
    let suggestions = [];
    
    if (error.message?.includes('K8s') || error.message?.includes('kubectl')) {
      errorMessage = 'Kubernetes cluster not available';
      suggestions = [
        'Run the setup-gke-auth.ps1 script to configure GKE',
        'Check if the cluster is running',
        'Verify KUBECONFIG_PATH in .env.local'
      ];
    } else if (error.message?.includes('ChromaDB')) {
      errorMessage = 'Vector database not available';
      suggestions = [
        'Deploy ChromaDB to GKE using the provided YAML',
        'Or use in-memory storage temporarily',
        'Check CHROMADB_URL in .env.local'
      ];
    }

    return res.status(statusCode).json({
      success: false,
      error: errorMessage,
      suggestions,
      details: process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        k8sStatus: k8sClient?.method || 'not initialized',
        services: {
          k8s: !!k8sClient?.k8sApi,
          chromadb: !!process.env.CHROMADB_URL,
          redis: !!process.env.REDIS_URL
        }
      } : undefined
    });
  }
}

// Configure API route for larger payloads
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: '10mb',
  },
};