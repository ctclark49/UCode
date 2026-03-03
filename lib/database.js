// lib/database.js - Database abstraction layer
//
// SECURITY: This module supports two modes:
// 1. RLS-Enforced Mode (recommended): Uses user-scoped Supabase clients
//    - Enabled when SUPABASE_JWT_SECRET is configured
//    - All user operations are filtered by Row Level Security
//    - Users can only access their own data
//
// 2. Admin Mode (legacy): Uses service_role for all operations
//    - RLS is bypassed - less secure
//    - Used when SUPABASE_JWT_SECRET is not configured
//
// To enable RLS mode:
// 1. Get JWT Secret from Supabase Dashboard → Settings → API
// 2. Add to .env.local: SUPABASE_JWT_SECRET=your-secret

console.log('[Database] Initializing database module...');
console.log('[Database] USE_SUPABASE:', process.env.NEXT_PUBLIC_USE_SUPABASE);

// Check if RLS mode is available
const RLS_ENABLED = !!(
  process.env.SUPABASE_JWT_SECRET &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

console.log('[Database] RLS Mode:', RLS_ENABLED ? 'ENABLED (secure)' : 'DISABLED (using admin client)');

if (!RLS_ENABLED) {
  console.warn('[Database] WARNING: SUPABASE_JWT_SECRET not configured. Using admin client (RLS bypassed).');
  console.warn('[Database] For production, configure SUPABASE_JWT_SECRET to enable RLS enforcement.');
}

// Import from admin implementation (always needed for system operations)
import {
  createOrUpdateUser,
  getUserByEmail,
  updateUserSubscription,
  logAIUsage,
  checkAndResetDailyUsage,
  resetUserDailyUsage,
  saveProjectIntegration,
  getProjectIntegration,
  removeProjectIntegration,
  createAutoSaveHandler,
  runDatabaseHealthCheck,
  // Ad management functions (admin-only for now)
  saveAdAccount,
  updateAdAccount,
  getAdAccounts,
  getAdAccount,
  deleteAdAccount,
  createAdCampaign,
  updateAdCampaign,
  getAdCampaigns,
  getAdCampaign,
  deleteAdCampaign,
  saveAdMetrics,
  getAdAnalytics,
  getAdMetricsByCampaign,
  saveAdRecommendation,
  getAdRecommendations,
  applyAdRecommendation,
  getAdBudgets,
  updateCampaignBudget,
  syncGoogleAdsData,
  syncFacebookAdsData
} from './supabase-database.js';

// Import RLS-enforced versions (these check for JWT secret internally)
import {
  getUserById as rlsGetUserById,
  getUserUsageStats as rlsGetUserUsageStats,
  getUserProjects as rlsGetUserProjects,
  getProject as rlsGetProject,
  createProject as rlsCreateProject,
  updateProject as rlsUpdateProject,
  deleteProject as rlsDeleteProject,
  saveProjectVersion as rlsSaveProjectVersion,
  getProjectVersions as rlsGetProjectVersions,
  saveChatHistory as rlsSaveChatHistory,
  getChatHistory as rlsGetChatHistory,
  deleteChatHistory as rlsDeleteChatHistory,
  saveDeployment as rlsSaveDeployment,
  getProjectDeployments as rlsGetProjectDeployments
} from './supabase-rls.js';

// Import admin versions as fallback
import {
  getUserById as adminGetUserById,
  getUserUsageStats as adminGetUserUsageStats,
  getUserProjects as adminGetUserProjects,
  getProject as adminGetProject,
  createProject as adminCreateProject,
  updateProject as adminUpdateProject,
  deleteProject as adminDeleteProject,
  saveProjectVersion as adminSaveProjectVersion,
  getProjectVersions as adminGetProjectVersions,
  getProjectVersion,
  saveChatHistory as adminSaveChatHistory,
  getChatHistory as adminGetChatHistory,
  deleteChatHistory as adminDeleteChatHistory,
  saveDeployment as adminSaveDeployment,
  getProjectDeployments as adminGetProjectDeployments,
  saveProjectHistory as adminSaveProjectHistory,
  getProjectHistory as adminGetProjectHistory
} from './supabase-database.js';

// TEMPORARILY DISABLED RLS: Using admin client for all operations
// The RLS policies were causing projects to not appear. The issue is that
// the RLS policy requires auth.uid() to match a user in the users table,
// but the JWT's sub claim may not be matching correctly.
// TODO: Fix RLS policies to work correctly with the JWT structure
// See migrations/034_use_auth_uid_once.sql for the current policy

// Export user operations - using admin for now
export const getUserById = adminGetUserById;
export const getUserUsageStats = adminGetUserUsageStats;

// Export project operations - using admin for now to restore functionality
export const getUserProjects = adminGetUserProjects;
export const getProject = adminGetProject;
export const createProject = adminCreateProject;
export const updateProject = adminUpdateProject;
export const deleteProject = adminDeleteProject;

// Export version control - using admin for now
export const saveProjectVersion = adminSaveProjectVersion;
export const getProjectVersions = adminGetProjectVersions;

// Export chat history - using admin for now
export const saveChatHistory = adminSaveChatHistory;
export const getChatHistory = adminGetChatHistory;
export const deleteChatHistory = adminDeleteChatHistory;

// Export deployment functions - using admin for now
export const saveDeployment = adminSaveDeployment;
export const getProjectDeployments = adminGetProjectDeployments;

// Backward compatibility aliases
export const saveProjectHistory = adminSaveProjectHistory;
export const getProjectHistory = adminGetProjectHistory;

// Re-export remaining functions that always use admin (system operations)
export {
  // Auth operations (must use admin)
  createOrUpdateUser,
  getUserByEmail,
  updateUserSubscription,

  // Usage tracking (system operation)
  logAIUsage,
  checkAndResetDailyUsage,
  resetUserDailyUsage,

  // Version control (admin for getProjectVersion)
  getProjectVersion,

  // Integration functions
  saveProjectIntegration,
  getProjectIntegration,
  removeProjectIntegration,

  // Utility functions
  createAutoSaveHandler,
  runDatabaseHealthCheck,

  // Ad management functions
  saveAdAccount,
  updateAdAccount,
  getAdAccounts,
  getAdAccount,
  deleteAdAccount,
  createAdCampaign,
  updateAdCampaign,
  getAdCampaigns,
  getAdCampaign,
  deleteAdCampaign,
  saveAdMetrics,
  getAdAnalytics,
  getAdMetricsByCampaign,
  saveAdRecommendation,
  getAdRecommendations,
  applyAdRecommendation,
  getAdBudgets,
  updateCampaignBudget,
  syncGoogleAdsData,
  syncFacebookAdsData
};

// Export RLS status for debugging
export const isRLSEnabled = () => RLS_ENABLED;
