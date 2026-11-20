package server

import (
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"strings"

	"github.com/VTWoods/Kiln/internal/db"
	"github.com/gin-gonic/gin"
)

type castViewIngredient struct {
	Amount string
	Name   string
}

type castViewData struct {
	Title       string
	Servings    int
	PrepText    string
	CookText    string
	TotalText   string
	Ingredients []castViewIngredient
	Steps       []string
}

var castViewTmpl = template.Must(template.New("cast_view").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>{{.Title}} — Kiln</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    height: 100%;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #fafaf9;
    color: #1c1917;
    overflow: hidden;
    -webkit-tap-highlight-color: transparent;
  }
  .app { display: flex; flex-direction: column; height: 100vh; }
  header {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 14px 22px; background: #ffffff; border-bottom: 1px solid #e7e5e4; flex-shrink: 0;
  }
  .title-wrap { min-width: 0; }
  h1 {
    font-size: 24px; font-weight: 700; color: #1c1917;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .meta { margin-top: 3px; font-size: 14px; color: #57534e; display: flex; gap: 14px; flex-wrap: wrap; }
  .meta .total { color: #92400e; font-weight: 600; }
  .header-actions { display: flex; gap: 10px; flex-shrink: 0; }
  .btn {
    border: 1px solid #d6d3d1; background: #ffffff; color: #292524;
    border-radius: 12px; padding: 10px 16px; font-size: 15px; font-weight: 600;
    cursor: pointer;
  }
  .btn.active { border-color: #fcd34d; background: #fffbeb; color: #78350f; }
  .btn.primary { border-color: #d97706; background: #d97706; color: #ffffff; }
  .btn:disabled { opacity: 0.35; cursor: default; }

  .workspace { display: flex; flex: 1; min-height: 0; }
  aside {
    width: 34%; min-width: 260px; max-width: 380px;
    background: #ffffff; border-right: 1px solid #e7e5e4;
    display: flex; flex-direction: column; min-height: 0;
  }
  aside.hidden { display: none; }
  .aside-hdr {
    padding: 12px 18px; border-bottom: 1px solid #f5f5f4;
    font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #78716c;
  }
  .ing-list { flex: 1; overflow-y: auto; padding: 10px 14px; list-style: none; }
  .ing-item {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 10px 12px; margin-bottom: 6px; border-radius: 12px;
    background: #f5f5f4; font-size: 17px; line-height: 1.35; cursor: pointer;
  }
  .ing-item.done { background: #fafaf9; color: #a8a29e; text-decoration: line-through; }
  .ing-check {
    width: 22px; height: 22px; border-radius: 6px; border: 2px solid #d6d3d1;
    background: #ffffff; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    font-size: 14px; font-weight: 700; color: #ffffff; margin-top: 1px;
  }
  .ing-item.done .ing-check { border-color: #059669; background: #059669; }
  .ing-amt { color: #92400e; font-weight: 700; margin-right: 6px; }
  .ing-item.done .ing-amt { color: #a8a29e; }

  main { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .step-body {
    flex: 1; overflow-y: auto; padding: 28px 36px;
    display: flex; flex-direction: column; justify-content: center;
  }
  .step-inner { max-width: 820px; margin: 0 auto; width: 100%; }
  .step-badge {
    display: inline-block; background: #fef3c7; color: #78350f;
    border-radius: 999px; padding: 6px 16px; font-size: 15px; font-weight: 700; margin-bottom: 18px;
  }
  .step-text { font-size: 28px; line-height: 1.5; font-weight: 500; color: #1c1917; white-space: pre-line; }

  .all-body { flex: 1; overflow-y: auto; padding: 22px 28px; display: none; }
  .all-list { list-style: none; max-width: 820px; margin: 0 auto; }
  .all-card {
    display: flex; gap: 16px; background: #ffffff; border: 1px solid #e7e5e4;
    border-radius: 16px; padding: 18px 20px; margin-bottom: 14px;
  }
  .all-num {
    width: 34px; height: 34px; border-radius: 999px; background: #fef3c7; color: #78350f;
    font-weight: 700; font-size: 16px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .all-text { font-size: 21px; line-height: 1.5; color: #1c1917; white-space: pre-line; }

  footer {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 14px 24px; background: #ffffff; border-top: 1px solid #e7e5e4; flex-shrink: 0;
  }
  .nav-btn { min-width: 150px; padding: 14px 24px; font-size: 18px; border-radius: 14px; }
  .dots { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .dot {
    width: 14px; height: 14px; border-radius: 999px; border: none;
    background: #d6d3d1; cursor: pointer; padding: 0;
  }
  .dot.active { width: 32px; background: #d97706; }

  .empty { text-align: center; color: #78716c; font-size: 20px; padding: 40px; }
</style>
</head>
<body>
<div class="app">
  <header>
    <div class="title-wrap">
      <h1>{{.Title}}</h1>
      <div class="meta">
        <span>Servings: {{.Servings}}</span>
        {{if .PrepText}}<span>Prep: {{.PrepText}}</span>{{end}}
        {{if .CookText}}<span>Cook: {{.CookText}}</span>{{end}}
        {{if .TotalText}}<span class="total">Total: {{.TotalText}}</span>{{end}}
      </div>
    </div>
    <div class="header-actions">
      <button type="button" id="toggleIngBtn" class="btn active">Ingredients</button>
      {{if gt (len .Steps) 1}}
      <button type="button" id="toggleModeBtn" class="btn">All Steps</button>
      {{end}}
    </div>
  </header>

  <div class="workspace">
    <aside id="ingPanel">
      <div class="aside-hdr">Ingredients ({{len .Ingredients}})</div>
      <ul class="ing-list">
        {{if .Ingredients}}
          {{range .Ingredients}}
          <li class="ing-item" onclick="toggleIng(this)">
            <span class="ing-check"></span>
            <span>{{if .Amount}}<span class="ing-amt">{{.Amount}}</span>{{end}}{{.Name}}</span>
          </li>
          {{end}}
        {{else}}
          <li class="empty">No ingredients listed.</li>
        {{end}}
      </ul>
    </aside>

    <main>
      {{if .Steps}}
        <div id="stepView" class="step-body">
          <div class="step-inner">
            <div id="stepBadge" class="step-badge">Step 1 of {{len .Steps}}</div>
            <div id="stepText" class="step-text">{{index .Steps 0}}</div>
          </div>
        </div>

        <div id="allView" class="all-body">
          <ol class="all-list">
            {{range $i, $s := .Steps}}
            <li class="all-card">
              <span class="all-num"></span>
              <div class="all-text">{{$s}}</div>
            </li>
            {{end}}
          </ol>
        </div>

        <footer id="stepFooter">
          <button type="button" id="prevBtn" class="btn nav-btn" disabled>&#8592; Previous</button>
          <div id="dots" class="dots"></div>
          <button type="button" id="nextBtn" class="btn primary nav-btn">Next Step &#8594;</button>
        </footer>
      {{else}}
        <div class="step-body"><div class="empty">No instructions saved for this recipe.</div></div>
      {{end}}
    </main>
  </div>
</div>

<script>
function toggleIng(el) {
  var isDone = el.className.indexOf('done') !== -1;
  el.className = isDone ? 'ing-item' : 'ing-item done';
  var box = el.querySelector('.ing-check');
  if (box) box.innerHTML = isDone ? '' : '&#10003;';
}

(function() {
  var ingBtn = document.getElementById('toggleIngBtn');
  var ingPanel = document.getElementById('ingPanel');
  if (ingBtn && ingPanel) {
    ingBtn.onclick = function() {
      var hidden = ingPanel.className.indexOf('hidden') !== -1;
      ingPanel.className = hidden ? '' : 'hidden';
      ingBtn.className = hidden ? 'btn active' : 'btn';
    };
  }

  var stepNodes = document.querySelectorAll('#allView .all-text');
  var numNodes = document.querySelectorAll('#allView .all-num');
  var steps = [];
  for (var i = 0; i < stepNodes.length; i++) {
    steps.push(stepNodes[i].textContent || '');
    if (numNodes[i]) numNodes[i].textContent = String(i + 1);
  }
  if (steps.length === 0) return;

  var idx = 0;
  var mode = 'step';
  var badge = document.getElementById('stepBadge');
  var text = document.getElementById('stepText');
  var prevBtn = document.getElementById('prevBtn');
  var nextBtn = document.getElementById('nextBtn');
  var dotsWrap = document.getElementById('dots');
  var stepView = document.getElementById('stepView');
  var allView = document.getElementById('allView');
  var stepFooter = document.getElementById('stepFooter');
  var modeBtn = document.getElementById('toggleModeBtn');

  function render() {
    badge.textContent = 'Step ' + (idx + 1) + ' of ' + steps.length;
    text.textContent = steps[idx];
    prevBtn.disabled = idx === 0;
    nextBtn.disabled = idx >= steps.length - 1;
    dotsWrap.innerHTML = '';
    for (var j = 0; j < steps.length; j++) {
      (function(stepIdx) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = stepIdx === idx ? 'dot active' : 'dot';
        b.onclick = function() { idx = stepIdx; render(); };
        dotsWrap.appendChild(b);
      })(j);
    }
  }

  prevBtn.onclick = function() { if (idx > 0) { idx--; render(); } };
  nextBtn.onclick = function() { if (idx < steps.length - 1) { idx++; render(); } };

  if (modeBtn) {
    modeBtn.onclick = function() {
      mode = mode === 'step' ? 'all' : 'step';
      stepView.style.display = mode === 'step' ? 'flex' : 'none';
      stepFooter.style.display = mode === 'step' ? 'flex' : 'none';
      allView.style.display = mode === 'all' ? 'block' : 'none';
      modeBtn.textContent = mode === 'step' ? 'All Steps' : 'Step-by-Step';
    };
  }

  render();
})();

// Keep the Nest Hub awake past Google Cast's default ~10-minute idle timeout,
// while still exiting cleanly after 1 hour of inactivity (or immediately when swiped away).
(function() {
  if (!navigator.userAgent || navigator.userAgent.indexOf('CrKey') === -1) {
    return;
  }

  var IDLE_LIMIT_MS = 60 * 60 * 1000; // 1 hour
  var idleTimer = null;
  var receiverCtx = null;

  function resetIdleTimer() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(function() {
      if (receiverCtx && typeof receiverCtx.stop === 'function') {
        try {
          receiverCtx.stop();
        } catch (e) {}
      }
    }, IDLE_LIMIT_MS);
  }

  function startCastKeepAlive() {
    if (!window.cast || !window.cast.framework || !window.cast.framework.CastReceiverContext) {
      return;
    }
    try {
      receiverCtx = window.cast.framework.CastReceiverContext.getInstance();
      var options = new window.cast.framework.CastReceiverOptions();
      options.disableIdleTimeout = true;
      receiverCtx.start(options);
    } catch (e) {
      return;
    }

    resetIdleTimer();

    var lastReset = Date.now();
    function onUserActivity() {
      var now = Date.now();
      if (now - lastReset > 5000) {
        lastReset = now;
        resetIdleTimer();
      }
    }

    ['touchstart', 'pointerdown', 'click', 'scroll', 'keydown'].forEach(function(evt) {
      window.addEventListener(evt, onUserActivity, true);
    });
  }

  var script = document.createElement('script');
  script.src = 'https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js';
  script.async = true;
  script.onload = startCastKeepAlive;
  document.head.appendChild(script);
})();
</script>
</body>
</html>
`))

func handleCastRecipeView(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.DB == nil {
			c.String(http.StatusServiceUnavailable, "database is not configured")
			return
		}

		id, ok := parseIDParam(c)
		if !ok {
			return
		}

		rec, err := db.GetRecipe(c.Request.Context(), cfg.DB, id)
		if errors.Is(err, db.ErrNotFound) {
			c.String(http.StatusNotFound, "recipe not found")
			return
		}
		if err != nil {
			c.String(http.StatusInternalServerError, "failed to load recipe")
			return
		}

		ingredients := make([]castViewIngredient, 0, len(rec.Ingredients))
		for _, ing := range rec.Ingredients {
			amount := strings.TrimSpace(strings.TrimSpace(ing.Quantity) + " " + strings.TrimSpace(ing.Unit))
			ingredients = append(ingredients, castViewIngredient{
				Amount: amount,
				Name:   ing.Name,
			})
		}

		rawSteps := strings.Split(rec.Instructions, "\n\n")
		steps := make([]string, 0, len(rawSteps))
		for _, s := range rawSteps {
			if trimmed := strings.TrimSpace(s); trimmed != "" {
				steps = append(steps, trimmed)
			}
		}

		totalText := ""
		if rec.PrepMinutes > 0 && rec.CookMinutes > 0 {
			totalText = formatDurationMinutes(rec.PrepMinutes + rec.CookMinutes)
		}

		data := castViewData{
			Title:       rec.Title,
			Servings:    rec.Servings,
			PrepText:    formatDurationMinutes(rec.PrepMinutes),
			CookText:    formatDurationMinutes(rec.CookMinutes),
			TotalText:   totalText,
			Ingredients: ingredients,
			Steps:       steps,
		}

		c.Header("Content-Type", "text/html; charset=utf-8")
		c.Status(http.StatusOK)
		_ = castViewTmpl.Execute(c.Writer, data)
	}
}

func formatDurationMinutes(minutes int) string {
	if minutes <= 0 {
		return ""
	}
	if minutes < 60 {
		return fmt.Sprintf("%d min", minutes)
	}
	hrs := minutes / 60
	rem := minutes % 60
	if rem == 0 {
		return fmt.Sprintf("%d hr", hrs)
	}
	return fmt.Sprintf("%d hr %d min", hrs, rem)
}
