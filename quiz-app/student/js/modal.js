/**
 * Minimal modal helper. openModal(innerHtml, onMount) injects a backdrop +
 * modal card into #modal-root and calls onMount(modalEl) so callers can wire
 * up their own form listeners. closeModal() tears it down.
 */
function openModal(innerHtml, onMount) {
  closeModal();
  const root = document.getElementById("modal-root");
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "active-modal-backdrop";
  backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${innerHtml}</div>`;
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) closeModal();
  });
  root.appendChild(backdrop);
  const modalEl = backdrop.querySelector(".modal");
  if (onMount) onMount(modalEl);
  return modalEl;
}

function closeModal() {
  const existing = document.getElementById("active-modal-backdrop");
  if (existing) existing.remove();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});
