import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BrainCircuit,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  CloudCog,
  Code2,
  Copy,
  Download,
  Eye,
  EyeOff,
  Expand,
  FileDiff,
  FileImage,
  FilePlus2,
  FileSearch,
  FileText,
  Film,
  Folder,
  FolderOpen,
  GitCommitHorizontal,
  GitFork,
  GitPullRequest,
  Globe,
  Info,
  LayoutPanelLeft,
  ListTree,
  LoaderCircle,
  MessageSquare,
  MessageCirclePlus,
  Minus,
  Monitor,
  Moon,
  MoreHorizontal,
  Palette,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Pencil,
  Pause,
  Pin,
  Play,
  Plus,
  Puzzle,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Smartphone,
  SortAsc,
  Square,
  Sun,
  Terminal,
  Trash2,
  UploadCloud,
  UserCircle,
  Wrench,
  X,
  type LucideIcon,
  type LucideProps,
} from "lucide-react"

function createIcon(Icon: LucideIcon, defaults: LucideProps = {}) {
  return function AppIcon(props: LucideProps) {
    return <Icon aria-hidden="true" focusable="false" {...defaults} {...props} />
  }
}

export const FolderIcon = createIcon(Folder)
export const BackIcon = createIcon(ArrowLeft)
export const ForwardIcon = createIcon(ArrowRight)
export const ScreenshotIcon = createIcon(Camera)
export const FolderOpenIcon = createIcon(FolderOpen)
export const PaperclipIcon = createIcon(Paperclip)
export const PauseIcon = createIcon(Pause)
export const PinIcon = createIcon(Pin)
export const PlayIcon = createIcon(Play)
export const CopyIcon = createIcon(Copy)
export const DownloadIcon = createIcon(Download)
export const CheckIcon = createIcon(Check)
export const ChevronDownIcon = createIcon(ChevronDown)
export const ChevronRightIcon = createIcon(ChevronRight)
export const ExpandIcon = createIcon(Expand)
export const OpenInEditorIcon = createIcon(Expand)
export const OpenExternalIcon = createIcon(ArrowUpRight)
export const ChangesIcon = createIcon(FileDiff)
export const CommitIcon = createIcon(GitCommitHorizontal)
export const PushIcon = createIcon(UploadCloud)
export const PullRequestIcon = createIcon(GitPullRequest)
export const PreviewIcon = createIcon(Globe)
export const FileSearchIcon = createIcon(FileSearch)
export const FileImageIcon = createIcon(FileImage)
export const FileTextIcon = createIcon(FileText)
export const FileVideoIcon = createIcon(Film)
export const SortIcon = createIcon(SortAsc)
export const NewItemIcon = createIcon(FilePlus2)
export const PlusIcon = createIcon(Plus)
export const ForkIcon = createIcon(GitFork)
export const SettingsIcon = createIcon(Settings)
export const PluginIcon = createIcon(Puzzle)
export const SegmentedControlIcon = createIcon(SlidersHorizontal)
export const LayoutSidebarLeftIcon = createIcon(LayoutPanelLeft)
export const LayoutSidebarRightIcon = createIcon(PanelRight)
export const LeftSidebarIcon = createIcon(PanelLeft)
export const RightSidebarIcon = createIcon(PanelRight)
export const SideChatIcon = createIcon(MessageSquare)
export const CommentAddIcon = createIcon(MessageCirclePlus)
export const SessionTreeIcon = createIcon(ListTree)
export const InfoIcon = createIcon(Info)
export const CodeModeIcon = createIcon(Code2)
export const SessionRunningIcon = createIcon(LoaderCircle)
export const LeftSidebarCollapseIcon = createIcon(PanelLeftClose)
export const LeftSidebarExpandIcon = createIcon(PanelLeftOpen)
export const RightSidebarCollapseIcon = createIcon(PanelRightClose)
export const RightSidebarExpandIcon = createIcon(PanelRightOpen)
export const ConnectedStatusIcon = createIcon(CircleCheck)
export const DisconnectedStatusIcon = createIcon(CircleX)
export const EyeIcon = createIcon(Eye)
export const EyeOffIcon = createIcon(EyeOff)
export const EditIcon = createIcon(Pencil)
export const DeleteIcon = createIcon(Trash2)
export const MoreIcon = createIcon(MoreHorizontal)
export const ArchiveIcon = createIcon(Archive)
export const ArchiveRestoreIcon = createIcon(ArchiveRestore)
export const MinimizeIcon = createIcon(Minus)
export const MaximizeIcon = createIcon(Square)
export function WindowRestoreIcon(props: LucideProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M9 7h8v8h-2" />
      <path d="M7 9h8v8H7z" />
    </svg>
  )
}
export const RestoreIcon = createIcon(Copy)
export const CloseIcon = createIcon(X)
export const TerminalIcon = createIcon(Terminal)
export const ToolsIcon = createIcon(Wrench)
export const AutomationIcon = createIcon(Clock)
export const CalendarIcon = createIcon(CalendarDays)
export const ArrowUpIcon = createIcon(ArrowUp)
export const StopIcon = createIcon(Square, { fill: "currentColor", strokeWidth: 0 })
export const PaletteIcon = createIcon(Palette)
export const ResetIcon = createIcon(RotateCcw)
export const SearchIcon = createIcon(Search)
export const SunIcon = createIcon(Sun)
export const MoonIcon = createIcon(Moon)
export const MonitorIcon = createIcon(Monitor)
export const SmartphoneIcon = createIcon(Smartphone)
export const AccountSettingsIcon = createIcon(UserCircle)
export const GeneralSettingsIcon = createIcon(SlidersHorizontal)
export const ProviderSettingsIcon = createIcon(CloudCog)
export const ModelSettingsIcon = createIcon(BrainCircuit)
