<!-- Generic tag-style editor for a string list: committed values show as
     removable chips, the trailing input takes the next one. Originally built
     just for a document type's `allowedExtensions`, then widened (rather
     than copied) for any list-of-strings field — e.g. a part's secondary
     codes — via the `normalize`/`placeholder` props below. -->
<template>
  <div class="flex flex-col items-start gap-2.5 pt-1">
    <!-- Committed values sit above the input rather than inline with it, so
         adding one never moves the field the user is typing in. -->
    <div v-if="items.length > 0" class="flex flex-wrap gap-1">
      <span
        v-for="(item, i) in items"
        :key="item"
        class="badge inline-flex items-center gap-1 bg-slate-100 text-slate-700"
      >
        {{ item }}
        <button
          type="button"
          class="rounded-full p-0.5 hover:bg-slate-200"
          :aria-label="t('delete')"
          @click="items.splice(i, 1)"
        >
          <X class="h-3 w-3" />
        </button>
      </span>
    </div>

    <input
      v-model="pending"
      class="input-sm w-40 shrink-0"
      :placeholder="placeholder"
      @keydown.enter.prevent="commit"
      @keydown="onKeydown"
      @blur="commit"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { X } from 'lucide-vue-next';

const items = defineModel<string[]>({ required: true });

const props = withDefaults(
  defineProps<{
    placeholder: string;
    // Turns raw input text into a committable chip value; return '' to
    // reject it (e.g. blank input). Defaults to a plain trim.
    normalize?: (raw: string) => string;
  }>(),
  { normalize: (raw: string) => raw.trim() },
);

const { t } = useI18n();
const pending = ref('');

/** Turn whatever is in the input into a chip. Exposed so a parent can flush
 *  uncommitted text before saving — typing a value and clicking Save
 *  without pressing Enter must not silently drop it. */
function commit() {
  const value = props.normalize(pending.value);
  pending.value = '';
  if (!value) return;
  if (!items.value.includes(value)) items.value.push(value);
}

// Comma also commits a chip (in addition to Enter/blur), matching common
// tag-input UX — the comma itself is never inserted into the input.
function onKeydown(event: KeyboardEvent) {
  if (event.key === ',') {
    event.preventDefault();
    commit();
  }
}

defineExpose({ commit });
</script>
