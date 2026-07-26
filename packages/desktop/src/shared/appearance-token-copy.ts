import type { AppLocale } from "./locale"
import type { APPEARANCE_TOKEN_GROUPS, AppearanceTokenGroup } from "./appearance"
import { appearanceTokenCopy as deDEAppearanceTokenCopy } from "./appearance-token-copy.locales/de-DE"
import { appearanceTokenCopy as es419AppearanceTokenCopy } from "./appearance-token-copy.locales/es-419"
import { appearanceTokenCopy as frFRAppearanceTokenCopy } from "./appearance-token-copy.locales/fr-FR"
import { appearanceTokenCopy as idIDAppearanceTokenCopy } from "./appearance-token-copy.locales/id-ID"
import { appearanceTokenCopy as itITAppearanceTokenCopy } from "./appearance-token-copy.locales/it-IT"
import { appearanceTokenCopy as jaJPAppearanceTokenCopy } from "./appearance-token-copy.locales/ja-JP"
import { appearanceTokenCopy as koKRAppearanceTokenCopy } from "./appearance-token-copy.locales/ko-KR"
import { appearanceTokenCopy as plPLAppearanceTokenCopy } from "./appearance-token-copy.locales/pl-PL"
import { appearanceTokenCopy as ptBRAppearanceTokenCopy } from "./appearance-token-copy.locales/pt-BR"
import { appearanceTokenCopy as trTRAppearanceTokenCopy } from "./appearance-token-copy.locales/tr-TR"
import { appearanceTokenCopy as viVNAppearanceTokenCopy } from "./appearance-token-copy.locales/vi-VN"
import { appearanceTokenCopy as zhTWAppearanceTokenCopy } from "./appearance-token-copy.locales/zh-TW"

type AppearanceTokenGroupID = (typeof APPEARANCE_TOKEN_GROUPS)[number]["id"]
type AppearanceTokenRowID = (typeof APPEARANCE_TOKEN_GROUPS)[number]["rows"][number]["id"]
type AppearanceTokenRow = AppearanceTokenGroup["rows"][number]

interface AppearanceTokenCopy {
  label: string
  description: string
}

const zhCNTokenGroupCopy = {
  "foundation-surfaces": {
    label: "基础 / 表面",
    description: "应用、外壳、面板、侧边栏、轨迹、遮罩和代码区域的基础背景色。",
  },
  "foundation-content": {
    label: "基础 / 内容",
    description: "用于建立基础对比度体系的文字与边框 token。",
  },
  accent: {
    label: "强调状态",
    description: "驱动按钮、悬停和激活强调效果的品牌交互色。",
  },
  "component-buttons": {
    label: "按钮",
    description: "主按钮、次按钮和危险操作按钮的专用语义颜色。",
  },
  "component-fields": {
    label: "输入字段",
    description: "文本输入、文本区域、选择器、搜索框和可编辑控件外壳的共享语义颜色。",
  },
  "status-success": {
    label: "状态 / 成功",
    description: "成功状态从基础色到文字、边框和背景处理的颜色组。",
  },
  "status-warning": {
    label: "状态 / 警告",
    description: "警告状态从基础色到文字、边框和背景处理的颜色组。",
  },
  "status-error": {
    label: "状态 / 错误",
    description: "错误状态从基础色到文字、边框和背景处理的颜色组。",
  },
  "status-info": {
    label: "状态 / 信息",
    description: "信息提示从基础色到文字、边框和背景处理的颜色组。",
  },
  "component-shell-chrome": {
    label: "外壳栏",
    description: "应用外壳级导航、标签和顶部菜单栏的专用语义背景。",
  },
  "component-terminal": {
    label: "终端",
    description: "嵌入式终端表面的专用语义颜色。",
  },
  "component-popup-panel": {
    label: "弹出面板",
    description: "设置窗口、浮层面板和面板式弹出内容的专用语义背景。",
  },
  "component-settings-switches": {
    label: "设置开关",
    description: "设置页开关控件的行背景、轨道和滑块颜色。",
  },
  "component-segmented-controls": {
    label: "分段控件",
    description: "视图、页面分区和模式切换类分段控件的容器与选项状态颜色。",
  },
  "component-dropdown-select": {
    label: "下拉选择",
    description: "展开后的下拉菜单、选择器菜单背景与选项状态的专用语义颜色。",
  },
  "component-question-card": {
    label: "问题卡片",
    description: "智能体提问卡片的专用语义背景。",
  },
  "component-proposed-plan-card": {
    label: "计划卡片",
    description: "助手回复中计划建议卡片的专用语义背景。",
  },
  "component-thread-view": {
    label: "会话视图",
    description: "会话文本、面板背景和用户变更卡片的专用语义颜色。",
  },
  "component-markdown": {
    label: "Markdown",
    description: "渲染后 Markdown 内容的专用语义颜色。",
  },
  "component-sidebar-tree-rows": {
    label: "侧边栏树行",
    description: "左侧边栏中对话、工作区、Prompts、Skills、MCP 和工具行的专用状态 token。",
  },
  "component-list-detail-rows": {
    label: "列表明细行",
    description: "可复用于设置、插件、连接器、MCP 等区域的列表明细行状态 token。",
  },
  "component-workspace-files": {
    label: "工作区文件",
    description: "源码预览和工作区文件交互的独立语义颜色。",
  },
  "component-plugin-marketplace": {
    label: "插件市场",
    description: "插件图标、列表项、状态、标签和状态指示器的独立语义颜色。",
  },
  "component-composer": {
    label: "输入框",
    description: "任务输入区域和内部控制按钮的专用语义颜色。",
  },
  "global-interaction": {
    label: "全局交互",
    description: "跨多个组件复用的焦点、选择和半透明面板 token。",
  },
} satisfies Partial<Record<AppearanceTokenGroupID, AppearanceTokenCopy>>

const zhCNTokenRowCopy = {
  "surface-app": {
    label: "应用背景",
    description: "最底层的画布背景。",
  },
  "surface-shell": {
    label: "外壳背景",
    description: "工作台、Dockview 和内部 shell 容器的背景；不控制窗口最外层表面。",
  },
  "surface-panel": {
    label: "面板背景",
    description: "主要卡片和面板主体的背景。",
  },
  "surface-panel-muted": {
    label: "弱化面板",
    description: "次级面板填充和低强调行背景。",
  },
  "surface-left-sidebar": {
    label: "左侧边栏背景",
    description: "左侧导航边栏的背景。",
  },
  "surface-right-sidebar": {
    label: "右侧边栏背景",
    description: "右侧检查与工具边栏的背景。",
  },
  "surface-sidebar-strong": {
    label: "侧边栏强调",
    description: "侧边栏强调区域和选中栏位的背景。",
  },
  "surface-user-bubble": {
    label: "用户气泡",
    description: "用户消息气泡的背景。",
  },
  "surface-trace": {
    label: "轨迹背景",
    description: "轨迹和工具调用区域的背景。",
  },
  "surface-elevated": {
    label: "浮层背景",
    description: "浮动面板、菜单和提升层的背景。",
  },
  "surface-overlay": {
    label: "遮罩",
    description: "弹窗和拖拽遮罩层的背景。",
  },
  "surface-code": {
    label: "代码背景",
    description: "代码块和终端的基础背景。",
  },
  "surface-code-strong": {
    label: "代码强调背景",
    description: "更深层的代码和终端强调背景。",
  },
  "text-primary": {
    label: "主要文字",
    description: "最高强调级别的正文文字。",
  },
  "text-secondary": {
    label: "次级文字",
    description: "辅助说明和标签文字。",
  },
  "text-tertiary": {
    label: "弱化文字",
    description: "低强调的辅助文字。",
  },
  "text-on-dark": {
    label: "深色上文字",
    description: "放在深色或品牌色背景上的文字。",
  },
  "border-subtle": {
    label: "弱化边框",
    description: "低强调分隔线。",
  },
  "border-default": {
    label: "默认边框",
    description: "标准边框颜色。",
  },
  "brand-primary": {
    label: "强调基础色",
    description: "主要强调色。",
  },
  "brand-primary-hover": {
    label: "强调悬停色",
    description: "悬停和更强强调状态使用的颜色。",
  },
  "brand-accent-highlight": {
    label: "强调激活色",
    description: "激活和高亮状态使用的颜色。",
  },
  "semantic-accent-icon": {
    label: "图标默认",
    description: "强调型图标按钮的默认图标颜色。",
  },
  "semantic-accent-icon-hover": {
    label: "图标悬停",
    description: "强调型图标按钮悬停和聚焦时的图标颜色。",
  },
  "semantic-accent-icon-active": {
    label: "图标激活",
    description: "强调型图标按钮选中和激活时的图标颜色。",
  },
  "brand-primary-soft": {
    label: "柔和强调背景",
    description: "激活控件背后的柔和强调背景。",
  },
  "brand-primary-soft-strong": {
    label: "强柔和强调背景",
    description: "更强的柔和强调背景。",
  },
  "semantic-button-primary-surface": {
    label: "主按钮背景",
    description: "主操作按钮的默认填充色。",
  },
  "semantic-button-primary-surface-hover": {
    label: "主按钮悬停背景",
    description: "主操作按钮悬停和聚焦时的填充色。",
  },
  "semantic-button-primary-border": {
    label: "主按钮边框",
    description: "主操作按钮的默认边框。",
  },
  "semantic-button-primary-border-hover": {
    label: "主按钮悬停边框",
    description: "主操作按钮悬停和聚焦时的边框。",
  },
  "semantic-button-primary-text": {
    label: "主按钮文字",
    description: "主操作按钮的默认文字和图标颜色。",
  },
  "semantic-button-primary-text-hover": {
    label: "主按钮悬停文字",
    description: "主操作按钮悬停和聚焦时的文字与图标颜色。",
  },
  "semantic-button-primary-disabled-surface": {
    label: "主按钮禁用背景",
    description: "主操作按钮禁用时的填充色。",
  },
  "semantic-button-primary-disabled-border": {
    label: "主按钮禁用边框",
    description: "主操作按钮禁用时的边框。",
  },
  "semantic-button-primary-disabled-text": {
    label: "主按钮禁用文字",
    description: "主操作按钮禁用时的文字和图标颜色。",
  },
  "semantic-button-secondary-surface": {
    label: "次按钮背景",
    description: "次级操作按钮的默认填充色。",
  },
  "semantic-button-secondary-surface-hover": {
    label: "次按钮悬停背景",
    description: "次级操作按钮悬停和聚焦时的填充色。",
  },
  "semantic-button-secondary-border": {
    label: "次按钮边框",
    description: "次级操作按钮的默认边框。",
  },
  "semantic-button-secondary-border-hover": {
    label: "次按钮悬停边框",
    description: "次级操作按钮悬停和聚焦时的边框。",
  },
  "semantic-button-secondary-text": {
    label: "次按钮文字",
    description: "次级操作按钮的默认文字和图标颜色。",
  },
  "semantic-button-secondary-text-hover": {
    label: "次按钮悬停文字",
    description: "次级操作按钮悬停和聚焦时的文字与图标颜色。",
  },
  "semantic-button-secondary-disabled-surface": {
    label: "次按钮禁用背景",
    description: "次级操作按钮禁用时的填充色。",
  },
  "semantic-button-secondary-disabled-border": {
    label: "次按钮禁用边框",
    description: "次级操作按钮禁用时的边框。",
  },
  "semantic-button-secondary-disabled-text": {
    label: "次按钮禁用文字",
    description: "次级操作按钮禁用时的文字和图标颜色。",
  },
  "semantic-button-danger-surface": {
    label: "危险按钮背景",
    description: "危险操作按钮的默认填充色。",
  },
  "semantic-button-danger-surface-hover": {
    label: "危险按钮悬停背景",
    description: "危险操作按钮悬停和聚焦时的填充色。",
  },
  "semantic-button-danger-border": {
    label: "危险按钮边框",
    description: "危险操作按钮的默认边框。",
  },
  "semantic-button-danger-border-hover": {
    label: "危险按钮悬停边框",
    description: "危险操作按钮悬停和聚焦时的边框。",
  },
  "semantic-button-danger-text": {
    label: "危险按钮文字",
    description: "危险操作按钮的默认文字和图标颜色。",
  },
  "semantic-button-danger-text-hover": {
    label: "危险按钮悬停文字",
    description: "危险操作按钮悬停和聚焦时的文字与图标颜色。",
  },
  "semantic-button-danger-disabled-surface": {
    label: "危险按钮禁用背景",
    description: "危险操作按钮禁用时的填充色。",
  },
  "semantic-button-danger-disabled-border": {
    label: "危险按钮禁用边框",
    description: "危险操作按钮禁用时的边框。",
  },
  "semantic-button-danger-disabled-text": {
    label: "危险按钮禁用文字",
    description: "危险操作按钮禁用时的文字和图标颜色。",
  },
  "semantic-icon-button-text": {
    label: "图标按钮颜色",
    description: "独立纯图标按钮默认状态的图标颜色。",
  },
  "semantic-icon-button-text-hover": {
    label: "图标按钮悬停颜色",
    description: "独立纯图标按钮悬停和聚焦状态的图标颜色。",
  },
  "semantic-icon-button-text-active": {
    label: "图标按钮激活颜色",
    description: "独立纯图标按钮激活状态的图标颜色。",
  },
  "semantic-icon-button-surface-hover": {
    label: "图标按钮悬停背景",
    description: "需要状态底色的纯图标按钮悬停和聚焦背景。",
  },
  "semantic-icon-button-surface-active": {
    label: "图标按钮激活背景",
    description: "需要状态底色的纯图标按钮激活背景。",
  },
  "semantic-field-surface": {
    label: "输入字段背景",
    description: "可编辑字段和控件外壳的默认背景。",
  },
  "semantic-field-surface-muted": {
    label: "弱化输入字段背景",
    description: "紧凑或次级可编辑字段的低强调背景。",
  },
  "semantic-field-surface-focus": {
    label: "输入字段聚焦背景",
    description: "可编辑字段包含键盘焦点时的背景。",
  },
  "semantic-field-surface-disabled": {
    label: "输入字段禁用背景",
    description: "可编辑字段禁用时的背景。",
  },
  "semantic-field-border": {
    label: "输入字段边框",
    description: "可编辑字段的默认边框。",
  },
  "semantic-field-border-focus": {
    label: "输入字段聚焦边框",
    description: "可编辑字段包含键盘焦点时的边框。",
  },
  "semantic-field-border-disabled": {
    label: "输入字段禁用边框",
    description: "可编辑字段禁用时的边框。",
  },
  "semantic-field-border-invalid": {
    label: "输入字段无效边框",
    description: "可编辑字段内容无效时的边框。",
  },
  "semantic-field-text": {
    label: "输入字段文字",
    description: "可编辑字段值的文字颜色。",
  },
  "semantic-field-text-disabled": {
    label: "输入字段禁用文字",
    description: "可编辑字段禁用时的文字颜色。",
  },
  "semantic-field-placeholder": {
    label: "输入字段占位符",
    description: "可编辑字段占位提示的文字颜色。",
  },
  "semantic-success": {
    label: "基础色",
    description: "主要成功状态色。",
  },
  "semantic-success-strong": {
    label: "强调色",
    description: "更高强调级别的成功状态色。",
  },
  "semantic-success-text": {
    label: "文字",
    description: "中性背景上的成功文字和图标颜色。",
  },
  "semantic-success-border": {
    label: "边框",
    description: "成功状态描边和分隔线。",
  },
  "semantic-success-surface": {
    label: "背景",
    description: "柔和的成功状态背景。",
  },
  "semantic-success-surface-strong": {
    label: "强调背景",
    description: "更强的成功状态背景。",
  },
  "semantic-warning": {
    label: "基础色",
    description: "主要警告状态色。",
  },
  "semantic-warning-strong": {
    label: "强调色",
    description: "更高强调级别的警告状态色。",
  },
  "semantic-warning-text": {
    label: "文字",
    description: "中性背景上的警告文字和图标颜色。",
  },
  "semantic-warning-border": {
    label: "边框",
    description: "警告状态描边和分隔线。",
  },
  "semantic-warning-surface": {
    label: "背景",
    description: "柔和的警告状态背景。",
  },
  "semantic-warning-surface-strong": {
    label: "强调背景",
    description: "更强的警告状态背景。",
  },
  "semantic-error": {
    label: "基础色",
    description: "主要错误状态色。",
  },
  "semantic-error-strong": {
    label: "强调色",
    description: "更高强调级别的错误状态色。",
  },
  "semantic-error-text": {
    label: "文字",
    description: "中性背景上的错误文字和图标颜色。",
  },
  "semantic-error-border": {
    label: "边框",
    description: "错误状态描边和分隔线。",
  },
  "semantic-error-surface": {
    label: "背景",
    description: "柔和的错误状态背景。",
  },
  "semantic-error-surface-strong": {
    label: "强调背景",
    description: "更强的错误状态背景。",
  },
  "semantic-info": {
    label: "基础色",
    description: "主要信息提示色。",
  },
  "semantic-info-strong": {
    label: "强调色",
    description: "更高强调级别的信息提示色。",
  },
  "semantic-info-text": {
    label: "文字",
    description: "中性背景上的信息文字和图标颜色。",
  },
  "semantic-info-border": {
    label: "边框",
    description: "信息提示描边和分隔线。",
  },
  "semantic-info-surface": {
    label: "背景",
    description: "柔和的信息提示背景。",
  },
  "semantic-info-surface-strong": {
    label: "强调背景",
    description: "更强的信息提示背景。",
  },
  "semantic-shell-chrome-surface": {
    label: "背景",
    description: "外壳级面板标签和侧边栏顶部菜单的背景。",
  },
  "semantic-shell-chrome-tab-surface-active": {
    label: "选中标签背景",
    description: "中央工作台和右侧栏中当前选中标签的背景。",
  },
  "semantic-terminal-surface": {
    label: "终端背景",
    description: "终端内容区域的背景。",
  },
  "semantic-popup-panel-surface": {
    label: "面板背景",
    description: "设置窗口、浮层面板和面板式弹出内容的背景。",
  },
  "semantic-settings-switch-row-surface-focus": {
    label: "开关聚焦行",
    description: "设置开关获得键盘焦点时的行背景。",
  },
  "semantic-settings-switch-track-surface": {
    label: "开关轨道",
    description: "设置开关控件的默认轨道填充色。",
  },
  "semantic-settings-switch-track-border": {
    label: "开关轨道边框",
    description: "设置开关控件的默认轨道边框。",
  },
  "semantic-settings-switch-track-border-focus": {
    label: "开关聚焦边框",
    description: "设置开关获得键盘焦点时的轨道边框。",
  },
  "semantic-settings-switch-track-surface-active": {
    label: "开关启用轨道",
    description: "设置开关启用时的轨道填充色。",
  },
  "semantic-settings-switch-track-border-active": {
    label: "开关启用边框",
    description: "设置开关启用时的轨道边框。",
  },
  "semantic-settings-switch-track-surface-disabled": {
    label: "开关禁用轨道",
    description: "设置开关禁用时的轨道填充色。",
  },
  "semantic-settings-switch-track-border-disabled": {
    label: "开关禁用边框",
    description: "设置开关禁用时的轨道边框。",
  },
  "semantic-settings-switch-thumb-surface": {
    label: "开关滑块",
    description: "设置开关控件的滑块填充色。",
  },
  "semantic-settings-switch-thumb-surface-disabled": {
    label: "开关禁用滑块",
    description: "设置开关禁用时的滑块填充色。",
  },
  "semantic-segmented-control-surface": {
    label: "控件背景",
    description: "紧凑型分段控件外层容器的背景。",
  },
  "semantic-segmented-control-border": {
    label: "控件边框",
    description: "紧凑型分段控件外层容器的边框。",
  },
  "semantic-segmented-control-item-surface-hover": {
    label: "选项悬停背景",
    description: "分段控件选项悬停和聚焦时的背景。",
  },
  "semantic-segmented-control-item-surface-active": {
    label: "选项激活背景",
    description: "分段控件当前选中选项的背景。",
  },
  "semantic-segmented-control-item-text": {
    label: "选项文字",
    description: "分段控件选项默认文字和图标颜色。",
  },
  "semantic-segmented-control-item-text-hover": {
    label: "选项悬停文字",
    description: "分段控件选项悬停和聚焦时的文字颜色。",
  },
  "semantic-segmented-control-item-text-active": {
    label: "选项激活文字",
    description: "分段控件当前选中选项的文字和图标颜色。",
  },
  "semantic-segmented-control-item-meta-text": {
    label: "选项辅助文字",
    description: "分段控件选项内弱化辅助文字的颜色。",
  },
  "semantic-segmented-control-item-meta-text-active": {
    label: "选项激活辅助文字",
    description: "分段控件当前选中选项内辅助文字的颜色。",
  },
  "semantic-segmented-control-item-text-disabled": {
    label: "选项禁用文字",
    description: "分段控件禁用选项的文字和图标颜色。",
  },
  "semantic-dropdown-menu-surface": {
    label: "菜单背景",
    description: "展开后的下拉菜单和选择器菜单背景。",
  },
  "semantic-dropdown-option-surface-hover": {
    label: "选项悬停背景",
    description: "下拉选项悬停或键盘聚焦时的背景。",
  },
  "semantic-dropdown-option-surface-selected": {
    label: "选项选中背景",
    description: "下拉菜单当前选中选项的背景。",
  },
  "semantic-dropdown-option-text": {
    label: "选项文字",
    description: "下拉选项默认文字和图标颜色。",
  },
  "semantic-dropdown-option-text-hover": {
    label: "选项悬停文字",
    description: "下拉选项悬停或键盘聚焦时的文字和图标颜色。",
  },
  "semantic-dropdown-option-text-selected": {
    label: "选项选中文字",
    description: "下拉菜单当前选中选项的文字和图标颜色。",
  },
  "semantic-dropdown-option-meta-text": {
    label: "选项辅助文字",
    description: "下拉选项内计数和辅助信息的文字颜色。",
  },
  "semantic-dropdown-option-meta-text-selected": {
    label: "选项选中辅助文字",
    description: "下拉菜单当前选中选项内计数和辅助信息的文字颜色。",
  },
  "semantic-question-card-surface": {
    label: "背景",
    description: "智能体提问卡片的背景。",
  },
  "semantic-proposed-plan-card-surface": {
    label: "卡片背景",
    description: "助手回复中计划建议卡片的背景。",
  },
  "semantic-thread-response-text": {
    label: "回复文字",
    description: "会话视图中助手回复内容的文字颜色。",
  },
  "semantic-thread-reasoning-text": {
    label: "推理文字",
    description: "会话视图中助手推理内容的文字颜色。",
  },
  "semantic-thread-divider": {
    label: "分隔线",
    description: "会话轨迹标题的分隔线颜色。",
  },
  "semantic-thread-panel-surface": {
    label: "会话面板背景",
    description: "侧边对话和默认助手卡片等会话内面板的背景。",
  },
  "semantic-thread-panel-surface-muted": {
    label: "会话弱化面板",
    description: "轨迹、元数据和嵌套会话面板的低强调背景。",
  },
  "semantic-thread-tool-io-panel-surface": {
    label: "工具输入输出面板",
    description: "工具输入和输出合并滚动面板的背景。",
  },
  "semantic-thread-panel-surface-hover": {
    label: "会话面板悬停",
    description: "会话面板内紧凑控件悬停和聚焦时的背景。",
  },
  "semantic-thread-user-message-diff-card-surface": {
    label: "变更卡片背景",
    description: "用户回合文件变更卡片的背景。",
  },
  "semantic-thread-user-message-diff-card-border": {
    label: "变更卡片边框",
    description: "用户回合文件变更卡片和预览的外边框。",
  },
  "semantic-thread-user-message-diff-divider": {
    label: "变更行分隔线",
    description: "用户回合文件变更行之间的分隔线颜色。",
  },
  "semantic-thread-user-message-diff-row-surface-hover": {
    label: "变更行悬停",
    description: "用户回合文件变更行和摘要控件的悬停背景。",
  },
  "semantic-thread-user-message-diff-row-surface-focus": {
    label: "变更行聚焦",
    description: "用户回合文件变更行和摘要控件的键盘聚焦背景。",
  },
  "semantic-thread-user-message-diff-preview-surface": {
    label: "变更预览背景",
    description: "嵌入式用户变更预览的背景。",
  },
  "semantic-markdown-text": {
    label: "文字",
    description: "渲染后 Markdown 的默认正文颜色。",
  },
  "semantic-markdown-muted-text": {
    label: "弱化文字",
    description: "引用和图片回退文本等 Markdown 辅助文字颜色。",
  },
  "semantic-markdown-strong-text": {
    label: "强调文字",
    description: "Markdown 标题和高强调文字颜色。",
  },
  "semantic-markdown-accent": {
    label: "强调",
    description: "Markdown 标题引导线、列表标记和轻量强调色。",
  },
  "semantic-markdown-selection-background": {
    label: "选区背景",
    description: "Markdown 文本被鼠标选中时的高亮背景。",
  },
  "semantic-markdown-selection-text": {
    label: "选区文字",
    description: "Markdown 文本被鼠标选中时的文字颜色。",
  },
  "semantic-markdown-border": {
    label: "边框",
    description: "Markdown 表格、图片和分隔线的默认边框。",
  },
  "semantic-markdown-border-strong": {
    label: "强调边框",
    description: "行内代码和表头使用的更强 Markdown 边框。",
  },
  "semantic-markdown-quote-surface": {
    label: "引用背景",
    description: "Markdown 引用块的背景。",
  },
  "semantic-markdown-inline-code-surface": {
    label: "行内代码背景",
    description: "Markdown 行内代码片段的背景。",
  },
  "semantic-markdown-table-head-surface": {
    label: "表头背景",
    description: "Markdown 表格表头的背景。",
  },
  "semantic-markdown-table-row-alt-surface": {
    label: "表格交替行背景",
    description: "Markdown 表格交替行的背景。",
  },
  "semantic-markdown-code-surface": {
    label: "代码块背景",
    description: "Markdown 围栏代码块的背景。",
  },
  "semantic-markdown-code-text": {
    label: "代码块文字",
    description: "Markdown 围栏代码块的文字颜色。",
  },
  "semantic-markdown-code-muted-text": {
    label: "代码块弱化文字",
    description: "Markdown 围栏代码块内部元数据的弱化文字颜色。",
  },
  "semantic-markdown-code-border": {
    label: "代码块边框",
    description: "Markdown 围栏代码块的边框颜色。",
  },
  "semantic-sidebar-tree-row-text": {
    label: "行文字",
    description: "侧边栏树行的默认文字和图标颜色。",
  },
  "semantic-sidebar-tree-row-text-hover": {
    label: "行悬停文字",
    description: "侧边栏树行悬停和聚焦时的文字颜色。",
  },
  "semantic-sidebar-tree-row-text-active": {
    label: "行激活文字",
    description: "侧边栏树行选中时的文字颜色。",
  },
  "semantic-sidebar-tree-row-surface-hover": {
    label: "行悬停背景",
    description: "侧边栏树行悬停和聚焦时的背景。",
  },
  "semantic-sidebar-tree-row-surface-active": {
    label: "行激活背景",
    description: "侧边栏树行选中时的背景。",
  },
  "semantic-sidebar-tree-row-leading-active": {
    label: "前置图标激活色",
    description: "左侧边栏树行选中时的前置图标颜色。",
  },
  "semantic-list-detail-row-surface": {
    label: "行默认背景",
    description: "列表明细行处于常态时的背景。",
  },
  "semantic-list-detail-row-surface-hover": {
    label: "行悬停背景",
    description: "列表明细行悬停和聚焦时的背景。",
  },
  "semantic-detail-icon-surface": {
    label: "明细图标背景",
    description: "列表明细界面中紧凑前置图标和功能图标的通用背景。",
  },
  "semantic-detail-icon-border": {
    label: "明细图标边框",
    description: "列表明细界面中紧凑前置图标和功能图标的通用边框。",
  },
  "semantic-detail-icon-text": {
    label: "明细图标前景",
    description: "列表明细界面中紧凑前置图标和功能图标的通用前景色。",
  },
  "semantic-workspace-files-code-row-surface-hover": {
    label: "代码行悬停背景",
    description: "工作区文件预览中代码行悬停时的背景。",
  },
  "semantic-workspace-files-code-row-surface-current": {
    label: "代码行选中背景",
    description: "工作区文件预览中选中代码行的背景。",
  },
  "semantic-plugin-market-icon-surface": {
    label: "插件占位图标背景",
    description: "字形和首字母占位图标的中性背景；真实 Logo 图片不绘制底色。",
  },
  "semantic-plugin-market-icon-border": {
    label: "插件占位图标边框",
    description: "字形和首字母占位图标的中性边框。",
  },
  "semantic-plugin-market-icon-text": {
    label: "插件占位图标文字",
    description: "字形和首字母占位图标的中性前景色。",
  },
  "semantic-plugin-market-item-border-hover": {
    label: "插件项悬停边框",
    description: "插件列表项悬停和键盘聚焦时的边框颜色。",
  },
  "semantic-plugin-market-item-border-current": {
    label: "插件项当前边框",
    description: "当前插件列表项的内侧边框颜色。",
  },
  "semantic-plugin-market-title-text-active": {
    label: "插件标题激活色",
    description: "插件列表项悬停、聚焦和选中时的标题颜色。",
  },
  "semantic-plugin-market-state-surface": {
    label: "插件状态背景",
    description: "已安装和可用性状态标签的背景。",
  },
  "semantic-plugin-market-state-text": {
    label: "插件状态文字",
    description: "已安装和可用性状态标签的文字颜色。",
  },
  "semantic-plugin-market-tag-surface": {
    label: "插件标签背景",
    description: "插件关键词标签的独立背景。",
  },
  "semantic-plugin-market-tag-text": {
    label: "插件标签文字",
    description: "插件关键词标签的独立文字颜色。",
  },
  "semantic-plugin-market-status-text": {
    label: "插件状态图标",
    description: "插件行尾状态图标和紧凑状态文字的颜色。",
  },
  "semantic-composer-surface": {
    label: "输入框背景",
    description: "任务输入区域的专用背景。",
  },
  "semantic-composer-border": {
    label: "输入框边框",
    description: "任务输入区域边线和描边的专用颜色。",
  },
  "semantic-composer-button-surface": {
    label: "按钮背景",
    description: "输入框内部按钮悬停时的填充色。",
  },
  "semantic-composer-button-surface-strong": {
    label: "按钮强调背景",
    description: "输入框内部菜单和控件选中状态的填充色。",
  },
  "semantic-composer-button-text": {
    label: "按钮文字",
    description: "输入框内部按钮悬停时的文字和图标颜色。",
  },
  "semantic-composer-button-text-strong": {
    label: "按钮强调文字",
    description: "输入框内部菜单和控件选中状态的文字与图标颜色。",
  },
  "semantic-composer-icon-button-surface": {
    label: "图标按钮背景",
    description: "输入框内纯图标按钮默认状态的填充色。",
  },
  "semantic-composer-icon-button-surface-hover": {
    label: "图标按钮悬停背景",
    description: "输入框内纯图标按钮悬停和聚焦时的填充色。",
  },
  "semantic-composer-icon-button-text": {
    label: "图标按钮文字",
    description: "输入框内纯图标按钮默认状态的图标颜色。",
  },
  "semantic-composer-icon-button-text-hover": {
    label: "图标按钮悬停文字",
    description: "输入框内纯图标按钮悬停和聚焦时的图标颜色。",
  },
  "focus-outline-color": {
    label: "焦点环",
    description: "全局焦点轮廓颜色。",
  },
  "selection-background": {
    label: "选择背景",
    description: "文本选择和轻量选中状态的背景。",
  },
  "ui-panel": {
    label: "半透明面板",
    description: "默认半透明面板填充色。",
  },
  "ui-panel-subtle": {
    label: "弱化半透明面板",
    description: "低强调半透明面板填充色。",
  },
} satisfies Partial<Record<AppearanceTokenRowID, AppearanceTokenCopy>>

const localizedAppearanceTokenCopy: Record<Exclude<AppLocale, "en-US">, {
  groups: Partial<Record<AppearanceTokenGroupID, AppearanceTokenCopy>>
  rows: Partial<Record<AppearanceTokenRowID, AppearanceTokenCopy>>
}> = {
  "zh-CN": { groups: zhCNTokenGroupCopy, rows: zhCNTokenRowCopy },
  "zh-TW": zhTWAppearanceTokenCopy,
  "ja-JP": jaJPAppearanceTokenCopy,
  "ko-KR": koKRAppearanceTokenCopy,
  "pt-BR": ptBRAppearanceTokenCopy,
  "es-419": es419AppearanceTokenCopy,
  "de-DE": deDEAppearanceTokenCopy,
  "fr-FR": frFRAppearanceTokenCopy,
  "id-ID": idIDAppearanceTokenCopy,
  "it-IT": itITAppearanceTokenCopy,
  "pl-PL": plPLAppearanceTokenCopy,
  "tr-TR": trTRAppearanceTokenCopy,
  "vi-VN": viVNAppearanceTokenCopy,
}

function mergeAppearanceTokenCopy(fallback: AppearanceTokenCopy, copy?: AppearanceTokenCopy): AppearanceTokenCopy {
  return {
    label: copy?.label ?? fallback.label,
    description: copy?.description ?? fallback.description,
  }
}

export function getAppearanceTokenGroupCopy(locale: AppLocale, group: AppearanceTokenGroup): AppearanceTokenCopy {
  if (locale === "en-US") return group
  return mergeAppearanceTokenCopy(group, localizedAppearanceTokenCopy[locale].groups[group.id as AppearanceTokenGroupID])
}

export function getAppearanceTokenRowCopy(locale: AppLocale, row: AppearanceTokenRow): AppearanceTokenCopy {
  if (locale === "en-US") return row
  return mergeAppearanceTokenCopy(row, localizedAppearanceTokenCopy[locale].rows[row.id as AppearanceTokenRowID])
}
