# UI Planner

一个 UI 规划面板：在画布上拖拽规划界面区域，导出「对 AI 易读」的纯净 HTML，
让 AI 照着复现你想要的界面。

## 核心理念：配置与成品分离

- **`.html` 成品** —— 给 AI 读的纯净 HTML，顶部带 DESIGN BRIEF（自然语言描述各区域
  的位置/尺寸/用途，缩进体现分组嵌套），不混入任何工程元数据。
- **`.json` 配置** —— 完整工程快照，用于**分享给别人**复写、二次编辑。
- **云端存储** —— 本地后端把项目存为扁平 JSON 文件（`data/projects/<id>.json`），
  支持多项目切换、手动保存。

## 运行

需要 **Node 18+**（推荐 20/22+，后端用 `node` 直接跑 `.ts`，无需编译步骤）。

开两个终端：

```bash
# 终端 1：前端（Vite，http://localhost:5173）
npm run dev

# 终端 2：后端存储服务（http://127.0.0.1:8787）
npm run server
```

前端通过 Vite 代理把 `/api` 转发到后端，所以浏览器只需访问 `http://localhost:5173`。
后端默认只绑 `127.0.0.1`（仅本机），项目数据存在仓库根的 `data/` 目录（已 gitignore）。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动前端开发服务器（HMR） |
| `npm run server` | 启动后端存储服务（`--watch` 自动重启） |
| `npm run check` | TypeScript 类型检查（`tsc --noEmit`） |
| `npm test` | 运行单元测试（vitest） |
| `npm run lint` | ESLint |
| `npm run build` | 构建前端到 `dist/` |

## 部署

- 仓库内已提供 `Dockerfile` 与 `docker/ui-planner/docker-compose.yml`。
- GitHub Actions 工作流位于 `.github/workflows/deploy.yml`，在 `main` 分支 push 后触发。
- workflow 使用 `environment: server`，默认读取以下 Secrets：
  - `SERVER_HOST`
  - `SERVER_USER`
  - `SERVER_KEY`
- 服务器目录约定为 `/opt/projects/ui-planner`，首次部署会自动 clone，之后每次都会 `git fetch --all && git reset --hard origin/main`。
- 容器默认把宿主机 `3217` 端口映射到应用 `3000` 端口，项目数据持久化在仓库下的 `data/` 目录。
- 如果前面挂了 Nginx Proxy Manager，只需要把域名反代到 `127.0.0.1:3217`。

## 功能

- **画布拖拽**：空白处拖拽框选创建模块；拖拽模块重叠到另一模块上自动合并为父子分组，
  拖出则拆分回兄弟（类似 Edge 标签分组）。
- **分组嵌套**：父子可层层递进，图层栏以缩进树展示、可折叠；导出时体现为嵌套 DOM。
- **实时预览**：右下角实时渲染导出效果，统计模块数/画布尺寸/导出体积。
- **导航栏操作**：复制代码、导出 HTML、整体说明（brief）下拉、云端项目切换、保存。
- **配置分享**：`保存配置` 导出 `.json` 分享给别人；`导入配置` 复写当前画布。

## 后端 API

零依赖 `node:http` 服务（`api/server.ts`），按 id 安全读写 JSON 文件：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/projects` | 项目列表（仅元数据） |
| `POST` | `/api/projects` | 新建项目（后端生成 id） |
| `GET` | `/api/projects/:id` | 读取单个项目 |
| `PUT` | `/api/projects/:id` | 覆盖保存 |
| `DELETE` | `/api/projects/:id` | 删除 |

项目 id 严格校验字符集（防路径穿越），写入用「临时文件 + 原子改名」防半截写入。
后端不校验工程内部结构 —— 前端的 zod 才是唯一权威校验源。
