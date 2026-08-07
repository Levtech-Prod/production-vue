/**
 * Stacking order for full-screen overlays, kept in one place so nested
 * surfaces layer by intent rather than by accident.
 *
 * These overlays are all `position: fixed` and teleported to `<body>`, so at
 * equal z-index the winner is simply whichever mounted last — i.e. template
 * order. That is what this scale removes.
 *
 *  - `modal`   a top-level dialog (BaseModal's default)
 *  - `nested`  a dialog opened from inside another dialog, e.g. the document
 *              name entry opened from the file-list modal
 *  - `confirm` a confirmation or alert, which must sit above what raised it
 *  - `toast`   notifications, always on top
 *
 * Plain numbers bound via `:style`, not Tailwind `z-*` classes: the values are
 * an ordering rather than design tokens, and this way they can't be missed by
 * class detection and silently leave an overlay with no z-index at all.
 * `modal` is 50 so these interleave correctly with the handful of bespoke
 * modals still using Tailwind's `z-50`.
 */
export const OVERLAY_LAYERS = {
  modal: 50,
  nested: 55,
  confirm: 60,
  toast: 70,
} as const;

/** Which layer a dialog renders on. */
export type ModalLayer = 'modal' | 'nested';
