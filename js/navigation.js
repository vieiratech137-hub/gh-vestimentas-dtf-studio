export function initNavigation() {
  const panels = [...document.querySelectorAll(".tool-panel")];
  const launchers = [...document.querySelectorAll("[data-open-panel]")];
  const uploadTriggers = [...document.querySelectorAll("[data-trigger-upload]")];

  function activatePanel(panelId, { scroll = true } = {}) {
    panels.forEach((panel) => {
      const isActive = panel.id === panelId;
      panel.classList.toggle("is-active", isActive);
      panel.hidden = !isActive;
      panel.setAttribute("aria-hidden", String(!isActive));
    });

    launchers.forEach((button) => {
      const isSelected = button.dataset.openPanel === panelId;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
    });

    const targetPanel = document.getElementById(panelId);
    if (scroll && targetPanel) {
      targetPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    if (window.location.hash !== `#${panelId}`) {
      history.replaceState(null, "", `#${panelId}`);
    }
  }

  launchers.forEach((button) => {
    button.addEventListener("click", () => {
      activatePanel(button.dataset.openPanel);
    });
  });

  uploadTriggers.forEach((button) => {
    const input = document.getElementById(button.dataset.triggerUpload);
    button.addEventListener("click", () => {
      input?.click();
    });
  });

  const hashTarget = window.location.hash.replace("#", "");
  const initialPanel = panels.some((panel) => panel.id === hashTarget)
    ? hashTarget
    : panels.find((panel) => panel.classList.contains("is-active"))?.id || panels[0]?.id;

  if (initialPanel) {
    activatePanel(initialPanel, { scroll: false });
  }
}
