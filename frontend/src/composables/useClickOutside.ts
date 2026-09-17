import { onBeforeUnmount, onMounted, type Ref } from 'vue';

/**
 * Closes a popover when a click lands outside `root`. Written for
 * `IconPicker`'s dropdown and now shared with the product picker, so the two
 * can't drift on what counts as "outside".
 *
 * The listener is attached for the component's whole lifetime rather than
 * only while the popover is open — `onOutside` is cheap and the caller
 * already knows whether it has anything to close.
 */
export function useClickOutside(root: Ref<HTMLElement | null>, onOutside: () => void) {
  function handleClick(event: MouseEvent) {
    if (root.value && !root.value.contains(event.target as Node)) onOutside();
  }

  onMounted(() => document.addEventListener('click', handleClick));
  onBeforeUnmount(() => document.removeEventListener('click', handleClick));
}
