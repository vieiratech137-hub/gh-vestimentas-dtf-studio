import {
  removeBackgroundLocally,
  getBackgroundRemovalRuntime
} from "../utils/background-removal.js";
import { detectDominantColors } from "../utils/colors.js";
import { createElement, clearChildren, setFeedback } from "../utils/dom.js";
import { bindDropzone } from "../utils/upload-zone.js";
import { downloadBlob, formatBytes } from "../utils/download.js";
import { getBaseName, revokeIfObjectUrl, loadImageFromSource } from "../utils/files.js";
import {
  getWorkspaceAsset,
  setWorkspaceAsset,
  subscribeWorkspace
} from "../utils/workspace.js";

const BATCH_PALETTE_SIZE = 8;

export function initBatchRemoval() {
  const uploadInput = document.getElementById("batch-upload");
  const dropzone = document.getElementById("batch-dropzone");
  const runButton = document.getElementById("batch-run-button");
  const downloadButton = document.getElementById("batch-download-button");
  const fastModeCheckbox = document.getElementById("batch-fast-mode");
  const status = document.getElementById("batch-status");
  const grid = document.getElementById("batch-preview-grid");

  const state = {
    items: [],
    processing: false,
    counter: 0,
    lastWorkspaceVersion: 0
  };

  let renderFrame = 0;

  bindDropzone({
    zone: dropzone,
    input: uploadInput,
    onFiles: addFiles
  });

  subscribeWorkspace(handleWorkspaceAsset);

  runButton.addEventListener("click", runBatchRemoval);
  downloadButton.addEventListener("click", downloadAllPngs);

  grid.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-batch-action]");
    if (!trigger) {
      return;
    }

    const item = state.items.find((entry) => entry.id === trigger.dataset.batchId);
    if (!item) {
      return;
    }

    if (trigger.dataset.batchAction === "remove") {
      cleanupProcessedResult(item);
      revokeIfObjectUrl(item.originalUrl);
      state.items = state.items.filter((entry) => entry.id !== item.id);
      render();
      syncButtons();

      if (!state.items.length) {
        setFeedback(status, "Adicione as imagens para montar a fila de processamento.");
      }
      return;
    }

    if (trigger.dataset.batchAction === "share") {
      syncItemToWorkspace(item, {
        useProcessed: Boolean(item.processedBlob),
        silent: false
      });
      scheduleRender();
      return;
    }

    if (trigger.dataset.batchAction === "select-color") {
      const nextHex =
        item.selectedBackgroundHex === trigger.dataset.colorHex ? "" : trigger.dataset.colorHex;
      item.selectedBackgroundHex = nextHex;
      cleanupProcessedResult(item);
      item.status = "pending";
      item.progress = 0;
      item.error = "";
      item.processedSummary = nextHex
        ? `Cor de fundo escolhida: ${nextHex}. Clique em remover fundo para aplicar.`
        : "";
      render();
      syncButtons();
    }
  });

  function handleWorkspaceAsset(asset) {
    if (!asset || asset.version === state.lastWorkspaceVersion) {
      return;
    }

    state.lastWorkspaceVersion = asset.version;

    if (!asset.linkedBatchItemId || asset.sourceTool === "batch") {
      scheduleRender();
      return;
    }

    const item = state.items.find((entry) => entry.id === asset.linkedBatchItemId);
    if (!item) {
      scheduleRender();
      return;
    }

    cleanupProcessedResult(item);
    item.processedBlob = asset.blob;
    item.processedUrl = URL.createObjectURL(asset.blob);
    item.processedSummary =
      asset.sourceTool === "editor"
        ? "Atualizada pelo editor de cores e pronta para download."
        : "Arte compartilhada atualizada e pronta para continuar o fluxo.";
    item.status = "done";
    item.progress = 100;
    item.error = "";
    scheduleRender();
    syncButtons();
  }

  function cleanupProcessedResult(item) {
    revokeIfObjectUrl(item.processedUrl);
    item.processedUrl = "";
    item.processedBlob = null;
  }

  function syncItemToWorkspace(item, options = {}) {
    const { useProcessed = true, silent = false } = options;
    const sharedBlob = useProcessed && item.processedBlob ? item.processedBlob : item.file;

    setWorkspaceAsset({
      blob: sharedBlob,
      fileName: getBaseName(item.file.name),
      sourceTool: "batch",
      linkedBatchItemId: item.id,
      meta: {
        origin: useProcessed && item.processedBlob ? "processed-item" : "original-item"
      }
    });

    if (!silent) {
      setFeedback(
        status,
        `${item.file.name} agora esta sincronizada com o editor de cores e com a exportacao.`,
        "success"
      );
    }
  }

  function addFiles(files) {
    let lastAdded = null;

    files.forEach((file) => {
      const id = `batch-${state.counter++}`;
      const item = {
        id,
        file,
        originalUrl: URL.createObjectURL(file),
        processedUrl: "",
        processedBlob: null,
        processedSummary: "",
        palette: [],
        paletteLoading: true,
        selectedBackgroundHex: "",
        status: "pending",
        progress: 0,
        error: ""
      };

      state.items.push(item);
      lastAdded = item;
      analyzePalette(item);
    });

    if (lastAdded) {
      syncItemToWorkspace(lastAdded, { useProcessed: false, silent: true });
    }

    setFeedback(
      status,
      `${state.items.length} arquivo(s) na fila. A ultima imagem enviada ja pode seguir para o editor de cores e para a exportacao.`,
      "neutral"
    );
    render();
    syncButtons();
  }

  async function analyzePalette(item) {
    try {
      const image = await loadImageFromSource(item.originalUrl);
      item.palette = detectDominantColors(image, BATCH_PALETTE_SIZE);
    } catch (error) {
      item.palette = [];
    } finally {
      item.paletteLoading = false;
      scheduleRender();
    }
  }

  function scheduleRender() {
    if (renderFrame) {
      return;
    }

    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      render();
    });
  }

  function syncButtons() {
    runButton.disabled = !state.items.length || state.processing;
    downloadButton.disabled = !state.items.some((item) => item.processedBlob) || state.processing;
  }

  function createPaletteSection(item) {
    const wrap = createElement("div", { className: "batch-palette" });
    const head = createElement("div", { className: "batch-palette__head" });
    const title = createElement("strong", { text: "Cor para remover" });
    const hint = createElement("span", {
      text: item.selectedBackgroundHex || "Nenhuma selecionada"
    });
    head.append(title, hint);

    const swatches = createElement("div", { className: "batch-palette__swatches" });

    if (item.paletteLoading) {
      swatches.append(
        createElement("span", {
          className: "batch-palette__caption",
          text: "Detectando cores..."
        })
      );
      wrap.append(head, swatches);
      return wrap;
    }

    if (!item.palette.length) {
      swatches.append(
        createElement("span", {
          className: "batch-palette__caption",
          text: "Nao foi possivel detectar as cores principais."
        })
      );
      wrap.append(head, swatches);
      return wrap;
    }

    item.palette.forEach((color) => {
      const isSelected = item.selectedBackgroundHex === color.hex;
      const button = createElement("button", {
        className: `batch-color-chip ${isSelected ? "is-selected" : ""}`.trim(),
        attrs: {
          type: "button",
          title: `Usar ${color.hex} como fundo`
        },
        dataset: {
          batchAction: "select-color",
          batchId: item.id,
          colorHex: color.hex
        }
      });

      const swatch = createElement("span", { className: "batch-color-chip__swatch" });
      swatch.style.background = color.hex;
      const code = createElement("span", {
        className: "batch-color-chip__code",
        text: color.hex
      });

      button.append(swatch, code);
      swatches.append(button);
    });

    wrap.append(head, swatches);
    return wrap;
  }

  function render() {
    clearChildren(grid);

    if (!state.items.length) {
      grid.append(
        createElement("div", {
          className: "empty-state",
          html: "<strong>Nenhuma imagem carregada</strong><span>O preview aparece aqui assim que o upload for feito.</span>"
        })
      );
      return;
    }

    const workspaceAsset = getWorkspaceAsset();

    state.items.forEach((item) => {
      const isShared = workspaceAsset?.linkedBatchItemId === item.id;
      const card = createElement("article", {
        className: `preview-card ${isShared ? "is-shared" : ""}`.trim()
      });
      const thumb = createElement("div", { className: "preview-card__thumb checkerboard" });
      const image = createElement("img", {
        attrs: {
          src: item.processedUrl || item.originalUrl,
          alt: `Preview de ${item.file.name}`
        }
      });

      const body = createElement("div", { className: "preview-card__body" });
      const title = createElement("div", { className: "preview-card__title", text: item.file.name });
      const meta = createElement("div", { className: "preview-card__meta" });
      const size = createElement("span", {
        className: "mono",
        text: formatBytes(item.file.size)
      });
      const pill = createElement("span", {
        className: "status-pill",
        text:
          item.status === "done"
            ? "Pronto"
            : item.status === "working"
              ? "Processando"
              : item.status === "error"
                ? "Erro"
                : "Na fila",
        attrs: { "data-tone": item.status }
      });
      const progress = createElement("div", { className: "progress-track" });
      const progressFill = createElement("span");
      progressFill.style.width = `${item.progress || 0}%`;

      const actions = createElement("div", { className: "preview-card__actions" });
      const downloadLink = createElement("a", {
        className: "preview-link",
        text: item.processedBlob ? "Baixar PNG" : "Aguardando resultado",
        attrs: {
          href: item.processedUrl || "#",
          download: item.processedBlob ? `${getBaseName(item.file.name)}-transparent.png` : undefined
        }
      });

      if (!item.processedBlob) {
        downloadLink.removeAttribute("href");
      }

      const shareButton = createElement("button", {
        className: `inline-btn ${isShared ? "is-active" : ""}`.trim(),
        text: isShared ? "Arte atual" : "Usar nas outras",
        attrs: {
          type: "button",
          disabled: isShared ? "disabled" : undefined
        },
        dataset: {
          batchAction: "share",
          batchId: item.id
        }
      });

      const removeButton = createElement("button", {
        className: "inline-btn",
        text: "Remover",
        attrs: { type: "button" },
        dataset: {
          batchAction: "remove",
          batchId: item.id
        }
      });

      const detail = createElement("div", {
        className: "mono",
        text:
          item.error ||
          item.processedSummary ||
          (item.processedBlob
            ? "Fundo transparente gerado."
            : isShared
              ? "Imagem atual compartilhada com as outras ferramentas."
              : "Pronto para processar.")
      });
      detail.style.color = item.error ? "var(--danger)" : "var(--muted)";
      detail.style.fontSize = "0.78rem";

      progress.append(progressFill);
      meta.append(size, pill);
      actions.append(downloadLink, shareButton, removeButton);
      thumb.append(image);
      body.append(title, meta, createPaletteSection(item), progress, detail, actions);
      card.append(thumb, body);
      grid.append(card);
    });
  }

  async function runBatchRemoval() {
    if (!state.items.length || state.processing) {
      return;
    }

    state.processing = true;
    syncButtons();

    const runtime = await getBackgroundRemovalRuntime();
    const fastModeEnabled = fastModeCheckbox.checked;
    const hasColorSelections = state.items.some((item) => item.selectedBackgroundHex);

    setFeedback(
      status,
      hasColorSelections
        ? "As imagens com cor marcada vao remover apenas essa cor do fundo. As demais seguem no modo automatico."
        : fastModeEnabled
          ? `Modo rapido ativo em ${runtime.label}. Sem cor marcada, o app usa deteccao automatica.`
          : `Processamento em ${runtime.label} com resolucao original. Sem cor marcada, o app usa deteccao automatica.`,
      "warning"
    );

    let completed = 0;
    const queue = state.items.filter((item) => !item.processedBlob);

    for (const item of queue) {
      item.status = "working";
      item.progress = 8;
      item.error = "";
      if (!item.selectedBackgroundHex) {
        item.processedSummary = "";
      }
      scheduleRender();

      try {
        const result = await removeBackgroundLocally(
          item.file,
          (progressInfo) => {
            item.progress = progressInfo.percent || item.progress;
            scheduleRender();
          },
          {
            fastMode: fastModeEnabled,
            selectedBackgroundHex: item.selectedBackgroundHex || ""
          }
        );

        cleanupProcessedResult(item);
        item.processedBlob = result.blob;
        item.processedUrl = URL.createObjectURL(result.blob);
        item.processedSummary = result.meta.summary;
        item.status = "done";
        item.progress = 100;
        completed += 1;

        if (queue.length === 1 || getWorkspaceAsset()?.linkedBatchItemId === item.id) {
          syncItemToWorkspace(item, { silent: true });
        }

        setFeedback(
          status,
          `Processando imagens: ${completed}/${queue.length} concluida(s).`,
          "success"
        );
      } catch (error) {
        item.status = "error";
        item.progress = 0;
        item.error = error.message || "Falha ao remover o fundo desta imagem.";
        setFeedback(
          status,
          "Algumas imagens falharam no processamento. Confira a fila para ver os detalhes.",
          "warning"
        );
      }

      scheduleRender();
    }

    state.processing = false;
    syncButtons();

    const readyCount = state.items.filter((item) => item.processedBlob).length;
    if (readyCount) {
      setFeedback(
        status,
        `${readyCount} imagem(ns) com fundo removido. O botao baixa cada PNG separadamente, um por um.`,
        "success"
      );
    }
  }

  async function downloadAllPngs() {
    const readyItems = state.items.filter((item) => item.processedBlob);
    if (!readyItems.length) {
      return;
    }

    downloadButton.disabled = true;
    setFeedback(status, "Iniciando o download individual dos PNGs transparentes...");

    try {
      for (const [index, item] of readyItems.entries()) {
        downloadBlob(item.processedBlob, `${getBaseName(item.file.name)}-transparent.png`);
        setFeedback(
          status,
          `Baixando arquivos: ${index + 1}/${readyItems.length}.`,
          "success"
        );
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
    } catch (error) {
      setFeedback(status, `Falha ao baixar os arquivos: ${error.message}`, "error");
    } finally {
      syncButtons();
    }
  }
}
