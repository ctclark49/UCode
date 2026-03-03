/**
 * ProductionAIChat - UNIFIED AI Chat Component
 *
 * This is the ONLY AI chat component that should be used.
 * Replaces: AssistantUIComplete, UnifiedAgentChat
 *
 * FEATURES:
 * - Full tool execution with visual feedback
 * - Bidirectional file sync
 * - Chat history persistence
 * - Error boundaries with graceful degradation
 * - Capability status indicators
 * - Streaming with proper parsing
 * - Mobile responsive
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
// flushSync removed - it was blocking the stream reader event loop
import { useSession } from 'next-auth/react';
import {
  useProductionFileStore,
  fileEventBus,
  normalizePath
} from '../lib/stores/ProductionFileStore';
import { useAgenticGeneration } from '../lib/hooks/useAgenticGeneration';
import { usePreDisplayValidation } from '../lib/hooks/usePreDisplayValidation';
import ChatTokenDepletionModal, { useChatTokenDepletion } from './ChatTokenDepletionModal';
import DatabaseConnectionModal from './DatabaseConnectionModal';

// REMOVED: formatProgressMessage function
// Progress messages like "Analyzing request...", "Creating plan..." were being shown to users
// but the desired UX is conversational text + tool icons only, no visible progress stages

// ============== ERROR BOUNDARY ==============

class ChatErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ProductionAIChat] Error caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '24px',
          background: 'linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(185,28,28,0.04) 100%)',
          border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: '12px',
          margin: '16px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
        }}>
          <h3 style={{ color: '#dc2626', margin: '0 0 10px 0', fontSize: '16px' }}>Chat Error</h3>
          <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 16px 0' }}>
            {this.state.error?.message || 'Something went wrong'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onReset?.();
            }}
            style={{
              background: 'linear-gradient(135deg, #00D9FF 0%, #00A8CC 100%)',
              color: 'white',
              border: 'none',
              padding: '10px 24px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '13px',
              boxShadow: '0 2px 12px rgba(0, 217, 255, 0.3)'
            }}
          >
            Reset Chat
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// ============== ICONS ==============

const Icons = {
  Send: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
    </svg>
  ),
  Stop: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2"/>
    </svg>
  ),
  File: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
      <path d="M13 2v7h7"/>
    </svg>
  ),
  Terminal: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 17l6-6-6-6M12 19h8"/>
    </svg>
  ),
  Check: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 6L9 17l-5-5"/>
    </svg>
  ),
  X: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6L6 18M6 6l12 12"/>
    </svg>
  ),
  Loader: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
  ),
  Warning: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  Cloud: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
    </svg>
  ),
  CloudOff: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3"/>
    </svg>
  ),
  User: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  Bot: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="10" rx="2"/>
      <circle cx="12" cy="5" r="2"/>
      <path d="M12 7v4"/>
    </svg>
  ),
  Clear: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
  )
};

// ============== TEXT RENDERING HELPERS ==============

/**
 * Clean AI text for professional display
 * - Removes emojis and excessive symbols
 * - Strips markdown formatting
 * - Normalizes whitespace
 */
function cleanAIText(text) {
  if (typeof text !== 'string') return text;

  return text
    // Remove emojis (Unicode emoji ranges)
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // Emoticons
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '') // Misc Symbols and Pictographs
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // Transport and Map
    .replace(/[\u{1F700}-\u{1F77F}]/gu, '') // Alchemical Symbols
    .replace(/[\u{1F780}-\u{1F7FF}]/gu, '') // Geometric Shapes
    .replace(/[\u{1F800}-\u{1F8FF}]/gu, '') // Supplemental Arrows
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '') // Supplemental Symbols
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '') // Chess Symbols
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '') // Symbols and Pictographs Extended-A
    .replace(/[\u{2600}-\u{26FF}]/gu, '')   // Misc symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, '')   // Dingbats
    // Remove markdown bold/italic
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')    // ***bold italic***
    .replace(/\*\*(.*?)\*\*/g, '$1')        // **bold**
    .replace(/\*(.*?)\*/g, '$1')            // *italic*
    .replace(/__(.*?)__/g, '$1')            // __bold__
    .replace(/_(.*?)_/g, '$1')              // _italic_
    // Remove markdown headers but keep text
    .replace(/^#{1,6}\s+/gm, '')
    // Remove markdown links, keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove inline code backticks
    .replace(/`([^`]+)`/g, '$1')
    // Remove excessive punctuation/symbols
    .replace(/[✓✔✗✘•·]/g, '')
    .replace(/[-=]{3,}/g, '')               // Remove --- or === lines
    // Normalize whitespace
    .replace(/^\s*[\r\n]/gm, '\n')          // Remove blank lines at start
    .replace(/\n{3,}/g, '\n\n')             // Max 2 newlines
    .trim();
}

/**
 * Render text as clean paragraphs
 */
function TextBlock({ content }) {
  const cleanedText = cleanAIText(content);

  // Split into paragraphs
  const paragraphs = cleanedText.split(/\n\n+/).filter(p => p.trim());

  return (
    <>
      {paragraphs.map((para, idx) => (
        <p
          key={idx}
          style={{
            margin: idx === 0 ? 0 : '8px 0 0 0',
            color: '#334155',
            fontSize: '14px',
            lineHeight: '1.6',
            wordBreak: 'break-word'
          }}
        >
          {para.split('\n').map((line, lineIdx) => (
            <React.Fragment key={lineIdx}>
              {lineIdx > 0 && <br />}
              {line}
            </React.Fragment>
          ))}
        </p>
      ))}
    </>
  );
}

// ============== TOOL RESULT DISPLAY ==============

function ToolResultCard({ toolName, args, result, isExecuting }) {
  const [expanded, setExpanded] = useState(false);

  // Ensure toolName is a string to prevent runtime errors
  const safeName = toolName || 'unknown';

  // Get professional display name and description for tool operations
  const getToolDisplay = () => {
    const filePath = args?.file_path || args?.path || '';
    const fileName = filePath.split('/').pop() || filePath;

    // Map tool names to professional action labels
    if (safeName.includes('write') || safeName === 'writeFile' || safeName === 'createFile') {
      return {
        action: 'Created',
        description: fileName || 'new file',
        icon: <Icons.File />
      };
    }
    if (safeName.includes('edit') || safeName === 'editFile' || safeName === 'updateFile') {
      return {
        action: 'Edited',
        description: fileName || 'file',
        icon: <Icons.File />
      };
    }
    if (safeName.includes('read') || safeName === 'readFile') {
      return {
        action: 'Read',
        description: fileName || 'file',
        icon: <Icons.File />
      };
    }
    if (safeName.includes('delete') || safeName === 'deleteFile' || safeName === 'removeFile') {
      return {
        action: 'Deleted',
        description: fileName || 'file',
        icon: <Icons.File />
      };
    }
    if (safeName === 'bash' || safeName.includes('terminal') || safeName.includes('exec')) {
      const cmd = args?.command || '';
      const shortCmd = cmd.length > 40 ? cmd.substring(0, 40) + '...' : cmd;
      return {
        action: 'Ran',
        description: shortCmd || 'command',
        icon: <Icons.Terminal />
      };
    }
    if (safeName.includes('Package') || safeName.includes('install') || safeName.includes('npm')) {
      return {
        action: 'Installed',
        description: args?.packages?.join(', ') || 'packages',
        icon: <Icons.Terminal />
      };
    }
    if (safeName.includes('git')) {
      return {
        action: 'Git',
        description: args?.action || 'operation',
        icon: <Icons.Terminal />
      };
    }
    // Default fallback - still professional
    return {
      action: 'Executed',
      description: safeName.replace(/([A-Z])/g, ' $1').trim().toLowerCase(),
      icon: <Icons.Check />
    };
  };

  const toolDisplay = getToolDisplay();

  const getStatusColor = () => {
    if (isExecuting) return '#00D9FF';
    if (result?.success) return '#22c55e';
    if (result?.error) return '#ef4444';
    return '#6b7280';
  };

  const getStatusIcon = () => {
    if (isExecuting) return <Icons.Loader />;
    if (result?.success) return <Icons.Check />;
    if (result?.error) return <Icons.X />;
    return null;
  };

  return (
    <div style={{
      backgroundColor: '#ffffff',
      border: `1px solid ${getStatusColor()}30`,
      borderRadius: '10px',
      marginTop: '8px',
      overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 12px',
          cursor: 'pointer',
          backgroundColor: `${getStatusColor()}08`
        }}
      >
        <span style={{ color: getStatusColor() }}>{toolDisplay.icon}</span>
        <span style={{ color: '#334155', fontSize: '13px', fontWeight: 500 }}>
          {toolDisplay.action}
        </span>
        <span style={{
          color: '#0ea5e9',
          fontSize: '13px',
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
          backgroundColor: '#f0f9ff',
          padding: '2px 6px',
          borderRadius: '4px'
        }}>
          {toolDisplay.description}
        </span>
        <span style={{ marginLeft: 'auto', color: getStatusColor() }}>
          {getStatusIcon()}
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '12px', borderTop: '1px solid #f1f5f9' }}>
          {/* Arguments */}
          {args && Object.keys(args).length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ color: '#64748b', fontSize: '11px', marginBottom: '4px' }}>Arguments:</div>
              <pre style={{
                backgroundColor: '#f8fafc',
                padding: '8px',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#475569',
                overflow: 'auto',
                maxHeight: '150px',
                margin: 0,
                border: '1px solid #e2e8f0'
              }}>
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}

          {/* Result */}
          {result && (
            <div>
              <div style={{ color: '#64748b', fontSize: '11px', marginBottom: '4px' }}>Result:</div>
              <pre style={{
                backgroundColor: '#f8fafc',
                padding: '8px',
                borderRadius: '6px',
                fontSize: '11px',
                color: result.success ? '#16a34a' : '#dc2626',
                overflow: 'auto',
                maxHeight: '200px',
                margin: 0,
                border: '1px solid #e2e8f0'
              }}>
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============== MESSAGE COMPONENT ==============

/**
 * ChatMessage - Renders messages with SEQUENTIAL content parts
 *
 * Like Claude Code / Lovable, content is rendered in ORDER:
 * - Text explanation
 * - Tool call (with status)
 * - More text explanation
 * - Another tool call
 * - etc.
 *
 * This creates a natural "explain → act → explain" flow
 */
function ChatMessage({ message, isLast }) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  // Build ordered content parts for sequential rendering
  // If message has contentParts array, use that (new format)
  // Otherwise fall back to legacy format (text + toolCalls)
  //
  // CRITICAL: Use _updateKey to force re-renders when tool state changes
  // React's shallow comparison won't detect array content mutations
  const contentParts = useMemo(() => {
    // Force useMemo to recognize _updateKey changes
    const _ = message._updateKey;

    if (message.contentParts && Array.isArray(message.contentParts)) {
      // Return a fresh copy to ensure React detects changes
      return [...message.contentParts];
    }

    // Legacy format: convert to parts
    const parts = [];

    if (message.content) {
      parts.push({ type: 'text', content: message.content });
    }

    if (message.toolCalls) {
      for (const tc of message.toolCalls) {
        const result = message.toolResults?.find(r => r.toolCallId === tc.toolCallId);
        parts.push({
          type: 'tool',
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: tc.args,
          result: result?.result,
          isExecuting: !result
        });
      }
    }

    return parts;
  }, [message.content, message.contentParts, message.toolCalls, message.toolResults, message._updateKey]);

  return (
    <div style={{
      display: 'flex',
      gap: '12px',
      padding: '16px 20px',
      backgroundColor: isUser ? 'rgba(0, 217, 255, 0.03)' : 'transparent',
      borderBottom: '1px solid #f1f5f9'
    }}>
      {/* Avatar */}
      <div style={{
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        background: isUser
          ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)'
          : 'linear-gradient(135deg, rgba(0,217,255,0.3) 0%, rgba(0,168,204,0.15) 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: isUser
          ? '0 2px 8px rgba(59, 130, 246, 0.25)'
          : '0 2px 8px rgba(0, 217, 255, 0.25)',
        overflow: 'hidden'
      }}>
        {isUser ? (
          <Icons.User />
        ) : (
          <img
            src="/Sparky.png"
            alt="Spark-AI"
            style={{
              width: '24px',
              height: '24px',
              objectFit: 'contain',
              filter: 'drop-shadow(0 0 4px rgba(0, 217, 255, 0.5))'
            }}
          />
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: '#64748b',
          fontSize: '12px',
          marginBottom: '4px',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          {isUser ? 'You' : 'Spark-AI'}
          {/* OPTIMISTIC UI: Show pending indicator for queued messages */}
          {isUser && message.status === 'pending' && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              color: '#f59e0b',
              fontWeight: 400
            }}>
              <span style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: '#f59e0b',
                animation: 'pulse 1.5s ease-in-out infinite'
              }} />
              sending...
            </span>
          )}
        </div>

        {/* Show streaming indicator when AI is working but no content yet */}
        {isAssistant && message.isStreaming && contentParts.length === 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 0',
            color: '#64748b',
            fontSize: '14px'
          }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#00D9FF',
              animation: 'pulse 1.5s ease-in-out infinite'
            }} />
            <span>
              {message.agenticProgress?.stage === 'intent' && 'Understanding your request...'}
              {message.agenticProgress?.stage === 'planning' && 'Planning the approach...'}
              {message.agenticProgress?.stage === 'architecture' && 'Designing architecture...'}
              {message.agenticProgress?.stage === 'coding' && 'Generating code...'}
              {!message.agenticProgress?.stage && 'Thinking...'}
            </span>
          </div>
        )}

        {/* Sequential content parts - renders in order like Claude Code */}
        {contentParts.map((part, idx) => {
          if (part.type === 'text' && typeof part.content === 'string') {
            // Render even if content is empty during streaming (shows the text part exists)
            if (part.content.length === 0 && message.isStreaming) {
              return (
                <div key={`text-${idx}`} style={{ minHeight: '20px' }}>
                  <span style={{ color: '#94a3b8' }}>...</span>
                </div>
              );
            }
            if (!part.content) return null; // Skip truly empty non-streaming parts
            // Use TextBlock for AI messages to clean up formatting
            // User messages displayed as-is
            const textContent = typeof part.content === 'string'
              ? part.content
              : JSON.stringify(part.content, null, 2);

            return (
              <div
                key={`text-${idx}`}
                style={{
                  marginBottom: idx < contentParts.length - 1 ? '12px' : 0
                }}
              >
                {isAssistant ? (
                  <TextBlock content={textContent} />
                ) : (
                  <div style={{
                    color: '#334155',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word'
                  }}>
                    {textContent}
                  </div>
                )}
              </div>
            );
          }

          if (part.type === 'tool') {
            return (
              <ToolResultCard
                key={`tool-${part.toolCallId || idx}`}
                toolName={part.toolName}
                args={part.args}
                result={part.result}
                isExecuting={part.isExecuting}
              />
            );
          }

          return null;
        })}

        {/* REMOVED: "Thinking..." indicator - users see streaming text instead
            Industry standard UX: conversational text streams live, no loading indicator */}
      </div>
    </div>
  );
}

// ============== CAPABILITY STATUS BAR ==============

function CapabilityStatusBar({ executorType, e2bConnected }) {
  const isFullCapability = executorType === 'e2b' && e2bConnected;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 16px',
      backgroundColor: isFullCapability ? 'rgba(34, 197, 94, 0.08)' : 'rgba(245, 158, 11, 0.08)',
      borderBottom: `1px solid ${isFullCapability ? 'rgba(34, 197, 94, 0.15)' : 'rgba(245, 158, 11, 0.15)'}`
    }}>
      {isFullCapability ? <Icons.Cloud /> : <Icons.CloudOff />}
      <span style={{
        fontSize: '12px',
        color: isFullCapability ? '#16a34a' : '#d97706'
      }}>
        {isFullCapability
          ? 'Full capabilities - E2B sandbox active'
          : 'Limited mode - File operations only (no npm/git/build)'
        }
      </span>
    </div>
  );
}

// ============== MAIN COMPONENT ==============

export default function ProductionAIChat({
  projectId,
  isOpen = true,
  onClose,
  onFileUpdate,
  onGenerationStart,
  onGenerationEnd,
  width = 450,
  position = 'left', // 'left', 'right', or 'fullscreen' (mobile)
  initialPrompt = null, // Initial prompt from index page to auto-submit
  onInitialPromptProcessed = null, // Callback when initial prompt is processed
  embedded = false // When true, uses relative positioning for flex layouts
}) {
  const { data: session } = useSession();
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);
  const initialPromptProcessedRef = useRef(false); // Guard against processing multiple times

  // Industry best practice: Use refs for streaming state to avoid stale closures
  // and enable throttled updates without losing data
  const streamingStateRef = useRef({
    content: '',
    contentParts: [],
    toolCallMap: new Map(),
    lastUpdateTime: 0,
    pendingUpdate: null
  });

  // Throttle interval for state updates (16ms = 60fps, smooth streaming)
  const STREAM_UPDATE_THROTTLE_MS = 16;

  // File store
  const files = useProductionFileStore(state => state.files);
  const activeFile = useProductionFileStore(state => state.activeFile);
  const setFile = useProductionFileStore(state => state.setFile);
  const setFiles = useProductionFileStore(state => state.setFiles);
  const deleteFile = useProductionFileStore(state => state.deleteFile);
  const e2bConnected = useProductionFileStore(state => state.e2bConnected);

  // Chat state - with localStorage fallback for persistence across browser/resize
  // Initialize from localStorage if available for instant recovery
  // CRITICAL: Skip sessionStorage when initialPrompt is present - that indicates a fresh project flow
  //
  // INDUSTRY BEST PRACTICE: Use lazy initialization but also check the prop directly
  // The prop `initialPrompt` is more reliable than URL parsing during SSR/hydration
  const [messages, setMessages] = useState(() => {
    // Server-side: always return empty
    if (typeof window === 'undefined') return [];

    // CRITICAL FIX: Check the prop first (passed directly from parent)
    // This is more reliable than URL parsing which can fail during hydration
    if (initialPrompt) {
      console.log('[ProductionAIChat] Initial prompt prop present, starting with empty messages');
      return [];
    }

    // Fallback: Check URL for initialPrompt (handles edge cases where prop might not be set yet)
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('initialPrompt')) {
        console.log('[ProductionAIChat] Initial prompt detected in URL, skipping sessionStorage cache');
        return [];
      }
    } catch (e) {
      // Ignore URL parsing errors - continue to sessionStorage check
    }

    // No initial prompt - try to restore from sessionStorage
    // Only restore if we have a valid projectId
    if (!projectId || projectId === 'undefined' || projectId === 'null') {
      return [];
    }

    try {
      const cached = sessionStorage.getItem(`chat_messages_${projectId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        // Only restore if cache is less than 1 hour old
        if (parsed.timestamp && Date.now() - parsed.timestamp < 3600000) {
          console.log('[ProductionAIChat] Restored messages from sessionStorage');
          return parsed.messages || [];
        }
      }
    } catch (e) {
      console.warn('[ProductionAIChat] Failed to restore from sessionStorage:', e);
    }
    return [];
  });
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [executorType, setExecutorType] = useState(null);
  const [isAgenticMode, setIsAgenticMode] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false); // Track if chat history has been loaded

  // AI Mode state - allows users to switch between Standard, Deep Think, and Max modes
  // Mode availability is tier-based:
  // - FREE: Standard only
  // - PRO: Standard, Deep Think
  // - BUSINESS: Standard, Max
  // - ENTERPRISE: All modes
  const [aiMode, setAiMode] = useState('standard');

  // Get user tier from session
  const userTier = session?.user?.tier || session?.user?.plan || 'free';

  // OPTIMISTIC UI: Queue for messages sent before projectId is ready
  // Pattern: Let users type immediately, queue messages, flush when ready
  const [pendingMessage, setPendingMessage] = useState(null);
  const pendingMessageRef = useRef(null); // Ref to avoid stale closure in effect

  // Database connection pause/resume state
  // When AI calls requestDatabaseConnection tool, we pause and show modal
  const [dbConnectionPaused, setDbConnectionPaused] = useState(false);
  const [dbConnectionPrompt, setDbConnectionPrompt] = useState(null);
  const dbResumeTokenRef = useRef(null); // Store resume token for continuing after connection

  // Token depletion modal hook
  const {
    isModalOpen: isTokenModalOpen,
    depletionInfo,
    showDepletionModal,
    hideDepletionModal
  } = useChatTokenDepletion(projectId);

  // Pre-display validation hook - validates and fixes code BEFORE syncing to preview
  const { validateSingleFile, validateAndFix } = usePreDisplayValidation({
    onValidationStart: () => {
      console.log('[ProductionAIChat] Validating generated code...');
      setIsValidating(true);
    },
    onValidationComplete: ({ valid, fixedCount }) => {
      console.log('[ProductionAIChat] Validation complete, fixed:', fixedCount);
      setIsValidating(false);
    },
    onFixApplied: (path, content) => {
      console.log('[ProductionAIChat] Auto-fixed syntax error in:', path);
    }
  });

  // Agentic generation hook for large "build me X" requests
  const agentic = useAgenticGeneration({
    projectId,
    onFileGenerated: async (path, content) => {
      console.log('[ProductionAIChat] Agentic file generated:', path);
      const normalizedPath = normalizePath(path);

      // CRITICAL: Validate and auto-fix before syncing to preview
      // This ensures users never see syntax errors
      const ext = normalizedPath.split('.').pop()?.toLowerCase() || '';
      if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) {
        try {
          const { content: validatedContent, wasFixed } = await validateSingleFile(normalizedPath, content);
          if (wasFixed) {
            console.log('[ProductionAIChat] Syntax error fixed in:', normalizedPath);
            content = validatedContent;
          }
        } catch (err) {
          console.warn('[ProductionAIChat] Validation failed, using original:', err.message);
        }
      }

      setFile(normalizedPath, content, 'ai');
      onFileUpdate?.(normalizedPath, content);
    },
    onComplete: (result) => {
      console.log('[ProductionAIChat] Agentic generation complete:', result);
      setIsAgenticMode(false);
      setIsLoading(false);
      onGenerationEnd?.();
      // Add completion message
      setMessages(prev => prev.map(m =>
        m.isStreaming ? {
          ...m,
          isStreaming: false,
          content: `✅ Generated ${result.filesGenerated} files successfully!\n\nFiles created:\n${result.files ? Object.keys(result.files).map(f => `• ${f}`).join('\n') : 'No files'}`
        } : m
      ));
    },
    onError: (err) => {
      console.error('[ProductionAIChat] Agentic error:', err);
      setError(err.error || 'Generation failed');
      setIsAgenticMode(false);
      setIsLoading(false);
      onGenerationEnd?.();
    }
  });

  // REMOVED: useEffect that was overwriting message.content with progress text
  // The AI's conversational text should stream naturally without being replaced
  // by "Planning your project..." or "Generating files..." messages.
  // Progress is now tracked silently in agenticProgress state without affecting visible content.

  // Load chat history on mount
  // CRITICAL: Skip history loading when initialPrompt is present (new project flow from index page)
  // Also mark historyLoaded=true when we have initialPrompt to enable auto-submit
  useEffect(() => {
    // When initialPrompt is present, this is a new project - skip history loading entirely
    if (initialPrompt) {
      console.log('[ProductionAIChat] Initial prompt present, skipping history load (new project flow)');
      setHistoryLoaded(true);
      return;
    }

    if (projectId && session?.user) {
      loadChatHistory();
    } else if (projectId) {
      // If we have projectId but session is loading/undefined, mark history as loaded
      // to avoid blocking initial prompt submission
      console.log('[ProductionAIChat] ProjectId available, marking historyLoaded (session loading)');
      setHistoryLoaded(true);
    }
  }, [projectId, session?.user?.id, initialPrompt]);

  // CHECK FOR ONGOING GENERATION
  // When component mounts (or remounts after reload), check if there's a background generation running
  // If so, load the latest files from the database since they're being saved incrementally
  useEffect(() => {
    if (!projectId || !session?.user || initialPrompt) return;

    const checkOngoingGeneration = async () => {
      try {
        const response = await fetch(`/api/ai/generation-status?projectId=${projectId}`);
        if (!response.ok) return;

        const status = await response.json();
        console.log('[ProductionAIChat] Generation status check:', status);

        if (status.status === 'generating') {
          console.log('[ProductionAIChat] Ongoing generation detected! Files modified:', status.filesModified?.length || 0);

          // Show a message to the user that generation is continuing
          setMessages(prev => {
            // Don't add duplicate messages
            if (prev.some(m => m.id === 'ongoing-generation-notice')) return prev;

            return [...prev, {
              id: 'ongoing-generation-notice',
              role: 'assistant',
              content: `🔄 **Generation in progress**\n\nAI generation is running in the background. Files are being created and saved automatically. The latest files have been loaded from the database.\n\nFiles created so far: ${status.filesModified?.join(', ') || 'checking...'}`,
              timestamp: new Date().toISOString(),
              isSystemMessage: true
            }];
          });

          // Trigger a project reload to get the latest incrementally-saved files
          // The editor's loadProject will fetch the updated files from the database
          console.log('[ProductionAIChat] Triggering file refresh for ongoing generation');
        } else if (status.status === 'complete' && status.filesModified?.length > 0) {
          console.log('[ProductionAIChat] Generation completed in background, files:', status.filesModified);
        }
      } catch (error) {
        console.warn('[ProductionAIChat] Failed to check generation status:', error);
      }
    };

    // Check after a short delay to let the component settle
    const timeoutId = setTimeout(checkOngoingGeneration, 500);
    return () => clearTimeout(timeoutId);
  }, [projectId, session?.user?.id, initialPrompt]);

  // PERSISTENCE: Save messages to sessionStorage for quick recovery on resize/refresh
  // This ensures chat history survives component remounts and browser refreshes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!projectId) return;

    // Only save if we have messages (don't clear cache with empty array on mount)
    if (messages.length > 0) {
      try {
        // Filter out streaming messages before saving (incomplete state)
        const messagesToSave = messages.filter(m => !m.isStreaming);
        sessionStorage.setItem(`chat_messages_${projectId}`, JSON.stringify({
          messages: messagesToSave,
          timestamp: Date.now(),
        }));
      } catch (e) {
        console.warn('[ProductionAIChat] Failed to save to sessionStorage:', e);
      }
    }
  }, [messages, projectId]);

  // OPTIMISTIC UI: Flush pending message when projectId becomes available
  // This allows users to type immediately - the message is sent when ready
  //
  // FIX: We use a ref to store the current projectId to avoid stale closure issues.
  // The executeStreamingRequest function captures projectId from its scope when created,
  // so we need to pass the current projectId directly to the streaming logic.
  const projectIdRef = useRef(projectId);
  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    const pending = pendingMessageRef.current;
    const currentProjectId = projectId; // Capture from effect scope (fresh value)

    // Only process if we have a pending message AND projectId is now valid
    if (pending && currentProjectId && currentProjectId !== 'undefined' && currentProjectId !== 'null') {
      console.log('[ProductionAIChat] ProjectId now available:', currentProjectId, '- flushing pending message');

      // Update the pending message status to 'sent'
      setMessages(prev => prev.map(m =>
        m.id === pending.userMessage.id ? { ...m, status: 'sent' } : m
      ));

      // Clear the pending state BEFORE executing to prevent double-send
      setPendingMessage(null);
      pendingMessageRef.current = null;

      // CRITICAL FIX: Execute streaming with the fresh projectId
      // We inline the streaming logic here to avoid stale closure issues
      // The executeStreamingRequest function would use the old projectId from its closure
      (async () => {
        const { userMessage, baseMessages } = pending;
        console.log('[ProductionAIChat] Starting streaming request for queued message:', userMessage.content.slice(0, 50));

        // Add streaming assistant message
        const assistantMessageId = typeof crypto !== 'undefined' && crypto.randomUUID
          ? `msg_${crypto.randomUUID()}`
          : `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_assistant`;

        setMessages(prev => [...prev, {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          contentParts: [],
          toolCalls: [],
          toolResults: [],
          isStreaming: true,
          timestamp: new Date().toISOString()
        }]);

        setIsLoading(true);
        onGenerationStart?.();
        fileEventBus.emit('ai:processing-start');

        try {
          abortControllerRef.current = new AbortController();

          console.log('[ProductionAIChat] Sending queued message with projectId:', currentProjectId);

          const messagesWithContext = [...baseMessages, userMessage].map(m => ({
            role: m.role,
            content: m.content,
            tool_calls: m.toolCalls || m.tool_calls || null,
            tool_results: m.toolResults || m.tool_results || null
          }));

          // Use unified-chat endpoint with conversational AI experience
          // Silent agents (Intent → Planner → Architect) + Visible streaming Coder
          const response = await fetch('/api/ai/unified-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: messagesWithContext,
              projectId: currentProjectId,
              files: files,
              activeFile: activeFile,
              tier: userTier,
              mode: aiMode
            }),
            signal: abortControllerRef.current.signal
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
          }

          // Process the streaming response
          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('No response body reader');
          }

          const decoder = new TextDecoder();
          let buffer = '';

          // INDUSTRY BEST PRACTICE: Use refs for streaming state (same pattern as main handler)
          const pendingStreamState = {
            content: '',
            contentParts: [],
            toolCallMap: new Map(),
            lastUpdateTime: 0,
            pendingUpdate: null
          };
          let currentTextPart = null;
          let currentToolCalls = [];
          let currentToolResults = [];
          let lineCount = 0;

          // Throttled update function for smooth streaming
          const schedulePendingUpdate = (immediate = false) => {
            const now = Date.now();
            const timeSinceLastUpdate = now - pendingStreamState.lastUpdateTime;

            if (pendingStreamState.pendingUpdate) {
              cancelAnimationFrame(pendingStreamState.pendingUpdate);
              pendingStreamState.pendingUpdate = null;
            }

            const doUpdate = () => {
              pendingStreamState.lastUpdateTime = Date.now();
              setMessages(prev => prev.map(m =>
                m.id === assistantMessageId
                  ? {
                      ...m,
                      content: pendingStreamState.content,
                      contentParts: [...pendingStreamState.contentParts],
                      toolCalls: [...currentToolCalls],
                      toolResults: [...currentToolResults],
                      _updateKey: pendingStreamState.lastUpdateTime
                    }
                  : m
              ));
            };

            if (immediate || timeSinceLastUpdate >= STREAM_UPDATE_THROTTLE_MS) {
              doUpdate();
            } else {
              pendingStreamState.pendingUpdate = requestAnimationFrame(doUpdate);
            }
          };

          console.log('[ProductionAIChat:Pending] Starting to read stream...');

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                console.log(`[ProductionAIChat:Pending] Stream ended normally. Lines: ${lineCount}, Content: ${pendingStreamState.content.length} chars`);
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (!line.trim()) continue;
                lineCount++;

                try {
                  // Parse the correct format: "0:data", "9:data", "a:data", etc.
                  const colonIndex = line.indexOf(':');
                  if (colonIndex === -1) continue;

                  const type = line.slice(0, colonIndex);
                  let data;
                  try {
                    data = JSON.parse(line.slice(colonIndex + 1));
                  } catch (jsonErr) {
                    continue; // Skip malformed JSON
                  }

                  if (data === null || data === undefined) continue;

                switch (type) {
                  case '0': // text-delta
                    // Ensure data is a string before concatenating
                    const textDeltaPending = typeof data === 'string' ? data : '';

                    // Stream ALL text to user - no code block filtering
                    if (textDeltaPending.length > 0) {
                      pendingStreamState.content += textDeltaPending;

                      // Sequential tracking: append to current text part or create new one
                      if (!currentTextPart) {
                        currentTextPart = { type: 'text', content: '' };
                        pendingStreamState.contentParts.push(currentTextPart);
                      }
                      currentTextPart.content += textDeltaPending;

                      // INDUSTRY BEST PRACTICE: Throttled updates for smooth streaming
                      schedulePendingUpdate();
                    }
                    break;

                  case '9': // tool-call
                    if (data.toolName) {
                      // Finalize current text part before tool
                      currentTextPart = null;

                      if (!pendingStreamState.toolCallMap.has(data.toolCallId)) {
                        const toolPart = {
                          type: 'tool',
                          toolCallId: data.toolCallId,
                          toolName: data.toolName,
                          args: data.args,
                          result: null,
                          isExecuting: true
                        };
                        pendingStreamState.contentParts.push(toolPart);
                        pendingStreamState.toolCallMap.set(data.toolCallId, toolPart);
                        currentToolCalls.push(data);
                      }

                      // Tool calls update immediately
                      schedulePendingUpdate(true);
                    }
                    break;

                  case 'a': // tool-result
                    if (data && typeof data === 'object') {
                      currentToolResults.push(data);

                      if (data.toolCallId) {
                        const toolPart = pendingStreamState.toolCallMap.get(data.toolCallId);
                        if (toolPart && typeof data.result !== 'undefined') {
                          toolPart.result = data.result;
                          toolPart.isExecuting = false;
                        }
                      }

                      // Tool results update immediately
                      schedulePendingUpdate(true);

                      // Handle file updates from tool results
                      const toolResult = data.result;
                      if (toolResult && typeof toolResult === 'object' &&
                          toolResult.success === true && toolResult.path) {
                        const toolName = data.toolName || '';
                        if (['writeFile', 'editFile'].includes(toolName)) {
                          const content = toolResult.new_content || toolResult.content;
                          if (content && typeof content === 'string') {
                            const normalizedPath = normalizePath(toolResult.path);
                            if (typeof setFile === 'function') {
                              setFile(normalizedPath, content, 'ai');
                            }
                            onFileUpdate?.(normalizedPath, content);
                          }
                        }
                      }

                      // Check for PAUSE_FOR_USER_INPUT action (database connection request)
                      if (toolResult && typeof toolResult === 'object' && toolResult.action === 'PAUSE_FOR_USER_INPUT') {
                        console.log('[ProductionAIChat:Pending] AI paused for user input:', toolResult);
                        if (toolResult.inputType === 'database_connection') {
                          dbResumeTokenRef.current = toolResult.resumeToken;
                          setDbConnectionPrompt(toolResult.prompt);
                          setDbConnectionPaused(true);
                          setIsLoading(false);
                        }
                      }
                    }
                    break;

                  case 'e': // files_updated (bulk sync)
                    if (data && typeof data === 'object' && data.files) {
                      const normalizedFiles = {};
                      for (const [path, content] of Object.entries(data.files)) {
                        if (typeof path === 'string') {
                          normalizedFiles[normalizePath(path)] = content;
                        }
                      }
                      if (Object.keys(normalizedFiles).length > 0 && typeof setFiles === 'function') {
                        setFiles(normalizedFiles, 'ai');
                        for (const [path, content] of Object.entries(normalizedFiles)) {
                          onFileUpdate?.(path, content);
                        }
                      }
                    }
                    break;

                  case 'd': // finish
                    // Check for token depletion
                    if (data?.paused && data?.pauseReason === 'insufficient_tokens') {
                      showDepletionModal?.({
                        pauseReason: data.pauseReason,
                        tokensUsed: data.tokensUsed || 0,
                        message: data.message || "Ran out of tokens"
                      });
                    }
                    break;

                  case '3': // error
                    console.error('[ProductionAIChat] Stream error:', data);
                    setError(typeof data?.error === 'string' ? data.error : 'Stream error');
                    break;
                }
              } catch (parseErr) {
                console.warn('[ProductionAIChat:Pending] Failed to parse stream data:', parseErr);
              }
            }
            }
          } catch (readError) {
            // Stream read error - log but continue to display what we have
            console.error('[ProductionAIChat:Pending] Stream read error:', readError.message);
            console.log(`[ProductionAIChat:Pending] Partial stream: ${lineCount} lines, ${pendingStreamState.content.length} chars`);
          }

          // INDUSTRY BEST PRACTICE: Flush any pending updates on stream end
          if (pendingStreamState.pendingUpdate) {
            cancelAnimationFrame(pendingStreamState.pendingUpdate);
          }
          schedulePendingUpdate(true); // Force final update

          // Mark streaming complete
          setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg?.role === 'assistant') {
              lastMsg.isStreaming = false;
            }
            return updated;
          });

        } catch (err) {
          if (err.name === 'AbortError') {
            console.log('[ProductionAIChat] Request aborted');
          } else {
            console.error('[ProductionAIChat] Streaming error:', err);
            setError(err.message || 'Failed to get AI response');
          }
        } finally {
          setIsLoading(false);
          onGenerationEnd?.();
          fileEventBus.emit('ai:processing-end');
        }
      })();
    }
  }, [projectId, files, activeFile, onGenerationStart, onGenerationEnd, setFiles]); // Include all dependencies

  // Fallback: If we have an initialPrompt but historyLoaded is stuck false, force it after a delay
  // Reduced to 500ms for faster initial prompt auto-submit UX
  useEffect(() => {
    if (initialPrompt && projectId && !historyLoaded) {
      const timeoutId = setTimeout(() => {
        if (!historyLoaded) {
          console.log('[ProductionAIChat] Force-setting historyLoaded due to timeout (500ms fallback)');
          setHistoryLoaded(true);
        }
      }, 500); // Fast fallback for better UX with initial prompts
      return () => clearTimeout(timeoutId);
    }
  }, [initialPrompt, projectId, historyLoaded]);

  // ============================================================================
  // INITIAL PROMPT AUTO-SUBMIT SYSTEM (Industry Best Practice Implementation)
  // ============================================================================
  // This handles auto-submitting the initial prompt from the index page.
  //
  // ARCHITECTURE:
  // - Single unified effect with retry mechanism (no fragile two-stage approach)
  // - State-based tracking for submit function availability
  // - Ref-based prompt storage to survive re-renders
  // - Proper cleanup to prevent memory leaks and race conditions
  // ============================================================================

  const pendingInitialPromptRef = useRef(null);
  const onProcessedCallbackRef = useRef(null);
  const handleSubmitInternalRef = useRef(null);
  const autoSubmitAttemptedRef = useRef(false); // Tracks if we've started the auto-submit process

  // State to track when the submit function is available
  // This is the KEY FIX - refs can't trigger re-renders, but state can
  const [submitFunctionReady, setSubmitFunctionReady] = useState(false);

  // Keep callback ref updated
  useEffect(() => {
    onProcessedCallbackRef.current = onInitialPromptProcessed;
  }, [onInitialPromptProcessed]);

  // Store the initial prompt immediately when it arrives
  useEffect(() => {
    if (initialPrompt && !initialPromptProcessedRef.current && !autoSubmitAttemptedRef.current) {
      pendingInitialPromptRef.current = initialPrompt;
      console.log('[ProductionAIChat] Initial prompt stored:', initialPrompt.substring(0, 50) + '...');
    }
  }, [initialPrompt]);

  // UNIFIED AUTO-SUBMIT EFFECT
  // This single effect handles all the logic for auto-submitting the initial prompt.
  // It uses a retry mechanism to handle the case where handleSubmitInternal isn't ready yet.
  useEffect(() => {
    // Get the prompt to process (from prop or ref)
    const promptToProcess = initialPrompt || pendingInitialPromptRef.current;

    // Early exit conditions
    if (!promptToProcess) return;
    if (initialPromptProcessedRef.current) return;

    // When initialPrompt is provided, treat history as loaded (we skip loading for new projects)
    const effectivelyHistoryLoaded = historyLoaded || !!initialPrompt;

    // When initialPrompt is present, user is authenticated (just created a project from index)
    const effectivelyAuthenticated = !!session?.user?.id || !!initialPrompt;

    // Check all conditions
    const canSubmit =
      effectivelyHistoryLoaded &&
      messages.length === 0 &&
      !isLoading &&
      !agentic.isGenerating &&
      effectivelyAuthenticated &&
      submitFunctionReady &&
      handleSubmitInternalRef.current;

    // Debug logging
    console.log('[ProductionAIChat] Auto-submit check:', {
      hasPrompt: !!promptToProcess,
      notProcessed: !initialPromptProcessedRef.current,
      effectivelyHistoryLoaded,
      messagesEmpty: messages.length === 0,
      notLoading: !isLoading,
      notGenerating: !agentic.isGenerating,
      effectivelyAuthenticated,
      submitFunctionReady,
      hasSubmitFn: !!handleSubmitInternalRef.current,
      canSubmit
    });

    if (!canSubmit) {
      // If submit function isn't ready yet but other conditions are met,
      // we'll automatically retry when submitFunctionReady changes
      if (!submitFunctionReady && effectivelyHistoryLoaded && messages.length === 0 && !isLoading) {
        console.log('[ProductionAIChat] Waiting for submit function to be ready...');
      }
      return;
    }

    // Mark as processed BEFORE starting async operation to prevent duplicate submissions
    initialPromptProcessedRef.current = true;
    autoSubmitAttemptedRef.current = true;

    console.log('[ProductionAIChat] ✅ All conditions met! Auto-submitting:', promptToProcess.substring(0, 50) + '...');

    // Clear the pending prompt ref
    const promptToSubmit = promptToProcess;
    pendingInitialPromptRef.current = null;

    // Clear input field
    setInput('');

    // Execute the submission
    // Using an IIFE to handle async in useEffect
    (async () => {
      try {
        await handleSubmitInternalRef.current(promptToSubmit);

        // Notify parent that prompt was processed
        onProcessedCallbackRef.current?.();
        console.log('[ProductionAIChat] ✅ Initial prompt auto-submitted successfully');
      } catch (err) {
        console.error('[ProductionAIChat] Failed to auto-submit initial prompt:', err);
        // Reset the processed flag to allow retry on next render
        initialPromptProcessedRef.current = false;
        autoSubmitAttemptedRef.current = false;
      }
    })();

  }, [
    initialPrompt,
    historyLoaded,
    messages.length,
    isLoading,
    agentic.isGenerating,
    session?.user?.id,
    submitFunctionReady // KEY: This triggers re-run when submit function becomes available
  ]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Load chat history
  const loadChatHistory = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/chat-history`);
      if (response.ok) {
        const data = await response.json();
        if (data.messages?.length > 0) {
          setMessages(data.messages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            // Load contentParts for sequential rendering (new format)
            contentParts: m.content_parts ? JSON.parse(m.content_parts) : undefined,
            toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
            toolResults: m.tool_results ? JSON.parse(m.tool_results) : undefined,
            timestamp: m.created_at
          })));
        }
      }
    } catch (e) {
      console.warn('[ProductionAIChat] Failed to load history:', e);
    } finally {
      // Always mark history as loaded, even on error
      setHistoryLoaded(true);
    }
  };

  // Save chat history
  const saveChatHistory = async (msgs) => {
    try {
      // Prepare messages with properly serialized tool data
      const preparedMessages = msgs.map(msg => ({
        ...msg,
        // Serialize contentParts for sequential rendering (new format)
        content_parts: msg.contentParts ? JSON.stringify(msg.contentParts) : null,
        tool_calls: msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
        tool_results: msg.toolResults ? JSON.stringify(msg.toolResults) : null,
        timestamp: msg.timestamp || new Date().toISOString()
      }));

      await fetch(`/api/projects/${projectId}/chat-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: preparedMessages })
      });
    } catch (e) {
      console.warn('[ProductionAIChat] Failed to save history:', e);
    }
  };

  // Get file snapshot for context
  const getFileSnapshot = useCallback(() => {
    const snapshot = {};
    for (const [path, entry] of Object.entries(files)) {
      snapshot[path] = entry.content;
    }
    return snapshot;
  }, [files]);

  // Internal submit function that can be called programmatically
  // OPTIMISTIC UI: Users can type immediately - messages queue if projectId not ready
  const handleSubmitInternal = async (messageContent, existingMessages = null) => {
    const trimmedInput = messageContent.trim();
    if (!trimmedInput) {
      console.warn('[ProductionAIChat] handleSubmitInternal called with empty message');
      return;
    }

    // Check loading state at call time
    if (isLoading || agentic.isGenerating) {
      console.warn('[ProductionAIChat] handleSubmitInternal called while already loading');
      return;
    }

    setError(null);

    // Create user message with unique ID and proper ISO timestamp
    const messageId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? `msg_${crypto.randomUUID()}`
      : `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const userMessage = {
      id: messageId,
      role: 'user',
      content: trimmedInput,
      timestamp: new Date().toISOString(),
      // OPTIMISTIC UI: Mark as pending if projectId not ready yet
      status: (!projectId || projectId === 'undefined' || projectId === 'null') ? 'pending' : 'sent'
    };

    // Use existing messages if provided (for auto-continue), otherwise use current state
    const baseMessages = existingMessages || messages;

    // OPTIMISTIC UI: Show message immediately regardless of projectId state
    setMessages([...baseMessages, userMessage]);

    // If projectId not ready, queue the message and wait
    if (!projectId || projectId === 'undefined' || projectId === 'null') {
      console.log('[ProductionAIChat] ProjectId not ready - queuing message for later delivery');
      setPendingMessage({ userMessage, baseMessages });
      pendingMessageRef.current = { userMessage, baseMessages };
      // Don't block - the useEffect will handle sending when projectId is ready
      return;
    }

    // ProjectId is ready - send immediately
    console.log('[ProductionAIChat] Using STREAMING mode (conversational + tools)');
    console.log('[ProductionAIChat] Submitting message:', trimmedInput.substring(0, 100));

    // Call the main streaming logic
    await executeStreamingRequest(userMessage, baseMessages);
  };

  // Submit message (from form)
  const handleSubmit = async (e) => {
    e?.preventDefault();

    const trimmedInput = input.trim();
    if (!trimmedInput || isLoading || agentic.isGenerating) return;

    setInput('');
    await handleSubmitInternal(trimmedInput);
  };

  // Execute the actual streaming request
  const executeStreamingRequest = async (userMessage, baseMessages) => {
    console.log('[ProductionAIChat] Starting streaming request for:', userMessage.content.slice(0, 50));

    // DEFENSE IN DEPTH: Final validation before API call
    // This catches any edge cases where projectId might have become invalid
    if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
      console.error('[ProductionAIChat] executeStreamingRequest - invalid projectId:', projectId);
      setError('Cannot send message: Project ID is missing. Please refresh the page.');
      setIsLoading(false);
      return;
    }

    // Add streaming assistant message with contentParts for sequential rendering
    // Use unique ID that won't collide with user message
    const assistantMessageId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? `msg_${crypto.randomUUID()}`
      : `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_assistant`;

    setMessages(prev => [...prev, {
      id: assistantMessageId,
      role: 'assistant',
      content: '', // Legacy fallback
      contentParts: [], // NEW: Sequential parts (text, tool, text, tool...)
      toolCalls: [], // Keep for compatibility
      toolResults: [], // Keep for compatibility
      isStreaming: true,
      timestamp: new Date().toISOString()
    }]);

    setIsLoading(true);
    onGenerationStart?.();

    // Emit event to signal AI is starting to process
    // LivePreview listens for this to show "AI is generating your code..."
    fileEventBus.emit('ai:processing-start');

    try {
      abortControllerRef.current = new AbortController();

      console.log('[ProductionAIChat] Sending message:', userMessage.content.slice(0, 100));
      console.log('[ProductionAIChat] Message history length:', baseMessages.length);
      console.log('[ProductionAIChat] ProjectId:', projectId);

      // UNIFIED CONVERSATIONAL AI
      //
      // Uses the unified-chat endpoint which provides:
      // - Silent agents (Intent, Planner, Architect) for internal reasoning
      // - Visible Coder agent with real-time streaming tool calls
      // - Conversational UX like ChatGPT/Claude - ONE intelligent assistant
      // - Tier-based model selection for each agent
      //
      // The user sees natural conversation + tool calls (writeFile, readFile)
      // The backend uses specialized agents for better reasoning
      const endpoint = '/api/ai/unified-chat';

      console.log(`[ProductionAIChat] Using endpoint: ${endpoint} (multi-agent pipeline, tier=${userTier}, mode=${aiMode})`);

      // Include tool history for context continuity across sessions
      // This allows the AI to understand what was previously done
      const messagesWithContext = [...baseMessages, userMessage].map(m => ({
        role: m.role,
        content: m.content,
        // Include tool execution history for session continuity
        tool_calls: m.toolCalls || m.tool_calls || null,
        tool_results: m.toolResults || m.tool_results || null
      }));

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messagesWithContext,
          projectId,
          files: getFileSnapshot(),
          activeFile,
          // Multi-agent tier/mode configuration
          tier: userTier,
          mode: aiMode
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        // CRITICAL FIX: Safe response error handling
        let errorData = {};
        try {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            errorData = await response.json();
          } else {
            // Non-JSON response (HTML error page, etc.)
            errorData = { error: response.statusText || `HTTP ${response.status}` };
          }
        } catch (parseErr) {
          console.error('[ProductionAIChat] Failed to parse error response:', parseErr);
          errorData = { error: `Request failed: ${response.status}` };
        }
        const errorMessage = errorData?.error || errorData?.message || `Request failed: ${response.status}`;
        throw new Error(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
      }

      // Parse SSE stream with SEQUENTIAL content tracking
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // INDUSTRY BEST PRACTICE: Use refs for streaming state
      // This prevents stale closures and enables reliable throttled updates
      // Reset streaming state for new message
      streamingStateRef.current = {
        content: '',
        contentParts: [],
        toolCallMap: new Map(),
        lastUpdateTime: 0,
        pendingUpdate: null
      };

      // Local references for performance (avoid ref access in hot path)
      const streamState = streamingStateRef.current;
      let currentTextPart = null; // Accumulator for current text segment

      // Legacy tracking for compatibility
      let currentToolCalls = [];
      let currentToolResults = [];
      let lineCount = 0;

      // Throttled update function - batches rapid updates for smooth 60fps rendering
      const scheduleUpdate = (immediate = false) => {
        const now = Date.now();
        const timeSinceLastUpdate = now - streamState.lastUpdateTime;

        // Clear any pending update
        if (streamState.pendingUpdate) {
          cancelAnimationFrame(streamState.pendingUpdate);
          streamState.pendingUpdate = null;
        }

        const doUpdate = () => {
          streamState.lastUpdateTime = Date.now();
          setMessages(prev => prev.map(m =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  content: streamState.content,
                  contentParts: [...streamState.contentParts],
                  toolCalls: [...currentToolCalls],
                  toolResults: [...currentToolResults],
                  _updateKey: streamState.lastUpdateTime
                }
              : m
          ));
        };

        if (immediate || timeSinceLastUpdate >= STREAM_UPDATE_THROTTLE_MS) {
          doUpdate();
        } else {
          // Schedule update for next animation frame
          streamState.pendingUpdate = requestAnimationFrame(doUpdate);
        }
      };

      console.log('[ProductionAIChat] Starting to read stream...');
      let streamEnded = false;
      let readErrors = 0;
      let eventCounts = { text: 0, tool: 0, result: 0, progress: 0, finish: 0, error: 0, other: 0 };

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            streamEnded = true;
            console.log(`[ProductionAIChat] Stream ended normally. Total lines: ${lineCount}, Text content: ${streamState.content.length} chars`);
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          lineCount++;
          if (lineCount <= 10) {
            console.log(`[ProductionAIChat] Stream line ${lineCount}:`, line.substring(0, 100));
          }

          try {
            const colonIndex = line.indexOf(':');
            if (colonIndex === -1) continue;

            const type = line.slice(0, colonIndex);
            let data;
            try {
              data = JSON.parse(line.slice(colonIndex + 1));
            } catch (jsonErr) {
              console.warn('[ProductionAIChat] JSON parse error:', jsonErr.message);
              continue;
            }

            // CRITICAL: Validate data is an object or string before processing
            if (data === null || data === undefined) {
              console.warn('[ProductionAIChat] Received null/undefined data, skipping');
              continue;
            }

            switch (type) {
              case '0': // text-delta
                eventCounts.text++;
                // Ensure data is a string before concatenating
                const textDelta = typeof data === 'string' ? data : '';

                // DEBUG: Log first few text events
                if (eventCounts.text <= 3) {
                  console.log(`[ProductionAIChat] 📝 Text delta #${eventCounts.text}:`, textDelta.substring(0, 50));
                }

                // Stream ALL text to user - no code block filtering
                if (textDelta.length > 0) {
                  streamState.content += textDelta;

                  // Sequential tracking: append to current text part or create new one
                  if (!currentTextPart) {
                    currentTextPart = { type: 'text', content: '' };
                    streamState.contentParts.push(currentTextPart);
                    console.log('[ProductionAIChat] Created new text part, contentParts length:', streamState.contentParts.length);
                  }
                  currentTextPart.content += textDelta;

                  // INDUSTRY BEST PRACTICE: Throttled updates for smooth 60fps streaming
                  scheduleUpdate();
                }
                break;

              case '9': // tool-call
                eventCounts.tool++;
                // Only process if it has a toolName (new tool call, not delta)
                if (data.toolName) {
                  // Finalize current text part before tool
                  currentTextPart = null;

                  // Check if this tool call already exists
                  if (!streamState.toolCallMap.has(data.toolCallId)) {
                    // Add new tool call to sequential parts
                    const toolPart = {
                      type: 'tool',
                      toolCallId: data.toolCallId,
                      toolName: data.toolName,
                      args: data.args,
                      result: null,
                      isExecuting: true
                    };
                    streamState.contentParts.push(toolPart);
                    streamState.toolCallMap.set(data.toolCallId, toolPart);
                    currentToolCalls.push(data);

                    console.log('[ProductionAIChat] 🔧 Tool call started:', data.toolName, data.toolCallId);
                  } else {
                    // Update existing tool call
                    const existing = streamState.toolCallMap.get(data.toolCallId);
                    if (existing) Object.assign(existing, data);
                  }

                  // Tool calls update immediately (user should see spinner right away)
                  scheduleUpdate(true);
                }
                break;

              case 'a': // tool-result
                eventCounts.result++;
                // CRITICAL FIX: Validate data structure before processing
                if (!data || typeof data !== 'object') {
                  console.warn('[ProductionAIChat] Invalid tool result data:', data);
                  break;
                }

                currentToolResults.push(data);

                // Update the tool part in contentParts - with null safety
                if (data.toolCallId) {
                  const toolPart = streamState.toolCallMap.get(data.toolCallId);
                  if (toolPart && typeof data.result !== 'undefined') {
                    toolPart.result = data.result;
                    toolPart.isExecuting = false;

                    console.log('[ProductionAIChat] ✅ Tool result received:', data.toolName, data.toolCallId);
                  }
                }

                // Tool results update immediately (user should see checkmark right away)
                scheduleUpdate(true);

                // Update file store if file was modified - with comprehensive null checks
                const toolResult = data.result;
                const isValidResult = toolResult && typeof toolResult === 'object';

                console.log('[ProductionAIChat] Tool result received:', {
                  toolName: data.toolName || 'unknown',
                  success: isValidResult ? toolResult.success : undefined,
                  path: isValidResult ? toolResult.path : undefined,
                  hasContent: isValidResult ? !!(toolResult.content || toolResult.new_content) : false
                });

                // Only process file updates if we have a valid result object
                if (isValidResult && toolResult.success === true && toolResult.path && typeof toolResult.path === 'string') {
                  const normalizedFilePath = normalizePath(toolResult.path);
                  const toolName = data.toolName || '';

                  if (['writeFile', 'editFile'].includes(toolName)) {
                    const content = toolResult.new_content || toolResult.content;
                    if (content && typeof content === 'string') {
                      console.log('[ProductionAIChat] Updating file in store:', normalizedFilePath, 'length:', content.length);
                      if (typeof setFile === 'function') {
                        setFile(normalizedFilePath, content, 'ai');
                      }
                      onFileUpdate?.(normalizedFilePath, content);
                    } else {
                      console.warn('[ProductionAIChat] No valid content in tool result for:', normalizedFilePath);
                    }
                  } else if (toolName === 'deleteFile') {
                    console.log('[ProductionAIChat] Deleting file:', normalizedFilePath);
                    if (typeof deleteFile === 'function') {
                      deleteFile(normalizedFilePath);
                    }
                    onFileUpdate?.(normalizedFilePath, null);
                  }
                }

                // Check for PAUSE_FOR_USER_INPUT action (database connection request)
                if (isValidResult && toolResult.action === 'PAUSE_FOR_USER_INPUT') {
                  console.log('[ProductionAIChat] AI paused for user input:', toolResult);
                  if (toolResult.inputType === 'database_connection') {
                    // Save resume token and show database connection modal
                    dbResumeTokenRef.current = toolResult.resumeToken;
                    setDbConnectionPrompt(toolResult.prompt);
                    setDbConnectionPaused(true);
                    // Stop loading since we're waiting for user input
                    setIsLoading(false);
                  }
                }
                break;

              case 'd': // finish
                eventCounts.finish++;
                console.log('[ProductionAIChat] 🏁 Finish event received:', data);
                // Get executor type from response
                if (data?.executorType) {
                  setExecutorType(data.executorType);
                }
                // Check for token depletion - show modal if paused
                if (data?.paused && (data?.pauseReason === 'insufficient_tokens' || data?.pauseReason === 'tokens_depleted')) {
                  console.log('[ProductionAIChat] Token depletion detected, showing modal', data);
                  showDepletionModal({
                    pauseReason: data.pauseReason,
                    tokensUsed: data.tokensUsed || 0,
                    contextId: data.contextId,
                    message: data.message || "I've run out of tokens and had to pause. Your work has been saved!"
                  });
                }
                break;

              case 'e': // files_updated (bulk file sync from AI)
                // CRITICAL FIX: Validate data structure
                if (!data || typeof data !== 'object') {
                  console.warn('[ProductionAIChat] Invalid files_updated data');
                  break;
                }

                console.log('[ProductionAIChat] Files updated event:', {
                  fileCount: data.files && typeof data.files === 'object' ? Object.keys(data.files).length : 0,
                  paths: data.paths,
                  executorType: data.executorType
                });

                if (data.executorType && typeof data.executorType === 'string') {
                  setExecutorType(data.executorType);
                }

                // Validate files is a plain object before iterating
                if (data.files && typeof data.files === 'object' && !Array.isArray(data.files)) {
                  // Normalize all file paths before storing
                  const normalizedFiles = {};
                  try {
                    for (const [path, content] of Object.entries(data.files)) {
                      if (typeof path === 'string' && (typeof content === 'string' || content === null)) {
                        normalizedFiles[normalizePath(path)] = content;
                      }
                    }
                  } catch (iterErr) {
                    console.error('[ProductionAIChat] Error iterating files:', iterErr);
                    break;
                  }

                  if (Object.keys(normalizedFiles).length > 0) {
                    console.log('[ProductionAIChat] Bulk updating files:', Object.keys(normalizedFiles));
                    if (typeof setFiles === 'function') {
                      setFiles(normalizedFiles, 'ai');
                    }
                    for (const [path, content] of Object.entries(normalizedFiles)) {
                      onFileUpdate?.(path, content);
                    }
                  }
                }

                // Check for token depletion in files_updated event
                // The backend sends pause info with the final file state
                if (data.paused && (data.pauseReason === 'insufficient_tokens' || data.pauseReason === 'tokens_depleted')) {
                  console.log('[ProductionAIChat] Token depletion detected in files_updated:', data);
                  showDepletionModal({
                    pauseReason: data.pauseReason,
                    tokensUsed: data.tokensUsed || 0,
                    contextId: data.contextId,
                    message: data.message || "I've run out of tokens and had to pause. Your work has been saved!"
                  });
                }
                break;

              case '3': // error
                eventCounts.error++;
                console.error('[ProductionAIChat] ❌ Stream error:', data);
                const streamError = data?.error;
                setError(typeof streamError === 'string' ? streamError : (streamError ? JSON.stringify(streamError) : 'Stream error occurred'));
                break;

              case 'p': // PHASE 2: Multi-agent pipeline progress
                eventCounts.progress++;
                // Progress updates from multi-agent orchestrator (intent, planning, architecture, coding)
                if (data.stage) {
                  console.log(`[ProductionAIChat] 📊 Pipeline progress: ${data.stage} - ${data.status}`);
                  // CRITICAL: Update with _updateKey to force React re-render
                  // This is what makes the streaming indicator appear immediately!
                  setMessages(prev => prev.map(m =>
                    m.id === assistantMessageId
                      ? {
                          ...m,
                          isStreaming: true,
                          isAgentic: true,
                          agenticProgress: data,
                          _updateKey: Date.now() // Forces React to detect change
                        }
                      : m
                  ));
                }
                break;

              default:
                eventCounts.other++;
                console.log(`[ProductionAIChat] Unknown event type: ${type}`, data);
            }
          } catch (parseError) {
            readErrors++;
            console.warn('[ProductionAIChat] Parse error:', parseError, 'Line:', line);
          }
        }
        }
      } catch (readError) {
        // Stream read error - log but don't throw since we may have partial content
        console.error('[ProductionAIChat] Stream read error:', readError.message);
        console.log(`[ProductionAIChat] Partial stream received: ${lineCount} lines, ${streamState.content.length} chars`);
        // Don't rethrow - we'll try to display what we have
      }

      // COMPREHENSIVE DEBUG: Log event summary
      console.log('[ProductionAIChat] 📈 Stream event summary:', eventCounts);
      console.log('[ProductionAIChat] Final state:', {
        contentLength: streamState.content.length,
        contentPartsCount: streamState.contentParts.length,
        toolCallsCount: currentToolCalls.length,
        toolResultsCount: currentToolResults.length
      });

      // INDUSTRY BEST PRACTICE: Flush any pending updates on stream end
      if (streamState.pendingUpdate) {
        cancelAnimationFrame(streamState.pendingUpdate);
      }
      // Force final update to ensure all content is rendered
      scheduleUpdate(true);

      // Log stream status
      if (!streamEnded) {
        console.warn('[ProductionAIChat] Stream did not end normally - may have been interrupted');
        // Mark any executing tools as failed for better UX
        streamState.contentParts.forEach(part => {
          if (part.type === 'tool' && part.isExecuting) {
            part.isExecuting = false;
            part.result = { error: 'Stream interrupted', success: false };
          }
        });
        scheduleUpdate(true);
      }
      if (readErrors > 0) {
        console.warn(`[ProductionAIChat] ${readErrors} parse errors during streaming`);
      }

      // Mark streaming complete
      setMessages(prev => prev.map(m =>
        m.id === assistantMessageId
          ? { ...m, isStreaming: false }
          : m
      ));

      // Check if AI indicated it needs to continue (CHUNK_COMPLETE pattern)
      const shouldContinue = streamState.content.includes('CHUNK_COMPLETE') ||
                             streamState.content.includes('chunk complete') ||
                             (currentToolCalls.length > 0 &&
                              streamState.content.toLowerCase().includes('continuing') &&
                              streamState.content.toLowerCase().includes('next'));

      if (shouldContinue) {
        console.log('[ProductionAIChat] CHUNK_COMPLETE detected - auto-continuing...');

        // Save the current assistant message first
        const assistantMessage = {
          id: assistantMessageId,
          role: 'assistant',
          content: streamState.content,
          contentParts: [...streamState.contentParts],
          toolCalls: currentToolCalls,
          toolResults: currentToolResults,
          timestamp: new Date().toISOString()
        };

        // Save history up to this point
        saveChatHistory([...baseMessages, userMessage, assistantMessage]);

        // Wait a bit, then auto-continue
        setTimeout(async () => {
          console.log('[ProductionAIChat] Sending auto-continue message');

          // Get current messages state including the assistant response
          const currentHistory = [...baseMessages, userMessage, assistantMessage];

          // Call handleSubmitInternal directly with 'continue'
          // This will add the continue message and make the API call
          await handleSubmitInternal('continue', currentHistory);
        }, 500);  // Small delay to let UI update

        return;
      }

      // Save history with final state
      saveChatHistory([...baseMessages, userMessage, {
        id: assistantMessageId,
        role: 'assistant',
        content: streamState.content,
        contentParts: [...streamState.contentParts],
        toolCalls: currentToolCalls,
        toolResults: currentToolResults,
        timestamp: new Date().toISOString()
      }]);

    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('[ProductionAIChat] Request aborted');
      } else {
        console.error('[ProductionAIChat] Error:', err);
        // Ensure error is always a string for rendering
        const errorMessage = typeof err === 'string'
          ? err
          : err?.message
            ? (typeof err.message === 'string' ? err.message : JSON.stringify(err.message))
            : 'An unexpected error occurred';
        setError(errorMessage);

        // Remove failed assistant message
        setMessages(prev => prev.filter(m => m.id !== assistantMessageId));
      }
    } finally {
      setIsLoading(false);
      onGenerationEnd?.();
      fileEventBus.emit('ai:processing-end');
      abortControllerRef.current = null;
    }
  };

  // Keep handleSubmitInternal ref updated AND signal when it's ready
  // This effect runs after every render to ensure the ref always has the latest function
  // The state update triggers the auto-submit effect to re-evaluate
  useEffect(() => {
    const wasReady = !!handleSubmitInternalRef.current;
    handleSubmitInternalRef.current = handleSubmitInternal;

    // Only update state if transitioning from not-ready to ready
    // This prevents unnecessary re-renders
    if (!wasReady && handleSubmitInternal) {
      console.log('[ProductionAIChat] Submit function now available');
      setSubmitFunctionReady(true);
    }
  });

  // Stop generation
  const handleStop = () => {
    if (agentic.isGenerating) {
      agentic.cancel();
      setIsAgenticMode(false);
    } else {
      abortControllerRef.current?.abort();
    }
    setIsLoading(false);
    onGenerationEnd?.();
    fileEventBus.emit('ai:processing-end');
  };

  // Clear chat
  const handleClear = async () => {
    setMessages([]);
    try {
      await fetch(`/api/projects/${projectId}/chat-history`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearAll: true })
      });
    } catch (e) {
      console.warn('[ProductionAIChat] Failed to clear history:', e);
    }
  };

  // Handle key press
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!isOpen) return null;

  // Header height matches editor header
  const HEADER_HEIGHT = 52;
  const MOBILE_TOOLBAR_HEIGHT = 60;
  const isFullscreen = position === 'fullscreen';

  // Embedded mode styles for flex layouts - no fixed positioning
  const embeddedStyles = embedded ? {
    position: 'relative',
    top: 'auto',
    left: 'auto',
    right: 'auto',
    width: '100%',
    height: '100%',
    zIndex: 'auto',
    boxShadow: 'none',
    borderLeft: 'none',
    borderRight: 'none',
  } : {};

  return (
    <ChatErrorBoundary onReset={handleClear}>
      <div style={{
        position: 'fixed',
        top: `${HEADER_HEIGHT}px`,
        left: isFullscreen ? 0 : (position === 'left' ? 0 : 'auto'),
        right: isFullscreen ? 0 : (position === 'right' ? 0 : 'auto'),
        width: isFullscreen ? '100%' : `${width}px`,
        height: isFullscreen ? `calc(100vh - ${HEADER_HEIGHT}px - ${MOBILE_TOOLBAR_HEIGHT}px)` : `calc(100vh - ${HEADER_HEIGHT}px)`,
        background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
        borderLeft: !isFullscreen && position === 'right' ? '1px solid #e2e8f0' : 'none',
        borderRight: !isFullscreen && position === 'left' ? '1px solid #e2e8f0' : 'none',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1000,
        boxShadow: isFullscreen ? 'none' : (position === 'left' ? '4px 0 24px rgba(0, 0, 0, 0.08)' : '-4px 0 24px rgba(0, 0, 0, 0.08)'),
        ...embeddedStyles
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid #e2e8f0',
          background: 'linear-gradient(135deg, rgba(0, 217, 255, 0.05) 0%, rgba(0, 168, 204, 0.02) 100%)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <div style={{
                position: 'absolute',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(0, 217, 255, 0.3) 0%, transparent 70%)',
                animation: 'pulse 2s ease-in-out infinite'
              }} />
              <img
                src="/Sparky.png"
                alt="Spark-AI"
                style={{
                  width: '24px',
                  height: '24px',
                  objectFit: 'contain',
                  filter: 'drop-shadow(0 0 6px rgba(0, 217, 255, 0.5))',
                  position: 'relative',
                  zIndex: 1
                }}
              />
            </div>
            <span style={{
              background: 'linear-gradient(135deg, #00D9FF 0%, #00A8CC 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontWeight: 600,
              fontSize: '14px'
            }}>
              Spark-AI
            </span>
            <div style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: session ? '#22c55e' : '#f59e0b',
              boxShadow: session ? '0 0 8px rgba(34, 197, 94, 0.5)' : '0 0 8px rgba(245, 158, 11, 0.5)'
            }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={handleClear}
              title="Clear chat"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                padding: '6px',
                borderRadius: '6px',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Icons.Clear />
            </button>
            {onClose && (
              <button
                onClick={onClose}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                  fontSize: '20px',
                  padding: '0 6px',
                  borderRadius: '6px',
                  transition: 'all 0.2s ease'
                }}
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {messages.length === 0 ? (
            <div style={{
              padding: '40px 20px',
              textAlign: 'center',
              color: '#64748b'
            }}>
              {/* Sparky mascot with glow effect */}
              <div style={{
                position: 'relative',
                display: 'inline-block',
                marginBottom: '20px'
              }}>
                <div style={{
                  position: 'absolute',
                  inset: '-20px',
                  background: 'radial-gradient(circle, rgba(0, 217, 255, 0.25) 0%, rgba(0, 168, 204, 0.1) 40%, transparent 70%)',
                  borderRadius: '50%',
                  animation: 'pulse 3s ease-in-out infinite'
                }} />
                <img
                  src="/Sparky.png"
                  alt="Spark-AI"
                  style={{
                    width: '64px',
                    height: '64px',
                    objectFit: 'contain',
                    filter: 'drop-shadow(0 0 12px rgba(0, 217, 255, 0.6))',
                    position: 'relative'
                  }}
                />
              </div>
              <h3 style={{
                background: 'linear-gradient(135deg, #00D9FF 0%, #00A8CC 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                marginBottom: '8px',
                fontSize: '18px',
                fontWeight: 600
              }}>
                Welcome to Spark-AI
              </h3>
              <p style={{ fontSize: '13px', lineHeight: '1.5', margin: '8px 0', color: '#64748b' }}>
                Your AI coding assistant. Tell me what you want to create!
              </p>
              <p style={{ fontSize: '12px', lineHeight: '1.4', margin: '12px 0 0 0', color: '#94a3b8' }}>
                Try: "Build a todo app" or "Create a landing page"
              </p>
              <div style={{
                marginTop: '20px',
                fontSize: '12px',
                textAlign: 'left',
                maxWidth: '280px',
                margin: '20px auto 0',
                background: 'linear-gradient(135deg, rgba(0, 217, 255, 0.06) 0%, rgba(0, 168, 204, 0.03) 100%)',
                borderRadius: '12px',
                padding: '16px',
                border: '1px solid rgba(0, 217, 255, 0.15)'
              }}>
                <div style={{ marginBottom: '8px', color: '#22c55e', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>✓</span> Create & edit files
                </div>
                <div style={{ marginBottom: '8px', color: '#22c55e', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>✓</span> Search codebase
                </div>
                <div style={{ marginBottom: '8px', color: '#22c55e', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>✓</span> Debug & explain code
                </div>
                <div style={{ color: e2bConnected ? '#22c55e' : '#f59e0b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>{e2bConnected ? '✓' : '!'}</span> Run commands & install packages
                </div>
              </div>

              {/* File context indicator */}
              {Object.keys(files).length > 0 && (
                <div style={{
                  marginTop: '16px',
                  padding: '12px 16px',
                  background: 'linear-gradient(135deg, rgba(0,217,255,0.1) 0%, rgba(0,168,204,0.05) 100%)',
                  borderRadius: '10px',
                  fontSize: '12px',
                  color: '#64748b',
                  border: '1px solid rgba(0,217,255,0.2)',
                  maxWidth: '280px',
                  margin: '16px auto 0'
                }}>
                  <div style={{ marginBottom: '4px', color: '#00A8CC' }}>
                    📁 {Object.keys(files).length} files loaded
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: '11px' }}>
                    I can read and modify your project
                  </div>
                </div>
              )}

              {/* Quick suggestions */}
              <div style={{
                marginTop: '24px',
                fontSize: '12px',
                color: '#64748b'
              }}>
                <div style={{ marginBottom: '12px', color: '#94a3b8', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Try asking:</div>
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  {[
                    'Create a landing page with a hero section',
                    'Add a dark mode toggle',
                    'Fix the bug in App.js'
                  ].map((suggestion, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '10px 14px',
                        background: '#ffffff',
                        borderRadius: '8px',
                        color: '#475569',
                        fontSize: '12px',
                        border: '1px solid #e2e8f0',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)'
                      }}
                      onClick={() => setInput(suggestion)}
                    >
                      "{suggestion}"
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <ChatMessage
                key={msg.id || idx}
                message={msg}
                isLast={idx === messages.length - 1}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Error display */}
        {error && (
          <div style={{
            padding: '10px 16px',
            backgroundColor: 'rgba(239, 68, 68, 0.06)',
            borderTop: '1px solid rgba(239, 68, 68, 0.15)',
            color: '#dc2626',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Icons.Warning />
            {typeof error === 'string' ? error : JSON.stringify(error)}
            <button
              onClick={() => setError(null)}
              style={{
                marginLeft: 'auto',
                background: 'none',
                border: 'none',
                color: '#dc2626',
                cursor: 'pointer'
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* AI Mode Selector - only show for Pro+ tiers */}
        {(userTier === 'pro' || userTier === 'business' || userTier === 'enterprise') && (
          <div style={{
            padding: '8px 16px',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#fafbfc'
          }}>
            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>Mode:</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {/* Standard Mode - always available */}
              <button
                type="button"
                onClick={() => setAiMode('standard')}
                style={{
                  padding: '4px 10px',
                  fontSize: '11px',
                  fontWeight: 500,
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  background: aiMode === 'standard'
                    ? 'linear-gradient(135deg, #00D9FF 0%, #00A8CC 100%)'
                    : '#f1f5f9',
                  color: aiMode === 'standard' ? '#fff' : '#64748b',
                  boxShadow: aiMode === 'standard' ? '0 2px 8px rgba(0, 217, 255, 0.3)' : 'none'
                }}
              >
                Standard
              </button>

              {/* Deep Think Mode - Pro and Enterprise only */}
              {(userTier === 'pro' || userTier === 'enterprise') && (
                <button
                  type="button"
                  onClick={() => setAiMode('deep_think')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 500,
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    background: aiMode === 'deep_think'
                      ? 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)'
                      : '#f1f5f9',
                    color: aiMode === 'deep_think' ? '#fff' : '#64748b',
                    boxShadow: aiMode === 'deep_think' ? '0 2px 8px rgba(139, 92, 246, 0.3)' : 'none'
                  }}
                  title="Opus planning for complex tasks"
                >
                  Deep Think
                </button>
              )}

              {/* Max Mode - Business and Enterprise only */}
              {(userTier === 'business' || userTier === 'enterprise') && (
                <button
                  type="button"
                  onClick={() => setAiMode('max')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 500,
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    background: aiMode === 'max'
                      ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
                      : '#f1f5f9',
                    color: aiMode === 'max' ? '#fff' : '#64748b',
                    boxShadow: aiMode === 'max' ? '0 2px 8px rgba(245, 158, 11, 0.3)' : 'none'
                  }}
                  title="All Opus models for maximum capability"
                >
                  Max
                </button>
              )}
            </div>
            <span style={{ fontSize: '10px', color: '#94a3b8', marginLeft: 'auto' }}>
              {aiMode === 'standard' && 'Balanced speed & quality'}
              {aiMode === 'deep_think' && 'Opus planning, Sonnet 4.5 coding'}
              {aiMode === 'max' && 'All Opus - maximum power'}
            </span>
          </div>
        )}

        {/* Input */}
        <form
          data-testid="chat-form"
          onSubmit={handleSubmit}
          style={{
            padding: '16px',
            borderTop: '1px solid #e2e8f0',
            background: 'linear-gradient(135deg, rgba(0, 217, 255, 0.03) 0%, rgba(0, 168, 204, 0.01) 100%)'
          }}
        >
          <div style={{ position: 'relative' }}>
            <textarea
              ref={inputRef}
              data-testid="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you want to build..."
              disabled={isLoading || agentic.isGenerating}
              rows={1}
              style={{
                width: '100%',
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '14px 54px 14px 16px',
                color: '#1e293b',
                fontSize: '14px',
                resize: 'none',
                fontFamily: 'inherit',
                lineHeight: '1.5',
                minHeight: '48px',
                maxHeight: '150px',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
                outline: 'none',
                transition: 'border-color 0.2s ease, box-shadow 0.2s ease'
              }}
              onFocus={(e) => {
                e.target.style.borderColor = '#00D9FF';
                e.target.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.08), 0 0 0 3px rgba(0, 217, 255, 0.15)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#e2e8f0';
                e.target.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.08)';
              }}
            />
            <button
              data-testid="chat-submit-button"
              type={(isLoading || agentic.isGenerating) ? 'button' : 'submit'}
              onClick={(isLoading || agentic.isGenerating) ? handleStop : undefined}
              disabled={!input.trim() && !(isLoading || agentic.isGenerating)}
              style={{
                position: 'absolute',
                right: '10px',
                bottom: '10px',
                background: (isLoading || agentic.isGenerating)
                  ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
                  : 'linear-gradient(135deg, #00D9FF 0%, #00A8CC 100%)',
                border: 'none',
                borderRadius: '8px',
                padding: '10px',
                color: '#fff',
                cursor: (!input.trim() && !(isLoading || agentic.isGenerating)) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: (isLoading || agentic.isGenerating)
                  ? '0 2px 12px rgba(239, 68, 68, 0.4)'
                  : '0 2px 12px rgba(0, 217, 255, 0.4)',
                transition: 'all 0.2s ease',
                opacity: (!input.trim() && !(isLoading || agentic.isGenerating)) ? 0.5 : 1
              }}
            >
              {(isLoading || agentic.isGenerating) ? <Icons.Stop /> : <Icons.Send />}
            </button>
          </div>
        </form>

        {/* CSS for animations */}
        <style jsx global>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes pulse {
            0%, 100% {
              transform: scale(1);
              opacity: 0.5;
            }
            50% {
              transform: scale(1.1);
              opacity: 0.8;
            }
          }
        `}</style>
      </div>

      {/* Token Depletion Modal */}
      <ChatTokenDepletionModal
        isOpen={isTokenModalOpen}
        onClose={hideDepletionModal}
        onResume={async (resumeData) => {
          // Resume generation with the saved context
          console.log('[ProductionAIChat] Resuming generation with context:', resumeData);
          hideDepletionModal();

          // Add a system message indicating resume
          const resumeMessage = {
            id: `resume-${Date.now()}`,
            role: 'user',
            content: resumeData.resumePrompt || 'Please continue from where you left off.'
          };

          // Call handleSubmitInternal with the resume message
          // The backend will use the saved context
          if (typeof handleSubmitInternal === 'function') {
            await handleSubmitInternal(resumeMessage.content, messages);
          }
        }}
        projectId={projectId}
        pauseReason={depletionInfo?.pauseReason}
        tokensUsed={depletionInfo?.tokensUsed}
        contextId={depletionInfo?.contextId}
        message={depletionInfo?.message}
      />

      {/* Database Connection Modal - shown when AI pauses for database credentials */}
      <DatabaseConnectionModal
        isOpen={dbConnectionPaused}
        aiPrompt={dbConnectionPrompt}
        projectId={projectId}
        onConnect={async (connectionResult) => {
          console.log('[ProductionAIChat] Database connected:', connectionResult);
          setDbConnectionPaused(false);
          setDbConnectionPrompt(null);

          // Resume AI workflow with the connection result
          const resumeToken = dbResumeTokenRef.current;
          dbResumeTokenRef.current = null;

          if (resumeToken) {
            // Call resume API to continue AI workflow
            try {
              setIsLoading(true);

              // Add assistant message about connection success
              setMessages(prev => [...prev, {
                id: `db-connected-${Date.now()}`,
                role: 'assistant',
                content: `Database connected to ${connectionResult.database}. Continuing with the task...`,
                contentParts: [{ type: 'text', content: `Database connected to ${connectionResult.database}. Continuing with the task...` }]
              }]);

              const response = await fetch('/api/ai/resume', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  resumeToken,
                  userInput: connectionResult,
                  projectId
                })
              });

              if (!response.ok) {
                throw new Error('Failed to resume AI workflow');
              }

              // Handle streaming response from resume endpoint
              const reader = response.body.getReader();
              const decoder = new TextDecoder();

              // Add streaming assistant message
              const streamingMessageId = `assistant-${Date.now()}`;
              setMessages(prev => [...prev, {
                id: streamingMessageId,
                role: 'assistant',
                content: '',
                contentParts: [],
                isStreaming: true
              }]);

              let streamContent = '';
              const streamState = {
                contentParts: [],
                toolCallMap: new Map()
              };

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

                for (const line of lines) {
                  try {
                    const jsonStr = line.slice(6);
                    if (jsonStr === '[DONE]') continue;
                    const { type, data } = JSON.parse(jsonStr);

                    switch (type) {
                      case '0': // text-delta
                        if (data && typeof data === 'string') {
                          streamContent += data;
                          // Update last text part or create new one
                          const lastPart = streamState.contentParts[streamState.contentParts.length - 1];
                          if (lastPart?.type === 'text') {
                            lastPart.content = streamContent;
                          } else {
                            streamState.contentParts.push({ type: 'text', content: streamContent });
                          }
                          // Update message
                          setMessages(prev => {
                            const updated = [...prev];
                            const lastMsg = updated.find(m => m.id === streamingMessageId);
                            if (lastMsg) {
                              lastMsg.content = streamContent;
                              lastMsg.contentParts = [...streamState.contentParts];
                            }
                            return updated;
                          });
                        }
                        break;

                      case '9': // tool-call
                        if (data?.toolName) {
                          const toolPart = {
                            type: 'tool',
                            toolCallId: data.toolCallId,
                            toolName: data.toolName,
                            args: data.args,
                            result: null,
                            isExecuting: true
                          };
                          streamState.contentParts.push(toolPart);
                          streamState.toolCallMap.set(data.toolCallId, toolPart);
                          setMessages(prev => {
                            const updated = [...prev];
                            const lastMsg = updated.find(m => m.id === streamingMessageId);
                            if (lastMsg) {
                              lastMsg.contentParts = [...streamState.contentParts];
                            }
                            return updated;
                          });
                        }
                        break;

                      case 'a': // tool-result
                        if (data?.toolCallId) {
                          const toolPart = streamState.toolCallMap.get(data.toolCallId);
                          if (toolPart) {
                            toolPart.result = data.result;
                            toolPart.isExecuting = false;
                            setMessages(prev => {
                              const updated = [...prev];
                              const lastMsg = updated.find(m => m.id === streamingMessageId);
                              if (lastMsg) {
                                lastMsg.contentParts = [...streamState.contentParts];
                              }
                              return updated;
                            });
                          }

                          // Handle file updates
                          const result = data.result;
                          if (result?.success && result?.path) {
                            const toolName = data.toolName || '';
                            if (['writeFile', 'editFile'].includes(toolName)) {
                              const content = result.new_content || result.content;
                              if (content) {
                                const normalizedPath = normalizePath(result.path);
                                setFile(normalizedPath, content, 'ai');
                                onFileUpdate?.(normalizedPath, content);
                              }
                            }
                          }
                        }
                        break;

                      case 'd': // finish
                        setMessages(prev => {
                          const updated = [...prev];
                          const lastMsg = updated.find(m => m.id === streamingMessageId);
                          if (lastMsg) {
                            lastMsg.isStreaming = false;
                          }
                          return updated;
                        });
                        break;
                    }
                  } catch (parseErr) {
                    console.warn('[ProductionAIChat] Resume stream parse error:', parseErr);
                  }
                }
              }
            } catch (err) {
              console.error('[ProductionAIChat] Resume error:', err);
              setError('Failed to resume AI workflow: ' + err.message);
            } finally {
              setIsLoading(false);
            }
          } else {
            // No resume token - just inform user and continue normally
            setMessages(prev => [...prev, {
              id: `db-connected-${Date.now()}`,
              role: 'assistant',
              content: `Database connected to ${connectionResult.database}. You can now ask me to work with your database.`,
              contentParts: [{ type: 'text', content: `Database connected to ${connectionResult.database}. You can now ask me to work with your database.` }]
            }]);
          }
        }}
        onCancel={() => {
          console.log('[ProductionAIChat] Database connection cancelled');
          setDbConnectionPaused(false);
          setDbConnectionPrompt(null);
          dbResumeTokenRef.current = null;

          // Add message about cancellation
          setMessages(prev => [...prev, {
            id: `db-cancelled-${Date.now()}`,
            role: 'assistant',
            content: 'Database connection was cancelled. I can continue working on other aspects of your project, or you can provide database credentials later when needed.',
            contentParts: [{ type: 'text', content: 'Database connection was cancelled. I can continue working on other aspects of your project, or you can provide database credentials later when needed.' }]
          }]);
        }}
      />
    </ChatErrorBoundary>
  );
}
