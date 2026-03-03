// pages/editor.js - V212 Production Editor with Spark-AI
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";

// PRODUCTION: Import the unified file store for single source of truth
import {
  useProductionFileStore,
  fileEventBus,
  normalizePath
} from '../lib/stores/ProductionFileStore';

// Note: Multi-Agent Orchestrator is used server-side in /api/ai/production-chat
// No client-side import needed - the API handles tier-based model selection

// Dynamic imports with error handling
const FileExplorer = dynamic(() => import("../components/FileExplorer.jsx").catch((err) => {
  console.error('Failed to load FileExplorer:', err);
  return { default: () => <div style={{ padding: '1rem', color: '#666' }}>File Explorer unavailable</div> };
}), { ssr: false });

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>Loading editor...</div>
});

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

const AdsSuite = dynamic(() => import("../components/AdsSuite"), {
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

const UsageDashboard = dynamic(() => import("../components/UsageDashboard").catch(() => {
  return { default: () => <div style={{ padding: '1rem', color: '#888' }}>Usage Dashboard unavailable</div> };
}), {
  ssr: false,
  loading: () => <div style={{ padding: '1rem', textAlign: 'center', color: '#888' }}>Loading Usage Dashboard...</div>
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
const PreviewLoadingScreen = ({ status, subStatus }) => (
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
        {status}
      </h2>
      {subStatus && (
        <p style={{
          marginTop: 10,
          fontSize: 14,
          color: '#6B7280',
          fontWeight: 400,
          textAlign: 'center',
        }}>
          {subStatus}
        </p>
      )}
    </div>
  </div>
);

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

  // ========== STATE ==========
  // Panel visibility
  const [showFiles, setShowFiles] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [showAIChat, setShowAIChat] = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);

  // Project state (metadata only - files live in ProductionFileStore)
  const [currentProject, setCurrentProject] = useState(null);
  const [openTabs, setOpenTabs] = useState([]);
  const [activeTab, setActiveTab] = useState('');
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [projectLoading, setProjectLoading] = useState(true);
  const [processedInitialPrompt, setProcessedInitialPrompt] = useState(false);

  // Preview state
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewContainerId, setPreviewContainerId] = useState(null);
  const [previewSubdomain, setPreviewSubdomain] = useState(null); // e.g., "abc123.fly.dev"
  const [previewStatus, setPreviewStatus] = useState('loading'); // 'loading' | 'ready' | 'working' | 'live'
  const [previewSubStatus, setPreviewSubStatus] = useState('Connecting to preview environment...');
  const [syncStatus, setSyncStatus] = useState('synced'); // 'synced' | 'syncing' | 'error'
  const [deviceView, setDeviceView] = useState('desktop');

  // AI state - connected to ProductionAIChat events
  const [isAIWorking, setIsAIWorking] = useState(false);

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
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Refs
  const terminalRef = useRef(null);
  const toolsMenuRef = useRef(null);

  // ========== DERIVE FILES FROM STORE ==========
  // Convert ProductionFileStore format to simple object for components that need it
  const files = useMemo(() => {
    const result = {};
    for (const [path, entry] of Object.entries(storeFiles)) {
      result[path] = entry.content;
    }
    return result;
  }, [storeFiles]);

  // Helper to update files in store
  const setFiles = useCallback((newFilesOrUpdater) => {
    if (typeof newFilesOrUpdater === 'function') {
      const currentFiles = {};
      for (const [path, entry] of Object.entries(storeFiles)) {
        currentFiles[path] = entry.content;
      }
      const updated = newFilesOrUpdater(currentFiles);
      setStoreFiles(updated, 'editor');
    } else {
      setStoreFiles(newFilesOrUpdater, 'editor');
    }
  }, [storeFiles, setStoreFiles]);

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

      // Generate semantic project name with timestamp
      const projectName = `Untitled ${new Date().toLocaleString('en-US', {
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
          setFiles(newProject.files || {});

          // Sync URL state (shallow update, no history entry)
          // This makes the URL immediately shareable
          const newUrl = `/editor?projectId=${newProject.id}${
            initialPrompt ? `&initialPrompt=${encodeURIComponent(initialPrompt)}` : ''
          }`;
          router.replace(newUrl, undefined, { shallow: true });

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

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  /**
   * Main initialization effect - handles both new and existing projects
   *
   * Flow:
   * 1. Wait for router and auth to be ready
   * 2. If no projectId → create one immediately (eager initialization)
   * 3. If projectId exists → load existing project
   * 4. Claim preview machine in either case
   */
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
      console.log('[Editor] No projectId in URL - initializing new project');

      ensureProject().then((project) => {
        if (project) {
          // Success: claim preview machine with new project
          claimPreviewMachine(project.id);
        }
        setProjectLoading(false);
      });
      return;
    }

    // EXISTING PROJECT: Load from database
    console.log('[Editor] Loading existing project:', projectId);
    loadProject(projectId);
    claimPreviewMachine(projectId);
  }, [projectId, session?.user, authStatus, isRouterReady, ensureProject]);

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

  // Watch for file changes and sync to preview machine
  useEffect(() => {
    if (!previewContainerId || Object.keys(files).length === 0) return;

    // Debounce file sync to avoid hammering the API
    const syncTimer = setTimeout(async () => {
      await syncFilesToPreview();
    }, 500);

    return () => clearTimeout(syncTimer);
  }, [files, previewContainerId]);

  // Claim a warm preview machine from the pool
  const claimPreviewMachine = async (projId) => {
    try {
      setPreviewStatus('loading');
      setPreviewSubStatus('Claiming warm machine from pool...');

      // First try the warm pool
      const poolResponse = await fetch('/api/pool/test-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: projId }),
      });

      if (poolResponse.ok) {
        const poolData = await poolResponse.json();
        if (poolData.success && poolData.machine) {
          console.log('[Editor] Claimed warm machine:', poolData);
          const machineId = poolData.machine.id;
          const flySubdomain = `${machineId}.fly.dev`;
          const flyUrl = `https://${flySubdomain}`;

          setPreviewContainerId(machineId);
          setPreviewSubdomain(flySubdomain);
          setPreviewUrl(flyUrl);
          setPreviewStatus('ready');
          setPreviewSubStatus('Ready for your instructions');
          return;
        }
      }

      // Fall back to GKE allocate if warm pool unavailable
      setPreviewSubStatus('Connecting to preview environment...');
      const response = await fetch('/api/preview/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: projId,
          userId: session?.user?.id,
          files: files,
          projectType: 'react'
        }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log('[Editor] Preview allocated:', data);
        setPreviewContainerId(data.containerId);

        // Extract subdomain from previewUrl if it's a fly.dev URL
        if (data.previewUrl && data.previewUrl.includes('.fly.dev')) {
          const urlMatch = data.previewUrl.match(/https?:\/\/([^/]+\.fly\.dev)/);
          if (urlMatch) {
            setPreviewSubdomain(urlMatch[1]);
          }
        }

        setPreviewUrl(data.iframeUrl || data.previewUrl);
        setPreviewStatus('ready');
        setPreviewSubStatus('Ready for your instructions');
      } else {
        console.error('[Editor] Failed to allocate preview:', await response.text());
        setPreviewSubStatus('Preview unavailable - using local mode');
      }
    } catch (error) {
      console.error('[Editor] Error claiming preview:', error);
      setPreviewSubStatus('Preview unavailable - using local mode');
    }
  };

  // Sync files to the preview machine
  const syncFilesToPreview = async () => {
    if (!previewContainerId) return;

    try {
      setSyncStatus('syncing');

      const response = await fetch('/api/preview/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: currentProject?.id,
          files: files,
        }),
      });

      if (response.ok) {
        setSyncStatus('synced');
        // If we were in 'working' status, transition to 'live'
        if (previewStatus === 'working' || previewSubStatus.includes('Syncing')) {
          setPreviewStatus('live');
          setPreviewSubStatus('');
        }
      } else {
        setSyncStatus('error');
        console.error('[Editor] File sync failed');
      }
    } catch (error) {
      console.error('[Editor] Sync error:', error);
      setSyncStatus('error');
    }
  };

  // Initial preview ready state when no AI activity
  useEffect(() => {
    if (projectLoading || isAIWorking) return;

    // If preview URL is set and status is still loading, mark as ready
    if (previewUrl && previewStatus === 'loading') {
      const timer = setTimeout(() => {
        setPreviewStatus('ready');
        setPreviewSubStatus('Describe what you want to build in the chat');
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [projectLoading, previewUrl, previewStatus, isAIWorking]);

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
      const res = await fetch(`/api/project/${id}`);
      if (res.ok) {
        const data = await res.json();
        setCurrentProject(data.project);
        setFiles(data.project?.files || {});
        setLastSaved(data.project?.updated_at);

        // Set preview URL if available
        if (data.project?.preview_url) {
          setPreviewUrl(data.project.preview_url);
        }
      }
    } catch (error) {
      console.error('Failed to load project:', error);
    } finally {
      setProjectLoading(false);
    }
  };

  const handleSaveProject = async () => {
    if (!currentProject?.id) return;

    try {
      setSaveLoading(true);
      const res = await fetch(`/api/project/${currentProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });

      if (res.ok) {
        setUnsavedChanges(false);
        setLastSaved(new Date().toISOString());
      }
    } catch (error) {
      console.error('Failed to save project:', error);
    } finally {
      setSaveLoading(false);
    }
  };

  const handleFileChange = (filename, content) => {
    setFiles(prev => ({ ...prev, [filename]: content }));
    setUnsavedChanges(true);
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

  // Get preview status text
  const getPreviewStatusText = () => {
    if (previewStatus === 'loading') return 'Loading preview environment...';
    if (previewStatus === 'ready') return 'Ready for your instructions';
    if (previewStatus === 'working') return 'AI is generating your code...';
    return '';
  };

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

          {/* Reset Button */}
          <button
            onClick={() => {
              if (confirm('Reset project? This will clear all unsaved changes.')) {
                loadProject(projectId);
              }
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#374151',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              padding: '8px 10px',
            }}
          >
            Reset
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
                  { icon: Icons.Key, label: 'API Keys', onClick: () => setShowApiKeysModal(true) },
                  { icon: Icons.Activity, label: 'Activity', onClick: () => setShowActivityModal(true) },
                  { icon: Icons.BarChart, label: 'Analytics', onClick: () => setShowAnalyticsModal(true) },
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
        {showAIChat && (
          <div style={{
            width: showFiles || showEditor || showPreview ? 500 : '100%',
            minWidth: 350,
            maxWidth: showFiles || showEditor || showPreview ? 500 : '100%',
            display: 'flex',
            flexDirection: 'column',
            background: '#FFFFFF',
            borderRight: '1px solid #E5E7EB',
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
                onInitialPromptProcessed={() => setProcessedInitialPrompt(true)}
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
                onGenerationEnd={() => {
                  console.log('[Editor] AI generation ended');
                  setIsAIWorking(false);
                  // Sync files to preview after generation
                  syncFilesToPreview().then(() => {
                    setPreviewStatus('live');
                    setPreviewSubStatus('');
                  });
                }}
              />
          </div>
        )}

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
              {/* Sync Status & Subdomain URL - inline like screenshots */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                {/* Subdomain URL displayed inline next to Synced badge */}
                {previewSubdomain && (
                  <span style={{
                    color: '#6B7280',
                    fontSize: 12,
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  }}>
                    {previewSubdomain}
                  </span>
                )}
              </div>

              {/* Device Icons & Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* Device View Icons */}
                {[
                  { view: 'desktop', icon: Icons.Monitor },
                  { view: 'tablet-portrait', icon: Icons.Tablet },
                  { view: 'mobile', icon: Icons.Smartphone },
                  { view: 'laptop', icon: Icons.Laptop },
                ].map(({ view, icon: Icon }) => (
                  <button
                    key={view}
                    onClick={() => setDeviceView(view)}
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

                {/* External Link - Opens full screen preview in new tab */}
                <button
                  onClick={() => {
                    // Use the full subdomain URL for external preview
                    const fullUrl = previewSubdomain
                      ? `https://${previewSubdomain}`
                      : previewUrl;
                    if (fullUrl) {
                      window.open(fullUrl, '_blank', 'noopener,noreferrer');
                    }
                  }}
                  disabled={!previewSubdomain && !previewUrl}
                  title={previewSubdomain ? `Open https://${previewSubdomain} in new tab` : 'Open preview in new tab'}
                  style={{
                    padding: 8,
                    background: '#FFFFFF',
                    border: '1px solid #E5E7EB',
                    borderRadius: '8px',
                    color: previewSubdomain || previewUrl ? '#6B7280' : '#D1D5DB',
                    cursor: previewSubdomain || previewUrl ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s',
                  }}
                >
                  <Icons.ExternalLink />
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
            <div style={{ flex: 1, position: 'relative', background: '#FAFBFC' }}>
              {/* Loading Overlay */}
              {previewStatus !== 'live' && (
                <PreviewLoadingScreen
                  status={getPreviewStatusText()}
                  subStatus={previewSubStatus}
                />
              )}

              {/* Live Preview iframe - uses subdomain URL from warm pool */}
              {(previewUrl || previewSubdomain) && previewStatus === 'live' && (
                <iframe
                  src={previewSubdomain ? `https://${previewSubdomain}` : previewUrl}
                  style={{
                    width: '100%',
                    height: '100%',
                    border: 'none',
                  }}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                  title="Live Preview"
                />
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

            {/* Console Output Panel - Matches Spark-AI screenshots */}
            {showConsole && (
              <div style={{
                height: 150,
                background: '#FFFFFF',
                borderTop: '1px solid #E5E7EB',
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderBottom: '1px solid #E5E7EB',
                }}>
                  <span style={{ fontWeight: 600, fontSize: 12, color: '#6B7280', letterSpacing: '0.05em' }}>
                    CONSOLE OUTPUT
                  </span>
                  <button
                    onClick={() => setShowConsole(false)}
                    style={{ background: 'transparent', border: 'none', color: '#6B7280', cursor: 'pointer', fontSize: 16 }}
                  >
                    x
                  </button>
                </div>
                <div style={{ padding: '12px 14px', color: '#6B7280', fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
                  {consoleOutput.length === 0 ? 'No logs yet...' : consoleOutput.map((log, i) => (
                    <div key={i} style={{ marginBottom: 4 }}>{log}</div>
                  ))}
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
            maxWidth: 500,
            width: '90%',
          }}>
            <OneClickDeploy
              projectId={currentProject?.id}
              files={files}
              onClose={() => setShowDeployModal(false)}
            />
          </div>
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
            maxWidth: 600,
            width: '90%',
            maxHeight: '80vh',
            overflow: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>Stripe Integration</h2>
              <button onClick={() => setShowStripeModal(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <Icons.X />
              </button>
            </div>
            <StripeIntegration
              projectId={currentProject?.id}
              onClose={() => setShowStripeModal(false)}
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
              projectId={currentProject?.id}
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

      {/* Analytics Modal */}
      {showAnalyticsModal && (
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
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Usage Analytics</h2>
              <button onClick={() => setShowAnalyticsModal(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <Icons.X />
              </button>
            </div>
            <UsageDashboard
              period="monthly"
              projectId={currentProject?.id || projectId}
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
