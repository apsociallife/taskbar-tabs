let userInteracted = false;

function sendInteractionMessage() {
  console.log("sendInteractionMessage: userInteracted");
    if (!userInteracted) {
    userInteracted = true;
    browser.runtime.sendMessage({ type: "tabInteraction" });
  }
}

document.addEventListener("keydown", sendInteractionMessage);
document.addEventListener("click", sendInteractionMessage);
