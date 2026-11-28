const controls = document.getElementById("controls");
const panel = document.getElementById("panel");
const toggle = document.getElementById("settings-toggle");
const minimap = document.getElementById("minimap");
const minimapToggle = document.getElementById("minimap-toggle");
const status = document.getElementById("status");
const indicator = document.getElementById("status-indicator");
const diagnostics = document.getElementById("diagnostics-section");
const retry = document.getElementById("retry");

function setOpen(open) {
  panel.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
}

toggle.addEventListener("click", () => setOpen(panel.hidden));
document.addEventListener("pointerdown", (event) => {
  if (!panel.hidden && !controls.contains(event.target)) {
    if (panel.contains(document.activeElement)) toggle.focus();
    setOpen(false);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !panel.hidden) {
    setOpen(false);
    toggle.focus();
    event.preventDefault();
  }
});
minimapToggle.addEventListener("click", () => {
  minimap.hidden = !minimap.hidden;
  minimapToggle.setAttribute("aria-pressed", String(!minimap.hidden));
});
indicator.addEventListener("click", () => {
  setOpen(true);
  diagnostics.open = true;
  diagnostics.querySelector("summary").focus();
});

function updateStatus() {
  const phase = status.dataset.phase;
  const fallback = /fallback|invalid coarse geometry/i.test(status.textContent);
  const kind =
    phase === "error"
      ? "error"
      : phase === "ready"
        ? fallback
          ? "warning"
          : "ready"
        : "loading";
  indicator.hidden = kind === "ready";
  indicator.dataset.kind = kind;
  indicator.textContent = {
    error: "Error",
    warning: "Warning",
    loading: "Loading…",
    ready: "",
  }[kind];
  indicator.title = status.textContent;
  retry.hidden = kind !== "error" && kind !== "warning";
}
new MutationObserver(updateStatus).observe(status, {
  attributes: true,
  attributeFilter: ["data-phase"],
  childList: true,
  characterData: true,
  subtree: true,
});
updateStatus();
