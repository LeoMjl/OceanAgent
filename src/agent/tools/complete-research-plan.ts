import { copyFile, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export async function workspaceFile(workspace: string, path: string): Promise<string> {
  const root = await realpath(workspace);
  const file = await realpath(resolve(root, path));
  const rel = relative(root, file);
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw new Error("产物必须在当前项目目录内");
  if (!(await stat(file)).isFile()) throw new Error("产物不是文件");
  return file;
}

export function createCompleteResearchPlanTool(options: {
  workspace: string; publicationRoot: string; runId: string; approved: boolean; local: boolean;
  onComplete: () => void;
}) {
  return defineTool({
    name: "complete_research_plan", label: "核验并交付科研产物",
    description: "本地已批准科研规划执行完成后调用。读取由实际计算脚本生成的验证JSON，要求passed=true且checks每项为true，检查artifacts列出的实际文件并发布报告下载链接，然后将规划标记完成。不得自行伪造验证记录。远程项目须先将产物同步到本地后再交付，当前此工具只支持本地项目。",
    parameters: Type.Object({
      verificationFile: Type.String({ description: "项目内验证JSON路径，字段为passed、checks和artifacts（相对验证文件目录的路径数组）" }),
    }),
    async execute(_id, params) {
      if (!options.approved) throw new Error("必须先由用户确认科研规划");
      if (!options.local) throw new Error("当前交付工具仅支持本地项目");
      const verification = await workspaceFile(options.workspace, params.verificationFile);
      const manifest = JSON.parse(await readFile(verification, "utf8"));
      if (manifest.passed !== true || !manifest.checks || !Object.keys(manifest.checks).length
        || !Object.values(manifest.checks).every((value) => value === true)) throw new Error("产物验证未全部通过");
      if (!Array.isArray(manifest.artifacts) || !manifest.artifacts.length || manifest.artifacts.length > 30) throw new Error("缺少有效产物清单");
      const sourceFiles = await Promise.all([...manifest.artifacts.map((name: unknown) => {
        if (typeof name !== "string") throw new Error("产物路径格式无效");
        return workspaceFile(options.workspace, resolve(verification, "..", name));
      }), Promise.resolve(verification)]);
      const allowed = new Set([".html", ".md", ".json", ".csv", ".png", ".pdf", ".nc"]);
      if (new Set(sourceFiles.map((file) => basename(file))).size !== sourceFiles.length) throw new Error("产物文件名不能重复");
      for (const file of sourceFiles) {
        if (!allowed.has(extname(file).toLowerCase()) || (await stat(file)).size === 0) throw new Error("产物格式不支持或文件为空");
      }
      const destination = resolve(options.publicationRoot, options.runId);
      await mkdir(destination, { recursive: true });
      const artifacts = [];
      for (const file of sourceFiles) {
        const name = basename(file);
        await copyFile(file, resolve(destination, name));
        artifacts.push({ name, url: `/api/artifacts/${options.runId}/${encodeURIComponent(name)}` });
      }
      options.onComplete();
      return { content: [{ type: "text", text: `验证通过，科研规划已完成。请在最终答复引用以下链接：\n${artifacts.map((item) => `[${item.name}](${item.url})`).join("\n")}` }], details: { artifacts } };
    },
  });
}
