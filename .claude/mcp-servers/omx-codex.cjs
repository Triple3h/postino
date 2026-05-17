#!/usr/bin/env node

const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const MADMAX = process.env.OMX_MADMAX !== "0";
const HIGH = process.env.OMX_HIGH !== "0";
const WORKDIR = process.env.OMX_WORKDIR || process.cwd();
const RUNS_DIR = path.join(WORKDIR, ".claude", "codex-runs");

// Ensure runs directory exists
if (!fs.existsSync(RUNS_DIR)) fs.mkdirSync(RUNS_DIR, { recursive: true });

const server = { name: "omx-codex", version: "1.2.0" };

// Available agents from ~/.codex/agents/
const AVAILABLE_AGENTS = [
  "analyst", "architect", "code-reviewer", "code-simplifier", "critic",
  "debugger", "dependency-expert", "designer", "executor", "explore",
  "git-master", "planner", "researcher", "team-executor", "test-engineer",
  "verifier", "vision", "writer",
];

// In-memory job tracking
const jobs = new Map();

function getJobPath(jobId) {
  return path.join(RUNS_DIR, `${jobId}.json`);
}

function saveJob(job) {
  fs.writeFileSync(getJobPath(job.id), JSON.stringify(job, null, 2));
}

function loadJob(jobId) {
  const p = getJobPath(jobId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

const tools = [
  {
    name: "codex_exec",
    description:
      "Execute a code task using OpenAI Codex via omx (oh-my-codex). " +
      "Runs `omx exec --madmax --high <prompt>` non-interactively. " +
      "By default runs in async mode: returns a job_id immediately, use codex_status to poll. " +
      "Set sync=true to block until completion (may timeout for long tasks). " +
      "Supports agent selection (e.g. 'executor', 'debugger') and goal mode.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The task/instruction for Codex to execute",
        },
        workdir: {
          type: "string",
          description: "Working directory for Codex (defaults to current project root)",
        },
        model: {
          type: "string",
          description: "Model override (e.g. 'o3', 'gpt-5.5'). Defaults to config.",
        },
        sandbox: {
          type: "string",
          enum: ["read-only", "workspace-write", "danger-full-access"],
          description: "Sandbox policy. Defaults to 'workspace-write'.",
        },
        agent: {
          type: "string",
          enum: AVAILABLE_AGENTS,
          description:
            "Codex native agent to use. Each has specialized role: " +
            "executor=implementation, debugger=root-cause, architect=design, " +
            "code-reviewer=review, planner=planning, etc.",
        },
        goal: {
          type: "string",
          description:
            "Enable Codex goal mode with this objective. Codex will create and track " +
            "goals internally. Set to 'auto' to let Codex infer goals from the prompt.",
        },
        reasoning_effort: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Reasoning effort override. Default follows agent config or 'high'.",
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (default 600)",
        },
        sync: {
          type: "boolean",
          description: "If true, block until Codex finishes. Default false (async).",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "codex_status",
    description:
      "Check the status of a Codex job. Returns pending/running/completed/failed " +
      "with output when done. Also lists all recent jobs if no job_id given.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description: "Job ID to check. Omit to list all recent jobs.",
        },
      },
    },
  },
  {
    name: "codex_cancel",
    description: "Cancel a running Codex job.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description: "Job ID to cancel",
        },
      },
      required: ["job_id"],
    },
  },
  {
    name: "codex_review",
    description:
      "Run a code review using Codex via omx. Uses code-reviewer agent by default. " +
      "Returns job_id for async polling.",
    inputSchema: {
      type: "object",
      properties: {
        workdir: {
          type: "string",
          description: "Working directory (defaults to current project root)",
        },
        model: {
          type: "string",
          description: "Model override",
        },
        agent: {
          type: "string",
          enum: AVAILABLE_AGENTS,
          description: "Agent to use. Defaults to 'code-reviewer'.",
        },
        goal: {
          type: "string",
          description: "Goal mode objective for the review.",
        },
        reasoning_effort: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Reasoning effort override.",
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (default 600)",
        },
        sync: {
          type: "boolean",
          description: "If true, block until done. Default false.",
        },
      },
    },
  },
];

function buildArgs(prompt, options = {}) {
  const args = ["exec"];
  if (MADMAX) args.push("--madmax");
  if (HIGH) args.push("--high");
  args.push("-C", options.workdir || WORKDIR);
  if (options.model) args.push("-m", options.model);
  args.push("-s", options.sandbox || "workspace-write");

  // Agent: pass via -c agent=<name>
  if (options.agent) {
    args.push("-c", `agent="${options.agent}"`);
  }

  // Goal mode: enable goals feature + embed goal in prompt
  if (options.goal) {
    args.push("-c", "features.goals=true");
  }

  // Reasoning effort override
  if (options.reasoning_effort) {
    args.push("-c", `model_reasoning_effort="${options.reasoning_effort}"`);
  }

  // If goal specified, prepend goal instruction to prompt
  if (options.goal && options.goal !== "auto") {
    args.push(`[goal] ${options.goal}\n\n[task] ${prompt}`);
  } else {
    args.push(prompt);
  }

  return args;
}

function startJob(omxArgs, timeoutSec) {
  const jobId = randomUUID().slice(0, 8);
  const job = {
    id: jobId,
    status: "running",
    startedAt: new Date().toISOString(),
    timeout: timeoutSec || 600,
    args: omxArgs,
    exitCode: null,
    output: null,
    error: null,
  };

  jobs.set(jobId, job);
  saveJob(job);

  const proc = spawn("omx", omxArgs, {
    cwd: WORKDIR,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  const timer = setTimeout(() => {
    proc.kill("SIGTERM");
    setTimeout(() => proc.kill("SIGKILL"), 5000);
    job.status = "failed";
    job.error = `Timed out after ${timeoutSec || 600}s`;
    saveJob(job);
  }, (timeoutSec || 600) * 1000);

  proc.stdout.on("data", (d) => (stdout += d.toString()));
  proc.stderr.on("data", (d) => (stderr += d.toString()));

  proc.on("close", (code) => {
    clearTimeout(timer);
    if (job.status !== "failed") {
      job.status = code === 0 ? "completed" : "failed";
      job.exitCode = code;
      job.output = stdout || null;
      job.error = code !== 0 ? stderr : null;
      job.completedAt = new Date().toISOString();
      saveJob(job);
    }
  });

  proc.on("error", (err) => {
    clearTimeout(timer);
    job.status = "failed";
    job.error = err.message;
    saveJob(job);
  });

  job._proc = proc; // keep ref for cancel
  return jobId;
}

function formatJobStatus(job) {
  if (!job) return "Job not found.";
  const lines = [
    `Job: ${job.id}`,
    `Status: ${job.status}`,
    `Started: ${job.startedAt}`,
  ];
  if (job.completedAt) lines.push(`Completed: ${job.completedAt}`);
  if (job.exitCode !== null) lines.push(`Exit code: ${job.exitCode}`);
  if (job.output) lines.push(`\n--- Output ---\n${job.output.slice(0, 40000)}`);
  if (job.error) lines.push(`\n--- Error ---\n${job.error.slice(0, 10000)}`);
  return lines.join("\n");
}

async function handleToolCall(name, args) {
  try {
    if (name === "codex_exec") {
      const omxArgs = buildArgs(args.prompt, args);
      const jobId = startJob(omxArgs, args.timeout);

      if (args.sync) {
        // Block until done
        const job = jobs.get(jobId);
        await new Promise((resolve) => {
          const check = setInterval(() => {
            const j = loadJob(jobId);
            if (j.status === "completed" || j.status === "failed") {
              clearInterval(check);
              resolve();
            }
          }, 2000);
        });
        const final = loadJob(jobId);
        return {
          content: [{ type: "text", text: formatJobStatus(final) }],
          isError: final.status === "failed",
        };
      }

      return {
        content: [{
          type: "text",
          text: `Codex job started: ${jobId}\nStatus: running\nUse codex_status with job_id "${jobId}" to check progress.`,
        }],
      };
    }

    if (name === "codex_status") {
      if (args.job_id) {
        const job = loadJob(args.job_id);
        return {
          content: [{ type: "text", text: formatJobStatus(job) }],
          isError: !job,
        };
      }
      // List all jobs
      const files = fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"));
      const allJobs = files
        .map((f) => JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf-8")))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 20);
      const summary = allJobs.length === 0
        ? "No Codex jobs found."
        : allJobs
            .map((j) => `${j.id}  ${j.status}  ${j.startedAt}${j.exitCode !== null ? `  exit:${j.exitCode}` : ""}`)
            .join("\n");
      return { content: [{ type: "text", text: summary }] };
    }

    if (name === "codex_cancel") {
      const job = jobs.get(args.job_id);
      if (job && job._proc && job.status === "running") {
        job._proc.kill("SIGTERM");
        job.status = "cancelled";
        job.error = "Cancelled by user";
        saveJob(job);
        return { content: [{ type: "text", text: `Job ${args.job_id} cancelled.` }] };
      }
      const diskJob = loadJob(args.job_id);
      if (!diskJob) {
        return { content: [{ type: "text", text: `Job ${args.job_id} not found.` }], isError: true };
      }
      return {
        content: [{ type: "text", text: `Job ${args.job_id} is ${diskJob.status} (cannot cancel).` }],
      };
    }

    if (name === "codex_review") {
      const reviewOpts = { ...args, sandbox: "read-only", agent: args.agent || "code-reviewer" };
      const omxArgs = buildArgs("review", reviewOpts);
      const jobId = startJob(omxArgs, args.timeout);

      if (args.sync) {
        await new Promise((resolve) => {
          const check = setInterval(() => {
            const j = loadJob(jobId);
            if (j.status === "completed" || j.status === "failed") {
              clearInterval(check);
              resolve();
            }
          }, 2000);
        });
        const final = loadJob(jobId);
        return {
          content: [{ type: "text", text: formatJobStatus(final) }],
          isError: final.status === "failed",
        };
      }

      return {
        content: [{
          type: "text",
          text: `Codex review job started: ${jobId}\nUse codex_status with job_id "${jobId}" to check progress.`,
        }],
      };
    }

    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
}

// JSON-RPC stdio transport
const rl = readline.createInterface({ input: process.stdin });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

rl.on("line", (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: server,
      },
    });
    return;
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools } });
    return;
  }
  if (method === "tools/call") {
    handleToolCall(params.name, params.arguments || {})
      .then((result) => send({ jsonrpc: "2.0", id, result }))
      .catch((err) => send({ jsonrpc: "2.0", id, error: { code: -32000, message: err.message } }));
    return;
  }
  send({ jsonrpc: "2.0", id, result: {} });
});
