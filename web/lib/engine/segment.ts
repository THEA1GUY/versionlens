/** Blocks -> nested section tree, every block assigned to exactly one section. */

import type { Block, DocumentModel, Section } from "./model";
import { headingNumber, normalizeHeading } from "./normalize";

function headingBody(text: string, num: string | null): string {
  let body = text.trim();
  if (num) body = body.slice(num.length).replace(/^[.)\s\t]+/, "");
  return body.trim() || "(untitled)";
}

/** Unnumbered headings sit one level below the nearest open ancestor. */
function implicitLevel(stack: Section[]): number {
  const top = stack[stack.length - 1];
  return top ? top.level + 1 : 1;
}

export function segment(doc: DocumentModel): DocumentModel {
  const sections: Section[] = [];
  const stack: Section[] = [];
  let order = 0;

  const firstPage = doc.pages[0]?.pageNumber ?? 1;
  const preamble: Section = {
    id: "s0",
    side: doc.side,
    sectionNumber: null,
    heading: "(preamble)",
    normalizedHeading: "",
    orderIndex: 0,
    startPage: firstPage,
    endPage: firstPage,
    parentId: null,
    level: 0,
    blockIds: [],
  };
  sections.push(preamble);
  let current: Section = preamble;

  for (const block of doc.blocks) {
    if (block.blockType === "heading") {
      order += 1;
      const num = headingNumber(block.text);
      const level = num ? num.split(".").length : implicitLevel(stack);

      while (stack.length > 0 && (stack[stack.length - 1] as Section).level >= level) {
        stack.pop();
      }
      const parent = stack[stack.length - 1];

      const section: Section = {
        id: `s${order}`,
        side: doc.side,
        sectionNumber: num,
        heading: headingBody(block.text, num),
        normalizedHeading: normalizeHeading(block.text),
        orderIndex: order,
        startPage: block.page,
        endPage: block.page,
        parentId: parent ? parent.id : null,
        level,
        blockIds: [],
      };
      sections.push(section);
      stack.push(section);
      current = section;

      // The heading line itself belongs to its own section.
      block.sectionId = section.id;
      section.blockIds.push(block.id);
      continue;
    }

    block.sectionId = current.id;
    current.blockIds.push(block.id);
    current.endPage = Math.max(current.endPage, block.page);
    for (const ancestor of stack) {
      ancestor.endPage = Math.max(ancestor.endPage, block.page);
    }
  }

  doc.sections = preamble.blockIds.length > 0 ? sections : sections.filter((s) => s !== preamble);
  return doc;
}

export function blocksOfSection(doc: DocumentModel, section: Section): Block[] {
  const byId = new Map(doc.blocks.map((b) => [b.id, b]));
  const out: Block[] = [];
  for (const id of section.blockIds) {
    const b = byId.get(id);
    if (b) out.push(b);
  }
  return out;
}
