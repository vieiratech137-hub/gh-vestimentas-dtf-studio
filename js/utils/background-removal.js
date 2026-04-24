const BACKGROUND_REMOVAL_URL =
  "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/dist/index.mjs";

const DEFAULT_CONFIG = {
  device: "cpu",
  model: "isnet_quint8",
  proxyToWorker: false,
  publicPath: "https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/"
};

let backgroundRemovalModulePromise;
let preloadPromise;

async function loadModule() {
  if (!backgroundRemovalModulePromise) {
    backgroundRemovalModulePromise = import(BACKGROUND_REMOVAL_URL);
  }

  return backgroundRemovalModulePromise;
}

export async function ensureBackgroundRemovalModel(onProgress) {
  if (!preloadPromise) {
    preloadPromise = loadModule().then(async (module) => {
      if (typeof module.preload !== "function") {
        return;
      }

      await module.preload({
        ...DEFAULT_CONFIG,
        progress: (key, current, total) => {
          onProgress?.({
            key,
            current,
            total,
            percent: total ? Math.round((current / total) * 100) : 0
          });
        }
      });
    });
  }

  return preloadPromise;
}

function resolveRemoveBackground(module) {
  if (typeof module.removeBackground === "function") {
    return module.removeBackground;
  }

  if (typeof module.default === "function") {
    return module.default;
  }

  throw new Error("A biblioteca de remoção de fundo não expôs a função esperada.");
}

export async function removeBackgroundLocally(source, onProgress) {
  const module = await loadModule();
  const removeBackground = resolveRemoveBackground(module);

  return removeBackground(source, {
    ...DEFAULT_CONFIG,
    progress: (key, current, total) => {
      onProgress?.({
        key,
        current,
        total,
        percent: total ? Math.round((current / total) * 100) : 0
      });
    }
  });
}
