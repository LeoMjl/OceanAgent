import { spawn } from "node:child_process";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AppConfig } from "../../config.js";

const MAX_CAPTURED_CHARS = 80_000;

const REMOTE_RUNNER = String.raw`
import os, shlex, sys, time
import paramiko

client = paramiko.SSHClient()
client.load_system_host_keys()
if os.environ.get("OCEAN_REMOTE_STRICT") != "true":
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

connect = {
    "hostname": os.environ["OCEAN_REMOTE_HOST"],
    "port": int(os.environ["OCEAN_REMOTE_PORT"]),
    "username": os.environ["OCEAN_REMOTE_USERNAME"],
    "timeout": float(os.environ["OCEAN_REMOTE_CONNECT_TIMEOUT"]),
    "banner_timeout": float(os.environ["OCEAN_REMOTE_CONNECT_TIMEOUT"]),
    "auth_timeout": float(os.environ["OCEAN_REMOTE_CONNECT_TIMEOUT"]),
}
password = os.environ.get("OCEAN_REMOTE_PASSWORD")
key_path = os.environ.get("OCEAN_REMOTE_KEY_PATH")
if password:
    connect["password"] = password
if key_path:
    connect["key_filename"] = key_path

try:
    client.connect(**connect)
    command = os.environ["OCEAN_REMOTE_COMMAND"]
    cwd = os.environ.get("OCEAN_REMOTE_CWD")
    if cwd:
        command = "cd " + shlex.quote(cwd) + " && " + command
    _, stdout, stderr = client.exec_command(command)
    channel = stdout.channel
    while not channel.exit_status_ready() or channel.recv_ready() or channel.recv_stderr_ready():
        if channel.recv_ready():
            os.write(sys.stdout.fileno(), channel.recv(8192))
        if channel.recv_stderr_ready():
            os.write(sys.stderr.fileno(), channel.recv_stderr(8192))
        time.sleep(0.05)
    status = channel.recv_exit_status()
finally:
    client.close()
sys.exit(status)
`;

function appendBounded(current: string, chunk: string): string {
  const combined = current + chunk;
  return combined.length <= MAX_CAPTURED_CHARS
    ? combined
    : `[较早输出已截断]\n${combined.slice(-MAX_CAPTURED_CHARS)}`;
}

interface ProcessResult {
  code: number;
  output: string;
  errorOutput: string;
  timedOut: boolean;
}

export interface ProjectRemoteTarget {
  host: string;
  port: number;
  username: string;
  password?: string;
  keyPath?: string;
  workspacePath: string;
}

interface ResolvedRemoteTarget extends ProjectRemoteTarget {
  pythonPath: string;
  connectTimeoutMs: number;
  commandTimeoutMs: number;
  strictHostKey: boolean;
}

function resolveRemote(config: AppConfig, target?: ProjectRemoteTarget): ResolvedRemoteTarget {
  const remote = config.remoteSsh;
  return {
    host: target?.host ?? "",
    port: target?.port ?? 22,
    username: target?.username ?? "",
    password: target?.password,
    keyPath: target?.keyPath,
    workspacePath: target?.workspacePath ?? "",
    pythonPath: remote.pythonPath,
    connectTimeoutMs: remote.connectTimeoutMs,
    commandTimeoutMs: remote.commandTimeoutMs,
    strictHostKey: remote.strictHostKey,
  };
}

function runPython(
  remote: ResolvedRemoteTarget,
  command: string,
  cwd: string | undefined,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  onProgress: (output: string, errorOutput: string) => void,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    let output = "";
    let errorOutput = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(remote.pythonPath, ["-u", "-c", REMOTE_RUNNER], {
      windowsHide: true,
      env: {
        ...process.env,
        OCEAN_REMOTE_HOST: remote.host!,
        OCEAN_REMOTE_PORT: String(remote.port),
        OCEAN_REMOTE_USERNAME: remote.username!,
        OCEAN_REMOTE_PASSWORD: remote.password ?? "",
        OCEAN_REMOTE_KEY_PATH: remote.keyPath ?? "",
        OCEAN_REMOTE_CONNECT_TIMEOUT: String(remote.connectTimeoutMs / 1_000),
        OCEAN_REMOTE_STRICT: String(remote.strictHostKey),
        OCEAN_REMOTE_COMMAND: command,
        OCEAN_REMOTE_CWD: cwd ?? "",
      },
    });
    const stop = () => child.kill();
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    const abort = () => stop();
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (data: Buffer) => {
      output = appendBounded(output, data.toString("utf8"));
      onProgress(output, errorOutput);
    });
    child.stderr.on("data", (data: Buffer) => {
      errorOutput = appendBounded(errorOutput, data.toString("utf8"));
      onProgress(output, errorOutput);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) reject(new Error("远程科研命令已取消"));
      else resolve({ code: code ?? -1, output, errorOutput, timedOut });
    });
  });
}

function assertConfigured(remote: ResolvedRemoteTarget): void {
  if (!remote.host || !remote.username || (!remote.password && !remote.keyPath)) {
    throw new Error("远程科研服务器尚未连接。请在研究项目中重新填写 SSH 凭据并测试连接。");
  }
}

export async function testRemoteConnection(
  config: AppConfig,
  target: ProjectRemoteTarget,
): Promise<{ message: string; workspacePath: string }> {
  const remote = resolveRemote(config, target);
  assertConfigured(remote);
  const result = await runPython(
    remote,
    "printf 'OceanAgent SSH connected\\n' && pwd",
    remote.workspacePath,
    Math.max(remote.connectTimeoutMs + 5_000, 10_000),
    undefined,
    () => undefined,
  );
  if (result.timedOut) throw new Error("SSH 连接测试超时，请检查主机地址、端口和网络。");
  if (result.code !== 0) {
    throw new Error(`SSH 连接或远程项目目录验证失败：${result.errorOutput || result.output || `退出码 ${result.code}`}`);
  }
  return {
    message: result.output.trim() || "OceanAgent SSH connected",
    workspacePath: remote.workspacePath,
  };
}

export function createRunRemoteCommandTool(config: AppConfig, target?: ProjectRemoteTarget) {
  const remote = resolveRemote(config, target);
  return defineTool({
    name: "run_remote_command",
    label: "运行远程科研命令",
    description: "在当前研究项目连接的远程Linux科研服务器上执行命令。认证信息由服务端安全注入；参数中不得包含密码或密钥。",
    parameters: Type.Object({
      command: Type.String({ description: "在远程Linux服务器执行的单条shell命令" }),
      cwd: Type.Optional(Type.String({ description: "远程工作目录，例如 /data/research/project" })),
      timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 1800 })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      assertConfigured(remote);
      const requestedTimeoutMs = params.timeoutSeconds
        ? params.timeoutSeconds * 1_000
        : remote.commandTimeoutMs;
      const timeoutMs = Math.min(requestedTimeoutMs, Math.max(1_000, config.timeouts.hardMs - 30_000));
      const result = await runPython(remote, params.command, params.cwd ?? remote.workspacePath, timeoutMs, signal, (stdout, stderr) => {
        onUpdate?.({
          content: [{ type: "text", text: [stdout, stderr].filter(Boolean).join("\n") || "远程命令正在运行…" }],
          details: { running: true, stdout, stderr },
        });
      });
      if (result.timedOut) throw new Error(`远程科研命令超过 ${Math.round(timeoutMs / 1_000)} 秒，已停止。可缩小任务范围或提高 timeoutSeconds。`);
      if (result.code !== 0) {
        const diagnostic = result.errorOutput || result.output || "没有返回诊断信息";
        throw new Error(`远程科研命令退出码 ${result.code}：\n${diagnostic}`);
      }
      const text = result.output || result.errorOutput || "远程命令执行成功（无输出）。";
      return {
        content: [{ type: "text", text }],
        details: { exitCode: result.code, stdout: result.output, stderr: result.errorOutput },
      };
    },
  });
}
