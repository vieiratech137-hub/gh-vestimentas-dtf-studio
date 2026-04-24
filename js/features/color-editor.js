import { bindDropzone } from "../utils/upload-zone.js";
import { loadImageFromSource, getBaseName, revokeIfObjectUrl } from "../utils/files.js";
import { createElement, clearChildren, setFeedback } from "../utils/dom.js";
import { detectDominantColors, applyPaletteReplacement, hexToRgb } from "../utils/colors.js";
import { canvasToBlob, createCanvas } from "../utils/canvas.js";
import { downloadBlob } from "../utils/download.js";

const MAX_WORKING_SIDE = 1800;

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

  const state = {
    fileName: "",
    sourceUrl: "",
    workingCanvas: null,
    originalImageData: null,
    editedCanvas: null,
    palette: [],
    replacements: [],
    tolerance: Number(toleranceRange.value),
    activeIndex: 0
  };

  let renderFrame = 0;

  bindDropzone({
    zone: dropzone,
    input: uploadInput,
    onFiles: ([file]) => loadImage(file)
  });

  toleranceRange.addEventListener("input", () => {
    state.tolerance = Number(toleranceRange.value);
    toleranceValue.textContent = toleranceRange.value;
    scheduleResultRender();
  });

  colorPicker.addEventListener("input", () => {
    if (!state.palette.length) {
      return;
    }

    state.replacements[state.activeIndex] = colorPicker.value.toUpperCase();
    renderPalette();
    scheduleResultRender();
  });

  resetButton.addEventListener("click", () => {
    if (!state.palette.length) {
      return;
    }

    state.replacements = state.palette.map((entry) => entry.hex);
    renderPalette();
    scheduleResultRender();
    setFeedback(status, "A paleta original foi restaurada.", "success");
  });

  downloadButton.addEventListener("click", async () => {
    if (!state.editedCanvas) {
      return;
    }

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

  async function loadImage(file) {
    try {
      revokeIfObjectUrl(state.sourceUrl);

      const image = await loadImageFromSource(file);
      state.sourceUrl = image.dataset.temporaryUrl || image.src;
      state.fileName = getBaseName(file.name);

      // O editor usa uma cópia reduzida para manter a interação rápida em imagens maiores.
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      const scale = Math.min(1, MAX_WORKING_SIDE / Math.max(width, height));
      const workingCanvas = createCanvas(width * scale, height * scale);
      const workingContext = workingCanvas.getContext("2d", { willReadFrequently: true });
      workingContext.drawImage(image, 0, 0, workingCanvas.width, workingCanvas.height);

      state.workingCanvas = workingCanvas;
      state.originalImageData = workingContext.getImageData(0, 0, workingCanvas.width, workingCanvas.height);
      state.palette = detectDominantColors(workingCanvas, 6);
      state.replacements = state.palette.map((entry) => entry.hex);
      state.activeIndex = 0;
      downloadButton.disabled = false;

      renderOriginal();
      renderPalette();
      renderEdited();

      paletteCaption.textContent = `${state.palette.length} cores detectadas`;
      setFeedback(
        status,
        "Paleta detectada. Ao trocar uma cor, o editor agora tenta puxar as tonalidades relacionadas para manter luz e sombra.",
        "success"
      );
    } catch (error) {
      setFeedback(status, `Não foi possível carregar esta imagem: ${error.message}`, "error");
    }
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

  function scheduleResultRender() {
    if (renderFrame) {
      return;
    }

    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      renderEdited();
    });
  }

  function renderEdited() {
    if (!state.originalImageData) {
      return;
    }

    // A troca de cor usa a distância da cor original e preserva parte da luminosidade do pixel.
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
}
