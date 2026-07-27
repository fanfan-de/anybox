---
workflow: motion-graphics
flow: automation
storyboard: no
message: "盒子猫从点阵中被唤醒并完整显现，作为产品介绍视频的开场识别"
destination: product-intro-video
aspect: 1920x1080
language: none
audience: product-viewers
length: 4.2s
category: logo-reveal
export: mp4
---

## Intent

制作一段简短、无旁白的盒子猫 Logo 片头。主视觉是点阵从环境中聚合：
纸盒先成形，猫随后探出并眨眼，尾巴补全，最后回到清晰、完整的原始 Logo。

## Assets

- `../../public/anybox-box-cat-logo.png` — 用户确认的盒子猫产品 Logo；作为最终锁定画面与点阵遮罩来源。

## Customizations

- 点阵聚合是唯一主导动效。
- 利用原 Logo 的空间结构分别表现纸盒、盒盖、猫和尾巴的进入节奏。
- 最终画面完整保留原 Logo 的比例、轮廓和白色像素。

## Notes

- 不使用已删除的 `brand-mark.svg`。
- 不添加未经确认的产品名称、标语或品牌色。
- 不使用重度故障闪烁、随机粒子或喧宾夺主的渐变。
- 首版使用深色不透明画布；如后续需要叠加到视频上，可另做透明 WebM。
