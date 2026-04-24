import { bindDropzone } from "../utils/upload-zone.js";
import { loadImageFromSource, getBaseName } from "../utils/files.js";
import { createElement, clearChildren, setFeedback } from "../utils/dom.js";
import { detectDominantColors, applyPaletteReplacement, hexToRgb } from "../utils/colors.js";
import { canvasToBlob, createCanvas } from "../utils/canvas.js";
import { downloadBlob } from "../utils/download.js";
import { setWorkspaceAsset, subscribeWorkspace } from "../utils/workspace.js";

const MAX_WORKING_SIDE = 2200;
const EDITOR_PALETTE_SIZE = 8;

export function initColorEditor() {
  const uploadInput = document.getElementById("editor-upload");
  const dropzone = document.getElementById("editor-dropzone");
  const paletteGrid = document.getElementById("color-palette");
  const paletteCaption = document.getElementById("palette-caption");
  const colorPicker = document.getElementById("color-picker");
  const toleranceRange = document.getElementById("color-tolerance");
  const toleranceValue = document.getElementById("color-tolerance-value");
  const originalCanvas = document.getElementById("editor-original-canvas");
  const resultCanvas = document.getElementById("editor-result-canvas");
  const resetButton = document.getElementById("color-reset-button");
  const downloadButton = document.getElementById("color-download-button");
  const status = document.getElementById("editor-status");

  const editorSessionId =
    globalThis.crypto?.randomUUID?.() || `editor-${Math.random().toString(36).slice(2)}`;

  const state = {
    fileName: "",
    linkedBatchItemId: "",
    workingCanvas: null,
    originalImageData: null,
    editedCanvas: null,
    palette: [],
    replacements: [],
    tolerance: Number(toleranceRange.value),
    activeIndex: 0,
    lastWorkspaceVersion: 0,
    loadSequence: 0,
    publishTimer: 0,
    publishSequence: 0,
    lastPublishedRevision: 0,
    shouldPublishAfterRender: false
  };

  let renderFrame = 0;

  bindDropzone({
    zone: dropzone,
    input: uploadInput,
    onFiles: ([file]) => {
      setWorkspaceAsset({
        blob: file,
        fileName: getBaseName(file.name),
        sourceTool: "editor",
        linkedBatchItemId: "",
        meta: {
          origin: "upload",
          editorSessionId
        }
      });
    }
  });

  subscribeWorkspace(handleWorkspaceAsset);

  toleranceRange.addEventListener("input", () => {
    state.tolerance = Number(toleranceRange.value);
    toleranceValue.textContent = toleranceRange.value;
    scheduleResultRender(true);
  });

  colorPicker.addEventListener("input", () => {
    if (!state.palette.length) {
      return;
    }

    state.replacements[state.activeIndex] = colorPicker.value.toUpperCase();
    renderPalette();
    scheduleResultRender(true);
  });

  resetButton.addEventListener("click", () => {
    if (!state.palette.length) {
      return;
    }

    state.replacements = state.palette.map((entry) => entry.hex);
    renderPalette();
    scheduleResultRender(true);
    setFeedback(status, "A paleta original foi restaurada.", "success");
  });

  downloadButton.addEventListener("click", async () => {
    if (!state.editedCanvas) {
      return;
    }

    await flushWorkspacePublish();
    const blob = await canvasToBlob(state.editedCanvas, "image/png");
    downloadBlob(blob, `${state.fileName || "arte"}-editada.png`);
  });

  paletteGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-swatch-index]");
    if (!button) {
      return;
    }

    state.activeIndex = Number(button.dataset.swatchIndex);
    colorPicker.value = state.replacements[state.activeIndex];
    renderPalette();
    colorPicker.click();
  });

  async function handleWorkspaceAsset(asset) {
    if (!asset || asset.version === state.lastWorkspaceVersion) {
      return;
    }

    if (
      asset.meta?.editorSessionId === editorSessionId &&
      asset.meta?.editorRevision === state.lastPublishedRevision
    ) {
      state.lastWorkspaceVersion = asset.version;
      return;
    }

    state.lastWorkspaceVersion = asset.version;

    try {
      const loadId = ++state.loadSequence;
      await loadWorkspaceImage(asset, loadId);

      const message =
        asset.sourceTool === "batch"
          ? "Imagem sincronizada do removedor de fundo. As cores detectadas ja consideram a nova arte."
          : asset.sourceTool === "exporter"
            ? "Imagem recebida da area de exportacao. Agora ela ja pode ser recolorida aqui."
            : "Imagem carregada no editor. Ao trocar uma cor, o app tenta preservar luz, sombra e textura.";

      setFeedback(status, message, "success");
    } catch (error) {
      setFeedback(status, `Nao foi possivel carregar esta imagem: ${error.message}`, "error");
    }
  }

  async function loadWorkspaceImage(asset, loadId) {
    const image = await loadImageFromSource(asset.url);
    if (loadId !== state.loadSequence) {
      return;
    }

    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const scale = Math.min(1, MAX_WORKING_SIDE / Math.max(width, height));
    const workingCanvas = createCanvas(width * scale, height * scale);
    const workingContext = workingCanvas.getContext("2d", { willReadFrequently: true });
    workingContext.drawImage(image, 0, 0, workingCanvas.width, workingCanvas.height);

    state.fileName = asset.fileName || "arte";
    state.linkedBatchItemId = asset.linkedBatchItemId || "";
    state.workingCanvas = workingCanvas;
    state.originalImageData = workingContext.getImageData(0, 0, workingCanvas.width, workingCanvas.height);
    state.palette = detectDominantColors(workingCanvas, EDITOR_PALETTE_SIZE);
    state.replacements = state.palette.map((entry) => entry.hex);
    state.activeIndex = 0;
    downloadButton.disabled = false;

    renderOriginal();
    renderPalette();
    renderEdited();

    paletteCaption.textContent = state.palette.length
      ? `${state.palette.length} cores detectadas`
      : "Nao foi possivel detectar a paleta";
  }

  function renderOriginal() {
    if (!state.workingCanvas) {
      return;
    }

    originalCanvas.width = state.workingCanvas.width;
    originalCanvas.height = state.workingCanvas.height;
    originalCanvas.getContext("2d").drawImage(state.workingCanvas, 0, 0);
  }

  function renderPalette() {
    clearChildren(paletteGrid);

    if (!state.palette.length) {
      paletteGrid.append(
        createElement("div", {
          className: "empty-state empty-state--compact",
          text: "As cores principais aparecem aqui."
        })
      );
      return;
    }

    state.palette.forEach((entry, index) => {
      const button = createElement("button", {
        className: `swatch-button ${state.activeIndex === index ? "is-active" : ""}`.trim(),
        attrs: { type: "button" },
        dataset: { swatchIndex: index }
      });
      const chip = createElement("span", { className: "swatch-chip" });
      chip.style.background = state.replacements[index];

      const code = createElement("span", {
        className: "swatch-code",
        text: state.replacements[index]
      });

      button.append(chip, code);
      paletteGrid.append(button);
    });
  }

  function scheduleResultRender(publishAfter = false) {
    if (publishAfter) {
      state.shouldPublishAfterRender = true;
    }

    if (renderFrame) {
      return;
    }

    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      renderEdited();

      if (state.shouldPublishAfterRender) {
        state.shouldPublishAfterRender = false;
        queueWorkspacePublish();
      }
    });
  }

  function renderEdited() {
    if (!state.originalImageData) {
      return;
    }

    const mappings = state.palette.map((entry, index) => ({
      from: entry.rgb,
      to: hexToRgb(state.replacements[index] || entry.hex)
    }));

    const edited = applyPaletteReplacement(state.originalImageData, mappings, state.tolerance);
    const editedCanvas = createCanvas(edited.width, edited.height);
    editedCanvas.getContext("2d").putImageData(edited, 0, 0);

    resultCanvas.width = edited.width;
    resultCanvas.height = edited.height;
    resultCanvas.getContext("2d").putImageData(edited, 0, 0);

    state.editedCanvas = editedCanvas;
  }

  function queueWorkspacePublish() {
    if (!state.editedCanvas || !state.fileName) {
      return;
    }

    window.clearTimeout(state.publishTimer);
    state.publishTimer = window.setTimeout(() => {
      publishEditedWorkspace().catch((error) => {
        setFeedback(status, `Falha ao sincronizar a arte editada: ${error.message}`, "warning");
      });
    }, 140);
  }

  async function flushWorkspacePublish() {
    if (!state.editedCanvas) {
      return;
    }

    if (state.publishTimer) {
      window.clearTimeout(state.publishTimer);
      state.publishTimer = 0;
      await publishEditedWorkspace();
    }
  }

  async function publishEditedWorkspace() {
    if (!state.editedCanvas) {
      return;
    }

    state.publishTimer = 0;
    const revision = ++state.publishSequence;
    const blob = await canvasToBlob(state.editedCanvas, "image/png");

    if (revision !== state.publishSequence) {
      return;
    }

    state.lastPublishedRevision = revision;
    setWorkspaceAsset({
      blob,
      fileName: state.fileName,
      sourceTool: "editor",
      linkedBatchItemId: state.linkedBatchItemId,
      meta: {
        origin: "editor-sync",
        editorSessionId,
        editorRevision: revision
      }
    });
  }
}
