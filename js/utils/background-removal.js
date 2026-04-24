import { createCanvas, canvasToBlob } from "./canvas.js";
import { loadImageFromSource, revokeIfObjectUrl } from "./files.js";

const BACKGROUND_REMOVAL_URL =
  "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/dist/index.mjs";

const DEFAULT_CONFIG = {
  model: "isnet_quint8",
  proxyToWorker: true,
  rescale: true,
  output: {
    format: "image/png",
    quality: 1
  },
  publicPath: "https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/"
};

const FAST_MODE_TRIGGER_SIDE = 2200;
const FAST_MODE_MAX_SIDE = 1800;
const BORDER_ANALYSIS_SIDE = 900;

let backgroundRemovalModulePromise;
let runtimePromise;

async function loadModule() {
  if (!backgroundRemovalModulePromise) {
    backgroundRemovalModulePromise = import(BACKGROUND_REMOVAL_URL);
  }

  return backgroundRemovalModulePromise;
}

export async function getBackgroundRemovalRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      let hasWebGpu = false;

      try {
        hasWebGpu = Boolean(navigator.gpu && (await navigator.gpu.requestAdapter()));
      } catch (error) {
        hasWebGpu = false;
      }

      return {
        device: hasWebGpu ? "gpu" : "cpu",
        hasWebGpu,
        label: hasWebGpu ? "GPU" : "CPU"
      };
    })();
  }

  return runtimePromise;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function resolveApi(module) {
  const removeBackground =
    typeof module.removeBackground === "function"
      ? module.removeBackground
      : typeof module.default === "function"
        ? module.default
        : null;

  if (!removeBackground) {
    throw new Error("A biblioteca de remocao de fundo nao expos a funcao esperada.");
  }

  return {
    removeBackground,
    segmentForeground:
      typeof module.segmentForeground === "function" ? module.segmentForeground : null,
    applySegmentationMask:
      typeof module.applySegmentationMask === "function" ? module.applySegmentationMask : null
  };
}

function createProgressBridge(onProgress, percentRange = [8, 88]) {
  return (key, current, total) => {
    const ratio = total ? current / total : 0;
    const percent = Math.round(percentRange[0] + ratio * (percentRange[1] - percentRange[0]));

    onProgress?.({
      key,
      current,
      total,
      percent
    });
  };
}

function buildConfig(runtime, onProgress, percentRange) {
  return {
    ...DEFAULT_CONFIG,
    device: runtime.device,
    progress: createProgressBridge(onProgress, percentRange)
  };
}

function readPixel(data, index) {
  const offset = index * 4;
  return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
}

function colorDistance(rgb, reference) {
  return Math.hypot(rgb[0] - reference[0], rgb[1] - reference[1], rgb[2] - reference[2]);
}

function sampleBorderStats(imageData) {
  const { data, width, height } = imageData;
  const borderIndexes = [];
  const stepX = Math.max(1, Math.floor(width / 60));
  const stepY = Math.max(1, Math.floor(height / 60));

  for (let x = 0; x < width; x += stepX) {
    borderIndexes.push(x, (height - 1) * width + x);
  }

  for (let y = 0; y < height; y += stepY) {
    borderIndexes.push(y * width, y * width + (width - 1));
  }

  const samples = borderIndexes
    .map((index) => readPixel(data, index))
    .filter((pixel) => pixel[3] > 10);

  if (samples.length < 24) {
    return null;
  }

  const average = samples.reduce(
    (acc, pixel) => {
      acc[0] += pixel[0];
      acc[1] += pixel[1];
      acc[2] += pixel[2];
      return acc;
    },
    [0, 0, 0]
  );

  const reference = average.map((value) => value / samples.length);
  const distances = samples.map((pixel) => colorDistance(pixel, reference));
  const meanDistance =
    distances.reduce((total, value) => total + value, 0) / Math.max(distances.length, 1);
  const nearRatio =
    distances.filter((value) => value <= Math.max(18, meanDistance * 2.2)).length /
    distances.length;

  if (meanDistance > 22 || nearRatio < 0.74) {
    return null;
  }

  return {
    backgroundColor: reference.map((value) => Math.round(value)),
    tolerance: clamp(Math.round(meanDistance * 2.5 + 18), 18, 46)
  };
}

function buildBackgroundMask(imageData, stats) {
  const { data, width, height } = imageData;
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const background = new Uint8Array(totalPixels);
  const queue = new Uint32Array(totalPixels);
  let head = 0;
  let tail = 0;

  function enqueue(index) {
    if (visited[index]) {
      return;
    }

    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }

  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + (width - 1));
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;

    const offset = index * 4;
    const alpha = data[offset + 3];
    const pixel = [data[offset], data[offset + 1], data[offset + 2]];
    const matchesBackground =
      alpha < 10 || colorDistance(pixel, stats.backgroundColor) <= stats.tolerance;

    if (!matchesBackground) {
      continue;
    }

    background[index] = 1;

    const x = index % width;
    const y = Math.floor(index / width);

    if (x > 0) {
      enqueue(index - 1);
    }
    if (x < width - 1) {
      enqueue(index + 1);
    }
    if (y > 0) {
      enqueue(index - width);
    }
    if (y < height - 1) {
      enqueue(index + width);
    }
  }

  const removedPixels = background.reduce((total, value) => total + value, 0);
  const removedRatio = removedPixels / totalPixels;

  if (removedRatio < 0.08 || removedRatio > 0.88) {
    return null;
  }

  const maskImageData = new ImageData(width, height);

  for (let index = 0; index < totalPixels; index += 1) {
    const offset = index * 4;
    const alpha = background[index] ? 0 : 255;
    maskImageData.data[offset] = 255;
    maskImageData.data[offset + 1] = 255;
    maskImageData.data[offset + 2] = 255;
    maskImageData.data[offset + 3] = alpha;
  }

  return maskImageData;
}

async function trySolidBackgroundRemoval(source, onProgress) {
  const image = await loadImageFromSource(source);

  try {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const analysisScale = Math.min(1, BORDER_ANALYSIS_SIDE / Math.max(width, height));
    const analysisCanvas = createCanvas(width * analysisScale, height * analysisScale);
    const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });
    analysisContext.drawImage(image, 0, 0, analysisCanvas.width, analysisCanvas.height);

    onProgress?.({
      key: "fast:analyze",
      current: 1,
      total: 3,
      percent: 12
    });

    const analysisImageData = analysisContext.getImageData(
      0,
      0,
      analysisCanvas.width,
      analysisCanvas.height
    );
    const borderStats = sampleBorderStats(analysisImageData);

    if (!borderStats) {
      return null;
    }

    const maskImageData = buildBackgroundMask(analysisImageData, borderStats);
    if (!maskImageData) {
      return null;
    }

    onProgress?.({
      key: "fast:mask",
      current: 2,
      total: 3,
      percent: 48
    });

    const maskCanvas = createCanvas(maskImageData.width, maskImageData.height);
    maskCanvas.getContext("2d").putImageData(maskImageData, 0, 0);

    const resultCanvas = createCanvas(width, height);
    const resultContext = resultCanvas.getContext("2d", { willReadFrequently: true });
    resultContext.drawImage(image, 0, 0, width, height);

    const fullMaskCanvas = createCanvas(width, height);
    const fullMaskContext = fullMaskCanvas.getContext("2d", { willReadFrequently: true });
    fullMaskContext.imageSmoothingEnabled = true;
    fullMaskContext.drawImage(maskCanvas, 0, 0, width, height);

    const resultImageData = resultContext.getImageData(0, 0, width, height);
    const fullMaskData = fullMaskContext.getImageData(0, 0, width, height).data;

    for (let offset = 0; offset < resultImageData.data.length; offset += 4) {
      resultImageData.data[offset + 3] = Math.round(
        (resultImageData.data[offset + 3] * fullMaskData[offset + 3]) / 255
      );
    }

    resultContext.putImageData(resultImageData, 0, 0);

    onProgress?.({
      key: "fast:apply",
      current: 3,
      total: 3,
      percent: 100
    });

    const blob = await canvasToBlob(resultCanvas, "image/png");

    return {
      blob,
      meta: {
        runtimeLabel: "Instantaneo",
        strategy: "solid-background",
        summary: "Instantaneo • recorte rapido por fundo solido detectado nas bordas."
      }
    };
  } finally {
    revokeIfObjectUrl(image.dataset.temporaryUrl);
  }
}

async function createFastModeInput(source) {
  const image = await loadImageFromSource(source);

  try {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const longestSide = Math.max(width, height);

    if (longestSide <= FAST_MODE_TRIGGER_SIDE) {
      return {
        source,
        strategy: "full-resolution",
        summary: "Resolucao original mantida."
      };
    }

    const scale = FAST_MODE_MAX_SIDE / longestSide;
    const canvas = createCanvas(width * scale, height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await canvasToBlob(canvas, "image/png");

    return {
      source: blob,
      strategy: "fast-mask",
      summary: `Mascara acelerada em ${canvas.width}x${canvas.height}, aplicada no arquivo final.`
    };
  } finally {
    revokeIfObjectUrl(image.dataset.temporaryUrl);
  }
}

export async function removeBackgroundLocally(source, onProgress, options = {}) {
  const fastModeEnabled = options.fastMode !== false;

  if (fastModeEnabled) {
    const solidBackgroundResult = await trySolidBackgroundRemoval(source, onProgress);
    if (solidBackgroundResult) {
      return solidBackgroundResult;
    }
  }

  const module = await loadModule();
  const api = resolveApi(module);
  const runtime = await getBackgroundRemovalRuntime();

  if (fastModeEnabled && api.segmentForeground && api.applySegmentationMask) {
    const preparedInput = await createFastModeInput(source);

    if (preparedInput.strategy === "fast-mask") {
      onProgress?.({
        key: "compute:prepare",
        current: 1,
        total: 3,
        percent: 10
      });

      const maskBlob = await api.segmentForeground(
        preparedInput.source,
        buildConfig(runtime, onProgress, [12, 62])
      );

      onProgress?.({
        key: "compute:apply-mask",
        current: 2,
        total: 3,
        percent: 74
      });

      const resultBlob = await api.applySegmentationMask(
        source,
        maskBlob,
        buildConfig(runtime, onProgress, [76, 96])
      );

      onProgress?.({
        key: "compute:done",
        current: 3,
        total: 3,
        percent: 100
      });

      return {
        blob: resultBlob,
        meta: {
          runtimeLabel: runtime.label,
          strategy: preparedInput.strategy,
          summary: `${runtime.label} • ${preparedInput.summary}`
        }
      };
    }
  }

  const resultBlob = await api.removeBackground(
    source,
    buildConfig(runtime, onProgress, [10, 100])
  );

  return {
    blob: resultBlob,
    meta: {
      runtimeLabel: runtime.label,
      strategy: "full-resolution",
      summary: `${runtime.label} • Resolucao original mantida.`
    }
  };
}
