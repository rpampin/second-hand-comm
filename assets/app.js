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

const LIGHTBOX_MIN_SCALE = 0.15;
const LIGHTBOX_MAX_SCALE = 4;
const LIGHTBOX_SCALE_STEP = 0.2;
let lightboxResizeBound = false;

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
          const rawPrice = Number(item.price);
          return {
            id: String(item.id || safeRandomId()),
            slug: slugify(item.slug || item.title || "producto"),
            title: String(item.title || "Producto sin titulo"),
            price: Number.isFinite(rawPrice) ? Math.max(0, Math.round(rawPrice)) : 0,
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
  const lightboxImages = thumbnails.length > 0 ? thumbnails : [PLACEHOLDER_IMAGE];
  main.innerHTML = `
    <article class="product-detail" aria-labelledby="product-title">
      <div class="product-detail__gallery">
        <div class="product-detail__hero">
          ${product.status === "sold" ? '<span class="product-detail__sold-banner">Vendido</span>' : ""}
          ${thumbnails.length > 1 ? renderHeroNavigation() : ""}
          <img id="product-hero" src="${cover}" alt="${escapeAttribute(`Imagen de ${product.title}`)}" loading="lazy" decoding="async" data-lightbox-index="0" />
          <button type="button" class="hero-zoom-button" aria-label="Ver imagen ampliada" data-action="open-lightbox">
            ${zoomIcon()}
          </button>
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
  setupLightbox(lightboxImages, product.title);
  focusMain();
  applyImageFallbacks(main);
}

function renderHeroNavigation() {
  return `
    <button type="button" class="hero-nav-button hero-nav-button--prev" data-action="hero-prev" aria-label="Imagen anterior">
      ${chevronLeftIcon()}
    </button>
    <button type="button" class="hero-nav-button hero-nav-button--next" data-action="hero-next" aria-label="Imagen siguiente">
      ${chevronRightIcon()}
    </button>
  `;
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
  if (!hero) return;
  const galleryImages = Array.isArray(images) ? images : [];
  const setActiveImage = (index) => updateHeroImage(hero, galleryImages, index, buttons);
  if (buttons.length > 0) {
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number.parseInt(button.dataset.index || "0", 10);
        setActiveImage(index);
      });
    });
  }
  bindHeroNavigation(hero, galleryImages, setActiveImage);
  const initialIndex = Number.parseInt(hero.dataset.lightboxIndex || "0", 10);
  setActiveImage(initialIndex);
}

function updateHeroImage(hero, images, index, thumbnailButtons = []) {
  const total = Array.isArray(images) ? images.length : 0;
  let normalizedIndex = 0;
  if (total > 0) {
    normalizedIndex = ((index % total) + total) % total;
    const raw = images[normalizedIndex];
    const source =
      typeof raw === "string" && raw.trim()
        ? raw.trim().startsWith("data:")
          ? raw.trim()
          : encodeURI(raw.trim())
        : PLACEHOLDER_IMAGE;
    hero.src = source;
  } else {
    hero.src = PLACEHOLDER_IMAGE;
  }
  hero.setAttribute("data-active-index", String(normalizedIndex));
  hero.dataset.lightboxIndex = String(normalizedIndex);
  if (thumbnailButtons.length > 0) {
    thumbnailButtons.forEach((btn) => {
      const buttonIndex = Number.parseInt(btn.dataset.index || "0", 10);
      btn.setAttribute("aria-pressed", String(buttonIndex === normalizedIndex));
    });
  }
}

function bindHeroNavigation(hero, images, setActiveImage) {
  const prevButton = main.querySelector('[data-action="hero-prev"]');
  const nextButton = main.querySelector('[data-action="hero-next"]');
  const total = Array.isArray(images) ? images.length : 0;
  if (total <= 1) return;
  const goTo = (delta) => {
    const current = Number.parseInt(hero.dataset.lightboxIndex || "0", 10) || 0;
    const target = (current + delta + total) % total;
    setActiveImage(target);
  };
  if (prevButton) {
    prevButton.addEventListener("click", () => goTo(-1));
  }
  if (nextButton) {
    nextButton.addEventListener("click", () => goTo(1));
  }
}

function setupLightbox(images, title) {
  const hero = document.getElementById("product-hero");
  const zoomButton = main.querySelector("[data-action=\"open-lightbox\"]");
  if (!hero || !zoomButton || images.length === 0) return;
  const overlay = ensureLightboxOverlay();
  const imageList = images.map((src) => encodeURI(src));
  zoomButton.addEventListener("click", () => {
    const index = Number.parseInt(hero.dataset.lightboxIndex || "0", 10);
    openLightbox(overlay, imageList, title, index);
  });
}

function ensureLightboxOverlay() {
  let overlay = document.getElementById("lightbox-overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "lightbox-overlay";
  overlay.className = "lightbox-overlay";
  overlay.innerHTML = `
    <div class="lightbox-backdrop" data-action="close-lightbox"></div>
    <div class="lightbox-content" role="dialog" aria-modal="true" aria-label="Imagen ampliada">
      <div class="lightbox-body">
        <div class="lightbox-grid">
          <button type="button" class="lightbox-nav lightbox-prev" data-action="prev-lightbox" aria-label="Imagen anterior">${chevronLeftIcon()}</button>
          <div class="lightbox-stage-wrapper">
            <div class="lightbox-stage" data-mode="manual" data-scale="1">
              <img id="lightbox-image" src="" alt="" />
            </div>
          </div>
          <div class="lightbox-actions">
            <button type="button" class="lightbox-close" data-action="close-lightbox" aria-label="Cerrar imagen">${closeIcon()}</button>
            <button type="button" class="lightbox-nav lightbox-next" data-action="next-lightbox" aria-label="Imagen siguiente">${chevronRightIcon()}</button>
          </div>
          <div class="lightbox-footer">
            <div class="lightbox-controls" role="group" aria-label="Controles de zoom">
              <button type="button" class="lightbox-control" data-action="zoom-out" aria-label="Alejar">${zoomOutIcon()}</button>
              <span id="lightbox-zoom-label" class="lightbox-zoom-label">100%</span>
              <button type="button" class="lightbox-control" data-action="zoom-in" aria-label="Acercar">${zoomInIcon()}</button>
              <button type="button" class="lightbox-control" data-action="zoom-fit" aria-label="Ajustar a la pantalla">${fitScreenIcon()}</button>
            </div>
            <p id="lightbox-caption" class="lightbox-caption"></p>
          </div>
        </div>
      </div>
    </div>
  `;
  overlay.hidden = true;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", handleLightboxInteraction);
  keyboardLightbox();
  setupLightboxInteractions(overlay);
  applyImageFallbacks(overlay);
  if (!lightboxResizeBound) {
    window.addEventListener("resize", handleLightboxResize);
    lightboxResizeBound = true;
  }
  return overlay;
}

function openLightbox(overlay, images, title, startIndex = 0) {
  overlay.dataset.images = JSON.stringify(images);
  overlay.dataset.index = String(Math.max(0, Math.min(startIndex, images.length - 1)));
  overlay.dataset.title = title;
  overlay.dataset.scale = "1";
  overlay.dataset.mode = "manual";
  overlay.dataset.fitScale = "";
  overlay.hidden = false;
  overlay.classList.add("is-visible");
  resetLightboxZoom(overlay);
  updateLightboxImage(overlay);
  const closeButton = overlay.querySelector(".lightbox-close");
  if (closeButton) {
    closeButton.focus();
  }
  document.body.style.overflow = "hidden";
}

function closeLightbox(overlay) {
  overlay.classList.remove("is-visible");
  overlay.hidden = true;
  overlay.dataset.images = "";
  overlay.dataset.index = "";
  overlay.dataset.title = "";
  overlay.dataset.scale = "1";
  overlay.dataset.mode = "manual";
  resetLightboxZoom(overlay);
  document.body.style.overflow = "";
}

function handleLightboxInteraction(event) {
  const overlay = event.currentTarget;
  if (!(overlay instanceof HTMLElement)) return;
  if (!(event.target instanceof HTMLElement)) return;
  const action = event.target.closest("[data-action]");
  if (!action) return;
  event.preventDefault();
  const type = action.dataset.action;
  if (!type) return;
  switch (type) {
    case "close-lightbox":
      closeLightbox(overlay);
      break;
    case "prev-lightbox":
      changeLightboxIndex(overlay, -1);
      break;
    case "next-lightbox":
      changeLightboxIndex(overlay, 1);
      break;
    case "zoom-in":
      zoomInLightbox(overlay);
      break;
    case "zoom-out":
      zoomOutLightbox(overlay);
      break;
    case "zoom-fit":
      applyLightboxFit(overlay);
      break;
    default:
      break;
  }
}

function keyboardLightbox() {
  document.addEventListener("keydown", (event) => {
    const overlay = document.getElementById("lightbox-overlay");
    if (!overlay || overlay.hidden) return;
    const prevButton = overlay.querySelector(".lightbox-prev");
    const nextButton = overlay.querySelector(".lightbox-next");
    if (event.key === "Escape") {
      closeLightbox(overlay);
      return;
    }
    if (event.key === "ArrowLeft") {
      if (prevButton && prevButton.hidden) return;
      changeLightboxIndex(overlay, -1);
      return;
    }
    if (event.key === "ArrowRight") {
      if (nextButton && nextButton.hidden) return;
      changeLightboxIndex(overlay, 1);
      return;
    }
    if (event.key === "+" || event.key === "=") {
      zoomInLightbox(overlay);
      return;
    }
    if (event.key === "-" || event.key === "_") {
      zoomOutLightbox(overlay);
      return;
    }
    if (event.key === "0") {
      applyLightboxFit(overlay);
    }
  });
}

function handleLightboxResize() {
  const overlay = document.getElementById("lightbox-overlay");
  if (!overlay || overlay.hidden) return;
  overlay.dataset.fitScale = String(computeFitScale(overlay));
  const mode = overlay.dataset.mode || "manual";
  const targetScale =
    mode === "fit"
      ? Number.parseFloat(overlay.dataset.fitScale || "1")
      : Number.parseFloat(overlay.dataset.scale || "1") || 1;
  setLightboxScale(overlay, targetScale, { center: mode === "fit", preserveMode: true, mode });
}

function changeLightboxIndex(overlay, delta) {
  const images = parseLightboxImages(overlay);
  if (images.length === 0) return;
  const index = Number.parseInt(overlay.dataset.index || "0", 10);
  const next = (index + delta + images.length) % images.length;
  overlay.dataset.index = String(next);
  resetLightboxZoom(overlay);
  updateLightboxImage(overlay);
}

function updateLightboxImage(overlay) {
  const images = parseLightboxImages(overlay);
  const index = Number.parseInt(overlay.dataset.index || "0", 10);
  const image = images[index];
  const title = overlay.dataset.title || "";
  const img = overlay.querySelector("#lightbox-image");
  const caption = overlay.querySelector("#lightbox-caption");
  const prevButton = overlay.querySelector(".lightbox-prev");
  const nextButton = overlay.querySelector(".lightbox-next");
  const singleImage = images.length <= 1;
  if (prevButton) {
    prevButton.hidden = singleImage;
    prevButton.setAttribute("aria-hidden", singleImage ? "true" : "false");
  }
  if (nextButton) {
    nextButton.hidden = singleImage;
    nextButton.setAttribute("aria-hidden", singleImage ? "true" : "false");
  }
  if (!image || !(img instanceof HTMLImageElement)) return;
  img.draggable = false;
  img.addEventListener("dragstart", (event) => event.preventDefault(), { once: true });
  let handled = false;
  const handleLoad = () => {
    if (handled) return;
    handled = true;
    const naturalWidth = img.naturalWidth || img.width || 1;
    const naturalHeight = img.naturalHeight || img.height || 1;
    img.dataset.naturalWidth = String(naturalWidth);
    img.dataset.naturalHeight = String(naturalHeight);
    overlay.dataset.fitScale = String(computeFitScale(overlay));
    const mode = overlay.dataset.mode || "manual";
    const baseScale =
      mode === "fit"
        ? Number.parseFloat(overlay.dataset.fitScale || "1")
        : Number.parseFloat(overlay.dataset.scale || "1") || 1;
    setLightboxScale(overlay, baseScale, { center: true, preserveMode: true, mode });
  };
  img.onload = handleLoad;
  img.src = image;
  if (img.complete) {
    handleLoad();
  }
  img.alt = `Imagen ${index + 1} de ${images.length}${title ? ` de ${title}` : ""}`;
  if (caption) {
    caption.textContent = `${index + 1} / ${images.length}${title ? ` · ${title}` : ""}`;
  }
}

function setupLightboxInteractions(overlay) {
  const stage = overlay.querySelector(".lightbox-stage");
  if (!stage || stage.dataset.interactive === "true") return;
  stage.dataset.interactive = "true";
  stage.addEventListener("dragstart", (event) => event.preventDefault());
  stage.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const originX = stage.scrollLeft + (event.clientX - rect.left);
      const originY = stage.scrollTop + (event.clientY - rect.top);
      const factor = event.deltaY > 0 ? 1 / (1 + LIGHTBOX_SCALE_STEP) : 1 + LIGHTBOX_SCALE_STEP;
      adjustLightboxScale(overlay, factor, { originX, originY });
    },
    { passive: false }
  );
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const canPan =
      stage.scrollWidth > Math.ceil(stage.clientWidth) + 1 ||
      stage.scrollHeight > Math.ceil(stage.clientHeight) + 1;
    if (!canPan) return;
    event.preventDefault();
    stage.dataset.dragPointerId = String(event.pointerId);
    stage.dataset.dragStartX = String(event.clientX);
    stage.dataset.dragStartY = String(event.clientY);
    stage.dataset.dragScrollLeft = String(stage.scrollLeft);
    stage.dataset.dragScrollTop = String(stage.scrollTop);
    stage.classList.add("is-dragging");
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointermove", (event) => {
    if (stage.dataset.dragPointerId !== String(event.pointerId)) return;
    if (!stage.classList.contains("is-dragging")) return;
    event.preventDefault();
    const startX = Number.parseFloat(stage.dataset.dragStartX || "0");
    const startY = Number.parseFloat(stage.dataset.dragStartY || "0");
    const scrollLeftStart = Number.parseFloat(stage.dataset.dragScrollLeft || "0");
    const scrollTopStart = Number.parseFloat(stage.dataset.dragScrollTop || "0");
    stage.scrollLeft = scrollLeftStart - (event.clientX - startX);
    stage.scrollTop = scrollTopStart - (event.clientY - startY);
  });
  const endDrag = (event) => {
    if (stage.dataset.dragPointerId !== String(event.pointerId)) return;
    stage.classList.remove("is-dragging");
    stage.dataset.dragPointerId = "";
    stage.dataset.dragStartX = "";
    stage.dataset.dragStartY = "";
    stage.dataset.dragScrollLeft = "";
    stage.dataset.dragScrollTop = "";
    try {
      stage.releasePointerCapture(event.pointerId);
    } catch (error) {
      // ignore
    }
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
}

function zoomInLightbox(overlay) {
  adjustLightboxScale(overlay, 1 + LIGHTBOX_SCALE_STEP);
}

function zoomOutLightbox(overlay) {
  adjustLightboxScale(overlay, 1 / (1 + LIGHTBOX_SCALE_STEP));
}

function adjustLightboxScale(overlay, factor, origin = {}) {
  const current = Number.parseFloat(overlay.dataset.scale || "1") || 1;
  const stage = overlay.querySelector(".lightbox-stage");
  const originX =
    origin.originX ??
    (stage ? stage.scrollLeft + stage.clientWidth / 2 : 0);
  const originY =
    origin.originY ??
    (stage ? stage.scrollTop + stage.clientHeight / 2 : 0);
  setLightboxScale(overlay, current * factor, { originX, originY });
}

function applyLightboxFit(overlay) {
  const fitScale = Number.parseFloat(overlay.dataset.fitScale || "0") || computeFitScale(overlay);
  overlay.dataset.fitScale = String(fitScale);
  setLightboxScale(overlay, fitScale, { center: true, mode: "fit" });
}

function setLightboxScale(overlay, scale, options = {}) {
  const stage = overlay.querySelector(".lightbox-stage");
  const img = overlay.querySelector("#lightbox-image");
  if (!stage || !(img instanceof HTMLImageElement)) return;
  const naturalWidth = Number.parseFloat(img.dataset.naturalWidth || "0") || img.naturalWidth || img.width;
  const naturalHeight = Number.parseFloat(img.dataset.naturalHeight || "0") || img.naturalHeight || img.height;
  if (!naturalWidth || !naturalHeight) return;
  const prevScale = Number.parseFloat(overlay.dataset.scale || "1") || 1;
  const minScale = options.mode === "fit" ? Math.max(0.05, Math.min(scale, LIGHTBOX_MIN_SCALE)) : LIGHTBOX_MIN_SCALE;
  const maxScale = LIGHTBOX_MAX_SCALE;
  const nextScale = Math.min(maxScale, Math.max(minScale, scale));
  overlay.dataset.scale = String(nextScale);
  stage.dataset.scale = String(nextScale);
  if (!options.preserveMode) {
    overlay.dataset.mode = options.mode || "manual";
  } else if (options.mode) {
    overlay.dataset.mode = options.mode;
  }
  stage.dataset.mode = overlay.dataset.mode || "manual";
  const newWidth = naturalWidth * nextScale;
  const newHeight = naturalHeight * nextScale;
  img.style.width = `${newWidth}px`;
  img.style.height = `${newHeight}px`;
  img.style.maxWidth = "none";
  img.style.maxHeight = "none";
  const stageWidth = stage.clientWidth || newWidth;
  const stageHeight = stage.clientHeight || newHeight;
  const prevWidth = naturalWidth * prevScale || 1;
  const prevHeight = naturalHeight * prevScale || 1;
  if (options.center) {
    const targetLeft = Math.max((newWidth - stageWidth) / 2, 0);
    const targetTop = Math.max((newHeight - stageHeight) / 2, 0);
    stage.scrollLeft = targetLeft;
    stage.scrollTop = targetTop;
  } else {
    const originX = options.originX ?? stage.scrollLeft + stageWidth / 2;
    const originY = options.originY ?? stage.scrollTop + stageHeight / 2;
    const ratioX = prevWidth ? originX / prevWidth : 0.5;
    const ratioY = prevHeight ? originY / prevHeight : 0.5;
    const targetLeft = ratioX * newWidth - stageWidth / 2;
    const targetTop = ratioY * newHeight - stageHeight / 2;
    stage.scrollLeft = Math.max(targetLeft, 0);
    stage.scrollTop = Math.max(targetTop, 0);
  }
  const fitScale = Number.parseFloat(overlay.dataset.fitScale || "0") || computeFitScale(overlay);
  overlay.dataset.fitScale = String(fitScale);
  const canPan = newWidth > stageWidth + 1 || newHeight > stageHeight + 1;
  if (nextScale > fitScale + 0.05 || canPan) {
    stage.classList.add("is-zoomed");
  } else {
    stage.classList.remove("is-zoomed");
  }
  updateLightboxControls(overlay);
}

function computeFitScale(overlay) {
  const stage = overlay.querySelector(".lightbox-stage");
  const img = overlay.querySelector("#lightbox-image");
  if (!stage || !(img instanceof HTMLImageElement)) return 1;
  const naturalWidth = Number.parseFloat(img.dataset.naturalWidth || "0") || img.naturalWidth || img.width;
  const naturalHeight = Number.parseFloat(img.dataset.naturalHeight || "0") || img.naturalHeight || img.height;
  if (!naturalWidth || !naturalHeight) return 1;
  const stageWidth = stage.clientWidth || naturalWidth;
  const stageHeight = stage.clientHeight || naturalHeight;
  if (!stageWidth || !stageHeight) return 1;
  const fitScale = Math.min(stageWidth / naturalWidth, stageHeight / naturalHeight);
  return Math.min(fitScale, 1);
}

function parseLightboxImages(overlay) {
  try {
    const raw = overlay.dataset.images || "[]";
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((value) => typeof value === "string" && value.trim().length > 0);
    }
  } catch (error) {
    console.warn("lightbox parse error", error);
  }
  return [];
}

function resetLightboxZoom(overlay) {
  const stage = overlay.querySelector(".lightbox-stage");
  if (stage) {
    stage.classList.remove("is-zoomed", "is-dragging");
    stage.dataset.scale = "1";
    stage.dataset.mode = "manual";
    if (typeof stage.scrollTo === "function") {
      stage.scrollTo({ top: 0, left: 0 });
    } else {
      stage.scrollTop = 0;
      stage.scrollLeft = 0;
    }
  }
  overlay.dataset.scale = "1";
  overlay.dataset.mode = overlay.dataset.mode || "manual";
  updateLightboxControls(overlay);
}

function updateLightboxControls(overlay) {
  const scale = Number.parseFloat(overlay.dataset.scale || "1") || 1;
  const label = overlay.querySelector("#lightbox-zoom-label");
  if (label) {
    label.textContent = `${Math.round(scale * 100)}%`;
  }
  const zoomOutButton = overlay.querySelector('[data-action="zoom-out"]');
  const zoomInButton = overlay.querySelector('[data-action="zoom-in"]');
  const fitButton = overlay.querySelector('[data-action="zoom-fit"]');
  const fitScale = Number.parseFloat(overlay.dataset.fitScale || "1") || 1;
  const effectiveMin = Math.max(0.05, Math.min(fitScale, LIGHTBOX_MIN_SCALE));
  if (zoomOutButton) {
    zoomOutButton.disabled = scale <= effectiveMin + 0.05;
  }
  if (zoomInButton) {
    zoomInButton.disabled = scale >= LIGHTBOX_MAX_SCALE - 0.05;
  }
  if (fitButton) {
    const isFitActive = overlay.dataset.mode === "fit" && Math.abs(scale - fitScale) < 0.05;
    fitButton.disabled = isFitActive;
  }
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

function formatPrice(value) {
  const numeric = Number(value);
  const amount = Number.isFinite(numeric) ? numeric : 0;
  const currency = state.meta.currency || "ARS";
  const locale = state.meta.locale || "es-AR";
  const key = `${locale}|${currency}|int`;
  if (!priceFormatters.has(key)) {
    priceFormatters.set(
      key,
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
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

function zoomIcon() {
  return `
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M11 2a8 8 0 0 1 6.32 12.9l3.39 3.39a1 1 0 0 1-1.42 1.42l-3.39-3.39A8 8 0 1 1 11 2zm0 2a6 6 0 1 0 4.24 10.24A6 6 0 0 0 11 4z" fill="currentColor" />
      <path d="M11 7a1 1 0 0 1 1 1v2h2a1 1 0 0 1 0 2h-2v2a1 1 0 0 1-2 0v-2H8a1 1 0 0 1 0-2h2V8a1 1 0 0 1 1-1z" fill="currentColor" />
    </svg>
  `;
}

function zoomInIcon() {
  return `
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z" fill="currentColor" />
    </svg>
  `;
}

function zoomOutIcon() {
  return `
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 11v2h14v-2H5z" fill="currentColor" />
    </svg>
  `;
}

function fitScreenIcon() {
  return `
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zm-10 10h2v4h4v2H4v-6zm12 4v-4h2v6h-6v-2h4z" fill="currentColor" />
    </svg>
  `;
}

function closeIcon() {
  return `
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M18.3 5.7a1 1 0 0 1 0 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-1.4-1.4l4.9-4.9-4.9-4.9A1 1 0 0 1 7.1 5.7L12 10.6l4.9-4.9a1 1 0 0 1 1.4 0z" fill="currentColor" />
    </svg>
  `;
}

function chevronLeftIcon() {
  return `
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M14.7 5.3a1 1 0 0 1 0 1.4L10.4 12l4.3 4.3a1 1 0 0 1-1.4 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0z" fill="currentColor" />
    </svg>
  `;
}

function chevronRightIcon() {
  return `
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9.3 5.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 0 1-1.4-1.4L13.6 12 9.3 7.7a1 1 0 0 1 0-1.4z" fill="currentColor" />
    </svg>
  `;
}
