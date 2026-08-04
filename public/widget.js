/* Morris Pools chat widget loader.
   Embed on any site with:
   <script src="https://YOUR-APP-URL/widget.js" async></script> */
(function () {
  if (window.__morrisPoolsWidget) return;
  window.__morrisPoolsWidget = true;

  var script = document.currentScript;
  var origin;
  try {
    origin = new URL(script.src).origin;
  } catch (e) {
    return;
  }

  var open = false;

  var button = document.createElement("button");
  button.setAttribute("aria-label", "Chat with Morris Pools");
  button.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
  button.style.cssText =
    "position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;" +
    "background:#0b6ea8;border:none;cursor:pointer;z-index:999999;" +
    "box-shadow:0 4px 14px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;";

  var frame = document.createElement("iframe");
  frame.src = origin + "/widget";
  frame.title = "Morris Pools chat";
  frame.style.cssText =
    "position:fixed;bottom:90px;right:20px;width:370px;height:540px;max-width:calc(100vw - 32px);" +
    "max-height:calc(100vh - 110px);border:none;border-radius:14px;z-index:999999;" +
    "box-shadow:0 8px 30px rgba(0,0,0,0.3);display:none;background:#fff;";

  button.addEventListener("click", function () {
    open = !open;
    frame.style.display = open ? "block" : "none";
    button.innerHTML = open
      ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
      : '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
  });

  function mount() {
    document.body.appendChild(frame);
    document.body.appendChild(button);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
