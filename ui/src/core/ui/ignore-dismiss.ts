/**
 * The rejection handler for a modal whose dismissal (Escape, the close
 * button, a backdrop click) is an ordinary answer rather than an error, as
 * `openModal`'s `result` rejects on dismiss:
 *
 *     ref.result.then(onClose, ignoreDismiss)
 *     try { await ref.result … } catch (reason) { ignoreDismiss(reason) }
 *
 * Kept out of `modal.ts` so specs that fake that module still get it.
 * @param _reason - why the modal was dismissed
 */
export function ignoreDismiss(_reason?: unknown): void {
  // Nothing to do: the user chose not to go on
}
