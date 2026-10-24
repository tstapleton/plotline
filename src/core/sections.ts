/** A run of steps started by one user action; section 0 is the setup before the first. */
export interface Section<T> {
  /** 0 for setup, then 1, 2, 3… for each user action. */
  number: number;
  /** For numbered sections, the user action is the first item. */
  items: T[];
}

/** Splits steps at each user action. */
export function splitSections<T>(items: T[], isUserAction: (item: T) => boolean): Section<T>[] {
  const sections: Section<T>[] = [{ number: 0, items: [] }];
  for (const item of items) {
    if (isUserAction(item)) sections.push({ number: sections.length, items: [item] });
    else sections[sections.length - 1]!.items.push(item);
  }
  return sections.filter((s) => s.items.length);
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

/** ① for 1 … ⑳ for 20, then (21). */
export function sectionMark(number: number): string {
  return CIRCLED[number - 1] ?? `(${number})`;
}
