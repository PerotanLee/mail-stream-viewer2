import type { DisplayLang, EmailIndexItem } from "../types";

type Props = {
  emails: EmailIndexItem[];
  selectedId: string | null;
  displayLang: DisplayLang;
  translatedSubjects: Record<string, string>;
  onSelect: (id: string) => void;
};

export function EmailList({ emails, selectedId, displayLang, translatedSubjects, onSelect }: Props) {
  if (emails.length === 0) {
    return <p className="empty">まだメールがありません。送信元を設定して「更新」を押してください。</p>;
  }

  return (
    <div>
      {emails.map((item) => {
        const subject =
          displayLang === "ja"
            ? item.subject_ja || translatedSubjects[item.id] || item.subject
            : item.subject;
        return (
          <button
            key={item.id}
            type="button"
            className={`mail-item ${item.id === selectedId ? "active" : ""} ${item.is_read ? "" : "unread"}`}
            onClick={() => onSelect(item.id)}
          >
            {!item.is_read ? <span className="badge">未読</span> : null}
            <div className="subject">{subject || "(件名なし)"}</div>
            <div className="meta">
              {item.from_addr}
              {item.date ? ` · ${item.date}` : ""}
            </div>
          </button>
        );
      })}
    </div>
  );
}
