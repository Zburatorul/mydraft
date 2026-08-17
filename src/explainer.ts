import { parse as parseYaml } from "yaml";

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => !!value && typeof value === "object" && !Array.isArray(value);
const requireText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be non-empty text`);
  return value.trim();
};
const optionalText = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const requireList = (value: unknown, field: string): unknown[] => {
  if (!Array.isArray(value) || !value.length) throw new Error(`${field} must be a non-empty list`);
  return value;
};
const escapeHtml = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const statusClass = (value: unknown) => optionalText(value)?.toLowerCase().replace(/[^a-z0-9-]+/g, "-") ?? "unspecified";
const requireChoice = (value: unknown, field: string, choices: readonly string[]): string => {
  const selected = requireText(value, field).toLowerCase();
  if (!choices.includes(selected)) throw new Error(`${field} must be one of: ${choices.join(", ")}`);
  return selected;
};

const EVIDENCE_STATUSES = ["measured", "communicated", "derived", "assumed", "speculative"] as const;
const SYNCHRONIZATION_STATUSES = ["measured", "communicated", "derived", "assumed"] as const;

class TargetIds {
  #ids = new Set<string>();

  add(value: unknown, field: string): string {
    const id = requireText(value, field);
    if (!/^[A-Za-z][\w.-]*$/.test(id)) throw new Error(`${field} must start with a letter and contain only letters, numbers, ., _, or -`);
    if (this.#ids.has(id)) throw new Error(`duplicate explainer id: ${id}`);
    this.#ids.add(id);
    return id;
  }
}

const targetAttr = (id: string) => `data-myd-target="${escapeHtml(id)}"`;

function renderTiming(section: UnknownRecord, ids: TargetIds, sectionIndex: number): string {
  const id = ids.add(section.id, `sections[${sectionIndex}].id`);
  const title = optionalText(section.title) ?? "Decision timing";
  const parties = requireList(section.parties, `${id}.parties`).map((party, index) => requireText(party, `${id}.parties[${index}]`));
  const events = requireList(section.events, `${id}.events`).map((value, eventIndex) => {
    if (!isRecord(value)) throw new Error(`${id}.events[${eventIndex}] must be an object`);
    const eventId = ids.add(value.id, `${id}.events[${eventIndex}].id`);
    const party = requireText(value.party, `${eventId}.party`);
    if (!parties.includes(party)) throw new Error(`${eventId} names unknown party ${party}`);
    const observes = optionalText(value.observes);
    if (!observes) throw new Error(`${eventId} must declare a locally observable signal`);
    const action = requireText(value.action, `${eventId}.action`);
    if (value.locality !== "local") throw new Error(`${eventId} must declare locality: local`);
    const synchronization = requireChoice(value.synchronization, `${eventId}.synchronization`, SYNCHRONIZATION_STATUSES);
    return { eventId, party, observes, action, synchronization };
  });

  const lanes = parties.map((party) => {
    const laneEvents = events.filter((event) => event.party === party).map((event) => `
      <article class="timing-event obj" ${targetAttr(event.eventId)}>
        <div class="event-kicker"><span class="event-dot"></span>${escapeHtml(party)} · ${escapeHtml(event.synchronization)}</div>
        <div class="event-step"><span>observes</span><strong>${escapeHtml(event.observes)}</strong></div>
        <div class="event-arrow" aria-hidden="true">↓</div>
        <div class="event-step action"><span>acts</span><strong>${escapeHtml(event.action)}</strong></div>
      </article>`).join("");
    return `<div class="timing-lane"><h4>${escapeHtml(party)}</h4>${laneEvents || '<p class="explainer-muted">No event declared</p>'}</div>`;
  }).join("");

  return `<section class="explainer-section explainer-timing obj" ${targetAttr(id)}>
    <div class="section-heading"><span class="section-number">01</span><h3>${escapeHtml(title)}</h3></div>
    <div class="timing-lanes">${lanes}</div>
  </section>`;
}

function renderMeasurements(section: UnknownRecord, ids: TargetIds, sectionIndex: number): string {
  const id = ids.add(section.id, `sections[${sectionIndex}].id`);
  const title = optionalText(section.title) ?? "Measurements";
  const cards = requireList(section.cards, `${id}.cards`).map((value, cardIndex) => {
    if (!isRecord(value)) throw new Error(`${id}.cards[${cardIndex}] must be an object`);
    const cardId = ids.add(value.id, `${id}.cards[${cardIndex}].id`);
    const label = requireText(value.label, `${cardId}.label`);
    if (value.value === undefined || value.value === null) throw new Error(`${cardId}.value is required`);
    const unit = optionalText(value.unit);
    const status = requireChoice(value.status, `${cardId}.status`, EVIDENCE_STATUSES);
    const provenance = optionalText(value.provenance);
    return `<article class="measurement-card obj" data-myd-target="${escapeHtml(cardId)}">
      <div class="measurement-label">${escapeHtml(label)}</div>
      <div class="measurement-value">${escapeHtml(value.value)}${unit ? `<span>${escapeHtml(unit)}</span>` : ""}</div>
      <div class="measurement-meta"><span class="status status-${statusClass(status)}">${escapeHtml(status)}</span>${provenance ? `<span>${escapeHtml(provenance)}</span>` : ""}</div>
    </article>`;
  }).join("");
  return `<section class="explainer-section explainer-measurements obj" ${targetAttr(id)}>
    <div class="section-heading"><span class="section-number">02</span><h3>${escapeHtml(title)}</h3></div>
    <div class="measurement-grid">${cards}</div>
  </section>`;
}

function renderResult(section: UnknownRecord, ids: TargetIds, sectionIndex: number): string {
  const id = ids.add(section.id, `sections[${sectionIndex}].id`);
  const label = requireText(section.label, `${id}.label`);
  if (section.value === undefined || section.value === null) throw new Error(`${id}.value is required`);
  const status = requireChoice(section.status, `${id}.status`, EVIDENCE_STATUSES);
  const caveat = optionalText(section.caveat);
  return `<section class="explainer-result obj" data-myd-target="${escapeHtml(id)}">
    <div><div class="result-label">${escapeHtml(label)}</div><div class="result-status status status-${statusClass(status)}">${escapeHtml(status)}</div></div>
    <strong>${escapeHtml(section.value)}</strong>
    ${caveat ? `<p>${escapeHtml(caveat)}</p>` : ""}
  </section>`;
}

export function renderExplainer(source: string): string {
  const parsed = parseYaml(source);
  if (!isRecord(parsed)) throw new Error("explainer source must be a YAML object");
  const title = requireText(parsed.title, "title");
  const eyebrow = optionalText(parsed.eyebrow);
  const lede = optionalText(parsed.lede);
  const theme = parsed.theme === undefined ? "aurora" : requireChoice(parsed.theme, "theme", ["aurora"]);
  const sections = requireList(parsed.sections, "sections");
  const ids = new TargetIds();
  const renderedSections = sections.map((value, index) => {
    if (!isRecord(value)) throw new Error(`sections[${index}] must be an object`);
    const type = requireText(value.type, `sections[${index}].type`);
    if (type === "timing") return renderTiming(value, ids, index);
    if (type === "measurements") return renderMeasurements(value, ids, index);
    if (type === "result") return renderResult(value, ids, index);
    throw new Error(`unsupported explainer section type: ${type}`);
  }).join("");

  return `<div class="explainer-canvas theme-${escapeHtml(theme)}">
    <header class="explainer-hero">
      ${eyebrow ? `<div class="explainer-eyebrow">${escapeHtml(eyebrow)}</div>` : ""}
      <h2>${escapeHtml(title)}</h2>
      ${lede ? `<p>${escapeHtml(lede)}</p>` : ""}
    </header>
    ${renderedSections}
  </div>`;
}
