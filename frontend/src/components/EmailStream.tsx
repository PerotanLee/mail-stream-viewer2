import type { EmailIndexItem, EmailRecord } from "../types";
import { MailFrame } from "./MailFrame";

type Props = {
  emails: EmailIndexItem[];
  records: Record<string, EmailRecord>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleRead: (id: string, isRead: boolean) => void;
};

export function EmailStream({ emails, records, selectedId, onSelect, onToggleRead }: Props) {
  const unread = emails.filter((item) => !item.is_read);
  if (unread.length === 0) {
    return <p className="empty notranslate" translate="no">直近1週間の未読メールはありません。</p>;
  }

  return (
    <>
      {unread.map((item) => {
        const record = records[item.id];
        const html = record?.body_html || "";

        return (
          <article
            key={item.id}
            id={`mail-${item.id}`}
            className={`mail-card ${item.id === selectedId ? "selected" : ""} ${item.is_read ? "" : "unread"}`}
            onClick={() => onSelect(item.id)}
          >
            <div className="card-head">
              <div>
                <h2 className="subject" lang="en" translate="yes">
                  {item.subject || "(件名なし)"}
                </h2>
                <div className="meta" lang="en" translate="yes">
                  {item.from_addr}
                  {item.date ? ` · ${item.date}` : ""}
                </div>
              </div>
            <div className="card-actions notranslate" translate="no">
                <button
                  type="button"
                  className="text-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleRead(item.id, true);
                  }}
                >
                  既読にする
                </button>
              </div>
            </div>
            {record ? (
              html ? (
                <MailFrame html={html} title={item.subject || "mail"} />
              ) : (
                <div className="body" lang="en" translate="yes">
                  {record.body_text || "(本文なし)"}
                </div>
              )
            ) : (
              <div className="meta notranslate" translate="no">本文を読み込み中…</div>
            )}
          </article>
        );
      })}
    </>
  );
}
