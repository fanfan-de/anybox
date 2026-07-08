import faq from "./content/faq.md?raw"
import coreConcept from "./content/core  concept.md?raw"
import gettingStarted from "./content/下载安装.md?raw"
import providers from "./content/providers.md?raw"
import skills from "./content/skills.md?raw"

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

export const docsSections: DocsSection[] = [
  {
    title: "开始",
    items: [
      {
        content: gettingStarted,
        description: "下载、安装并完成第一次项目会话。",
        slug: "getting-started",
        title: "快速开始",
      },
      {
        content: coreConcept,
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
        content: providers,
        description: "连接模型供应商，选择会话模型。",
        slug: "providers",
        title: "模型供应商",
      },
      {
        content: skills,
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
        content: faq,
        description: "安装、平台、隐私和排障问题。",
        slug: "faq",
        title: "FAQ",
      },
    ],
  },
]

export const docsArticles = docsSections.flatMap((section) => section.items)

export function getDocsArticle(slug: string | null) {
  return docsArticles.find((article) => article.slug === slug)
}
