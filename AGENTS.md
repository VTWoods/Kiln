# AGENTS.md — Developer & AI Agent Guide for Kiln

Kiln is a personal cooking web app and offline-capable Android PWA (WebAPK) for importing recipes from the web, planning weekly meals, managing aisle-grouped shopping lists, and casting touch-friendly Cook Mode instructions to a Google Nest Hub.

---

## 1. Tech Stack

- **Backend:** Python 3.12 + Django 5.2 + SQLite (`./data/kiln.db`), served via Gunicorn in production.
  - Recipe scraping: `recipe-scrapers`
  - Ingredient parsing & units: `ingredient-parser-nlp` (NLTK), `pint`, `inflect`
  - Grocery aisle classification: Hybrid local categorizer + NLTK `wordnet`
  - Nest Hub casting: `pychromecast` (`DashCastController`)
- **Frontend:** React 19 + TypeScript + Tailwind CSS v4 + Vite 6 + React Router 7.
  - Offline PWA: `vite-plugin-pwa` (Workbox `generateSW`) + `idb` (IndexedDB cache + FIFO outbox sync).
- **Reverse Proxy (Dev & Prod):** Caddy HTTPS (`examples/Caddyfile.example` / `examples/Caddyfile.dev`).

---

## 2. Repository Structure

```text
.
├── kiln_project/
│   ├── settings.py          # Django config, DB/image/static paths, Caddy proxy headers, 10 MiB upload limit
│   ├── urls.py              # All /api/* routes + /api catch-all JSON 404 + SPA static fallback
│   └── wsgi.py
├── api/
│   ├── models.py            # Recipe, RecipeIngredient, ShoppingList, ShoppingListItem,
│   │                        # IngredientAisleOverride, PantryStaple, MealPlanEntry
│   ├── migrations/          # 0001..0006 (keep backwards-compatible with existing ./data/kiln.db)
│   ├── management/commands/
│   │   └── normalize_recipes.py  # Backfill/re-parse legacy ingredients & re-merge shopping lists
│   ├── services/            # Domain logic + co-located unit tests (test_*.py)
│   │   ├── fetcher.py             # SSRF-safe HTTP fetcher (blocks private/loopback IPs, size limits)
│   │   ├── importer.py            # RecipeImporter ABC + RecipeScrapersImporter (import_url & import_html)
│   │   ├── import_drafts.py       # Thread-safe in-memory TTL store for bookmarklet previews
│   │   ├── images.py              # Candidate image extraction + local cache under ./data/images/
│   │   ├── ingredient_parser.py   # IngredientParser ABC + NLPIngredientParser
│   │   ├── units.py               # Pint + inflect US customary unit normalization & quantity merging
│   │   ├── shopping_list_merger.py# Deduplication, singular/plural matching, multi-recipe M2M, aisles
│   │   ├── aisle_categorizer.py   # AisleCategorizer ABC + HybridAisleCategorizer (rules + lexicon + WordNet)
│   │   ├── pantry_staples.py      # Default staples + PantryStaple matching
│   │   └── caster.py              # Caster ABC + PyChromecastCaster (DashCast)
│   ├── views/               # Function-based JSON/HTML views + co-located tests (test_*.py)
│   │   ├── health.py, recipes.py, shopping_lists.py, pantry_staples.py,
│   │   ├── meal_plan.py, cast.py, spa.py
│   ├── templates/api/cast_view.html  # Self-contained Nest Hub Cook Mode HTML
│   ├── test_models.py       # Model unit tests
│   └── test_e2e.py          # Feature-organized E2E smoke tests
├── web/
│   ├── public/              # favicon.svg, pwa-192x192.png, pwa-512x512.png, maskable, apple-touch-icon
│   ├── vite.config.ts       # Vite proxy, Caddy allowedHosts/HMR, VitePWA manifest + share_target + Workbox
│   └── src/
│       ├── App.tsx          # Sticky top nav (Kiln+sync, Recipe, Plan, List) & routes
│       ├── api/             # Offline-first API clients (recipes, shoppingLists, pantryStaples, mealPlan, cast)
│       ├── offline/         # IndexedDB store (store.ts), timeout/circuit-breaker fetch (fetch.ts), & outbox sync (sync.ts)
│       ├── pages/           # RecipesPage, RecipeDetailPage, MealPlanPage, ShoppingListsPage, CookModePage
│       ├── components/      # ModalSheet, ImportRecipeModal, AddToShoppingListModal, AddToMealPlanModal,
│       │                    # AddMealPlanToShoppingListModal, ManagePantryStaplesModal, CastRecipeModal
│       └── types/           # recipe.ts, shoppingList.ts, mealPlan.ts (Mon–Sun date utils)
├── examples/
│   ├── Caddyfile.dev        # Standalone local HTTPS proxy (:8443, admin off, no :80 redirects)
│   ├── Caddyfile.example    # Production & dev blocks for an existing server Caddyfile
│   └── docker-compose.yml   # Production Docker Compose example (single-port PWA + API)
├── Dockerfile               # Multi-stage Node 22 + Python 3.12-slim build
└── Makefile                 # install, migrate, build, run, dev, dev-api, dev-web, dev-caddy, test, docker-*
```

---

## 3. Common Commands

```bash
# Install Python venv, pip deps, NLTK data (tagger + wordnet), and npm deps
make install

# Run Django unit + E2E tests (50 tests) AND TypeScript typecheck
make test

# Apply SQLite migrations safely (preserves existing ./data/kiln.db)
make migrate

# Build React + Workbox PWA production bundle into web/dist
npm --prefix web run build

# Run Django (:8091) and Vite (:8090) as TWO SEPARATE background daemon tasks (preferred for AI agents)
# Task 1 (Django backend on 0.0.0.0:8091):
PUBLIC_BASE_URL=https://kiln-dev.woodsfamily.net make dev-api

# Task 2 (Vite frontend on 0.0.0.0:8090, HMR over wss:// behind Caddy):
VITE_HMR_CLIENT_PORT=443 make dev-web

# (For manual single-terminal dev, you can also run both together:)
PUBLIC_BASE_URL=https://kiln-dev.woodsfamily.net make dev

# Normalize legacy recipe ingredients (and optionally re-merge shopping lists)
./.venv/bin/python3 manage.py normalize_recipes --dry-run
./.venv/bin/python3 manage.py normalize_recipes --remerge-shopping-lists
```

**Starting dev servers as an AI agent:**
- Always launch `dev-api` and `dev-web` as **two separate background daemon tasks** (`IsDaemon: true`, outside the sandbox so host Caddy on `localhost:8090`/`8091` can reach them and Django can fetch recipe URLs / cast on LAN).
- Keeping them as separate tasks gives independent logs and lets you inspect or restart Django without interrupting Vite (and vice versa).
- Dev backend runs on `:8091` and Vite dev server on `:8090` (ports `8080`/`8081` may already be in use on the host).
- Production/local user data lives in `./data/kiln.db` and `./data/images/` (both gitignored — **never delete or wipe `./data/kiln.db`**).

---

## 4. Architecture Conventions

### Keep Swappable Service Interfaces Intact
Four core capabilities sit behind ABCs so implementations can be swapped or stubbed cleanly in tests:
- `RecipeImporter` ([api/services/importer.py](api/services/importer.py))
- `IngredientParser` ([api/services/ingredient_parser.py](api/services/ingredient_parser.py))
- `AisleCategorizer` ([api/services/aisle_categorizer.py](api/services/aisle_categorizer.py))
- `Caster` ([api/services/caster.py](api/services/caster.py))

Keep new business logic inside `api/services/` rather than bloating Django views.

### UI Style & Conventions
- Palette: warm `stone` neutrals (`stone-50`, `stone-200`, `stone-900`) + `amber` accents (`amber-600`, `amber-50`).
- Keep the top navigation bar sticky (`sticky top-0 z-30`), compact, and single-row on mobile:
  - Brand button (`Kiln` + inline sync indicator) on the left; tabs named **Recipe**, **Plan**, **List**.
  - Compact action labels (`+ Plan`, `+ List`, `Cast`, icon-only `←` back button, `⋮` overflow menu for `Cook Mode` / `Delete`).

### Mobile-First Requirement (Always Check New UI Features on Phone Widths)
Kiln is used primarily on vertical phones (360–430px viewports, one-handed touch in the kitchen and grocery store). **Every new feature or UI edit MUST be designed and reviewed for mobile friendliness before wrapping up:**
- **Zero horizontal overflow at 360px:** Always include `grid-cols-1` on responsive grids (`grid grid-cols-1 md:grid-cols-...`) and `min-w-0` on grid/flex children containing `truncate` or long recipe/ingredient names; use `break-words` or `line-clamp-2` where wrapping is preferred.
- **Touch targets & gestures:** Interactive buttons, icon triggers, checkboxes, and menu rows should be comfortably tappable (`≥40×40px` preferred, minimum `36px`; use `h-5 w-5` checkboxes wrapped in full-row `<label>`s). Use `pointerdown` (never `mousedown`) for outside-click menu/popover dismissal, and never rely on hover-only `title` tooltips to surface important info.
- **Modals & drawers:** Use the shared `ModalSheet` component (`web/src/components/ModalSheet.tsx`) for all dialogs and mobile pickers so they render as bottom sheets (`max-h-[92dvh]`) with backdrop tap-to-dismiss, Escape close, body scroll lock, safe-area sticky footers, and `40×40px` close buttons.
- **Viewport, keyboards & safe areas:** Use `dvh` (`min-h-dvh` / `h-dvh`) instead of `vh`/`h-screen`, include `env(safe-area-inset-bottom)` padding on bottom-pinned bars/footers, use `text-base sm:text-sm` (≥16px on `<sm`) on inputs/selects/textareas to avoid iOS Safari auto-zoom, and gate `autoFocus` on fine pointers (`window.matchMedia("(pointer: fine)").matches`) so phones aren't ambushed by the soft keyboard.
- **Sticky sub-bars & compact mobile chrome:** Keep above-the-fold headers compact on `<sm` (hide verbose subtitles with `hidden sm:block`, use horizontal pill strips or drawers instead of tall stacked sidebars), and offset sticky sub-bars below the app header via `top-[var(--app-header-h,61px)]`.
- **Standalone PWA links:** Navigate internal routes with React Router `<Link>` / `useNavigate` (never `target="_blank"`), so users stay inside the installed PWA.

---

## 5. Critical Gotchas & Domain Invariants

1. **Always rebuild `web/dist` after frontend edits:**
   Django serves `web/dist` directly on `:8091` (and the full offline PWA precache only exists in `web/dist/sw.js`). Always run `npm --prefix web run build` and `make test` before wrapping up.
2. **NLTK offline corpora:**
   `ingredient-parser-nlp` needs `averaged_perceptron_tagger_eng` and `aisle_categorizer.py` uses `wordnet`. Both are installed in `.venv/nltk_data` (local) and `/usr/local/share/nltk_data` (Docker) so tests work offline. If you add another NLTK corpus, update both `Makefile` (`install`) and `Dockerfile`.
3. **Pint & Ingredient Parser edge cases:**
   - In `api/services/units.py`, keep the explicit overrides in `_CULINARY_OVERRIDES` / `_NON_PHYSICAL_UNITS` / `_ALLOWED_PINT_UNITS` — raw Pint parses `"fl oz"` as `femtoliter * ounce`, `"c"` as speed of light, `"t"` as metric ton, and `"pinch"` as `picoinch`.
   - In `api/services/ingredient_parser.py`:
     - Only override `flat[0]` with a `US_CUSTOMARY` candidate when `flat[0].unit_system == UnitSystem.METRIC`. Primary counts like `"4 medium carrots (10 ounces; 275g)"` must stay `quantity="4", unit=""` so they merge with `"6-8 carrots"`.
     - Keep `separate_names=False` so `"or"` phrasing (`"homemade or store-bought..."`) is not rewritten as `"and"`.
     - Leading unit size qualifiers (`small`, `medium`, `large`) are split out of `unit` into `preparation` (`3 medium cloves garlic` → `unit="clove"`).
4. **Shopping list merging & multi-recipe tracking:**
   - `ShoppingListItem` has BOTH a legacy `recipe` FK (backwards compatibility) and a `recipes` M2M (`shopping_list_item_recipes`) so merged items display clickable chips for every contributing recipe.
   - Matching uses `ingredient_merge_key()` (lowercased + `inflect.singular_noun` on the last word) and skips checked-off items.
   - Changing an item's `aisle` via `PATCH` saves an `IngredientAisleOverride` so future additions remember the user's preferred aisle.
5. **Nest Hub Casting (`api/services/caster.py` & `api/templates/api/cast_view.html`):**
   - Uses `DashCastController` (`APP_DASHCAST = "84912283"`, `force=True`) pointing at self-contained server-rendered HTML (`GET /api/cast/recipes/:id/view`).
   - **Do NOT load CAF v3 `cast_receiver_framework.js`** inside DashCast's v2 receiver — it disables Nest Hub touch input. Keep the touch-safe silent WAV loop (`/api/cast/silence.wav`, `pointer-events: none`) + Screen Wake Lock + 1-hour inactivity auto-release.
6. **Offline PWA & IndexedDB (`web/src/offline/`):**
   - When adding a new IndexedDB object store in `web/src/offline/store.ts`, **increment `DB_VERSION`** (currently `2`).
   - In `web/vite.config.ts`, keep `navigateFallbackDenylist: [/^\/api\//, /^\/admin\//, /^\/django-static\//]` so Workbox never intercepts Cast views, bookmarklet POSTs, or Django Admin.
   - `share_target` in `manifest` uses `GET /recipes` (`share_title`, `share_text`, `share_url`); `RecipesPage` extracts URLs from either `share_url` or `share_text`.
7. **Recipe importing & gated sites:**
   - `ImportDraftStore.get()` is intentionally non-destructive (TTL-based) so React 19 StrictMode double-mounts don't consume a draft token before rendering.
8. **Meal planning dates:**
   - Weeks run **Monday–Sunday** and default to **Next Week**.
   - Always use the local-timezone helpers in `web/src/types/mealPlan.ts` (`parseDateISO`, `formatDateISO`, `getMondayOfWeek`) — never `new Date("YYYY-MM-DD")`, which parses as UTC midnight and shifts dates backward in western timezones.
9. **Django `StatReloader` quirk:**
   - Making multiple rapid edits to `kiln_project/urls.py` can occasionally race Django's `StatReloader`. If a newly added route returns 404 while `dev-api` is running, run `touch kiln_project/urls.py` (or restart `dev-api`).

---

## 6. Testing Expectations

- Unit tests are co-located next to the module they cover (`api/services/test_*.py`, `api/views/test_*.py`, `api/test_models.py`).
- Cross-cutting user flows live in `api/test_e2e.py`.
- All backend tests run offline in an in-memory SQLite DB with zero external network calls (stub `RecipeImporter`, `Caster`, and HTTP openers via `unittest.mock` or `api/testing_utils.py`).
- Before finishing any change:
  1. If any UI was added or modified, review it against the **Mobile-First Requirement** checklist above (360–430px portrait layout, no horizontal overflow, `ModalSheet`, touch targets, `pointerdown`, `dvh`/safe areas, anti-zoom inputs).
  2. Run `make test` (all Django tests + `tsc --noEmit`).
  3. Run `npm --prefix web run build` if any frontend files changed.
  4. Run `make migrate` if any new migration was added.
  5. Do not commit or push unless the user asks.
