import type { SiteLanguage } from "../language"
import buildWebAppsEn from "./content/build-web-apps.en.md?raw"
import buildWebAppsZh from "./content/build-web-apps.md?raw"
import cinemaEn from "./content/cinema.en.md?raw"
import cinemaZh from "./content/cinema.md?raw"
import chromeEn from "./content/chrome.en.md?raw"
import chromeZh from "./content/chrome.md?raw"
import computerUseWindowsEn from "./content/computer-use-windows.en.md?raw"
import computerUseWindowsZh from "./content/computer-use-windows.md?raw"
import coreConceptEn from "./content/core-concept.en.md?raw"
import coreConceptZh from "./content/core  concept.md?raw"
import faqEn from "./content/faq.en.md?raw"
import faqZh from "./content/faq.md?raw"
import gettingStartedEn from "./content/getting-started.en.md?raw"
import gettingStartedZh from "./content/下载安装.md?raw"
import overviewEn from "./content/overview.en.md?raw"
import overviewZh from "./content/概述.md?raw"
import permissionsEn from "./content/permissions.en.md?raw"
import permissionsZh from "./content/permissions.md?raw"
import pluginDevelopmentEn from "./content/plugin-development.en.md?raw"
import pluginDevelopmentZh from "./content/plugin-development.md?raw"
import projectsAndSessionsEn from "./content/projects-and-sessions.en.md?raw"
import projectsAndSessionsZh from "./content/projects-and-sessions.md?raw"
import providersEn from "./content/providers.en.md?raw"
import providersZh from "./content/providers.md?raw"
import skillsEn from "./content/skills.en.md?raw"
import skillsZh from "./content/skills.md?raw"
import toolsEn from "./content/tools.en.md?raw"
import toolsZh from "./content/tools.md?raw"
import troubleshootingEn from "./content/troubleshooting.en.md?raw"
import troubleshootingZh from "./content/troubleshooting.md?raw"
import useCasesEn from "./content/use-cases.en.md?raw"
import useCasesZh from "./content/探索用例.md?raw"

export type DocsArticle = {
  content: string
  description: string
  slug: string
  title: string
}

export type DocsSection = {
  items: DocsArticle[]
  title: string
}

export const docsSectionsByLanguage: Record<SiteLanguage, DocsSection[]> = {
  zh: [
    {
      title: "了解 Anybox",
      items: [
        {
          content: overviewZh,
          description: "了解 Anybox 的定位、核心能力、工作方式与安全边界。",
          slug: "overview",
          title: "产品概览",
        },
        {
          content: useCasesZh,
          description: "选择适合开发、办公与内容创作的首个可验证任务。",
          slug: "use-cases",
          title: "使用场景",
        },
      ],
    },
    {
      title: "开始使用",
      items: [
        {
          content: gettingStartedZh,
          description: "安装桌面端、连接模型，并完成首次只读项目任务。",
          slug: "getting-started",
          title: "快速开始",
        },
        {
          content: projectsAndSessionsZh,
          description: "厘清项目、工作区与会话，建立明确的任务边界。",
          slug: "projects-and-sessions",
          title: "项目、工作区与会话",
        },
      ],
    },
    {
      title: "工作方式",
      items: [
        {
          content: permissionsZh,
          description: "了解工具调用如何授权、拒绝，以及审批时应检查什么。",
          slug: "permissions",
          title: "权限与审批",
        },
        {
          content: coreConceptZh,
          description: "了解长会话如何压缩上下文、保留近期消息并恢复任务。",
          slug: "core-concept",
          title: "长会话与上下文",
        },
      ],
    },
    {
      title: "配置与能力",
      items: [
        {
          content: providersZh,
          description: "连接服务商、测试凭据，并按任务选择合适模型。",
          slug: "providers",
          title: "模型供应商",
        },
        {
          content: toolsZh,
          description: "管理内置工具，理解权限、渐进发现与 JavaScript Exec。",
          slug: "tools",
          title: "工具系统",
        },
        {
          content: skillsZh,
          description: "创建、启用和管理本地、插件与受管 Skills。",
          slug: "skills",
          title: "Skills",
        },
      ],
    },
    {
      title: "插件指南",
      items: [
        {
          content: chromeZh,
          description: "让 Agent 使用现有 Chrome 标签页、登录状态与网页界面。",
          slug: "chrome",
          title: "Chrome 插件",
        },
        {
          content: computerUseWindowsZh,
          description: "在 Windows 11 中安全观察并操作指定应用窗口。",
          slug: "computer-use-windows",
          title: "Windows 电脑控制",
        },
        {
          content: cinemaZh,
          description: "以四类节点初始化和管理本地 AI 影视项目。",
          slug: "cinema",
          title: "anybox for cinema",
        },
        {
          content: buildWebAppsZh,
          description: "用专业工作流实现、测试并优化 Web 应用。",
          slug: "build-web-apps",
          title: "构建 Web 应用",
        },
      ],
    },
    {
      title: "扩展",
      items: [
        {
          content: pluginDevelopmentZh,
          description: "创建 Skill 插件，并按需加入 MCP、Connector 与发布配置。",
          slug: "plugin-development",
          title: "制作插件",
        },
      ],
    },
    {
      title: "支持",
      items: [
        {
          content: troubleshootingZh,
          description: "按项目、模型、工具、权限和连接逐层定位问题。",
          slug: "troubleshooting",
          title: "排障",
        },
        {
          content: faqZh,
          description: "快速了解平台、模型、数据、权限与故障处理。",
          slug: "faq",
          title: "FAQ",
        },
      ],
    },
  ],
  en: [
    {
      title: "Understand Anybox",
      items: [
        {
          content: overviewEn,
          description: "Understand Anybox, its core workflow, capabilities, and safety boundaries.",
          slug: "overview",
          title: "Overview",
        },
        {
          content: useCasesEn,
          description: "Choose a verifiable first task for development, office work, or creation.",
          slug: "use-cases",
          title: "Use Cases",
        },
      ],
    },
    {
      title: "Get Started",
      items: [
        {
          content: gettingStartedEn,
          description: "Install Anybox, connect a model, and complete a first read-only task.",
          slug: "getting-started",
          title: "Quick Start",
        },
        {
          content: projectsAndSessionsEn,
          description: "Use projects, workspaces, and sessions to keep task boundaries clear.",
          slug: "projects-and-sessions",
          title: "Projects, Workspaces & Sessions",
        },
      ],
    },
    {
      title: "How Work Runs",
      items: [
        {
          content: permissionsEn,
          description: "Understand authorization, denial, and what to inspect before approval.",
          slug: "permissions",
          title: "Permissions & Approvals",
        },
        {
          content: coreConceptEn,
          description: "Learn how compaction preserves recent context and restores long sessions.",
          slug: "core-concept",
          title: "Long Sessions & Context",
        },
      ],
    },
    {
      title: "Configure & Extend",
      items: [
        {
          content: providersEn,
          description: "Connect providers, test credentials, and choose a model for each task.",
          slug: "providers",
          title: "Model Providers",
        },
        {
          content: toolsEn,
          description: "Manage built-ins and understand permissions, discovery, and JavaScript Exec.",
          slug: "tools",
          title: "Tool System",
        },
        {
          content: skillsEn,
          description: "Create, enable, and manage local, plugin, and downloaded Skills.",
          slug: "skills",
          title: "Skills",
        },
      ],
    },
    {
      title: "Plugin Guides",
      items: [
        {
          content: chromeEn,
          description: "Let the agent use existing Chrome tabs, signed-in state, and web UI.",
          slug: "chrome",
          title: "Chrome",
        },
        {
          content: computerUseWindowsEn,
          description: "Safely observe and operate one selected Windows application window.",
          slug: "computer-use-windows",
          title: "Computer Use Windows",
        },
        {
          content: cinemaEn,
          description: "Manage local AI film projects with four supported node types.",
          slug: "cinema",
          title: "anybox for cinema",
        },
        {
          content: buildWebAppsEn,
          description: "Implement, test, and optimize web apps with focused workflows.",
          slug: "build-web-apps",
          title: "Build Web Apps",
        },
      ],
    },
    {
      title: "Extend",
      items: [
        {
          content: pluginDevelopmentEn,
          description: "Create a Skill plugin, then add MCP, connectors, and release metadata.",
          slug: "plugin-development",
          title: "Build Plugins",
        },
      ],
    },
    {
      title: "Support",
      items: [
        {
          content: troubleshootingEn,
          description: "Diagnose project, model, tool, permission, and connection failures.",
          slug: "troubleshooting",
          title: "Troubleshooting",
        },
        {
          content: faqEn,
          description: "Quick answers about platforms, models, data, permissions, and failures.",
          slug: "faq",
          title: "FAQ",
        },
      ],
    },
  ],
}

export function getDocsArticles(language: SiteLanguage) {
  return docsSectionsByLanguage[language].flatMap((section) => section.items)
}

export function getDocsArticle(slug: string | null, language: SiteLanguage) {
  return getDocsArticles(language).find((article) => article.slug === slug)
}
