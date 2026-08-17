import DOMPurify from "dompurify";

export function sanitizeHtml(html: string): string {
  const httpsHtml = html.replace(/(\s(?:src|href)=["']?)http:\/\//gi, "$1https://");
  return DOMPurify.sanitize(httpsHtml, {
    WHOLE_DOCUMENT: true,
    USE_PROFILES: { html: true },
    ADD_TAGS: ["style", "link", "meta", "title"],
    ADD_ATTR: [
      "target",
      "width",
      "height",
      "style",
      "class",
      "id",
      "cellpadding",
      "cellspacing",
      "align",
      "valign",
      "bgcolor",
      "background",
      "role",
      "border",
      "colspan",
      "rowspan",
      "srcset",
      "sizes",
      "usemap",
    ],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "video", "audio"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus"],
  });
}
