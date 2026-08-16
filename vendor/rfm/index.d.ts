export type RfmDiagnosticSeverity = "error" | "warning";
export interface RfmDiagnostic {
    severity: RfmDiagnosticSeverity;
    code: string;
    message: string;
    offset: number;
    line: number;
    column: number;
}
export interface RfmValidationSummary {
    comments: number;
    suggestions: number;
    legacyMetadata: number;
}
export interface RfmValidationResult {
    format: "roughdraft-flavored-markdown";
    version: "0.2";
    ok: boolean;
    diagnostics: RfmDiagnostic[];
    errors: RfmDiagnostic[];
    warnings: RfmDiagnostic[];
    summary: RfmValidationSummary;
}
export type RfmReviewItemKind = "comment" | "suggestion" | "reply";
export type RfmSuggestionKind = "addition" | "deletion" | "substitution";
export interface RfmReviewItem {
    id: string;
    kind: RfmReviewItemKind;
    suggestionKind?: RfmSuggestionKind;
    parentId: string | null;
    author: string | null;
    createdAt: string | null;
    status: string | null;
    text: string;
    originalText?: string;
    replacementText?: string;
    anchorText?: string;
    offset: number;
    endOffset: number;
    line: number;
    column: number;
}
export interface RfmReviewIndexSummary {
    comments: number;
    replies: number;
    suggestions: number;
    unresolved: number;
}
export interface RfmReviewIndex {
    format: "roughdraft-flavored-markdown";
    version: "0.2";
    items: RfmReviewItem[];
    diagnostics: RfmDiagnostic[];
    summary: RfmReviewIndexSummary;
}
export interface AppendRoughdraftReplyOptions {
    parentId: string;
    message: string;
    author?: string;
    at?: string;
    id?: string;
}
export interface AppendRoughdraftDocumentCommentOptions {
    message: string;
    author?: string;
    at?: string;
    id?: string;
}
export interface MarkRoughdraftResolvedOptions {
    targetId: string;
    summary?: string;
}
export declare function validateRoughdraftMarkdown(markdown: string): RfmValidationResult;
export declare function extractRoughdraftReviewIndex(markdown: string): RfmReviewIndex;
export declare function appendRoughdraftDocumentComment(markdown: string, options: AppendRoughdraftDocumentCommentOptions): string;
export declare function appendRoughdraftReply(markdown: string, options: AppendRoughdraftReplyOptions): string;
export declare function markRoughdraftResolved(markdown: string, options: MarkRoughdraftResolvedOptions): string;
