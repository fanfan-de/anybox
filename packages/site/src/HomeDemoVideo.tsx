import type { SiteLanguage } from "./language"

type HomeDemoShowcasesProps = {
  language: SiteLanguage
}

type DemoVariant = "streaming" | "playable"

type DemoCopy = {
  description: string
  eyebrow: string
  imageAlt: string
  points: Array<{ description: string; title: string }>
  title: string
}

const demos = {
  streaming: {
    descriptionId: "home-demo-description",
    id: "product",
    image: "/media/anybox-streaming-ui-poster.webp",
    titleId: "home-demo-title",
    copy: {
      zh: {
        description: "从理解任务到持续生成，Agent 的工作过程实时可见，也随时可以检查。",
        eyebrow: "实时工作流",
        imageAlt: "Anybox 桌面端中，Agent 正在输出任务分析与执行计划",
        points: [
          { description: "任务分析与执行过程逐步展开。", title: "持续输出" },
          { description: "重要步骤保留在同一个工作线程。", title: "过程可见" },
          { description: "需要时暂停、检查，再继续执行。", title: "随时掌控" },
        ],
        title: "看见 Agent 实时输出",
      },
      en: {
        description: "Follow the work as the agent understands the task and streams each step in a process you can inspect.",
        eyebrow: "Live workflow",
        imageAlt: "An Anybox desktop workspace showing an agent's task analysis and execution plan",
        points: [
          { description: "Task analysis and execution unfold step by step.", title: "Continuous output" },
          { description: "Important steps remain visible in one thread.", title: "Visible process" },
          { description: "Pause, inspect, and continue whenever needed.", title: "Stay in control" },
        ],
        title: "Watch the agent stream its work",
      },
    },
  },
  playable: {
    descriptionId: "home-playable-demo-description",
    id: "playground",
    image: "/media/anybox-playable-games-poster.webp",
    titleId: "home-playable-demo-title",
    copy: {
      zh: {
        description: "赛车与打砖块两个案例，把需求、修改和运行预览放在同一块屏幕；生成之后，马上上手验证。",
        eyebrow: "实时构建",
        imageAlt: "Anybox 桌面端在对话旁实时预览生成的赛车游戏",
        points: [
          { description: "用自然语言描述目标，Agent 直接开始构建。", title: "对话即开发" },
          { description: "应用在旁边运行，交互与结果立即可见。", title: "预览即验证" },
          { description: "发现问题后回到对话，继续修改与测试。", title: "问题即迭代" },
        ],
        title: "从一句话，到可玩的作品",
      },
      en: {
        description: "Two playable examples—racing and breakout—keep the request, edits, and running preview together so you can test the result immediately.",
        eyebrow: "Live building",
        imageAlt: "An Anybox desktop workspace previewing a generated racing game beside the conversation",
        points: [
          { description: "Describe the goal in plain language and let the agent start building.", title: "Conversation becomes code" },
          { description: "Run the app alongside the work and see every interaction immediately.", title: "Preview becomes proof" },
          { description: "Return to the conversation to fix, refine, and test again.", title: "Issues become iterations" },
        ],
        title: "From one request to something playable",
      },
    },
  },
} satisfies Record<DemoVariant, {
  copy: Record<SiteLanguage, DemoCopy>
  descriptionId: string
  id: string
  image: string
  titleId: string
}>

const demoVariants = ["streaming", "playable"] as const

type HomeDemoSectionProps = HomeDemoShowcasesProps & {
  variant: DemoVariant
}

function HomeDemoSection({ language, variant }: HomeDemoSectionProps) {
  const demo = demos[variant]
  const copy = demo.copy[language]

  return (
    <section
      className={`home-demo-section${variant === "playable" ? " is-alternate" : ""}`}
      id={demo.id}
      aria-labelledby={demo.titleId}
    >
      <div className="home-demo-inner">
        <div className="home-demo-layout">
          <div className="home-demo-copy">
            <p className="section-kicker">{copy.eyebrow}</p>
            <h2 id={demo.titleId}>{copy.title}</h2>
            <p id={demo.descriptionId}>{copy.description}</p>
            <ol className="home-demo-points">
              {copy.points.map((point, index) => (
                <li key={point.title}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{point.title}</strong>
                    <p>{point.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="home-demo-media">
            <div className="home-demo-frame">
              <img
                alt={copy.imageAlt}
                aria-describedby={demo.descriptionId}
                className="home-demo-image"
                decoding="async"
                height="1440"
                loading="lazy"
                src={demo.image}
                width="2560"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export function HomeDemoShowcases({ language }: HomeDemoShowcasesProps) {
  return (
    <>
      {demoVariants.map((variant) => (
        <HomeDemoSection
          key={variant}
          language={language}
          variant={variant}
        />
      ))}
    </>
  )
}
