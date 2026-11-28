export function mountControls(root) {
  const lifetime = new AbortController();
  const get = (id) => root.querySelector(`#${id}`);
  const listen = (target, type, fn) => target.addEventListener(type, fn, { signal: lifetime.signal });
  const controls = get("controls");
  const panel = get("panel");
  const toggle = get("settings-toggle");
  const minimap = get("minimap");
  const minimapToggle = get("minimap-toggle");
  const status = get("status");
  const indicator = get("status-indicator");
  const diagnostics = get("diagnostics-section");
  const retry = get("retry");

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  }

  listen(toggle, "click", () => setOpen(panel.hidden));
  listen(document, "pointerdown", (event) => {
    if (!panel.hidden && !controls.contains(event.target)) {
      if (panel.contains(document.activeElement)) toggle.focus();
      setOpen(false);
    }
  });
  listen(document, "keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      setOpen(false);
      toggle.focus();
      event.preventDefault();
    }
  });
  listen(minimapToggle, "click", () => {
    minimap.hidden = !minimap.hidden;
    minimapToggle.setAttribute("aria-pressed", String(!minimap.hidden));
  });
  listen(indicator, "click", () => {
    setOpen(true);
    diagnostics.open = true;
    diagnostics.querySelector("summary").focus();
  });

  function updateStatus() {
    const phase = status.dataset.phase;
    const fallback = /fallback|invalid coarse geometry/i.test(status.textContent);
    const kind = phase === "error" ? "error" : phase === "ready"
      ? (fallback ? "warning" : "ready") : "loading";
    indicator.hidden = kind === "ready";
    indicator.dataset.kind = kind;
    indicator.textContent = { error: "Error", warning: "Warning", loading: "Loading…", ready: "" }[kind];
    indicator.title = status.textContent;
    retry.hidden = kind !== "error" && kind !== "warning";
  }
  const observer = new MutationObserver(updateStatus);
  observer.observe(status, {
    attributes: true,
    attributeFilter: ["data-phase"],
    childList: true,
    characterData: true,
    subtree: true,
  });
  updateStatus();

  return () => { lifetime.abort(); observer.disconnect(); };
}
