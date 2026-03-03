import { useState, useEffect } from 'react';

/**
 * Activity Monitor Component
 * Displays editor activity history: AI generations, file changes, deployments
 */
export default function ActivityMonitor({ projectId, userId }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all', 'ai', 'files', 'deploy'

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }

    loadActivity();
  }, [projectId]);

  const loadActivity = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/projects/${projectId}/activity`);

      if (!res.ok) {
        throw new Error('Failed to fetch activity');
      }

      const data = await res.json();
      setActivities(data.activities || []);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch activity:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getActivityIcon = (type) => {
    switch (type) {
      case 'ai_message':
      case 'assistant':
        return { icon: 'AI', color: '#8B5CF6' };
      case 'user_message':
      case 'user':
        return { icon: 'You', color: '#3B82F6' };
      case 'file_created':
        return { icon: '+', color: '#10B981' };
      case 'file_modified':
      case 'file_updated':
        return { icon: '~', color: '#F59E0B' };
      case 'file_deleted':
        return { icon: '-', color: '#EF4444' };
      case 'deployment':
        return { icon: '>>', color: '#00D9FF' };
      case 'generation_started':
        return { icon: '...', color: '#8B5CF6' };
      case 'generation_completed':
        return { icon: 'OK', color: '#10B981' };
      default:
        return { icon: '*', color: '#6B7280' };
    }
  };

  const getFilteredActivities = () => {
    if (filter === 'all') return activities;

    const filterMap = {
      'ai': ['ai_message', 'assistant', 'user_message', 'user', 'generation_started', 'generation_completed'],
      'files': ['file_created', 'file_modified', 'file_updated', 'file_deleted'],
      'deploy': ['deployment']
    };

    return activities.filter(a => filterMap[filter]?.includes(a.type));
  };

  const filteredActivities = getFilteredActivities();

  // Calculate stats
  const stats = {
    aiMessages: activities.filter(a => ['ai_message', 'assistant'].includes(a.type)).length,
    fileChanges: activities.filter(a => ['file_created', 'file_modified', 'file_updated', 'file_deleted'].includes(a.type)).length,
    deployments: activities.filter(a => a.type === 'deployment').length
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingText}>
          <div style={styles.spinner} />
          Loading activity...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={{ ...styles.loadingText, color: '#EF4444' }}>
          Error: {error}
          <button
            onClick={loadActivity}
            style={styles.retryButton}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Stats Summary */}
      <div style={styles.statsBar}>
        <StatPill
          label="AI"
          value={stats.aiMessages}
          color="#8B5CF6"
          active={filter === 'ai'}
          onClick={() => setFilter(filter === 'ai' ? 'all' : 'ai')}
        />
        <StatPill
          label="Files"
          value={stats.fileChanges}
          color="#F59E0B"
          active={filter === 'files'}
          onClick={() => setFilter(filter === 'files' ? 'all' : 'files')}
        />
        <StatPill
          label="Deploys"
          value={stats.deployments}
          color="#00D9FF"
          active={filter === 'deploy'}
          onClick={() => setFilter(filter === 'deploy' ? 'all' : 'deploy')}
        />
        {filter !== 'all' && (
          <button
            onClick={() => setFilter('all')}
            style={styles.clearFilter}
          >
            Clear
          </button>
        )}
      </div>

      {/* Activity Timeline */}
      <div style={styles.timeline}>
        {filteredActivities.length === 0 ? (
          <div style={styles.emptyState}>
            {filter === 'all'
              ? 'No activity yet. Start chatting with AI to build your project!'
              : `No ${filter} activity found.`
            }
          </div>
        ) : (
          filteredActivities.slice(0, 50).map((activity, i) => {
            const { icon, color } = getActivityIcon(activity.type);
            return (
              <div key={activity.id || i} style={styles.activityItem}>
                <div style={{ ...styles.activityIcon, backgroundColor: color }}>
                  {icon}
                </div>
                <div style={styles.activityContent}>
                  <div style={styles.activityHeader}>
                    <span style={styles.activityTitle}>{activity.title}</span>
                    <span style={styles.activityTime}>{formatTime(activity.timestamp)}</span>
                  </div>
                  {activity.preview && (
                    <div style={styles.activityPreview}>
                      {activity.preview}
                    </div>
                  )}
                  {activity.files && activity.files.length > 0 && (
                    <div style={styles.activityFiles}>
                      {activity.files.slice(0, 3).map((file, j) => (
                        <span key={j} style={styles.fileTag}>{file}</span>
                      ))}
                      {activity.files.length > 3 && (
                        <span style={styles.moreFiles}>+{activity.files.length - 3} more</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Refresh Button */}
      <div style={styles.footer}>
        <button onClick={loadActivity} style={styles.refreshButton}>
          Refresh
        </button>
        <span style={styles.footerText}>
          Showing {filteredActivities.length} of {activities.length} activities
        </span>
      </div>
    </div>
  );
}

function StatPill({ label, value, color, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...styles.statPill,
        backgroundColor: active ? color : 'transparent',
        borderColor: color,
        color: active ? '#fff' : color
      }}
    >
      <span style={styles.statValue}>{value}</span>
      <span style={styles.statLabel}>{label}</span>
    </button>
  );
}

function formatTime(timestamp) {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return date.toLocaleDateString();
  } catch (error) {
    return timestamp || 'Unknown';
  }
}

const styles = {
  container: {
    backgroundColor: '#FAFBFC',
    borderRadius: '12px',
    padding: '16px',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  loadingText: {
    color: '#6B7280',
    textAlign: 'center',
    padding: '40px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px'
  },
  spinner: {
    width: '24px',
    height: '24px',
    border: '2px solid #E5E7EB',
    borderTopColor: '#3B82F6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  retryButton: {
    marginTop: '8px',
    padding: '6px 12px',
    backgroundColor: '#3B82F6',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px'
  },
  statsBar: {
    display: 'flex',
    gap: '8px',
    marginBottom: '16px',
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  statPill: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    border: '1px solid',
    borderRadius: '20px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
    transition: 'all 0.15s ease'
  },
  statValue: {
    fontWeight: '600'
  },
  statLabel: {
    opacity: 0.9
  },
  clearFilter: {
    marginLeft: 'auto',
    padding: '4px 10px',
    background: 'transparent',
    border: '1px solid #E5E7EB',
    borderRadius: '4px',
    color: '#6B7280',
    fontSize: '12px',
    cursor: 'pointer'
  },
  timeline: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  emptyState: {
    color: '#9CA3AF',
    textAlign: 'center',
    padding: '40px 20px',
    fontSize: '14px'
  },
  activityItem: {
    display: 'flex',
    gap: '12px',
    padding: '12px',
    backgroundColor: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid #E5E7EB'
  },
  activityIcon: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: '11px',
    fontWeight: '700',
    flexShrink: 0
  },
  activityContent: {
    flex: 1,
    minWidth: 0
  },
  activityHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '8px',
    marginBottom: '4px'
  },
  activityTitle: {
    color: '#1F2937',
    fontSize: '13px',
    fontWeight: '500',
    lineHeight: '1.4'
  },
  activityTime: {
    color: '#9CA3AF',
    fontSize: '11px',
    flexShrink: 0
  },
  activityPreview: {
    color: '#6B7280',
    fontSize: '12px',
    lineHeight: '1.4',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    marginTop: '4px'
  },
  activityFiles: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    marginTop: '8px'
  },
  fileTag: {
    padding: '2px 8px',
    backgroundColor: '#F3F4F6',
    borderRadius: '4px',
    fontSize: '11px',
    color: '#4B5563',
    fontFamily: 'monospace'
  },
  moreFiles: {
    padding: '2px 8px',
    fontSize: '11px',
    color: '#9CA3AF'
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '12px',
    paddingTop: '12px',
    borderTop: '1px solid #E5E7EB'
  },
  refreshButton: {
    padding: '6px 12px',
    backgroundColor: '#F3F4F6',
    border: '1px solid #E5E7EB',
    borderRadius: '6px',
    color: '#374151',
    fontSize: '12px',
    cursor: 'pointer',
    fontWeight: '500'
  },
  footerText: {
    color: '#9CA3AF',
    fontSize: '11px'
  }
};
