import { jsPDF } from "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm";
import { bindDropzone } from "../utils/upload-zone.js";
import { loadImageFromSource, getBaseName } from "../utils/files.js";
import { createElement, clearChildren, clamp, formatNumber, setFeedback } from "../utils/dom.js";
import { createCanvas, drawContainedImage, cmToPixels, canvasToBlob } from "../utils/canvas.js";
import { downloadBlob } from "../utils/download.js";
import { embedPngDpi } from "../utils/png-dpi.js";
import { setWorkspaceAsset, subscribeWorkspace } from "../utils/workspace.js";

export function initExporter() {
  const uploadInput = document.getElementById("export-upload");
  const dropzone = document.getElementById("export-dropzone");
  const formatField = document.getElementById("export-format");
  const widthField = document.getElementById("export-width");
  const heightField = document.getElementById("export-height");
  const dpiField = document.getElementById("export-dpi");
  const mirrorField = document.getElementById("export-mirror");
  const autofitButton = document.getElementById("export-autofit-button");
  const downloadButton = document.getElementById("export-download-button");
  const topRuler = document.getElementById("export-top-ruler");
  const sideRuler = document.getElementById("export-side-ruler");
  const stage = document.getElementById("export-stage");
  const previewCanvas = document.getElementById("export-preview-canvas");
  const summary = document.getElementById("export-summary");
  const status = document.getElementById("export-status");

  const state = {
    image: null,
    fileName: "",
    linkedBatchItemId: "",
    lastWorkspaceVersion: 0,
    loadSequence: 0
  };

  bindDropzone({
    zone: dropzone,
    input: uploadInput,
    onFiles: ([file]) => {
      setWorkspaceAsset({
        blob: file,
        fileName: getBaseName(file.name),
        sourceTool: "exporter",
        linkedBatchItemId: "",
        meta: {
          origin: "upload"
        }
      });
    }
  });

  subscribeWorkspace(handleWorkspaceAsset);

  [formatField, widthField, heightField, dpiField, mirrorField].forEach((field) => {
    field.addEventListener("input", updatePreview);
    field.addEventListener("change", updatePreview);
  });

  autofitButton.addEventListener("click", () => {
    widthField.value = "28";
    heightField.value = "35";
    dpiField.value = "300";
    updatePreview();
    setFeedback(status, "Area de exportacao ajustada para 28 x 35 cm em 300 DPI.", "success");
  });

  downloadButton.addEventListener("click", exportCurrentFile);

  updatePreview();

  async function handleWorkspaceAsset(asset) {
    if (!asset || asset.version === state.lastWorkspaceVersion) {
      return;
    }

    state.lastWorkspaceVersion = asset.version;

    try {
      const loadId = ++state.loadSequence;
      const image = await loadImageFromSource(asset.url);
      if (loadId !== state.loadSequence) {
        return;
      }

      state.image = image;
      state.fileName = asset.fileName || "arte";
      state.linkedBatchItemId = asset.linkedBatchItemId || "";
      downloadButton.disabled = false;
      updatePreview();

      const message =
        asset.sourceTool === "editor"
          ? "Imagem recolorida recebida do editor. A exportacao agora usa essa versao atual."
          : asset.sourceTool === "batch"
            ? "Imagem sincronizada do removedor de fundo. O exportador ja esta usando esse resultado."
            : "Preview atualizado. Voce ja pode exportar o arquivo final.";

      setFeedback(status, message, "success");
    } catch (error) {
      setFeedback(status, `Nao foi possivel carregar esta imagem: ${error.message}`, "error");
    }
  }

  function readSettings() {
    const format = formatField.value;
    const widthCm = clamp(Number(widthField.value) || 28, 1, 500);
    const heightCm = clamp(Number(heightField.value) || 35, 1, 500);
    const requestedDpi = clamp(Number(dpiField.value) || 300, 72, 1200);
    const effectiveDpi = format === "dtf" ? 300 : requestedDpi;

    return {
      format,
      widthCm,
      heightCm,
      requestedDpi,
      effectiveDpi,
      mirror: mirrorField.checked,
      widthPx: cmToPixels(widthCm, effectiveDpi),
      heightPx: cmToPixels(heightCm, effectiveDpi)
    };
  }

  function buildRulerValues(sizeCm) {
    return [
      { position: 0, value: 0 },
      { position: 25, value: sizeCm / 4 },
      { position: 50, value: sizeCm / 2 },
      { position: 75, value: (sizeCm * 3) / 4 },
      { position: 100, value: sizeCm }
    ];
  }

  function updateRuler(element, values, axis) {
    clearChildren(element);

    values.forEach((entry) => {
      const marker = createElement("span", {
        className: `ruler-marker ${
          entry.position === 0 ? "is-start" : entry.position === 100 ? "is-end" : "is-middle"
        }`,
        text: `${formatNumber(entry.value, entry.value % 1 ? 1 : 0)} cm`
      });
      marker.style[axis] = `${entry.position}%`;
      element.append(marker);
    });
  }

  function updatePreview() {
    const settings = readSettings();
    stage.style.aspectRatio = `${settings.widthCm} / ${settings.heightCm}`;

    updateRuler(topRuler, buildRulerValues(settings.widthCm), "left");
    updateRuler(sideRuler, buildRulerValues(settings.heightCm), "top");

    summary.textContent =
      `Area final: ${formatNumber(settings.widthCm, settings.widthCm % 1 ? 1 : 0)} x ` +
      `${formatNumber(settings.heightCm, settings.heightCm % 1 ? 1 : 0)} cm • ` +
      `${settings.effectiveDpi} DPI • ${settings.widthPx} x ${settings.heightPx} px` +
      (settings.mirror ? " • espelhado" : "");

    renderPreviewCanvas(settings);
  }

  function renderPreviewCanvas(settings) {
    const previewWidth = 900;
    const previewHeight = Math.max(320, Math.round((previewWidth * settings.heightCm) / settings.widthCm));
    previewCanvas.width = previewWidth;
    previewCanvas.height = previewHeight;

    const ctx = previewCanvas.getContext("2d");
    ctx.clearRect(0, 0, previewWidth, previewHeight);
    ctx.strokeStyle = "rgba(29, 21, 15, 0.16)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, previewWidth - 2, previewHeight - 2);

    if (state.image) {
      drawContainedImage(ctx, state.image, previewWidth, previewHeight, {
        mirror: settings.mirror
      });
    }
  }

  async function buildOutputCanvas(settings) {
    const canvas = createCanvas(settings.widthPx, settings.heightPx);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (state.image) {
      drawContainedImage(ctx, state.image, canvas.width, canvas.height, {
        mirror: settings.mirror
      });
    }

    return canvas;
  }

  async function exportCurrentFile() {
    if (!state.image) {
      setFeedback(status, "Envie uma imagem antes de exportar.", "warning");
      return;
    }

    const settings = readSettings();
    const outputCanvas = await buildOutputCanvas(settings);

    if (settings.format === "pdf") {
      const pdf = new jsPDF({
        orientation: settings.widthCm > settings.heightCm ? "landscape" : "portrait",
        unit: "mm",
        format: [settings.widthCm * 10, settings.heightCm * 10],
        compress: true
      });

      pdf.addImage(
        outputCanvas.toDataURL("image/png"),
        "PNG",
        0,
        0,
        settings.widthCm * 10,
        settings.heightCm * 10,
        undefined,
        "FAST"
      );
      pdf.save(`${state.fileName || "arte"}-${settings.widthCm}x${settings.heightCm}cm.pdf`);
      setFeedback(status, "PDF gerado com sucesso.", "success");
      return;
    }

    const dpi = settings.format === "dtf" ? 300 : settings.effectiveDpi;
    let blob = await canvasToBlob(outputCanvas, "image/png");
    blob = await embedPngDpi(blob, dpi);

    const suffix =
      settings.format === "dtf"
        ? `dtf-300dpi${settings.mirror ? "-espelhado" : ""}`
        : `png-${dpi}dpi${settings.mirror ? "-espelhado" : ""}`;

    downloadBlob(blob, `${state.fileName || "arte"}-${suffix}.png`);

    if (settings.format === "dtf" && settings.requestedDpi !== 300) {
      setFeedback(
        status,
        "Arquivo DTF-ready exportado em 300 DPI, conforme o padrao dessa saida.",
        "success"
      );
      return;
    }

    setFeedback(status, "Arquivo exportado com sucesso.", "success");
  }
}
