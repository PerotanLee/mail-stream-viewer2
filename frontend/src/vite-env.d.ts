/// <reference types="vite/client" />

interface Window {
  googleTranslateElementInit?: () => void;
  google?: {
    translate: {
      TranslateElement: new (
        options: {
          pageLanguage: string;
          includedLanguages?: string;
          autoDisplay?: boolean;
        },
        id: string,
      ) => void;
    };
  };
}
