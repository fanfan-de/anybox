import { app, Menu, type MenuItemConstructorOptions } from "electron"
import type { AppLocale } from "../shared/locale"
import type { MenuKey } from "./types"

export interface ApplicationMenuOptions {
  onCheckForUpdates?: () => void
}

export interface ApplicationMenus {
  applicationMenu: Menu
  popupMenus: Record<MenuKey, Menu>
}

const menuLabels = {
  "zh-CN": {
    about: "关于 Anybox Desktop",
    checkForUpdates: "检查更新...",
    edit: "编辑",
    file: "文件",
    help: "帮助",
    view: "视图",
    window: "窗口",
  },
  "zh-TW": {
    about: "關於 Anybox Desktop",
    checkForUpdates: "檢查更新...",
    edit: "編輯",
    file: "檔案",
    help: "說明",
    view: "檢視",
    window: "視窗",
  },
  "en-US": {
    about: "About Anybox Desktop",
    checkForUpdates: "Check for Updates...",
    edit: "Edit",
    file: "File",
    help: "Help",
    view: "View",
    window: "Window",
  },
  "ja-JP": {
    about: "Anybox Desktop について",
    checkForUpdates: "アップデートを確認...",
    edit: "編集",
    file: "ファイル",
    help: "ヘルプ",
    view: "表示",
    window: "ウインドウ",
  },
  "ko-KR": {
    about: "Anybox Desktop 정보",
    checkForUpdates: "업데이트 확인...",
    edit: "편집",
    file: "파일",
    help: "도움말",
    view: "보기",
    window: "창",
  },
  "pt-BR": {
    about: "Sobre o Anybox Desktop",
    checkForUpdates: "Verificar atualizações...",
    edit: "Editar",
    file: "Arquivo",
    help: "Ajuda",
    view: "Exibir",
    window: "Janela",
  },
  "es-419": {
    about: "Acerca de Anybox Desktop",
    checkForUpdates: "Buscar actualizaciones...",
    edit: "Editar",
    file: "Archivo",
    help: "Ayuda",
    view: "Ver",
    window: "Ventana",
  },
  "de-DE": {
    about: "Über Anybox Desktop",
    checkForUpdates: "Nach Updates suchen...",
    edit: "Bearbeiten",
    file: "Datei",
    help: "Hilfe",
    view: "Ansicht",
    window: "Fenster",
  },
  "fr-FR": {
    about: "À propos de Anybox Desktop",
    checkForUpdates: "Rechercher des mises à jour...",
    edit: "Édition",
    file: "Fichier",
    help: "Aide",
    view: "Affichage",
    window: "Fenêtre",
  },
  "id-ID": {
    about: "Tentang Anybox Desktop",
    checkForUpdates: "Periksa pembaruan...",
    edit: "Edit",
    file: "Berkas",
    help: "Bantuan",
    view: "Tampilan",
    window: "Jendela",
  },
  "it-IT": {
    about: "Informazioni su Anybox Desktop",
    checkForUpdates: "Controlla aggiornamenti...",
    edit: "Modifica",
    file: "File",
    help: "Aiuto",
    view: "Vista",
    window: "Finestra",
  },
  "pl-PL": {
    about: "Anybox Desktop — informacje",
    checkForUpdates: "Sprawdź aktualizacje...",
    edit: "Edycja",
    file: "Plik",
    help: "Pomoc",
    view: "Widok",
    window: "Okno",
  },
  "tr-TR": {
    about: "Anybox Desktop Hakkında",
    checkForUpdates: "Güncellemeleri denetle...",
    edit: "Düzenle",
    file: "Dosya",
    help: "Yardım",
    view: "Görünüm",
    window: "Pencere",
  },
  "vi-VN": {
    about: "Giới thiệu Anybox Desktop",
    checkForUpdates: "Kiểm tra bản cập nhật...",
    edit: "Chỉnh sửa",
    file: "Tệp",
    help: "Trợ giúp",
    view: "Xem",
    window: "Cửa sổ",
  },
} as const satisfies Record<AppLocale, Record<string, string>>

export function createApplicationMenus(locale: AppLocale, options: ApplicationMenuOptions = {}): ApplicationMenus {
  const isMac = process.platform === "darwin"
  const labels = menuLabels[locale]
  const appMenu: MenuItemConstructorOptions[] = [
    { role: "about" },
    { type: "separator" },
    { role: "services" },
    { type: "separator" },
    { role: "hide" },
    { role: "hideOthers" },
    { role: "unhide" },
    { type: "separator" },
    { role: "quit" },
  ]
  const fileMenu: MenuItemConstructorOptions[] = [isMac ? { role: "close" } : { role: "quit" }]
  const editMenu: MenuItemConstructorOptions[] = [
    { role: "undo" },
    { role: "redo" },
    { type: "separator" },
    { role: "cut" },
    { role: "copy" },
    { role: "paste" },
    ...(isMac ? ([{ role: "pasteAndMatchStyle" }, { role: "delete" }, { role: "selectAll" }] as const) : []),
  ]
  const viewMenu: MenuItemConstructorOptions[] = [
    { role: "reload" },
    { role: "forceReload" },
    { role: "toggleDevTools" },
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ]
  const windowMenu: MenuItemConstructorOptions[] = isMac
    ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
    : [{ role: "minimize" }, { role: "close" }]
  const helpMenu: MenuItemConstructorOptions[] = [
    {
      label: labels.checkForUpdates,
      click: () => {
        options.onCheckForUpdates?.()
      },
    },
    { type: "separator" },
    {
      label: labels.about,
      click: () => {
        void app.showAboutPanel()
      },
    },
  ]

  const applicationTemplate: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: appMenu,
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    { label: labels.file, submenu: fileMenu },
    { label: labels.edit, submenu: editMenu },
    { label: labels.view, submenu: viewMenu },
    { label: labels.window, submenu: windowMenu },
    { label: labels.help, submenu: helpMenu },
  ]

  return {
    applicationMenu: Menu.buildFromTemplate(applicationTemplate),
    popupMenus: {
      file: Menu.buildFromTemplate(fileMenu),
      edit: Menu.buildFromTemplate(editMenu),
      view: Menu.buildFromTemplate(viewMenu),
      window: Menu.buildFromTemplate(windowMenu),
      help: Menu.buildFromTemplate(helpMenu),
    } satisfies Record<MenuKey, Menu>,
  }
}
