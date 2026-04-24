import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";
import {
  removeBackgroundLocally,
  getBackgroundRemovalRuntime
} from "../utils/background-removal.js";
import { createElement, clearChildren, setFeedback } from "../utils/dom.js";
import { bindDropzone } from "../utils/upload-zone.js";
import { downloadBlob, formatBytes } from "../utils/download.js";
import { getBaseName, revokeIfObjectUrl } from "../utils/files.js";

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
    counter: 0
  };

  let renderFrame = 0;

  bindDropzone({
    zone: dropzone,
    input: uploadInput,
    onFiles: addFiles
  });

  runButton.addEventListener("click", runBatchRemoval);
  downloadButton.addEventListener("click", downloadZip);

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
      revokeIfObjectUrl(item.originalUrl);
      revokeIfObjectUrl(item.processedUrl);
      state.items = state.items.filter((entry) => entry.id !== item.id);
      render();
      syncButtons();

      if (!state.items.length) {
        setFeedback(status, "Adicione as imagens para montar a fila de processamento.");
      }
    }
  });

  function addFiles(files) {
    files.forEach((file) => {
      const id = `batch-${state.counter++}`;
      state.items.push({
        id,
        file,
        originalUrl: URL.createObjectURL(file),
        processedUrl: "",
        processedBlob: null,
        processedSummary: "",
        status: "pending",
        progress: 0,
        error: ""
      });
    });

    setFeedback(
      status,
      `${state.items.length} arquivo(s) na fila. Clique em "Remover fundo em lote" para começar.`,
      "neutral"
    );
    render();
    syncButtons();
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

    state.items.forEach((item) => {
      const card = createElement("article", { className: "preview-card" });
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
          (item.processedBlob ? "Fundo transparente gerado." : "Pronto para processar.")
      });
      detail.style.color = item.error ? "var(--danger)" : "var(--muted)";
      detail.style.fontSize = "0.78rem";

      progress.append(progressFill);
      meta.append(size, pill);
      actions.append(downloadLink, removeButton);
      thumb.append(image);
      body.append(title, meta, progress, detail, actions);
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

    setFeedback(
      status,
      fastModeEnabled
        ? `Modo rápido ativo em ${runtime.label}. O primeiro arquivo ainda pode baixar o modelo local, mas sem o preload pesado de antes.`
        : `Processamento em ${runtime.label} com resolução original. O primeiro arquivo ainda pode baixar o modelo local.`,
      "warning"
    );

    let completed = 0;
    const queue = state.items.filter((item) => !item.processedBlob);

    for (const item of queue) {
      item.status = "working";
      item.progress = 8;
      item.error = "";
      item.processedSummary = "";
      scheduleRender();

      try {
        const result = await removeBackgroundLocally(
          item.file,
          (progress) => {
            item.progress = progress.percent || item.progress;
            scheduleRender();
          },
          {
            fastMode: fastModeEnabled
          }
        );

        item.processedBlob = result.blob;
        item.processedUrl = URL.createObjectURL(result.blob);
        item.processedSummary = result.meta.summary;
        item.status = "done";
        item.progress = 100;
        completed += 1;

        setFeedback(
          status,
          `Processando imagens: ${completed}/${queue.length} concluída(s).`,
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
        `${readyCount} imagem(ns) com fundo removido. Você já pode baixar tudo em ZIP.`,
        "success"
      );
    }
  }

  async function downloadZip() {
    const readyItems = state.items.filter((item) => item.processedBlob);
    if (!readyItems.length) {
      return;
    }

    downloadButton.disabled = true;
    setFeedback(status, "Compactando PNGs transparentes em um arquivo ZIP...");

    try {
      const zip = new JSZip();

      readyItems.forEach((item) => {
        zip.file(`${getBaseName(item.file.name)}-transparent.png`, item.processedBlob);
      });

      const archive = await zip.generateAsync({ type: "blob" });
      downloadBlob(archive, "dtf-fundos-transparentes.zip");
      setFeedback(status, "ZIP pronto. O download foi iniciado.", "success");
    } catch (error) {
      setFeedback(status, `Falha ao gerar o ZIP: ${error.message}`, "error");
    } finally {
      syncButtons();
    }
  }
}
