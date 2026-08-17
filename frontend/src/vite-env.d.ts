/// <reference types="vite/client" />

interface Translator {
  translate(input: string): Promise<string>;
}

interface TranslatorCreateOptions {
  sourceLanguage: string;
  targetLanguage: string;
}

interface TranslatorConstructor {
  create(options: TranslatorCreateOptions): Promise<Translator>;
  availability?(options: TranslatorCreateOptions): Promise<string>;
}

interface Window {
  Translator?: TranslatorConstructor;
}
