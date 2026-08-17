import type { DisplayLang, EmailIndexItem, EmailRecord } from "../types";
import { sanitizeHtml } from "../sanitize";

type Props = {
  emails: EmailIndexItem[];
  records: Record<string, EmailRecord>;
  selectedId: string | null;
  displayLang: DisplayLang;
  translatedSubjects: Record<string, string>;
  translatedBodies: Record<string, string>;
  onSelect: (id: string) => void;
  onToggleRead: (id: string, isRead: boolean) => void;
};

export function EmailStream({
  emails,
  records,
  selectedId,
  displayLang,
  translatedSubjects,
  translatedBodies,
  onSelect,
  onToggleRead,
}: Props) {
  if (emails.length === 0) {
    return <p className="empty">ストリームは空です。</p>;
  }

  return (
    <>
      {emails.map((item) => {
        const record = records[item.id];
        const subject =
          displayLang === "ja"
            ? item.subject_ja || translatedSubjects[item.id] || item.subject
            : item.subject;
        const bodyJa = record?.body_text_ja || translatedBodies[item.id] || "";
        const showJa = displayLang === "ja";
        const html = !showJa && record?.body_html ? sanitizeHtml(record.body_html) : "";

        return (
          <article
            key={item.id}
            className={`mail-card ${item.id === selectedId ? "selected" : ""} ${item.is_read ? "" : "unread"}`}
            onClick={() => onSelect(item.id)}
          >
            <div className="card-head">
              <div>
                {!item.is_read ? <span className="badge">未読</span> : null}
                <h2 className="subject" lang={showJa ? "ja" : "en"}>
                  {subject || "(件名なし)"}
                </h2>
                <div className="meta">
                  {item.from_addr}
                  {item.date ? ` · ${item.date}` : ""}
                </div>
              </div>
              <div className="card-actions">
                <button
                  type="button"
                  className="text-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleRead(item.id, !item.is_read);
                  }}
                >
                  {item.is_read ? "未読に戻す" : "既読にする"}
                </button>
              </div>
            </div>
            {record ? (
              showJa ? (
                <div className="body" lang="ja" translate="no">
                  {bodyJa || record.body_text || "（訳文はまだありません。原文表示に切り替えるか、再更新してください）"}
                </div>
              ) : html ? (
                <div
                  className="body html"
                  lang="en"
                  translate="yes"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              ) : (
                <div className="body" lang="en" translate="yes">
                  {record.body_text || "(本文なし)"}
                </div>
              )
            ) : (
              <div className="meta">本文を読み込み中…</div>
            )}
          </article>
        );
      })}
    </>
  );
}
