# PRODUCT.md — VersionLens

## Register

**Product.** Every surface is a working tool: an upload step, a review workspace, a
settings panel. Design serves the task of verifying what changed between two contracts.
There is no marketing surface.

## What it is

A document comparison instrument. A reviewer opens two versions of a proposal or contract
and gets a structured, traceable change review — what changed, where, what it said before,
what it says now, and whether it deserves attention — with every claim anchored to a
citation in both source documents.

It runs entirely in the browser. Documents are never uploaded.

## Users and context

**Primary:** procurement leads, contract managers, legal teams doing a first pass, and
business owners reviewing a supplier's revised terms.

**The scene:** a procurement lead at a desk in an open-plan office at 3pm, comparing a
supplier's revised agreement against last month's version before a 4pm call, needing to be
certain about six numbers. Daylight. Sustained focus. High stakes on small details.

**The job:** move from *"something changed in this document"* to *"section 6.2 changed the
payment period from 30 days to 60 days — here is the text from both versions and the pages
they came from."*

The primary task on every screen is **verification**, not discovery. The user is checking
the tool's work, not browsing.

## Principles

1. **Evidence sits beside every claim.** A summary the user cannot immediately check
   against the source is worse than no summary. Never separate an assertion from its
   citation.
2. **Precision is the product.** Figures, deltas, hashes and clause references are the
   payload. They get a typographic register of their own and must be comparable character
   by character.
3. **The interface should disappear into the task.** A reviewer is mid-contract, not
   admiring the UI. Earned familiarity over invention.
4. **Say what is uncertain.** Low-confidence extraction, estimated page numbers and
   machine-read text are labelled, never smoothed over.
5. **Review priority, never legal risk.** The tool flags what deserves a look. It does not
   advise.

## Personality

**Forensic. Exact. Unhurried.**

Closer to an instrument than an assistant. It states findings plainly and shows its
working. It never performs confidence it has not earned, and it never hurries the reader.

## Anti-references

- **Chatbot UI.** The product doc is explicit: a review workspace, not a conversation. No
  assistant framing, no message bubbles, no typing indicators.
- **AI-dashboard aesthetic.** No dark gradients, glow, neon, emoji section markers, or
  hero-metric templates.
- **Warm paper / cream editorial.** The obvious second-order move for "legal document tool
  that isn't corporate navy" is parchment, serif everywhere, sepia restraint. Rejected: it
  reads as costume, and warm near-whites are the saturated default.
- **Traffic-light risk theatre.** Competitors colour-code clauses red/amber/green by risk.
  That implies a legal judgement this tool explicitly does not make.

## Accessibility

- Attention levels and change types carry a **word and a mark**, never colour alone.
- Full keyboard operation of the review loop: move between changes, confirm, reject, jump
  to the citation, without touching the mouse.
- Visible focus on everything interactive. Body text ≥4.5:1.
- `prefers-reduced-motion` respected throughout.
- Dark mode is a working requirement, not a preference: contract review happens late.
