import type { SiteLanguage } from "../language"
import coreConceptEn from "./content/core-concept.en.md?raw"
import coreConceptZh from "./content/core  concept.md?raw"
import faqEn from "./content/faq.en.md?raw"
import faqZh from "./content/faq.md?raw"
import gettingStartedEn from "./content/getting-started.en.md?raw"
import gettingStartedZh from "./content/下载安装.md?raw"
import providersEn from "./content/providers.en.md?raw"
import providersZh from "./content/providers.md?raw"
import skillsEn from "./content/skills.en.md?raw"
import skillsZh from "./content/skills.md?raw"

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
      title: "开始",
      items: [
        {
          content: gettingStartedZh,
          description: "下载、安装并完成第一次项目会话。",
          slug: "getting-started",
          title: "快速开始",
        },
        {
          content: coreConceptZh,
          description: "理解 Agent 会话、上下文窗口和自动压缩机制。",
          slug: "core-concept",
          title: "核心概念",
        },
      ],
    },
    {
      title: "配置",
      items: [
        {
          content: providersZh,
          description: "连接模型供应商，选择会话模型。",
          slug: "providers",
          title: "模型供应商",
        },
        {
          content: skillsZh,
          description: "创建、选择和管理可复用 Skills。",
          slug: "skills",
          title: "Skills",
        },
      ],
    },
    {
      title: "支持",
      items: [
        {
          content: faqZh,
          description: "安装、平台、隐私和排障问题。",
          slug: "faq",
          title: "FAQ",
        },
      ],
    },
  ],
  en: [
    {
      title: "Start",
      items: [
        {
          content: gettingStartedEn,
          description: "Download, install, and start your first project session.",
          slug: "getting-started",
          title: "Quick Start",
        },
        {
          content: coreConceptEn,
          description: "Understand sessions, context windows, and compaction.",
          slug: "core-concept",
          title: "Core Concepts",
        },
      ],
    },
    {
      title: "Configure",
      items: [
        {
          content: providersEn,
          description: "Connect a model provider and select a session model.",
          slug: "providers",
          title: "Model Providers",
        },
        {
          content: skillsEn,
          description: "Create, select, and manage reusable Skills.",
          slug: "skills",
          title: "Skills",
        },
      ],
    },
    {
      title: "Support",
      items: [
        {
          content: faqEn,
          description: "Installation, platforms, privacy, and troubleshooting.",
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
