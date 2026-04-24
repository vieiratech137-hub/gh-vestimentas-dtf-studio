import { revokeIfObjectUrl } from "./files.js";

const listeners = new Set();

const state = {
  asset: null,
  version: 0
};

function notifyListeners() {
  listeners.forEach((listener) => {
    listener(state.asset);
  });
}

export function getWorkspaceAsset() {
  return state.asset;
}

export function subscribeWorkspace(listener, options = {}) {
  const { immediate = true } = options;
  listeners.add(listener);

  if (immediate && state.asset) {
    listener(state.asset);
  }

  return () => {
    listeners.delete(listener);
  };
}

export function setWorkspaceAsset({
  blob,
  fileName = "",
  sourceTool = "app",
  linkedBatchItemId = "",
  meta = {}
}) {
  if (!(blob instanceof Blob)) {
    throw new Error("A arte compartilhada precisa receber um Blob valido.");
  }

  const previous = state.asset;
  const nextUrl = URL.createObjectURL(blob);
  const nextFileName = fileName.trim() || previous?.fileName || "arte";

  state.version += 1;
  state.asset = {
    blob,
    fileName: nextFileName,
    linkedBatchItemId,
    sourceTool,
    meta: { ...meta },
    url: nextUrl,
    version: state.version
  };

  if (previous?.url && previous.url !== nextUrl) {
    window.setTimeout(() => {
      revokeIfObjectUrl(previous.url);
    }, 1500);
  }

  notifyListeners();
  return state.asset;
}
