const GITHUB = {
  owner: "rpampin",
  repo: "second-hand-comm",
  branch: "main",
  allowedLogin: "rpampin",
};

const STORAGE_KEY = "mercadito_admin_token";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/avif"];
const PRODUCTS_PATH = "data/products.json";
// Evita spinners infinitos devolviendo control si la red se cuelga.
const REQUEST_TIMEOUT_MS = 15000;

const LOCAL_MODE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const DEV_API_BASE = "/__dev/api";
const textDecoder = new TextDecoder("utf-8");
const textEncoder = new TextEncoder();
const priceFormatters = new Map();
const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='240' viewBox='0 0 320 240'><rect width='320' height='240' fill='#e2e8f0'/><text x='50%' y='52%' text-anchor='middle' font-family='Arial, sans-serif' font-size='24' fill='#94a3b8'>Vista</text></svg>";

const state = {
  token: null,
  verifying: false,
  loading: false,
  saving: false,
  unauthorized: false,
  user: null,
  products: [],
  meta: {
    currency: "ARS",
    locale: "es-AR",
    contact: null,
  },
  productsSha: null,
  status: null,
  search: "",
  form: createEmptyForm(),
  authError: null,
  overlayMessage: null,
};

const refs = {
  currentView: null,
  login: {},
  dashboard: {},
};

let statusTimer = null;
let dragImageIndex = null;
let statusListenersBound = false;

const api = LOCAL_MODE ? createLocalClient() : createGithubClient();

init();

function init() {
  state.token = sessionStorage.getItem(STORAGE_KEY) || null;
  if (!state.form) {
    state.form = createEmptyForm();
  }
  ensureStatusDismissListeners();
  render();
  if (state.token) {
    verifyToken(state.token);
  }
}

function render() {
  if (!state.token) {
    if (refs.currentView !== "login") {
      buildLoginView();
      refs.currentView = "login";
    }
    updateLoginView();
    return;
  }
  if (refs.currentView !== "dashboard") {
    buildDashboardView();
    refs.currentView = "dashboard";
  }
  updateDashboardView();
}

function buildLoginView() {
  const app = document.getElementById("admin-app");
  app.innerHTML = `
    <section class="auth-card" aria-labelledby="auth-title">
      <header>
        <h1 id="auth-title">Panel Mercadito Personal</h1>
        <p>Copia un token personal de GitHub con permisos contents read/write limitados al repositorio ${GITHUB.owner}/${GITHUB.repo}.</p>
      </header>
      <form id="token-form" class="token-form">
        <label for="token-input">Token personal (PAT)</label>
        <div class="token-input-wrapper">
          <input id="token-input" name="token" type="password" autocomplete="off" required aria-describedby="token-hint" />
          <button type="button" class="ghost-button" id="toggle-token-visibility" aria-label="Mostrar token">Ver</button>
        </div>
        <p id="token-hint" class="form-hint">El token se guarda solo en sessionStorage durante la sesion.</p>
        <button type="submit" class="primary-button" id="connect-button">Conectar</button>
        <p class="form-error" id="login-error" role="alert" hidden></p>
      </form>
      <section class="auth-help">
        <h2>Requisitos</h2>
        <ul>
          <li>Scope contents read/write limitado al repositorio indicado.</li>
          <li>Haz logout para borrar el token del navegador.</li>
        </ul>
      </section>
    </section>
  `;
  refs.login = {
    form: document.getElementById("token-form"),
    input: document.getElementById("token-input"),
    toggle: document.getElementById("toggle-token-visibility"),
    button: document.getElementById("connect-button"),
    error: document.getElementById("login-error"),
  };
  refs.login.form.addEventListener("submit", handleLoginSubmit);
  refs.login.toggle.addEventListener("click", toggleTokenVisibility);
  if (LOCAL_MODE && refs.login.input) {
    refs.login.input.removeAttribute("required");
    refs.login.input.placeholder = "Opcional en local";
    const hint = document.getElementById("token-hint");
    if (hint) {
      hint.textContent = "Modo local: el token es opcional (se usa JSON local).";
    }
  }
}

function updateLoginView() {
  if (!refs.login.form) return;
  refs.login.button.disabled = state.verifying;
  refs.login.button.textContent = state.verifying ? "Verificando..." : "Conectar";
  if (state.authError) {
    refs.login.error.textContent = state.authError;
    refs.login.error.hidden = false;
  } else {
    refs.login.error.hidden = true;
  }
}

function toggleTokenVisibility() {
  const input = refs.login.input;
  if (!input) return;
  const hidden = input.type === "password";
  input.type = hidden ? "text" : "password";
  refs.login.toggle.textContent = hidden ? "Ocultar" : "Ver";
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const input = refs.login.input;
  if (!input) return;
  const token = input.value.trim();
  if (!token) {
    state.authError = "Ingresa un token valido";
    updateLoginView();
    return;
  }
  state.authError = null;
  state.verifying = true;
  render();
  await verifyToken(token);
}
async function verifyToken(token) {
  try {
    api.setToken(token);
    const user = await api.getUser();
    if (!user || user.login !== GITHUB.allowedLogin) {
      state.unauthorized = true;
      state.token = null;
      state.user = null;
      api.setToken(null);
      sessionStorage.removeItem(STORAGE_KEY);
      state.authError = "Acceso no autorizado para este token";
      setStatus({ type: "error", text: "Acceso no autorizado" }, { autoClear: false });
      return;
    }
    state.user = user;
    state.token = token;
    state.unauthorized = false;
    sessionStorage.setItem(STORAGE_KEY, token);
    setStatus({ type: "success", text: "Autenticacion correcta" }, { duration: 3200 });
    await loadProducts(true);
  } catch (error) {
    console.error("verifyToken error", error);
    state.authError = error.message || "No se pudo verificar el token";
    state.token = null;
    state.user = null;
    api.setToken(null);
    sessionStorage.removeItem(STORAGE_KEY);
  } finally {
    console.log("[admin] verifyToken:finally", { local: LOCAL_MODE, authorized: Boolean(state.user) });
    state.verifying = false;
    render();
  }
}

async function loadProducts(showOverlay = false) {
  console.log("[admin] loadProducts", { local: LOCAL_MODE, showOverlay, token: Boolean(state.token) });
  if (!state.token) return;
  state.loading = true;
  if (showOverlay) {
    setOverlay("Cargando catalogo...");
  }
  try {
    const file = await api.getJsonFile(PRODUCTS_PATH, GITHUB.branch);
    const decoded = decodeBase64(file.content || "");
    const parsed = decoded ? JSON.parse(decoded) : { products: [], meta: {} };
    state.products = sanitizeProducts(parsed.products || []);
    state.meta = {
      currency: parsed.meta?.currency || state.meta.currency,
      locale: parsed.meta?.locale || state.meta.locale,
      contact: parsed.meta?.contact || null,
    };
    state.productsSha = file.sha;
    if (state.form.mode === "edit") {
      const current = state.products.find((product) => product.id === state.form.productId);
      state.form = current ? buildFormFromProduct(current) : createEmptyForm();
    } else if (!state.form || state.form.mode !== "create") {
      state.form = createEmptyForm();
    }
  } catch (error) {
    console.error("loadProducts error", error);
    if (error && error.status === 404) {
      console.warn("[admin] products.json missing locally", { local: LOCAL_MODE, error });
      state.products = [];
      state.meta = {
        currency: "ARS",
        locale: "es-AR",
        contact: null,
      };
      state.productsSha = null;
      if (!state.form || state.form.mode !== "create") {
        state.form = createEmptyForm();
      }
      setStatus({ type: "info", text: "products.json aun no existe. Se creara al guardar cambios." }, { duration: 4200 });
    } else {
      console.error("[admin] loadProducts failed", { local: LOCAL_MODE, error });
      setStatus({ type: "error", text: error.message || "No se pudo leer data/products.json" }, { autoClear: false });
    }
  } finally {
    state.loading = false;
    console.log("[admin] loadProducts:finally", { local: LOCAL_MODE, products: state.products.length, sha: state.productsSha, saving: state.saving, overlayMessage: state.overlayMessage });
    setOverlay(null);
    render();
  }
}

function handleLogout() {
  api.setToken(null);
  sessionStorage.removeItem(STORAGE_KEY);
  state.token = null;
  state.user = null;
  state.products = [];
  state.productsSha = null;
  state.overlayMessage = null;
  state.form = createEmptyForm();
  dismissStatus();
  render();
}

function buildDashboardView() {
  const app = document.getElementById("admin-app");
  app.innerHTML = `
    <div class="admin-shell">
      <header class="admin-header" aria-live="polite">
        <div class="admin-user">
          <img id="user-avatar" class="user-avatar" alt="Avatar" src="" />
          <div>
            <p id="user-name" class="user-name"></p>
            <p id="user-login" class="user-login"></p>
          </div>
        </div>
        <div class="admin-header-actions">
          <button type="button" class="ghost-button" id="refresh-button">Refrescar</button>
          <button type="button" class="ghost-button" id="logout-button">Cerrar sesion</button>
        </div>
      </header>
      <section class="status-banner" id="status-banner" role="status" hidden>
        <p id="status-text"></p>
        <button type="button" class="ghost-button" id="status-close" data-action="close-status">Cerrar</button>
      </section>
      <div class="admin-body">
        <aside class="admin-sidebar">
          <div class="admin-toolbar">
            <button type="button" class="primary-button" id="new-product">Nuevo producto</button>
            <label class="sidebar-search">
              <span class="visually-hidden">Buscar producto</span>
              <input id="sidebar-search-input" type="search" placeholder="Buscar" autocomplete="off" />
            </label>
          </div>
          <ul class="product-list" id="product-list" aria-live="polite"></ul>
        </aside>
        <section class="admin-main">
          <div id="form-container"></div>
        </section>
      </div>
      <div class="admin-overlay" id="admin-overlay" hidden>
        <div class="admin-overlay-content">
          <div class="overlay-spinner" aria-hidden="true"></div>
          <p id="overlay-text">Procesando...</p>
        </div>
      </div>
    </div>
  `;
  refs.dashboard = {
    shell: app.querySelector(".admin-shell"),
    statusBanner: document.getElementById("status-banner"),
    statusText: document.getElementById("status-text"),
    statusClose: document.getElementById("status-close"),
    productList: document.getElementById("product-list"),
    searchInput: document.getElementById("sidebar-search-input"),
    newButton: document.getElementById("new-product"),
    refreshButton: document.getElementById("refresh-button"),
    logoutButton: document.getElementById("logout-button"),
    overlay: document.getElementById("admin-overlay"),
    overlayText: document.getElementById("overlay-text"),
    formContainer: document.getElementById("form-container"),
    userName: document.getElementById("user-name"),
    userLogin: document.getElementById("user-login"),
    userAvatar: document.getElementById("user-avatar"),
  };
  if (refs.dashboard.statusClose) {
    refs.dashboard.statusClose.addEventListener("click", () => {
      dismissStatus();
    });
  }
  refs.dashboard.newButton.addEventListener("click", () => {
    selectNewProduct();
    renderForm();
    renderProductList();
  });
  refs.dashboard.refreshButton.addEventListener("click", () => loadProducts(true));
  refs.dashboard.logoutButton.addEventListener("click", handleLogout);
  refs.dashboard.searchInput.addEventListener(
    "input",
    debounce((event) => {
      state.search = event.target.value.trim().toLowerCase();
      renderProductList();
    }, 150)
  );
}

function updateDashboardView() {
  if (!refs.dashboard.shell) return;
  updateUserSummary();
  renderStatusBanner();
  renderOverlay();
  renderProductList();
  renderForm();
}

function ensureStatusDismissListeners() {
  if (statusListenersBound) return;
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    const trigger = event.target.closest("[data-action=\"close-status\"]");
    if (!trigger) return;
    event.preventDefault();
    dismissStatus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!state.status) return;
    dismissStatus();
  });
  statusListenersBound = true;
}

function updateUserSummary() {
  if (!state.user || !refs.dashboard.userName) return;
  refs.dashboard.userName.textContent = state.user.name || state.user.login;
  refs.dashboard.userLogin.textContent = `@${state.user.login}`;
  refs.dashboard.userAvatar.src = state.user.avatar_url || "https://avatars.githubusercontent.com/u/0?v=4";
}

function clearStatusTimer() {
  if (statusTimer) {
    window.clearTimeout(statusTimer);
    statusTimer = null;
  }
}

function dismissStatus() {
  state.status = null;
  clearStatusTimer();
  if (refs.dashboard.statusBanner) {
    refs.dashboard.statusBanner.hidden = true;
    refs.dashboard.statusBanner.style.display = "none";
    delete refs.dashboard.statusBanner.dataset.type;
  }
  if (refs.dashboard.statusText) {
    refs.dashboard.statusText.textContent = "";
  }
}

function setStatus(payload, options = {}) {
  if (!payload) {
    clearStatusTimer();
    dismissStatus();
    return;
  }
  clearStatusTimer();
  const status = typeof payload === "string" ? { type: "info", text: payload } : payload;
  state.status = {
    type: status.type || "info",
    text: status.text || "",
  };
  renderStatusBanner();
  const autoClear = options.autoClear !== false;
  if (autoClear) {
    const duration = Number.isFinite(options.duration) && options.duration > 0 ? options.duration : 4800;
    statusTimer = window.setTimeout(() => {
      dismissStatus();
    }, duration);
  }
}

function renderStatusBanner() {
  if (!refs.dashboard.statusBanner) return;
  if (!state.status) {
    refs.dashboard.statusBanner.hidden = true;
    refs.dashboard.statusBanner.style.display = "none";
    delete refs.dashboard.statusBanner.dataset.type;
    return;
  }
  refs.dashboard.statusBanner.hidden = false;
  refs.dashboard.statusBanner.style.display = "flex";
  refs.dashboard.statusBanner.dataset.type = state.status.type;
  refs.dashboard.statusText.textContent = state.status.text;
  if (refs.dashboard.statusClose && !refs.dashboard.statusClose.dataset.bound) {
    refs.dashboard.statusClose.dataset.bound = "true";
    refs.dashboard.statusClose.addEventListener("click", (event) => {
      event.preventDefault();
      dismissStatus();
    });
  }
}

function setOverlay(message = null) {
  state.overlayMessage = message;
  renderOverlay();
}

function renderOverlay() {
  if (!refs.dashboard.overlay) return;
  const active = state.loading || state.saving || Boolean(state.overlayMessage);
  refs.dashboard.overlay.hidden = !active;
  if (active) {
    const text = state.overlayMessage || (state.saving ? "Guardando cambios..." : "Cargando datos...");
    refs.dashboard.overlayText.textContent = text;
  }
}
function renderProductList() {
  if (!refs.dashboard.productList) return;
  const list = refs.dashboard.productList;
  if (!list.dataset.bound) {
    list.dataset.bound = "true";
    list.addEventListener("click", handleProductListClick);
  }
  const search = state.search;
  const items = search
    ? state.products.filter((product) =>
        normalizeText(`${product.title} ${product.description || ""}`).includes(normalizeText(search))
      )
    : state.products.slice();
  if (items.length === 0) {
    list.innerHTML = '<li class="product-list-empty">Sin productos para mostrar</li>';
    return;
  }
  const selectedId = state.form.productId;
  const content = items
    .map((product) => {
      const isSelected = selectedId === product.id;
      const statusLabel = product.status === "sold" ? "Vendido" : "Disponible";
      const toggleLabel = product.status === "sold" ? "Marcar disponible" : "Marcar vendido";
      return `
        <li class="product-list-item ${isSelected ? "is-active" : ""}" data-id="${product.id}">
          <button type="button" class="product-list-select" data-action="select" data-id="${product.id}">
            <span class="product-list-title">${escapeHtml(product.title)}</span>
            <span class="product-list-sub">${formatPrice(product.price)} | ${statusLabel}</span>
          </button>
          <div class="product-list-actions">
            <button type="button" class="ghost-button" data-action="toggle" data-id="${product.id}">${toggleLabel}</button>
            <button type="button" class="ghost-button danger" data-action="delete" data-id="${product.id}">Eliminar</button>
          </div>
        </li>
      `;
    })
    .join("");
  list.innerHTML = content;
}

function handleProductListClick(event) {
  if (!(event.target instanceof HTMLElement)) return;
  const actionElement = event.target.closest('[data-action]');
  if (actionElement) {
    const action = actionElement.dataset.action;
    const id = actionElement.dataset.id;
    if (!action || !id) return;
    if (action === "select") {
      selectProduct(id);
      renderForm();
      renderProductList();
    } else if (action === "toggle") {
      toggleProductStatus(id);
    } else if (action === "delete") {
      deleteProduct(id);
    }
    return;
  }
  const item = event.target.closest('.product-list-item');
  if (!item) return;
  const id = item.dataset.id;
  if (!id) return;
  selectProduct(id);
  renderForm();
  renderProductList();
}


function selectNewProduct() {
  state.form = createEmptyForm();
  dragImageIndex = null;
}

function selectProduct(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) {
    setStatus({ type: "error", text: "Producto no encontrado" }, { duration: 4000 });
    return;
  }
  state.form = buildFormFromProduct(product);
  dragImageIndex = null;
}

function createEmptyForm() {
  return {
    mode: "create",
    productId: null,
    original: null,
    values: {
      title: "",
      slug: "",
      price: "",
      status: "available",
      description: "",
      images: [],
    },
    errors: {},
    slugManual: false,
  };
}

function buildFormFromProduct(product) {
  return {
    mode: "edit",
    productId: product.id,
    original: product,
    values: {
      title: product.title || "",
      slug: product.slug || "",
      price: formatPriceInputFromValue(product.price ?? 0),
      status: product.status === "sold" ? "sold" : "available",
      description: product.description || "",
      images: Array.isArray(product.images)
        ? product.images.map((path, index) => ({
            id: `existing-${index}-${product.id}`,
            source: "existing",
            path,
          }))
        : [],
    },
    errors: {},
    slugManual: true,
  };
}

function renderForm() {
  if (!refs.dashboard.formContainer) return;
  const formState = state.form || createEmptyForm();
  const errors = formState.errors || {};
  const product = formState.original;
  refs.dashboard.formContainer.innerHTML = `
    <form id="product-form" class="product-form" novalidate>
      <header class="form-header">
        <h2>${formState.mode === "create" ? "Nuevo producto" : "Editar producto"}</h2>
        ${
          product
            ? `<p class="form-helper">ID: ${product.id} | Slug: ${product.slug}</p>`
            : "<p class=\"form-helper\">Completa los campos y guarda cuando este listo.</p>"
        }
      </header>
      <div class="form-grid">
        <label class="form-field">
          <span>Titulo</span>
          <input id="field-title" name="title" type="text" required value="${escapeAttribute(formState.values.title)}" autocomplete="off" />
          ${errors.title ? `<p class="field-error">${escapeHtml(errors.title)}</p>` : ""}
        </label>
        <label class="form-field">
          <span>Slug</span>
          <input id="field-slug" name="slug" type="text" value="${escapeAttribute(formState.values.slug)}" ${
    formState.mode === "edit" ? "readonly" : ""
  } autocomplete="off" />
          ${errors.slug ? `<p class="field-error">${escapeHtml(errors.slug)}</p>` : ""}
        </label>
        <label class="form-field">
          <span>Precio</span>
          <input id="field-price" name="price" type="number" min="0" step="1" inputmode="numeric" value="${escapeAttribute(formState.values.price)}" />
          ${errors.price ? `<p class="field-error">${escapeHtml(errors.price)}</p>` : ""}
        </label>
        <label class="form-field">
          <span>Estado</span>
          <select id="field-status" name="status">
            <option value="available" ${formState.values.status === "available" ? "selected" : ""}>Disponible</option>
            <option value="sold" ${formState.values.status === "sold" ? "selected" : ""}>Vendido</option>
          </select>
        </label>
      </div>
      <div class="form-field">
        <label for="field-description">Descripcion (Markdown soportado)</label>
        <div class="markdown-toolbar" role="group" aria-label="Formato descripcion">
          <button type="button" class="ghost-button markdown-btn" data-md="bold" title="Negrita"><span>Negrita</span></button>
          <button type="button" class="ghost-button markdown-btn" data-md="italic" title="Italica"><span>Cursiva</span></button>
          <button type="button" class="ghost-button markdown-btn" data-md="list" title="Lista"><span>Lista</span></button>
          <button type="button" class="ghost-button markdown-btn" data-md="link" title="Insertar enlace"><span>Link</span></button>
          <button type="button" class="ghost-button markdown-btn" data-md="quote" title="Cita"><span>Cita</span></button>
        </div>
        <textarea id="field-description" name="description" rows="8">${escapeHtml(formState.values.description)}</textarea>
        ${errors.description ? `<p class="field-error">${escapeHtml(errors.description)}</p>` : ""}
      </div>
      <section class="markdown-preview" aria-label="Previsualizacion">
        <h3>Preview Markdown</h3>
        <div id="description-preview" class="markdown-preview-body"></div>
      </section>
      <section class="image-manager" aria-label="Imagenes">
        <div class="image-manager-header">
          <h3>Imagenes</h3>
          <p>Arrastra para reordenar. PNG, JPG o WebP hasta 4 MB.</p>
        </div>
        <div class="image-dropzone" id="image-dropzone" tabindex="0" role="button">
          <p>Arrastra archivos o haz clic para buscarlos</p>
        </div>
        <input type="file" id="image-input" accept="image/*" multiple hidden />
        <ul class="image-list" id="image-list"></ul>
        ${errors.images ? `<p class="field-error">${escapeHtml(errors.images)}</p>` : ""}
      </section>
      <footer class="form-actions">
        <button type="submit" class="primary-button">${
          formState.mode === "create" ? "Crear producto" : "Guardar cambios"
        }</button>
        <button type="button" class="ghost-button" id="reset-form">${
          formState.mode === "create" ? "Limpiar" : "Cancelar"
        }</button>
      </footer>
    </form>
  `;
  const form = document.getElementById("product-form");
  if (!form) return;
  bindFormEvents(form);
  updateDescriptionPreview();
  renderImageList();
}

function bindFormEvents(form) {
  const formState = state.form;
  const titleField = form.querySelector("#field-title");
  const slugField = form.querySelector("#field-slug");
  const priceField = form.querySelector("#field-price");
  const statusField = form.querySelector("#field-status");
  const descriptionField = form.querySelector("#field-description");
  const markdownToolbar = form.querySelector(".markdown-toolbar");
  const imageInput = form.querySelector("#image-input");
  const dropzone = form.querySelector("#image-dropzone");
  const resetButton = form.querySelector("#reset-form");

  form.addEventListener("submit", handleFormSubmit);
  titleField.addEventListener("input", (event) => {
    formState.values.title = event.target.value;
    if (formState.mode === "create" && !formState.slugManual) {
      formState.values.slug = slugify(event.target.value);
      slugField.value = formState.values.slug;
    }
  });
  if (slugField) {
    slugField.addEventListener("input", (event) => {
      formState.slugManual = true;
      formState.values.slug = slugify(event.target.value);
      slugField.value = formState.values.slug;
    });
  }
  priceField.addEventListener("input", (event) => {
    formState.values.price = event.target.value;
  });
  statusField.addEventListener("change", (event) => {
    formState.values.status = event.target.value === "sold" ? "sold" : "available";
  });
  descriptionField.addEventListener(
    "input",
    debounce((event) => {
      formState.values.description = event.target.value;
      updateDescriptionPreview();
    }, 140)
  );
  if (markdownToolbar && !markdownToolbar.dataset.bound) {
    markdownToolbar.dataset.bound = "true";
    markdownToolbar.addEventListener("click", (event) => {
      handleMarkdownToolbarClick(event, descriptionField);
    });
  }
  dropzone.addEventListener("click", () => imageInput.click());
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      imageInput.click();
    }
  });
  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("is-active");
    });
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-active"));
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-active");
    if (event.dataTransfer?.files?.length) {
      addImagesFromFiles(event.dataTransfer.files);
    }
  });
  imageInput.addEventListener("change", (event) => {
    if (event.target.files?.length) {
      addImagesFromFiles(event.target.files);
      imageInput.value = "";
    }
  });
  resetButton.addEventListener("click", () => {
    if (formState.mode === "create") {
      selectNewProduct();
    } else if (formState.original) {
      selectProduct(formState.original.id);
    }
    renderForm();
    renderProductList();
  });
}

async function handleFormSubmit(event) {
  event.preventDefault();
  const validation = validateForm(state.form);
  if (!validation.valid) {
    state.form.errors = validation.errors;
    renderForm();
    setStatus({ type: "error", text: "Revisa los campos marcados" }, { duration: 4000 });
    return;
  }
  state.form.errors = {};
  try {
    if (state.form.mode === "create") {
      await createProduct();
    } else {
      console.log("[admin] handleFormSubmit:update", { local: LOCAL_MODE, productId: state.form.productId });
      await updateProduct();
    }
  } catch (error) {
    console.error("handleFormSubmit error", error);
    setStatus({ type: "error", text: error.message || "No se pudo guardar el producto" }, { autoClear: false });
  }
}

function validateForm(formState) {
  const errors = {};
  if (!formState.values.title.trim()) {
    errors.title = "El titulo es obligatorio";
  }
  const slug = slugify(formState.values.slug || formState.values.title);
  if (!slug) {
    errors.slug = "Slug obligatorio";
  } else {
    const exists = state.products.some(
      (product) => product.slug === slug && product.id !== formState.productId
    );
    if (exists) {
      errors.slug = "Ya existe un producto con ese slug";
    }
  }
  const priceRaw = formState.values.price;
  const priceValue = Number(priceRaw);
  if (priceRaw === "" || !Number.isFinite(priceValue) || !Number.isInteger(priceValue) || priceValue < 0) {
    errors.price = "Precio invalido";
  }
  if (!formState.values.description.trim()) {
    errors.description = "Agrega una descripcion";
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

function updateDescriptionPreview() {
  const preview = document.getElementById("description-preview");
  if (!preview) return;
  preview.innerHTML = markdownToHtml(state.form.values.description || "");
}
function handleMarkdownToolbarClick(event, field) {
  if (!field) return;
  if (!(event.target instanceof HTMLElement)) return;
  const button = event.target.closest('[data-md]');
  if (!button) return;
  event.preventDefault();
  const command = button.dataset.md;
  if (!command) return;
  applyMarkdownCommand(field, command);
}

function formatPriceInputFromValue(value) {
  if (!Number.isFinite(value)) {
    return "";
  }
  return String(Math.trunc(value));
}

function applyMarkdownCommand(field, command) {
  const value = field.value;
  const start = field.selectionStart ?? 0;
  const end = field.selectionEnd ?? start;
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);
  let nextValue = value;
  let newStart = start;
  let newEnd = end;
  const separator = value.includes('\r\n') ? '\r\n' : '\n';

  const applyWrap = (prefix, suffix, placeholder) => {
    const text = selected || placeholder;
    nextValue = before + prefix + text + suffix + after;
    newStart = before.length + prefix.length;
    newEnd = newStart + text.length;
  };

  const applyBlock = (formatter) => {
    let blockStart = start;
    let blockEnd = end;
    let block = selected;
    if (!block) {
      blockStart = value.lastIndexOf(separator, start - 1);
      blockStart = blockStart === -1 ? 0 : blockStart + separator.length;
      blockEnd = value.indexOf(separator, end);
      blockEnd = blockEnd === -1 ? value.length : blockEnd;
      block = value.slice(blockStart, blockEnd);
    }
    const lines = block.split(/\r?\n/);
    const formatted = lines.map(formatter).join(separator);
    nextValue = value.slice(0, blockStart) + formatted + value.slice(blockEnd);
    newStart = blockStart;
    newEnd = blockStart + formatted.length;
  };

  switch (command) {
    case 'bold':
      applyWrap('**', '**', 'texto');
      break;
    case 'italic':
      applyWrap('*', '*', 'texto');
      break;
    case 'quote':
      applyBlock((line) => {
        const clean = line.replace(/^>\s?/, '');
        return clean ? '> ' + clean : '> ';
      });
      break;
    case 'list':
      applyBlock((line) => {
        const clean = line.replace(/^[-*]?\s*/, '');
        return clean ? '- ' + clean : '- ';
      });
      break;
    case 'link': {
      const text = selected || 'enlace';
      const defaultUrl = text.startsWith('http') ? text : 'https://';
      const url = window.prompt('Ingresa la URL', defaultUrl);
      if (!url) return;
      nextValue = before + '[' + text + '](' + url + ')' + after;
      newStart = before.length + 1;
      newEnd = newStart + text.length;
      break;
    }
    default:
      return;
  }

  field.focus();
  field.value = nextValue;
  field.setSelectionRange(newStart, newEnd);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function renderImageList() {
  const list = document.getElementById("image-list");
  if (!list) return;
  const images = state.form.values.images;
  if (!Array.isArray(images) || images.length === 0) {
    list.innerHTML = '<li class="image-list-empty">Sin imagenes cargadas</li>';
    return;
  }
  const items = images
    .map((item, index) => {
      const label = item.source === "existing" ? item.path : item.file?.name || "Pendiente";
      const preview = item.source === "existing" ? item.path : item.previewUrl || PLACEHOLDER_IMAGE;
      const info = item.source === "existing" ? "Repositorio" : "Nuevo";
      return `
        <li class="image-item" data-index="${index}" draggable="true">
          <div class="image-thumb">
            <img src="${encodeURI(preview)}" alt="Vista previa" />
          </div>
          <div class="image-data">
            <p class="image-label">${escapeHtml(label)}</p>
            <p class="image-meta">${info}</p>
          </div>
          <div class="image-actions">
            <button type="button" class="ghost-button" data-image-action="up" data-index="${index}">Arriba</button>
            <button type="button" class="ghost-button" data-image-action="down" data-index="${index}">Abajo</button>
            <button type="button" class="ghost-button danger" data-image-action="remove" data-index="${index}">Quitar</button>
          </div>
        </li>
      `;
    })
    .join("");
  list.innerHTML = items;
  bindImageListEvents(list);
}
function bindImageListEvents(list) {
  list.querySelectorAll("[data-image-action]").forEach((button) => {
    button.addEventListener("click", handleImageAction);
  });
  list.querySelectorAll(".image-item").forEach((item) => {
    item.addEventListener("dragstart", handleImageDragStart);
    item.addEventListener("dragover", handleImageDragOver);
    item.addEventListener("drop", handleImageDrop);
    item.addEventListener("dragend", handleImageDragEnd);
  });
}

function handleImageAction(event) {
  const button = event.currentTarget;
  const action = button.dataset.imageAction;
  const index = Number.parseInt(button.dataset.index, 10);
  if (Number.isNaN(index)) return;
  if (action === "remove") {
    removeImageAt(index);
  } else if (action === "up") {
    reorderImages(index, Math.max(0, index - 1));
  } else if (action === "down") {
    reorderImages(index, Math.min(state.form.values.images.length - 1, index + 1));
  }
}

function handleImageDragStart(event) {
  const element = event.currentTarget;
  dragImageIndex = Number.parseInt(element.dataset.index, 10);
  event.dataTransfer.effectAllowed = "move";
  element.classList.add("is-dragging");
}

function handleImageDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
}

function handleImageDrop(event) {
  event.preventDefault();
  const element = event.currentTarget;
  const targetIndex = Number.parseInt(element.dataset.index, 10);
  if (Number.isNaN(dragImageIndex) || Number.isNaN(targetIndex)) return;
  reorderImages(dragImageIndex, targetIndex);
  dragImageIndex = null;
}

function handleImageDragEnd(event) {
  event.currentTarget.classList.remove("is-dragging");
}

function reorderImages(fromIndex, toIndex) {
  const images = state.form.values.images;
  if (!images || fromIndex === toIndex) return;
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= images.length || toIndex >= images.length) return;
  const [moved] = images.splice(fromIndex, 1);
  images.splice(toIndex, 0, moved);
  renderImageList();
}

function removeImageAt(index) {
  const images = state.form.values.images;
  if (!images || index < 0 || index >= images.length) return;
  const [removed] = images.splice(index, 1);
  if (removed && removed.previewUrl) {
    URL.revokeObjectURL(removed.previewUrl);
  }
  renderImageList();
}

function addImagesFromFiles(fileList) {
  const files = Array.from(fileList);
  const errors = [];
  for (const file of files) {
    if (!ACCEPTED_IMAGE_TYPES.some((type) => file.type === type || file.type.startsWith(type.split("/")[0] + "/"))) {
      errors.push(`${file.name}: formato no soportado`);
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      errors.push(`${file.name}: supera ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB`);
      continue;
    }
    const previewUrl = URL.createObjectURL(file);
    state.form.values.images.push({
      id: `new-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      source: "new",
      file,
      previewUrl,
    });
  }
  if (errors.length) {
    setStatus({ type: "error", text: errors.join("; ") }, { duration: 6000 });
  }
  renderImageList();
}
async function toggleProductStatus(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) {
    setStatus({ type: "error", text: "Producto no encontrado" }, { duration: 4000 });
    return;
  }
  const nextStatus = product.status === "sold" ? "available" : "sold";
  await withSaving("Actualizando estado...", async () => {
    await mutateProducts((context) => {
      const target = context.products.find((item) => item.id === productId);
      if (target) {
        target.status = nextStatus;
        target.updatedAt = new Date().toISOString();
      }
      return context;
    }, `fix(admin): toggle product ${product.slug}`);
  });
  if (state.form.mode === "edit" && state.form.productId === productId) {
    const updated = state.products.find((item) => item.id === productId);
    if (updated) {
      state.form = buildFormFromProduct(updated);
      renderForm();
    }
  }
  renderProductList();
  setStatus(
    {
      type: "success",
      text: nextStatus === "sold" ? "Producto marcado como vendido" : "Producto marcado como disponible",
    },
    { duration: 3600 }
  );
}

async function deleteProduct(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) {
    setStatus({ type: "error", text: "Producto no encontrado" }, { duration: 4000 });
    return;
  }
  if (!window.confirm("Seguro que deseas eliminar este producto?")) {
    return;
  }
  const deleteImages = product.images.length > 0 && window.confirm("Eliminar tambien las imagenes asociadas?");
  await withSaving("Eliminando producto...", async () => {
    await mutateProducts((context) => {
      context.products = context.products.filter((item) => item.id !== productId);
      return context;
    }, `chore(admin): delete product ${product.slug}`);
    if (deleteImages) {
      await deleteProductImages(product);
    }
  });
  selectNewProduct();
  renderForm();
  renderProductList();
  setStatus({ type: "success", text: "Producto eliminado" }, { duration: 3600 });
}

async function createProduct() {
  const payload = await buildProductPayload();
  await withSaving("Guardando producto...", async () => {
    if (payload.queue.length) {
      const uploaded = await uploadNewImages(payload.product.slug, payload.queue);
      payload.orderedImages.forEach((image) => {
        if (image.tempId && uploaded[image.tempId]) {
          image.path = uploaded[image.tempId];
        }
      });
    }
    payload.product.images = payload.orderedImages.map((image) => image.path).filter(Boolean);
    payload.product.id = generateId();
    payload.product.createdAt = payload.product.updatedAt;
    await mutateProducts((context) => {
      context.products.push(payload.product);
      return context;
    }, `feat(admin): create product ${payload.product.slug}`);
  });
  state.form = buildFormFromProduct(payload.product);
  renderProductList();
  renderForm();
  setStatus({ type: "success", text: "Producto creado" }, { duration: 3600 });
}

async function updateProduct() {
  const payload = await buildProductPayload();
  await withSaving("Guardando cambios...", async () => {
    if (payload.queue.length) {
      const uploaded = await uploadNewImages(payload.product.slug, payload.queue);
      payload.orderedImages.forEach((image) => {
        if (image.tempId && uploaded[image.tempId]) {
          image.path = uploaded[image.tempId];
        }
      });
    }
    payload.product.images = payload.orderedImages.map((image) => image.path).filter(Boolean);
    await mutateProducts((context) => {
      const index = context.products.findIndex((item) => item.id === payload.product.id);
      if (index >= 0) {
        context.products[index] = payload.product;
      }
      return context;
    }, `fix(admin): update product ${payload.product.slug}`);
  });
  state.form = buildFormFromProduct(payload.product);
  renderProductList();
  renderForm();
  setStatus({ type: "success", text: "Producto actualizado" }, { duration: 3600 });
}

async function buildProductPayload() {
  const formState = state.form;
  const now = new Date().toISOString();
  const baseSlug = slugify(formState.values.slug || formState.values.title || "");
  const slug = ensureUniqueSlug(baseSlug || "producto", formState.mode === "edit" ? formState.productId : null);
  const parsedPrice = Number.parseInt(formState.values.price, 10);
  const priceValue = Number.isNaN(parsedPrice) ? 0 : parsedPrice;
  const product = formState.mode === "edit" && formState.original
    ? {
        ...formState.original,
        title: formState.values.title.trim(),
        slug,
        price: priceValue,
        status: formState.values.status === "sold" ? "sold" : "available",
        description: formState.values.description || "",
        updatedAt: now,
      }
    : {
        id: "",
        slug,
        title: formState.values.title.trim(),
        price: priceValue,
        status: formState.values.status === "sold" ? "sold" : "available",
        description: formState.values.description || "",
        createdAt: now,
        updatedAt: now,
        images: [],
      };
  const orderedImages = [];
  const queue = [];
  formState.values.images.forEach((item, index) => {
    if (item.source === "existing" && item.path) {
      orderedImages.push({ path: item.path, tempId: null });
    } else if (item.source === "new" && item.file) {
      const tempId = `upload-${index}-${Date.now().toString(16)}`;
      orderedImages.push({ path: null, tempId });
      queue.push({ tempId, file: item.file, order: index });
    }
  });
  return { product, orderedImages, queue };
}

async function uploadNewImages(slug, queue) {
  const results = {};
  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    const processed = await processImage(item.file);
    const fileName = `${slug}-${Date.now()}-${index}.${processed.extension}`;
    const path = `data/images/${slug}/${fileName}`;
    await api.putFile(path, {
      message: `feat(admin): upload image ${slug}/${fileName}`,
      content: processed.base64,
      branch: GITHUB.branch,
    });
    results[item.tempId] = path;
  }
  return results;
}

async function deleteProductImages(product) {
  const basePath = `data/images/${product.slug}`;
  try {
    const files = await api.listDirectory(basePath);
    for (const file of files) {
      if (file.type === "file") {
        await api.deleteFile(file.path, {
          message: `chore(admin): delete image ${file.path}`,
          sha: file.sha,
          branch: GITHUB.branch,
        });
      }
    }
  } catch (error) {
    if (error.status !== 404) {
      console.error("deleteProductImages error", error);
    }
  }
}

async function mutateProducts(mutator, message) {
  let attempt = 0;
  let lastError = null;
  while (attempt < 3) {
    attempt += 1;
    const context = {
      products: cloneProducts(state.products),
      meta: { ...state.meta },
    };
    const result = await mutator(context);
    const nextProducts = result?.products || context.products;
    const payload = {
      products: nextProducts,
      meta: context.meta,
    };
    const content = JSON.stringify(payload, null, 2);
    try {
      const payloadBody = {
        message,
        content: encodeBase64(content),
        branch: GITHUB.branch,
      };
      if (state.productsSha) {
        payloadBody.sha = state.productsSha;
      }
      const response = await api.putFile(PRODUCTS_PATH, payloadBody);
      state.products = nextProducts;
      state.meta = context.meta;
      state.productsSha = response.content.sha;
      return response;
    } catch (error) {
      if (error.status === 409 && attempt < 3) {
        await loadProducts(true);
        continue;
      }
      lastError = error;
      break;
    }
  }
  throw lastError || new Error("No se pudo guardar los cambios");
}

async function withSaving(message, task) {
  state.saving = true;
  setOverlay(message);
  try {
    return await task();
  } finally {
    console.log("[admin] withSaving:end", { message });
    state.saving = false;
    setOverlay(null);
  }
}
function sanitizeProducts(list) {
  return Array.isArray(list)
    ? list
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const rawPrice = Number(item.price);
          return {
            id: String(item.id || generateId()),
            slug: slugify(item.slug || item.title || ""),
            title: String(item.title || "Producto sin titulo"),
            price: Number.isFinite(rawPrice) ? Math.max(0, Math.round(rawPrice)) : 0,
            status: item.status === "sold" ? "sold" : "available",
            images: Array.isArray(item.images) ? item.images.map((src) => String(src)) : [],
            description: typeof item.description === "string" ? item.description : "",
            createdAt: item.createdAt || null,
            updatedAt: item.updatedAt || item.createdAt || null,
          };
        })
        .filter(Boolean)
    : [];
}

function cloneProducts(products) {
  return products.map((product) => ({
    ...product,
    images: Array.isArray(product.images) ? product.images.slice() : [],
  }));
}

function ensureUniqueSlug(slug, excludeId) {
  let sanitized = slugify(slug || "");
  if (!sanitized) sanitized = "producto";
  const existing = new Set(
    state.products.filter((product) => product.id !== excludeId).map((product) => product.slug)
  );
  if (!existing.has(sanitized)) {
    return sanitized;
  }
  let suffix = 2;
  while (existing.has(`${sanitized}-${suffix}`)) {
    suffix += 1;
  }
  return `${sanitized}-${suffix}`;
}

function formatPrice(value) {
  const amountNumber = Number(value);
  const amount = Number.isFinite(amountNumber) ? amountNumber : 0;
  const currency = state.meta.currency || "ARS";
  const locale = state.meta.locale || "es-AR";
  const key = `${locale}-${currency}-int`;
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

function normalizeText(text) {
  return text
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function slugify(value) {
  return value
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
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
  return html || "<p>Sin descripcion</p>";
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
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("mailto:") ||
    value.startsWith("tel:") ||
    value.startsWith("/#/")
  );
}

function debounce(fn, delay = 200) {
  let timer = null;
  return function debounced(...args) {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn.apply(this, args), delay);
  };
}

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `p_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function encodeBase64(text) {
  const bytes = textEncoder.encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function decodeBase64(base64) {
  if (!base64) return "";
  const binary = atob(base64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return textDecoder.decode(bytes);
}

async function processImage(file) {
  const bitmap = await createBitmap(file);
  const { width, height } = getScaledSize(bitmap, 1600);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === "function") {
    bitmap.close();
  }
  let blob = await canvasToBlob(canvas, "image/webp", 0.85);
  let extension = "webp";
  if (!blob) {
    blob = await canvasToBlob(canvas, "image/jpeg", 0.85);
    extension = "jpg";
  }
  if (!blob) {
    throw new Error("No se pudo procesar la imagen");
  }
  const base64 = await blobToBase64(blob);
  return { base64, extension, size: blob.size };
}

function getScaledSize(image, maxSize) {
  const ratio = Math.min(1, maxSize / Math.max(image.width, image.height));
  return {
    width: Math.round(image.width * ratio),
    height: Math.round(image.height * ratio),
  };
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function createBitmap(file) {
  if (window.createImageBitmap) {
    try {
      return await window.createImageBitmap(file);
    } catch (error) {
      console.warn("createImageBitmap fallo, uso fallback", error);
    }
  }
  return loadImageElement(file);
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => reject(new Error("No se pudo leer la imagen")));
    reader.addEventListener("load", () => {
      const img = new Image();
      img.addEventListener("error", () => reject(new Error("Imagen invalida")));
      img.addEventListener("load", () => resolve(img));
      img.src = reader.result;
    });
    reader.readAsDataURL(file);
  });
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

// Envuelve fetch para abortar peticiones colgadas y reportarlas como error controlado.
function fetchWithTimeout(resource, options = {}, timeout = REQUEST_TIMEOUT_MS) {
  const { timeoutMessage, ...restOptions } = options || {};
  const supportsAbort = typeof AbortController !== "undefined" && !restOptions.signal && timeout > 0;
  const controller = supportsAbort ? new AbortController() : null;
  let timerId = null;
  if (controller) {
    timerId = window.setTimeout(() => controller.abort(), timeout);
  }
  const finalOptions = controller ? { ...restOptions, signal: controller.signal } : restOptions;
  return fetch(resource, finalOptions)
    .catch((error) => {
      if (controller && error && error.name === "AbortError") {
        const timeoutError = new Error(timeoutMessage || `La solicitud tardo mas de ${Math.ceil(timeout / 1000)} segundos`);
        timeoutError.status = 408;
        throw timeoutError;
      }
      throw error;
    })
    .finally(() => {
      if (timerId) {
        window.clearTimeout(timerId);
      }
    });
}

function createLocalClient() {
  let token = null;

  async function devFetch(path, init = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    };
    const options = {
      cache: "no-store",
      ...init,
      headers,
    };
    const response = await fetchWithTimeout(`${DEV_API_BASE}${path}`, {
      ...options,
      timeoutMessage: "No se pudo conectar con el API local (tiempo de espera agotado)",
    });
    if (!response.ok) {
      let message = `Error ${response.status}`;
      try {
        const data = await response.json();
        if (data && data.message) {
          message = data.message;
        }
      } catch (error) {
        const text = await response.text();
        if (text) message = text;
      }
      const err = new Error(message);
      err.status = response.status;
      throw err;
    }
    return response;
  }

  return {

    setToken(value) {
      token = value;
    },
    async getUser() {
      return {
        login: GITHUB.allowedLogin,
        name: `${GITHUB.allowedLogin} (local)`,
        avatar_url: "https://avatars.githubusercontent.com/u/0?v=4",
      };
    },
    async getJsonFile(targetPath) {
      const response = await devFetch(`/contents?path=${encodeURIComponent(targetPath)}`);
      return response.json();
    },
    async putFile(targetPath, payload) {
      const response = await devFetch("/contents", {
        method: "PUT",
        body: JSON.stringify({ path: targetPath, content: payload.content || "" }),
      });
      return response.json();
    },
    async deleteFile(targetPath) {
      await devFetch("/contents", {
        method: "DELETE",
        body: JSON.stringify({ path: targetPath }),
      });
      return { ok: true };
    },
    async listDirectory(targetPath) {
      const response = await devFetch(`/list?path=${encodeURIComponent(targetPath)}`);
      return response.json();
    },
  };
}
function createGithubClient() {
  const BASE = "https://api.github.com";
  let token = null;

  function buildPath(path) {
    return path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }

  async function request(path, options = {}) {
    if (!token) {
      throw new Error("Token no configurado");
    }
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    };
    const response = await fetchWithTimeout(`${BASE}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body,
      timeoutMessage: "GitHub tardo demasiado en responder. Intenta nuevamente.",
    });
    if (!response.ok) {
      let message = `Error ${response.status}`;
      try {
        const data = await response.json();
        if (data && data.message) {
          message = data.message;
        }
      } catch (error) {
        const text = await response.text();
        if (text) message = text;
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return response;
  }

  return {
    setToken(value) {
      token = value;
    },
    async getUser() {
      const response = await request("/user");
      return response.json();
    },
    async getJsonFile(path, ref) {
      const params = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      const response = await request(
        `/repos/${GITHUB.owner}/${GITHUB.repo}/contents/${buildPath(path)}${params}`
      );
      return response.json();
    },
    async putFile(path, payload) {
      const response = await request(`/repos/${GITHUB.owner}/${GITHUB.repo}/contents/${buildPath(path)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      return response.json();
    },
    async deleteFile(path, payload) {
      const response = await request(`/repos/${GITHUB.owner}/${GITHUB.repo}/contents/${buildPath(path)}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      return response.json();
    },
    async listDirectory(path) {
      try {
        const response = await request(
          `/repos/${GITHUB.owner}/${GITHUB.repo}/contents/${buildPath(path)}?ref=${encodeURIComponent(
            GITHUB.branch
          )}`
        );
        return response.json();
      } catch (error) {
        if (error.status === 404) {
          return [];
        }
        throw error;
      }
    },
  };
}






