import { execFile } from "node:child_process";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function fetchHtml(url: string, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(20_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OceanAgent/0.1; scientific research assistant)" },
      signal: combined,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    if (signal?.aborted || process.platform !== "win32") throw error;
  }

  return await new Promise<string>((resolve, reject) => {
    const command = "$ProgressPreference='SilentlyContinue'; (Invoke-WebRequest -UseBasicParsing -Uri $env:OCEAN_SEARCH_URL -Headers @{'User-Agent'='Mozilla/5.0 (OceanAgent/0.1)'} -TimeoutSec 20).Content";
    execFile("pwsh", ["-NoProfile", "-NonInteractive", "-Command", command], {
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
        TEMP: process.env.TEMP ?? "",
        TMP: process.env.TMP ?? "",
        OCEAN_SEARCH_URL: url,
      },
      maxBuffer: 5 * 1024 * 1024,
      timeout: 25_000,
      windowsHide: true,
      signal,
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'").replaceAll("&#39;", "'").replaceAll("&amp;", "&")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function resultUrl(value: string): string | null {
  try {
    const decoded = decodeHtml(value);
    const candidate = decoded.startsWith("//") ? `https:${decoded}` : decoded;
    const redirect = new URL(candidate);
    const target = redirect.hostname.endsWith("duckduckgo.com") ? redirect.searchParams.get("uddg") : candidate;
    if (!target) return null;
    const url = new URL(target);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function parseResults(html: string): WebSearchResult[] {
  const blocks = html.match(/<div[^>]+class="[^"]*\bresult\b[^"]*"[\s\S]*?(?=<div[^>]+class="[^"]*\bresult\b|$)/gi) ?? [];
  return blocks.flatMap((block) => {
    const link = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const snippet = block.match(/<(?:a|div)[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    const url = resultUrl(link?.[1] ?? "");
    const title = decodeHtml(link?.[2] ?? "");
    return url && title ? [{ title, url, snippet: decodeHtml(snippet?.[1] ?? "") }] : [];
  });
}

function isAllowed(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const normalized = domain.toLowerCase().replace(/^www\./, "");
    return host === normalized || host.endsWith(`.${normalized}`);
  } catch {
    return false;
  }
}

export class OfficialWebSearch {
  async search(query: string, domains: string[] = [], limit = 6, signal?: AbortSignal): Promise<WebSearchResult[]> {
    const requestedLimit = Math.min(Math.max(limit, 1), 10);
    const targets = domains.slice(0, 6);
    const searches: Array<{ query: string; domain?: string }> = targets.length
      ? targets.map((domain) => ({ query: `${query} site:${domain}`, domain }))
      : [{ query }];
    const attempts = await Promise.allSettled(searches.map(async (search) => {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(search.query)}`;
      const parsed = parseResults(await fetchHtml(url, signal));
      const domain = search.domain;
      return domain ? parsed.filter((item) => isAllowed(item.url, domain)) : parsed;
    }));
    const batches = attempts.flatMap((attempt) => attempt.status === "fulfilled" ? [attempt.value] : []);
    if (!batches.length) throw new Error("联网搜索服务当前不可用");
    const unique = new Map<string, WebSearchResult>();
    for (const item of batches.flat()) if (!unique.has(item.url)) unique.set(item.url, item);
    return [...unique.values()].slice(0, requestedLimit);
  }
}
