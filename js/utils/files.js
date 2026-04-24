export function isImageFile(file) {
  return file.type.startsWith("image/");
}

export function getBaseName(filename) {
  return filename.replace(/\.[^.]+$/, "");
}

export function revokeIfObjectUrl(url) {
  if (typeof url === "string" && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

export function loadImageFromSource(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não foi possível carregar a imagem."));

    if (source instanceof Blob) {
      image.src = URL.createObjectURL(source);
      image.dataset.temporaryUrl = image.src;
      return;
    }

    image.src = source;
  });
}

export async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(file);
  });
}
