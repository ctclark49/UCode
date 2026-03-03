// pages/api/deploy/index.js - Updated with Analytics + Auth Hook Injection
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { getUserByEmail, saveDeployment, updateProject } from '../../../lib/database';
import { injectAnalytics } from '../../../lib/analytics/site-analytics';
import { injectAuthHooks } from '../../../lib/analytics/site-auth-hooks';
import { getSupabaseAdmin } from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const user = await getUserByEmail(session.user.email);
    const { projectId, files, projectName, type, platform, customSubdomain } = req.body;

    // Validate inputs
    if (!projectId || !files) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Generate or validate subdomain
    let subdomain = customSubdomain;
    if (!subdomain) {
      subdomain = generateSubdomain(projectName || projectId);
    } else {
      // Validate custom subdomain
      const validation = validateSubdomain(subdomain);
      if (!validation.valid) {
        return res.status(400).json({ 
          error: validation.message,
          code: 'INVALID_SUBDOMAIN'
        });
      }
    }

    // Check subdomain availability
    const isAvailable = await checkSubdomainAvailability(subdomain, projectId);
    if (!isAvailable) {
      return res.status(400).json({ 
        error: 'Subdomain is already taken',
        code: 'SUBDOMAIN_TAKEN',
        suggestion: generateSubdomain(projectName || projectId)
      });
    }

    // Check if user has Supabase connected for this project
    const hasSupabaseConnection = await checkProjectHasDatabase(projectId, user.id);

    // Process files and inject analytics (+ auth hooks if Supabase connected)
    const processedFiles = await processFilesForDeployment(files, projectId, subdomain, hasSupabaseConnection);

    // Deploy to hosting (this would integrate with your hosting provider)
    const deploymentUrl = await deployToHosting(subdomain, processedFiles);

    // Save deployment record
    await saveDeployment(projectId, user.id, {
      subdomain,
      platform: platform || 'ezcoder',
      url: deploymentUrl,
      status: 'active',
      files: processedFiles,
      metadata: {
        projectName,
        deployedAt: new Date().toISOString()
      }
    });

    // Update project with deployment info
    await updateProject(projectId, user.id, {
      deployment_status: 'deployed',
      deployed_url: deploymentUrl,
      subdomain: subdomain
    });

    // Log deployment activity
    await logActivity(user.id, projectId, 'deployment', {
      subdomain,
      url: deploymentUrl
    });

    return res.status(200).json({
      success: true,
      url: deploymentUrl,
      subdomain: subdomain,
      message: 'Deployment successful'
    });

  } catch (error) {
    console.error('Deployment error:', error);
    return res.status(500).json({ 
      error: 'Deployment failed',
      message: error.message 
    });
  }
}

async function processFilesForDeployment(files, projectId, subdomain, hasSupabaseConnection = false) {
  const processedFiles = { ...files };

  // Find and process HTML files to inject analytics
  Object.keys(processedFiles).forEach(filename => {
    if (filename.endsWith('.html')) {
      let content = processedFiles[filename];

      // Inject analytics script into HTML files (always)
      content = injectAnalytics(content, projectId, subdomain);

      // Inject auth hooks if customer has Supabase connected
      // This allows tracking of registered users on deployed sites
      if (hasSupabaseConnection) {
        content = injectAuthHooks(content, projectId);
      }

      processedFiles[filename] = content;
    }
  });

  // Also create a simple analytics loader for non-HTML pages
  if (!processedFiles['analytics.js']) {
    processedFiles['analytics.js'] = getStandaloneAnalyticsScript(projectId, subdomain);
  }

  return processedFiles;
}

// Check if the project has a database connection (Supabase)
async function checkProjectHasDatabase(projectId, userId) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return false;

    const { data, error } = await supabase
      .from('database_connections')
      .select('id')
      .eq('ezcoder_project_id', projectId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(1);

    if (error) {
      console.error('[Deploy] Error checking database connection:', error);
      return false;
    }

    return data && data.length > 0;
  } catch (error) {
    console.error('[Deploy] Failed to check database connection:', error);
    return false;
  }
}

function getStandaloneAnalyticsScript(projectId, subdomain) {
  return `
// EzCoder Analytics - Standalone Script
// Include this in your non-HTML files: <script src="/analytics.js"></script>
(function() {
  if (window._ezaLoaded) return;
  window._ezaLoaded = true;
  
  const ANALYTICS_ENDPOINT = '${process.env.NEXT_PUBLIC_APP_URL || 'https://app.ezcoder.app'}/api/analytics/collect';
  const PROJECT_ID = '${projectId}';
  const SITE_SUBDOMAIN = '${subdomain}';
  
  // Session management
  let sessionId = sessionStorage.getItem('_eza_session');
  if (!sessionId) {
    sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem('_eza_session', sessionId);
  }
  
  let visitorId = localStorage.getItem('_eza_visitor');
  if (!visitorId) {
    visitorId = 'vis_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('_eza_visitor', visitorId);
  }
  
  // Page tracking
  function trackPageView() {
    fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'page_view',
        projectId: PROJECT_ID,
        subdomain: SITE_SUBDOMAIN,
        sessionId: sessionId,
        visitorId: visitorId,
        url: window.location.href,
        pathname: window.location.pathname,
        referrer: document.referrer,
        userAgent: navigator.userAgent,
        screenResolution: screen.width + 'x' + screen.height,
        viewport: window.innerWidth + 'x' + window.innerHeight,
        timestamp: new Date().toISOString()
      }),
      keepalive: true
    }).catch(() => {});
  }
  
  // Custom event tracking
  window.trackEvent = function(eventName, eventData = {}) {
    fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'custom_event',
        eventName: eventName,
        projectId: PROJECT_ID,
        subdomain: SITE_SUBDOMAIN,
        sessionId: sessionId,
        visitorId: visitorId,
        url: window.location.href,
        metadata: eventData,
        timestamp: new Date().toISOString()
      }),
      keepalive: true
    }).catch(() => {});
  };
  
  // Initialize
  trackPageView();
  
  // Track SPA navigation
  let lastPath = window.location.pathname;
  setInterval(function() {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      trackPageView();
    }
  }, 1000);
})();
`;
}

function generateSubdomain(projectName) {
  const base = projectName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 20);
  
  const random = Math.random().toString(36).substring(2, 6);
  return `${base}-${random}`;
}

function validateSubdomain(subdomain) {
  if (!subdomain || subdomain.length < 3) {
    return { valid: false, message: 'Subdomain must be at least 3 characters' };
  }
  
  if (subdomain.length > 63) {
    return { valid: false, message: 'Subdomain must be less than 63 characters' };
  }
  
  if (!/^[a-z0-9-]+$/.test(subdomain)) {
    return { valid: false, message: 'Subdomain can only contain lowercase letters, numbers, and hyphens' };
  }
  
  if (subdomain.startsWith('-') || subdomain.endsWith('-')) {
    return { valid: false, message: 'Subdomain cannot start or end with a hyphen' };
  }
  
  // Reserved subdomains
  const reserved = ['www', 'app', 'api', 'admin', 'blog', 'mail', 'ftp', 'email'];
  if (reserved.includes(subdomain)) {
    return { valid: false, message: 'This subdomain is reserved' };
  }
  
  return { valid: true };
}

async function checkSubdomainAvailability(subdomain, projectId) {
  // This would check your database or hosting provider
  // For now, we'll simulate it
  try {
    const { getSupabaseAdmin } = require('../../../lib/supabase');
    const supabase = getSupabaseAdmin();
    
    const { data } = await supabase
      .from('deployments')
      .select('id')
      .eq('subdomain', subdomain)
      .neq('project_id', projectId)
      .single();
    
    return !data; // Available if no other project uses it
  } catch (error) {
    // If error (no results), subdomain is available
    return true;
  }
}

async function deployToHosting(subdomain, files) {
  // This would integrate with your hosting provider (Vercel, Netlify, etc.)
  // For EzCoder hosting, you might use a service like:
  // - Cloudflare Pages
  // - AWS S3 + CloudFront
  // - Custom hosting solution
  
  // For now, return a mock URL
  const baseUrl = process.env.HOSTING_BASE_URL || 'https://ezcoder.dev';
  return `https://${subdomain}.${baseUrl.replace('https://', '')}`;
}

async function logActivity(userId, projectId, type, details) {
  try {
    await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/logs/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [{
          type,
          projectId,
          details
        }]
      })
    });
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
}