const root = document.documentElement;
const themeToggle = document.querySelector("#themeToggle");
const menuButton = document.querySelector("#menuButton");
const floatingMenu = document.querySelector("#floatingMenu");
const skillSearch = document.querySelector("#skillSearch");
const skillMenuItems = Array.from(document.querySelectorAll(".canvas-menu-item"));
const canvasSelects = Array.from(document.querySelectorAll("[data-select]"));
const dialogButton = document.querySelector("#dialogButton");
const dialogBackdrop = document.querySelector("#dialogBackdrop");
const closeDialog = document.querySelector("#closeDialog");
const cancelDialog = document.querySelector("#cancelDialog");
const confirmDialog = document.querySelector("#confirmDialog");
const toastButton = document.querySelector("#toastButton");
const toastStack = document.querySelector("#toastStack");

themeToggle.addEventListener("click", () => {
  const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = nextTheme;
});

function closeCanvasSelects(exceptSelect = null) {
  for (const select of canvasSelects) {
    if (select === exceptSelect) continue;
    select.classList.remove("is-open");
    select.querySelector(".canvas-select-trigger")?.setAttribute("aria-expanded", "false");
  }
}

menuButton.addEventListener("click", () => {
  const isOpen = floatingMenu.classList.toggle("is-open");
  floatingMenu.setAttribute("aria-hidden", String(!isOpen));
  menuButton.setAttribute("aria-expanded", String(isOpen));
  closeCanvasSelects();
  if (isOpen) {
    skillSearch.focus();
  }
});

document.addEventListener("click", (event) => {
  if (!floatingMenu.contains(event.target) && !menuButton.contains(event.target)) {
    floatingMenu.classList.remove("is-open");
    floatingMenu.setAttribute("aria-hidden", "true");
    menuButton.setAttribute("aria-expanded", "false");
  }
  if (!event.target.closest("[data-select]")) {
    closeCanvasSelects();
  }
});

for (const select of canvasSelects) {
  const trigger = select.querySelector(".canvas-select-trigger");
  const value = select.querySelector("[data-select-value]");
  const options = Array.from(select.querySelectorAll(".canvas-select-option"));

  trigger.addEventListener("click", () => {
    const isOpen = !select.classList.contains("is-open");
    closeCanvasSelects(select);
    floatingMenu.classList.remove("is-open");
    floatingMenu.setAttribute("aria-hidden", "true");
    menuButton.setAttribute("aria-expanded", "false");
    select.classList.toggle("is-open", isOpen);
    trigger.setAttribute("aria-expanded", String(isOpen));
  });

  for (const option of options) {
    option.addEventListener("click", () => {
      value.textContent = option.textContent.trim();
      for (const item of options) {
        const selected = item === option;
        item.classList.toggle("is-selected", selected);
        item.setAttribute("aria-selected", String(selected));
      }
      select.classList.remove("is-open");
      trigger.setAttribute("aria-expanded", "false");
      trigger.focus();
    });
  }
}

skillSearch.addEventListener("input", () => {
  const query = skillSearch.value.trim().toLowerCase();
  for (const item of skillMenuItems) {
    const matches = item.textContent.toLowerCase().includes(query);
    item.hidden = !matches;
  }
});

for (const item of skillMenuItems) {
  item.addEventListener("click", () => {
    floatingMenu.classList.remove("is-open");
    floatingMenu.setAttribute("aria-hidden", "true");
    menuButton.setAttribute("aria-expanded", "false");
    skillSearch.value = "";
    for (const option of skillMenuItems) {
      option.hidden = false;
      option.setAttribute("aria-selected", String(option === item));
    }
    showToast("技能已选择", item.textContent.trim());
    menuButton.focus();
  });
}

function openDialog() {
  dialogBackdrop.classList.add("is-open");
  dialogBackdrop.setAttribute("aria-hidden", "false");
  closeDialog.focus();
}

function closeDialogPanel() {
  dialogBackdrop.classList.remove("is-open");
  dialogBackdrop.setAttribute("aria-hidden", "true");
  dialogButton.focus();
}

dialogButton.addEventListener("click", openDialog);
closeDialog.addEventListener("click", closeDialogPanel);
cancelDialog.addEventListener("click", closeDialogPanel);
confirmDialog.addEventListener("click", () => {
  closeDialogPanel();
  showToast("配置已应用", "预览、插件状态和 token 快照已刷新。");
});

dialogBackdrop.addEventListener("click", (event) => {
  if (event.target === dialogBackdrop) {
    closeDialogPanel();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    floatingMenu.classList.remove("is-open");
    floatingMenu.setAttribute("aria-hidden", "true");
    menuButton.setAttribute("aria-expanded", "false");
    closeCanvasSelects();
    if (dialogBackdrop.classList.contains("is-open")) {
      closeDialogPanel();
    }
  }
});

function showToast(title, message) {
  const toast = document.createElement("section");
  toast.className = "toast";
  toast.innerHTML = `<strong>${title}</strong><span>${message}</span>`;
  toastStack.append(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

toastButton.addEventListener("click", () => {
  showToast("操作已完成", "这是一个短反馈，不会挤占主界面。");
});
