<template>
  <div ref="root" class="shrink-0">
    <button
      ref="trigger"
      type="button"
      class="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
      :title="t('actions')"
      @click="toggle"
    >
      <MoreVertical class="h-4 w-4" />
    </button>

    <Teleport to="body">
      <!-- Teleported, so it sits outside `root`; without the guard every
           click inside it would read as "outside" and close the menu before
           the item's own handler ran. -->
      <div
        v-if="open"
        class="fixed w-36 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        @click.stop
        :style="{
          top: `${position.top}px`,
          left: `${position.left}px`,
          zIndex: OVERLAY_LAYERS.menu,
        }"
      >
        <button
          v-for="action in actions"
          :key="action.key"
          type="button"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors"
          :class="action.class"
          @click="run(action)"
        >
          <component :is="action.icon" class="h-3.5 w-3.5" />
          {{ t(action.labelKey) }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script lang="ts">
import type { Component } from 'vue';
import { Pencil, Play, Square, Trash2 } from 'lucide-vue-next';
import type { ProjectStatus } from '../../../types/projects.ts';

export interface ProjectCardAction {
  key: 'edit' | 'start' | 'delete' | 'stop';
  labelKey: string;
  icon: Component;
  class: string;
}

/**
 * What a project in this state offers on its card. A menu rather than a row
 * of labelled buttons, because labels do not fit a fifth of the board's width.
 */
export function cardActions(status: ProjectStatus): ProjectCardAction[] {
  if (status === 'draft') {
    return [
      { key: 'edit', labelKey: 'edit', icon: Pencil, class: 'text-slate-700 hover:bg-slate-50' },
      {
        key: 'start',
        labelKey: 'start_project',
        icon: Play,
        class: 'text-emerald-700 hover:bg-emerald-50',
      },
      { key: 'delete', labelKey: 'delete', icon: Trash2, class: 'text-red-600 hover:bg-red-50' },
    ];
  }
  if (status === 'started') {
    return [
      {
        key: 'stop',
        labelKey: 'stop_project',
        icon: Square,
        class: 'text-amber-700 hover:bg-amber-50',
      },
    ];
  }
  return [];
}

/** The card skips mounting the menu when there is nothing in it. Derived from
 *  the list above rather than repeating its statuses, so adding an action to a
 *  state cannot leave the card hiding it. */
export function hasCardActions(status: ProjectStatus): boolean {
  return cardActions(status).length > 0;
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { MoreVertical } from 'lucide-vue-next';
import { useClickOutside } from '../../../composables/useClickOutside.ts';
import { OVERLAY_LAYERS } from '../../../utils/overlayLayers.ts';

const props = defineProps<{ status: ProjectStatus }>();

const emit = defineEmits<{ edit: []; start: []; delete: []; stop: [] }>();

const { t } = useI18n();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const position = ref({ top: 0, left: 0 });

useClickOutside(root, () => {
  open.value = false;
});

const actions = computed(() => cardActions(props.status));

const MENU_WIDTH = 144;
const ITEM_HEIGHT = 32;
const MENU_PADDING = 8;
const VIEWPORT_MARGIN = 8;

// Teleported and fixed rather than absolute inside the card: the column's
// card list scrolls, and an anchored popover on the last card would open
// below its clipped edge. The trade is that the coordinates go stale the
// moment anything scrolls, so the menu closes instead.
function place() {
  const rect = trigger.value?.getBoundingClientRect();
  if (!rect) return;
  const height = actions.value.length * ITEM_HEIGHT + MENU_PADDING;
  const below = rect.bottom + 4;
  position.value = {
    top:
      below + height > window.innerHeight - VIEWPORT_MARGIN
        ? Math.max(VIEWPORT_MARGIN, rect.top - height - 4)
        : below,
    left: Math.max(VIEWPORT_MARGIN, rect.right - MENU_WIDTH),
  };
}

function close() {
  open.value = false;
}

function toggle() {
  if (open.value) {
    close();
    return;
  }
  place();
  open.value = true;
}

// Follow the trigger rather than closing: a scroll while reaching for Delete
// is an accident, and losing the menu to it is worse than the stale position
// it would otherwise have. Only a trigger that has left the viewport closes,
// since there is nothing left to anchor to.
function reposition() {
  const rect = trigger.value?.getBoundingClientRect();
  if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) {
    close();
    return;
  }
  place();
}

// `capture` so a scroll of the column — not just the window — is caught.
watch(open, (isOpen) => {
  if (isOpen) {
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
  } else {
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('scroll', reposition, true);
  window.removeEventListener('resize', reposition);
});

// Spelled out rather than `emit(action.key)`: the emit signature is a union
// of one-per-event overloads, and a union key satisfies none of them.
function run(action: ProjectCardAction) {
  close();
  if (action.key === 'edit') emit('edit');
  else if (action.key === 'start') emit('start');
  else if (action.key === 'delete') emit('delete');
  else emit('stop');
}
</script>
