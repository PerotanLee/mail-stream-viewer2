import type { DisplayLang, EmailIndexItem } from "../types";

type Props = {
  emails: EmailIndexItem[];
  selectedId: string | null;
  displayLang: DisplayLang;
  translatedSubjects: Record<string, string>;
  onSelect: (id: string) => void;
};

export function EmailPicker({ emails, selectedId, displayLang, translatedSubjects, onSelect }: Props) {
  if (emails.length === 0) {
    return <p className="picker-empty">まだメールがありません。設定して「更新」を押してください。</p>;
  }

  return (
    <label className="picker">
      <span className="picker-label">題名</span>
      <select
        value={selectedId ?? emails[0]?.id ?? ""}
        onChange={(event) => onSelect(event.target.value)}
        aria-label="メールの題名"
      >
        {emails.map((item) => {
          const subject =
            displayLang === "ja"
              ? item.subject_ja || translatedSubjects[item.id] || item.subject
              : item.subject;
          const mark = item.is_read ? "" : "● ";
          return (
            <option key={item.id} value={item.id}>
              {mark}
              {subject || "(件名なし)"}
            </option>
          );
        })}
      </select>
    </label>
  );
}
