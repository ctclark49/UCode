/**
 * Production-Ready Agentic Orchestrator with Streaming
 * Provides real-time progress updates and tool-calling capabilities
 * Based on architecture from PRODUCTION_AGENTIC_SYSTEM_ARCHITECTURE_REPORT.md
 */

const http = require('http');
const { createClient } = require('redis');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Configuration
const PORT = process.env.PORT || 8082;
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AGENT_TYPE = process.env.AGENT_TYPE || 'generic';
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.join(process.cwd(), '.workspace');

// Redis clients
let redisClient;
let redisPub;
let anthropic;

// Agent system prompts by type
const AGENT_SYSTEM_PROMPTS = {
  'project-architect': `You are a senior software architect. Design system architecture, create project structures, and make high-level technical decisions.

When given a task:
1. Break down complex requirements into actionable steps
2. Create appropriate file structures
3. Write clean, well-documented code
4. Follow industry best practices
5. Consider scalability and maintainability

Use the provided tools to create files, edit code, install packages, and complete tasks.`,

  'frontend-developer': `You are an expert frontend developer specializing in React, Vue, and modern web technologies.

When given a task:
1. Write clean, performant UI code
2. Follow component best practices
3. Ensure responsive design
4. Implement proper state management
5. Add meaningful comments

Use the provided tools to create components, edit files, and build beautiful user interfaces.`,

  'backend-developer': `You are a backend engineer expert in Node.js, Python, and API design.

When given a task:
1. Design robust APIs
2. Implement proper error handling
3. Follow security best practices
4. Write efficient database queries
5. Add comprehensive logging

Use the provided tools to build server-side applications.`,

  'generic': `You are an AI software development assistant with full-stack capabilities.

When given a task:
1. Understand the requirements thoroughly
2. Plan your approach step-by-step
3. Use tools to create/modify files as needed
4. Test your work
5. Provide clear explanations

Use the provided tools to complete development tasks efficiently.`
};

// Tool definitions for Claude
const TOOLS = [
  {
    name: "create_file",
    description: "Create a new file in the project workspace with the specified content. Use this for creating new components, pages, or any other files.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The file path relative to the project root (e.g., 'src/components/Button.jsx')"
        },
        content: {
          type: "string",
          description: "The complete content of the file to create"
        }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "edit_file",
    description: "Edit an existing file by replacing specific content. Provide the old content to find and the new content to replace it with.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The file path relative to the project root"
        },
        old_content: {
          type: "string",
          description: "The exact content to find and replace (must match exactly)"
        },
        new_content: {
          type: "string",
          description: "The new content to replace the old content with"
        }
      },
      required: ["path", "old_content", "new_content"]
    }
  },
  {
    name: "read_file",
    description: "Read the contents of a file to understand the current code before making modifications.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The file path relative to the project root"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "list_files",
    description: "List all files in a directory to understand the project structure.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The directory path relative to the project root (empty string for root)"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "install_package",
    description: "Install an npm package as a dependency or devDependency.",
    input_schema: {
      type: "object",
      properties: {
        package: {
          type: "string",
          description: "The package name (e.g., 'react-router-dom')"
        },
        dev: {
          type: "boolean",
          description: "Whether to install as a devDependency (default: false)"
        }
      },
      required: ["package"]
    }
  },
  {
    name: "web_search",
    description: "Search the web for information, documentation, or examples. Use this when you need up-to-date information or API documentation.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "execute_command",
    description: "Execute a shell command in the project directory. Use for running tests, builds, or other scripts.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The command to execute (e.g., 'npm test')"
        }
      },
      required: ["command"]
    }
  },
  {
    name: "generate_image",
    description: "Generate an image using DALL-E 3 for UI mockups, icons, or illustrations.",
    input_schema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The image generation prompt"
        },
        filename: {
          type: "string",
          description: "The filename to save the image as (e.g., 'hero-image.png')"
        }
      },
      required: ["prompt", "filename"]
    }
  },
  {
    name: "task_complete",
    description: "Mark the task as complete and provide a summary of what was accomplished.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "A brief summary of what was accomplished"
        },
        files_modified: {
          type: "array",
          items: { type: "string" },
          description: "List of files that were created or modified"
        }
      },
      required: ["summary"]
    }
  }
];

// Initialize connections
async function initialize() {
  console.log(`[AgenticOrchestrator:${AGENT_TYPE}] Initializing...`);

  // Connect to Redis for queue
  redisClient = createClient({
    socket: {
      host: REDIS_HOST,
      port: REDIS_PORT
    }
  });

  redisClient.on('error', (err) => console.error('[Redis Client] Error:', err));
  await redisClient.connect();
  console.log('[Redis Client] Connected');

  // Connect to Redis for pub/sub
  redisPub = createClient({
    socket: {
      host: REDIS_HOST,
      port: REDIS_PORT
    }
  });

  redisPub.on('error', (err) => console.error('[Redis Pub] Error:', err));
  await redisPub.connect();
  console.log('[Redis Pub] Connected');

  // Initialize Anthropic
  if (ANTHROPIC_API_KEY) {
    anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    console.log('[Anthropic] Initialized with Claude 3.5 Sonnet');
  } else {
    console.error('[Anthropic] API key not set - agent cannot function!');
    process.exit(1);
  }

  // Create workspace directory
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
  console.log(`[Workspace] Root: ${WORKSPACE_ROOT}`);
}

// Publish progress update
async function publishProgress(taskId, event) {
  try {
    await redisPub.publish(`progress:${taskId}`, JSON.stringify({
      timestamp: Date.now(),
      ...event
    }));
  } catch (error) {
    console.error('[Publish] Error:', error);
  }
}

// Tool execution functions
async function executeTool(toolName, toolInput, taskContext) {
  const { taskId, projectId, userId } = taskContext;
  const projectRoot = path.join(WORKSPACE_ROOT, projectId);

  console.log(`[Tool] Executing ${toolName}:`, JSON.stringify(toolInput, null, 2));

  try {
    switch (toolName) {
      case 'create_file': {
        const filePath = path.join(projectRoot, toolInput.path);
        const dir = path.dirname(filePath);

        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filePath, toolInput.content, 'utf8');

        // Publish file change for live preview
        await redisPub.publish(`files:${projectId}`, JSON.stringify({
          action: 'create',
          path: toolInput.path,
          content: toolInput.content
        }));

        return {
          success: true,
          message: `Created file: ${toolInput.path}`,
          path: toolInput.path
        };
      }

      case 'edit_file': {
        const filePath = path.join(projectRoot, toolInput.path);

        let content = await fs.readFile(filePath, 'utf8');

        if (!content.includes(toolInput.old_content)) {
          return {
            success: false,
            error: `Old content not found in ${toolInput.path}. The file may have changed.`
          };
        }

        content = content.replace(toolInput.old_content, toolInput.new_content);
        await fs.writeFile(filePath, content, 'utf8');

        // Publish file change for live preview
        await redisPub.publish(`files:${projectId}`, JSON.stringify({
          action: 'edit',
          path: toolInput.path,
          content: content
        }));

        return {
          success: true,
          message: `Edited file: ${toolInput.path}`,
          path: toolInput.path
        };
      }

      case 'read_file': {
        const filePath = path.join(projectRoot, toolInput.path);
        const content = await fs.readFile(filePath, 'utf8');

        return {
          success: true,
          content,
          path: toolInput.path,
          lines: content.split('\n').length
        };
      }

      case 'list_files': {
        const dirPath = path.join(projectRoot, toolInput.path || '');
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        const files = [];
        const directories = [];

        for (const entry of entries) {
          if (entry.isDirectory()) {
            directories.push(entry.name + '/');
          } else {
            files.push(entry.name);
          }
        }

        return {
          success: true,
          directories,
          files,
          path: toolInput.path || '/'
        };
      }

      case 'install_package': {
        const flag = toolInput.dev ? '--save-dev' : '--save';
        const { stdout, stderr } = await execAsync(
          `npm install ${flag} ${toolInput.package}`,
          { cwd: projectRoot, timeout: 120000 }
        );

        return {
          success: true,
          message: `Installed ${toolInput.package}`,
          package: toolInput.package,
          output: stdout
        };
      }

      case 'web_search': {
        // Simplified web search - in production, integrate with Google Custom Search API
        return {
          success: true,
          message: `Searched for: ${toolInput.query}`,
          results: [
            { title: 'Search result placeholder', snippet: 'In production, integrate with real search API' }
          ]
        };
      }

      case 'execute_command': {
        const { stdout, stderr } = await execAsync(toolInput.command, {
          cwd: projectRoot,
          timeout: 60000
        });

        return {
          success: true,
          stdout,
          stderr,
          command: toolInput.command
        };
      }

      case 'generate_image': {
        // Placeholder for DALL-E 3 integration
        return {
          success: true,
          message: `Would generate image: ${toolInput.prompt}`,
          filename: toolInput.filename,
          note: 'In production, integrate with OpenAI DALL-E 3 API'
        };
      }

      case 'task_complete': {
        return {
          success: true,
          completed: true,
          summary: toolInput.summary,
          files_modified: toolInput.files_modified || []
        };
      }

      default:
        return {
          success: false,
          error: `Unknown tool: ${toolName}`
        };
    }
  } catch (error) {
    console.error(`[Tool] Error executing ${toolName}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Process task with streaming and tool-calling
async function processTask(task) {
  const { taskId, userId, projectId, prompt, context } = task;

  console.log(`[AgenticOrchestrator:${AGENT_TYPE}] Processing task ${taskId}`);

  // Create project workspace
  const projectRoot = path.join(WORKSPACE_ROOT, projectId);
  await fs.mkdir(projectRoot, { recursive: true });

  // Publish start event
  await publishProgress(taskId, {
    type: 'task_started',
    agentType: AGENT_TYPE,
    message: 'Starting task processing...'
  });

  // Get system prompt
  const systemPrompt = AGENT_SYSTEM_PROMPTS[AGENT_TYPE] || AGENT_SYSTEM_PROMPTS['generic'];

  // Initialize conversation
  const messages = [
    { role: 'user', content: prompt }
  ];

  let iterations = 0;
  const maxIterations = 20;
  let completed = false;

  try {
    while (!completed && iterations < maxIterations) {
      iterations++;

      await publishProgress(taskId, {
        type: 'iteration_start',
        iteration: iterations,
        message: `Iteration ${iterations}/${maxIterations}`
      });

      // Call Claude with streaming
      const stream = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 8192,
        system: systemPrompt,
        messages,
        tools: TOOLS,
        stream: true
      });

      let currentThinking = '';
      let toolUses = [];
      let assistantMessage = { role: 'assistant', content: [] };

      // Process stream
      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'text') {
            await publishProgress(taskId, {
              type: 'thinking_start',
              message: 'Agent is thinking...'
            });
          } else if (event.content_block.type === 'tool_use') {
            await publishProgress(taskId, {
              type: 'tool_start',
              tool: event.content_block.name
            });
          }
        }

        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            currentThinking += event.delta.text;

            // Stream thinking chunks
            await publishProgress(taskId, {
              type: 'thinking_chunk',
              text: event.delta.text
            });
          }
        }

        if (event.type === 'content_block_stop') {
          if (event.content_block?.type === 'text') {
            assistantMessage.content.push({
              type: 'text',
              text: currentThinking
            });
            currentThinking = '';
          } else if (event.content_block?.type === 'tool_use') {
            toolUses.push(event.content_block);
            assistantMessage.content.push(event.content_block);
          }
        }

        if (event.type === 'message_stop') {
          break;
        }
      }

      // Add assistant message to conversation
      messages.push(assistantMessage);

      // Execute tools if any were used
      if (toolUses.length > 0) {
        const toolResults = [];

        for (const toolUse of toolUses) {
          await publishProgress(taskId, {
            type: 'tool_executing',
            tool: toolUse.name,
            input: toolUse.input
          });

          const result = await executeTool(toolUse.name, toolUse.input, {
            taskId,
            projectId,
            userId
          });

          await publishProgress(taskId, {
            type: 'tool_result',
            tool: toolUse.name,
            result
          });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result)
          });

          // Check if task is complete
          if (toolUse.name === 'task_complete' && result.success) {
            completed = true;
            await publishProgress(taskId, {
              type: 'task_completed',
              summary: toolUse.input.summary,
              files_modified: toolUse.input.files_modified
            });
          }
        }

        // Add tool results to conversation
        messages.push({
          role: 'user',
          content: toolResults
        });
      } else {
        // No tools used, task might be complete or needs clarification
        completed = true;
        await publishProgress(taskId, {
          type: 'task_completed',
          message: 'Agent completed thinking, no more actions needed'
        });
      }
    }

    if (iterations >= maxIterations) {
      await publishProgress(taskId, {
        type: 'task_warning',
        message: 'Reached maximum iterations limit'
      });
    }

    // Store final result
    await redisClient.set(
      `result:${taskId}`,
      JSON.stringify({
        taskId,
        agentType: AGENT_TYPE,
        iterations,
        completed,
        timestamp: Date.now()
      }),
      { EX: 3600 }
    );

    // Publish completion
    await redisPub.publish('task-completed', JSON.stringify({
      taskId,
      agentType: AGENT_TYPE,
      iterations,
      completed
    }));

    console.log(`[AgenticOrchestrator:${AGENT_TYPE}] Completed task ${taskId} in ${iterations} iterations`);

  } catch (error) {
    console.error(`[AgenticOrchestrator] Error processing task ${taskId}:`, error);

    await publishProgress(taskId, {
      type: 'task_error',
      error: error.message
    });

    await redisClient.set(
      `result:${taskId}`,
      JSON.stringify({
        taskId,
        agentType: AGENT_TYPE,
        error: error.message,
        timestamp: Date.now()
      }),
      { EX: 3600 }
    );
  }
}

// Main processing loop
async function processQueue() {
  const queueName = `queue:${AGENT_TYPE}`;

  console.log(`[AgenticOrchestrator] Listening on queue: ${queueName}`);

  while (true) {
    try {
      // Block and wait for task
      const result = await redisClient.brPop(queueName, 5);

      if (result) {
        const task = JSON.parse(result.element);
        await processTask(task);
      }
    } catch (error) {
      console.error(`[AgenticOrchestrator] Error in processing loop:`, error);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// HTTP server for health checks
const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      type: 'agentic-orchestrator',
      agentType: AGENT_TYPE,
      hasAnthropic: !!anthropic,
      workspaceRoot: WORKSPACE_ROOT
    }));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

// Start orchestrator
async function start() {
  await initialize();

  server.listen(PORT, () => {
    console.log(`[AgenticOrchestrator:${AGENT_TYPE}] Health check listening on port ${PORT}`);
  });

  console.log(`[AgenticOrchestrator:${AGENT_TYPE}] Starting queue processing...`);
  processQueue().catch(err => {
    console.error(`[AgenticOrchestrator:${AGENT_TYPE}] Fatal error:`, err);
    process.exit(1);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log(`[AgenticOrchestrator:${AGENT_TYPE}] Shutting down...`);
  server.close();
  await redisClient.quit();
  await redisPub.quit();
  process.exit(0);
});

start().catch(err => {
  console.error(`[AgenticOrchestrator:${AGENT_TYPE}] Fatal error:`, err);
  process.exit(1);
});
