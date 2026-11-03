export function openExternalChat() {
  window.dispatchEvent(new Event('mrhustler:open-external-chat'));
}
