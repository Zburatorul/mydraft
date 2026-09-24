const EMPTY_DRAFT = Object.freeze({ body: "", replacement: "" });
const IDLE = Object.freeze({
  phase: "idle",
  kind: null,
  target: null,
  targetStatus: "current",
  draft: EMPTY_DRAFT,
  error: null,
});

function immutableTarget(target, capturedVersion) {
  return Object.freeze({ ...target, capturedVersion });
}

function immutableDraft(draft = EMPTY_DRAFT) {
  return Object.freeze({
    body: draft.body ?? "",
    replacement: draft.replacement ?? "",
  });
}

function errorMessage(error) {
  if (error?.name === "TimeoutError") return "Save timed out. Check your connection and try again.";
  return "Could not save. Check your connection and try again.";
}

export class ReviewComposer {
  #state = IDLE;
  #returnFocusTo = null;
  #submit;
  #reload;
  #onChange;
  #focusPrimary;
  #restoreFocus;
  #onClose;
  #requestTimeoutMs;

  constructor({ submit, reload, onChange, focusPrimary, restoreFocus, onClose, requestTimeoutMs = 10_000 } = {}) {
    this.#submit = submit ?? (async () => ({ ok: true }));
    this.#reload = reload ?? (async () => {});
    this.#onChange = onChange ?? (() => {});
    this.#focusPrimary = focusPrimary ?? (() => {});
    this.#restoreFocus = restoreFocus ?? (() => {});
    this.#onClose = onClose ?? (() => {});
    this.#requestTimeoutMs = requestTimeoutMs;
  }

  get state() { return this.#state; }

  open({ kind, target, capturedVersion, draft, returnFocusTo = null }) {
    this.#returnFocusTo = returnFocusTo;
    this.#set({
      phase: "editing",
      kind,
      target: immutableTarget(target, capturedVersion),
      targetStatus: "current",
      draft: immutableDraft(draft),
      error: null,
    });
    this.#focusPrimary(this.#state);
  }

  updateDraft(update) {
    if (this.#state.phase === "idle") return;
    this.#set({ ...this.#state, draft: immutableDraft({ ...this.#state.draft, ...update }) });
  }

  documentChanged({ version }) {
    if (this.#state.phase === "idle" || this.#state.target.capturedVersion === version) return;
    this.#set({ ...this.#state, targetStatus: "stale", error: null, phase: "editing" });
  }

  beginReselect() {
    if (this.#state.phase === "idle" || this.#state.targetStatus === "current") return;
    this.#set({ ...this.#state, targetStatus: "reselecting", error: null, phase: "editing" });
  }

  retarget({ target, capturedVersion, returnFocusTo = null }) {
    if (this.#state.phase === "idle") return;
    this.#returnFocusTo = returnFocusTo;
    this.#set({
      ...this.#state,
      target: immutableTarget(target, capturedVersion),
      targetStatus: "current",
      error: null,
      phase: "editing",
    });
    this.#focusPrimary(this.#state);
  }

  hasUnsentDrafts() {
    return Boolean(this.#state.draft.body.trim() || this.#state.draft.replacement.trim());
  }

  async submit() {
    if (this.#state.phase === "idle" || this.#state.phase === "submitting" || this.#state.targetStatus !== "current") return false;
    this.#set({ ...this.#state, phase: "submitting", error: null });
    const controller = new AbortController();
    let timeout;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error("Save timed out");
          error.name = "TimeoutError";
          reject(error);
          controller.abort();
        }, this.#requestTimeoutMs);
      });
      const outcome = await Promise.race([this.#submit(this.#state, { signal: controller.signal }), timeoutPromise]);
      if (outcome?.reload) await this.#reload();
      if (outcome?.ok === false) {
        this.#set({ ...this.#state, phase: "error", error: outcome.error || "Could not save. Try again." });
        return false;
      }
      this.close("saved");
      return true;
    } catch (error) {
      this.#set({ ...this.#state, phase: "error", error: errorMessage(error) });
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  close(reason = "cancel") {
    if (this.#state.phase === "idle") return;
    const returnFocusTo = this.#returnFocusTo;
    this.#returnFocusTo = null;
    this.#state = IDLE;
    this.#onChange(this.#state);
    this.#onClose(reason);
    this.#restoreFocus(returnFocusTo, reason);
  }

  #set(next) {
    this.#state = Object.freeze(next);
    this.#onChange(this.#state);
  }
}
