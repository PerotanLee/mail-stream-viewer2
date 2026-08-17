export type DisplayLang = "ja" | "en";

export type AppSettings = {
  senderFilter: string;
  zoom: number;
  displayLang: DisplayLang;
  pop3Host: string;
  pop3Port: string;
  pop3User: string;
  pop3Ssl: boolean;
};

export type Connection = {
  owner: string;
  repo: string;
  token: string;
  branch: string;
};

export type EmailIndexItem = {
  id: string;
  uid: string;
  from_addr: string;
  subject: string;
  subject_ja: string;
  date: string;
  is_read: boolean;
  file: string;
};

export type EmailIndex = {
  emails: EmailIndexItem[];
};

export type EmailRecord = EmailIndexItem & {
  body_text: string;
  body_text_ja: string;
  body_html: string;
};

export type PageDownPos = {
  x: number;
  y: number;
};
