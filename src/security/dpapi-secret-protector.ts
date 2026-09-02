import { spawn } from "node:child_process";

export interface SecretProtector {
  protect(secret: string): Promise<string>;
  unprotect(ciphertext: string): Promise<string>;
}

const PROTECT_SCRIPT = `
Add-Type -AssemblyName System.Security
$plain = [Console]::In.ReadToEnd()
$bytes = [Text.Encoding]::UTF8.GetBytes($plain)
$sealed = [Security.Cryptography.ProtectedData]::Protect(
  $bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Convert]::ToBase64String($sealed))
`;

const UNPROTECT_SCRIPT = `
Add-Type -AssemblyName System.Security
$ciphertext = [Console]::In.ReadToEnd()
$sealed = [Convert]::FromBase64String($ciphertext)
$bytes = [Security.Cryptography.ProtectedData]::Unprotect(
  $sealed, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
`;

function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

async function runPowerShell(script: string, input: string): Promise<string> {
  if (process.platform !== "win32") {
    throw new Error("持久化 SSH 凭据目前需要 Windows DPAPI");
  }
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodePowerShell(script),
    ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `Windows 凭据加密失败（退出码 ${code}）`));
    });
    child.stdin.end(input);
  });
}

export class DpapiSecretProtector implements SecretProtector {
  protect(secret: string): Promise<string> {
    return runPowerShell(PROTECT_SCRIPT, secret);
  }

  unprotect(ciphertext: string): Promise<string> {
    return runPowerShell(UNPROTECT_SCRIPT, ciphertext);
  }
}
