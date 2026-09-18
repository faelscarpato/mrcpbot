declare module "@octokit/rest" {
  export interface OctokitOptions {
    authStrategy?: unknown;
    auth?: {
      appId?: string;
      privateKey?: string;
      installationId?: number;
    };
  }

  export class Octokit {
    constructor(options?: OctokitOptions);
    repos: {
      getContent(params: {
        owner: string;
        repo: string;
        path: string;
      }): Promise<{ data: unknown }>;
    };
  }
}

declare module "@octokit/auth-app" {
  export const createAppAuth: unknown;
}

declare module "@octokit/webhooks" {
  export interface WebhookOptions {
    secret: string;
  }
  export interface VerifyAndReceiveOptions {
    id: string;
    name: string;
    payload: unknown;
    signature: string;
  }
  export class Webhooks {
    constructor(options: WebhookOptions);
    on<T = unknown>(
      event: string,
      callback: (args: { payload: T }) => void | Promise<void>,
    ): void;
    verifyAndReceive(options: VerifyAndReceiveOptions): Promise<void>;
  }
}

declare module "mammoth" {
  export interface ConvertToHtmlOptions {
    buffer?: Buffer;
    path?: string;
  }
  export interface ExtractRawTextOptions {
    buffer?: Buffer;
    path?: string;
  }
  export function convertToHtml(
    options: ConvertToHtmlOptions,
  ): Promise<{ value: string; messages?: unknown[] }>;
  export function extractRawText(
    options: ExtractRawTextOptions,
  ): Promise<{ value: string; messages?: unknown[] }>;
}

declare module "xlsx" {
  export interface Sheet {
    [cell: string]: unknown;
  }
  export interface WorkBook {
    SheetNames: string[];
    Sheets: Record<string, Sheet>;
  }
  export interface Sheet2JSONOpts {
    header?: number | string[];
    range?: unknown;
  }
  export const utils: {
    sheet_to_json<T = unknown[]>(sheet: Sheet, opts?: Sheet2JSONOpts): T[];
  };
  export function read(data: unknown, opts?: { type?: string }): WorkBook;
}

declare module "pdf-parse" {
  export interface PDFData {
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
    text: string;
  }
  export default function pdf(
    dataBuffer: Buffer,
    options?: unknown,
  ): Promise<PDFData>;
}

declare module "unified" {
  export interface Processor {
    use(plugin: unknown, ...settings: unknown[]): Processor;
    parse(doc: unknown): unknown;
    process(doc: unknown): Promise<unknown>;
  }
  export function unified(): Processor;
}

declare module "remark-parse" {
  const remarkParse: unknown;
  export default remarkParse;
}

declare module "compromise" {
  export interface CompromiseDoc {
    nouns(): { out(format: string): Array<{ normal: string }> };
    topics(): { out(format: string): Array<{ normal: string }> };
  }
  export default function nlp(text: string): CompromiseDoc;
}
