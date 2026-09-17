declare module "page-flip/dist/js/page-flip.module.js" {
  export class PageFlip {
    constructor(element: HTMLElement, settings: Record<string, unknown>);
    loadFromHTML(items: NodeListOf<HTMLElement> | HTMLElement[]): void;
    destroy(): void;
    update(): void;
    flipNext(corner?: "top" | "bottom"): void;
    flipPrev(corner?: "top" | "bottom"): void;
    on(event: string, callback: (event: { data: unknown }) => void): this;
    getCurrentPageIndex(): number;
    getState(): string;
  }
}
