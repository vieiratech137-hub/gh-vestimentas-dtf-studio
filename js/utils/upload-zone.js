import { isImageFile } from "./files.js";

export function bindDropzone({ zone, input, onFiles }) {
  const handleFiles = (fileList) => {
    const files = [...fileList].filter(isImageFile);
    if (!files.length) {
      return;
    }

    onFiles(files);
    input.value = "";
  };

  input.addEventListener("change", () => {
    if (input.files?.length) {
      handleFiles(input.files);
    }
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add("is-dragging");
    });
  });

  ["dragleave", "dragend", "drop"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (eventName === "dragleave" && zone.contains(event.relatedTarget)) {
        return;
      }

      zone.classList.remove("is-dragging");
    });
  });

  zone.addEventListener("drop", (event) => {
    const transfer = event.dataTransfer;
    if (transfer?.files?.length) {
      handleFiles(transfer.files);
    }
  });

  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });
}
