/**
 * The intelligence layer (Phase 5, D-070): a language model behind one port,
 * chosen at deployment, with an honest absence -- and the shape every piece
 * of machine-written text on the product takes.
 */

/** What `/health/intelligence` says: a model this deployment can drive, or none. Never a default that looks like one. */
export type LanguageModelState =
  { state: 'absent' } | { state: 'configured'; provider: string; model: string };

/** `GET /health/intelligence`. */
export interface IntelligenceHealth {
  checked_at: string;
  language_model: LanguageModelState;
  /**
   * True when no model is configured: every surface of Phase 5 says so in a
   * sentence, and nothing on the critical path changes either way.
   */
  absent: boolean;
}

/**
 * Text a machine wrote (T-403). Wherever it appears it is labelled as such,
 * with the model that wrote it, the prompt version that asked, and when --
 * so a reader knows what they are reading and a maintainer can reproduce it.
 * Grounding and versioning are the writer's job and are checked before a
 * `MachineText` exists at all; this is only ever the published shape.
 */
export interface MachineText {
  text: string;
  /** BCP 47 tag of the prose. */
  language: string;
  model: string;
  prompt_version: string;
  generated_at: string;
}
