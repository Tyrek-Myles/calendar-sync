console.log("ChatSync content script loaded.");

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === "GET_CHAT_TEXT") {
    const text = getLastAssistantMessageText();
    sendResponse({ text });
    return false; // sync response
  }
  return false;
});

/**
 * Try multiple strategies to grab the last AI message.
 * 1) Preferred: elements with data-message-author-role="assistant".
 * 2) Fallback: last big block of text inside <main> (p/li/div) near the bottom.
 */
function getLastAssistantMessageText() {
  // Strategy 1: official assistant nodes
  let assistantNodes = document.querySelectorAll(
    '[data-message-author-role="assistant"]'
  );

  if (assistantNodes && assistantNodes.length > 0) {
    const lastNode = assistantNodes[assistantNodes.length - 1];
    const text = lastNode.innerText || lastNode.textContent || "";
    console.log(
      "ChatSync: extracted assistant text from data-message-author-role:",
      text.slice(0, 200)
    );
    return text.trim();
  }

  console.warn(
    "ChatSync: No [data-message-author-role='assistant'] nodes found. Using fallback."
  );

  // Strategy 2: fallback – grab text from the bottom of the main chat area
  const main = document.querySelector("main");
  if (!main) {
    console.warn("ChatSync: No <main> element found.");
    return "";
  }

  // Get all text-ish nodes in main
  const blocks = main.querySelectorAll("p, li, div");
  if (!blocks || blocks.length === 0) {
    console.warn("ChatSync: No text blocks found in <main>.");
    return "";
  }

  // Take the last ~80 blocks and join them; user can trim in UI
  const sliceStart = Math.max(0, blocks.length - 80);
  const tailBlocks = Array.from(blocks).slice(sliceStart);

  const fallbackText = tailBlocks
    .map((el) => el.innerText || el.textContent || "")
    .join("\n")
    .trim();

  console.log(
    "ChatSync: extracted fallback text from <main>:",
    fallbackText.slice(0, 200)
  );

  return fallbackText;
}
