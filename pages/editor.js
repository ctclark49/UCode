// pages/editor.js - V214 Production Editor with Spark-AI
// V214: Fixed loading screen to be continuous overlay during AI generation
// - Loading screen now blocks preview during ALL stages (new project, AI generation, subsequent edits)
// - SSE 'ready' event transitions to 'iframe_loading' instead of 'live' (wait for actual iframe load)
// - HMR 'complete' event properly transitions from 'working' to 'live' for subsequent edits
// - Increased HMR fallback timeout from 2s to 8s for initial builds
// V213: Fixed machine claiming for new projects with temporary projectId
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";
import { v4 as uuidv4 } from 'uuid';

// PRODUCTION: Import the unified file store for single source of truth
import {
  useProductionFileStore,
  fileEventBus,
  normalizePath
} from '../lib/stores/ProductionFileStore';

// Session management for persistent preview sessions
import { usePreviewSession, SESSION_UI_STATUS } from '../lib/hooks/usePreviewSession';

// Unified preview context - single source of truth for machine ID state
import { usePreviewContext } from '../lib/hooks/usePreviewContext';

// Auto-save manager for automatic project persistence
import { getAutoSaveManager, AUTO_SAVE_STATUS } from '../lib/auto-save-manager';

// Note: Multi-Agent Orchestrator is used server-side in /api/ai/production-chat
// No client-side import needed - the API handles tier-based model selection

// Dynamic imports with error handling
const FileExplorer = dynamic(() => import("../components/FileExplorer.jsx").catch((err) => {
  console.error('Failed to load FileExplorer:', err);
  return { default: () => <div style={{ padding: '1rem', color: '#666' }}>File Explorer unavailable</div> };
}), { ssr: false });

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then(mod => {
    console.log('[Editor] Monaco Editor loaded successfully');
    return mod;
  }).catch((err) => {
    console.error('[Editor] Monaco Editor failed to load:', err);
    // Return a fallback component that shows the error and retry option
    return {
      default: ({ value, onChange, language }) => (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          color: '#EF4444',
          backgroundColor: '#FEF2F2',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem'
        }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Editor Failed to Load</h3>
          <p style={{ margin: 0, color: '#6B7280', fontSize: '0.9rem', maxWidth: '300px' }}>
            {err?.message || 'Monaco Editor could not be loaded. This may be due to network issues or content security restrictions.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 16px',
              backgroundColor: '#3B82F6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: 500
            }}
          >
            Reload Page
          </button>
          {/* Show raw code as fallback */}
          {value && (
            <pre style={{
              marginTop: '1rem',
              padding: '1rem',
              backgroundColor: '#F9FAFB',
              border: '1px solid #E5E7EB',
              borderRadius: '6px',
              maxHeight: '200px',
              overflow: 'auto',
              textAlign: 'left',
              fontSize: '12px',
              width: '90%'
            }}>
              {value.slice(0, 500)}{value.length > 500 ? '...' : ''}
            </pre>
          )}
        </div>
      )
    };
  }),
  {
    ssr: false,
    loading: () => (
      <div style={{
        padding: '2rem',
        textAlign: 'center',
        color: '#6B7280',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem'
      }}>
        <div style={{
          width: '32px',
          height: '32px',
          border: '3px solid #E5E7EB',
          borderTopColor: '#3B82F6',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <span>Loading editor...</span>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    )
  }
);

const YjsMonacoEditor = dynamic(() => import("../components/YjsMonacoEditorWrapper"), {
  ssr: false,
  loading: () => <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>Loading collaborative editor...</div>
});

const VersionHistory = dynamic(() => import("../components/VersionHistory"), {
  ssr: false,
  loading: () => <div style={{ padding: '1rem', color: '#888' }}>Loading version history...</div>
});

const PreviewErrorBoundary = dynamic(() => import("../components/PreviewErrorBoundary"), {
  ssr: false
});

const StripeIntegration = dynamic(() => import("../components/StripeIntegration").catch(() => {
  return { default: () => <div>Stripe Integration not found</div> };
}), { ssr: false });

const StripeProjectDashboard = dynamic(() => import("../components/StripeProjectDashboard").catch(() => {
  return { default: () => <div>Stripe Dashboard not found</div> };
}), { ssr: false });

const AdsSuite = dynamic(() => import("../components/AdsSuite").catch((err) => {
  console.error('Failed to load AdsSuite:', err);
  return {
    default: ({ onClose }) => (
      <div style={{
        padding: '2rem',
        textAlign: 'center',
        color: '#EF4444',
        backgroundColor: '#FEF2F2',
        borderRadius: '8px',
        margin: '1rem'
      }}>
        <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>Ads Suite Failed to Load</h3>
        <p style={{ margin: '0 0 1rem 0', color: '#6B7280', fontSize: '0.9rem' }}>
          {err?.message || 'Please try refreshing the page.'}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 16px',
              backgroundColor: '#3B82F6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.875rem'
            }}
          >
            Reload
          </button>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                padding: '8px 16px',
                backgroundColor: '#6B7280',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.875rem'
              }}
            >
              Close
            </button>
          )}
        </div>
      </div>
    )
  };
}), {
  ssr: false,
  loading: () => <div style={{ padding: '1rem', textAlign: 'center', color: '#888' }}>Loading Ads Suite...</div>
});

const DeploymentModal = dynamic(() => import("../components/DeploymentModal").catch(() => {
  return { default: () => <div>Deployment Modal not found</div> };
}), { ssr: false });

const OneClickDeploy = dynamic(() => import("../components/OneClickDeploy"), {
  ssr: false,
  loading: () => <div style={{ padding: '1rem', textAlign: 'center', color: '#888' }}>Loading deployment options...</div>
});

const ProductionAIChat = dynamic(() => import("../components/ProductionAIChat").then(mod => {
  console.log('[Editor] ProductionAIChat loaded successfully');
  return mod;
}).catch((err) => {
  console.error('[Editor] ProductionAIChat import failed:', err);
  return { default: () => (
    <div style={{ padding: '2rem', textAlign: 'center', color: '#ff6666', backgroundColor: '#1a0a0a', height: '100%' }}>
      <h3>AI Chat Failed to Load</h3>
      <p>Error: {err?.message || 'Unknown error'}</p>
      <button onClick={() => window.location.reload()} style={{
        padding: '8px 16px', backgroundColor: '#ff4444', color: 'white',
        border: 'none', borderRadius: '4px', cursor: 'pointer', marginTop: '1rem'
      }}>Reload Page</button>
    </div>
  )};
}), { ssr: false });

const APIKeyManager = dynamic(() => import("../components/APIKeyManager"), {
  ssr: false,
  loading: () => <div style={{ padding: '1rem', textAlign: 'center', color: '#888' }}>Loading API Key Manager...</div>
});

const ActivityMonitor = dynamic(() => import("../components/ActivityMonitor").catch(() => {
  return { default: () => <div style={{ padding: '1rem', color: '#888' }}>Activity Monitor unavailable</div> };
}), {
  ssr: false,
  loading: () => <div style={{ padding: '1rem', textAlign: 'center', color: '#888' }}>Loading Activity Monitor...</div>
});


const DatabaseExplorer = dynamic(() => import("../components/DatabaseExplorer").catch(() => {
  return { default: () => <div style={{ padding: '1rem', color: '#888' }}>Database Explorer unavailable</div> };
}), {
  ssr: false,
  loading: () => <div style={{ padding: '1rem', textAlign: 'center', color: '#888' }}>Loading Database Explorer...</div>
});

// ============================================================================
// THEME COLORS - V212 Design System
// ============================================================================
const theme = {
  colors: {
    // Primary cyan/blue - matches v212 screenshot
    primary: '#2DD4BF',
    primaryLight: '#5EEAD4',
    primaryDark: '#14B8A6',

    // Backgrounds
    bgPrimary: '#FAFBFC',
    bgSecondary: '#FFFFFF',
    bgTertiary: '#F0FDFA',
    bgDark: '#1A1D21',

    // Text
    text: '#1A1D21',
    textSecondary: '#6B7280',
    textLight: '#9CA3AF',
    textOnPrimary: '#FFFFFF',

    // Borders
    border: '#E5E7EB',
    borderLight: '#F3F4F6',

    // Status - use cyan for synced status too
    success: '#2DD4BF',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#3B82F6',

    // Special
    coral: '#FF6B6B',
    purple: '#8B5CF6',
  },
  shadows: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
  },
  radius: {
    sm: '6px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    full: '9999px',
  }
};

// ============================================================================
// SVG ICONS
// ============================================================================
const Icons = {
  ArrowLeft: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
  ),
  Folder: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  Code: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6"/>
      <polyline points="8 6 2 12 8 18"/>
    </svg>
  ),
  Eye: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  MessageSquare: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  Settings: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  Send: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
    </svg>
  ),
  Rocket: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
    </svg>
  ),
  Save: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
  ),
  CreditCard: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
      <line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  ),
  Megaphone: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l18-5v12L3 13v-2z"/>
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>
    </svg>
  ),
  Monitor: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
      <line x1="8" y1="21" x2="16" y2="21"/>
      <line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  ),
  Tablet: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2"/>
      <line x1="12" y1="18" x2="12.01" y2="18"/>
    </svg>
  ),
  Smartphone: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
      <line x1="12" y1="18" x2="12.01" y2="18"/>
    </svg>
  ),
  Laptop: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0l1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>
    </svg>
  ),
  RefreshCw: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
  ),
  ExternalLink: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/>
      <line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  ),
  Square: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    </svg>
  ),
  Columns: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7m0-18H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7m0-18v18"/>
    </svg>
  ),
  X: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  Copy: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  ),
  Check: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  Terminal: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5"/>
      <line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
  ),
  Key: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
    </svg>
  ),
  Activity: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  BarChart: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="20" x2="12" y2="10"/>
      <line x1="18" y1="20" x2="18" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="16"/>
    </svg>
  ),
  Clock: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  Users: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  Database: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"/>
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
    </svg>
  ),
  ChevronDown: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
  Stop: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2"/>
    </svg>
  ),
  File: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
      <polyline points="13 2 13 9 20 9"/>
    </svg>
  ),
  FileExport: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="12" y1="18" x2="12" y2="12"/>
      <line x1="9" y1="15" x2="12" y2="12"/>
      <line x1="15" y1="15" x2="12" y2="12"/>
    </svg>
  ),
  FileText: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
  ),
};

// ============================================================================
// EZCODER LOGO COMPONENT - Uses Ezcoder Logo.png
// ============================================================================
const EzcoderLogo = ({ size = 48, pulse = false }) => (
  <div style={{
    width: size,
    height: size,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  }}>
    {/* Pulsing glow ring - centered and scales from center */}
    {pulse && (
      <div style={{
        position: 'absolute',
        width: size,
        height: size,
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(0, 217, 255, 0.4) 0%, rgba(0, 217, 255, 0.2) 40%, transparent 70%)',
        animation: 'pulse-scale 2s ease-out infinite',
      }} />
    )}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img
      src="/Ezcoder Logo.png"
      alt="Spark-AI"
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        position: 'relative',
        zIndex: 1,
      }}
    />
  </div>
);

// ============================================================================
// FLOATING BALLS COMPONENT (Loading Animation) - Cyan/Teal theme
// ============================================================================
const FloatingBalls = () => {
  const balls = [
    { size: 200, x: '5%', y: '55%', color: 'rgba(0, 217, 255, 0.25)', delay: 0 },
    { size: 280, x: '70%', y: '25%', color: 'rgba(0, 217, 255, 0.20)', delay: 1 },
    { size: 180, x: '55%', y: '65%', color: 'rgba(0, 217, 255, 0.18)', delay: 2 },
    { size: 150, x: '20%', y: '20%', color: 'rgba(0, 217, 255, 0.15)', delay: 0.5 },
    { size: 120, x: '85%', y: '70%', color: 'rgba(0, 217, 255, 0.12)', delay: 1.5 },
  ];

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      overflow: 'hidden',
      pointerEvents: 'none',
    }}>
      {balls.map((ball, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            width: ball.size,
            height: ball.size,
            left: ball.x,
            top: ball.y,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${ball.color} 0%, transparent 70%)`,
            filter: 'blur(30px)',
            animation: `float-ball ${8 + i * 2}s ease-in-out infinite`,
            animationDelay: `${ball.delay}s`,
          }}
        />
      ))}
    </div>
  );
};

// ============================================================================
// PREVIEW LOADING SCREEN - Matches Spark-AI screenshots
// ============================================================================
// Status messages for different loading phases - mirrors components/PreviewLoadingScreen.jsx
const LOADING_STATUS_MESSAGES = {
  // New project flow (before AI generates)
  loading_dev: 'Loading preview environment...',
  starting: 'Starting preview environment...',
  installing: 'Installing dependencies...',
  waiting: 'Starting development server...',
  building: 'Syncing files to preview...',
  generating: 'AI is generating your code...',
  ready: 'Ready for your instructions',
  // Existing project flow
  loading_preview: 'Loading preview environment...',
  // Server startup states
  server_starting: 'Starting development server...',
  server_ready: 'Development server ready',
  // Additional states for comprehensive coverage
  syncing: 'Syncing your changes...',
  iframe_loading: 'Rendering preview...'
};

// Sub-messages for context
const LOADING_SUB_MESSAGES = {
  loading_dev: 'Preparing your development environment',
  starting: 'Spinning up a secure container',
  installing: 'This may take a minute for new projects',
  waiting: 'Almost ready...',
  building: 'Preparing your application',
  generating: 'Creating files...',
  ready: 'Describe what you want to build in the chat',
  loading_preview: 'Restoring your project files',
  server_starting: 'npm run dev is starting...',
  server_ready: 'Your app is ready to view',
  syncing: 'Hot reloading your changes',
  iframe_loading: 'Loading your application'
};

const PreviewLoadingScreen = ({ status = 'starting', currentFile = null }) => {
  // Look up messages using status as key, with fallback to 'starting'
  const mainMessage = LOADING_STATUS_MESSAGES[status] || LOADING_STATUS_MESSAGES.starting;
  const subMessage = currentFile || LOADING_SUB_MESSAGES[status] || LOADING_SUB_MESSAGES.starting;

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(180deg, #FAFBFC 0%, #F0FDFA 100%)',
      zIndex: 10,
    }}>
      <FloatingBalls />
      <div style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <EzcoderLogo size={80} pulse={true} />
        </div>
        <h2 style={{
          marginTop: 28,
          fontSize: 20,
          fontWeight: 600,
          color: '#1A1D21',
          letterSpacing: '-0.02em',
          textAlign: 'center',
        }}>
          {mainMessage}
        </h2>
        <p style={{
          marginTop: 10,
          fontSize: 14,
          color: '#6B7280',
          fontWeight: 400,
          textAlign: 'center',
          maxWidth: 280,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {subMessage}
        </p>
      </div>
    </div>
  );
};

// ============================================================================
// MAIN EDITOR COMPONENT
// ============================================================================
export default function EditorPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  // CRITICAL: Wait for router to be ready before accessing query params
  // This prevents the "projectId required" error caused by undefined query during SSR/hydration
  const isRouterReady = router.isReady;
  const { projectId: rawProjectId, initialPrompt: rawInitialPrompt } = isRouterReady ? router.query : {};

  // Ensure projectId is a valid string (not empty, not "undefined", not "null")
  const projectId = useMemo(() => {
    if (!rawProjectId) return null;
    const id = Array.isArray(rawProjectId) ? rawProjectId[0] : rawProjectId;
    // Guard against invalid string values
    if (!id || id === 'undefined' || id === 'null' || id.trim() === '') {
      return null;
    }
    return id;
  }, [rawProjectId]);

  // ========== TEMPORARY PROJECT ID FOR NEW PROJECTS ==========
  // Industry Best Practice: Generate a stable temporary ID for new projects
  // This allows machine claiming before the project is saved to the database.
  // The temp ID persists in sessionStorage to survive page refresh during the session.
  const [tempProjectId] = useState(() => {
    // SSR guard
    if (typeof window === 'undefined') return null;

    // If we have a real projectId from URL, don't need temp ID
    const urlParams = new URLSearchParams(window.location.search);
    const existingId = urlParams.get('projectId');
    if (existingId && existingId !== 'undefined' && existingId !== 'null') {
      return null;
    }

    // Check sessionStorage for existing temp ID (survives page refresh within session)
    const storedTempId = sessionStorage.getItem('ezcoder_temp_project_id');
    if (storedTempId) {
      console.log('[Editor] Using stored temp projectId:', storedTempId);
      return storedTempId;
    }

    // Generate new temp ID with prefix for easy identification
    const newTempId = `temp_${uuidv4()}`;
    sessionStorage.setItem('ezcoder_temp_project_id', newTempId);
    console.log('[Editor] Generated new temp projectId:', newTempId);
    return newTempId;
  });

  // Effective projectId: prioritize URL param > saved project > temp ID
  // This ensures we always have a projectId for machine claiming
  const effectiveProjectId = useMemo(() => {
    const effective = projectId || tempProjectId;
    return effective;
  }, [projectId, tempProjectId]);

  // Clean up temp ID when project is saved (called from handleSaveProject)
  const clearTempProjectId = useCallback(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('ezcoder_temp_project_id');
      console.log('[Editor] Cleared temp projectId after save');
    }
  }, []);

  // Decode the initial prompt from URL - it's URL-encoded when passed from index page
  const initialPrompt = useMemo(() => {
    if (!rawInitialPrompt || !isRouterReady) return null;
    try {
      const prompt = Array.isArray(rawInitialPrompt) ? rawInitialPrompt[0] : rawInitialPrompt;
      return decodeURIComponent(prompt);
    } catch (e) {
      console.warn('[Editor] Failed to decode initialPrompt:', e);
      return rawInitialPrompt; // Return as-is if decode fails
    }
  }, [rawInitialPrompt, isRouterReady]);

  // ========== PRODUCTION FILE STORE - Single Source of Truth ==========
  const storeFiles = useProductionFileStore(state => state.files);
  const activeFile = useProductionFileStore(state => state.activeFile);
  const setFile = useProductionFileStore(state => state.setFile);
  const setStoreFiles = useProductionFileStore(state => state.setFiles);
  const setActiveFile = useProductionFileStore(state => state.setActiveFile);
  const deleteStoreFile = useProductionFileStore(state => state.deleteFile);
  const e2bConnected = useProductionFileStore(state => state.e2bConnected);

  // ========== DERIVE FILES FROM STORE (MUST BE BEFORE usePreviewSession) ==========
  // INDUSTRY BEST PRACTICE: Define derived state BEFORE hooks that depend on it
  // This prevents the "used before defined" React hooks ordering violation
  const files = useMemo(() => {
    const result = {};
    for (const [path, entry] of Object.entries(storeFiles || {})) {
      result[path] = entry?.content ?? '';
    }
    return result;
  }, [storeFiles]);

  // Helper to update files in store
  const setFiles = useCallback((newFilesOrUpdater) => {
    if (typeof newFilesOrUpdater === 'function') {
      const currentFiles = {};
      for (const [path, entry] of Object.entries(storeFiles || {})) {
        currentFiles[path] = entry?.content ?? '';
      }
      const updated = newFilesOrUpdater(currentFiles);
      setStoreFiles(updated, 'editor');
    } else {
      setStoreFiles(newFilesOrUpdater, 'editor');
    }
  }, [storeFiles, setStoreFiles]);

  // ========== STATE ==========
  // Panel visibility
  const [showFiles, setShowFiles] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [showAIChat, setShowAIChat] = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showDatabaseModal, setShowDatabaseModal] = useState(false);

  // Project state (metadata only - files live in ProductionFileStore)
  const [currentProject, setCurrentProject] = useState(null);
  const [openTabs, setOpenTabs] = useState([]);
  const [activeTab, setActiveTab] = useState('');
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState(AUTO_SAVE_STATUS.IDLE);
  const [projectLoading, setProjectLoading] = useState(true);
  const [processedInitialPrompt, setProcessedInitialPrompt] = useState(false);

  // Project name editing state
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [editingProjectName, setEditingProjectName] = useState('');

  // ========== UNIFIED PREVIEW CONTEXT - Single Source of Truth ==========
  // Consolidates machine ID tracking (was in 3 places: ref, state, session)
  const previewContext = usePreviewContext();

  // Preview state (now managed by usePreviewSession hook + previewContext)
  const [previewUrl, setPreviewUrl] = useState(null);
  // DEPRECATED: previewContainerId state - use previewContext.machineId instead
  // Kept for backward compatibility during migration
  const [previewContainerId, setPreviewContainerId] = useState(null);
  const [previewSubdomain, setPreviewSubdomain] = useState(null); // e.g., "abc123.fly.dev"
  const [previewStatus, setPreviewStatus] = useState('loading'); // 'loading' | 'ready' | 'working' | 'live'
  const [previewSubStatus, setPreviewSubStatus] = useState('Loading preview environment...');
  const [syncStatus, setSyncStatus] = useState('synced'); // 'synced' | 'syncing' | 'error' | 'queued'
  const [deviceView, setDeviceView] = useState('desktop');
  const [previewPath, setPreviewPath] = useState('/'); // v77: Track current SPA route for navigation handling

  // Device viewport dimensions for preview
  const DEVICE_VIEWPORTS = {
    'desktop': { width: '100%', height: '100%', label: 'Desktop' },
    'laptop': { width: '1280px', height: '800px', label: 'Laptop' },
    'tablet-portrait': { width: '768px', height: '1024px', label: 'Tablet' },
    'mobile': { width: '375px', height: '667px', label: 'Mobile' },
  };

  const currentViewport = DEVICE_VIEWPORTS[deviceView] || DEVICE_VIEWPORTS['desktop'];
  const [iframeLoaded, setIframeLoaded] = useState(false); // Track if iframe content has loaded
  const [screenshotCaptured, setScreenshotCaptured] = useState(false); // Track if project thumbnail was captured
  const screenshotInProgressRef = useRef(false); // Prevent duplicate screenshot captures
  // v76: Post-generation screenshot capture state
  const [awaitingPostGenScreenshot, setAwaitingPostGenScreenshot] = useState(false);
  const generationCompleteTimestampRef = useRef(null);

  // INDUSTRY BEST PRACTICE: Lazy state initialization with SSR guard
  // Option 4 (Hybrid Approach): Optimistic URL-based detection + content verification
  // Step 1: If URL has projectId, assume existing project (will verify in loadProject)
  // Step 2: Content verification in loadProject confirms by checking skeleton markers
  const [isNewProject, setIsNewProject] = useState(() => {
    // SSR guard: window not available during server-side rendering
    if (typeof window === 'undefined') {
      return true; // Safe default for SSR
    }
    // Check URL for projectId - if present, optimistically assume existing project
    const urlParams = new URLSearchParams(window.location.search);
    const hasProjectId = !!urlParams.get('projectId');
    console.log('[Editor] isNewProject init:', { hasProjectId, isNew: !hasProjectId });
    return !hasProjectId; // No projectId = new project, has projectId = existing (verify later)
  })

  // v78: Track whether AI has generated any content for this project
  // This is CRITICAL for loading screen logic - we must NOT show the skeleton "Ready to Build"
  // until AI has actually generated user's app. Different from isNewProject because:
  // - isNewProject: whether project was just created (no projectId in URL)
  // - hasAIGeneratedContent: whether AI has generated any code beyond skeleton
  // For new projects: starts false, becomes true when AI generation completes
  // For existing projects: starts true (already has content)
  const [hasAIGeneratedContent, setHasAIGeneratedContent] = useState(() => {
    if (typeof window === 'undefined') return false;
    const urlParams = new URLSearchParams(window.location.search);
    const hasProjectId = !!urlParams.get('projectId');
    // Existing projects have content, new projects don't
    return hasProjectId;
  })

  // DEPRECATED: previewContainerIdRef - now handled by previewContext
  // Kept for backward compatibility during migration to previewContext
  // The previewContext.getMachineId() provides synchronous access
  const previewContainerIdRef = useRef(null);

  // Track last file change timestamp for sync stabilization
  // Used to ensure file store is stable before syncing after AI generation
  const lastFileChangeRef = useRef(Date.now());

  // AI state - connected to ProductionAIChat events
  const [isAIWorking, setIsAIWorking] = useState(false);

  // ========== SESSION MANAGEMENT HOOK ==========
  // Persistent preview sessions with reconnect logic, heartbeat, and background generation
  // INDUSTRY BEST PRACTICE: Only initialize session when router is ready to prevent SSR/hydration errors
  // V213 FIX: Use effectiveProjectId to enable machine claiming for new projects (with temp ID)
  const previewSession = usePreviewSession({
    projectId: isRouterReady ? (projectId || currentProject?.id || effectiveProjectId) : null,
    userId: session?.user?.id,
    initialFiles: files,
    enabled: isRouterReady && !!session?.user?.id && !!(projectId || currentProject?.id || effectiveProjectId), // Guard: only start when we have a projectId
    onSessionResumed: useCallback((resumedSession) => {
      console.log('[Editor] Session resumed:', resumedSession.id);
      setPreviewSubStatus('Session resumed - ready to continue');
    }, []),
    onMachineReady: useCallback((url, machineId) => {
      console.log('[Editor] Machine ready:', { url, machineId });

      // UNIFIED: Use previewContext for single source of truth
      previewContext.setMachine(machineId, url);

      // BACKWARD COMPAT: Also set legacy ref/state during migration
      previewContainerIdRef.current = machineId;
      setPreviewContainerId(machineId);

      // ARCHITECTURE FIX (v70):
      // Always use SUBDOMAIN URL for iframe and SSE connections.
      // This ensures proper CORS, HMR WebSocket routing, and SSE connections.
      // The proxy path format (/api/preview/m/{machineId}) is only for internal API calls.
      //
      // Why subdomain URL:
      // 1. SSE EventSource needs full URL to parse origin (new URL() fails on relative paths)
      // 2. HMR WebSocket needs the subdomain for fly-replay routing
      // 3. Browser security (CORS) works better with direct origin
      // 4. Cache-busting with query params works correctly
      //
      // Build subdomain URL from projectId (from context, not machineId)
      const projId = projectId || currentProject?.id;
      const safeProjectId = projId?.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase() || 'unknown';
      const previewDomain = 'preview.ezcoder.dev';

      // Check if url is already a valid subdomain URL
      let subdomainUrl;
      if (url && url.includes('preview.ezcoder.dev')) {
        subdomainUrl = url;
        console.log('[Editor] Using provided subdomain URL:', subdomainUrl);
      } else {
        // Build subdomain URL
        subdomainUrl = `https://preview-${safeProjectId}.${previewDomain}`;
        console.log('[Editor] Built subdomain URL:', subdomainUrl);
      }

      // Cache-busting: Append machine ID prefix to force browser to fetch fresh content
      const machinePrefix = machineId?.slice(0, 8) || 'unknown';
      const baseUrl = subdomainUrl.replace(/\/$/, '');
      const normalizedUrl = `${baseUrl}?m=${machinePrefix}`;

      // Extract display-only subdomain for UI (first 8 chars of machine ID)
      if (machineId) {
        setPreviewSubdomain(machineId.slice(0, 8));
      }

      // Set preview URL to subdomain URL (not proxy path!)
      setPreviewUrl(normalizedUrl);
      console.log('[Editor] Preview URL set to:', normalizedUrl);

      setIframeLoaded(false); // Reset iframe loaded state when URL changes
      // Don't set 'ready' here - wait for pollPreviewReady to confirm server is running
      // This prevents showing iframe before dev server is actually ready
      setPreviewStatus('loading');
      setPreviewSubStatus('Starting development server...');

      // Set cookie for middleware rewriting (uses machineId for routing)
      if (machineId) {
        document.cookie = `preview-machine-id=${machineId}; path=/; SameSite=Lax; max-age=86400`;
      }
    }, [projectId, currentProject]),
    onGenerationProgress: useCallback((progress) => {
      console.log('[Editor] Generation progress:', progress);
      setPreviewStatus('working');
      const percentComplete = progress.totalFiles > 0
        ? Math.round((progress.completedFiles / progress.totalFiles) * 100)
        : 0;
      setPreviewSubStatus(
        progress.currentFile
          ? `Generating ${progress.currentFile}... (${percentComplete}%)`
          : `Generating... (${percentComplete}%)`
      );
    }, []),
    onGenerationComplete: useCallback((result) => {
      console.log('[Editor] v78: Generation complete:', result);
      setIsNewProject(false); // AI has generated content, no longer a new project
      setHasAIGeneratedContent(true); // v78: Mark that AI has generated content
      setIframeLoaded(false); // Reset so we wait for fresh content to load
      // Don't immediately set 'live' - let the iframe onLoad handler do that
      // This ensures content is actually rendered before hiding loading screen
      setPreviewStatus('loading');
      setPreviewSubStatus('Syncing files to preview...');
    }, []),
    onFilesGenerated: useCallback((newFiles) => {
      console.log('[Editor] Files generated:', Object.keys(newFiles));
      // Merge new files into store
      setStoreFiles(prev => ({ ...prev, ...newFiles }), 'ai-generation');
    }, [setStoreFiles]),
    onError: useCallback((error) => {
      console.error('[Editor] Session error:', error);
      setPreviewSubStatus(`Error: ${error.message}`);
    }, []),
  });

  // Sync preview session state to local state for existing components
  // FIX: Don't overwrite 'live' or 'iframe_loading' status - these indicate
  // claimPreviewMachine succeeded and the preview is already working.
  // The session hook can lag behind, causing a race condition where it
  // reports CONNECTING after we've already transitioned to 'live'.
  useEffect(() => {
    if (previewSession.status === SESSION_UI_STATUS.CONNECTING) {
      setPreviewStatus(prev => {
        // Don't reset if already live or loading iframe - preview is working
        if (prev === 'live' || prev === 'iframe_loading') {
          console.log('[Editor] Ignoring CONNECTING status - preview already', prev);
          return prev;
        }
        setPreviewSubStatus('Connecting to session...');
        return 'loading';
      });
    } else if (previewSession.status === SESSION_UI_STATUS.RECONNECTING) {
      setPreviewStatus(prev => {
        // Don't reset if already live - just update substatus
        if (prev === 'live' || prev === 'iframe_loading') {
          console.log('[Editor] Ignoring RECONNECTING status - preview already', prev);
          return prev;
        }
        setPreviewSubStatus('Reconnecting to session...');
        return 'loading';
      });
    } else if (previewSession.status === SESSION_UI_STATUS.ERROR) {
      setPreviewSubStatus(`Session error: ${previewSession.error || 'Unknown error'}`);
    }
  }, [previewSession.status, previewSession.error]);

  // Terminal state
  const [terminalOutput, setTerminalOutput] = useState([
    { type: 'system', text: 'EzCoder Preview Terminal' },
    { type: 'system', text: 'Type commands to execute in the preview environment.' },
  ]);
  const [terminalInput, setTerminalInput] = useState('');
  const [consoleOutput, setConsoleOutput] = useState([]);

  // Other state
  const [saveLoading, setSaveLoading] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [showStripeModal, setShowStripeModal] = useState(false);
  const [showAdsModal, setShowAdsModal] = useState(false);
  const [collaborativeMode, setCollaborativeMode] = useState(false);

  // Tool modal states
  const [showApiKeysModal, setShowApiKeysModal] = useState(false);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Refs
  const terminalRef = useRef(null);
  const toolsMenuRef = useRef(null);

  // ========== EFFECTS ==========

  // Close tools menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target)) {
        setShowToolsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ========== SSE CONNECTION FOR PREVIEW STATUS (v77) ==========
  // Real-time connection to preview daemon for instant status updates.
  // Runs independently of console panel - always active when preview is connected.
  // Listens to: ready, hmr-complete, error, server-log events
  const [sseConnectionState, setSseConnectionState] = useState('disconnected'); // 'disconnected' | 'connecting' | 'connected' | 'error'
  const sseEventSourceRef = useRef(null);
  const sseReconnectTimerRef = useRef(null);
  const previewIframeRef = useRef(null); // v77: Ref to iframe for sending navigation commands
  const sseReconnectAttemptsRef = useRef(0);
  const SSE_MAX_RECONNECT_ATTEMPTS = 5;
  const SSE_RECONNECT_BASE_DELAY = 2000;

  // SSE connection effect - runs whenever we have a preview URL
  useEffect(() => {
    if (!previewUrl) {
      setSseConnectionState('disconnected');
      return;
    }

    const machineId = previewContainerIdRef.current || previewContainerId;
    if (!machineId) return;

    const connectSSE = () => {
      // Clean up existing connection
      if (sseEventSourceRef.current) {
        sseEventSourceRef.current.close();
        sseEventSourceRef.current = null;
      }

      setSseConnectionState('connecting');
      console.log('[Editor] v77: Connecting to daemon SSE:', previewUrl);

      try {
        const eventSource = new EventSource(`${previewUrl}/_daemon/events`);
        sseEventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          console.log('[Editor] v77: SSE connected');
          setSseConnectionState('connected');
          sseReconnectAttemptsRef.current = 0; // Reset attempts on success
        };

        // Handle 'ready' event - daemon/dev server is ready
        // v78: Don't auto-set iframeLoaded - wait for actual iframe onLoad event
        eventSource.addEventListener('ready', (e) => {
          try {
            const data = JSON.parse(e.data);
            console.log('[Editor] v78: Received ready event:', data);

            // Transition to iframe_loading, NOT live
            // The actual iframe onLoad event will transition to 'live'
            setPreviewStatus(prev => {
              if (prev === 'loading') {
                setPreviewSubStatus('Rendering preview...');
                return 'iframe_loading';
              }
              // If already iframe_loading or live, don't change
              return prev;
            });
          } catch (err) {
            console.warn('[Editor] v78: Failed to parse ready event:', err);
          }
        });

        // Handle 'hmr-complete' event - HMR update finished
        // v78: This is the key transition for subsequent edits - when HMR completes,
        // transition from 'working' to 'live' to hide loading screen and show new content
        eventSource.addEventListener('hmr-complete', (e) => {
          try {
            const data = JSON.parse(e.data);
            console.log('[Editor] v78: HMR complete:', data);

            // Mark sync as complete
            setSyncStatus('synced');

            // Transition to live - this hides the loading screen after AI generation + HMR
            setPreviewStatus(prev => {
              if (prev === 'iframe_loading' || prev === 'working') {
                console.log('[Editor] v78: HMR complete, transitioning from', prev, 'to live');
                setIframeLoaded(true);
                return 'live';
              }
              return prev;
            });
          } catch (err) {
            console.warn('[Editor] v78: Failed to parse hmr-complete event:', err);
          }
        });

        // Handle 'error' event - daemon detected an error
        eventSource.addEventListener('error', (e) => {
          try {
            const data = JSON.parse(e.data);
            console.error('[Editor] v77: Daemon error:', data);

            // Show error in console
            setConsoleOutput(prev => {
              const errorLog = {
                id: `daemon-error-${Date.now()}`,
                type: 'EZCODER_CONSOLE_LOG',
                method: 'error',
                args: [data.error || data.message || 'Unknown daemon error'],
                timestamp: Date.now()
              };
              return [...prev.slice(-MAX_CONSOLE_LOGS + 1), errorLog];
            });
          } catch (err) {
            // SSE connection error, not a JSON error event
            console.warn('[Editor] v77: SSE error event:', err);
          }
        });

        // Handle 'screenshot-captured' event (v76)
        eventSource.addEventListener('screenshot-captured', (e) => {
          try {
            const data = JSON.parse(e.data);
            console.log('[Editor] v77: Screenshot captured:', data);
            if (data.success) {
              setScreenshotCaptured(true);
            }
          } catch (err) {
            console.warn('[Editor] v77: Failed to parse screenshot event:', err);
          }
        });

        // Handle connection errors
        eventSource.onerror = (err) => {
          console.warn('[Editor] v77: SSE connection error');
          setSseConnectionState('error');
          eventSource.close();
          sseEventSourceRef.current = null;

          // Attempt reconnection with exponential backoff
          if (sseReconnectAttemptsRef.current < SSE_MAX_RECONNECT_ATTEMPTS) {
            const delay = SSE_RECONNECT_BASE_DELAY * Math.pow(2, sseReconnectAttemptsRef.current);
            console.log(`[Editor] v77: Reconnecting in ${delay}ms (attempt ${sseReconnectAttemptsRef.current + 1}/${SSE_MAX_RECONNECT_ATTEMPTS})`);

            sseReconnectTimerRef.current = setTimeout(() => {
              sseReconnectAttemptsRef.current++;
              connectSSE();
            }, delay);
          } else {
            console.warn('[Editor] v77: Max SSE reconnect attempts reached, attempting failover');
            setSseConnectionState('disconnected');

            // v77: Trigger automatic failover when SSE connection is completely lost
            // This means the machine is likely dead
            attemptMachineFailover();
          }
        };
      } catch (err) {
        console.error('[Editor] v77: Failed to create SSE connection:', err);
        setSseConnectionState('error');
      }
    };

    connectSSE();

    return () => {
      if (sseReconnectTimerRef.current) {
        clearTimeout(sseReconnectTimerRef.current);
        sseReconnectTimerRef.current = null;
      }
      if (sseEventSourceRef.current) {
        sseEventSourceRef.current.close();
        sseEventSourceRef.current = null;
      }
    };
  }, [previewUrl, previewContainerId]);

  // ========== CONSOLE LOG RELAY (v73) ==========
  // Captures browser console.log/error/warn from preview iframe via postMessage
  // and server logs from daemon via SSE. Displays unified in Console tab.
  const MAX_CONSOLE_LOGS = 500;
  const consoleRef = useRef(null);
  const lastServerLogIdRef = useRef(0);

  // Handle browser console logs from preview iframe (postMessage)
  useEffect(() => {
    const machineId = previewContainerIdRef.current || previewContainerId;
    if (!machineId) return;

    const handler = (event) => {
      // Only handle EZCODER_CONSOLE_LOG messages
      if (event.data?.type !== 'EZCODER_CONSOLE_LOG') return;

      // SECURITY: Validate machineId matches our claimed machine
      if (event.data.machineId !== machineId) {
        console.warn('[Editor] Rejected console log from unexpected machine:', event.data.machineId);
        return;
      }

      setConsoleOutput(prev => {
        const entry = {
          ...event.data,
          id: `browser-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`
        };
        const updated = [...prev, entry];
        return updated.length > MAX_CONSOLE_LOGS ? updated.slice(-MAX_CONSOLE_LOGS) : updated;
      });
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [previewContainerId]);

  // Handle server logs from daemon via SSE
  useEffect(() => {
    if (!previewUrl || !showConsole) return;

    const machineId = previewContainerIdRef.current || previewContainerId;
    if (!machineId) return;

    // Fetch buffered logs on connect (for reconnection recovery)
    const fetchBufferedLogs = async () => {
      try {
        const resp = await fetch(`${previewUrl}/_daemon/logs?count=100&afterId=${lastServerLogIdRef.current}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.logs?.length && data.machineId === machineId) {
            setConsoleOutput(prev => {
              const serverLogs = data.logs.map(l => ({
                ...l,
                id: `server-${l.id}`,
                type: 'EZCODER_CONSOLE_LOG',
                method: l.stream === 'stderr' ? 'error' : 'log'
              }));
              // Merge, avoiding duplicates
              const existingIds = new Set(prev.map(p => p.id));
              const newLogs = serverLogs.filter(l => !existingIds.has(l.id));
              const updated = [...prev, ...newLogs];
              return updated.length > MAX_CONSOLE_LOGS ? updated.slice(-MAX_CONSOLE_LOGS) : updated;
            });
            lastServerLogIdRef.current = data.lastId;
          }
        }
      } catch (err) {
        console.warn('[Editor] Failed to fetch buffered logs:', err);
      }
    };

    fetchBufferedLogs();

    // SSE for live server logs
    let eventSource;
    try {
      eventSource = new EventSource(`${previewUrl}/_daemon/events`);

      eventSource.addEventListener('server-log', (e) => {
        try {
          const entry = JSON.parse(e.data);
          // Validate machineId
          if (entry.machineId !== machineId) return;

          lastServerLogIdRef.current = Math.max(lastServerLogIdRef.current, entry.id);

          setConsoleOutput(prev => {
            const log = {
              ...entry,
              id: `server-${entry.id}`,
              type: 'EZCODER_CONSOLE_LOG',
              method: entry.stream === 'stderr' ? 'error' : 'log',
              args: [entry.content]
            };
            const updated = [...prev, log];
            return updated.length > MAX_CONSOLE_LOGS ? updated.slice(-MAX_CONSOLE_LOGS) : updated;
          });
        } catch (err) {
          console.warn('[Editor] SSE parse error:', err);
        }
      });

      eventSource.onerror = () => {
        console.warn('[Editor] SSE connection error, will auto-reconnect');
      };
    } catch (err) {
      console.warn('[Editor] Failed to create SSE connection:', err);
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [previewUrl, showConsole, previewContainerId]);

  // Auto-scroll console to bottom when new logs arrive
  useEffect(() => {
    if (consoleRef.current && showConsole) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [consoleOutput, showConsole]);

  // ========== SPA NAVIGATION HANDLING (v77) ==========
  // Receives route change notifications from preview iframe via postMessage.
  // This allows displaying the current SPA path and enables "Go to URL" feature.
  useEffect(() => {
    const machineId = previewContainerIdRef.current || previewContainerId;
    if (!machineId) return;

    const handler = (event) => {
      // Only handle EZCODER_NAVIGATION messages
      if (event.data?.type !== 'EZCODER_NAVIGATION') return;

      // SECURITY: Validate machineId matches our claimed machine
      if (event.data.machineId !== machineId) {
        return;
      }

      const newPath = event.data.url;
      console.log('[Editor] v77: SPA navigation:', event.data.method, newPath);
      setPreviewPath(newPath);
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [previewContainerId]);

  // v77: Navigate to a specific path within the SPA preview
  const navigateToPreviewPath = (path) => {
    if (!previewIframeRef.current?.contentWindow) {
      console.warn('[Editor] v77: Cannot navigate - iframe not available');
      return;
    }

    // Send navigation command to preview iframe
    previewIframeRef.current.contentWindow.postMessage({
      type: 'EZCODER_NAVIGATE_TO',
      url: path
    }, '*');
  };

  // ========== PROJECT INITIALIZATION (Industry Best Practices) ==========
  // Pattern: "Eager Resource Creation" - Create projectId immediately on page load
  // Used by: Google Docs, Notion, Figma, Linear
  // Benefits: Zero timing issues, shareable URLs, simpler component logic

  // Ref to prevent race conditions during project creation
  const projectCreationInProgress = useRef(false);
  const abortControllerRef = useRef(null);

  /**
   * Create a new project immediately when page loads without one.
   * This ensures projectId is ALWAYS available before any AI interaction.
   *
   * Best Practices Applied:
   * 1. Race condition prevention with ref guard
   * 2. Abort controller for cleanup on unmount
   * 3. Retry with exponential backoff for network failures
   * 4. Proper error categorization and user feedback
   * 5. URL state synchronization with history API
   */
  const ensureProject = useCallback(async () => {
    // Guard: Prevent duplicate creation calls (race condition)
    if (projectCreationInProgress.current) {
      console.log('[Editor] Project creation already in progress, skipping');
      return null;
    }

    if (!session?.user) {
      console.log('[Editor] No session, cannot create project');
      return null;
    }

    // Set guard and create abort controller
    projectCreationInProgress.current = true;
    abortControllerRef.current = new AbortController();

    try {
      console.log('[Editor] Creating new project (eager initialization)');
      setPreviewSubStatus('Setting up your workspace...');

      // Generate project name - use "New Project" as a clear placeholder
      // This helps users understand this is an auto-created workspace
      const projectName = `New Project ${new Date().toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })}`;

      // Retry logic with exponential backoff (industry standard for network calls)
      const maxRetries = 3;
      let lastError = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: projectName,
              prompt: initialPrompt || undefined
            }),
            signal: abortControllerRef.current.signal,
          });

          // Handle specific error codes
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));

            // Project limit reached - non-retryable, redirect to billing
            if (errorData.code === 'PROJECT_LIMIT_REACHED') {
              console.warn('[Editor] Project limit reached:', errorData);
              setPreviewSubStatus('Project limit reached');
              // Redirect to billing after short delay for UX
              setTimeout(() => router.push('/billing?reason=project_limit'), 1500);
              return null;
            }

            // Auth error - non-retryable
            if (response.status === 401 || response.status === 403) {
              console.error('[Editor] Auth error creating project');
              setPreviewSubStatus('Authentication required');
              return null;
            }

            // Server error - retryable
            if (response.status >= 500) {
              throw new Error(`Server error: ${response.status}`);
            }

            // Other client errors - non-retryable
            throw new Error(errorData.error || `Request failed: ${response.status}`);
          }

          const data = await response.json();
          const newProject = data.project;

          console.log('[Editor] Project created successfully:', newProject.id);

          // Update application state
          setCurrentProject(newProject);
          const projectFiles = newProject.files || {};
          setFiles(projectFiles);

          // INDUSTRY BEST PRACTICE: Auto-open first file for new projects
          const filePaths = Object.keys(projectFiles);
          if (filePaths.length > 0) {
            const priorityFiles = [
              'src/App.tsx', 'src/App.jsx', 'src/App.js',
              'src/index.tsx', 'src/index.jsx', 'src/index.js',
              'index.html', 'package.json'
            ];
            const fileToOpen = priorityFiles.find(f => filePaths.includes(f)) || filePaths[0];
            console.log('[Editor] Auto-opening file for new project:', fileToOpen);
            setOpenTabs([fileToOpen]);
            setActiveTab(fileToOpen);
          }

          // Sync URL state (shallow update, no history entry)
          // This makes the URL immediately shareable
          const newUrl = `/editor?projectId=${newProject.id}${
            initialPrompt ? `&initialPrompt=${encodeURIComponent(initialPrompt)}` : ''
          }`;
          router.replace(newUrl, undefined, { shallow: true });

          // V213 FIX: Clear temp projectId now that we have a real one
          clearTempProjectId();

          return newProject;

        } catch (error) {
          lastError = error;

          // Don't retry if aborted
          if (error.name === 'AbortError') {
            console.log('[Editor] Project creation aborted');
            return null;
          }

          // Exponential backoff: 1s, 2s, 4s
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt - 1) * 1000;
            console.warn(`[Editor] Retry ${attempt}/${maxRetries} after ${delay}ms:`, error.message);
            setPreviewSubStatus(`Retrying... (${attempt}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      // All retries exhausted
      console.error('[Editor] Failed to create project after retries:', lastError);
      setPreviewSubStatus('Failed to create project. Please refresh.');
      return null;

    } finally {
      // Always reset guard
      projectCreationInProgress.current = false;
    }
  }, [session?.user, initialPrompt, router, setFiles]);

  // Cleanup abort controller and preview cookie on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      // Clear preview machine cookie so middleware doesn't rewrite
      // Vite paths when no preview is active
      document.cookie = 'preview-machine-id=; path=/; max-age=0';
    };
  }, []);

  // CRITICAL: Unregister Service Worker to fix preview white screen
  // The SW was designed for WebContainer-based preview (browser bundling) but we use
  // real Fly.io machines with Vite. The SW intercepts /node_modules/ requests and tries
  // to resolve them from CDNs, which fails due to CSP and breaks Vite.
  // By unregistering, module requests go to the server where middleware routes them correctly.
  useEffect(() => {
    const unregisterServiceWorker = async () => {
      if ('serviceWorker' in navigator) {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const registration of registrations) {
            await registration.unregister();
            console.log('[Editor] Unregistered Service Worker to fix preview module loading');
          }
        } catch (err) {
          console.warn('[Editor] Failed to unregister Service Worker:', err);
        }
      }
    };
    unregisterServiceWorker();
  }, []);

  /**
   * Main initialization effect - handles both new and existing projects
   *
   * Flow:
   * 1. Wait for router and auth to be ready
   * 2. If no projectId → create one immediately (eager initialization)
   * 3. If projectId exists → load existing project
   * 4. Claim preview machine in either case
   *
   * CRITICAL FIX: Don't include ensureProject in dependencies!
   * ensureProject depends on setFiles, which can change when AI writes files.
   * This was causing the effect to re-run mid-generation, reloading the project
   * from the database (with stale/empty files) and aborting the stream.
   */
  const projectInitializedRef = useRef(false);
  const lastLoadedProjectIdRef = useRef(null);
  const projectLoadingInProgressRef = useRef(false);

  useEffect(() => {
    // Wait for dependencies to be ready
    if (!isRouterReady || authStatus === 'loading') return;

    // Not authenticated - let auth system handle redirect
    if (!session?.user) {
      setProjectLoading(false);
      return;
    }

    // EAGER PROJECT CREATION: No projectId in URL → create one NOW
    // This is the key insight - projectId must exist before any user interaction
    if (!projectId) {
      // Prevent duplicate project creation
      if (projectInitializedRef.current) {
        console.log('[Editor] Project creation already in progress, skipping');
        return;
      }
      projectInitializedRef.current = true;

      console.log('[Editor] No projectId in URL - initializing new project');

      ensureProject().then((project) => {
        if (project) {
          // Success: claim preview machine with new project's files
          claimPreviewMachine(project.id, project.files || {});
          lastLoadedProjectIdRef.current = project.id;
        }
        setProjectLoading(false);
      });
      return;
    }

    // EXISTING PROJECT: Load from database, THEN claim machine with loaded files
    // GUARD: Don't reload the same project multiple times (check SYNCHRONOUSLY)
    if (lastLoadedProjectIdRef.current === projectId) {
      console.log('[Editor] Project already loaded, skipping duplicate load:', projectId);
      return;
    }

    // GUARD: Don't start loading if already loading (prevents race conditions)
    if (projectLoadingInProgressRef.current) {
      console.log('[Editor] Project load already in progress, skipping:', projectId);
      return;
    }

    // Set guards SYNCHRONOUSLY before any async work
    lastLoadedProjectIdRef.current = projectId;
    projectLoadingInProgressRef.current = true;

    // CRITICAL: Must await loadProject so files are available for the initial sync.
    // Without this, claimPreviewMachine sends files: {} and sync is skipped entirely.
    console.log('[Editor] Loading existing project:', projectId);
    loadProject(projectId).then((loadedFiles) => {
      claimPreviewMachine(projectId, loadedFiles);
    }).finally(() => {
      projectLoadingInProgressRef.current = false;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ensureProject intentionally excluded to prevent re-runs during AI generation
  }, [projectId, session?.user, authStatus, isRouterReady]);

  // Listen to AI processing events from ProductionAIChat via fileEventBus
  // This connects the preview loading screen to the AI's working state
  useEffect(() => {
    const handleAIStart = () => {
      console.log('[Editor] AI processing started');
      setIsAIWorking(true);
      setPreviewStatus('working');
      setPreviewSubStatus('AI is generating your code...');
    };

    const handleAIEnd = () => {
      console.log('[Editor] AI processing ended');
      setIsAIWorking(false);
      // Don't immediately set to 'live' - wait for file sync
      setPreviewSubStatus('Syncing files to preview...');
      setSyncStatus('syncing');
    };

    // Subscribe to AI events from ProductionAIChat
    fileEventBus.on('ai:processing-start', handleAIStart);
    fileEventBus.on('ai:processing-end', handleAIEnd);

    return () => {
      fileEventBus.off('ai:processing-start', handleAIStart);
      fileEventBus.off('ai:processing-end', handleAIEnd);
    };
  }, []);

  // ============== LIVE PREVIEW SYNC - UNIFIED CONTEXT ==============
  // Uses previewContext for single source of truth
  // v77: Enhanced with coalescing for smart refresh
  //
  // Key features:
  // 1. 300ms debounce with coalescing (was 100ms)
  // 2. Tracks changed files during debounce window for smart refresh
  // 3. Offline queue for changes during preview startup
  // 4. Automatic queue drain on reconnection
  // 5. Reconnection detection with full re-sync
  const pendingChangesRef = useRef({}); // v77: Tracks files changed during debounce window
  const previousFilesSnapshotRef = useRef({}); // v77: Snapshot before changes for smart refresh

  useEffect(() => {
    let syncDebounceTimer = null;
    let syncInProgress = false;
    let pendingSync = false;

    const triggerSync = async (changedPath = null) => {
      // If sync is in progress, mark as pending and return
      if (syncInProgress) {
        pendingSync = true;
        console.log('[Editor] Sync in progress, marking pending');
        return;
      }

      // Clear any existing timer
      if (syncDebounceTimer) clearTimeout(syncDebounceTimer);

      // v77: 300ms debounce with coalescing (increased from 100ms for better batching)
      syncDebounceTimer = setTimeout(async () => {
        // UNIFIED: Use previewContext for connection check
        if (previewContext.hasMachine()) {
          syncInProgress = true;

          // v77: Get coalesced changes count
          const changedFileCount = Object.keys(pendingChangesRef.current).length;
          console.log(`[Editor] v77: Syncing ${changedFileCount} coalesced file changes`);

          try {
            // v77: Pass previous files snapshot for smart refresh
            await syncFilesToPreview(previousFilesSnapshotRef.current);

            // v77: Take new snapshot for next sync
            previousFilesSnapshotRef.current = useProductionFileStore.getState().getSnapshot();

            // v77: Clear pending changes after successful sync
            pendingChangesRef.current = {};
          } finally {
            syncInProgress = false;

            // If there was a pending sync request, trigger it now
            if (pendingSync) {
              pendingSync = false;
              console.log('[Editor] Processing pending sync request');
              triggerSync();
            }
          }
        } else {
          // No machine - syncFilesToPreview will queue the files
          console.log('[Editor] No machine available, files will be queued');
          await syncFilesToPreview();
        }
      }, 300); // v77: Increased from 100ms to 300ms for better coalescing
    };

    const handleFileChanged = ({ path, source }) => {
      // Track last file change timestamp for sync stabilization
      lastFileChangeRef.current = Date.now();

      // v77: Track this file in pending changes for coalescing
      pendingChangesRef.current[path] = Date.now();

      console.log(`[Editor] File changed: ${path} (source: ${source})`);
      // Accept all relevant file sources
      const syncSources = ['user', 'ai', 'ai-tool', 'generation', 'sync'];
      if (syncSources.includes(source)) {
        triggerSync(path);
      }
    };

    const handleBatchChanged = ({ paths, source }) => {
      // Track last file change timestamp for sync stabilization
      lastFileChangeRef.current = Date.now();

      // v77: Track all changed files for coalescing
      const now = Date.now();
      paths.forEach(path => {
        pendingChangesRef.current[path] = now;
      });

      console.log(`[Editor] Batch files changed: ${paths.length} files (source: ${source})`);
      // Skip initial editor load - claimPreviewMachine already syncs these files
      if (source === 'editor' || source === 'load') return;
      triggerSync();
    };

    // Handler for AI processing end - flushes any pending debounced sync
    const handleProcessingEnd = async () => {
      console.log('[Editor] AI processing ended, flushing pending sync');

      // Cancel any pending debounce timer
      if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
        syncDebounceTimer = null;
      }

      // Force immediate sync
      if (!syncInProgress) {
        syncInProgress = true;
        console.log('[Editor] Forcing immediate sync on processing-end');
        try {
          await syncFilesToPreview();
        } finally {
          syncInProgress = false;
        }
      }
    };

    fileEventBus.on('file:changed', handleFileChanged);
    fileEventBus.on('files:batch-changed', handleBatchChanged);
    fileEventBus.on('ai:processing-end', handleProcessingEnd);

    // FIX: Check for reconnection and drain queue
    if (previewContext.checkReconnected()) {
      console.log('[Editor] Reconnection detected, draining sync queue');
      const queuedFiles = previewContext.drainSyncQueue();
      if (queuedFiles && Object.keys(queuedFiles).length > 0) {
        console.log(`[Editor] Syncing ${Object.keys(queuedFiles).length} queued files`);
        // Trigger sync to send queued files
        triggerSync();
      }
    }

    return () => {
      if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
      fileEventBus.off('file:changed', handleFileChanged);
      fileEventBus.off('files:batch-changed', handleBatchChanged);
      fileEventBus.off('ai:processing-end', handleProcessingEnd);
    };
    // UNIFIED: Depend on previewContext.isConnected instead of multiple sources
  }, [previewContext.isConnected, previewContext]);

  // ============== AUTO-SAVE TO DATABASE - INDUSTRY BEST PRACTICES ==============
  // Automatically saves project files to database after changes
  // Key features:
  // 1. Debounced saves (2 seconds) to prevent database hammering
  // 2. Handles both user edits and AI-generated files
  // 3. Retry with exponential backoff on failures
  // 4. Visual status indicator for user feedback
  const autoSaveManagerRef = useRef(null);

  useEffect(() => {
    // Skip if no project ID (new projects need to be saved first)
    if (!currentProject?.id) {
      console.log('[AutoSave] Skipping - no project ID yet');
      return;
    }

    // Initialize auto-save manager
    const autoSaveManager = getAutoSaveManager({ debounceMs: 2000 });
    autoSaveManagerRef.current = autoSaveManager;

    // Initialize for this project with a function to get current files
    autoSaveManager.initialize(
      currentProject.id,
      () => useProductionFileStore.getState().getSnapshot(),
      { initialSavedAt: lastSaved }
    );

    // Listen for status changes
    const handleStatusChange = ({ status }) => {
      setAutoSaveStatus(status);
      if (status === AUTO_SAVE_STATUS.SAVED) {
        setUnsavedChanges(false);
      }
    };

    const handleSaved = ({ savedAt }) => {
      setLastSaved(savedAt);
      setUnsavedChanges(false);
      console.log(`[Editor] Auto-saved at ${savedAt}`);
    };

    const handleError = ({ error }) => {
      console.error('[Editor] Auto-save error:', error);
      // Keep unsavedChanges true so user knows save failed
    };

    autoSaveManager.on('statusChange', handleStatusChange);
    autoSaveManager.on('saved', handleSaved);
    autoSaveManager.on('error', handleError);

    // Listen for file changes and trigger auto-save
    const handleFileChangedForSave = ({ source }) => {
      // Save for user and AI changes
      const saveSources = ['user', 'ai', 'ai-tool', 'generation', 'restored'];
      if (saveSources.includes(source)) {
        setUnsavedChanges(true);
        autoSaveManager.notifyChange(source);
      }
    };

    const handleBatchChangedForSave = ({ source }) => {
      // Skip initial load
      if (source === 'load' || source === 'editor') return;
      setUnsavedChanges(true);
      autoSaveManager.notifyChange(source);
    };

    fileEventBus.on('file:changed', handleFileChangedForSave);
    fileEventBus.on('files:batch-changed', handleBatchChangedForSave);

    console.log(`[Editor] Auto-save initialized for project ${currentProject.id}`);

    return () => {
      autoSaveManager.off('statusChange', handleStatusChange);
      autoSaveManager.off('saved', handleSaved);
      autoSaveManager.off('error', handleError);
      fileEventBus.off('file:changed', handleFileChangedForSave);
      fileEventBus.off('files:batch-changed', handleBatchChangedForSave);
      autoSaveManager.reset();
    };
  }, [currentProject?.id, lastSaved]);

  // ============== BEFOREUNLOAD WARNING ==============
  // Warn user if they try to leave with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      // Check if auto-save manager has pending changes
      const autoSave = autoSaveManagerRef.current;
      if (autoSave?.hasUnsavedChanges() || unsavedChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [unsavedChanges]);

  // Watch for file changes and sync to preview machine
  // Only syncs AFTER the initial claimPreviewMachine has completed (which does the first sync).
  // This prevents duplicate syncs that cause Vite to restart unnecessarily.
  const initialSyncCompleteRef = useRef(false);
  useEffect(() => {
    if (!previewContainerId || Object.keys(files).length === 0) return;

    // Don't sync until claimPreviewMachine has completed its initial sync
    if (!initialSyncCompleteRef.current) return;

    // Debounce file sync to avoid hammering the API
    const syncTimer = setTimeout(async () => {
      await syncFilesToPreview();
    }, 500);

    return () => clearTimeout(syncTimer);
  }, [files, previewContainerId]);

  // Start or resume a preview session with file sync
  // Uses session-aware API for proper lifecycle management
  const claimPreviewMachine = async (projId, explicitFiles = null) => {
    try {
      setPreviewStatus('loading');
      setPreviewSubStatus('Starting preview environment...');

      // Use explicit files if provided (from loadProject), else fall back to current state.
      // This fixes the race condition where files state is still {} when claimPreviewMachine
      // is called before loadProject completes.
      const filesToSync = explicitFiles || files;

      const response = await fetch('/api/preview/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: projId,
          files: filesToSync,
        }),
      });

      if (response.ok) {
        const data = await response.json();

        if (data.success && data.containerId) {
          console.log('[Editor] Preview started:', data);
          const machineId = data.containerId;
          const displayName = machineId.slice(0, 8);

          // SIMPLIFIED ARCHITECTURE (v42):
          // Use subdomain URL directly in iframe for best performance and reliability.
          // The subdomain URL (preview-{projectId}.preview.ezcoder.dev) routes directly
          // to the correct machine via fly-replay header in the preview daemon.
          //
          // Why this works:
          // 1. DNS: *.preview.ezcoder.dev -> Fly.io (Cloudflare DNS-only mode)
          // 2. SSL: Fly.io handles wildcard certificate
          // 3. Routing: Preview daemon checks Redis for projectId->machineId mapping
          //    and returns fly-replay header to route to the correct machine
          // 4. Iframe: Works because preview is a separate origin (not blocked by CSP)
          //
          // The broken proxy with race conditions is bypassed entirely for viewing.
          // File sync uses direct Fly.io API with Fly-Force-Instance-Id header.
          const subdomainUrl = data.url && data.url.includes('preview.ezcoder.dev')
            ? data.url
            : `https://preview-${data.projectId || currentProject?.id}.preview.ezcoder.dev`;

          // Cache-busting: Append machine ID prefix to force browser to fetch fresh content
          // when a new machine is allocated. This prevents stale HTML with old Vite paths
          // from being served from browser cache, which would cause 502 errors when
          // referencing destroyed machines.
          // Industry standard: Use query params for cache-busting (RFC 7234 compliant)
          const machinePrefix = machineId.slice(0, 8);
          const baseUrl = subdomainUrl.replace(/\/$/, '');
          const normalizedUrl = `${baseUrl}?m=${machinePrefix}`;

          // Also keep proxy URL as fallback and for internal operations
          const proxyUrl = `/api/preview/m/${machineId}`;

          console.log('[Editor] Using subdomain URL for iframe:', normalizedUrl);
          console.log('[Editor] Proxy URL available for API calls:', proxyUrl);

          previewContainerIdRef.current = machineId; // Set ref synchronously
          setPreviewContainerId(machineId);
          setPreviewSubdomain(displayName);
          setPreviewUrl(normalizedUrl);
          // FIX: Use 'loading' not 'working' for fresh starts
          // 'working' incorrectly shows "AI is generating your code..."
          setPreviewStatus(data.reused ? 'live' : 'loading');
          setPreviewSubStatus(data.reused
            ? `Reconnected to preview (${displayName})`
            : `Starting development server...`
          );

          // Set cookie so middleware can rewrite Vite's direct module requests
          // to go through the preview proxy. Vite's client code uses import.meta.url
          // to construct URLs like /node_modules/... which bypass the proxy path.
          // The middleware sees this cookie and rewrites those requests.
          document.cookie = `preview-machine-id=${machineId}; path=/; SameSite=Lax; max-age=86400`;

          console.log(`[Editor] Preview ${data.reused ? 'resumed' : 'started'} for ${machineId}`);

          // Mark initial claim+sync as complete so useEffect file watcher
          // knows it can start syncing subsequent changes
          initialSyncCompleteRef.current = true;

          // If this was a fresh start (not reused), the server is starting
          // Poll for ready state
          if (!data.reused) {
            pollPreviewReady(machineId, normalizedUrl);
          }
          return;
        }
      }

      // Handle error response
      const errorData = await response.json().catch(() => ({}));
      console.error('[Editor] Preview start failed:', errorData);
      setPreviewStatus('error');
      setPreviewSubStatus(errorData.error || 'Preview unavailable');

    } catch (error) {
      console.error('[Editor] Error starting preview:', error);
      setPreviewStatus('error');
      setPreviewSubStatus('Preview unavailable - check connection');
    }
  };

  // Poll preview machine until dev server is ready
  // Uses the subdomain URL which routes via fly-replay header to the correct machine.
  // The daemon on the preview machine handles the routing server-side.
  const pollPreviewReady = async (machineId, previewUrl, maxAttempts = 30) => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Build status URL using URL API to properly handle existing query parameters
        // previewUrl may contain ?m=xxx for cache-busting, which must be preserved
        // but placed after the path, not embedded in it
        const urlObj = new URL(previewUrl);
        urlObj.pathname = urlObj.pathname.replace(/\/$/, '') + '/_daemon/status';
        const statusUrl = urlObj.toString();

        console.log(`[Editor] Polling daemon status: ${statusUrl} (attempt ${attempt + 1}/${maxAttempts})`);

        const statusResponse = await fetch(statusUrl, {
          // Add cache-busting to prevent stale responses
          headers: { 'Cache-Control': 'no-cache' },
        });

        if (statusResponse.ok) {
          const status = await statusResponse.json();
          console.log(`[Editor] Daemon status response:`, status);

          if (status.serverRunning) {
            console.log(`[Editor] Dev server ready on ${machineId}`);
            // Check if this is a new project waiting for user input
            const hasFiles = files && Object.keys(files).length > 0;
            const hasContentFiles = hasFiles && Object.values(files).some(
              content => content && content.length > 50 // More than just empty template
            );

            if (!hasContentFiles && isNewProject) {
              // New project with no AI-generated content - show "ready for instructions"
              setPreviewStatus('ready');
              setPreviewSubStatus('Describe what you want to build in the chat');
              console.log('[Editor] New project - waiting for user instructions');
            } else {
              // Existing project or AI has generated content - wait for iframe to load
              setIsNewProject(false);
              setHasAIGeneratedContent(true); // v78: Existing project has content
              setPreviewStatus('iframe_loading');
              setPreviewSubStatus('Rendering preview...');
              console.log('[Editor] Waiting for iframe to load content');
            }
            return;
          } else {
            // Show what the daemon is doing
            const daemonStatus = status.viteReady ? 'Vite ready, waiting for server...'
              : status.depsInstalled ? 'Starting Vite dev server...'
              : 'Installing dependencies...';
            setPreviewSubStatus(daemonStatus);
          }
        }
      } catch (e) {
        console.log(`[Editor] Poll attempt ${attempt + 1} failed:`, e.message);
        // Ignore errors during polling
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Timeout - server may still be starting
    setPreviewSubStatus('Dev server starting (may take a moment)...');
  };

  // Sync files to the preview machine
  // UNIFIED: Uses previewContext as single source of truth for machine ID
  // v77: Added previousFiles parameter for smart refresh
  const syncFilesToPreview = async (previousFiles = {}) => {
    // UNIFIED: Get machine ID from context (synchronous, always current)
    const currentMachineId = previewContext.getMachineId();

    // If no machine available, queue files for later sync
    if (!currentMachineId) {
      console.log('[Editor] syncFilesToPreview - no machine, queueing files');

      // Get fresh files from store
      const currentFiles = useProductionFileStore.getState().getSnapshot();

      // Queue via previewContext (will be drained when machine connects)
      const queueResult = previewContext.queueFilesForSync(currentFiles);
      setSyncStatus('queued');
      setPreviewSubStatus(`${queueResult.queueSize} change(s) queued`);

      return { success: false, reason: 'queued', queueSize: queueResult.queueSize };
    }

    // Log if there's a mismatch between session and context (should not happen with unified context)
    if (previewSession?.machineId && previewSession.machineId !== currentMachineId) {
      console.log(`[Editor] Machine ID mismatch detected - session: ${previewSession.machineId}, context: ${currentMachineId}. Using context.`);
    }

    // CRITICAL FIX: Get fresh files directly from store, not stale closure
    // The `files` variable from React state/useMemo can be stale when this function
    // is called from event handlers or closures. Using getSnapshot() ensures we
    // always sync the latest file contents.
    const currentFiles = useProductionFileStore.getState().getSnapshot();

    // v73: Get fresh projectId - use ref for synchronous access, fallback to state
    const freshProjectId = currentProject?.id || effectiveProjectId;

    try {
      setSyncStatus('syncing');

      // Always use the /api/preview/files endpoint with the correct machineId
      // to avoid stale session state issues
      // V213 FIX: Use effectiveProjectId to support new projects with temp IDs
      // v77: Pass previousFiles for smart refresh strategy
      const response = await fetch('/api/preview/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: freshProjectId,
          machineId: currentMachineId, // Explicitly pass the correct machine ID
          files: currentFiles, // Use fresh files from store, not stale closure
          previousFiles: previousFiles, // v77: For smart refresh (hmr vs reload vs restart)
        }),
      });

      if (response.ok) {
        setSyncStatus('synced');

        // FIX: Allow transitions from ANY active state, not just 'working'
        // Previously only 'working' was allowed, causing new previews to not show updates
        const canTransitionToLive = ['working', 'iframe_loading', 'loading', 'ready'].includes(previewStatus)
          || previewSubStatus.includes('Syncing');

        if (canTransitionToLive) {
          setIframeLoaded(false); // Reset to wait for fresh content
          setPreviewStatus('iframe_loading');
          setPreviewSubStatus('Updating preview...');

          // FIX: Reduced from 3000ms to 500ms for faster feedback
          // Vite HMR should complete within 500ms for most changes
          // If HMR is still running, user sees update within half a second
          setTimeout(() => {
            setPreviewStatus(prev => {
              if (prev === 'iframe_loading') {
                console.log('[Editor] syncFilesToPreview HMR complete - transitioning to live');
                setIframeLoaded(true);
                return 'live';
              }
              return prev;
            });
          }, 500); // REDUCED from 3000ms for faster feedback
        }
        return { success: true };
      } else {
        const errorBody = await response.text().catch(() => 'Unknown');
        console.error('[Editor] File sync FAILED', {
          status: response.status,
          body: errorBody.substring(0, 200),
          machineId: currentMachineId
        });
        setSyncStatus('error');
        return { success: false, reason: 'api_error', status: response.status };
      }
    } catch (error) {
      console.error('[Editor] Sync EXCEPTION', {
        message: error.message,
        machineId: currentMachineId
      });
      setSyncStatus('error');
      return { success: false, reason: 'exception', error: error.message };
    }
  };

  // v77: Attempt machine failover when current preview machine is unresponsive
  const attemptMachineFailover = async () => {
    if (!projectId || !previewMachineId) {
      console.warn('[Editor] v77: Cannot failover - missing projectId or machineId');
      return;
    }

    console.log('[Editor] v77: Attempting machine failover', {
      projectId,
      deadMachineId: previewMachineId
    });

    setPreviewStatus('loading');
    setPreviewSubStatus('Machine unresponsive, allocating new preview...');

    try {
      const response = await fetch('/api/preview/failover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          machineId: previewMachineId,
          files: files || {}
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('[Editor] v77: Failover successful', {
          newMachineId: result.newMachineId,
          url: result.url
        });

        // Update preview state with new machine
        setPreviewMachineId(result.newMachineId);
        setPreviewUrl(result.url);
        setPreviewStatus('ready');
        setPreviewSubStatus('Preview restored');

        // Reset SSE reconnect attempts and reconnect to new machine
        sseReconnectAttemptsRef.current = 0;

        // Close existing SSE connection if any
        if (sseEventSourceRef.current) {
          sseEventSourceRef.current.close();
          sseEventSourceRef.current = null;
        }

        // Reconnect SSE to new machine (will happen via useEffect watching previewMachineId)
        setSseConnectionState('connecting');

      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error('[Editor] v77: Failover failed', {
          status: response.status,
          error: errorText.substring(0, 200)
        });
        setPreviewStatus('error');
        setPreviewSubStatus('Failed to restore preview - try refreshing');
      }
    } catch (error) {
      console.error('[Editor] v77: Failover exception', error.message);
      setPreviewStatus('error');
      setPreviewSubStatus('Network error during failover');
    }
  };

  // OPTION 4 BACKUP: Detect if AI has generated content during this session
  // Primary detection is in loadProject, but this catches AI-generated content in real-time
  // v74: Enhanced skeleton marker detection for both basic and unified skeletons
  useEffect(() => {
    if (!files || !isNewProject) return; // Only run for projects still marked as new

    const appContent = files['src/App.tsx'] || files['src/App.js'] || '';
    const homeContent = files['src/pages/home.tsx'] || files['src/pages/Home.tsx'] || '';

    // v74: Multiple skeleton markers for basic and unified skeleton templates
    // Basic skeleton: "AI will generate content here" in App.tsx
    // Unified skeleton: "AI will add more routes here" in App.tsx, "Welcome to Your App" in home.tsx
    const SKELETON_MARKERS = [
      'AI will generate content here',      // Basic skeleton App.tsx
      'AI will add more routes here',       // Unified skeleton App.tsx
      'Welcome to Your App',                // Unified skeleton home.tsx
      'Start building your app!',           // Unified skeleton home.tsx fallback message
    ];

    const hasSkeletonMarker = SKELETON_MARKERS.some(marker =>
      appContent.includes(marker) || homeContent.includes(marker)
    );

    // v74: Check if home.tsx still has placeholder content
    const homeIsPlaceholder = homeContent.includes('Welcome to Your App') ||
                              homeContent.includes('Start building your app!');

    // Real content: longer than 200 chars AND no skeleton markers AND home is not placeholder
    const hasRealContent = appContent.length > 200 &&
                           !hasSkeletonMarker &&
                           !homeIsPlaceholder;

    if (hasRealContent) {
      console.log('[Editor] v78: Detected AI-generated content, marking project as existing');
      setIsNewProject(false);
      setHasAIGeneratedContent(true); // v78: Content detection confirms AI generated
    }
  }, [files, isNewProject]);

  // Add CSS animations
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse-scale {
        0% {
          transform: translate(-50%, -50%) scale(1);
          opacity: 0.8;
        }
        50% {
          transform: translate(-50%, -50%) scale(2.5);
          opacity: 0.3;
        }
        100% {
          transform: translate(-50%, -50%) scale(3);
          opacity: 0;
        }
      }
      @keyframes float-ball {
        0%, 100% { transform: translate(0, 0) scale(1); }
        25% { transform: translate(30px, -20px) scale(1.1); }
        50% { transform: translate(-20px, 30px) scale(0.95); }
        75% { transform: translate(20px, 20px) scale(1.05); }
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const ctrlKey = isMac ? e.metaKey : e.ctrlKey;

      if (ctrlKey && e.key === 's') {
        e.preventDefault();
        handleSaveProject();
      }
      if (ctrlKey && e.key === 'b') {
        e.preventDefault();
        setShowFiles(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ========== FUNCTIONS ==========

  const loadProject = async (id) => {
    try {
      setProjectLoading(true);
      const res = await fetch(`/api/projects/${id}`);
      if (res.ok) {
        const data = await res.json();
        setCurrentProject(data.project);
        const projectFiles = data.project?.files || {};

        // CRITICAL FIX: Don't clear files if AI is generating
        // When coming from index page with initialPrompt, the project is created empty
        // but AI might have already started writing files. Loading stale DB data would
        // clear those AI-generated files and abort the stream.
        const currentFileCount = Object.keys(files).length;
        const dbFileCount = Object.keys(projectFiles).length;

        if (currentFileCount > 0 && dbFileCount === 0) {
          console.log('[Editor] Keeping existing files (AI may be generating), not overwriting with empty DB files');
          // Don't call setFiles - keep what's in the store
        } else if (dbFileCount > 0 || currentFileCount === 0) {
          // Either DB has files (use them) or both are empty (safe to set)
          setFiles(projectFiles);
        }

        setLastSaved(data.project?.updated_at);

        // v74: OPTION 4 STEP 2: Enhanced content verification for new vs existing project detection
        // Supports both basic skeleton and unified skeleton templates
        const appContent = projectFiles['src/App.tsx'] || projectFiles['src/App.js'] || '';
        const homeContent = projectFiles['src/pages/home.tsx'] || projectFiles['src/pages/Home.tsx'] || '';

        // v74: Multiple skeleton markers for basic and unified skeleton templates
        // Basic skeleton: "AI will generate content here" in App.tsx
        // Unified skeleton: "AI will add more routes here" in App.tsx, "Welcome to Your App" in home.tsx
        const SKELETON_MARKERS = [
          'AI will generate content here',      // Basic skeleton App.tsx
          'AI will add more routes here',       // Unified skeleton App.tsx
          'Welcome to Your App',                // Unified skeleton home.tsx
          'Start building your app!',           // Unified skeleton home.tsx fallback message
        ];

        const hasSkeletonMarker = SKELETON_MARKERS.some(marker =>
          appContent.includes(marker) || homeContent.includes(marker)
        );

        // v74: Check if home.tsx still has placeholder content
        const homeIsPlaceholder = homeContent.includes('Welcome to Your App') ||
                                  homeContent.includes('Start building your app!');

        // Minimal content check - skeleton is ~400 chars for basic, ~2000 for unified
        // But unified has real boilerplate code, so we check for markers instead
        const hasMinimalContent = appContent.length < 200;

        // v74: Project is "new" if:
        // - Has any skeleton marker (basic or unified)
        // - OR has very minimal App content AND home is placeholder
        // - OR no files at all
        const isProjectNew = hasSkeletonMarker ||
                             (hasMinimalContent && (homeIsPlaceholder || !homeContent)) ||
                             dbFileCount === 0;

        console.log('[Editor] Project content verification:', {
          projectId: id,
          fileCount: dbFileCount,
          appContentLength: appContent.length,
          homeContentLength: homeContent.length,
          hasSkeletonMarker,
          hasMinimalContent,
          homeIsPlaceholder,
          isProjectNew
        });

        // Update isNewProject state based on content verification
        setIsNewProject(isProjectNew);

        // INDUSTRY BEST PRACTICE: Auto-open first file on project load
        // Priority order: src/App.tsx > src/App.jsx > src/App.js > src/index.tsx > first file
        // This ensures users see code immediately when opening the editor panel
        const filePaths = Object.keys(projectFiles);
        if (filePaths.length > 0) {
          const priorityFiles = [
            'src/App.tsx',
            'src/App.jsx',
            'src/App.js',
            'src/index.tsx',
            'src/index.jsx',
            'src/index.js',
            'index.html',
            'package.json'
          ];

          // Find the first priority file that exists, or fall back to first file
          const fileToOpen = priorityFiles.find(f => filePaths.includes(f)) || filePaths[0];

          console.log('[Editor] Auto-opening file:', fileToOpen);
          setOpenTabs([fileToOpen]);
          setActiveTab(fileToOpen);
        }

        // Don't set preview URL from database - it's stale
        // The claimPreviewMachine() flow sets the correct proxy URL
        // Preview URLs are session-specific and change per-machine claim
        // Setting this here causes a race condition where the stale DB value
        // overwrites the correct URL set by claimPreviewMachine()
        return projectFiles; // Return files so caller can pass to claimPreviewMachine
      }
    } catch (error) {
      console.error('Failed to load project:', error);
    } finally {
      setProjectLoading(false);
    }
    return null;
  };

  const handleSaveProject = async () => {
    if (!currentProject?.id) return;

    try {
      setSaveLoading(true);

      // Use auto-save manager for immediate save if available
      if (autoSaveManagerRef.current) {
        const result = await autoSaveManagerRef.current.saveNow();
        if (result.success) {
          console.log('[Editor] Manual save successful');
        } else {
          console.error('[Editor] Manual save failed:', result.error);
        }
      } else {
        // Fallback to direct save if auto-save not initialized
        const res = await fetch(`/api/projects/${currentProject.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files }),
        });

        if (res.ok) {
          setUnsavedChanges(false);
          setLastSaved(new Date().toISOString());
        }
      }
    } catch (error) {
      console.error('Failed to save project:', error);
    } finally {
      setSaveLoading(false);
    }
  };

  // Project name rename handlers
  const handleStartProjectNameEdit = () => {
    if (currentProject?.name) {
      setEditingProjectName(currentProject.name);
      setIsEditingProjectName(true);
    }
  };

  const handleCancelProjectNameEdit = () => {
    setIsEditingProjectName(false);
    setEditingProjectName('');
  };

  const handleSaveProjectName = async () => {
    const trimmedName = editingProjectName.trim();

    if (!trimmedName || !currentProject?.id) {
      handleCancelProjectNameEdit();
      return;
    }

    // Check if name actually changed
    if (currentProject.name === trimmedName) {
      handleCancelProjectNameEdit();
      return;
    }

    try {
      const res = await fetch(`/api/projects/${currentProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      });

      if (res.ok) {
        // Update local state
        setCurrentProject(prev => ({ ...prev, name: trimmedName }));
        handleCancelProjectNameEdit();
      } else {
        const data = await res.json();
        alert(`Failed to rename project: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to rename project:', error);
      alert('Failed to rename project. Please try again.');
    }
  };

  const handleFileChange = (filename, content) => {
    // FIXED: Use setFile (single file) instead of setFiles (batch)
    // This properly triggers the fileEventBus 'file:changed' event
    // which notifies both preview sync AND auto-save via fileEventBus
    setFile(filename, content, 'user');
    // Note: setUnsavedChanges is now handled by auto-save listener
  };

  const handleFileSelect = (filename) => {
    if (!openTabs.includes(filename)) {
      setOpenTabs(prev => [...prev, filename]);
    }
    setActiveTab(filename);
  };

  const handleCloseTab = (filename, e) => {
    e?.stopPropagation();
    const newTabs = openTabs.filter(t => t !== filename);
    setOpenTabs(newTabs);
    if (activeTab === filename && newTabs.length > 0) {
      setActiveTab(newTabs[newTabs.length - 1]);
    } else if (newTabs.length === 0) {
      setActiveTab('');
    }
  };

  const getLanguageFromFile = (filename) => {
    if (!filename) return 'plaintext';
    const ext = filename.split('.').pop()?.toLowerCase();
    const langMap = {
      js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
      html: 'html', css: 'css', scss: 'scss', json: 'json', md: 'markdown',
      py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    };
    return langMap[ext] || 'plaintext';
  };

  const handleTerminalCommand = async (cmd) => {
    if (!cmd.trim()) return;

    setTerminalOutput(prev => [...prev, { type: 'input', text: `$ ${cmd}` }]);
    setTerminalInput('');

    // Simulate command execution
    setTimeout(() => {
      setTerminalOutput(prev => [...prev, {
        type: 'output',
        text: `Command executed: ${cmd}`
      }]);
    }, 500);
  };

  const getFileIcon = (filename) => {
    if (!filename) return <Icons.File />;
    const ext = filename.split('.').pop()?.toLowerCase();
    const name = filename.split('/').pop()?.toLowerCase();

    // File type colors matching common IDE conventions
    const colors = {
      ts: '#3178C6',      // TypeScript blue
      tsx: '#3178C6',     // TypeScript blue
      js: '#F7DF1E',      // JavaScript yellow
      jsx: '#61DAFB',     // React blue
      json: '#CBCB41',    // JSON yellow
      html: '#E34F26',    // HTML orange
      css: '#1572B6',     // CSS blue
      scss: '#CC6699',    // SCSS pink
      md: '#083FA1',      // Markdown blue
      svg: '#FFB13B',     // SVG orange
      png: '#8ED6FB',     // Image cyan
      jpg: '#8ED6FB',
      gif: '#8ED6FB',
      gitignore: '#F14E32', // Git red
    };

    const color = colors[ext] || (name?.startsWith('.') ? '#6B7280' : '#9CA3AF');

    // Return a simple code/file icon with color
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
    );
  };

  // Calculate panel visibility and layout
  const visiblePanels = [showAIChat, showFiles, showEditor, showPreview].filter(Boolean).length;

  // ============================================================================
  // LOADING SCREEN STATUS MAPPING - Industry Best Practice Implementation
  // ============================================================================
  // PreviewLoadingScreen.jsx defines STATUS_MESSAGES with specific keys.
  // This smart mapper parses previewSubStatus content to determine the correct key,
  // ensuring users see appropriate loading states throughout the development flow.
  //
  // Valid STATUS_MESSAGES keys in PreviewLoadingScreen.jsx:
  //   loading_dev, starting, installing, waiting, building, generating,
  //   ready, loading_preview, server_starting, server_ready, syncing, iframe_loading
  // ============================================================================

  const getLoadingScreenStatus = () => {
    // Parse previewSubStatus content to determine the most accurate status key
    const subStatus = (previewSubStatus || '').toLowerCase();

    // Priority 1: Check for specific phase indicators in previewSubStatus
    if (subStatus.includes('installing dependencies') || subStatus.includes('npm install')) {
      return 'installing';
    }
    if (subStatus.includes('syncing files') || subStatus.includes('syncing your changes')) {
      return 'syncing';
    }
    if (subStatus.includes('ai is generating') || subStatus.includes('creating files')) {
      return 'generating';
    }
    if (subStatus.includes('rendering preview') || subStatus.includes('loading your application')) {
      return 'iframe_loading';
    }
    if (subStatus.includes('dev server starting') || subStatus.includes('npm run dev')) {
      return 'server_starting';
    }
    if (subStatus.includes('development server ready') || subStatus.includes('server ready')) {
      return 'server_ready';
    }
    if (subStatus.includes('starting development server') || subStatus.includes('almost ready')) {
      return 'waiting';
    }
    if (subStatus.includes('describe what you want') || subStatus.includes('ready for your')) {
      return 'ready';
    }
    if (subStatus.includes('loading preview') || subStatus.includes('restoring your project')) {
      return 'loading_preview';
    }
    if (subStatus.includes('preparing your development') || subStatus.includes('loading preview environment')) {
      return 'loading_dev';
    }
    if (subStatus.includes('spinning up') || subStatus.includes('setting up') || subStatus.includes('starting preview')) {
      return 'starting';
    }
    if (subStatus.includes('preparing your application') || subStatus.includes('building')) {
      return 'building';
    }

    // Priority 2: Fall back to previewStatus-based mapping
    switch (previewStatus) {
      case 'loading':
        return isNewProject ? 'loading_dev' : 'loading_preview';
      case 'ready':
        return 'ready';
      case 'working':
        return 'generating';
      case 'iframe_loading':
        return 'iframe_loading';
      case 'syncing':
        return 'syncing';
      case 'live':
        return 'server_ready';
      case 'error':
        return 'starting';
      default:
        return 'starting';
    }
  };

  // Returns custom file info only when previewSubStatus contains non-standard content
  // This prevents duplicate messages (since STATUS_MESSAGES already has standard messages)
  const getLoadingScreenCurrentFile = () => {
    if (!previewSubStatus) return null;

    // Standard messages that are already in PreviewLoadingScreen STATUS_MESSAGES/SUB_MESSAGES
    const standardPatterns = [
      'ai is generating',
      'rendering preview',
      'syncing files',
      'syncing your changes',
      'starting development',
      'dev server starting',
      'development server',
      'describe what you want',
      'loading preview',
      'restoring your project',
      'preparing your development',
      'loading preview environment',
      'spinning up',
      'setting up',
      'starting preview',
      'preparing your application',
      'installing dependencies',
      'npm install',
      'npm run dev',
      'almost ready',
      'ready for your',
      'server ready',
      'creating files',
      'loading your application',
      'building'
    ];

    const lowerSubStatus = previewSubStatus.toLowerCase();
    const isStandardMessage = standardPatterns.some(pattern =>
      lowerSubStatus.includes(pattern)
    );

    // Return null for standard messages (let PreviewLoadingScreen use its SUB_MESSAGES)
    // Return the custom message for file-specific or unique status updates
    return isStandardMessage ? null : previewSubStatus;
  };

  // DEPRECATED: Use getLoadingScreenStatus() instead
  // Kept for backwards compatibility with any code that might reference it
  const getPreviewStatusText = () => {
    if (previewStatus === 'loading') return 'Loading preview environment...';
    if (previewStatus === 'ready') return 'Ready for your instructions';
    if (previewStatus === 'working') return 'AI is generating your code...';
    if (previewStatus === 'iframe_loading') return 'Rendering preview...';
    return '';
  };

  // Handle iframe load event - confirms content is actually visible
  // v78: This is now the PRIMARY transition trigger to 'live' state
  const handleIframeLoad = useCallback(() => {
    console.log('[Editor] v78: Iframe loaded successfully');
    setIframeLoaded(true);
    // Transition to 'live' from ANY loading/waiting state
    setPreviewStatus(prev => {
      if (prev === 'iframe_loading' || prev === 'loading') {
        console.log('[Editor] v78: Transitioning to live from', prev);
        setPreviewSubStatus('');
        return 'live';
      }
      return prev;
    });
  }, []);

  // ========== SCREENSHOT CAPTURE ==========
  // Capture project thumbnail when preview loads successfully
  // v73: Enhanced with retry logic and exponential backoff
  // v76: Added trigger parameter for different capture contexts
  const captureProjectScreenshot = useCallback(async (retryCount = 0, trigger = 'auto') => {
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [3000, 5000, 8000]; // Exponential backoff

    const machineId = previewContainerIdRef.current;
    const projId = projectId || currentProject?.id;

    if (!machineId || !projId) {
      console.log('[Editor] Screenshot skipped - missing machineId or projectId');
      return;
    }

    if (screenshotInProgressRef.current && retryCount === 0) {
      console.log('[Editor] Screenshot already in progress');
      return;
    }

    screenshotInProgressRef.current = true;
    console.log(`[Editor] Capturing project screenshot (trigger: ${trigger})...`, {
      machineId,
      projectId: projId,
      attempt: retryCount + 1,
      maxRetries: MAX_RETRIES,
      trigger
    });

    try {
      const response = await fetch(`/api/projects/${projId}/screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machineId,
          trigger, // v76: Pass trigger type for rate limit handling
          // Tell daemon to wait for dev server if not running
          waitForServer: true
        })
      });

      const result = await response.json();

      if (result.success) {
        console.log('[Editor] Screenshot captured successfully:', result.thumbnail_url);
        // v76: Don't mark as "captured" for post-generation - allow subsequent captures
        if (trigger === 'auto') {
          setScreenshotCaptured(true);
        }
      } else if (response.status === 429) {
        // Rate limited - mark as captured to avoid retrying (only for auto)
        console.log('[Editor] Screenshot rate limited:', result.error);
        if (trigger === 'auto') {
          setScreenshotCaptured(true);
        }
      } else if (response.status === 503 && retryCount < MAX_RETRIES) {
        // Server not ready - retry with backoff
        console.log(`[Editor] Screenshot failed (server not ready), retrying in ${RETRY_DELAYS[retryCount]}ms...`);
        screenshotInProgressRef.current = false;
        setTimeout(() => {
          captureProjectScreenshot(retryCount + 1, trigger);
        }, RETRY_DELAYS[retryCount]);
        return;
      } else {
        console.warn('[Editor] Screenshot capture failed:', result.error);
      }
    } catch (error) {
      console.error('[Editor] Screenshot capture error:', error);
      // Retry on network errors
      if (retryCount < MAX_RETRIES) {
        console.log(`[Editor] Screenshot network error, retrying in ${RETRY_DELAYS[retryCount]}ms...`);
        screenshotInProgressRef.current = false;
        setTimeout(() => {
          captureProjectScreenshot(retryCount + 1, trigger);
        }, RETRY_DELAYS[retryCount]);
        return;
      }
    } finally {
      if (retryCount >= MAX_RETRIES - 1 || screenshotCaptured) {
        screenshotInProgressRef.current = false;
      }
    }
  }, [projectId, currentProject?.id, screenshotCaptured]);

  // ========== v76: POST-GENERATION SCREENSHOT CAPTURE ==========
  // Listen for AI generation complete events and request screenshot from daemon
  // The daemon will capture after HMR completes for accurate representation
  useEffect(() => {
    const handleGenerationComplete = async (data) => {
      console.log('[Editor] v76: AI generation complete, requesting post-HMR screenshot...', data);

      const machineId = previewContainerIdRef.current;
      if (!machineId || !previewUrl) {
        console.log('[Editor] v76: Skipping screenshot request - no machine or preview URL');
        return;
      }

      // Mark that we're waiting for post-generation screenshot
      setAwaitingPostGenScreenshot(true);
      generationCompleteTimestampRef.current = data.timestamp;

      try {
        // Extract base URL from preview URL
        const urlObj = new URL(previewUrl);
        const daemonUrl = `${urlObj.origin}/_daemon/request-screenshot`;

        // Request the daemon to capture screenshot after HMR completes
        const response = await fetch(daemonUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Fly-Force-Instance-Id': machineId
          },
          body: JSON.stringify({
            trigger: 'generation-complete',
            filesGenerated: data.filesGenerated,
            timestamp: data.timestamp
          })
        });

        if (response.ok) {
          const result = await response.json();
          console.log('[Editor] v76: Screenshot request queued:', result);
        } else {
          console.warn('[Editor] v76: Screenshot request failed:', response.status);
          // Fallback: capture directly with delay
          setTimeout(() => {
            captureProjectScreenshot(0, 'post-generation');
            setAwaitingPostGenScreenshot(false);
          }, 3000);
        }
      } catch (error) {
        console.error('[Editor] v76: Screenshot request error:', error);
        // Fallback: capture directly with delay
        setTimeout(() => {
          captureProjectScreenshot(0, 'post-generation');
          setAwaitingPostGenScreenshot(false);
        }, 3000);
      }
    };

    fileEventBus.on('ai:generation-complete', handleGenerationComplete);

    return () => {
      fileEventBus.off('ai:generation-complete', handleGenerationComplete);
    };
  }, [previewUrl, captureProjectScreenshot]);

  // Trigger screenshot capture when preview is live and iframe has loaded
  // v73: Use longer initial delay to ensure content is fully rendered
  useEffect(() => {
    // Only capture if:
    // 1. Preview is 'live' status
    // 2. Iframe has loaded
    // 3. We have a machine ID
    // 4. We haven't already captured a screenshot this session
    const machineId = previewContainerIdRef.current;

    if (previewStatus === 'live' && iframeLoaded && machineId && !screenshotCaptured) {
      // Delay to ensure content is fully rendered
      // 5 seconds is enough for most React apps to fully hydrate
      const timer = setTimeout(() => {
        captureProjectScreenshot(0);
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [previewStatus, iframeLoaded, screenshotCaptured, captureProjectScreenshot]);

  // ========== VITE ERROR DETECTION (SSE) ==========
  // Listen for Vite compilation errors from the preview daemon
  // These are critical errors (missing imports, syntax errors) detected before React crashes
  useEffect(() => {
    if (!previewUrl) return;

    // Extract base URL for SSE connection
    let sseUrl;
    try {
      const urlObj = new URL(previewUrl);
      sseUrl = `${urlObj.origin}/_daemon/events`;
    } catch {
      console.warn('[Editor] Invalid preview URL for SSE:', previewUrl);
      return;
    }

    console.log('[Editor] v69: Connecting to SSE for vite-error detection:', sseUrl);

    const eventSource = new EventSource(sseUrl);
    let connected = false;

    eventSource.onopen = () => {
      connected = true;
      console.log('[Editor] v69: SSE connected for vite-error detection');
    };

    // Listen for vite-error events from daemon
    eventSource.addEventListener('vite-error', async (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[Editor] v69: Received vite-error from daemon:', data);

        if (data.error && data.error.critical) {
          const viteError = data.error;

          // Log the specific error for debugging
          console.warn('[Editor] v69: CRITICAL Vite error detected:', {
            type: viteError.type,
            message: viteError.message,
            file: viteError.file,
            importPath: viteError.importPath,
          });

          // Get current project ID and files for auto-fix
          const projId = projectId || currentProject?.id;
          const currentFiles = files || {};

          if (!projId) {
            console.warn('[Editor] v69: No projectId available for auto-fix');
            return;
          }

          // Call auto-fix API to generate missing files (e.g., shadcn components)
          console.log('[Editor] v69: Calling auto-fix API for Vite error...');

          try {
            const fixResponse = await fetch('/api/ai/auto-fix', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                projectId: projId,
                error: {
                  type: viteError.type,
                  message: viteError.message,
                  file: viteError.file,
                  importPath: viteError.importPath,
                  raw: viteError.raw,
                },
                files: currentFiles,
              }),
            });

            if (fixResponse.ok) {
              const fixResult = await fixResponse.json();

              if (fixResult.success && fixResult.fixedFiles?.length > 0) {
                console.log('[Editor] v69: Auto-fix succeeded!', {
                  filesFixed: fixResult.fixedFiles.length,
                  explanation: fixResult.explanation,
                  type: fixResult.type,
                });

                // Apply fixed files to the store
                for (const fixedFile of fixResult.fixedFiles) {
                  const normalizedPath = fixedFile.path.startsWith('/')
                    ? fixedFile.path.slice(1)
                    : fixedFile.path;

                  console.log('[Editor] v69: Applying fix to:', normalizedPath);
                  setFile(normalizedPath, fixedFile.content);
                }

                // Trigger sync to preview daemon after a brief delay
                // The setFile calls are async, wait for them to settle
                setTimeout(() => {
                  console.log('[Editor] v69: Syncing fixed files to preview...');
                  syncFilesToPreview();
                }, 500);
              } else {
                console.log('[Editor] v69: Auto-fix returned no fixes:', fixResult);
              }
            } else {
              const errorData = await fixResponse.json().catch(() => ({}));
              console.warn('[Editor] v69: Auto-fix API error:', fixResponse.status, errorData);
            }
          } catch (fixError) {
            console.error('[Editor] v69: Auto-fix request failed:', fixError);
          }
        }
      } catch (err) {
        console.warn('[Editor] v69: Failed to parse vite-error event:', err);
      }
    });

    // v76: Listen for HMR completion events (for logging/debugging)
    eventSource.addEventListener('hmr-complete', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[Editor] v76: HMR complete event from daemon:', data);
      } catch (err) {
        console.warn('[Editor] v76: Failed to parse hmr-complete event:', err);
      }
    });

    // v76: Listen for screenshot capture completion
    eventSource.addEventListener('screenshot-captured', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[Editor] v76: Screenshot captured by daemon:', data);

        // Clear waiting state
        setAwaitingPostGenScreenshot(false);

        if (data.success && data.thumbnailUrl) {
          console.log('[Editor] v76: Thumbnail URL:', data.thumbnailUrl);
        }
      } catch (err) {
        console.warn('[Editor] v76: Failed to parse screenshot-captured event:', err);
      }
    });

    eventSource.onerror = () => {
      if (connected) {
        console.log('[Editor] v69: SSE connection lost');
        connected = false;
      }
    };

    return () => {
      console.log('[Editor] v69: Closing SSE connection');
      eventSource.close();
    };
  }, [previewUrl, projectId, currentProject?.id, files, setFile, syncFilesToPreview]);

  // ========== AUTH CHECK ==========
  if (authStatus === 'loading' || projectLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'linear-gradient(180deg, #FAFBFC 0%, #F0FDFA 100%)',
        position: 'relative',
      }}>
        <FloatingBalls />
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          zIndex: 1,
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <EzcoderLogo size={80} pulse={true} />
          </div>
          <p style={{ marginTop: 28, color: '#6B7280', fontSize: 16, textAlign: 'center' }}>Loading...</p>
        </div>
      </div>
    );
  }

  if (authStatus === 'unauthenticated') {
    router.push('/');
    return null;
  }

  // ========== SYNC HELPERS ==========

  /**
   * Wait for file store to stabilize (no changes for 150ms)
   * Prevents syncing while React is still batching setFile() calls
   */
  const waitForStableFileStore = async (maxWait = 1000) => {
    const checkInterval = 50;
    let elapsed = 0;
    while (elapsed < maxWait) {
      const timeSinceLastChange = Date.now() - lastFileChangeRef.current;
      if (timeSinceLastChange >= 150) {
        console.log(`[Editor] File store stable after ${elapsed}ms`);
        return true;
      }
      await new Promise(r => setTimeout(r, checkInterval));
      elapsed += checkInterval;
    }
    console.warn('[Editor] File store did not stabilize within timeout, syncing anyway');
    return false;
  };

  /**
   * Sync with exponential backoff retry
   * Retries on failure with increasing delays: 500ms → 1s → 2s → 4s
   */
  const syncWithRetry = async (syncFn, maxRetries = 3) => {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await syncFn();
        if (result?.success !== false) {
          console.log(`[Editor] Sync succeeded on attempt ${attempt + 1}`);
          return result;
        }
        throw new Error(result?.reason || 'Sync returned without success');
      } catch (error) {
        lastError = error;
        const backoffMs = Math.min(500 * Math.pow(2, attempt), 4000);
        console.warn(`[Editor] Sync attempt ${attempt + 1} failed, retrying in ${backoffMs}ms:`, error.message);

        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, backoffMs));
        }
      }
    }
    throw lastError || new Error('Sync failed after retries');
  };

  // ========== RENDER ==========
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: '#FFFFFF',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>

      {/* ========== HEADER BAR ========== */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 20px',
        background: '#FFFFFF',
        borderBottom: '1px solid #E5E7EB',
        gap: 16,
      }}>
        {/* Left Section */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Projects Button - Cyan border style */}
          <button
            onClick={() => router.push('/projects')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              background: 'rgba(0, 217, 255, 0.08)',
              border: '2px solid #00D9FF',
              borderRadius: '20px',
              color: '#00A8CC',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <Icons.ArrowLeft />
            Projects
          </button>

          {/* Project Name Display - Click to Edit */}
          {currentProject?.name && (
            isEditingProjectName ? (
              <input
                type="text"
                value={editingProjectName}
                onChange={(e) => setEditingProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveProjectName();
                  } else if (e.key === 'Escape') {
                    handleCancelProjectNameEdit();
                  }
                }}
                onBlur={handleSaveProjectName}
                autoFocus
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#1A1D21',
                  padding: '6px 12px',
                  background: '#FFFFFF',
                  border: '2px solid #00D9FF',
                  borderRadius: '6px',
                  maxWidth: '200px',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
            ) : (
              <span
                onClick={handleStartProjectNameEdit}
                title="Click to rename project"
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#1A1D21',
                  padding: '6px 12px',
                  background: '#F3F4F6',
                  borderRadius: '6px',
                  maxWidth: '200px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  border: '2px solid transparent',
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = '#E5E7EB';
                  e.target.style.borderColor = '#D1D5DB';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = '#F3F4F6';
                  e.target.style.borderColor = 'transparent';
                }}
              >
                {currentProject.name}
              </span>
            )
          )}

          {/* Refresh Button */}
          <button
            onClick={() => {
              if (confirm('Refresh project? This will reload from server.')) {
                loadProject(projectId);
              }
            }}
            title="Refresh project from server"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#6B7280',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              padding: '8px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            ↻ Refresh
          </button>

          {/* Last Saved */}
          {lastSaved && (
            <span style={{ color: '#6B7280', fontSize: 12 }}>
              Last saved: {new Date(lastSaved).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        {/* Center Section - Panel Toggles */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Files Toggle */}
          <button
            onClick={() => setShowFiles(!showFiles)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              background: showFiles ? 'rgba(0, 217, 255, 0.1)' : '#FFFFFF',
              border: `1px solid ${showFiles ? '#00D9FF' : '#E5E7EB'}`,
              borderRadius: '20px',
              color: showFiles ? '#00A8CC' : '#374151',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
            }}
          >
            <Icons.Folder />
            Files
          </button>

          {/* Editor Toggle */}
          <button
            onClick={() => setShowEditor(!showEditor)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              background: showEditor ? 'rgba(0, 217, 255, 0.1)' : '#FFFFFF',
              border: `1px solid ${showEditor ? '#00D9FF' : '#E5E7EB'}`,
              borderRadius: '20px',
              color: showEditor ? '#00A8CC' : '#374151',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
            }}
          >
            <Icons.Code />
            Editor
          </button>

          {/* Live Preview Toggle */}
          <button
            onClick={() => setShowPreview(!showPreview)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              background: showPreview ? 'rgba(0, 217, 255, 0.1)' : '#FFFFFF',
              border: `1px solid ${showPreview ? '#00D9FF' : '#E5E7EB'}`,
              borderRadius: '20px',
              color: showPreview ? '#00A8CC' : '#374151',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
            }}
          >
            <Icons.Eye />
            Live Preview
          </button>

          {/* AI Chat Toggle */}
          <button
            onClick={() => setShowAIChat(!showAIChat)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              background: showAIChat ? 'rgba(0, 217, 255, 0.1)' : '#FFFFFF',
              border: `1px solid ${showAIChat ? '#00D9FF' : '#E5E7EB'}`,
              borderRadius: '20px',
              color: showAIChat ? '#00A8CC' : '#374151',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
            }}
          >
            <Icons.MessageSquare />
            AI Chat
          </button>

          {/* Tools Dropdown */}
          <div style={{ position: 'relative' }} ref={toolsMenuRef}>
            <button
              onClick={() => setShowToolsMenu(!showToolsMenu)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                background: showToolsMenu ? 'rgba(0, 217, 255, 0.1)' : '#FFFFFF',
                border: `1px solid ${showToolsMenu ? '#00D9FF' : '#E5E7EB'}`,
                borderRadius: '20px',
                color: showToolsMenu ? '#00A8CC' : '#374151',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              }}
            >
              <Icons.Settings />
              Tools
              <Icons.ChevronDown />
            </button>

            {/* Tools Dropdown Menu */}
            {showToolsMenu && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                right: 0,
                background: theme.colors.bgSecondary,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.radius.lg,
                boxShadow: theme.shadows.lg,
                minWidth: 180,
                padding: '8px 0',
                zIndex: 100,
              }}>
                {[
                  { icon: Icons.Key, label: 'API Keys & Database', onClick: () => setShowApiKeysModal(true) },
                  { icon: Icons.Activity, label: 'Activity', onClick: () => setShowActivityModal(true) },
                  { icon: Icons.BarChart, label: 'Site Analytics', onClick: () => router.push(`/analytics?projectId=${projectId || currentProject?.id}&from=editor`) },
                  { icon: Icons.Clock, label: 'History', onClick: () => setShowHistoryModal(true) },
                  { icon: Icons.Users, label: 'Collab', onClick: () => setCollaborativeMode(!collaborativeMode) },
                ].map((item, i) => (
                  <button
                    key={i}
                    onClick={() => { item.onClick(); setShowToolsMenu(false); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      padding: '10px 16px',
                      background: 'transparent',
                      border: 'none',
                      color: theme.colors.text,
                      fontSize: 13,
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => e.target.style.background = theme.colors.bgTertiary}
                    onMouseLeave={(e) => e.target.style.background = 'transparent'}
                  >
                    <item.icon />
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Section - Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Publish Website - Cyan gradient */}
          <button
            onClick={() => setShowDeployModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              background: 'linear-gradient(135deg, #00D9FF 0%, #00A8CC 100%)',
              border: 'none',
              borderRadius: '20px',
              color: 'white',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 2px 8px rgba(0, 217, 255, 0.3)',
            }}
          >
            <Icons.Rocket />
            Publish Website
          </button>

          {/* Save - Coral/Red */}
          <button
            onClick={handleSaveProject}
            disabled={saveLoading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              background: '#FF6B6B',
              border: 'none',
              borderRadius: '20px',
              color: 'white',
              fontSize: 13,
              fontWeight: 600,
              cursor: saveLoading ? 'wait' : 'pointer',
              opacity: saveLoading ? 0.7 : 1,
              transition: 'all 0.2s',
              boxShadow: '0 2px 8px rgba(255, 107, 107, 0.3)',
            }}
          >
            <Icons.Save />
            {saveLoading ? 'Saving...' : 'Save'}
          </button>

          {/* Stripe - Outline style */}
          <button
            onClick={() => setShowStripeModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              background: '#FFFFFF',
              border: '1px solid #E5E7EB',
              borderRadius: '20px',
              color: '#374151',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
            }}
          >
            <Icons.CreditCard />
            Stripe
          </button>

          {/* Ads Suite - Dark */}
          <button
            onClick={() => setShowAdsModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              background: '#1A1D21',
              border: 'none',
              borderRadius: '20px',
              color: 'white',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            }}
          >
            <Icons.Megaphone />
            Ads Suite
          </button>
        </div>
      </header>

      {/* ========== MAIN CONTENT AREA ========== */}
      <div style={{
        display: 'flex',
        flex: 1,
        overflow: 'hidden',
        gap: 0,
      }}>

        {/* ========== AI CHAT PANEL ========== */}
        {/* IMPORTANT: Use CSS display:none instead of conditional rendering to preserve chat state
            This prevents component unmount which would lose messages during resize/toggle */}
        <div style={{
          width: showAIChat ? (showFiles || showEditor || showPreview ? 500 : '100%') : 0,
          minWidth: showAIChat ? 350 : 0,
          maxWidth: showAIChat ? (showFiles || showEditor || showPreview ? 500 : '100%') : 0,
          display: showAIChat ? 'flex' : 'none',
          flexDirection: 'column',
          background: '#FFFFFF',
          borderRight: showAIChat ? '1px solid #E5E7EB' : 'none',
          overflow: 'hidden',
        }}>
          {/* AI Chat - ProductionAIChat has its own header, embedded mode for flex layout */}
          <ProductionAIChat
              projectId={projectId || currentProject?.id}
              isOpen={showAIChat}
              onClose={() => setShowAIChat(false)}
              previewUrl={previewUrl}
              width="100%"
              position="left"
              embedded={true}
              // Initial prompt from URL query (e.g., from index page "Start Building")
              // Only pass when router is ready and projectId is valid
              initialPrompt={isRouterReady && !processedInitialPrompt ? initialPrompt : null}
              onInitialPromptProcessed={() => {
                setProcessedInitialPrompt(true);
                // CRITICAL FIX: Remove initialPrompt from URL to prevent re-trigger on page refresh
                // Without this, refreshing the page would cause the chat to regenerate because:
                // 1. processedInitialPrompt state resets to false on refresh
                // 2. initialPrompt is still in URL query params
                // 3. ProductionAIChat sees initialPrompt prop → auto-submits again
                if (router.query.initialPrompt) {
                  const { initialPrompt: _, ...restQuery } = router.query;
                  router.replace(
                    { pathname: router.pathname, query: restQuery },
                    undefined,
                    { shallow: true }
                  );
                  console.log('[Editor] Cleared initialPrompt from URL after processing');
                }
              }}
              // File update callback - ProductionAIChat handles file store internally
              // This is for additional side effects like opening the file in editor
              onFileUpdate={(path, content) => {
                if (content !== null) {
                  // File created or modified - open it in editor
                  handleFileSelect(path);
                  setUnsavedChanges(true);
                }
              }}
              // Generation lifecycle callbacks - used for preview loading screen
              onGenerationStart={() => {
                console.log('[Editor] AI generation started');
                setIsAIWorking(true);
                setPreviewStatus('working');
                setPreviewSubStatus('AI is generating your code...');
              }}
              onGenerationEnd={async () => {
                console.log('[Editor] v78: AI generation ended');
                setIsAIWorking(false);
                setIsNewProject(false); // AI has generated content
                setHasAIGeneratedContent(true); // v78: Mark that AI has generated content

                // v75: Wait for file store to stabilize before syncing
                // This ensures all setFile() calls from streaming are committed
                await waitForStableFileStore();

                try {
                  // v75: Use exponential backoff retry for resilient sync
                  await syncWithRetry(syncFilesToPreview, 3);

                  // Set status to wait for content to render
                  setIframeLoaded(false);
                  setPreviewStatus('iframe_loading');
                  setPreviewSubStatus('Rendering preview...');

                  // v78: HMR fallback - increased to 8s to accommodate initial builds/npm install
                  setTimeout(() => {
                    setPreviewStatus(prev => {
                      if (prev === 'iframe_loading') {
                        console.log('[Editor] v78: HMR fallback timeout - transitioning to live');
                        setIframeLoaded(true);
                        return 'live';
                      }
                      return prev;
                    });
                  }, 8000);
                } catch (syncError) {
                  console.error('[Editor] All sync retries failed:', syncError);
                  // Still transition to live to avoid stuck state
                  setPreviewStatus('live');
                }
              }}
            />
        </div>

        {/* ========== FILES PANEL ========== */}
        {showFiles && (
          <div style={{
            width: 240,
            minWidth: 200,
            display: 'flex',
            flexDirection: 'column',
            background: '#FFFFFF',
            borderRight: '1px solid #E5E7EB',
          }}>
            {/* FileExplorer has its own header with FILES title and action buttons */}
            <FileExplorer
              files={files}
              activeFile={activeTab}
              onFileSelect={handleFileSelect}
              onFileCreate={(filename, content) => {
                setFile(filename, content || '');
                handleFileSelect(filename);
              }}
              onFileDelete={(filename) => {
                deleteStoreFile(filename);
                handleCloseTab(filename);
              }}
              onFileRename={(oldName, newName) => {
                const content = files[oldName];
                deleteStoreFile(oldName);
                setFile(newName, content);
                if (activeTab === oldName) setActiveTab(newName);
                setOpenTabs(prev => prev.map(t => t === oldName ? newName : t));
              }}
              onFolderCreate={(folderPath) => {
                // Create a placeholder file to represent the folder
                setFile(`${folderPath}/.gitkeep`, '');
              }}
            />
          </div>
        )}

        {/* ========== EDITOR PANEL ========== */}
        {showEditor && (
          <div style={{
            flex: 1,
            minWidth: 300,
            display: 'flex',
            flexDirection: 'column',
            background: '#FFFFFF',
            borderRight: showPreview ? '1px solid #E5E7EB' : 'none',
          }}>
            {/* Tab Bar - Light theme matching screenshot */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              background: '#F9FAFB',
              borderBottom: '1px solid #E5E7EB',
              overflow: 'auto',
              minHeight: 44,
              gap: 0,
            }}>
              {openTabs.map((tab) => {
                const fileName = tab.split('/').pop();
                const isActive = activeTab === tab;
                return (
                  <div
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 16px',
                      background: isActive ? '#FFFFFF' : 'transparent',
                      borderBottom: isActive ? '2px solid #00D9FF' : '2px solid transparent',
                      borderRight: '1px solid #E5E7EB',
                      color: isActive ? '#1F2937' : '#6B7280',
                      fontSize: 13,
                      fontWeight: isActive ? 500 : 400,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.15s',
                    }}
                  >
                    <span style={{ color: '#9CA3AF', display: 'flex', alignItems: 'center' }}>
                      {getFileIcon(tab)}
                    </span>
                    <span>{fileName}</span>
                    <button
                      onClick={(e) => handleCloseTab(tab, e)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#9CA3AF',
                        cursor: 'pointer',
                        padding: 2,
                        marginLeft: 4,
                        fontSize: 16,
                        lineHeight: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 4,
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.background = '#E5E7EB';
                        e.target.style.color = '#374151';
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.background = 'transparent';
                        e.target.style.color = '#9CA3AF';
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Monaco Editor - Light theme */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {activeTab ? (
                <MonacoEditor
                  value={files[activeTab] || ''}
                  onChange={(value) => handleFileChange(activeTab, value)}
                  language={getLanguageFromFile(activeTab)}
                  theme="vs"
                  options={{
                    fontSize: 14,
                    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                    minimap: {
                      enabled: true,
                      side: 'right',
                      showSlider: 'mouseover',
                      renderCharacters: false,
                      maxColumn: 80,
                    },
                    wordWrap: 'on',
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    folding: true,
                    lineNumbers: 'on',
                    lineNumbersMinChars: 4,
                    renderWhitespace: 'none',
                    bracketPairColorization: { enabled: true },
                    tabSize: 2,
                    padding: { top: 16, bottom: 16 },
                    scrollbar: {
                      vertical: 'auto',
                      horizontal: 'auto',
                      verticalScrollbarSize: 10,
                      horizontalScrollbarSize: 10,
                    },
                  }}
                />
              ) : (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: '#9CA3AF',
                  background: '#FFFFFF',
                  fontSize: 14,
                }}>
                  Select a file to edit
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========== PREVIEW PANEL ========== */}
        {showPreview && (
          <div style={{
            flex: 1,
            minWidth: 400,
            display: 'flex',
            flexDirection: 'column',
            background: '#FFFFFF',
            position: 'relative',
          }}>
            {/* Preview Header - Matches Spark-AI screenshots */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              background: '#FFFFFF',
              borderBottom: '1px solid #E5E7EB',
            }}>
              {/* Sync Status & Preview Link - simplified, no redundant machine names */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Pending Syncs Indicator (V2 file sync retry queue) */}
                {previewSession.hasPendingSyncs && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 12px',
                    background: 'rgba(245, 158, 11, 0.1)',
                    borderRadius: '16px',
                    color: '#F59E0B',
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                  title={`${previewSession.pendingSyncCount} file sync(s) pending - will auto-sync when machine ready`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    {previewSession.pendingSyncCount} Queued
                  </div>
                )}

                {/* v77: SSE Connection Status Badge */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 12px',
                  background: sseConnectionState === 'connected' ? 'rgba(34, 197, 94, 0.1)' :
                             sseConnectionState === 'connecting' ? 'rgba(59, 130, 246, 0.1)' :
                             sseConnectionState === 'error' ? 'rgba(239, 68, 68, 0.1)' :
                             'rgba(156, 163, 175, 0.1)',
                  borderRadius: '16px',
                  color: sseConnectionState === 'connected' ? '#22C55E' :
                         sseConnectionState === 'connecting' ? '#3B82F6' :
                         sseConnectionState === 'error' ? '#EF4444' :
                         '#9CA3AF',
                  fontSize: 12,
                  fontWeight: 500,
                }}
                title={`Real-time connection: ${sseConnectionState}`}
                >
                  {sseConnectionState === 'connected' && (
                    <>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
                      Live
                    </>
                  )}
                  {sseConnectionState === 'connecting' && (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                        <path d="M12 2 A10 10 0 0 1 22 12" />
                      </svg>
                      Connecting...
                    </>
                  )}
                  {sseConnectionState === 'error' && (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      Reconnecting
                    </>
                  )}
                  {sseConnectionState === 'disconnected' && (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="1" y1="1" x2="23" y2="23" />
                        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
                        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
                        <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
                        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
                        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                        <line x1="12" y1="20" x2="12.01" y2="20" />
                      </svg>
                      Offline
                    </>
                  )}
                </div>

                {/* Sync Status (Preview) */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 12px',
                  background: syncStatus === 'synced' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                  borderRadius: '16px',
                  color: syncStatus === 'synced' ? '#22C55E' : '#F59E0B',
                  fontSize: 12,
                  fontWeight: 500,
                }}>
                  <Icons.Check />
                  {syncStatus === 'synced' ? 'Synced' : 'Syncing...'}
                </div>

                {/* v77: URL Bar for SPA Navigation */}
                {previewUrl && sseConnectionState === 'connected' && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 8px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    minWidth: 140,
                    maxWidth: 220,
                  }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                    <input
                      type="text"
                      value={previewPath}
                      onChange={(e) => setPreviewPath(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          navigateToPreviewPath(previewPath);
                        }
                      }}
                      onBlur={() => {
                        if (previewPath !== '/' && previewPath) {
                          navigateToPreviewPath(previewPath);
                        }
                      }}
                      style={{
                        flex: 1,
                        border: 'none',
                        background: 'transparent',
                        color: '#E5E7EB',
                        fontSize: 12,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        outline: 'none',
                        padding: 0,
                        minWidth: 0,
                      }}
                      placeholder="/"
                      title="Current route path - press Enter to navigate"
                    />
                  </div>
                )}

                {/* Preview Link - opens in new tab */}
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '5px 12px',
                      background: 'rgba(59, 130, 246, 0.1)',
                      borderRadius: '16px',
                      color: '#3B82F6',
                      fontSize: 12,
                      fontWeight: 500,
                      textDecoration: 'none',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    title="Open preview in new tab"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    Preview
                  </a>
                )}
              </div>

              {/* Device Icons & Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* Device View Icons */}
                {[
                  { view: 'desktop', icon: Icons.Monitor, tooltip: 'Desktop (Full Width)' },
                  { view: 'tablet-portrait', icon: Icons.Tablet, tooltip: 'Tablet (768×1024)' },
                  { view: 'mobile', icon: Icons.Smartphone, tooltip: 'Mobile (375×667)' },
                  { view: 'laptop', icon: Icons.Laptop, tooltip: 'Laptop (1280×800)' },
                ].map(({ view, icon: Icon, tooltip }) => (
                  <button
                    key={view}
                    onClick={() => setDeviceView(view)}
                    title={tooltip}
                    style={{
                      padding: 8,
                      background: deviceView === view ? '#00D9FF' : '#FFFFFF',
                      border: `1px solid ${deviceView === view ? '#00D9FF' : '#E5E7EB'}`,
                      borderRadius: '8px',
                      color: deviceView === view ? 'white' : '#6B7280',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon />
                  </button>
                ))}

                <div style={{ width: 1, height: 24, background: '#E5E7EB', margin: '0 8px' }} />

                {/* Refresh */}
                <button
                  onClick={() => {}}
                  style={{
                    padding: 8,
                    background: '#FFFFFF',
                    border: '1px solid #E5E7EB',
                    borderRadius: '8px',
                    color: '#6B7280',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icons.RefreshCw />
                </button>

                {/* Terminal Tab */}
                <button
                  onClick={() => setShowTerminal(!showTerminal)}
                  style={{
                    padding: 8,
                    background: showTerminal ? 'rgba(0, 217, 255, 0.1)' : '#FFFFFF',
                    border: `1px solid ${showTerminal ? '#00D9FF' : '#E5E7EB'}`,
                    borderRadius: '8px',
                    color: showTerminal ? '#00A8CC' : '#6B7280',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="Terminal"
                >
                  <Icons.Terminal />
                </button>

                {/* Logs Tab */}
                <button
                  onClick={() => setShowConsole(!showConsole)}
                  style={{
                    padding: 8,
                    background: showConsole ? 'rgba(0, 217, 255, 0.1)' : '#FFFFFF',
                    border: `1px solid ${showConsole ? '#00D9FF' : '#E5E7EB'}`,
                    borderRadius: '8px',
                    color: showConsole ? '#00A8CC' : '#6B7280',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="Console Logs"
                >
                  <Icons.FileText />
                </button>

                {/* Stop Button */}
                <button
                  onClick={() => {}}
                  style={{
                    padding: '8px 16px',
                    background: '#EF4444',
                    border: 'none',
                    borderRadius: '8px',
                    color: 'white',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    boxShadow: '0 2px 6px rgba(239, 68, 68, 0.3)',
                  }}
                >
                  Stop
                </button>
              </div>
            </div>

            {/* Preview Content */}
            <div style={{
              flex: 1,
              position: 'relative',
              background: deviceView === 'desktop' ? '#FAFBFC' : '#E5E7EB',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'auto',
            }}>
              {/* v78: UNIFIED Loading Overlay - covers ALL loading states including AI generation
                  Requirements:
                  1. Initial load (new project): Block until first AI generation completes AND renders
                  2. Initial load (existing project): Block until project renders
                  3. Subsequent edits: Block during AI generation until HMR completes
                  4. No flickering between agent pipeline stages

                  KEY: Use hasAIGeneratedContent to track whether AI has generated any content.
                  For new projects, we MUST show loading until AI generates content, even if
                  previewStatus is 'live' (which can happen when skeleton loads before AI runs) */}
              {(
                // Initial loading states
                previewStatus === 'loading' ||
                previewStatus === 'iframe_loading' ||
                // Waiting for user prompt (new project only)
                (previewStatus === 'ready' && isNewProject) ||
                // AI is generating (ALWAYS show - initial or subsequent edits)
                previewStatus === 'working' ||
                // v78 CRITICAL: For new projects, keep loading until AI has generated content
                // This prevents showing "Ready to Build" skeleton even if iframe loads
                (!hasAIGeneratedContent && isNewProject)
              ) && (
                <PreviewLoadingScreen
                  status={getLoadingScreenStatus()}
                  currentFile={getLoadingScreenCurrentFile()}
                />
              )}

              {/* v78: Live Preview iframe
                  - Don't mount until AI has generated content for NEW projects
                  - Keep mounted during 'working' for EXISTING projects (faster HMR updates)
                  - Hide with opacity when loading overlay is visible */}
              {previewUrl && (
                // Only show iframe when we have AI-generated content OR existing project
                hasAIGeneratedContent && (
                  previewStatus === 'live' ||
                  previewStatus === 'iframe_loading' ||
                  (previewStatus === 'working')
                )
              ) && (
                <div style={{
                  width: currentViewport.width,
                  height: currentViewport.height,
                  maxWidth: '100%',
                  maxHeight: '100%',
                  position: deviceView === 'desktop' ? 'absolute' : 'relative',
                  inset: deviceView === 'desktop' ? 0 : undefined,
                  background: '#FFFFFF',
                  boxShadow: deviceView !== 'desktop' ? '0 4px 24px rgba(0, 0, 0, 0.15)' : 'none',
                  borderRadius: deviceView !== 'desktop' ? '12px' : '0',
                  overflow: 'hidden',
                  transition: 'all 0.3s ease-in-out',
                }}>
                  <iframe
                    ref={previewIframeRef}
                    src={previewUrl}
                    onLoad={handleIframeLoad}
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      // v78: Hide iframe when loading overlay is visible (iframe_loading OR working)
                      opacity: (previewStatus === 'iframe_loading' || previewStatus === 'working') && !iframeLoaded ? 0 : 1,
                      transition: 'opacity 0.2s ease-in-out',
                    }}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                    title="Live Preview"
                  />
                </div>
              )}
            </div>

            {/* Terminal Panel - Matches Spark-AI screenshots */}
            {showTerminal && (
              <div style={{
                height: 220,
                background: '#1A1D21',
                borderTop: '1px solid #2D3136',
                display: 'flex',
                flexDirection: 'column',
              }}>
                {/* Terminal Header */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderBottom: '1px solid #2D3136',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#22C55E', fontSize: 14 }}>$</span>
                    <span style={{ color: '#FFFFFF', fontWeight: 600, fontSize: 14 }}>Terminal</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <button
                      onClick={() => setTerminalOutput([{ type: 'system', text: 'EzCoder Preview Terminal' }])}
                      style={{ background: 'transparent', border: 'none', color: '#6B7280', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => setShowTerminal(false)}
                      style={{ background: 'transparent', border: 'none', color: '#6B7280', cursor: 'pointer', fontSize: 16, fontWeight: 500 }}
                    >
                      x
                    </button>
                  </div>
                </div>

                {/* Quick Commands */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  borderBottom: '1px solid #2D3136',
                }}>
                  {['npm install', 'npm run dev', 'npm run build', 'ls -la', 'cat package.json'].map((cmd) => (
                    <button
                      key={cmd}
                      onClick={() => handleTerminalCommand(cmd)}
                      style={{
                        padding: '6px 12px',
                        background: '#2D3136',
                        border: '1px solid #3D4148',
                        borderRadius: '6px',
                        color: '#9CA3AF',
                        fontSize: 12,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                      }}
                    >
                      {cmd}
                    </button>
                  ))}
                </div>

                {/* Terminal Output */}
                <div
                  ref={terminalRef}
                  style={{
                    flex: 1,
                    overflow: 'auto',
                    padding: '12px 14px',
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                >
                  {terminalOutput.map((line, i) => (
                    <div
                      key={i}
                      style={{
                        color: line.type === 'input' ? '#00D9FF' :
                               line.type === 'error' ? '#EF4444' : '#9CA3AF',
                        marginBottom: 4,
                      }}
                    >
                      {line.text}
                    </div>
                  ))}
                </div>

                {/* Terminal Input */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 14px',
                  borderTop: '1px solid #2D3136',
                  background: '#15171A',
                }}>
                  <span style={{ color: '#22C55E', marginRight: 10, fontSize: 14 }}>$</span>
                  <input
                    type="text"
                    value={terminalInput}
                    onChange={(e) => setTerminalInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleTerminalCommand(terminalInput);
                    }}
                    placeholder="Type a command..."
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 'none',
                      color: '#FFFFFF',
                      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                      fontSize: 13,
                      outline: 'none',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Console Output Panel (v73) - Unified browser + server logs */}
            {showConsole && (
              <div style={{
                height: 200,
                background: '#1A1D21',
                borderTop: '1px solid #2D3136',
                display: 'flex',
                flexDirection: 'column',
              }}>
                {/* Console Header */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderBottom: '1px solid #2D3136',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#60A5FA', fontSize: 14 }}>{'>'}</span>
                    <span style={{ fontWeight: 600, fontSize: 14, color: '#FFFFFF' }}>Console</span>
                    <span style={{
                      fontSize: 11,
                      color: '#6B7280',
                      background: '#2D3136',
                      padding: '2px 6px',
                      borderRadius: 4
                    }}>
                      {consoleOutput.length}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <button
                      onClick={() => setConsoleOutput([])}
                      style={{ background: 'transparent', border: 'none', color: '#6B7280', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => setShowConsole(false)}
                      style={{ background: 'transparent', border: 'none', color: '#6B7280', cursor: 'pointer', fontSize: 16, fontWeight: 500 }}
                    >
                      x
                    </button>
                  </div>
                </div>

                {/* Console Output */}
                <div
                  ref={consoleRef}
                  style={{
                    flex: 1,
                    overflow: 'auto',
                    padding: '8px 14px',
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  {consoleOutput.length === 0 ? (
                    <div style={{ color: '#6B7280', fontStyle: 'italic', padding: '8px 0' }}>
                      Console output from preview will appear here...
                    </div>
                  ) : (
                    consoleOutput.map((log) => (
                      <div
                        key={log.id}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 8,
                          marginBottom: 4,
                          color: log.method === 'error' ? '#EF4444' :
                                 log.method === 'warn' ? '#F59E0B' :
                                 log.source === 'server' ? '#60A5FA' : '#9CA3AF',
                        }}
                      >
                        {/* Timestamp */}
                        <span style={{ color: '#4B5563', flexShrink: 0, fontSize: 11 }}>
                          [{new Date(log.timestamp).toLocaleTimeString()}]
                        </span>
                        {/* Source badge */}
                        <span style={{
                          flexShrink: 0,
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '1px 5px',
                          borderRadius: 3,
                          background: log.source === 'server' ? '#1E3A5F' : '#2D2D3D',
                          color: log.source === 'server' ? '#60A5FA' : '#9CA3AF',
                        }}>
                          {log.source === 'server' ? 'SERVER' : 'BROWSER'}
                        </span>
                        {/* Log content */}
                        <span style={{ wordBreak: 'break-word', flex: 1 }}>
                          {log.args?.join(' ') || log.content || ''}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ========== MODALS ========== */}
      {showDeployModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <OneClickDeploy
            projectId={currentProject?.id}
            projectName={currentProject?.name}
            projectFiles={files}
            onClose={() => setShowDeployModal(false)}
          />
        </div>
      )}

      {showStripeModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: theme.colors.bgSecondary,
            borderRadius: theme.radius.xl,
            padding: 24,
            maxWidth: 900,
            width: '95%',
            maxHeight: '90vh',
            overflow: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>Stripe Dashboard</h2>
              <button onClick={() => setShowStripeModal(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: theme.colors.text }}>
                <Icons.X />
              </button>
            </div>
            <StripeProjectDashboard
              currentProjectId={currentProject?.id}
              onClose={() => setShowStripeModal(false)}
              theme={theme}
            />
          </div>
        </div>
      )}

      {showAdsModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: theme.colors.bgSecondary,
            borderRadius: theme.radius.xl,
            padding: 24,
            maxWidth: 800,
            width: '90%',
            maxHeight: '80vh',
            overflow: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>Ads Suite</h2>
              <button onClick={() => setShowAdsModal(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <Icons.X />
              </button>
            </div>
            <AdsSuite
              project={currentProject}
              onClose={() => setShowAdsModal(false)}
            />
          </div>
        </div>
      )}

      {/* API Keys Modal */}
      {showApiKeysModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: theme.colors.bgSecondary,
            borderRadius: theme.radius.xl,
            padding: 24,
            maxWidth: 600,
            width: '90%',
            maxHeight: '80vh',
            overflow: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>API Keys</h2>
              <button onClick={() => setShowApiKeysModal(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <Icons.X />
              </button>
            </div>
            <APIKeyManager projectId={currentProject?.id || projectId} />
          </div>
        </div>
      )}

      {/* Database Explorer Modal */}
      {showDatabaseModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: theme.colors.bgSecondary,
            borderRadius: theme.radius.xl,
            padding: 24,
            maxWidth: 900,
            width: '90%',
            maxHeight: '85vh',
            overflow: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Database Explorer</h2>
              <button onClick={() => setShowDatabaseModal(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <Icons.X />
              </button>
            </div>
            <DatabaseExplorer projectId={currentProject?.id || projectId} onClose={() => setShowDatabaseModal(false)} />
          </div>
        </div>
      )}

      {/* Activity Monitor Modal */}
      {showActivityModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: theme.colors.bgSecondary,
            borderRadius: theme.radius.xl,
            padding: 24,
            maxWidth: 700,
            width: '90%',
            maxHeight: '80vh',
            overflow: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Activity Monitor</h2>
              <button onClick={() => setShowActivityModal(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <Icons.X />
              </button>
            </div>
            <ActivityMonitor
              projectId={currentProject?.id || projectId}
              containerId={previewContainerId}
              userId={session?.user?.id}
            />
          </div>
        </div>
      )}


      {/* Version History Modal */}
      {showHistoryModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: theme.colors.bgSecondary,
            borderRadius: theme.radius.xl,
            padding: 24,
            maxWidth: 700,
            width: '90%',
            maxHeight: '80vh',
            overflow: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Version History</h2>
              <button onClick={() => setShowHistoryModal(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <Icons.X />
              </button>
            </div>
            <VersionHistory
              projectId={currentProject?.id || projectId}
              onRestore={(restoredFiles) => {
                // Replace all files with restored version
                setStoreFiles({});
                Object.entries(restoredFiles).forEach(([path, content]) => {
                  setFile(path, content, 'restored');
                });
                // Update active file if it exists in restored files
                if (activeFile && restoredFiles[activeFile]) {
                  setActiveFile(activeFile);
                } else {
                  // Set first file as active
                  const firstFile = Object.keys(restoredFiles)[0];
                  if (firstFile) setActiveFile(firstFile);
                }
                setShowHistoryModal(false);
                setUnsavedChanges(true);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Force server-side rendering to avoid static generation issues with dynamic imports
export async function getServerSideProps() {
  return { props: {} };
}
