const state = {
  products: [],
  meta: {
    currency: "ARS",
    locale: "es-AR",
    contact: null,
  },
  loading: true,
  error: null,
};

const main = document.getElementById("app");
const priceFormatters = new Map();
const fallbackId = () => `p_${Date.now()}_${Math.random().toString(16).slice(2)}`;
function safeRandomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch (error) {
      console.warn("randomUUID fallback", error);
    }
  }
  return fallbackId();
}
const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='640' height='480' viewBox='0 0 640 480'><defs><linearGradient id='g' x1='0' x2='1' y1='0' y2='1'><stop offset='0' stop-color='%23e2e8f0'/><stop offset='1' stop-color='%23f8fafc'/></linearGradient></defs><rect width='640' height='480' fill='url(%23g)'/><text x='50%' y='52%' text-anchor='middle' font-family='Inter, Arial, sans-serif' font-size='42' fill='%2394a3b8'>Foto</text></svg>";

const copyright = document.getElementById("copyright-year");
if (copyright) {
  copyright.textContent = new Date().getFullYear();
}

window.addEventListener("hashchange", () => render());
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    revalidateProducts();
  }
});

init();

async function init() {
  if (!window.location.hash) {
    window.location.replace("#/");
  }
  render();
  await loadProducts();
  render();
}

async function loadProducts(options = {}) {
  const { silent = false } = options;
  if (!silent) {
    state.loading = true;
    state.error = null;
    render();
  }
  try {
    const response = await fetch("data/products.json", {
      headers: { Accept: "application/json" },
      cache: "reload",
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`No se pudo cargar el catalogo (${response.status}). ${errorText}`.trim());
    }
    const payload = await response.json();
    const products = Array.isArray(payload.products) ? payload.products : [];
    state.meta = {
      currency: payload?.meta?.currency || "ARS",
      locale: payload?.meta?.locale || "es-AR",
      contact: payload?.meta?.contact || null,
    };
    state.products = sanitizeProducts(products).sort((a, b) => {
      const priorityA = a.status === "sold" ? 1 : 0;
      const priorityB = b.status === "sold" ? 1 : 0;
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return dateB - dateA;
    });
    state.error = null;
  } catch (error) {
    console.error("Error al cargar productos", error);
    state.error = error instanceof Error ? error : new Error("Error desconocido");
  } finally {
    state.loading = false;
    render();
  }
}

let revalidateTimer = null;
function revalidateProducts() {
  if (state.loading) return;
  if (revalidateTimer) {
    window.clearTimeout(revalidateTimer);
  }
  revalidateTimer = window.setTimeout(() => {
    loadProducts({ silent: true });
  }, 300);
}

function sanitizeProducts(list) {
  return Array.isArray(list)
    ? list
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          return {
            id: String(item.id || safeRandomId()),
            slug: slugify(item.slug || item.title || "producto"),
            title: String(item.title || "Producto sin titulo"),
            price: Number.isFinite(Number(item.price)) ? Number(item.price) : 0,
            status: item.status === "sold" ? "sold" : "available",
            images: Array.isArray(item.images) && item.images.length > 0 ? item.images.map((src) => String(src)) : [],
            description: typeof item.description === "string" ? item.description : "",
            createdAt: item.createdAt || null,
            updatedAt: item.updatedAt || item.createdAt || null,
          };
        })
        .filter(Boolean)
    : [];
}

function render() {
  const route = parseHash();
  if (state.loading) {
    renderLoading();
    return;
  }
  if (state.error) {
    renderError(state.error);
    return;
  }
  switch (route.name) {
    case "product":
      renderProduct(route.slug);
      break;
    case "redirect":
      handleRedirect(route.path);
      break;
    default:
      renderHome();
  }
}

function renderLoading() {
  main.innerHTML = `
    <section class="loading-state" role="status" aria-live="polite">
      <div class="loading-spinner" aria-hidden="true"></div>
      <p>Cargando el mercadito...</p>
    </section>
  `;
}

function renderError(error) {
  main.innerHTML = `
    <section class="error-state" role="alert">
      <h1>Oops, algo salio mal</h1>
      <p>${escapeHtml(error.message || "No pudimos cargar los productos.")}</p>
      <button class="button button--primary" type="button" id="retry-fetch">Reintentar</button>
    </section>
  `;
  const retryButton = document.getElementById("retry-fetch");
  if (retryButton) {
    retryButton.addEventListener("click", () => loadProducts());
    retryButton.focus();
  }
}

function renderHome() {
  const items = state.products;
  document.title = "Mercadito Personal";
  main.innerHTML = `
    <section class="catalog" aria-labelledby="catalog-title">
      <header class="catalog-hero">
        <h1 id="catalog-title">Mercadito Personal</h1>
        <p class="catalog-subtitle">Seleccion de productos usados por rpampin.</p>
        <p class="catalog-meta">${items.length === 1 ? "1 producto publicado" : `${items.length} productos publicados`}</p>
      </header>
      ${items.length > 0 ? `<div class="catalog-grid" role="list">${items.map(renderProductCard).join("")}</div>` : renderEmptyState()}
    </section>
  `;
  focusMain();
  applyImageFallbacks(main);
}

function renderProductCard(product) {
  const cover = product.images[0] ? encodeURI(product.images[0]) : PLACEHOLDER_IMAGE;
  const labelStatus = product.status === "sold" ? "Vendido" : "Disponible";
  const excerpt = createExcerpt(product.description);
  return `
    <a class="product-card" role="listitem" href="#/product/${encodeURIComponent(product.slug)}" aria-label="Ver ${escapeAttribute(product.title)}">
      ${product.status === "sold" ? '<span class="badge badge--sold">Vendido</span>' : ""}
      <img src="${cover}" alt="${escapeAttribute(`Imagen principal de ${product.title}`)}" loading="lazy" decoding="async" />
      <div class="card-body">
        <span class="product-price">${formatPrice(product.price)}</span>
        <h2 class="product-title">${escapeHtml(product.title)}</h2>
        <p class="product-summary">${escapeHtml(excerpt)}</p>
        <span class="product-status" aria-hidden="true">${labelStatus}</span>
      </div>
    </a>
  `;
}

function renderEmptyState() {
  return `
    <div class="empty-state">
      <p>Todavia no hay productos publicados.</p>
    </div>
  `;
}

function renderProduct(slug) {
  const product = state.products.find((item) => item.slug === slug);
  if (!product) {
    renderNotFound();
    return;
  }
  document.title = `${product.title} - Mercadito Personal`;
  const cover = product.images[0] ? encodeURI(product.images[0]) : PLACEHOLDER_IMAGE;
  const thumbnails = product.images;
  const created = formatDate(product.createdAt);
  const updated = formatDate(product.updatedAt);
  const statusLabel = product.status === "sold" ? "Vendido" : "Disponible";
  main.innerHTML = `
    <article class="product-detail" aria-labelledby="product-title">
      <div class="product-detail__gallery">
        <div class="product-detail__hero">
          ${product.status === "sold" ? '<span class="product-detail__sold-banner">Vendido</span>' : ""}
          <img id="product-hero" src="${cover}" alt="${escapeAttribute(`Imagen de ${product.title}`)}" loading="lazy" decoding="async" />
        </div>
        ${thumbnails.length > 1 ? `<div class="product-detail__thumbs" role="list">${thumbnails
          .map((image, index) => {
            const encoded = encodeURI(image);
            return `<button type="button" role="listitem" data-index="${index}" aria-pressed="${index === 0}" aria-label="Ver imagen ${index + 1}"><img src="${encoded}" alt="${escapeAttribute(`Miniatura ${index + 1} de ${product.title}`)}" loading="lazy" decoding="async" /></button>`;
          })
          .join("")}</div>` : ""}
      </div>
      <div class="product-detail__info">
        <a class="back-link" href="#/">${backIcon()}Volver</a>
        <header>
          <h1 id="product-title">${escapeHtml(product.title)}</h1>
          <div class="product-detail__meta">
            <span>${statusLabel}</span>
            ${created ? `<span>Publicado: ${created}</span>` : ""}
            ${updated ? `<span>Actualizado: ${updated}</span>` : ""}
          </div>
        </header>
        <p class="product-detail__price">${formatPrice(product.price)}</p>
        ${renderContactButton(product)}
        <section class="product-detail__description" aria-label="Descripcion">
          ${markdownToHtml(product.description)}
        </section>
      </div>
    </article>
  `;
  setupGallery(thumbnails);
  focusMain();
  applyImageFallbacks(main);
}

function renderContactButton(product) {
  const { contact } = state.meta;
  if (!contact || !contact.type || !contact.value) {
    return "";
  }
  const link = buildContactLink(product, contact);
  if (!link) return "";
  return `
    <a class="button button--primary" href="${escapeAttribute(link.href)}" target="_blank" rel="noopener" data-track="contact">
      ${escapeHtml(link.label)}
    </a>
  `;
}

function buildContactLink(product, contact) {
  const message = encodeURIComponent(`Hola rpampin! Me interesa "${product.title}".`);
  if (contact.type === "whatsapp") {
    const phone = contact.value.replace(/[^+\d]/g, "");
    if (!phone) return null;
    const base = "https://wa.me/";
    return {
      href: `${base}${phone}?text=${message}`,
      label: contact.label || "Contactar por WhatsApp",
    };
  }
  if (contact.type === "email") {
    const address = contact.value.trim();
    if (!address.includes("@")) return null;
    return {
      href: `mailto:${address}?subject=${encodeURIComponent("Consulta Mercadito")}&body=${message}`,
      label: contact.label || "Enviar correo",
    };
  }
  if (contact.type === "link") {
    const href = contact.value.trim();
    if (!isSafeUrl(href)) return null;
    return {
      href,
      label: contact.label || "Ver opciones de contacto",
    };
  }
  return null;
}

function setupGallery(images) {
  const hero = document.getElementById("product-hero");
  const buttons = Array.from(main.querySelectorAll(".product-detail__thumbs button"));
  if (!hero || buttons.length === 0) {
    return;
  }
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number.parseInt(button.dataset.index || "0", 10);
      const image = images[index] ? encodeURI(images[index]) : PLACEHOLDER_IMAGE;
      hero.src = image;
      hero.setAttribute("data-active-index", String(index));
      buttons.forEach((btn) => btn.setAttribute("aria-pressed", String(btn === button)));
    });
  });
}

function renderNotFound() {
  document.title = "Producto no encontrado - Mercadito Personal";
  main.innerHTML = `
    <section class="empty-state" role="alert">
      <p>No encontramos ese producto. Puede que haya sido movido o eliminado.</p>
      <a class="button button--primary" href="#/">Volver al catalogo</a>
    </section>
  `;
  focusMain();
}

function handleRedirect(path = "") {
  if (!path) {
    window.location.hash = "#/";
    return;
  }
  if (path.startsWith("product/")) {
    const slug = path.split("/")[1];
    if (slug) {
      window.location.hash = `#/product/${slug}`;
      return;
    }
  }
  window.location.hash = "#/";
}

function createExcerpt(text, length = 120) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= length) return clean;
  return `${clean.slice(0, length).trim()}...`;
}

function formatPrice(valueInCents) {
  const amount = Number(valueInCents || 0) / 100;
  const currency = state.meta.currency || "ARS";
  const locale = state.meta.locale || "es-AR";
  const key = `${locale}|${currency}`;
  if (!priceFormatters.has(key)) {
    priceFormatters.set(
      key,
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })
    );
  }
  return priceFormatters.get(key).format(amount);
}

function formatDate(input) {
  if (!input) return "";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(state.meta.locale || "es-AR", {
    dateStyle: "medium",
  }).format(date);
}

function parseHash() {
  const hash = window.location.hash.startsWith("#/") ? window.location.hash.slice(2) : "";
  if (!hash) return { name: "home" };
  const segments = hash.split("/").map((segment) => decodeURIComponent(segment));
  if (segments[0] === "product") {
    return { name: "product", slug: segments[1] || "" };
  }
  if (segments[0] === "redirect") {
    return { name: "redirect", path: segments.slice(1).join("/") };
  }
  return { name: "home" };
}

function focusMain() {
  window.requestAnimationFrame(() => {
    main.focus({ preventScroll: false });
  });
}

function slugify(text) {
  return text
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[-\s]+/g, "-")
    .toLowerCase();
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function escapeAttribute(value = "") {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function markdownToHtml(markdown = "") {
  const lines = markdown.split(/\r?\n/);
  let html = "";
  let currentList = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentList) {
        html += currentList === "ul" ? "</ul>" : "</ol>";
        currentList = null;
      }
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      if (currentList !== "ul") {
        if (currentList) {
          html += currentList === "ul" ? "</ul>" : "</ol>";
        }
        html += "<ul>";
        currentList = "ul";
      }
      html += `<li>${formatInline(trimmed.replace(/^[-*]\s+/, ""))}</li>`;
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      if (currentList !== "ol") {
        if (currentList) {
          html += currentList === "ul" ? "</ul>" : "</ol>";
        }
        html += "<ol>";
        currentList = "ol";
      }
      html += `<li>${formatInline(trimmed.replace(/^\d+\.\s+/, ""))}</li>`;
      continue;
    }
    if (currentList) {
      html += currentList === "ul" ? "</ul>" : "</ol>";
      currentList = null;
    }
    html += `<p>${formatInline(trimmed)}</p>`;
  }
  if (currentList) {
    html += currentList === "ul" ? "</ul>" : "</ol>";
  }
  return html || `<p>${formatInline("Descripcion no disponible")}</p>`;
}

function formatInline(text = "") {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/`([^`]+)`/g, (match, code) => `<code>${code}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, (match, bold) => `<strong>${bold}</strong>`)
    .replace(/\*([^*]+)\*/g, (match, em) => `<em>${em}</em>`)
    .replace(/~~([^~]+)~~/g, (match, del) => `<del>${del}</del>`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
      if (!isSafeUrl(url)) return label;
      return `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener">${label}</a>`;
    });
}

function isSafeUrl(url = "") {
  const value = url.trim().toLowerCase();
  if (!value) return false;
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("mailto:") ||
    value.startsWith("tel:") ||
    value.startsWith("/#/")
  );
}

function applyImageFallbacks(root) {
  const images = Array.from(root.querySelectorAll("img"));
  images.forEach((img) => {
    img.addEventListener(
      "error",
      () => {
        if (img.dataset.fallbackApplied) return;
        img.dataset.fallbackApplied = "true";
        img.src = PLACEHOLDER_IMAGE;
      },
      { once: true }
    );
  });
}

function backIcon() {
  return `
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M15.7 5.3a1 1 0 0 1 0 1.4L10.4 12l5.3 5.3a1 1 0 0 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0z" fill="currentColor" />
    </svg>
  `;
}
