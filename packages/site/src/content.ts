import type { SiteLanguage } from "./language"

export type SiteContent = {
  faq: {
    eyebrow: string
    items: Array<{ answer: string; question: string }>
    title: string
  }
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
    title: string
  }
  overview: {
    description: string
    eyebrow: string
    steps: Array<{ description: string; title: string }>
    title: string
  }
  plugins: {
    description: string
    docsLabel: string
    eyebrow: string
    examples: Array<{
      capability: string
      category: string
      description: string
      id: string
      name: string
    }>
    stages: Array<{ description: string; title: string }>
    title: string
  }
  safety: {
    description: string
    docsLabel: string
    eyebrow: string
    items: Array<{ description: string; title: string }>
    privacyLabel: string
    title: string
  }
  signals: string[]
  trust: {
    description: string
    eyebrow: string
    githubLabel: string
    licenseLabel: string
    releasesLabel: string
    starsLabel: string
    title: string
    updatedLabel: string
    versionLabel: string
  }
  useCases: {
    description: string
    eyebrow: string
    items: Array<{
      description: string
      detailItems: string[]
      imageAlt: string
      imageSrc: string
      outcome: string
      prompt: string
      title: string
    }>
    title: string
  }
}

export const siteContent = {
  zh: {
    hero: {
      eyebrow: "开源桌面端永久免费开源 · MIT License",
      title: "",
      description: "",
      githubLabel: "在 GitHub 查看源码",
      note: "支持 Windows x64、macOS Apple Silicon、Linux x64 与 Android。",
    },
    signals: ["开源", "本地项目", "多模型", "权限确认", "可审计工具调用"],
    overview: {
      eyebrow: "产品总览",
      title: "你的智能本地 Agent 工作台",
      description: "直接连接项目目录，按任务选择模型，调用工具与插件，并把执行过程留在同一个工作线程里。",
      steps: [
        { title: "打开真实项目", description: "目录、文件、会话和任务历史持续保留。" },
        { title: "配置模型与权限", description: "按任务切换供应商，明确 Agent 可以做什么。" },
        { title: "检查并交付", description: "查看调用与变更，再继续迭代或交付结果。" },
      ],
    },
    plugins: {
      eyebrow: "插件生态",
      title: "用插件，扩展 Agent",
      description: "按任务加载技能、工具与专属界面。",
      stages: [
        { title: "Agent 基座", description: "会话、模型与权限" },
        { title: "加载插件", description: "技能、工具与界面" },
        { title: "完成交付", description: "代码、文档与作品" },
      ],
      examples: [
        {
          id: "build-web-apps",
          name: "构建 Web 应用",
          category: "开发",
          description: "设计、开发与验证 Web 应用。",
          capability: "Skills · Browser",
        },
        {
          id: "game-studio",
          name: "游戏工作室",
          category: "游戏开发",
          description: "制作并试玩浏览器游戏。",
          capability: "Skills · Assets",
        },
        {
          id: "chrome",
          name: "Chrome",
          category: "浏览器",
          description: "执行可见的浏览器操作。",
          capability: "Browser · MCP",
        },
        {
          id: "gmail",
          name: "Gmail",
          category: "沟通",
          description: "阅读与整理邮件。",
          capability: "App · MCP",
        },
        {
          id: "google-drive",
          name: "Google Drive",
          category: "文档",
          description: "处理云端文档与表格。",
          capability: "App · Skills",
        },
        {
          id: "notion",
          name: "Notion",
          category: "知识",
          description: "整理知识、研究与计划。",
          capability: "App · Skills",
        },
        {
          id: "slack",
          name: "Slack",
          category: "协作",
          description: "阅读与整理团队消息。",
          capability: "App · MCP",
        },
        {
          id: "canva",
          name: "Canva",
          category: "设计",
          description: "创建与调整设计内容。",
          capability: "App · Skills",
        },
        {
          id: "cloudflare",
          name: "Cloudflare",
          category: "部署",
          description: "配置与部署云端服务。",
          capability: "MCP · Skills",
        },
        {
          id: "linear",
          name: "Linear",
          category: "项目",
          description: "查找并推进项目任务。",
          capability: "App · MCP",
        },
        {
          id: "supabase",
          name: "Supabase",
          category: "数据",
          description: "连接数据库与开发工具。",
          capability: "MCP · Database",
        },
        {
          id: "vercel",
          name: "Vercel",
          category: "交付",
          description: "预览并部署 Web 应用。",
          capability: "App · Deploy",
        },
      ],
      docsLabel: "插件开发",
    },
    useCases: {
      eyebrow: "真实工作场景",
      title: "从一句任务，到可以交付的结果",
      description: "每个场景都从真实项目开始：给出目标，观察 Agent 工作，检查成果，再决定下一步。",
      items: [
        {
          title: "从问题描述，到可提交的代码变更",
          description: "让 Agent 在真实仓库里定位问题、修改代码、运行测试，并整理可复用的交付摘要。",
          prompt: "修复登录状态偶发失效的问题，补齐测试，并整理这次改动。",
          outcome: "代码变更 · 测试结果 · 提交摘要",
          detailItems: ["读取真实仓库上下文", "修改和命令过程可检查", "测试结果保留在同一线程"],
          imageSrc: "/scenario-code-workflow.webp",
          imageAlt: "用于代码任务的 Anybox Agent 工作场景",
        },
        {
          title: "把散落资料，整理成下一步行动",
          description: "汇总会议、调研和数据材料，让 Agent 提炼结论、标记风险，并形成可以继续协作的文档。",
          prompt: "读取项目资料，整理关键结论、待确认风险和下周行动清单。",
          outcome: "研究摘要 · 数据整理 · 行动清单",
          detailItems: ["项目资料集中处理", "结论与来源保持关联", "结果可继续编辑和复核"],
          imageSrc: "/scenario-office-workflow.webp",
          imageAlt: "用于研究与办公任务的 Anybox Agent 工作场景",
        },
        {
          title: "从一个想法，到可预览的作品",
          description: "把需求、生成、运行预览和后续修改放在一起，发现问题后直接回到对话继续迭代。",
          prompt: "做一个可以立即试玩的赛车小游戏，并根据试玩反馈继续修改。",
          outcome: "页面与脚本 · 运行预览 · 迭代记录",
          detailItems: ["自然语言描述目标", "生成结果立即预览", "问题直接转成下一轮修改"],
          imageSrc: "/scenario-creative-workflow.webp",
          imageAlt: "用于创作任务的 Anybox Agent 工作场景",
        },
      ],
    },
    safety: {
      eyebrow: "本地与权限",
      title: "项目和执行边界，始终由你掌控",
      description: "自动化不应该以失去控制为代价。Anybox 把权限策略、工具调用与结果检查放在工作线程中。",
      items: [
        { title: "项目边界可见", description: "围绕当前项目目录组织上下文，工作范围始终明确。" },
        { title: "执行前确认", description: "文件修改和命令执行遵循你选择的权限策略。" },
        { title: "过程可追溯", description: "重要工具调用、执行结果和后续修改保留在线程里。" },
        { title: "模型连接自主", description: "按任务在已连接的模型供应商之间选择与切换。" },
      ],
      docsLabel: "查看权限说明",
      privacyLabel: "阅读隐私政策",
    },
    trust: {
      eyebrow: "开源，不只是一个标签",
      title: "从源码到发行版本，每一步都公开可查",
      description: "Anybox 桌面端采用 MIT License。你可以审阅实现、提交 Issue、参与贡献，也可以直接下载公开发行版本。",
      licenseLabel: "开源许可证",
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
    faq: {
      eyebrow: "常见问题",
      title: "开始之前，你可能还想确认这些",
      items: [
        {
          question: "Anybox 与普通 AI 聊天工具有什么不同？",
          answer: "Anybox 围绕真实项目组织会话、文件、工具调用和任务历史。它不只回答问题，也让 Agent 在你设定的权限范围内参与执行与交付。",
        },
        {
          question: "本地文件会被上传吗？",
          answer: "Anybox 围绕你选择的本地项目组织上下文。当任务需要模型读取文件内容时，实际发送范围取决于你连接的模型供应商与当前任务，请同时查看权限说明和供应商条款。",
        },
        {
          question: "Agent 修改文件或运行命令时如何控制？",
          answer: "你可以为任务选择权限策略。需要确认的文件修改、命令和工具调用会在工作线程中显示，便于检查后继续或停止。",
        },
        {
          question: "支持哪些模型，费用如何计算？",
          answer: "Anybox 支持连接不同模型供应商并按任务切换。模型用量与费用通常由对应供应商计算，Anybox 的产品计划请查看定价页面。",
        },
        {
          question: "插件可以自行开发吗？",
          answer: "可以。插件可以组合专属界面、技能和 MCP 服务，把通用 Agent 扩展到特定领域；开发结构与清单要求可在插件文档中查看。",
        },
        {
          question: "桌面端和 Android 如何配合？",
          answer: "桌面端适合连接项目并执行主要工作，Android 端可用于查看、继续和管理已有项目与会话。",
        },
      ],
    },
  },
  en: {
    hero: {
      eyebrow: "Free and open-source desktop app · MIT licensed",
      title: "An open-source local AI agent workspace you can inspect, extend, and own.",
      description:
        "Source, issues, releases, and update history are public. Bring local projects, models, tools, and plugins into one inspectable workspace, from first request to final delivery.",
      githubLabel: "View the source on GitHub",
      note: "Available for Windows x64, macOS Apple Silicon, Linux x64, and Android.",
    },
    signals: ["Open source", "Local projects", "Multiple models", "Permission control", "Auditable tool calls"],
    overview: {
      eyebrow: "Product overview",
      title: "Your intelligent local agent workspace",
      description: "Connect a project folder, choose the right model, call tools and plugins, and keep execution visible in one working thread.",
      steps: [
        { title: "Open a real project", description: "Keep folders, files, sessions, and task history together." },
        { title: "Set models and permissions", description: "Switch providers and decide what the agent may do." },
        { title: "Review and deliver", description: "Inspect calls and changes, then iterate or ship the result." },
      ],
    },
    plugins: {
      eyebrow: "Plugin ecosystem",
      title: "Extend your agent with plugins",
      description: "Load the skills, tools, and work surfaces each task needs.",
      stages: [
        { title: "Agent core", description: "Conversations, models, permissions" },
        { title: "Load plugins", description: "Skills, tools, work surfaces" },
        { title: "Deliver", description: "Code, documents, finished work" },
      ],
      examples: [
        {
          id: "build-web-apps",
          name: "Build Web Apps",
          category: "Development",
          description: "Design, build, and test web apps.",
          capability: "Skills · Browser",
        },
        {
          id: "game-studio",
          name: "Game Studio",
          category: "Game development",
          description: "Create and playtest browser games.",
          capability: "Skills · Assets",
        },
        {
          id: "chrome",
          name: "Chrome",
          category: "Browser",
          description: "Run visible browser workflows.",
          capability: "Browser · MCP",
        },
        {
          id: "gmail",
          name: "Gmail",
          category: "Communication",
          description: "Read and organize email.",
          capability: "App · MCP",
        },
        {
          id: "google-drive",
          name: "Google Drive",
          category: "Documents",
          description: "Work with cloud docs and sheets.",
          capability: "App · Skills",
        },
        {
          id: "notion",
          name: "Notion",
          category: "Knowledge",
          description: "Organize knowledge, research, and plans.",
          capability: "App · Skills",
        },
        {
          id: "slack",
          name: "Slack",
          category: "Collaboration",
          description: "Read and organize team messages.",
          capability: "App · MCP",
        },
        {
          id: "canva",
          name: "Canva",
          category: "Design",
          description: "Create and adapt design content.",
          capability: "App · Skills",
        },
        {
          id: "cloudflare",
          name: "Cloudflare",
          category: "Deployment",
          description: "Configure and deploy cloud services.",
          capability: "MCP · Skills",
        },
        {
          id: "linear",
          name: "Linear",
          category: "Projects",
          description: "Find and move project work forward.",
          capability: "App · MCP",
        },
        {
          id: "supabase",
          name: "Supabase",
          category: "Data",
          description: "Connect databases and developer tools.",
          capability: "MCP · Database",
        },
        {
          id: "vercel",
          name: "Vercel",
          category: "Delivery",
          description: "Preview and deploy web apps.",
          capability: "App · Deploy",
        },
      ],
      docsLabel: "Plugin development",
    },
    useCases: {
      eyebrow: "Real work scenarios",
      title: "From one request to a result you can deliver",
      description: "Each scenario starts with a real project: set a goal, watch the agent work, inspect the result, and decide what happens next.",
      items: [
        {
          title: "From an issue report to a code change ready to submit",
          description: "Let the agent investigate a real repository, edit code, run tests, and prepare a reusable delivery summary.",
          prompt: "Fix the intermittent sign-in state issue, add regression tests, and summarize the change.",
          outcome: "Code changes · Test results · Commit summary",
          detailItems: ["Read real repository context", "Inspect edits and commands", "Keep test results in the same thread"],
          imageSrc: "/scenario-code-workflow.webp",
          imageAlt: "An Anybox agent workflow for a coding task",
        },
        {
          title: "Turn scattered material into clear next actions",
          description: "Combine meetings, research, and data so the agent can extract findings, flag risks, and create a document ready for collaboration.",
          prompt: "Review the project material and prepare key findings, open risks, and next week's action list.",
          outcome: "Research brief · Organized data · Action list",
          detailItems: ["Process project material together", "Keep findings tied to source context", "Continue editing and reviewing the result"],
          imageSrc: "/scenario-office-workflow.webp",
          imageAlt: "An Anybox agent workflow for research and operations",
        },
        {
          title: "Move from an idea to something you can preview",
          description: "Keep the request, generation, running preview, and revisions together, then turn feedback directly into the next iteration.",
          prompt: "Build a playable racing game and keep improving it from hands-on feedback.",
          outcome: "Pages and scripts · Running preview · Iteration history",
          detailItems: ["Describe the goal in plain language", "Preview the result immediately", "Turn issues into the next edit"],
          imageSrc: "/scenario-creative-workflow.webp",
          imageAlt: "An Anybox agent workflow for a creative task",
        },
      ],
    },
    safety: {
      eyebrow: "Local work and permissions",
      title: "Keep project and execution boundaries under your control",
      description: "Automation should not make work opaque. Anybox keeps permission policies, tool calls, and review in the working thread.",
      items: [
        { title: "Visible project scope", description: "Organize context around the current project folder so the boundary stays clear." },
        { title: "Confirm before acting", description: "File changes and commands follow the permission policy you choose." },
        { title: "Traceable execution", description: "Important tool calls, results, and later changes remain in the thread." },
        { title: "Your model connections", description: "Choose and switch between the providers you have connected." },
      ],
      docsLabel: "Read the permission guide",
      privacyLabel: "Read the privacy policy",
    },
    trust: {
      eyebrow: "Open source is more than a label",
      title: "Inspect every step, from source to release",
      description: "The Anybox desktop app is MIT licensed. Review the implementation, open an issue, contribute, or download a public release.",
      licenseLabel: "Open-source license",
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
    faq: {
      eyebrow: "FAQ",
      title: "A few things you may want to confirm first",
      items: [
        {
          question: "How is Anybox different from a regular AI chat app?",
          answer: "Anybox organizes conversations, files, tool calls, and task history around real projects. It can help an agent participate in execution and delivery within the permissions you set, not only answer questions.",
        },
        {
          question: "Are local files uploaded?",
          answer: "Anybox organizes context around the local project you choose. When a task requires a model to read file contents, what is sent depends on the connected model provider and the task, so review both the permission guide and provider terms.",
        },
        {
          question: "How do I control file changes and commands?",
          answer: "Choose a permission policy for the task. File edits, commands, and tool calls that require confirmation appear in the working thread so you can inspect, continue, or stop.",
        },
        {
          question: "Which models are supported, and how is usage billed?",
          answer: "Anybox can connect to different model providers and switch between them by task. Model usage and billing are generally handled by each provider; see the pricing page for Anybox plans.",
        },
        {
          question: "Can I build my own plugin?",
          answer: "Yes. Plugins can combine dedicated UI, skills, and MCP services to extend the general agent into a specific field. The plugin guide covers package structure and manifest requirements.",
        },
        {
          question: "How do desktop and Android work together?",
          answer: "Use desktop to connect projects and do the main work, then use Android to review, continue, and manage existing projects and sessions.",
        },
      ],
    },
  },
} satisfies Record<SiteLanguage, SiteContent>
