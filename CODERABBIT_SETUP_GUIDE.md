# CodeRabbit Setup Guide
**AI-Powered Code Reviews for Your Repository**

---

## 🎯 Current Repository Status

✅ **GitHub Repository Connected**
- Remote: `https://github.com/ctclark49/UCode.git`
- Branch: `main`
- Status: 1 commit ahead of origin

---

## 🚀 How to Set Up CodeRabbit

### Step 1: Install CodeRabbit App

1. **Go to CodeRabbit GitHub App:**
   - Visit: https://github.com/apps/coderabbitai

2. **Click "Install"**
   - Select your account: `ctclark49`
   - Choose repositories:
     - Option A: All repositories
     - Option B: Only select repositories → Select `UCode`

3. **Grant Permissions**
   - CodeRabbit needs:
     - Read access to code
     - Write access to pull requests (for comments)
     - Read access to issues

### Step 2: Configure CodeRabbit

Create a configuration file in your repository:

```yaml
# .coderabbit.yaml
language: en
reviews:
  profile: chill
  request_changes_workflow: false
  high_level_summary: true
  poem: false
  review_status: true
  collapse_walkthrough: false
  auto_review:
    enabled: true
    drafts: false
  tools:
    github-checks:
      enabled: true
      timeout: 90
chat:
  auto_reply: true
```

### Step 3: Push Your Code to GitHub

Since you're 1 commit ahead, push your changes:

```bash
# Add all new files
git add .

# Commit with a descriptive message
git commit -m "Add agentic AI system with Claude 3.5 Sonnet
- Deployed orchestrator to GKE production
- Added local development environment
- Integrated SSE streaming for real-time progress
- Added 9 production tools for file operations"

# Push to GitHub
git push origin main
```

---

## 🤖 How CodeRabbit Works

### Automatic Code Reviews

Once installed, CodeRabbit will automatically:

1. **Review Every Pull Request**
   - Analyzes code changes
   - Suggests improvements
   - Identifies bugs and security issues
   - Checks best practices

2. **Comment on Specific Lines**
   - Points out potential issues
   - Suggests better approaches
   - Explains why changes are needed

3. **Provide Summary**
   - High-level overview of changes
   - Risk assessment
   - Performance implications

### Example CodeRabbit Review

When you create a PR, CodeRabbit will comment like this:

```
🤖 CodeRabbit Review

## Summary
Added agentic orchestrator with streaming capabilities.

## Key Findings
✅ Well-structured code with clear separation of concerns
⚠️ Consider adding error handling in Redis connection
💡 Suggestion: Add timeout to Claude API calls

## Details

### server/agentic-orchestrator-streaming.js:45
❌ Missing error handling for Redis connection failure
Suggestion: Add try-catch block and retry logic

### server/agentic-orchestrator-streaming.js:120
💡 Consider adding timeout to prevent hanging requests
Suggestion: Add maxWaitTime parameter to stream API call
```

---

## 🔧 Using CodeRabbit for Debugging

### Method 1: Create Pull Request

```bash
# Create a new branch for your bug fix
git checkout -b fix/preview-system-bug

# Make your changes
# ... edit files ...

# Commit changes
git add .
git commit -m "Fix preview system bug"

# Push to GitHub
git push origin fix/preview-system-bug

# Create Pull Request on GitHub
# CodeRabbit will automatically review it
```

### Method 2: Ask CodeRabbit in PR Comments

In any pull request, you can ask CodeRabbit:

```
@coderabbitai help me debug the Redis connection issue
```

```
@coderabbitai why is the orchestrator crashing on startup?
```

```
@coderabbitai suggest improvements for error handling
```

### Method 3: Use CodeRabbit Chat

On the CodeRabbit website:
1. Go to https://coderabbit.ai
2. Select your repository
3. Ask questions about your code:
   - "Why is my Next.js app not connecting to Redis?"
   - "How can I improve the orchestrator's performance?"
   - "What's causing the SSE streaming to fail?"

---

## 📊 What CodeRabbit Can Help With

### 1. Bug Detection
- Memory leaks
- Race conditions
- Null pointer exceptions
- Type errors

### 2. Security Issues
- SQL injection vulnerabilities
- XSS vulnerabilities
- Exposed API keys
- Insecure dependencies

### 3. Performance
- Inefficient loops
- Unnecessary re-renders
- Database query optimization
- Memory usage

### 4. Best Practices
- Code structure
- Naming conventions
- Error handling
- Testing coverage

### 5. Documentation
- Missing JSDoc comments
- Unclear variable names
- Complex logic needing explanation

---

## 🎨 CodeRabbit Configuration Options

### Profile Options

**Chill (Recommended for Development)**
```yaml
reviews:
  profile: chill  # Less strict, focuses on major issues
```

**Assertive (For Production)**
```yaml
reviews:
  profile: assertive  # More thorough, catches everything
```

### Review Settings

```yaml
reviews:
  auto_review:
    enabled: true        # Auto-review every PR
    drafts: false        # Don't review draft PRs

  high_level_summary: true   # Get overview first
  review_status: true        # Show review status badge

  tools:
    github-checks:
      enabled: true      # Integrate with GitHub checks
      timeout: 90        # 90 seconds timeout
```

### Chat Settings

```yaml
chat:
  auto_reply: true       # Auto-respond to @mentions

learning_hints:
  enabled: true          # Learn from your preferences
```

---

## 💡 Pro Tips

### 1. Use Labels for Better Reviews

Add labels to PRs to get targeted reviews:
- `bug-fix`: Focus on correctness
- `performance`: Focus on optimization
- `security`: Focus on vulnerabilities
- `refactor`: Focus on code quality

### 2. Ask Specific Questions

Instead of:
```
@coderabbitai review this
```

Ask:
```
@coderabbitai check for memory leaks in the Redis connection handling
```

### 3. Iterate with CodeRabbit

```
User: @coderabbitai suggest improvements
CodeRabbit: [provides suggestions]
User: @coderabbitai help me implement suggestion #2
CodeRabbit: [provides implementation]
```

### 4. Use for Documentation

```
@coderabbitai generate JSDoc comments for this file
```

---

## 🔄 Workflow with CodeRabbit

### Daily Development Workflow

```bash
# 1. Create feature branch
git checkout -b feature/new-ai-tool

# 2. Make changes
# ... code ...

# 3. Commit and push
git add .
git commit -m "Add web search tool to orchestrator"
git push origin feature/new-ai-tool

# 4. Create PR on GitHub
# 5. CodeRabbit reviews automatically
# 6. Address CodeRabbit's suggestions
# 7. Merge when approved
```

### Bug Fixing Workflow

```bash
# 1. Create bug fix branch
git checkout -b fix/streaming-timeout

# 2. Fix the bug
# ... fix code ...

# 3. Push and create PR
git add .
git commit -m "Fix SSE streaming timeout issue"
git push origin fix/streaming-timeout

# 4. Ask CodeRabbit to verify fix
# In PR comments: @coderabbitai verify this fixes the timeout issue

# 5. CodeRabbit analyzes and confirms
# 6. Merge when verified
```

---

## 📈 Benefits for Your Project

### For Agentic Orchestrator
- ✅ Catch errors in Claude API integration
- ✅ Optimize Redis pub/sub performance
- ✅ Improve error handling in tool execution
- ✅ Ensure proper streaming cleanup

### For Next.js Frontend
- ✅ Catch React hooks issues
- ✅ Optimize component re-renders
- ✅ Improve SSE connection handling
- ✅ Fix memory leaks in EventSource

### For GKE Deployment
- ✅ Review Kubernetes manifests
- ✅ Optimize resource limits
- ✅ Check security best practices
- ✅ Validate Docker configurations

---

## 🆘 Troubleshooting

### CodeRabbit Not Reviewing PRs

**Check:**
1. Is the app installed? https://github.com/settings/installations
2. Does it have access to your repository?
3. Is auto-review enabled in `.coderabbit.yaml`?

**Fix:**
```bash
# Ensure .coderabbit.yaml exists
cat > .coderabbit.yaml << EOF
reviews:
  auto_review:
    enabled: true
EOF

git add .coderabbit.yaml
git commit -m "Enable CodeRabbit auto-review"
git push
```

### CodeRabbit Not Responding to @mentions

**Check:**
1. Are you using the correct syntax? `@coderabbitai` (not `@coderabbit`)
2. Is chat enabled in config?

**Fix:**
```yaml
# Add to .coderabbit.yaml
chat:
  auto_reply: true
```

---

## 📚 Additional Resources

- **CodeRabbit Docs:** https://docs.coderabbit.ai
- **GitHub App:** https://github.com/apps/coderabbitai
- **Dashboard:** https://coderabbit.ai/dashboard
- **Pricing:** https://coderabbit.ai/pricing (Free for open source!)

---

## 🎯 Quick Start Checklist

- [ ] Install CodeRabbit app on GitHub
- [ ] Grant access to `UCode` repository
- [ ] Create `.coderabbit.yaml` configuration
- [ ] Push code to GitHub (`git push origin main`)
- [ ] Create a test PR to verify setup
- [ ] Ask CodeRabbit a question in PR comments
- [ ] Review CodeRabbit's suggestions
- [ ] Iterate and improve your code

---

## 🚀 Next Steps

1. **Push your current code to GitHub**
   ```bash
   git add .
   git commit -m "Add agentic system with GKE deployment"
   git push origin main
   ```

2. **Install CodeRabbit**
   - Visit: https://github.com/apps/coderabbitai
   - Click "Install"
   - Select your repository

3. **Create a test PR**
   ```bash
   git checkout -b test/coderabbit-setup
   echo "# Test PR for CodeRabbit" > TEST.md
   git add TEST.md
   git commit -m "Test CodeRabbit integration"
   git push origin test/coderabbit-setup
   # Create PR on GitHub
   ```

4. **See CodeRabbit in action!**
   - Watch as it reviews your PR
   - Ask it questions
   - Learn from its suggestions

**Your repository is ready! Just install CodeRabbit and start getting AI-powered code reviews! 🎉**
