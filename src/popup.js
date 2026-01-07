document.addEventListener("DOMContentLoaded", () => {
  const totalMessagesElement = document.getElementById("statTotalMessages");
  const renderedMessagesElement = document.getElementById("statRenderedMessages");
  const memorySavedElement = document.getElementById("statMemorySaved");
  const statusElement = document.getElementById("statStatus");

  const toggleEnabledElement = document.getElementById("toggleEnabled");
  const toggleDebugElement = document.getElementById("toggleDebug");

  // Helper: Update status text immediately
  function updateStatusText(enabled) {
    statusElement.textContent = enabled ? "Active" : "Disabled";
    statusElement.classList.toggle("status-active", enabled);
    statusElement.classList.toggle("status-disabled", !enabled);
  }

  // Initial loading of stored settings
  chrome.storage.sync.get({ enabled: true, debug: false }, (data) => {
    toggleEnabledElement.checked = data.enabled;
    toggleDebugElement.checked = data.debug;

    updateStatusText(data.enabled);
  });

  // On change → update immediately AND save
  toggleEnabledElement.addEventListener("change", () => {
    const newValue = toggleEnabledElement.checked;

    updateStatusText(newValue);

    chrome.storage.sync.set({ enabled: newValue });
  });

  toggleDebugElement.addEventListener("change", () => {
    const newValue = toggleDebugElement.checked;
    chrome.storage.sync.set({ debug: newValue });
  });

  // Fetch stats from content script
function updateStatsUI() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (!activeTab || activeTab.id == null) return;

    const url = activeTab.url || "";
    const isChatGPTTab =
      url.startsWith("https://chat.openai.com/") ||
      url.startsWith("https://chatgpt.com/");

    // Don't try to talk to tabs where our content script doesn't run
    if (!isChatGPTTab) {
      // Optionally show "N/A" or "Disabled" when not on ChatGPT
      totalMessagesElement.textContent = "0";
      renderedMessagesElement.textContent = "0";
      memorySavedElement.textContent = "0%";
      updateStatusText(false);
      return;
    }

    chrome.tabs.sendMessage(
      activeTab.id,
      { type: "getStats" },
      (response) => {
        if (chrome.runtime.lastError) {
          // Content script not injected yet or tab reloaded; just ignore
          console.debug(
            "[ChatGPT LagFix] No stats available:", chrome.runtime.lastError.message
          );
          return;
        }

        if (!response) return;

        const {
          totalMessages,
          renderedMessages,
          memorySavedPercent,
          enabled
        } = response;

        totalMessagesElement.textContent = String(totalMessages);
        renderedMessagesElement.textContent = String(renderedMessages);
        memorySavedElement.textContent = `${memorySavedPercent}%`;
        updateStatusText(enabled);
      }
    );
  });
}

  updateStatsUI();

  // -------------------------------------------------------------------------
  // Heart Animation Logic
  // -------------------------------------------------------------------------
  function initHeartAnimation() {
    const card = document.querySelector(".support-card");
    if (!card) return;

    function spawnHeart() {
      const heart = document.createElement("div");
      heart.classList.add("heart-float");
      heart.textContent = "❤️";

      // Random properties for organic feel
      const randomLeft = Math.floor(Math.random() * 80) + 10; // 10% to 90%
      const randomDuration = Math.random() * 1.5 + 2; // 2s to 3.5s
      const randomSize = Math.floor(Math.random() * 8) + 10; // 10px to 18px

      heart.style.left = `${randomLeft}%`;
      heart.style.fontSize = `${randomSize}px`;
      heart.style.animationDuration = `${randomDuration}s`;

      card.appendChild(heart);

      // Cleanup
      setTimeout(() => {
        heart.remove();
      }, randomDuration * 1000);
    }

    // Spawn hearts regularly
    setInterval(spawnHeart, 1200);
    // Spawn one immediately
    spawnHeart();
  }

  initHeartAnimation();
});
