import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { requiredFieldErrors, type RequiredFieldCheck } from '../utils/zodErrors.ts';

/**
 * Client-side required-field validation shared by every form. Forms use
 * `novalidate` on the <form> element (see zodErrors.ts for why) and call
 * this instead of relying on the browser's own validation bubble.
 *
 * Errors stay hidden until the first submit attempt, then update live as
 * the user fixes fields — the same UX every modal in the app implements by
 * hand today. `checks` is a getter (not a plain array) so its reads of
 * reactive form state are tracked by the `fieldErrors` computed.
 */
export function useRequiredFieldValidation(checks: () => RequiredFieldCheck[]) {
  const { t } = useI18n();
  const attemptedSubmit = ref(false);

  const fieldErrors = computed<Record<string, string>>(() => {
    if (!attemptedSubmit.value) return {};
    return requiredFieldErrors(checks(), t);
  });

  // Called on submit. Returns whether every checked field is valid.
  function validate(): boolean {
    attemptedSubmit.value = true;
    return Object.keys(fieldErrors.value).length === 0;
  }

  // Called when the form resets (e.g. a modal reopening).
  function resetValidation() {
    attemptedSubmit.value = false;
  }

  return { fieldErrors, validate, resetValidation };
}
