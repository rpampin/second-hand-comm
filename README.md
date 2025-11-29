# Mercadito Personal

Aplicacion estatica para gestionar y publicar el catalogo de productos usados de rpampin. El sitio funciona 100 % desde GitHub Pages usando `data/products.json` como unica fuente de verdad y la API REST de GitHub para administrar cambios.

## Estructura principal

- `index.html` - Home con grid de productos, buscador y filtros.
- `assets/app.js` - SPA ligera con ruteo por hash y detalle de producto.
- `admin/index.html` - Panel de administracion (solo rpampin) con autenticacion via PAT.
- `assets/admin.js` - Logica del panel: CRUD, subida de imagenes y commits via GitHub API.
- `data/products.json` - Base de datos principal (precio entero, Markdown, estado, timestamps).
- `data/images/<slug>/` - Carpeta sugerida para imagenes optimizadas por producto.
- `404.html` - Fallback para GitHub Pages (redirige al hash router).

## Configuracion rapida

1. **GITHUB constants**: actualiza el objeto `GITHUB` en `assets/admin.js` con `owner`, `repo`, `branch` reales y el `allowedLogin` autorizado.
2. **GitHub Pages**: publica la rama configurada (por defecto `main`) desde la seccion *Pages* del repositorio. Usa la carpeta `/` como fuente.
3. **Datos iniciales**: ajusta `data/products.json` a tus productos (manteniendo ASCII). Cada producto debe incluir `id`, `slug`, `price` en pesos enteros, `status`, `images`, `description`, `createdAt`, `updatedAt`.

## Generar un token personal (PAT)

1. En GitHub abre **Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens**.
2. Crea un token con nombre descriptivo (ej. `mercadito-admin`).
3. Limita **Resource owner** al usuario rpampin y selecciona solo el repositorio de la tienda.
4. Permiso minimo: `Repository contents` -> `Read` y `Write`.
5. Copia el token (solo se muestra una vez) y pegalo en el panel `/admin` al iniciar sesion. El token se guarda en `sessionStorage` y se descarta al cerrar la pestana.

## Flujo del panel `/admin`

- Pega el PAT y espera la verificacion (`GET /user`). Solo `rpampin` puede operar; cualquier otro login queda bloqueado.
- Lista lateral con productos: permite editar, marcar vendido/disponible o eliminar (con doble confirmacion y opcion de borrar imagenes).
- Formulario con editor WYSIWYG (TinyMCE via CDN: listas, links, tablas), reordenamiento por drag & drop y subida de multiples imagenes. Las imagenes se optimizan a WebP/JPEG antes de subirlas a `data/images/<slug>/` usando commits individuales.
- Guardado resistente a conflictos: si el `sha` de `products.json` cambia, el panel relee el archivo y reintenta la mutacion.

## Notas de seguridad

- El token **nunca** se persiste en disco ni se envia a terceros; vive en `sessionStorage`.
- Revoca el PAT si sospechas que se filtro y genera uno nuevo con el mismo alcance restringido.
- Mantene el repositorio privado durante el desarrollo si vas a trabajar con datos reales.
- Solo aceptamos imagenes `png`, `jpg`, `jpeg`, `webp`, `avif` hasta 4 MB. Todo se compprime en el cliente antes de subirlo.

## Desarrollo y pruebas

- El proyecto es 100 % estatico: abre `index.html` y `admin/index.html` directamente o sirve la carpeta con `npx serve .`.
- Usa el hash router (`/#/`, `/#/product/<slug>`) para navegar sin 404 en Pages.
- Ejecuta `admin/index.html` en un navegador moderno (Chrome/Edge/Firefox 2023+). Safari 15+ soporta la mayoria de APIs usadas.
- Si trabajas con slug nuevos, asegurate de agregar las carpetas correspondientes en `data/images/<slug>/` para mantener ordenadas las imagenes.

## Buenas practicas

- Mantene los slugs estables: se derivan del titulo, pero en edicion se bloquean para evitar mover imagenes existentes.
- Usa Markdown simple (listas, negrita, enlaces). El renderizador incorpora un saneado basico.
- Cada commit generado sigue el prefijo `feat(admin)`, `fix(admin)` o `chore(admin)` para facilitar revisar el historial.

Listo: con la pagina publicada y el token en la mano, podes administrar el mercadito completo sin backend.

## Modo local
- `npm run dev` levanta un API local (/__dev/api) que lee y escribe en `data/products.local.json` (se crea copiando `data/products.json` si no existe) y en `data/images/`.
- El panel arranca sin token en local y guarda todo en `data/products.local.json`, ignorado por git para no interferir con la version publicada.
- En produccion (GitHub Pages) el panel usa la API de GitHub y requiere el PAT con permisos contents read/write.
