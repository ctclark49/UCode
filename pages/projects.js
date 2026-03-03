// pages/projects.js - Modern professional version
import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { modernTheme } from '../lib/theme';

// Safe date formatter that won't crash
const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  
  try {
    // Handle various date formats
    let date;
    
    // If it's already a valid date string
    if (typeof dateString === 'string') {
      // Remove any timezone suffix that might cause issues
      const cleanDate = dateString.split('.')[0] + 'Z';
      date = new Date(cleanDate);
    } else if (dateString instanceof Date) {
      date = dateString;
    } else {
      return 'N/A';
    }
    
    // Check if date is valid
    if (isNaN(date.getTime())) {
      console.warn('Invalid date:', dateString);
      return 'N/A';
    }
    
    // Format the date
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
    
  } catch (error) {
    console.error('Date formatting error:', error, 'for date:', dateString);
    return 'N/A';
  }
};

export default function ProjectsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userStats, setUserStats] = useState(null);
  const [tokenBalance, setTokenBalance] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [createError, setCreateError] = useState("");
  const [actionLoading, setActionLoading] = useState(null);
  const [createSuccess, setCreateSuccess] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Track if we've loaded projects at least once (for new user redirect logic)
  // We only redirect new users to editor on INITIAL component mount, not after deleting projects
  // This prevents the unwanted redirect when a user deletes all their projects
  const hasLoadedProjectsRef = useRef(false);

  // Check authentication
  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/");
      return;
    }
    loadProjects();
    loadUserStats();
    loadTokenBalance();
  }, [session, status, router]);

  const loadProjects = async () => {
    try {
      console.log('Loading projects...');
      const response = await fetch('/api/projects');
      const data = await response.json();

      if (response.ok) {
        // Clean up project dates before setting state
        const cleanProjects = (data.projects || []).map(project => ({
          ...project,
          // Ensure we have valid dates or fallback to N/A
          created_at: project.created_at || project.createdAt || null,
          updated_at: project.updated_at || project.updatedAt || null,
          createdAt: project.created_at || project.createdAt || null,
          updatedAt: project.updated_at || project.updatedAt || null
        }));

        console.log('Loaded projects:', cleanProjects.length);

        // NEW USER FLOW: Only redirect to editor for auto-create on INITIAL page load
        // This ensures:
        // 1. New users (first login, 0 projects) get seamlessly redirected to editor
        // 2. Users who delete all their projects stay on projects page with "Create New" option
        //
        // We use hasLoadedProjectsRef to track if we've already fetched projects once.
        // If this is the first fetch AND there are 0 projects, redirect to editor.
        // If we've already loaded projects before (e.g., after deletion), stay on this page.
        if (cleanProjects.length === 0 && !hasLoadedProjectsRef.current) {
          console.log('New user with no projects on initial load - redirecting to editor for auto-create');
          hasLoadedProjectsRef.current = true; // Mark that we've loaded projects
          router.replace('/editor');
          return;
        }

        // Mark that we've loaded projects (for subsequent calls like after deletion)
        hasLoadedProjectsRef.current = true;

        // User with projects OR user who deleted all projects - show the project list
        setProjects(cleanProjects);
      } else {
        console.error('Failed to load projects:', data.error);
        setProjects([]);
      }
    } catch (error) {
      console.error('Error loading projects:', error);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  const loadUserStats = async () => {
    try {
      const response = await fetch('/api/user/stats');
      const data = await response.json();
      
      if (response.ok) {
        setUserStats(data.stats);
      } else {
        console.error('Failed to load user stats:', data.error);
        // Set default stats
        setUserStats({
          subscription_tier: 'starter',
          usage_count: 0,
          usage_limit: 3,
          project_count: 0,
          total_generations: 0
        });
      }
    } catch (error) {
      console.error('Error loading user stats:', error);
      // Set default stats
      setUserStats({
        subscription_tier: 'starter',
        usage_count: 0,
        usage_limit: 3,
        project_count: 0,
        total_generations: 0
      });
    }
  };

  const loadTokenBalance = async () => {
    try {
      const response = await fetch('/api/user/tokens');
      const data = await response.json();

      if (response.ok) {
        setTokenBalance(data);
      } else {
        console.error('Failed to load token balance:', data.error);
        setTokenBalance({ totalAvailable: 0, subscription: 'free' });
      }
    } catch (error) {
      console.error('Error loading token balance:', error);
      setTokenBalance({ totalAvailable: 0, subscription: 'free' });
    }
  };

  // Create project function
  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      setCreateError("Project name is required");
      return;
    }

    // Prevent multiple clicks
    if (actionLoading === 'create' || createSuccess) {
      return;
    }

    setActionLoading('create');
    setCreateError("");
    setCreateSuccess(false);

    try {
      console.log('Creating project:', newProjectName);
      
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newProjectName.trim(),
          description: newProjectDescription.trim(),
        }),
      });

      const data = await response.json();
      console.log('Create project response:', data);

      if (response.ok && data.project) {
        setCreateSuccess(true);
        
        // Clear form
        setNewProjectName("");
        setNewProjectDescription("");
        
        // Reload projects
        await loadProjects();
        
        // Close modal and navigate after a short delay
        setTimeout(() => {
          setShowCreateModal(false);
          setCreateSuccess(false);
          setActionLoading(null);
          router.push(`/editor?project=${data.project.id}`);
        }, 500);
        
      } else {
        setCreateError(data.error || 'Failed to create project');
        setActionLoading(null);
      }
    } catch (error) {
      console.error('Create project error:', error);
      setCreateError('Network error. Please try again.');
      setActionLoading(null);
    }
  };

  const handleOpenProject = (projectId) => {
    console.log('Opening project:', projectId);
    router.push(`/editor?project=${projectId}`);
  };

  const handleDeleteProject = async (projectId) => {
    setActionLoading('delete');
    setDeleteError("");

    try {
      console.log('Deleting project:', projectId);
      
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      console.log('Delete response:', data);

      if (response.ok) {
        setShowDeleteModal(null);
        await loadProjects();
        await loadUserStats();
      } else {
        setDeleteError(data.error || 'Failed to delete project');
        console.error('Delete failed:', data);
      }
    } catch (error) {
      console.error('Delete error:', error);
      setDeleteError('Network error. Please try again.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDuplicateProject = async (projectId) => {
    if (actionLoading) return;
    
    setActionLoading('duplicate-' + projectId);

    try {
      // Get the project to duplicate
      const projectResponse = await fetch(`/api/projects/${projectId}`);
      const projectData = await projectResponse.json();
      
      if (!projectResponse.ok) {
        throw new Error('Failed to load project');
      }

      // Create a new project with the same files
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `${projectData.project.name} (Copy)`,
          description: projectData.project.description || '',
          files: projectData.project.files
        }),
      });

      const data = await response.json();

      if (response.ok) {
        await loadProjects();
        await loadUserStats();
      } else {
        alert(`Failed to duplicate project: ${data.error}`);
      }
    } catch (error) {
      alert('Failed to duplicate project. Please try again.');
    } finally {
      setActionLoading(null);
    }
  };

  const canCreateProject = () => {
    if (!userStats) return true;
    
    const limits = {
      'starter': 3,
      'creator': -1,
      'business': -1
    };
    
    const limit = limits[userStats.subscription_tier] || 3;
    return limit === -1 || projects.length < limit;
  };

  if (status === "loading" || loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingContainer}>
          <div style={styles.loadingSpinner}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={modernTheme.colors.primary} strokeWidth="2">
              <path d="M21 12a9 9 0 11-6.219-8.56"/>
            </svg>
          </div>
          <h2>Loading your workspace...</h2>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <div style={styles.headerLeft}>
            <button onClick={() => router.push("/")} style={styles.backButton}>
              ← Home
            </button>
            <div style={styles.logo}>
              <img src="/Ezcoder Logo.png" alt="EzCoder" style={styles.logoIcon} /> 
              <span style={styles.logoText}>EzCoder Workspace</span>
            </div>
          </div>
          <div style={styles.headerRight}>
            <span style={styles.userWelcome}>
              {session.user.name || session.user.email}
            </span>
            <button onClick={() => router.push("/billing")} style={styles.billingButton}>
              Billing
            </button>
          </div>
        </div>
      </header>

      {/* Stats Section */}
      {userStats && (
        <div style={styles.statsSection}>
          <div style={styles.statsGrid}>
            <div style={styles.statCard}>
              <div style={styles.statIcon}>
                {/* Credit card icon for Subscription */}
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                  <line x1="1" y1="10" x2="23" y2="10"/>
                </svg>
              </div>
              <h3>Subscription</h3>
              <div style={styles.statValue}>{userStats.subscription_tier.toUpperCase()}</div>
              <div style={styles.statLabel}>Current Plan</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statIcon}>
                {/* Folder icon for Projects */}
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <h3>Projects</h3>
              <div style={styles.statValue}>
                {projects.length}
                {userStats.subscription_tier === 'starter' ? '/3' : ''}
              </div>
              <div style={styles.statLabel}>Active Projects</div>
            </div>
            <div style={styles.statCard}>
              <div style={{
                ...styles.statIcon,
                backgroundColor: tokenBalance && tokenBalance.totalAvailable < 5000
                  ? `${modernTheme.colors.warning}20`
                  : `${modernTheme.colors.primary}10`,
                color: tokenBalance && tokenBalance.totalAvailable < 5000
                  ? modernTheme.colors.warning
                  : modernTheme.colors.primary
              }}>
                {/* Coins/Token icon */}
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="8"/>
                  <path d="M12 2v2"/>
                  <path d="M12 20v2"/>
                  <path d="m4.93 4.93 1.41 1.41"/>
                  <path d="m17.66 17.66 1.41 1.41"/>
                  <path d="M2 12h2"/>
                  <path d="M20 12h2"/>
                  <path d="m6.34 17.66-1.41 1.41"/>
                  <path d="m19.07 4.93-1.41 1.41"/>
                </svg>
              </div>
              <h3>AI Tokens</h3>
              <div style={{
                ...styles.statValue,
                background: tokenBalance && tokenBalance.totalAvailable < 5000
                  ? modernTheme.colors.warning
                  : modernTheme.gradients.primary,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text"
              }}>
                {tokenBalance
                  ? tokenBalance.totalAvailable?.toLocaleString() || '0'
                  : '—'}
              </div>
              <div style={styles.statLabel}>
                {tokenBalance?.hasDailyLimit
                  ? `Daily: ${tokenBalance.dailyTokensRemaining?.toLocaleString() || 0} remaining`
                  : 'Available for AI generation'}
              </div>
              {tokenBalance && tokenBalance.totalAvailable < 5000 && (
                <button
                  onClick={() => router.push("/billing#buy-tokens")}
                  style={styles.addTokensButton}
                >
                  + Add Tokens
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div style={styles.mainContent}>
        <div style={styles.projectsHeader}>
          <h1 style={styles.pageTitle}>Your Projects</h1>
          <button 
            onClick={() => {
              setShowCreateModal(true);
              setCreateError("");
              setCreateSuccess(false);
              setActionLoading(null);
            }}
            disabled={!canCreateProject() && userStats}
            style={{
              ...styles.createButton,
              opacity: (!canCreateProject() && userStats) ? 0.5 : 1,
              cursor: (!canCreateProject() && userStats) ? 'not-allowed' : 'pointer'
            }}
          >
            + New Project
          </button>
        </div>

        {userStats && !canCreateProject() && userStats.subscription_tier === 'starter' && (
          <div style={styles.limitWarning}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={modernTheme.colors.warning} strokeWidth="2" style={{flexShrink: 0}}>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>You've reached your project limit ({projects.length}/3).</span>
            <button 
              onClick={() => router.push("/billing")}
              style={styles.upgradeLink}
            >
              Upgrade to create unlimited projects
            </button>
          </div>
        )}

        {/* Projects Grid */}
        {projects.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke={modernTheme.colors.primary} strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <line x1="9" y1="9" x2="15" y2="9"/>
                <line x1="9" y1="13" x2="15" y2="13"/>
                <line x1="9" y1="17" x2="11" y2="17"/>
              </svg>
            </div>
            <h2>Start your first project</h2>
            <p>Create powerful applications with AI assistance. From concept to deployment in minutes.</p>
            <button 
              onClick={() => setShowCreateModal(true)}
              style={styles.emptyStateButton}
              disabled={!canCreateProject()}
            >
              Create Your First Project
            </button>
          </div>
        ) : (
          <div style={styles.projectsGrid}>
            {projects.map((project) => (
              <div key={project.id} style={styles.projectCard}>
                <div style={styles.projectHeader}>
                  <h3 style={styles.projectName}>{project.name}</h3>
                  <div style={styles.projectActions}>
                    <button
                      onClick={() => handleOpenProject(project.id)}
                      style={styles.actionButton}
                      title="Open project"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDuplicateProject(project.id)}
                      disabled={actionLoading === 'duplicate-' + project.id || (!canCreateProject() && userStats)}
                      style={{
                        ...styles.actionButton,
                        opacity: (actionLoading === 'duplicate-' + project.id || (!canCreateProject() && userStats)) ? 0.5 : 1
                      }}
                      title="Duplicate project"
                    >
                      {actionLoading === 'duplicate-' + project.id ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 12a9 9 0 11-6.219-8.56"/>
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={() => setShowDeleteModal(project.id)}
                      style={styles.deleteButton}
                      title="Delete project"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      </svg>
                    </button>
                  </div>
                </div>
                
                {project.description && (
                  <p style={styles.projectDescription}>{project.description}</p>
                )}
                
                <div style={styles.projectMeta}>
                  <div style={styles.projectDates}>
                    <div style={styles.dateInfo}>
                      <span style={styles.dateLabel}>Created:</span>
                      <span style={styles.dateValue}>{formatDate(project.created_at)}</span>
                    </div>
                    <div style={styles.dateInfo}>
                      <span style={styles.dateLabel}>Modified:</span>
                      <span style={styles.dateValue}>{formatDate(project.updated_at)}</span>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => handleOpenProject(project.id)}
                    style={styles.openButton}
                  >
                    Open in Editor →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Project Modal */}
      {showCreateModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.createModal}>
            <button 
              onClick={() => {
                if (actionLoading !== 'create') {
                  setShowCreateModal(false);
                  setNewProjectName("");
                  setNewProjectDescription("");
                  setCreateError("");
                  setCreateSuccess(false);
                  setActionLoading(null);
                }
              }}
              style={styles.modalCloseBtn}
              disabled={actionLoading === 'create'}
            >
              ×
            </button>
            
            <h3 style={styles.modalTitle}>Create New Project</h3>
            <p style={styles.modalSubtext}>
              Give your project a name and let AI help you build something amazing
            </p>

            {createError && (
              <div style={styles.errorMessage}>
                {createError}
              </div>
            )}

            {createSuccess && (
              <div style={styles.successMessage}>
                Project created successfully! Redirecting to editor...
              </div>
            )}

            <input
              type="text"
              placeholder="Project name (e.g., My SaaS Dashboard)"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              style={styles.modalInput}
              autoFocus
              disabled={actionLoading === 'create'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && actionLoading !== 'create') {
                  handleCreateProject();
                }
              }}
            />

            <textarea
              placeholder="Project description (optional)"
              value={newProjectDescription}
              onChange={(e) => setNewProjectDescription(e.target.value)}
              style={styles.modalTextarea}
              rows={3}
              disabled={actionLoading === 'create'}
            />

            <div style={styles.modalButtons}>
              <button 
                onClick={() => {
                  if (actionLoading !== 'create') {
                    setShowCreateModal(false);
                    setNewProjectName("");
                    setNewProjectDescription("");
                    setCreateError("");
                    setCreateSuccess(false);
                    setActionLoading(null);
                  }
                }}
                style={styles.cancelButton}
                disabled={actionLoading === 'create'}
              >
                Cancel
              </button>
              <button 
                onClick={handleCreateProject}
                disabled={actionLoading === 'create' || !newProjectName.trim()}
                style={{
                  ...styles.createButtonModal,
                  opacity: (actionLoading === 'create' || !newProjectName.trim()) ? 0.6 : 1
                }}
              >
                {actionLoading === 'create' ? "Creating..." : "Create Project"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.deleteModal}>
            <button 
              onClick={() => {
                setShowDeleteModal(null);
                setDeleteError("");
              }}
              style={styles.modalCloseBtn}
            >
              ×
            </button>
            
            <div style={styles.deleteIcon}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={modernTheme.colors.error} strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
            </div>
            
            <h3 style={styles.deleteTitle}>Delete Project</h3>
            <p style={styles.modalSubtext}>
              Are you sure you want to delete this project? This action cannot be undone and all project files will be permanently removed.
            </p>

            {deleteError && (
              <div style={styles.errorMessage}>
                {deleteError}
              </div>
            )}

            <div style={styles.modalButtons}>
              <button 
                onClick={() => {
                  setShowDeleteModal(null);
                  setDeleteError("");
                }}
                style={styles.cancelButton}
              >
                Cancel
              </button>
              <button 
                onClick={() => handleDeleteProject(showDeleteModal)}
                disabled={actionLoading === 'delete'}
                style={{
                  ...styles.deleteButtonModal,
                  opacity: actionLoading === 'delete' ? 0.6 : 1
                }}
              >
                {actionLoading === 'delete' ? "Deleting..." : "Delete Project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Modern professional styles
const styles = {
  container: {
    backgroundColor: modernTheme.colors.bgPrimary,
    color: modernTheme.colors.text,
    fontFamily: modernTheme.typography.fontFamily.sans,
    minHeight: "100vh"
  },
  
  loadingContainer: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    height: "100vh",
    textAlign: "center",
    gap: "1rem"
  },
  
  loadingSpinner: {
    animation: "spin 1s linear infinite"
  },

  // Header
  header: {
    backgroundColor: modernTheme.colors.bgSecondary,
    borderBottom: `1px solid ${modernTheme.colors.border}`,
    padding: "1rem 0",
    boxShadow: modernTheme.shadows.sm,
    position: "sticky",
    top: 0,
    zIndex: 100
  },
  headerContent: {
    maxWidth: "1200px",
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0 2rem"
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "1rem"
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "1rem"
  },
  backButton: {
    backgroundColor: "transparent",
    color: modernTheme.colors.primary,
    border: `2px solid ${modernTheme.colors.primary}`,
    padding: "0.5rem 1rem",
    cursor: "pointer",
    fontFamily: "inherit",
    borderRadius: modernTheme.borderRadius.full,
    transition: modernTheme.transitions.base,
    fontWeight: modernTheme.typography.fontWeight.medium
  },
  logo: {
    fontSize: "1.5rem",
    fontWeight: "bold",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem"
  },
  logoIcon: {
    width: "32px",
    height: "32px",
    objectFit: "contain"
  },
  logoText: {
    background: modernTheme.gradients.primary,
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text"
  },
  userWelcome: {
    fontSize: modernTheme.typography.fontSize.sm,
    color: modernTheme.colors.textLight
  },
  billingButton: {
    background: modernTheme.gradients.primary,
    color: modernTheme.colors.textOnDark,
    border: "none",
    padding: "0.5rem 1.5rem",
    cursor: "pointer",
    fontFamily: "inherit",
    borderRadius: modernTheme.borderRadius.full,
    fontWeight: modernTheme.typography.fontWeight.semibold,
    transition: modernTheme.transitions.base,
    boxShadow: modernTheme.shadows.md
  },

  // Stats Section
  statsSection: {
    backgroundColor: modernTheme.colors.bgTertiary,
    borderBottom: `1px solid ${modernTheme.colors.border}`,
    padding: "2rem"
  },
  statsGrid: {
    maxWidth: "1200px",
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: "1.5rem"
  },
  statCard: {
    backgroundColor: modernTheme.colors.bgSecondary,
    border: `1px solid ${modernTheme.colors.border}`,
    borderRadius: modernTheme.borderRadius.xl,
    padding: "1.5rem",
    textAlign: "center",
    transition: modernTheme.transitions.base,
    boxShadow: modernTheme.shadows.sm
  },
  statIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "48px",
    height: "48px",
    marginBottom: "0.5rem",
    backgroundColor: `${modernTheme.colors.primary}10`,
    borderRadius: modernTheme.borderRadius.full,
    color: modernTheme.colors.primary
  },
  statValue: {
    fontSize: modernTheme.typography.fontSize['3xl'],
    fontWeight: modernTheme.typography.fontWeight.bold,
    background: modernTheme.gradients.primary,
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    margin: "0.5rem 0"
  },
  statLabel: {
    fontSize: modernTheme.typography.fontSize.sm,
    color: modernTheme.colors.textLight
  },
  addTokensButton: {
    marginTop: "0.75rem",
    background: modernTheme.gradients.primary,
    color: modernTheme.colors.textOnDark,
    border: "none",
    padding: "0.4rem 1rem",
    cursor: "pointer",
    fontFamily: "inherit",
    borderRadius: modernTheme.borderRadius.full,
    fontWeight: modernTheme.typography.fontWeight.semibold,
    fontSize: modernTheme.typography.fontSize.sm,
    transition: modernTheme.transitions.base,
    boxShadow: modernTheme.shadows.sm
  },

  // Main Content
  mainContent: {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "2rem"
  },
  projectsHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "2rem"
  },
  pageTitle: {
    fontSize: modernTheme.typography.fontSize['4xl'],
    fontWeight: modernTheme.typography.fontWeight.bold,
    margin: 0
  },
  createButton: {
    background: modernTheme.gradients.primary,
    color: modernTheme.colors.textOnDark,
    border: "none",
    padding: "0.75rem 1.5rem",
    cursor: "pointer",
    fontFamily: "inherit",
    borderRadius: modernTheme.borderRadius.full,
    fontWeight: modernTheme.typography.fontWeight.bold,
    fontSize: modernTheme.typography.fontSize.base,
    transition: modernTheme.transitions.base,
    boxShadow: modernTheme.shadows.md
  },
  limitWarning: {
    backgroundColor: `${modernTheme.colors.warning}10`,
    border: `1px solid ${modernTheme.colors.warning}30`,
    borderRadius: modernTheme.borderRadius.lg,
    padding: "1rem",
    marginBottom: "2rem",
    textAlign: "center",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    color: modernTheme.colors.text
  },
  upgradeLink: {
    backgroundColor: "transparent",
    color: modernTheme.colors.primary,
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    textDecoration: "underline",
    marginLeft: "0.5rem",
    fontWeight: modernTheme.typography.fontWeight.medium
  },

  // Empty State
  emptyState: {
    textAlign: "center",
    padding: "4rem 2rem",
    backgroundColor: modernTheme.colors.bgSecondary,
    borderRadius: modernTheme.borderRadius['2xl'],
    border: `1px solid ${modernTheme.colors.border}`,
    boxShadow: modernTheme.shadows.md
  },
  emptyIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: "1rem"
  },
  emptyStateButton: {
    background: modernTheme.gradients.primary,
    color: modernTheme.colors.textOnDark,
    border: "none",
    padding: "1rem 2rem",
    cursor: "pointer",
    fontFamily: "inherit",
    borderRadius: modernTheme.borderRadius.full,
    fontWeight: modernTheme.typography.fontWeight.bold,
    fontSize: modernTheme.typography.fontSize.lg,
    marginTop: "1rem",
    transition: modernTheme.transitions.base,
    boxShadow: modernTheme.shadows.lg
  },

  // Projects Grid
  projectsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))",
    gap: "1.5rem"
  },
  projectCard: {
    backgroundColor: modernTheme.colors.bgSecondary,
    border: `1px solid ${modernTheme.colors.border}`,
    borderRadius: modernTheme.borderRadius.xl,
    padding: "1.5rem",
    transition: modernTheme.transitions.base,
    boxShadow: modernTheme.shadows.sm
  },
  projectHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "1rem"
  },
  projectName: {
    margin: 0,
    background: modernTheme.gradients.primary,
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    fontSize: modernTheme.typography.fontSize.xl,
    flex: 1
  },
  projectActions: {
    display: "flex",
    gap: "0.5rem"
  },
  actionButton: {
    backgroundColor: modernTheme.colors.bgTertiary,
    color: modernTheme.colors.text,
    border: `1px solid ${modernTheme.colors.border}`,
    padding: "0.5rem",
    cursor: "pointer",
    fontFamily: "inherit",
    borderRadius: modernTheme.borderRadius.md,
    fontSize: modernTheme.typography.fontSize.base,
    transition: modernTheme.transitions.base,
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  },
  deleteButton: {
    backgroundColor: `${modernTheme.colors.error}10`,
    color: modernTheme.colors.error,
    border: `1px solid ${modernTheme.colors.error}30`,
    padding: "0.5rem",
    cursor: "pointer",
    fontFamily: "inherit",
    borderRadius: modernTheme.borderRadius.md,
    fontSize: modernTheme.typography.fontSize.base,
    transition: modernTheme.transitions.base,
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  },
  projectDescription: {
    margin: "0 0 1rem 0",
    color: modernTheme.colors.textLight,
    fontSize: modernTheme.typography.fontSize.base,
    lineHeight: modernTheme.typography.lineHeight.relaxed
  },
  projectMeta: {
    borderTop: `1px solid ${modernTheme.colors.border}`,
    paddingTop: "1rem"
  },
  projectDates: {
    marginBottom: "1rem"
  },
  dateInfo: {
    display: "flex",
    justifyContent: "space-between",
    margin: "0.25rem 0",
    fontSize: modernTheme.typography.fontSize.sm
  },
  dateLabel: {
    color: modernTheme.colors.textLight
  },
  dateValue: {
    color: modernTheme.colors.primary,
    fontWeight: modernTheme.typography.fontWeight.medium
  },
  openButton: {
    background: modernTheme.gradients.primary,
    color: modernTheme.colors.textOnDark,
    border: "none",
    padding: "0.75rem 1rem",
    cursor: "pointer",
    fontFamily: "inherit",
    borderRadius: modernTheme.borderRadius.full,
    fontWeight: modernTheme.typography.fontWeight.semibold,
    width: "100%",
    transition: modernTheme.transitions.base,
    boxShadow: modernTheme.shadows.sm
  },

  // Modal Styles
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: modernTheme.colors.overlay,
    backdropFilter: "blur(8px)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
    padding: "2rem"
  },
  createModal: {
    backgroundColor: modernTheme.colors.bgSecondary,
    border: `2px solid ${modernTheme.colors.primary}`,
    borderRadius: modernTheme.borderRadius['2xl'],
    padding: "2rem",
    maxWidth: "500px",
    width: "100%",
    position: "relative",
    boxShadow: modernTheme.shadows.xl
  },
  deleteModal: {
    backgroundColor: modernTheme.colors.bgSecondary,
    border: `2px solid ${modernTheme.colors.error}`,
    borderRadius: modernTheme.borderRadius['2xl'],
    padding: "2rem",
    maxWidth: "400px",
    width: "100%",
    position: "relative",
    boxShadow: modernTheme.shadows.xl,
    textAlign: "center"
  },
  deleteIcon: {
    display: "flex",
    justifyContent: "center",
    marginBottom: "1rem"
  },
  deleteTitle: {
    marginBottom: "0.5rem",
    color: modernTheme.colors.error,
    fontSize: modernTheme.typography.fontSize['2xl'],
    fontWeight: modernTheme.typography.fontWeight.bold
  },
  modalCloseBtn: {
    position: "absolute",
    top: "1rem",
    right: "1rem",
    background: modernTheme.colors.bgTertiary,
    border: `1px solid ${modernTheme.colors.border}`,
    color: modernTheme.colors.text,
    fontSize: "1.2rem",
    cursor: "pointer",
    width: "32px",
    height: "32px",
    borderRadius: modernTheme.borderRadius.full,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: modernTheme.transitions.base
  },
  modalTitle: {
    marginBottom: "0.5rem",
    background: modernTheme.gradients.primary,
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    fontSize: modernTheme.typography.fontSize['2xl']
  },
  modalSubtext: {
    marginBottom: "1.5rem",
    color: modernTheme.colors.textLight,
    fontSize: modernTheme.typography.fontSize.base
  },
  errorMessage: {
    backgroundColor: `${modernTheme.colors.error}10`,
    color: modernTheme.colors.error,
    padding: "0.75rem",
    borderRadius: modernTheme.borderRadius.md,
    marginBottom: "1rem",
    fontSize: modernTheme.typography.fontSize.sm,
    border: `1px solid ${modernTheme.colors.error}30`
  },
  successMessage: {
    backgroundColor: `${modernTheme.colors.success}10`,
    color: modernTheme.colors.success,
    padding: "0.75rem",
    borderRadius: modernTheme.borderRadius.md,
    marginBottom: "1rem",
    fontSize: modernTheme.typography.fontSize.sm,
    border: `1px solid ${modernTheme.colors.success}30`
  },
  modalInput: {
    width: "100%",
    padding: "0.75rem",
    backgroundColor: modernTheme.colors.bgTertiary,
    color: modernTheme.colors.text,
    border: `1px solid ${modernTheme.colors.border}`,
    borderRadius: modernTheme.borderRadius.lg,
    fontSize: modernTheme.typography.fontSize.base,
    fontFamily: "inherit",
    marginBottom: "1rem",
    transition: modernTheme.transitions.base
  },
  modalTextarea: {
    width: "100%",
    padding: "0.75rem",
    backgroundColor: modernTheme.colors.bgTertiary,
    color: modernTheme.colors.text,
    border: `1px solid ${modernTheme.colors.border}`,
    borderRadius: modernTheme.borderRadius.lg,
    fontSize: modernTheme.typography.fontSize.base,
    fontFamily: "inherit",
    marginBottom: "1.5rem",
    resize: "vertical",
    transition: modernTheme.transitions.base
  },
  modalButtons: {
    display: "flex",
    gap: "1rem",
    justifyContent: "flex-end"
  },
  cancelButton: {
    backgroundColor: "transparent",
    color: modernTheme.colors.text,
    border: `2px solid ${modernTheme.colors.border}`,
    padding: "0.5rem 1.5rem",
    borderRadius: modernTheme.borderRadius.full,
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: modernTheme.typography.fontWeight.medium,
    transition: modernTheme.transitions.base
  },
  createButtonModal: {
    background: modernTheme.gradients.primary,
    color: modernTheme.colors.textOnDark,
    border: "none",
    padding: "0.5rem 1.5rem",
    borderRadius: modernTheme.borderRadius.full,
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: modernTheme.typography.fontWeight.bold,
    transition: modernTheme.transitions.base,
    boxShadow: modernTheme.shadows.md
  },
  deleteButtonModal: {
    background: modernTheme.gradients.accent,
    color: modernTheme.colors.textOnDark,
    border: "none",
    padding: "0.5rem 1.5rem",
    borderRadius: modernTheme.borderRadius.full,
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: modernTheme.typography.fontWeight.bold,
    transition: modernTheme.transitions.base,
    boxShadow: modernTheme.shadows.md
  }
};