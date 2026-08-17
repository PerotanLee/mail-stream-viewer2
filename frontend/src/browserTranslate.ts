const APP_TITLE = "Logiris2";

function lockAppTitle() {
  const titleEl = document.querySelector("title");
  if (titleEl) {
    titleEl.classList.add("notranslate");
    titleEl.setAttribute("translate", "no");
    if (titleEl.textContent !== APP_TITLE) titleEl.textContent = APP_TITLE;
  }
  if (document.title !== APP_TITLE) document.title = APP_TITLE;
}

function watchAppTitle() {
  lockAppTitle();
  const observer = new MutationObserver(() => lockAppTitle());
  observer.observe(document.head, { subtree: true, childList: true, characterData: true });
}
let retryTimer = 0;

function setTranslateCookie() {
  const path = location.pathname.replace(/\/?[^/]*$/, "") || "/";
  const value = "googtrans=/en/ja";
  document.cookie = `${value};path=/`;
  document.cookie = `${value};path=${path === "" ? "/" : path}`;
}

function selectJapanese() {
  const combo = document.querySelector<HTMLSelectElement>(".goog-te-combo");
  if (!combo) return false;
  if (combo.value !== "ja") {
    combo.value = "ja";
    combo.dispatchEvent(new Event("change"));
  }
  return combo.value === "ja";
}

export function ensureTranslated() {
  window.clearTimeout(retryTimer);
  let tries = 0;
  const tick = () => {
    if (selectJapanese()) {
      lockAppTitle();
      return;
    }
    tries += 1;
    if (tries < 24) retryTimer = window.setTimeout(tick, 500);
  };
  retryTimer = window.setTimeout(tick, 400);
}

export function startPageTranslate() {
  if (started) return;
  started = true;
  setTranslateCookie();
  watchAppTitle();

  const host = document.createElement("div");
  host.id = "google_translate_element";
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);

  window.googleTranslateElementInit = () => {
    if (!window.google?.translate) return;
    new window.google.translate.TranslateElement(
      {
        pageLanguage: "en",
        includedLanguages: "ja",
        autoDisplay: false,
      },
      "google_translate_element",
    );
    ensureTranslated();
  };

  const script = document.createElement("script");
  script.id = "google-translate-script";
  script.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
  script.async = true;
  document.body.appendChild(script);
}
