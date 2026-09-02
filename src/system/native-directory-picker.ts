import { spawn } from "node:child_process";

const PICKER_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择 OceanAgent 项目目录'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
}
`;

export async function pickLocalDirectory(): Promise<string | null> {
  if (process.platform !== "win32") {
    throw new Error("当前系统暂不支持原生目录选择，请手动输入绝对路径");
  }
  const encoded = Buffer.from(PICKER_SCRIPT, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-STA", "-EncodedCommand", encoded,
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) reject(new Error(stderr.trim() || "打开目录选择器失败"));
      else resolve(stdout.trim() || null);
    });
  });
}
