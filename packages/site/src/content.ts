import type { SiteLanguage } from "./language"
import { supportMailto } from "./siteLinks"

const sharedNavigation = [
  {
    href: "https://github.com/fanfan-de/anybox",
    label: "GitHub",
    external: true,
  },
  {
    href: "https://github.com/fanfan-de/anybox/releases/latest",
    label: "Releases",
    external: true,
  },
]

export const siteContent = {
  zh: {
    navigationItems: [
      { href: "/docs/", label: "文档" },
      { href: "/pricing/", label: "定价" },
      { href: supportMailto, label: "支持" },
      ...sharedNavigation,
    ],
    proofPoints: ["本地项目工作区", "多模型供应商", "可审计工具调用"],
    scenarios: {
      kicker: "Anybox，适合每一种工作。",
      description: "从代码到办公，再到创造，把 Anybox 放进你的真实工作现场。",
      audienceLabel: "推荐用户：",
      capabilityLabel: "能力描述：",
      tasksLabel: "典型任务：",
      cards: [
        {
          title: "代码",
          image: "/scenario-code-workflow.webp",
          imageAlt: "代码场景的 AI Agent 辅助开发工作流宣传图",
          audience: "开发者、开源维护者、技术团队负责人",
          capability:
            "连接本地项目上下文，阅读代码、执行命令、跟踪变更，把 Agent 真正放进开发工作流。",
          tasks: [
            "修复问题、补测试、重构模块",
            "梳理架构边界，生成提交说明与 PR 摘要",
          ],
        },
        {
          title: "办公",
          image: "/scenario-office-workflow.webp",
          imageAlt: "办公场景的资料整理、图表分析和后续行动宣传图",
          audience: "运营、产品、管理者、跨职能协作者",
          capability:
            "把文档、资料和业务问题交给 Agent 协同处理，从信息整理到方案输出都能保留过程。",
          tasks: [
            "整理会议纪要、汇总调研资料、起草方案",
            "分析业务数据，提炼问题和后续行动",
          ],
        },
        {
          title: "创造",
          image: "/scenario-creative-workflow.webp",
          imageAlt: "创作场景的画布、素材板和概念迭代宣传图",
          audience: "设计师、内容创作者、独立开发者",
          capability:
            "从一个想法开始，让 Agent 帮你拆解方向、生成素材、迭代表达，直到作品可以交付。",
          tasks: [
            "生成文案、脚本、页面草稿与视觉方案",
            "把灵感整理成可执行的项目计划",
          ],
        },
      ],
    },
  },
  en: {
    navigationItems: [
      { href: "/docs/", label: "Docs" },
      { href: "/pricing/", label: "Pricing" },
      { href: supportMailto, label: "Support" },
      ...sharedNavigation,
    ],
    proofPoints: [
      "Local project workspaces",
      "Multiple model providers",
      "Auditable tool calls",
    ],
    scenarios: {
      kicker: "Anybox for anything.",
      description:
        "From code and office work to creative projects, bring Anybox into the way you actually work.",
      audienceLabel: "For: ",
      capabilityLabel: "What it does: ",
      tasksLabel: "Typical tasks: ",
      cards: [
        {
          title: "Code",
          image: "/scenario-code-workflow.webp",
          imageAlt: "An AI agent-assisted software development workflow",
          audience: "Developers, open-source maintainers, and engineering leads",
          capability:
            "Connect local project context, read code, run commands, and track changes with an agent inside your development workflow.",
          tasks: [
            "Fix issues, add tests, and refactor modules",
            "Map architecture boundaries and prepare commit or PR summaries",
          ],
        },
        {
          title: "Office",
          image: "/scenario-office-workflow.webp",
          imageAlt: "A research, data analysis, and follow-up workflow",
          audience: "Operations, product, management, and cross-functional teams",
          capability:
            "Work with documents, research, and business questions while preserving the path from raw information to a finished proposal.",
          tasks: [
            "Organize meeting notes, research, and project proposals",
            "Analyze business data and identify next actions",
          ],
        },
        {
          title: "Create",
          image: "/scenario-creative-workflow.webp",
          imageAlt: "A creative workflow with a canvas and concept iterations",
          audience: "Designers, content creators, and independent builders",
          capability:
            "Start with an idea, explore directions, generate working material, and iterate until the result is ready to ship.",
          tasks: [
            "Draft copy, scripts, pages, and visual directions",
            "Turn loose ideas into an actionable project plan",
          ],
        },
      ],
    },
  },
} satisfies Record<SiteLanguage, object>
