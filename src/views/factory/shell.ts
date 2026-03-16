import type { FactoryShellOpts } from "./types.js";

export const factoryShell = (opts: FactoryShellOpts): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Factory</title>
    <link rel="stylesheet" href="/assets/factory.css" />
    <script src="/assets/htmx.min.js"></script>
    <script src="https://unpkg.com/htmx-ext-sse@2.2.1/sse.js"></script>
    <script src="https://unpkg.com/htmx-ext-morph@2.0.0/morph.js"></script>
    <script>
      document.addEventListener("DOMContentLoaded", () => {
        bindComposeButtons();
        setTimeout(() => {
          document.body.setAttribute("sse-connect", "/factory/events");
          htmx.process(document.body);
        }, 2500);
      });
      document.addEventListener("htmx:afterSwap", (event) => {
        bindComposeButtons();
      });
      const deriveTitle = (prompt) => {
        const text = (prompt || "").replace(/\\s+/g, " ").trim();
        if (!text) return "";
        const firstSentence = text.split(/[.!?]/)[0] || text;
        return firstSentence.slice(0, 96).trim();
      };
      document.addEventListener("submit", (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        const prompt = form.querySelector('textarea[name="prompt"]');
        const title = form.querySelector('input[name="title"]');
        if (prompt instanceof HTMLTextAreaElement && title instanceof HTMLInputElement && !title.value.trim()) {
          title.value = deriveTitle(prompt.value);
        }
      });
      const bindComposeButtons = () => {
        document.querySelectorAll("[data-compose-open]").forEach((btn) => {
          if (btn.dataset.bound) return;
          btn.dataset.bound = "1";
          btn.addEventListener("click", () => document.body.classList.add("compose-open"));
        });
        document.querySelectorAll("[data-compose-close]").forEach((btn) => {
          if (btn.dataset.bound) return;
          btn.dataset.bound = "1";
          btn.addEventListener("click", () => document.body.classList.remove("compose-open"));
        });
      };
    </script>
  </head>
  <body hx-ext="sse,morph">
    <div class="factory-layout">
      <div id="factory-board-wrap"
           hx-trigger="sse:receipt-refresh throttle:2s"
           hx-get="/factory/island/board"
           hx-vals='js:{objective: new URLSearchParams(window.location.search).get("objective") || ""}'
           hx-swap="morph:innerHTML">
        ${opts.boardIsland}
      </div>
      <div id="factory-stream-wrap"
           hx-trigger="sse:receipt-refresh throttle:800ms, sse:job-refresh throttle:500ms"
           hx-get="/factory/island/stream"
           hx-vals='js:{objective: new URLSearchParams(window.location.search).get("objective") || ""}'
           hx-swap="morph:innerHTML">
        ${opts.streamIsland}
      </div>
      <div id="factory-context-wrap" class="inspector-aside"
           hx-trigger="sse:receipt-refresh throttle:2s, sse:job-refresh throttle:2s"
           hx-get="/factory/island/context"
           hx-vals='js:{objective: new URLSearchParams(window.location.search).get("objective") || ""}'
           hx-swap="morph:innerHTML">
        ${opts.contextIsland}
      </div>
    </div>
    ${opts.composeIsland}
  </body>
</html>
`;
