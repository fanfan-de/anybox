import { useEffect, useRef, useState } from "react"
import type { SiteLanguage } from "./language"

type HomeDemoVideoProps = {
  language: SiteLanguage
}

type DemoVariant = "streaming" | "playable"

type DemoCopy = {
  description: string
  eyebrow: string
  pauseLabel: string
  playLabel: string
  points: Array<{ description: string; title: string }>
  title: string
  videoLabel: string
}

const demos = {
  streaming: {
    descriptionId: "home-demo-description",
    id: "product",
    poster: "/media/anybox-streaming-ui-poster.webp",
    source: "/media/anybox-streaming-ui-1440p.mp4",
    titleId: "home-demo-title",
    copy: {
      zh: {
        description: "从理解任务到持续生成，Agent 的工作过程实时可见，也随时可以检查。",
        eyebrow: "实时工作流",
        pauseLabel: "暂停演示",
        playLabel: "播放演示",
        points: [
          { description: "任务分析与执行过程逐步展开。", title: "持续输出" },
          { description: "重要步骤保留在同一个工作线程。", title: "过程可见" },
          { description: "需要时暂停、检查，再继续执行。", title: "随时掌控" },
        ],
        title: "看见 Agent 实时输出",
        videoLabel: "Anybox 中 Agent 流式输出任务分析与执行计划的界面演示",
      },
      en: {
        description: "Follow the work as the agent understands the task and streams each step in a process you can inspect.",
        eyebrow: "Live workflow",
        pauseLabel: "Pause demo",
        playLabel: "Play demo",
        points: [
          { description: "Task analysis and execution unfold step by step.", title: "Continuous output" },
          { description: "Important steps remain visible in one thread.", title: "Visible process" },
          { description: "Pause, inspect, and continue whenever needed.", title: "Stay in control" },
        ],
        title: "Watch the agent stream its work",
        videoLabel: "An Anybox agent streaming its task analysis and execution plan",
      },
    },
  },
  playable: {
    descriptionId: "home-playable-demo-description",
    id: "playground",
    poster: "/media/anybox-playable-games-poster.webp",
    source: "/media/anybox-playable-games-1440p.mp4",
    titleId: "home-playable-demo-title",
    copy: {
      zh: {
        description: "赛车与打砖块两个案例，把需求、修改和运行预览放在同一块屏幕；生成之后，马上上手验证。",
        eyebrow: "实时构建",
        pauseLabel: "暂停演示",
        playLabel: "播放演示",
        points: [
          { description: "用自然语言描述目标，Agent 直接开始构建。", title: "对话即开发" },
          { description: "应用在旁边运行，交互与结果立即可见。", title: "预览即验证" },
          { description: "发现问题后回到对话，继续修改与测试。", title: "问题即迭代" },
        ],
        title: "从一句话，到可玩的作品",
        videoLabel: "Anybox 根据对话构建赛车与打砖块游戏并即时运行预览的演示",
      },
      en: {
        description: "Two playable examples—racing and breakout—keep the request, edits, and running preview together so you can test the result immediately.",
        eyebrow: "Live building",
        pauseLabel: "Pause demo",
        playLabel: "Play demo",
        points: [
          { description: "Describe the goal in plain language and let the agent start building.", title: "Conversation becomes code" },
          { description: "Run the app alongside the work and see every interaction immediately.", title: "Preview becomes proof" },
          { description: "Return to the conversation to fix, refine, and test again.", title: "Issues become iterations" },
        ],
        title: "From one request to something playable",
        videoLabel: "Anybox building and previewing playable racing and breakout games from a conversation",
      },
    },
  },
} satisfies Record<DemoVariant, {
  copy: Record<SiteLanguage, DemoCopy>
  descriptionId: string
  id: string
  poster: string
  source: string
  titleId: string
}>

type HomeDemoSectionProps = HomeDemoVideoProps & {
  variant: DemoVariant
}

function HomeDemoSection({ language, variant }: HomeDemoSectionProps) {
  const demo = demos[variant]
  const copy = demo.copy[language]
  const videoRef = useRef<HTMLVideoElement>(null)
  const isInViewRef = useRef(false)
  const userPausedRef = useRef(false)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)")

    const syncPlayback = () => {
      if (isInViewRef.current && !motionPreference.matches && !userPausedRef.current) {
        void video.play().catch(() => setIsPlaying(false))
        return
      }

      video.pause()
    }

    const observer = new IntersectionObserver(([entry]) => {
      isInViewRef.current = Boolean(entry?.isIntersecting)
      syncPlayback()
    }, { threshold: 0.45 })

    const handleMotionPreferenceChange = () => syncPlayback()

    observer.observe(video)
    motionPreference.addEventListener("change", handleMotionPreferenceChange)

    return () => {
      observer.disconnect()
      motionPreference.removeEventListener("change", handleMotionPreferenceChange)
      video.pause()
    }
  }, [])

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      userPausedRef.current = false
      void video.play().catch(() => setIsPlaying(false))
      return
    }

    userPausedRef.current = true
    video.pause()
  }

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
              <video
                ref={videoRef}
                aria-describedby={demo.descriptionId}
                aria-label={copy.videoLabel}
                className="home-demo-video"
                loop
                muted
                onPause={() => setIsPlaying(false)}
                onPlay={() => setIsPlaying(true)}
                playsInline
                poster={demo.poster}
                preload="metadata"
              >
                <source src={demo.source} type="video/mp4" />
              </video>
              <button
                className="home-demo-playback"
                type="button"
                onClick={togglePlayback}
                aria-label={isPlaying ? copy.pauseLabel : copy.playLabel}
              >
                {isPlaying ? copy.pauseLabel : copy.playLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export function HomeDemoVideo({ language }: HomeDemoVideoProps) {
  return <HomeDemoSection language={language} variant="streaming" />
}

export function HomePlayableDemoVideo({ language }: HomeDemoVideoProps) {
  return <HomeDemoSection language={language} variant="playable" />
}
