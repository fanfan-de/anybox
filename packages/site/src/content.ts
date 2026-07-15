import type { SiteLanguage } from "./language"

export type ProductMediaVariant = "workspace" | "execution" | "mobile"

export type SiteContent = {
  finalCta: {
    description: string
    docsLabel: string
    eyebrow: string
    title: string
  }
  hero: {
    description: string
    eyebrow: string
    githubLabel: string
    note: string
    previewAlt: string
    previewCaption: string
    title: string
  }
  capabilities: {
    description: string
    eyebrow: string
    items: Array<{
      description: string
      eyebrow: string
      mediaAlt: string
      mediaCaption: string
      mediaVariant: ProductMediaVariant
      title: string
    }>
    title: string
  }
  signals: string[]
  trust: {
    description: string
    eyebrow: string
    githubLabel: string
    releasesLabel: string
    starsLabel: string
    title: string
    updatedLabel: string
    versionLabel: string
  }
  useCases: {
    description: string
    eyebrow: string
    items: Array<{ description: string; title: string }>
    title: string
  }
  workflow: {
    description: string
    eyebrow: string
    steps: Array<{ description: string; title: string }>
    title: string
  }
}

export const siteContent = {
  zh: {
    hero: {
      eyebrow: "开源 · 本地优先 · 执行过程可检查",
      title: "把 AI Agent 放进你的本地工作流",
      description:
        "Anybox 是开源的本地 AI Agent 工作台。让 Agent 读取项目、调用工具、执行命令，并把每一步留在你可检查的工作空间里。",
      githubLabel: "查看 GitHub",
      note: "支持 Windows x64、macOS Apple Silicon、Linux x64 与 Android。",
      previewAlt: "Anybox 桌面端中的本地项目、会话和 AI Agent 工作区",
      previewCaption: "项目、会话、模型和执行过程集中在同一个工作空间。",
    },
    signals: ["开源", "本地项目", "多模型", "权限确认", "可审计工具调用"],
    workflow: {
      eyebrow: "三步开始",
      title: "从项目目录到可交付结果",
      description: "不需要把工作拆散到多个聊天窗口。Anybox 围绕真实项目组织 Agent 的上下文与执行。",
      steps: [
        { title: "打开本地项目", description: "把目录、文件和当前任务放进同一个可持续的工作区。" },
        { title: "选择模型与权限", description: "按任务切换供应商，并明确 Agent 可以读取、执行或修改什么。" },
        { title: "检查并交付", description: "查看工具调用和变更过程，确认结果后继续迭代或交付。" },
      ],
    },
    capabilities: {
      eyebrow: "核心能力",
      title: "让 Agent 真正理解并参与工作",
      description: "Anybox 把上下文、执行边界和结果检查放在同一套工作流里。",
      items: [
        {
          eyebrow: "01 · 本地上下文",
          title: "围绕项目，而不是一段孤立对话",
          description: "项目树、会话和任务历史保持在一起。Agent 可以从当前目录出发理解代码、文档与工作状态。",
          mediaAlt: "Anybox 左侧项目树与会话列表",
          mediaCaption: "项目与会话持续保留，切换任务时不必重新解释上下文。",
          mediaVariant: "workspace",
        },
        {
          eyebrow: "02 · 可控执行",
          title: "工具调用和权限边界始终可见",
          description: "在 Agent 读取文件、运行命令或修改内容时保留可检查的过程，让自动化能力不以失去控制为代价。",
          mediaAlt: "Anybox Agent 对话和执行工作区",
          mediaCaption: "从请求到执行结果都留在同一个线程中。",
          mediaVariant: "execution",
        },
        {
          eyebrow: "03 · 多端与多模型",
          title: "按任务选择模型，在桌面与移动端继续工作",
          description: "连接不同模型供应商，按成本和能力切换；需要离开桌面时，也能从移动端查看和继续会话。",
          mediaAlt: "Anybox Android 端的项目与会话列表",
          mediaCaption: "移动端用于查看、继续和管理已有工作。",
          mediaVariant: "mobile",
        },
      ],
    },
    useCases: {
      eyebrow: "真实用例",
      title: "一个工作台，覆盖不同类型的交付",
      description: "能力保持一致，变化的是项目上下文和最终成果。",
      items: [
        { title: "代码", description: "修复问题、补测试、重构模块，梳理架构并准备提交或 PR 摘要。" },
        { title: "研究与办公", description: "整理会议和调研资料，分析数据，形成方案与后续行动。" },
        { title: "创造", description: "从想法到文案、脚本、页面草稿和可执行项目计划。" },
      ],
    },
    trust: {
      eyebrow: "开源与持续发布",
      title: "代码、版本和更新记录都公开可查",
      description: "从源代码到发行版本都托管在 GitHub。你可以先检查实现，再决定如何把 Anybox 放进工作流。",
      starsLabel: "GitHub Stars",
      versionLabel: "最新版本",
      updatedLabel: "最近发布",
      githubLabel: "浏览源代码",
      releasesLabel: "查看发行版本",
    },
    finalCta: {
      eyebrow: "开始使用",
      title: "把下一个任务交给 Anybox",
      description: "下载适合当前设备的版本，打开一个真实项目开始工作。",
      docsLabel: "阅读安装文档",
    },
  },
  en: {
    hero: {
      eyebrow: "Open source · Local first · Inspectable by design",
      title: "Bring AI agents into your local workflow",
      description:
        "Anybox is an open-source workspace for local AI agents. Let agents read projects, call tools, run commands, and keep every step visible in a workspace you control.",
      githubLabel: "View on GitHub",
      note: "Available for Windows x64, macOS Apple Silicon, Linux x64, and Android.",
      previewAlt: "Local projects, sessions, and an AI agent workspace in Anybox for desktop",
      previewCaption: "Projects, sessions, models, and execution history stay in one workspace.",
    },
    signals: ["Open source", "Local projects", "Multiple models", "Permission control", "Auditable tool calls"],
    workflow: {
      eyebrow: "Three steps",
      title: "From a project folder to a result you can ship",
      description: "Keep the work together instead of scattering it across disconnected chat windows.",
      steps: [
        { title: "Open a local project", description: "Keep folders, files, and the current task in one persistent workspace." },
        { title: "Choose models and permissions", description: "Switch providers by task and decide what the agent may read, run, or change." },
        { title: "Review and deliver", description: "Inspect tool calls and changes, then keep iterating or ship the result." },
      ],
    },
    capabilities: {
      eyebrow: "Core capabilities",
      title: "Give agents the context and boundaries to do real work",
      description: "Anybox brings project context, execution control, and review into one workflow.",
      items: [
        {
          eyebrow: "01 · Local context",
          title: "Work around a project, not an isolated chat",
          description: "Project trees, sessions, and task history stay together so agents can understand code, documents, and current work from the right directory.",
          mediaAlt: "The project tree and session list in Anybox",
          mediaCaption: "Persistent projects and sessions reduce repeated context setup.",
          mediaVariant: "workspace",
        },
        {
          eyebrow: "02 · Controlled execution",
          title: "Keep tool calls and permission boundaries visible",
          description: "Follow the path when an agent reads files, runs commands, or changes content. Automation stays useful without becoming opaque.",
          mediaAlt: "An agent conversation and execution workspace in Anybox",
          mediaCaption: "Requests, execution, and results remain in the same thread.",
          mediaVariant: "execution",
        },
        {
          eyebrow: "03 · Models and devices",
          title: "Choose the right model and continue away from your desk",
          description: "Connect different providers and switch by cost or capability. Use the mobile app to review and continue existing sessions.",
          mediaAlt: "Projects and sessions in Anybox for Android",
          mediaCaption: "Review, continue, and manage existing work on mobile.",
          mediaVariant: "mobile",
        },
      ],
    },
    useCases: {
      eyebrow: "Practical use cases",
      title: "One workspace for different kinds of delivery",
      description: "The workflow stays consistent while the project context and output change.",
      items: [
        { title: "Code", description: "Fix issues, add tests, refactor modules, map architecture, and prepare commit or PR summaries." },
        { title: "Research and operations", description: "Organize meetings and research, analyze data, and turn findings into action." },
        { title: "Create", description: "Move from an idea to copy, scripts, page drafts, and an executable project plan." },
      ],
    },
    trust: {
      eyebrow: "Open source and actively released",
      title: "Inspect the code, versions, and release history",
      description: "Source code and releases are public on GitHub, so you can understand the product before bringing it into your workflow.",
      starsLabel: "GitHub stars",
      versionLabel: "Latest version",
      updatedLabel: "Latest release",
      githubLabel: "Browse the source",
      releasesLabel: "View releases",
    },
    finalCta: {
      eyebrow: "Get started",
      title: "Bring your next task into Anybox",
      description: "Download the right build for this device and start with a real project.",
      docsLabel: "Read the installation guide",
    },
  },
} satisfies Record<SiteLanguage, SiteContent>
