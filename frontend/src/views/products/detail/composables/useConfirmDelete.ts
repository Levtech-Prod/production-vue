import { ref } from 'vue';

/**
 * Shared "pick a target, confirm in a modal, run an async action" flow used
 * by every delete confirmation on the product detail page (revision,
 * sub-product, document). `action` should perform the API call, any local
 * cache updates and success/error toasts itself, then report whether the
 * modal should close (`true` on success, `false` to keep it open so the
 * user can retry).
 */
export function useConfirmDelete<T>(action: (target: T) => Promise<boolean>) {
  const target = ref<T | null>(null);
  const busy = ref(false);

  function open(value: T) {
    target.value = value;
  }

  function cancel() {
    target.value = null;
  }

  async function confirm() {
    if (!target.value || busy.value) return;
    busy.value = true;
    try {
      const success = await action(target.value);
      if (success) target.value = null;
    } finally {
      busy.value = false;
    }
  }

  return { target, busy, open, cancel, confirm };
}
