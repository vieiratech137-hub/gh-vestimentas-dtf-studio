import { initNavigation } from "./js/navigation.js";
import { initBatchRemoval } from "./js/features/batch-removal.js";
import { initColorEditor } from "./js/features/color-editor.js";
import { initExporter } from "./js/features/exporter.js";

window.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initBatchRemoval();
  initColorEditor();
  initExporter();
});
