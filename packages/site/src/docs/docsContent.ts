import type { SiteLanguage } from "../language"
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
          description: "理解 Anybox 的定位、工作方式、能力边界与推荐阅读路径。",
          slug: "overview",
          title: "产品概览",
        },
        {
          content: useCasesZh,
          description: "从开发、研究办公和内容创作场景中选择合适的第一个任务。",
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
          description: "安装桌面端、连接模型，并完成第一次可检查的项目会话。",
          slug: "getting-started",
          title: "快速开始",
        },
        {
          content: projectsAndSessionsZh,
          description: "理解项目、工作区和会话的关系，并建立清晰的任务组织方式。",
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
          description: "看懂风险等级、审批卡片和授权范围，保留必要的执行控制。",
          slug: "permissions",
          title: "权限与审批",
        },
        {
          content: coreConceptZh,
          description: "理解上下文预算、自动压缩、手动压缩和长会话恢复机制。",
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
          description: "连接模型供应商，测试凭据，并为不同任务选择合适模型。",
          slug: "providers",
          title: "模型供应商",
        },
        {
          content: toolsZh,
          description: "理解工具分类、全局可用性、权限、渐进式发现与 JavaScript 编排。",
          slug: "tools",
          title: "工具系统",
        },
        {
          content: skillsZh,
          description: "创建本地 Skill，安全启用受管来源，并管理更新、回滚与项目选择。",
          slug: "skills",
          title: "Skills",
        },
      ],
    },
    {
      title: "扩展",
      items: [
        {
          content: pluginDevelopmentZh,
          description: "从第一个 Skill 插件开始，加入 MCP、Connector，并发布给其他用户。",
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
          description: "按项目、模型、工具、MCP、权限和长会话逐层定位常见问题。",
          slug: "troubleshooting",
          title: "排障",
        },
        {
          content: faqZh,
          description: "平台、数据、模型、权限、移动端和反馈方式的常见问题。",
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
          description: "Understand what Anybox is, how it works, its boundaries, and where to begin.",
          slug: "overview",
          title: "Overview",
        },
        {
          content: useCasesEn,
          description: "Choose a practical first task across development, research, operations, and creation.",
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
          description: "Install the desktop app, connect a model, and complete an inspectable first session.",
          slug: "getting-started",
          title: "Quick Start",
        },
        {
          content: projectsAndSessionsEn,
          description: "Understand projects, workspaces, and sessions, then organize tasks clearly.",
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
          description: "Read risk levels, approval cards, and authorization scope while retaining control.",
          slug: "permissions",
          title: "Permissions & Approvals",
        },
        {
          content: coreConceptEn,
          description: "Understand context budgets, automatic and manual compaction, and long-session recovery.",
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
          description: "Connect a provider, test credentials, and choose a suitable model for each task.",
          slug: "providers",
          title: "Model Providers",
        },
        {
          content: toolsEn,
          description: "Understand tool categories, global availability, permissions, discovery, and JavaScript orchestration.",
          slug: "tools",
          title: "Tool System",
        },
        {
          content: skillsEn,
          description: "Create local Skills and safely manage downloads, updates, rollbacks, and project selection.",
          slug: "skills",
          title: "Skills",
        },
      ],
    },
    {
      title: "Extend",
      items: [
        {
          content: pluginDevelopmentEn,
          description: "Start with a Skill plugin, add MCP and connectors, then publish it for other users.",
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
          description: "Diagnose project, provider, tool, MCP, permission, and long-session issues.",
          slug: "troubleshooting",
          title: "Troubleshooting",
        },
        {
          content: faqEn,
          description: "Common questions about platforms, data, models, permissions, mobile, and support.",
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
