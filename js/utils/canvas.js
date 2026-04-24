export function getRenderableSize(source) {
  return {
    width: source.naturalWidth || source.videoWidth || source.width,
    height: source.naturalHeight || source.videoHeight || source.height
  };
}

export function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function fitContain(sourceWidth, sourceHeight, maxWidth, maxHeight, padding = 0) {
  const availableWidth = Math.max(1, maxWidth - padding * 2);
  const availableHeight = Math.max(1, maxHeight - padding * 2);
  const scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: (maxWidth - width) / 2,
    y: (maxHeight - height) / 2,
    width,
    height
  };
}

export function drawContainedImage(ctx, source, destWidth, destHeight, options = {}) {
  const { padding = 0, mirror = false } = options;
  const { width: sourceWidth, height: sourceHeight } = getRenderableSize(source);
  const box = fitContain(sourceWidth, sourceHeight, destWidth, destHeight, padding);

  ctx.save();
  if (mirror) {
    ctx.translate(destWidth, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(
      source,
      destWidth - box.x - box.width,
      box.y,
      box.width,
      box.height
    );
  } else {
    ctx.drawImage(source, box.x, box.y, box.width, box.height);
  }
  ctx.restore();

  return box;
}

export function drawCanvasBackground(ctx, width, height, tone = "#ffffff") {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = tone;
  ctx.fillRect(0, 0, width, height);
}

export function cmToPixels(cm, dpi) {
  return Math.round((cm / 2.54) * dpi);
}

export function canvasToBlob(canvas, type = "image/png", quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Não foi possível exportar o canvas."));
        return;
      }

      resolve(blob);
    }, type, quality);
  });
}
