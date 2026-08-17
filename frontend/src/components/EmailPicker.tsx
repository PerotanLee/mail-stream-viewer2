import type { EmailIndexItem } from "../types";

type Props = {
  emails: EmailIndexItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function EmailPicker({ emails, selectedId, onSelect }: Props) {
  const currentId = selectedId ?? emails[0]?.id ?? "";
  const index = emails.findIndex((item) => item.id === currentId);
  const current = index >= 0 ? index + 1 : 0;

  return (
    <label className="picker">
      <select
        lang="en"
        translate="yes"
        value={currentId}
        disabled={emails.length === 0}
        onChange={(event) => onSelect(event.target.value)}
        aria-label="メールの題名"
      >
        {emails.length === 0 ? (
          <option value="">未読なし</option>
        ) : (
          emails.map((item) => {
            const mark = item.is_read ? "" : "● ";
            return (
              <option key={item.id} value={item.id} lang="en">
                {mark}
                {item.subject || "(件名なし)"}
              </option>
            );
          })
        )}
      </select>
      <span className="mail-count" title="表示中 / 未読数">
        {current}/{emails.length}
      </span>
    </label>
  );
}
