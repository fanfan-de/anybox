import { useCallback, useEffect, useRef, useState } from "react"
import type { SiteLanguage } from "./language"

type HomeDemoVideosProps = {
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

const demoVariants = ["streaming", "playable"] as const
const minimumPlaybackRatio = 0.25
const scrollResumeDelay = 180
const visibilityThresholds = [0, 0.1, 0.25, 0.5, 0.75, 1]

type HomeDemoSectionProps = HomeDemoVideosProps & {
  isPlaybackActive: boolean
  isPlaybackSuspended: boolean
  onRequestPlayback: (variant: DemoVariant) => void
  onVisibilityChange: (variant: DemoVariant, ratio: number) => void
  variant: DemoVariant
}

function HomeDemoSection({
  isPlaybackActive,
  isPlaybackSuspended,
  language,
  onRequestPlayback,
  onVisibilityChange,
  variant,
}: HomeDemoSectionProps) {
  const demo = demos[variant]
  const copy = demo.copy[language]
  const videoRef = useRef<HTMLVideoElement>(null)
  const userPausedRef = useRef(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [showPoster, setShowPoster] = useState(true)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const observer = new IntersectionObserver(([entry]) => {
      const ratio = entry?.intersectionRatio ?? 0
      onVisibilityChange(variant, ratio)

      if (ratio === 0) {
        video.pause()
        setShowPoster(true)
      }
    }, { threshold: visibilityThresholds })

    observer.observe(video)

    return () => {
      observer.disconnect()
      video.pause()
    }
  }, [onVisibilityChange, variant])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (isPlaybackActive && !isPlaybackSuspended && !userPausedRef.current) {
      void video.play().catch(() => setIsPlaying(false))
      return
    }

    video.pause()
  }, [isPlaybackActive, isPlaybackSuspended])

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      userPausedRef.current = false
      onRequestPlayback(variant)
      if (isPlaybackActive && !isPlaybackSuspended) {
        void video.play().catch(() => setIsPlaying(false))
      }
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
                onPlaying={() => setShowPoster(false)}
                playsInline
                poster={demo.poster}
                preload="metadata"
              >
                <source src={demo.source} type="video/mp4" />
              </video>
              <img
                alt=""
                aria-hidden="true"
                className={`home-demo-poster${showPoster ? " is-visible" : ""}`}
                decoding="async"
                loading="lazy"
                src={demo.poster}
              />
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

export function HomeDemoVideos({ language }: HomeDemoVideosProps) {
  const visibilityRatiosRef = useRef<Record<DemoVariant, number>>({
    playable: 0,
    streaming: 0,
  })
  const scrollEndTimerRef = useRef<number | undefined>(undefined)
  const isScrollingRef = useRef(false)
  const [activeVariant, setActiveVariant] = useState<DemoVariant | null>(null)
  const [isScrolling, setIsScrolling] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)

  const updateActiveVariant = useCallback(() => {
    const nextVariant = demoVariants.reduce((mostVisible, candidate) => (
      visibilityRatiosRef.current[candidate] > visibilityRatiosRef.current[mostVisible]
        ? candidate
        : mostVisible
    ))
    const nextRatio = visibilityRatiosRef.current[nextVariant]
    setActiveVariant(nextRatio >= minimumPlaybackRatio ? nextVariant : null)
  }, [])

  const handleVisibilityChange = useCallback((variant: DemoVariant, ratio: number) => {
    visibilityRatiosRef.current[variant] = ratio
    updateActiveVariant()
  }, [updateActiveVariant])

  const handleRequestPlayback = useCallback((variant: DemoVariant) => {
    setActiveVariant(variant)
  }, [])

  useEffect(() => {
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)")
    const handleMotionPreferenceChange = () => setReduceMotion(motionPreference.matches)

    handleMotionPreferenceChange()
    motionPreference.addEventListener("change", handleMotionPreferenceChange)

    return () => motionPreference.removeEventListener("change", handleMotionPreferenceChange)
  }, [])

  useEffect(() => {
    const handleScroll = () => {
      if (!isScrollingRef.current) {
        isScrollingRef.current = true
        setIsScrolling(true)
      }

      window.clearTimeout(scrollEndTimerRef.current)
      scrollEndTimerRef.current = window.setTimeout(() => {
        isScrollingRef.current = false
        setIsScrolling(false)
        updateActiveVariant()
      }, scrollResumeDelay)
    }

    window.addEventListener("scroll", handleScroll, { passive: true })

    return () => {
      window.removeEventListener("scroll", handleScroll)
      window.clearTimeout(scrollEndTimerRef.current)
    }
  }, [updateActiveVariant])

  return (
    <>
      {demoVariants.map((variant) => (
        <HomeDemoSection
          key={variant}
          isPlaybackActive={activeVariant === variant}
          isPlaybackSuspended={isScrolling || reduceMotion}
          language={language}
          onRequestPlayback={handleRequestPlayback}
          onVisibilityChange={handleVisibilityChange}
          variant={variant}
        />
      ))}
    </>
  )
}
