import { useMemo } from "react";
import { sanitizeHtml } from "../sanitize";

type Props = {
  html: string;
  title: string;
};

export function MailFrame({ html, title }: Props) {
  const inner = useMemo(() => toInlineMail(sanitizeHtml(html)), [html]);

  return (
    <div
      className="mail-html"
      lang="en"
      translate="yes"
      title={title}
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}

function toInlineMail(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, iframe, object, embed, form, link").forEach((node) => node.remove());
  doc.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    if (href.startsWith("#") || href.trim() === "") {
      anchor.removeAttribute("href");
      return;
    }
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });
  doc.querySelectorAll("[autofocus]").forEach((node) => node.removeAttribute("autofocus"));

  const styles = [...doc.querySelectorAll("style")]
    .map((node) => prefixCss(node.textContent || "", ".mail-html"))
    .filter(Boolean)
    .join("\n");
  doc.querySelectorAll("style").forEach((node) => node.remove());

  const body = doc.body?.innerHTML?.trim() || html;
  return (styles ? `<style>${styles}</style>` : "") + body;
}

function prefixCss(css: string, prefix: string): string {
  const parts: string[] = [];
  let i = 0;
  while (i < css.length) {
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? css.length : end + 2;
      continue;
    }
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const selector = css.slice(i, open).trim();
    if (!selector) {
      i = open + 1;
      continue;
    }
    if (
      selector.startsWith("@media") ||
      selector.startsWith("@supports") ||
      selector.startsWith("@container")
    ) {
      const close = matchingBrace(css, open);
      const inner = css.slice(open + 1, close);
      parts.push(`${selector}{${prefixCss(inner, prefix)}}`);
      i = close + 1;
      continue;
    }
    if (
      selector.startsWith("@keyframes") ||
      selector.startsWith("@-") ||
      selector.startsWith("@font-face") ||
      selector.startsWith("@import") ||
      selector.startsWith("@charset") ||
      selector.startsWith("@layer")
    ) {
      const close = matchingBrace(css, open);
      parts.push(css.slice(i, close + 1).trim());
      i = close + 1;
      continue;
    }
    const close = css.indexOf("}", open);
    if (close < 0) break;
    const body = css.slice(open + 1, close);
    const prefixed = selector
      .split(",")
      .map((item) => prefixSelector(item.trim(), prefix))
      .filter(Boolean)
      .join(", ");
    parts.push(`${prefixed}{${body}}`);
    i = close + 1;
  }
  return parts.join("\n");
}

function matchingBrace(css: string, open: number): number {
  let depth = 1;
  for (let i = open + 1; i < css.length; i++) {
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? css.length : end + 1;
      continue;
    }
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return css.length - 1;
}

function prefixSelector(selector: string, prefix: string): string {
  if (!selector) return selector;
  if (selector.startsWith(prefix)) return selector;
  if (/^(html|body|:root)$/i.test(selector)) return prefix;
  const replaced = selector.replace(/^(html|body|:root)(?=[\s>+~.#:[*]|$)/i, prefix);
  if (replaced.startsWith(prefix)) return replaced;
  return `${prefix} ${selector}`;
}
