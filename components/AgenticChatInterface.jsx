/**
 * Agentic Chat Interface with Real-Time Streaming
 * Shows AI thinking, tool usage, and progress like Replit/Lovable
 */

import { useState, useEffect, useRef } from 'react';
import styles from '../styles/AgenticChatInterface.module.css';

export default function AgenticChatInterface({ projectId, userId, onFileChange }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTask, setCurrentTask] = useState(null);
  const [progressEvents, setProgressEvents] = useState([]);

  const messagesEndRef = useRef(null);
  const eventSourceRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, progressEvents]);

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const sendMessage = async () => {
    if (!input.trim() || isProcessing) return;

    const userMessage = {
      role: 'user',
      content: input.trim(),
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsProcessing(true);
    setProgressEvents([]);

    try {
      // Submit task to AI orchestrator
      const response = await fetch('/api/ai/submit-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          userId,
          prompt: userMessage.content,
          agentType: 'generic'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to submit task');
      }

      const { taskId } = await response.json();
      setCurrentTask(taskId);

      // Connect to SSE stream
      connectToProgressStream(taskId);

    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${error.message}`,
        timestamp: Date.now(),
        error: true
      }]);
      setIsProcessing(false);
    }
  };

  const connectToProgressStream = (taskId) => {
    const eventSource = new EventSource(`/api/ai/stream-progress?taskId=${taskId}`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('[SSE] Connected to progress stream');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleProgressEvent(data);
      } catch (error) {
        console.error('[SSE] Error parsing event:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('[SSE] Connection error:', error);
      eventSource.close();

      if (isProcessing) {
        setProgressEvents(prev => [...prev, {
          type: 'error',
          message: 'Connection to AI lost. Please try again.',
          timestamp: Date.now()
        }]);
        setIsProcessing(false);
      }
    };
  };

  const handleProgressEvent = (event) => {
    console.log('[Progress Event]', event.type, event);

    setProgressEvents(prev => [...prev, event]);

    switch (event.type) {
      case 'connected':
        // Initial connection established
        break;

      case 'task_started':
        setProgressEvents(prev => [...prev, {
          type: 'status',
          message: '🚀 Starting task...',
          timestamp: event.timestamp
        }]);
        break;

      case 'iteration_start':
        // New iteration starting
        break;

      case 'thinking_start':
        setProgressEvents(prev => [...prev, {
          type: 'thinking',
          message: '🤔 Thinking...',
          timestamp: event.timestamp,
          chunks: []
        }]);
        break;

      case 'thinking_chunk':
        // Update the last thinking event with new text
        setProgressEvents(prev => {
          const newEvents = [...prev];
          const lastThinkingIndex = newEvents.findLastIndex(e => e.type === 'thinking');

          if (lastThinkingIndex >= 0) {
            newEvents[lastThinkingIndex].chunks = [
              ...(newEvents[lastThinkingIndex].chunks || []),
              event.text
            ];
          }

          return newEvents;
        });
        break;

      case 'tool_start':
        setProgressEvents(prev => [...prev, {
          type: 'tool',
          tool: event.tool,
          status: 'starting',
          message: `🔧 Using tool: ${event.tool}`,
          timestamp: event.timestamp
        }]);
        break;

      case 'tool_executing':
        setProgressEvents(prev => {
          const newEvents = [...prev];
          const lastToolIndex = newEvents.findLastIndex(e => e.type === 'tool' && e.tool === event.tool);

          if (lastToolIndex >= 0) {
            newEvents[lastToolIndex].status = 'executing';
            newEvents[lastToolIndex].input = event.input;
            newEvents[lastToolIndex].message = `⚙️ Executing: ${event.tool}`;
          }

          return newEvents;
        });
        break;

      case 'tool_result':
        setProgressEvents(prev => {
          const newEvents = [...prev];
          const lastToolIndex = newEvents.findLastIndex(e => e.type === 'tool' && e.tool === event.tool);

          if (lastToolIndex >= 0) {
            newEvents[lastToolIndex].status = 'completed';
            newEvents[lastToolIndex].result = event.result;
            newEvents[lastToolIndex].message = `✅ ${event.tool} completed`;
          }

          return newEvents;
        });
        break;

      case 'file_change':
        // Notify parent component about file changes for live preview update
        if (onFileChange) {
          onFileChange({
            action: event.action,
            path: event.path,
            content: event.content
          });
        }

        setProgressEvents(prev => [...prev, {
          type: 'file',
          action: event.action,
          path: event.path,
          message: `📄 ${event.action === 'create' ? 'Created' : 'Edited'}: ${event.path}`,
          timestamp: event.timestamp
        }]);
        break;

      case 'task_completed':
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: event.summary || 'Task completed successfully!',
          files_modified: event.files_modified,
          timestamp: event.timestamp
        }]);

        setProgressEvents(prev => [...prev, {
          type: 'completed',
          message: '✅ Task completed!',
          timestamp: event.timestamp
        }]);

        setIsProcessing(false);

        if (eventSourceRef.current) {
          eventSourceRef.current.close();
        }
        break;

      case 'task_error':
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Error: ${event.error}`,
          timestamp: event.timestamp,
          error: true
        }]);

        setProgressEvents(prev => [...prev, {
          type: 'error',
          message: `❌ Error: ${event.error}`,
          timestamp: event.timestamp
        }]);

        setIsProcessing(false);

        if (eventSourceRef.current) {
          eventSourceRef.current.close();
        }
        break;

      case 'task_warning':
        setProgressEvents(prev => [...prev, {
          type: 'warning',
          message: `⚠️ ${event.message}`,
          timestamp: event.timestamp
        }]);
        break;
    }
  };

  const renderProgressEvent = (event, index) => {
    switch (event.type) {
      case 'thinking':
        return (
          <div key={index} className={styles.progressEvent}>
            <div className={styles.progressIcon}>🤔</div>
            <div className={styles.progressContent}>
              <div className={styles.progressTitle}>Agent Thinking</div>
              {event.chunks && event.chunks.length > 0 && (
                <div className={styles.thinkingText}>
                  {event.chunks.join('')}
                </div>
              )}
            </div>
          </div>
        );

      case 'tool':
        return (
          <div key={index} className={styles.progressEvent}>
            <div className={styles.progressIcon}>
              {event.status === 'completed' ? '✅' : '⚙️'}
            </div>
            <div className={styles.progressContent}>
              <div className={styles.progressTitle}>{event.message}</div>
              {event.input && (
                <div className={styles.toolInput}>
                  <pre>{JSON.stringify(event.input, null, 2)}</pre>
                </div>
              )}
              {event.result && (
                <div className={styles.toolResult}>
                  <pre>{JSON.stringify(event.result, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        );

      case 'file':
        return (
          <div key={index} className={styles.progressEvent}>
            <div className={styles.progressIcon}>📄</div>
            <div className={styles.progressContent}>
              <div className={styles.progressTitle}>{event.message}</div>
              <div className={styles.filePath}>{event.path}</div>
            </div>
          </div>
        );

      case 'status':
      case 'completed':
      case 'error':
      case 'warning':
        return (
          <div key={index} className={styles.progressEvent}>
            <div className={styles.progressContent}>
              <div className={styles.progressTitle}>{event.message}</div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className={styles.chatContainer}>
      <div className={styles.messagesContainer}>
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`${styles.message} ${msg.role === 'user' ? styles.userMessage : styles.assistantMessage} ${msg.error ? styles.errorMessage : ''}`}
          >
            <div className={styles.messageContent}>{msg.content}</div>
            {msg.files_modified && msg.files_modified.length > 0 && (
              <div className={styles.filesModified}>
                <strong>Files modified:</strong>
                <ul>
                  {msg.files_modified.map((file, i) => (
                    <li key={i}>{file}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}

        {isProcessing && progressEvents.length > 0 && (
          <div className={styles.progressContainer}>
            <div className={styles.progressHeader}>
              <span className={styles.progressSpinner}>⏳</span>
              <span>Agent is working...</span>
            </div>
            <div className={styles.progressEvents}>
              {progressEvents.map((event, index) => renderProgressEvent(event, index))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className={styles.inputContainer}>
        <textarea
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder={isProcessing ? "Agent is processing..." : "Describe what you want to build..."}
          disabled={isProcessing}
          rows={3}
        />
        <button
          className={styles.sendButton}
          onClick={sendMessage}
          disabled={!input.trim() || isProcessing}
        >
          {isProcessing ? 'Processing...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
