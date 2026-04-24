export function clearChildren(element) {
  while (element.firstChild) {
    element.firstChild.remove();
  }
}

export function createElement(tagName, options = {}) {
  const { className, text, html, attrs = {}, dataset = {} } = options;
  const element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  if (typeof text === "string") {
    element.textContent = text;
  }

  if (typeof html === "string") {
    element.innerHTML = html;
  }

  Object.entries(attrs).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    element.setAttribute(key, String(value));
  });

  Object.entries(dataset).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    element.dataset[key] = String(value);
  });

  return element;
}

export function setFeedback(element, message, tone = "neutral") {
  element.textContent = message;
  element.dataset.tone = tone;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function formatNumber(value, fractionDigits = 0) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits
  }).format(value);
}
