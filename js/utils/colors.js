import { clamp } from "./dom.js";

export function rgbToHex(rgb) {
  return `#${rgb
    .map((value) => Math.round(value).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

export function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((part) => `${part}${part}`)
          .join("")
      : normalized;

  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16)
  ];
}

export function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function luminance([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function collectSamples(imageSource, maxSide = 140, sampleStep = 2) {
  const canvas = document.createElement("canvas");
  const sourceWidth = imageSource.naturalWidth || imageSource.width;
  const sourceHeight = imageSource.naturalHeight || imageSource.height;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(imageSource, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const samples = [];

  for (let y = 0; y < canvas.height; y += sampleStep) {
    for (let x = 0; x < canvas.width; x += sampleStep) {
      const index = (y * canvas.width + x) * 4;
      const alpha = data[index + 3];
      if (alpha < 32) {
        continue;
      }

      const point = [data[index], data[index + 1], data[index + 2]];
      samples.push(point);
    }
  }

  return samples;
}

function averageCluster(points) {
  const total = points.reduce(
    (acc, point) => {
      acc[0] += point[0];
      acc[1] += point[1];
      acc[2] += point[2];
      return acc;
    },
    [0, 0, 0]
  );

  return total.map((value) => value / points.length);
}

export function detectDominantColors(imageSource, colorCount = 6) {
  const samples = collectSamples(imageSource);
  if (!samples.length) {
    return [];
  }

  const targetCount = Math.min(colorCount, samples.length);
  const centroids = [];

  for (let index = 0; index < targetCount; index += 1) {
    const sampleIndex = Math.floor((samples.length / targetCount) * index);
    centroids.push([...samples[sampleIndex]]);
  }

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const clusters = Array.from({ length: targetCount }, () => []);

    samples.forEach((sample) => {
      let winner = 0;
      let bestDistance = Number.POSITIVE_INFINITY;

      centroids.forEach((centroid, centroidIndex) => {
        const distance = colorDistance(sample, centroid);
        if (distance < bestDistance) {
          bestDistance = distance;
          winner = centroidIndex;
        }
      });

      clusters[winner].push(sample);
    });

    centroids.forEach((centroid, centroidIndex) => {
      if (clusters[centroidIndex].length) {
        centroids[centroidIndex] = averageCluster(clusters[centroidIndex]);
      } else {
        centroids[centroidIndex] = centroid;
      }
    });
  }

  const scored = centroids.map((centroid) => {
    const count = samples.filter((sample) => colorDistance(sample, centroid) < 38).length;
    return {
      rgb: centroid.map((value) => clamp(Math.round(value), 0, 255)),
      weight: count
    };
  });

  const deduped = scored
    .sort((a, b) => b.weight - a.weight)
    .filter((entry, index, list) => {
      return list.findIndex((other) => colorDistance(entry.rgb, other.rgb) < 24) === index;
    })
    .slice(0, colorCount);

  return deduped.map((entry) => ({
    rgb: entry.rgb,
    hex: rgbToHex(entry.rgb),
    weight: entry.weight
  }));
}

export function applyPaletteReplacement(imageData, mappings, tolerance) {
  const source = imageData.data;
  const result = new Uint8ClampedArray(source);
  const activeMappings = mappings.filter(({ from, to }) => colorDistance(from, to) > 1);

  if (!activeMappings.length) {
    return new ImageData(result, imageData.width, imageData.height);
  }

  for (let index = 0; index < result.length; index += 4) {
    const alpha = result[index + 3];
    if (alpha < 8) {
      continue;
    }

    const pixel = [result[index], result[index + 1], result[index + 2]];
    let winner = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    activeMappings.forEach((mapping) => {
      const distance = colorDistance(pixel, mapping.from);
      if (distance < bestDistance) {
        bestDistance = distance;
        winner = mapping;
      }
    });

    if (!winner || bestDistance > tolerance) {
      continue;
    }

    const fromLum = Math.max(luminance(winner.from), 1);
    const pixelLum = luminance(pixel);
    const brightnessScale = clamp(pixelLum / fromLum, 0.35, 1.85);

    result[index] = clamp(Math.round(winner.to[0] * brightnessScale), 0, 255);
    result[index + 1] = clamp(Math.round(winner.to[1] * brightnessScale), 0, 255);
    result[index + 2] = clamp(Math.round(winner.to[2] * brightnessScale), 0, 255);
  }

  return new ImageData(result, imageData.width, imageData.height);
}
