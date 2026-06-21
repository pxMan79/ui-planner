import { readFile } from "node:fs/promises";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, resolve } from "node:path";
import { nanoid } from "nanoid";
import { fileURLToPath } from "node:url";

import {
  deleteProject,
  isValidProjectId,
  listProjects,
  readProject,
  writeProject,
} from "./storage.ts";

// 零依赖 HTTP 服务（node:http）。负责两件事：
// 1. /api 下按 id 安全读写 data/projects 下的 JSON 文件；
// 2. 生产环境下顺带托管 dist/ 里的前端静态文件。
// 默认仍绑 127.0.0.1，只有部署到容器时再用 HOST=0.0.0.0 暴露。

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const here = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(here, "..", "dist");

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
};

const sendBuffer = (
  res: ServerResponse,
  status: number,
  body: Buffer,
  contentType: string,
) => {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": body.byteLength,
  });
  res.end(body);
};

// 请求体可能很大（含 base64 背景图），设一个上限防止异常巨包打爆内存。
const MAX_BODY = 16 * 1024 * 1024; // 16MB

const safeStaticPath = (pathname: string): string | null => {
  const trimmed = pathname.replace(/^\/+/, "");
  const decoded = decodeURIComponent(trimmed);
  const target = resolve(DIST_DIR, decoded);
  return target.startsWith(DIST_DIR) ? target : null;
};

const tryReadStaticFile = async (pathname: string): Promise<Buffer | null> => {
  const target = safeStaticPath(pathname);
  if (!target) return null;
  try {
    return await readFile(target);
  } catch {
    return null;
  }
};

const serveStatic = async (
  pathname: string,
  method: string,
  res: ServerResponse,
): Promise<boolean> => {
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  if (pathname !== "/") {
    const asset = await tryReadStaticFile(pathname);
    if (asset) {
      sendBuffer(
        res,
        200,
        asset,
        MIME_TYPES[extname(pathname).toLowerCase()] ??
          "application/octet-stream",
      );
      return true;
    }
  }

  try {
    const indexHtml = await readFile(resolve(DIST_DIR, "index.html"));
    sendBuffer(res, 200, indexHtml, MIME_TYPES[".html"]);
    return true;
  } catch {
    return false;
  }
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const handler = async (req: IncomingMessage, res: ServerResponse) => {
  const { method = "GET" } = req;
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;

  // GET /api/projects —— 列表（仅元数据）
  if (path === "/api/projects" && method === "GET") {
    const projects = await listProjects();
    return sendJson(res, 200, { projects });
  }

  // POST /api/projects —— 新建：生成 id，存入请求体里的工程
  if (path === "/api/projects" && method === "POST") {
    let body: { project?: Record<string, unknown> };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: "请求体不是有效的 JSON" });
    }
    if (!body.project || typeof body.project !== "object") {
      return sendJson(res, 400, { error: "缺少 project 字段" });
    }
    const id = nanoid(10);
    const saved = await writeProject(id, { ...body.project, id });
    return sendJson(res, 201, { project: saved });
  }

  // /api/projects/:id —— 单项目读 / 写 / 删
  const match = path.match(/^\/api\/projects\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (!isValidProjectId(id)) {
      return sendJson(res, 400, { error: "非法的项目 id" });
    }

    if (method === "GET") {
      const project = await readProject(id);
      if (!project) return sendJson(res, 404, { error: "项目不存在" });
      return sendJson(res, 200, { project });
    }

    if (method === "PUT") {
      let body: { project?: Record<string, unknown> };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return sendJson(res, 400, { error: "请求体不是有效的 JSON" });
      }
      if (!body.project || typeof body.project !== "object") {
        return sendJson(res, 400, { error: "缺少 project 字段" });
      }
      const saved = await writeProject(id, { ...body.project, id });
      return sendJson(res, 200, { project: saved });
    }

    if (method === "DELETE") {
      const ok = await deleteProject(id);
      if (!ok) return sendJson(res, 404, { error: "项目不存在" });
      return sendJson(res, 200, { ok: true });
    }
  }

  if (await serveStatic(path, method, res)) {
    return;
  }

  sendJson(res, 404, { error: "未找到该接口" });
};

const server = createServer((req, res) => {
  handler(req, res).catch((error) => {
    // 兜底：任何未捕获的异常都回 500，绝不让连接挂死。
    const message = error instanceof Error ? error.message : "服务器内部错误";
    sendJson(res, 500, { error: message });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[api] UI Planner 存储服务运行于 http://${HOST}:${PORT}`);
});
