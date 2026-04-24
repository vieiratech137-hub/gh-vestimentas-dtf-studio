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

export function hueDistance(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export function rgbToHsl(rgb) {
  const [rByte, gByte, bByte] = rgb;
  const r = rByte / 255;
  const g = gByte / 255;
  const b = bByte / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  let saturation = 0;

  if (delta !== 0) {
    saturation =
      lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

    switch (max) {
      case r:
        hue = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        hue = ((b - r) / delta + 2) * 60;
        break;
      default:
        hue = ((r - g) / delta + 4) * 60;
        break;
    }
  }

  return [hue, saturation, lightness];
}

function hueToRgb(p, q, t) {
  let wrapped = t;

  if (wrapped < 0) {
    wrapped += 1;
  }
  if (wrapped > 1) {
    wrapped -= 1;
  }

  if (wrapped < 1 / 6) {
    return p + (q - p) * 6 * wrapped;
  }
  if (wrapped < 1 / 2) {
    return q;
  }
  if (wrapped < 2 / 3) {
    return p + (q - p) * (2 / 3 - wrapped) * 6;
  }

  return p;
}

export function hslToRgb(hsl) {
  const [hue, saturation, lightness] = hsl;
  const hueUnit = ((hue % 360) + 360) % 360 / 360;

  if (saturation === 0) {
    const gray = Math.round(lightness * 255);
    return [gray, gray, gray];
  }

  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;

  return [
    Math.round(hueToRgb(p, q, hueUnit + 1 / 3) * 255),
    Math.round(hueToRgb(p, q, hueUnit) * 255),
    Math.round(hueToRgb(p, q, hueUnit - 1 / 3) * 255)
  ];
}

function collectSamples(imageSource, maxSide = 180, sampleStep = 2) {
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

      samples.push([data[index], data[index + 1], data[index + 2]]);
    }
  }

  return samples;
}

function pickDiverseCentroids(samples, targetCount) {
  const centroids = [[...samples[0]]];

  while (centroids.length < targetCount) {
    let bestSample = samples[centroids.length % samples.length];
    let bestDistance = -1;
    const step = Math.max(1, Math.floor(samples.length / 800));

    for (let index = 0; index < samples.length; index += step) {
      const sample = samples[index];
      const nearestDistance = centroids.reduce((lowest, centroid) => {
        return Math.min(lowest, colorDistance(sample, centroid));
      }, Number.POSITIVE_INFINITY);

      if (nearestDistance > bestDistance) {
        bestDistance = nearestDistance;
        bestSample = sample;
      }
    }

    centroids.push([...bestSample]);
  }

  return centroids;
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

export function detectDominantColors(imageSource, colorCount = 8) {
  const samples = collectSamples(imageSource);
  if (!samples.length) {
    return [];
  }

  const targetCount = Math.min(colorCount, samples.length);
  const centroids = pickDiverseCentroids(samples, targetCount);
  let clusters = Array.from({ length: targetCount }, () => []);

  for (let iteration = 0; iteration < 8; iteration += 1) {
    clusters = Array.from({ length: targetCount }, () => []);

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
      }
    });
  }

  const scored = centroids.map((centroid, index) => {
    const cluster = clusters[index] || [];
    const average = cluster.length ? averageCluster(cluster) : centroid;

    return {
      rgb: average.map((value) => clamp(Math.round(value), 0, 255)),
      weight: cluster.length
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
    hsl: rgbToHsl(entry.rgb),
    weight: entry.weight
  }));
}

function isRelatedPaletteTone(candidate, owner) {
  if (owner.fromHsl[1] < 0.1 || candidate.fromHsl[1] < 0.08) {
    return false;
  }

  return (
    hueDistance(candidate.fromHsl[0], owner.fromHsl[0]) <= 32 &&
    Math.abs(candidate.fromHsl[1] - owner.fromHsl[1]) <= 0.34 &&
    Math.abs(candidate.fromHsl[2] - owner.fromHsl[2]) <= 0.4 &&
    colorDistance(candidate.from, owner.from) <= 170
  );
}

function expandMappingsToRelatedFamilies(mappings) {
  const prepared = mappings.map((mapping, index) => ({
    ...mapping,
    index,
    fromHsl: rgbToHsl(mapping.from),
    toHsl: rgbToHsl(mapping.to),
    changed: colorDistance(mapping.from, mapping.to) > 6
  }));

  const editedRoots = prepared.filter((mapping) => mapping.changed);

  return prepared.map((mapping) => {
    if (mapping.changed || !editedRoots.length) {
      return mapping;
    }

    const familyRoot = editedRoots.find((owner) => isRelatedPaletteTone(mapping, owner));
    if (!familyRoot) {
      return mapping;
    }

    return {
      ...mapping,
      to: familyRoot.to,
      toHsl: familyRoot.toHsl,
      familyRootIndex: familyRoot.index,
      changed: true
    };
  });
}

function buildMembership(pixelRgb, pixelHsl, mapping, tolerance) {
  const rgbDistance = colorDistance(pixelRgb, mapping.from);
  const hueDelta =
    pixelHsl[1] < 0.05 || mapping.fromHsl[1] < 0.06
      ? 180
      : hueDistance(pixelHsl[0], mapping.fromHsl[0]);
  const saturationDelta = Math.abs(pixelHsl[1] - mapping.fromHsl[1]);
  const lightnessDelta = Math.abs(pixelHsl[2] - mapping.fromHsl[2]);
  const chromaDelta = Math.abs(
    pixelHsl[1] * (0.35 + pixelHsl[2]) - mapping.fromHsl[1] * (0.35 + mapping.fromHsl[2])
  );

  const rgbThreshold = 22 + tolerance * 1.32;
  const hueThreshold = 12 + tolerance * 0.58;
  const saturationThreshold = 0.09 + tolerance / 360;
  const lightnessThreshold = 0.18 + tolerance / 320;
  const chromaThreshold = 0.11 + tolerance / 300;

  const acceptsHue =
    mapping.fromHsl[1] < 0.12 ||
    pixelHsl[1] < 0.05 ||
    hueDelta <= hueThreshold;
  const acceptsColor =
    rgbDistance <= rgbThreshold &&
    lightnessDelta <= lightnessThreshold &&
    chromaDelta <= chromaThreshold &&
    (acceptsHue || saturationDelta <= saturationThreshold * 0.9);

  if (!acceptsColor) {
    return null;
  }

  const score =
    clamp(rgbDistance / rgbThreshold, 0, 1) * 0.34 +
    clamp(hueDelta / Math.max(hueThreshold, 1), 0, 1) * 0.31 +
    clamp(saturationDelta / saturationThreshold, 0, 1) * 0.15 +
    clamp(lightnessDelta / lightnessThreshold, 0, 1) * 0.14 +
    clamp(chromaDelta / chromaThreshold, 0, 1) * 0.06;

  const influence = clamp(1 - score * 0.78, 0.32, 1);

  return {
    score,
    influence
  };
}

function recolorPixel(pixelRgb, pixelHsl, mapping, influence) {
  const sourceHsl = mapping.fromHsl;
  const targetHsl = mapping.toHsl;
  const sourceSaturation = Math.max(sourceHsl[1], 0.08);
  const saturationScale = targetHsl[1] / sourceSaturation;
  const relativeLightness = pixelHsl[2] - sourceHsl[2];

  let nextSaturation = pixelHsl[1] * saturationScale;
  nextSaturation = nextSaturation * 0.62 + targetHsl[1] * 0.38;
  nextSaturation = clamp(nextSaturation, 0, 1);

  let nextLightness = targetHsl[2] + relativeLightness * 0.92;
  nextLightness = nextLightness * 0.68 + pixelHsl[2] * 0.32;
  nextLightness = clamp(nextLightness, 0, 1);

  const recolored = hslToRgb([targetHsl[0], nextSaturation, nextLightness]);

  return [
    Math.round(pixelRgb[0] + (recolored[0] - pixelRgb[0]) * influence),
    Math.round(pixelRgb[1] + (recolored[1] - pixelRgb[1]) * influence),
    Math.round(pixelRgb[2] + (recolored[2] - pixelRgb[2]) * influence)
  ];
}

export function applyPaletteReplacement(imageData, mappings, tolerance) {
  const source = imageData.data;
  const result = new Uint8ClampedArray(source);
  const expandedMappings = expandMappingsToRelatedFamilies(mappings);
  const activeMappings = expandedMappings.filter(({ changed }) => changed);

  if (!activeMappings.length) {
    return new ImageData(result, imageData.width, imageData.height);
  }

  for (let index = 0; index < result.length; index += 4) {
    const alpha = result[index + 3];
    if (alpha < 8) {
      continue;
    }

    const pixelRgb = [result[index], result[index + 1], result[index + 2]];
    const pixelHsl = rgbToHsl(pixelRgb);
    let winner = null;

    activeMappings.forEach((mapping) => {
      const membership = buildMembership(pixelRgb, pixelHsl, mapping, tolerance);
      if (!membership) {
        return;
      }

      if (!winner || membership.score < winner.membership.score) {
        winner = {
          mapping,
          membership
        };
      }
    });

    if (!winner) {
      continue;
    }

    const recolored = recolorPixel(
      pixelRgb,
      pixelHsl,
      winner.mapping,
      winner.membership.influence
    );

    result[index] = recolored[0];
    result[index + 1] = recolored[1];
    result[index + 2] = recolored[2];
  }

  return new ImageData(result, imageData.width, imageData.height);
}
