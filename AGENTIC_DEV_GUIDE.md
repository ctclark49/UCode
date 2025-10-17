# Agentic AI Development Guide
**Run locally with production-like behavior**

---

## 🚀 Quick Start

### Option 1: Run Everything Together (Recommended)
```bash
npm run dev:full
```

This automatically starts:
- ✅ Redis port-forward from GKE
- ✅ Agentic orchestrator with Claude 3.5 Sonnet
- ✅ Next.js development server

**URLs:**
- Next.js: http://localhost:3000
- Agentic Health: http://localhost:8082/health
- Redis: localhost:6379 (port-forwarded from GKE)

### Option 2: Manual Control

**Terminal 1 - Redis Port Forward:**
```bash
kubectl port-forward svc/redis 6379:6379 -n newk8v2-production
```

**Terminal 2 - Agentic Orchestrator:**
```bash
npm run dev:agentic
```

**Terminal 3 - Next.js:**
```bash
npm run dev
```

---

## 🏗️ System Architecture

### Local Development (Same as Production)
```
┌─────────────────────────────────────────────────┐
│  Your Browser: http://localhost:3000            │
│  - AgenticChatInterface component               │
│  - Real-time SSE streaming                      │
└────────────┬────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────┐
│  Next.js API Routes (localhost:3000)            │
│  - POST /api/ai/submit-task                     │
│  - GET /api/ai/stream-progress?taskId=...       │
└────────────┬────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────┐
│  Redis (localhost:6379)                         │
│  - Queue: queue:generic                         │
│  - Pub/Sub: progress:${taskId}                  │
│  - Port-forwarded from GKE production           │
└────────────┬────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────┐
│  Agentic Orchestrator (localhost:8082)          │
│  - BRPOP from queue:generic                     │
│  - Calls Claude 3.5 Sonnet streaming API        │
│  - Executes tools (create_file, edit_file...)   │
│  - Publishes progress to Redis pub/sub          │
└─────────────────────────────────────────────────┘
```

### Production GKE (Deployed)
```
┌─────────────────────────────────────────────────┐
│  User Browser: https://yourapp.com              │
└────────────┬────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────┐
│  Next.js Service (GKE)                          │
│  - Kubernetes Service: nextjs-web               │
└────────────┬────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────┐
│  Redis (GKE)                                    │
│  - Service: redis.newk8v2-production            │
│  - StatefulSet with persistence                 │
└────────────┬────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────┐
│  Agentic Orchestrator (GKE)                     │
│  - Deployment: agentic-orchestrator             │
│  - 3 replicas (auto-scales 2-10)                │
│  - Image: gcr.io/.../agentic-orchestrator:v1.0.1│
└─────────────────────────────────────────────────┘
```

**Key Point:** Local development uses the **same Redis and orchestrator code** as production, just running locally instead of in GKE.

---

## 🔧 Configuration

### Environment Variables (Auto-configured by `dev-with-agentic.bat`)

```bash
# Anthropic API Key
ANTHROPIC_API_KEY=sk-ant-api03-...

# Redis Connection (port-forwarded from GKE)
REDIS_HOST=localhost
REDIS_PORT=6379

# Agent Configuration
AGENT_TYPE=generic
NODE_ENV=development
```

### What Each Component Does

**1. Redis Port-Forward**
- Forwards GKE Redis to `localhost:6379`
- Allows local orchestrator to use production Redis
- Same queue and pub/sub as production

**2. Agentic Orchestrator**
- Listens on queue `queue:generic`
- Processes tasks with Claude 3.5 Sonnet
- Streams progress via Redis pub/sub
- Health endpoint: http://localhost:8082/health

**3. Next.js Dev Server**
- Frontend on http://localhost:3000
- API routes handle task submission and streaming
- Hot-reload for code changes

---

## 📝 Usage Examples

### Example 1: Using the Chat Interface

**Frontend Code (already implemented):**
```javascript
// pages/editor.js or your main page
import AgenticChatInterface from '../components/AgenticChatInterface';

function EditorPage() {
  return (
    <div>
      {/* Your existing UI */}

      <AgenticChatInterface
        projectId="your-project-id"
        userId="your-user-id"
      />
    </div>
  );
}
```

**What happens when user types a prompt:**

1. **User types:** "Create a counter component with increment and decrement buttons"

2. **Frontend submits:**
```javascript
POST /api/ai/submit-task
{
  "projectId": "proj-123",
  "userId": "user-456",
  "prompt": "Create a counter component...",
  "agentType": "generic"
}
```

3. **API queues task to Redis:**
```javascript
// Task added to queue:generic
{
  "taskId": "task-789",
  "prompt": "Create a counter component...",
  "projectId": "proj-123",
  "userId": "user-456"
}
```

4. **Orchestrator processes:**
```
[AgenticOrchestrator:generic] New task: task-789
[Claude] Thinking...
[Claude] Using tool: create_file
[Claude] Path: src/components/Counter.jsx
[Claude] Creating file...
[Redis Pub] Publishing progress to progress:task-789
```

5. **Frontend receives via SSE:**
```javascript
// GET /api/ai/stream-progress?taskId=task-789
// EventSource receives:

{type: 'thinking_chunk', text: 'I need to create a React component...'}
{type: 'tool_use', tool: 'create_file', path: 'src/components/Counter.jsx'}
{type: 'file_created', path: 'src/components/Counter.jsx'}
{type: 'completion', success: true}
```

6. **User sees real-time updates:**
```
🤔 Thinking...
"I need to create a React component with useState..."

🔧 Using tool: create_file
Path: src/components/Counter.jsx

✅ File created!

✅ Task completed successfully!
```

---

## 🧪 Testing the System

### 1. Verify Health Endpoints

```bash
# Check orchestrator is running
curl http://localhost:8082/health

# Expected response:
{"status":"healthy","timestamp":"2025-10-16T..."}
```

### 2. Test Task Submission (Manual)

```bash
# Submit a test task via API
curl -X POST http://localhost:3000/api/ai/submit-task \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "test-project",
    "userId": "test-user",
    "prompt": "Create a simple Hello World component",
    "agentType": "generic"
  }'

# Response:
{"success":true,"taskId":"task-abc123"}
```

### 3. Monitor Progress (Manual)

```bash
# Watch real-time progress
curl -N http://localhost:3000/api/ai/stream-progress?taskId=task-abc123

# You'll see SSE events streaming:
data: {"type":"thinking_chunk","text":"I'll create a simple component..."}

data: {"type":"tool_use","tool":"create_file","path":"Hello.jsx"}

data: {"type":"completion","success":true}
```

### 4. Check Orchestrator Logs

The orchestrator terminal will show:
```
[AgenticOrchestrator:generic] New task: task-abc123
[Claude] Thinking...
[Tool] create_file: Hello.jsx
[Redis Pub] Publishing progress
[AgenticOrchestrator:generic] Task completed: task-abc123
```

---

## 🛠️ Available Tools

The orchestrator has 9 production tools:

| Tool | Description | Example |
|------|-------------|---------|
| `create_file` | Create a new file | Create `Counter.jsx` |
| `edit_file` | Edit existing file | Update `App.js` |
| `read_file` | Read file contents | Check current code |
| `list_files` | List project files | See all components |
| `install_package` | Install npm package | Add `lodash` |
| `execute_command` | Run shell command | Run `npm test` |
| `web_search` | Search the web | Look up React docs |
| `generate_image` | Generate image (DALL-E) | Create logo |
| `task_complete` | Mark task done | Signal completion |

---

## 🔄 Development Workflow

### Typical Development Session

```bash
# 1. Start the full dev environment
npm run dev:full

# 2. Open your browser
http://localhost:3000

# 3. Make code changes
# - Edit components/AgenticChatInterface.jsx
# - Next.js hot-reloads automatically

# 4. Edit orchestrator logic
# - Edit server/agentic-orchestrator-streaming.js
# - Restart orchestrator terminal (Ctrl+C, then restart)

# 5. Test changes
# - Submit tasks via chat interface
# - Watch real-time progress
# - Check logs in orchestrator terminal

# 6. Stop when done
# - Ctrl+C in Next.js terminal
# - Close orchestrator window
# - Close Redis port-forward window
```

---

## 🐛 Troubleshooting

### Issue: "Cannot connect to Redis"

**Cause:** Redis port-forward not running

**Solution:**
```bash
kubectl port-forward svc/redis 6379:6379 -n newk8v2-production
```

### Issue: "Module not found: 'redis'"

**Cause:** Dependencies not installed

**Solution:**
```bash
npm install
```

### Issue: "Health check failed"

**Cause:** Orchestrator not running or crashed

**Solution:**
```bash
# Check logs in orchestrator terminal
# Look for errors and restart:
npm run dev:agentic
```

### Issue: "No progress updates in frontend"

**Cause:** SSE connection not working

**Solution:**
1. Check browser console for errors
2. Verify `/api/ai/stream-progress` is accessible
3. Check orchestrator is publishing to Redis pub/sub

### Issue: "Task queued but not processing"

**Cause:** Orchestrator not reading from queue

**Solution:**
```bash
# Check orchestrator logs show:
# [AgenticOrchestrator] Listening on queue: queue:generic

# If not, restart orchestrator
```

---

## 📊 Monitoring

### Check Queue Depth

```bash
# Connect to Redis via port-forward
redis-cli -h localhost -p 6379

# Check queue length
LLEN queue:generic

# View queued tasks (without removing)
LRANGE queue:generic 0 -1
```

### Check Active Progress Streams

```bash
# List all pub/sub channels
PUBSUB CHANNELS progress:*

# Monitor specific task progress
SUBSCRIBE progress:task-abc123
```

### Check Orchestrator Status

```bash
# Health check
curl http://localhost:8082/health

# Logs (in orchestrator terminal)
# Shows each task processing in real-time
```

---

## 🚀 Deployment Comparison

| Aspect | Local Dev | GKE Production |
|--------|-----------|----------------|
| **Next.js** | localhost:3000 | GKE Service |
| **Redis** | Port-forward from GKE | Redis StatefulSet |
| **Orchestrator** | localhost:8082 | 3 pods (auto-scale 2-10) |
| **Claude API** | Same API key | Same API key |
| **Code** | Exact same | Exact same |
| **Behavior** | Identical | Identical |

**The only difference:** Local runs on your machine, production runs in GKE. Everything else is the same!

---

## 📚 Additional Resources

- **Production Deployment:** See `DEPLOYMENT_STATUS.md`
- **Architecture Details:** See `PRODUCTION_READY_SUMMARY.md`
- **Complete Setup:** See `PRODUCTION_DEPLOYMENT_CHECKLIST.md`
- **GKE Status:** Run `kubectl get pods -n newk8v2-production`

---

## ✨ What Makes This Production-Like

1. **Same Redis**: Uses actual production Redis (port-forwarded)
2. **Same Code**: Orchestrator runs identical code as GKE deployment
3. **Same API**: Uses same Claude 3.5 Sonnet API
4. **Same Queue**: Processes from same Redis queue
5. **Same Streaming**: Identical SSE streaming mechanism
6. **Same Tools**: All 9 tools work exactly the same

**You're testing the actual production system locally!**

---

## 🎯 Next Steps

1. **Start dev environment:** `npm run dev:full`
2. **Test in browser:** http://localhost:3000
3. **Submit a task:** Use chat interface
4. **Watch it work:** See real-time progress
5. **Make changes:** Edit code and test
6. **Deploy when ready:** Push to GKE with same code

**Happy coding! 🚀**
