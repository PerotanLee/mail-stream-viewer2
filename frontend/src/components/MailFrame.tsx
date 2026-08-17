import { useEffect, useRef } from "react";
import { sanitizeHtml } from "../sanitize";

type Props = {
  html: string;
  title: string;
};

export function MailFrame({ html, title }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const srcDoc = wrapHtml(sanitizeHtml(html));

  function resize() {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc?.documentElement) return;
    const height = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0, 240);
    frame.style.height = `${height}px`;
  }

  useEffect(() => {
    const timer = window.setInterval(resize, 700);
    const stop = window.setTimeout(() => window.clearInterval(timer), 10000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [srcDoc]);

  return (
    <iframe
      ref={frameRef}
      className="mail-frame"
      title={title}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer-when-downgrade"
      srcDoc={srcDoc}
      onLoad={resize}
    />
  );
}

function wrapHtml(html: string): string {
  const trimmed = html.trim();
  const hasRoot = /<html[\s>]/i.test(trimmed);
  const extra = `<style>img{max-width:100%;height:auto;}body{margin:0;}</style>`;
  if (hasRoot) {
    if (/<\/head>/i.test(trimmed)) {
      return trimmed.replace(/<\/head>/i, `${extra}</head>`);
    }
    return extra + trimmed;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${extra}</head><body>${trimmed}</body></html>`;
}
