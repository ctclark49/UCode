// pages/analytics.js - Professional Version without Emojis
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';

// Dynamically import Recharts to avoid SSR issues
const LineChart = dynamic(() => import('recharts').then(mod => mod.LineChart), { ssr: false });
const Line = dynamic(() => import('recharts').then(mod => mod.Line), { ssr: false });
const AreaChart = dynamic(() => import('recharts').then(mod => mod.AreaChart), { ssr: false });
const Area = dynamic(() => import('recharts').then(mod => mod.Area), { ssr: false });
const BarChart = dynamic(() => import('recharts').then(mod => mod.BarChart), { ssr: false });
const Bar = dynamic(() => import('recharts').then(mod => mod.Bar), { ssr: false });
const PieChart = dynamic(() => import('recharts').then(mod => mod.PieChart), { ssr: false });
const Pie = dynamic(() => import('recharts').then(mod => mod.Pie), { ssr: false });
const Cell = dynamic(() => import('recharts').then(mod => mod.Cell), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then(mod => mod.ResponsiveContainer), { ssr: false });
const XAxis = dynamic(() => import('recharts').then(mod => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import('recharts').then(mod => mod.YAxis), { ssr: false });
const CartesianGrid = dynamic(() => import('recharts').then(mod => mod.CartesianGrid), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then(mod => mod.Tooltip), { ssr: false });
const Legend = dynamic(() => import('recharts').then(mod => mod.Legend), { ssr: false });

// SVG Icon Components
const Icons = {
  ArrowLeft: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="19" y1="12" x2="5" y2="12"/>
      <polyline points="12 19 5 12 12 5"/>
    </svg>
  ),
  UserCheck: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="8.5" cy="7" r="4"/>
      <polyline points="17 11 19 13 23 9"/>
    </svg>
  ),
  Home: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  ),
  Eye: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  ChartBar: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20V10"/>
      <path d="M18 20V4"/>
      <path d="M6 20v-6"/>
    </svg>
  ),
  Download: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  Activity: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  Users: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  Clock: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  AlertCircle: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
  Spinner: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
      <path d="M21 12a9 9 0 11-6.219-8.56"/>
    </svg>
  )
};

export default function AnalyticsDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { projectId: queryProjectId, from, preview } = router.query;
  
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState(null);
  const [registeredUsers, setRegisteredUsers] = useState([]);
  const [timeRange, setTimeRange] = useState('7d');
  const [selectedProject, setSelectedProject] = useState(queryProjectId || 'all');
  const [projects, setProjects] = useState([]);
  const [realTimeData, setRealTimeData] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [isDeployed, setIsDeployed] = useState(null);
  const [checkingDeployment, setCheckingDeployment] = useState(true);
  
  // Determine where the back button should go
  const getBackUrl = () => {
    if (from === 'editor' && queryProjectId) {
      return `/editor?project=${queryProjectId}`;
    }
    return '/projects';
  };
  
  const getBackButtonText = () => {
    return from === 'editor' && queryProjectId ? 'Back to Editor' : 'Back to Projects';
  };
  
  // Redirect if not authenticated
  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/');
    }
  }, [session, status, router]);
  
  // Set selected project from query parameter
  useEffect(() => {
    if (queryProjectId) {
      setSelectedProject(queryProjectId);
    }
  }, [queryProjectId]);
  
  // Check deployment status and handle mode switching
  useEffect(() => {
    if (!session || !queryProjectId) return;
    
    const checkDeploymentStatus = async () => {
      setCheckingDeployment(true);
      try {
        const response = await fetch(`/api/projects/${queryProjectId}`);
        const data = await response.json();
        
        const deployed = !!(data.project?.deployed_url || data.project?.deployment_status === 'deployed');
        setIsDeployed(deployed);
        
        // Handle automatic mode switching
        if (deployed && preview === 'true') {
          // Project is now deployed but we're in preview mode - switch to real data
          router.push({
            pathname: router.pathname,
            query: { 
              projectId: queryProjectId,
              from: from || 'projects'
              // Remove preview parameter to show real data
            }
          }, undefined, { shallow: true });
        } else if (!deployed && !preview) {
          // Project not deployed and not in preview mode - enable preview
          router.push({
            pathname: router.pathname,
            query: { 
              ...router.query, 
              preview: 'true' 
            }
          }, undefined, { shallow: true });
        }
      } catch (error) {
        console.error('Error checking deployment:', error);
        setIsDeployed(false);
      } finally {
        setCheckingDeployment(false);
      }
    };
    
    checkDeploymentStatus();
  }, [session, queryProjectId, preview, from, router]);
  
  // Load analytics data
  useEffect(() => {
    if (!session || checkingDeployment) return;
    loadAnalytics();
  }, [session, timeRange, selectedProject, isDeployed, checkingDeployment]);
  
  // Load user projects
  useEffect(() => {
    if (!session) return;
    loadProjects();
  }, [session]);
  
  // Real-time updates via WebSocket (only for deployed sites)
  useEffect(() => {
    if (!session || selectedProject === 'all' || !isDeployed || preview === 'true') return;
    
    let ws;
    const connectWebSocket = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/api/analytics/stream?projectId=${selectedProject}`);
      
      ws.onopen = () => {
        console.log('Analytics WebSocket connected');
        setWsConnected(true);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'analytics_event' || data.type === 'metric_update') {
            handleRealTimeUpdate(data.data);
          }
        } catch (error) {
          console.error('WebSocket message error:', error);
        }
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setWsConnected(false);
      };
      
      ws.onclose = () => {
        console.log('Analytics WebSocket disconnected');
        setWsConnected(false);
        // Reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
      };
    };
    
    connectWebSocket();
    
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [session, selectedProject, isDeployed, preview]);
  
  // Generate mock data for preview mode
  const getMockAnalyticsData = () => {
    const today = new Date();
    const dailyData = [];
    
    // Generate 7 days of mock data
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      dailyData.push({
        date: date.toISOString().split('T')[0],
        views: Math.floor(Math.random() * 500) + 100,
        unique_sessions: Math.floor(Math.random() * 300) + 50,
        avg_load_time: Math.floor(Math.random() * 1000) + 500
      });
    }
    
    return {
      summary: {
        pageViews: 2847,
        uniqueVisitors: 1523,
        avgLoadTime: 742,
        errorRate: 0.3
      },
      daily: dailyData,
      topPages: [
        { page: '/', views: 1250 },
        { page: '/about', views: 623 },
        { page: '/products', views: 489 },
        { page: '/contact', views: 234 },
        { page: '/blog', views: 189 }
      ],
      browsers: [
        { browser: 'Chrome', count: 1123 },
        { browser: 'Safari', count: 567 },
        { browser: 'Firefox', count: 234 },
        { browser: 'Edge', count: 123 }
      ],
      topFeatures: [
        { feature: 'Contact Form', usage_count: 234 },
        { feature: 'Newsletter Signup', usage_count: 189 },
        { feature: 'Product Search', usage_count: 156 },
        { feature: 'Shopping Cart', usage_count: 98 }
      ],
      projectMetrics: selectedProject !== 'all' ? [{
        id: selectedProject,
        name: projects.find(p => p.id === selectedProject)?.name || 'Current Project',
        views: 2847,
        unique_visitors: 1523,
        avg_load_time: 742
      }] : [],
      registeredUsers: 47,
      newSignups: 12,
      conversionRate: 3.1,
      users: [
        { id: '1', email: 'john@example.com', first_seen: '2025-02-25T10:00:00Z', last_seen: '2025-03-02T14:30:00Z', total_sessions: 8, total_page_views: 45, auth_provider: 'google' },
        { id: '2', email: 'sarah@company.co', first_seen: '2025-02-20T09:00:00Z', last_seen: '2025-03-01T16:45:00Z', total_sessions: 15, total_page_views: 89, auth_provider: 'email' },
        { id: '3', email: 'mike@startup.io', first_seen: '2025-02-28T11:30:00Z', last_seen: '2025-03-02T09:15:00Z', total_sessions: 3, total_page_views: 12, auth_provider: 'github' },
        { id: '4', email: 'emma@design.studio', first_seen: '2025-03-01T08:00:00Z', last_seen: '2025-03-02T11:00:00Z', total_sessions: 2, total_page_views: 8, auth_provider: 'google' },
        { id: '5', email: 'alex@tech.dev', first_seen: '2025-02-15T14:00:00Z', last_seen: '2025-02-28T10:30:00Z', total_sessions: 22, total_page_views: 156, auth_provider: 'email' }
      ]
    };
  };
  
  const loadAnalytics = async () => {
    setLoading(true);
    try {
      // Use preview mode if not deployed OR explicitly in preview
      const usePreviewData = !isDeployed || preview === 'true';
      
      if (usePreviewData) {
        // Show mock data
        setTimeout(() => {
          setAnalytics(getMockAnalyticsData());
          setLoading(false);
        }, 1000);
        return;
      }
      
      // Load real analytics data
      const url = selectedProject === 'all' 
        ? `/api/analytics/dashboard?timeRange=${timeRange}`
        : `/api/analytics/dashboard?projectId=${selectedProject}&timeRange=${timeRange}`;
        
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setAnalytics(data.data);
      } else {
        console.error('Failed to load analytics');
        // Fallback to preview mode if API fails
        setAnalytics(getMockAnalyticsData());
      }
    } catch (error) {
      console.error('Error loading analytics:', error);
      // Fallback to preview mode on error
      setAnalytics(getMockAnalyticsData());
    } finally {
      setLoading(false);
    }
  };
  
  const loadProjects = async () => {
    try {
      const response = await fetch('/api/projects');
      if (response.ok) {
        const data = await response.json();
        setProjects(data.projects || []);
      }
    } catch (error) {
      console.error('Error loading projects:', error);
    }
  };
  
  const handleRealTimeUpdate = (data) => {
    setRealTimeData(prev => {
      const updated = [...prev, {
        ...data,
        timestamp: new Date().toLocaleTimeString(),
        value: data.metric?.count || 1
      }];
      // Keep only last 50 data points
      return updated.slice(-50);
    });
  };
  
  const exportData = async (format) => {
    try {
      const response = await fetch(`/api/analytics/export?format=${format}&timeRange=${timeRange}`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `analytics-${timeRange}.${format}`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Error exporting data:', error);
    }
  };
  
  const formatNumber = (num) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num?.toString() || '0';
  };
  
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatUserDate = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    // Less than 1 hour
    if (diff < 3600000) {
      const mins = Math.floor(diff / 60000);
      return `${mins}m ago`;
    }
    // Less than 24 hours
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }
    // Less than 7 days
    if (diff < 604800000) {
      const days = Math.floor(diff / 86400000);
      return `${days}d ago`;
    }
    // Otherwise show date
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  
  // Smart banner that shows different messages based on state
  const StatusBanner = () => {
    if (checkingDeployment || loading) return null;
    
    if (!isDeployed) {
      return (
        <div style={styles.warningBanner}>
          <div style={styles.bannerContent}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#856404" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>Preview Mode: This is sample data. Deploy your site to start collecting real analytics!</span>
            <button
              onClick={() => router.push(`/editor?project=${queryProjectId}`)}
              style={styles.bannerButton}
            >
              Go Deploy →
            </button>
          </div>
        </div>
      );
    }
    
    if (isDeployed && preview === 'true') {
      return (
        <div style={styles.infoBanner}>
          <div style={styles.bannerContent}>
            <Icons.Eye />
            <span>Preview Mode Active: Showing sample data.</span>
            <button
              onClick={() => {
                router.push({
                  pathname: router.pathname,
                  query: { 
                    projectId: queryProjectId,
                    from: from || 'projects'
                  }
                });
              }}
              style={styles.bannerButtonAlt}
            >
              Show Real Data →
            </button>
          </div>
        </div>
      );
    }
    
    // Show success banner for recently deployed sites with no data yet
    if (isDeployed && !preview && (!analytics?.summary?.pageViews || analytics?.summary?.pageViews === 0)) {
      return (
        <div style={styles.successBanner}>
          <div style={styles.bannerContent}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#155724" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <span>Site Deployed! Analytics data will appear as visitors arrive.</span>
            <a 
              href={projects.find(p => p.id === selectedProject)?.deployed_url}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.bannerLink}
            >
              Visit your site
            </a>
            <span>to generate the first data point!</span>
          </div>
        </div>
      );
    }
    
    return null;
  };
  
  // Add toggle button in header for manual preview control
  const PreviewToggle = () => {
    if (!isDeployed) return null; // Only show for deployed sites
    
    return (
      <button
        onClick={() => {
          router.push({
            pathname: router.pathname,
            query: {
              ...router.query,
              preview: preview === 'true' ? undefined : 'true'
            }
          });
        }}
        style={styles.toggleButton}
      >
        <Icons.Eye />
        {preview === 'true' ? 'Preview Data' : 'Real Data'}
      </button>
    );
  };
  
  if (loading || checkingDeployment) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <div style={styles.spinner}>
            <Icons.Spinner />
          </div>
          <p>Loading analytics...</p>
        </div>
      </div>
    );
  }
  
  const COLORS = ['#00D9FF', '#00F5A0', '#FFD700', '#FF8042', '#8884D8'];
  
  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <div style={styles.headerLeft}>
            <button onClick={() => router.push(getBackUrl())} style={styles.backButton}>
              <Icons.ArrowLeft />
              {getBackButtonText()}
            </button>
            <div style={styles.logo}>
              <img src="/Ezcoder Logo.png" alt="EzCoder" style={styles.logoIcon} />
              <h1 style={styles.title}>Analytics Dashboard</h1>
            </div>
            {wsConnected && isDeployed && !preview && (
              <span style={styles.liveIndicator}>
                <span style={styles.liveDot}>●</span> Live
              </span>
            )}
          </div>
          
          <div style={styles.headerRight}>
            <PreviewToggle />
            
            <select 
              value={selectedProject} 
              onChange={(e) => {
                setSelectedProject(e.target.value);
                // Update URL to reflect the selected project
                if (e.target.value !== 'all') {
                  router.push(`/analytics?projectId=${e.target.value}&from=${from || 'projects'}`, undefined, { shallow: true });
                } else {
                  router.push('/analytics', undefined, { shallow: true });
                }
              }}
              style={styles.select}
            >
              <option value="all">All Projects</option>
              {projects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            
            <select 
              value={timeRange} 
              onChange={(e) => setTimeRange(e.target.value)}
              style={styles.select}
            >
              <option value="1h">Last Hour</option>
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
            </select>
            
            <button onClick={() => exportData('csv')} style={styles.exportButton}>
              <Icons.Download />
              Export CSV
            </button>
            <button onClick={() => exportData('json')} style={styles.exportButton}>
              <Icons.Download />
              Export JSON
            </button>
          </div>
        </div>
      </header>
      
      <StatusBanner />
      
      {/* Summary Cards */}
      <div style={styles.summarySection}>
        <div style={styles.summaryGrid}>
          <div style={styles.summaryCard}>
            <div style={styles.cardIcon}>
              <Icons.Activity />
            </div>
            <h3 style={styles.cardTitle}>Total Views</h3>
            <div style={styles.cardValue}>
              {formatNumber(analytics?.summary?.pageViews || 0)}
            </div>
            <div style={styles.cardChange}>
              <span style={styles.changePositive}>↑ 12%</span> from last period
            </div>
          </div>
          
          <div style={styles.summaryCard}>
            <div style={styles.cardIcon}>
              <Icons.Users />
            </div>
            <h3 style={styles.cardTitle}>Unique Visitors</h3>
            <div style={styles.cardValue}>
              {formatNumber(analytics?.summary?.uniqueVisitors || 0)}
            </div>
            <div style={styles.cardChange}>
              <span style={styles.changePositive}>↑ 8%</span> from last period
            </div>
          </div>
          
          <div style={styles.summaryCard}>
            <div style={styles.cardIcon}>
              <Icons.Clock />
            </div>
            <h3 style={styles.cardTitle}>Avg Load Time</h3>
            <div style={styles.cardValue}>
              {analytics?.summary?.avgLoadTime || 0}ms
            </div>
            <div style={styles.cardChange}>
              <span style={styles.changePositive}>↓ 15%</span> improvement
            </div>
          </div>
          
          <div style={styles.summaryCard}>
            <div style={styles.cardIcon}>
              <Icons.AlertCircle />
            </div>
            <h3 style={styles.cardTitle}>Error Rate</h3>
            <div style={styles.cardValue}>
              {analytics?.summary?.errorRate || 0}%
            </div>
            <div style={styles.cardChange}>
              <span style={styles.changeNegative}>↑ 2%</span> from last period
            </div>
          </div>

          <div style={styles.summaryCard}>
            <div style={{ ...styles.cardIcon, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10B981' }}>
              <Icons.UserCheck />
            </div>
            <h3 style={styles.cardTitle}>Registered Users</h3>
            <div style={styles.cardValue}>
              {formatNumber(analytics?.registeredUsers || analytics?.users?.length || 0)}
            </div>
            <div style={styles.cardChange}>
              <span style={styles.changePositive}>+{analytics?.newSignups || 0}</span> new this period
            </div>
          </div>

          <div style={styles.summaryCard}>
            <div style={{ ...styles.cardIcon, backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#8B5CF6' }}>
              <Icons.ChartBar />
            </div>
            <h3 style={styles.cardTitle}>Conversion Rate</h3>
            <div style={styles.cardValue}>
              {analytics?.conversionRate ||
                (analytics?.summary?.uniqueVisitors && analytics?.registeredUsers
                  ? ((analytics.registeredUsers / analytics.summary.uniqueVisitors) * 100).toFixed(1)
                  : '0'
                )}%
            </div>
            <div style={styles.cardChange}>
              Visitors → Signups
            </div>
          </div>
        </div>
      </div>
      
      {/* Charts */}
      <div style={styles.chartsSection}>
        <div style={styles.chartsGrid}>
          {/* Traffic Over Time */}
          <div style={styles.chartCard}>
            <h3 style={styles.chartTitle}>Traffic Over Time</h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={analytics?.daily || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="date" stroke="#6B7280" tickFormatter={formatDate} />
                <YAxis stroke="#6B7280" />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
                  labelStyle={{ color: '#1A1A2E' }}
                />
                <Area type="monotone" dataKey="views" stroke="#00D9FF" fill="#00D9FF" fillOpacity={0.1} />
                <Area type="monotone" dataKey="unique_sessions" stroke="#00F5A0" fill="#00F5A0" fillOpacity={0.1} />
                <Legend />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          
          {/* Performance Metrics */}
          <div style={styles.chartCard}>
            <h3 style={styles.chartTitle}>Performance Metrics</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={analytics?.daily || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="date" stroke="#6B7280" tickFormatter={formatDate} />
                <YAxis stroke="#6B7280" />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
                  labelStyle={{ color: '#1A1A2E' }}
                />
                <Line type="monotone" dataKey="avg_load_time" stroke="#FFD700" strokeWidth={2} dot={false} />
                <Legend />
              </LineChart>
            </ResponsiveContainer>
          </div>
          
          {/* Top Pages */}
          <div style={styles.chartCard}>
            <h3 style={styles.chartTitle}>Top Pages</h3>
            <div style={styles.tableContainer}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Page</th>
                    <th style={styles.th}>Views</th>
                    <th style={styles.th}>% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(analytics?.topPages || []).slice(0, 10).map((page, idx) => {
                    const percentage = analytics?.summary?.pageViews 
                      ? ((page.views / analytics.summary.pageViews) * 100).toFixed(1)
                      : 0;
                    
                    return (
                      <tr key={idx}>
                        <td style={styles.td}>{page.page || '/'}</td>
                        <td style={styles.td}>{formatNumber(page.views)}</td>
                        <td style={styles.td}>
                          <div style={styles.percentageBar}>
                            <div 
                              style={{
                                ...styles.percentageFill,
                                width: `${percentage}%`
                              }}
                            />
                            <span style={styles.percentageText}>{percentage}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          
          {/* Browser Distribution */}
          <div style={styles.chartCard}>
            <h3 style={styles.chartTitle}>Browser Distribution</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={analytics?.browsers || []}
                  dataKey="count"
                  nameKey="browser"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={(entry) => entry.browser}
                  labelLine={false}
                >
                  {(analytics?.browsers || []).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
                  labelStyle={{ color: '#1A1A2E' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          
          {/* Real-time Activity - only show for deployed sites with real data */}
          {selectedProject !== 'all' && realTimeData.length > 0 && isDeployed && !preview && (
            <div style={styles.chartCard}>
              <h3 style={styles.chartTitle}>
                Real-time Activity
                <span style={styles.realTimeCount}>({realTimeData.length} events)</span>
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={realTimeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="timestamp" stroke="#6B7280" />
                  <YAxis stroke="#6B7280" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
                    labelStyle={{ color: '#1A1A2E' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="value" 
                    stroke="#00F5A0" 
                    strokeWidth={2}
                    dot={false} 
                    animationDuration={0}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          
          {/* Top Features */}
          <div style={styles.chartCard}>
            <h3 style={styles.chartTitle}>Feature Usage</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={analytics?.topFeatures || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="feature" stroke="#6B7280" angle={-45} textAnchor="end" height={80} />
                <YAxis stroke="#6B7280" />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
                  labelStyle={{ color: '#1A1A2E' }}
                />
                <Bar dataKey="usage_count" fill="#00D9FF" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      
      {/* Registered Users Section */}
      {selectedProject !== 'all' && analytics?.users && analytics.users.length > 0 && (
        <div style={styles.tableSection}>
          <div style={styles.tableCard}>
            <h3 style={styles.chartTitle}>
              <span>Registered Users</span>
              <span style={styles.userCount}>{analytics.users.length} users</span>
            </h3>
            <div style={styles.tableContainer}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Email</th>
                    <th style={styles.th}>Provider</th>
                    <th style={styles.th}>First Seen</th>
                    <th style={styles.th}>Last Seen</th>
                    <th style={styles.th}>Sessions</th>
                    <th style={styles.th}>Page Views</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.users.map((user) => (
                    <tr key={user.id || user.external_user_id}>
                      <td style={styles.td}>
                        <div style={styles.userEmail}>
                          <span style={styles.userAvatar}>
                            {(user.email || 'U')[0].toUpperCase()}
                          </span>
                          {user.email || 'Unknown'}
                        </div>
                      </td>
                      <td style={styles.td}>
                        <span style={styles.providerBadge}>
                          {user.auth_provider || 'email'}
                        </span>
                      </td>
                      <td style={styles.td}>{formatUserDate(user.first_seen)}</td>
                      <td style={styles.td}>{formatUserDate(user.last_seen)}</td>
                      <td style={styles.td}>{user.total_sessions || 1}</td>
                      <td style={styles.td}>{user.total_page_views || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Project Metrics Table */}
      {selectedProject === 'all' && (analytics?.projectMetrics?.length > 0) && (
        <div style={styles.tableSection}>
          <div style={styles.tableCard}>
            <h3 style={styles.chartTitle}>Project Performance</h3>
            <div style={styles.tableContainer}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Project</th>
                    <th style={styles.th}>Views</th>
                    <th style={styles.th}>Unique Visitors</th>
                    <th style={styles.th}>Avg Load Time</th>
                    <th style={styles.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(analytics?.projectMetrics || []).map((project) => (
                    <tr key={project.id}>
                      <td style={styles.td}>{project.name}</td>
                      <td style={styles.td}>{formatNumber(project.views || 0)}</td>
                      <td style={styles.td}>{formatNumber(project.unique_visitors || 0)}</td>
                      <td style={styles.td}>{Math.round(project.avg_load_time || 0)}ms</td>
                      <td style={styles.td}>
                        <button 
                          onClick={() => {
                            setSelectedProject(project.id);
                            router.push(`/analytics?projectId=${project.id}&from=${from || 'projects'}`);
                          }}
                          style={styles.viewButton}
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#FAFBFC',
    color: '#1A1A2E',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    gap: '1rem'
  },
  
  spinner: {
    fontSize: '3rem',
    color: '#00D9FF'
  },
  
  header: {
    backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #E5E7EB',
    padding: '1rem 0',
    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    position: 'sticky',
    top: 0,
    zIndex: 100
  },
  
  headerContent: {
    maxWidth: '1400px',
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 2rem',
    flexWrap: 'wrap',
    gap: '1rem'
  },
  
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    flexWrap: 'wrap'
  },
  
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    flexWrap: 'wrap'
  },
  
  backButton: {
    backgroundColor: 'transparent',
    color: '#00D9FF',
    border: '2px solid #00D9FF',
    padding: '0.5rem 1rem',
    borderRadius: '9999px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontFamily: 'inherit'
  },
  
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  
  logoIcon: {
    width: '32px',
    height: '32px',
    objectFit: 'contain'
  },
  
  title: {
    margin: 0,
    fontSize: '1.5rem',
    fontWeight: '600',
    background: 'linear-gradient(135deg, #00D9FF 0%, #00A8CC 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text'
  },
  
  liveIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.875rem',
    color: '#10B981',
    backgroundColor: '#D1FAE5',
    padding: '0.25rem 0.75rem',
    borderRadius: '9999px',
    border: '1px solid #10B981'
  },
  
  liveDot: {
    animation: 'pulse 2s infinite',
    color: '#10B981'
  },
  
  select: {
    backgroundColor: '#F6F8FA',
    color: '#1A1A2E',
    border: '1px solid #E5E7EB',
    padding: '0.5rem 1rem',
    borderRadius: '9999px',
    fontSize: '14px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: '500'
  },
  
  exportButton: {
    backgroundColor: 'transparent',
    color: '#00D9FF',
    border: '2px solid #00D9FF',
    padding: '0.5rem 1rem',
    borderRadius: '9999px',
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontFamily: 'inherit'
  },
  
  toggleButton: {
    backgroundColor: '#F6F8FA',
    color: '#1A1A2E',
    border: '1px solid #E5E7EB',
    padding: '0.5rem 1rem',
    borderRadius: '9999px',
    fontSize: '14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontWeight: '500',
    fontFamily: 'inherit'
  },
  
  summarySection: {
    padding: '2rem',
    backgroundColor: '#FAFBFC'
  },
  
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '1.5rem',
    maxWidth: '1400px',
    margin: '0 auto'
  },
  
  summaryCard: {
    backgroundColor: '#FFFFFF',
    padding: '1.5rem',
    borderRadius: '16px',
    border: '1px solid #E5E7EB',
    transition: 'transform 0.2s, box-shadow 0.2s',
    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
  },
  
  cardIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '48px',
    height: '48px',
    marginBottom: '1rem',
    backgroundColor: 'rgba(0, 217, 255, 0.1)',
    borderRadius: '12px',
    color: '#00D9FF'
  },
  
  cardTitle: {
    margin: '0 0 0.5rem',
    fontSize: '0.875rem',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    fontWeight: '600'
  },
  
  cardValue: {
    fontSize: '2rem',
    fontWeight: '700',
    margin: '0.5rem 0',
    color: '#1A1A2E',
    background: 'linear-gradient(135deg, #00D9FF 0%, #00A8CC 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text'
  },
  
  cardChange: {
    fontSize: '0.875rem',
    color: '#6B7280'
  },
  
  changePositive: {
    color: '#10B981',
    fontWeight: '600'
  },
  
  changeNegative: {
    color: '#EF4444',
    fontWeight: '600'
  },
  
  chartsSection: {
    padding: '0 2rem 2rem',
    backgroundColor: '#FAFBFC'
  },
  
  chartsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))',
    gap: '1.5rem',
    maxWidth: '1400px',
    margin: '0 auto'
  },
  
  chartCard: {
    backgroundColor: '#FFFFFF',
    padding: '1.5rem',
    borderRadius: '16px',
    border: '1px solid #E5E7EB',
    overflow: 'hidden',
    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
  },
  
  chartTitle: {
    margin: '0 0 1rem',
    fontSize: '1.125rem',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    color: '#1A1A2E'
  },
  
  realTimeCount: {
    fontSize: '0.875rem',
    color: '#10B981',
    fontWeight: 'normal'
  },
  
  tableSection: {
    padding: '0 2rem 2rem',
    backgroundColor: '#FAFBFC'
  },
  
  tableCard: {
    backgroundColor: '#FFFFFF',
    padding: '1.5rem',
    borderRadius: '16px',
    border: '1px solid #E5E7EB',
    maxWidth: '1400px',
    margin: '0 auto',
    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
  },
  
  tableContainer: {
    overflowX: 'auto'
  },
  
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  
  th: {
    textAlign: 'left',
    padding: '0.75rem',
    borderBottom: '2px solid #E5E7EB',
    color: '#6B7280',
    fontWeight: '600',
    fontSize: '0.875rem',
    whiteSpace: 'nowrap',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  
  td: {
    padding: '0.75rem',
    borderBottom: '1px solid #E5E7EB',
    fontSize: '0.875rem',
    color: '#1A1A2E'
  },
  
  viewButton: {
    backgroundColor: '#00D9FF',
    color: '#FFFFFF',
    border: 'none',
    padding: '0.25rem 0.75rem',
    borderRadius: '9999px',
    cursor: 'pointer',
    fontSize: '12px',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
    fontWeight: '600',
    fontFamily: 'inherit'
  },
  
  percentageBar: {
    position: 'relative',
    backgroundColor: '#F3F4F6',
    height: '20px',
    borderRadius: '9999px',
    overflow: 'hidden'
  },
  
  percentageFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    backgroundColor: '#00D9FF',
    transition: 'width 0.3s ease'
  },
  
  percentageText: {
    position: 'relative',
    display: 'block',
    textAlign: 'center',
    lineHeight: '20px',
    fontSize: '0.75rem',
    fontWeight: '600',
    zIndex: 1,
    color: '#1A1A2E'
  },
  
  // Status Banners
  warningBanner: {
    backgroundColor: '#FFF3CD',
    borderBottom: '1px solid #FFEEBA',
    padding: '0.75rem 0'
  },
  
  infoBanner: {
    backgroundColor: '#D1ECF1',
    borderBottom: '1px solid #BEE5EB',
    padding: '0.75rem 0'
  },
  
  successBanner: {
    backgroundColor: '#D4EDDA',
    borderBottom: '1px solid #C3E6CB',
    padding: '0.75rem 0'
  },
  
  bannerContent: {
    maxWidth: '1400px',
    margin: '0 auto',
    padding: '0 2rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1rem',
    fontSize: '14px',
    fontWeight: '500'
  },
  
  bannerButton: {
    backgroundColor: '#FFC107',
    color: '#212529',
    border: 'none',
    padding: '0.25rem 0.75rem',
    borderRadius: '9999px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '600',
    fontFamily: 'inherit',
    transition: 'all 0.2s'
  },
  
  bannerButtonAlt: {
    backgroundColor: '#17A2B8',
    color: '#FFFFFF',
    border: 'none',
    padding: '0.25rem 0.75rem',
    borderRadius: '9999px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '600',
    fontFamily: 'inherit',
    transition: 'all 0.2s'
  },
  
  bannerLink: {
    color: '#155724',
    textDecoration: 'underline',
    fontWeight: '600'
  },

  // Registered Users section
  userCount: {
    fontSize: '0.875rem',
    color: '#10B981',
    fontWeight: '500'
  },

  userEmail: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem'
  },

  userAvatar: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: '#00D9FF',
    color: '#FFFFFF',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '600',
    fontSize: '14px'
  },

  providerBadge: {
    display: 'inline-block',
    padding: '0.25rem 0.5rem',
    backgroundColor: '#F3F4F6',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    fontWeight: '500',
    color: '#6B7280',
    textTransform: 'capitalize'
  },

  // Responsive
  '@media (max-width: 768px)': {
    headerContent: {
      flexDirection: 'column',
      gap: '1rem'
    },
    
    headerLeft: {
      width: '100%',
      justifyContent: 'center'
    },
    
    headerRight: {
      width: '100%',
      justifyContent: 'center'
    },
    
    chartsGrid: {
      gridTemplateColumns: '1fr',
      gap: '1.5rem'
    }
  }
};