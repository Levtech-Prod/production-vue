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
      <!-- Teleported, so it sits outside `root` and every click in it would
           otherwise read as "outside" and close the menu — including one on a
           disabled item, which should do nothing at all. -->
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
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          :class="action.class"
          :title="action.disabled ? t('coming_soon') : undefined"
          :disabled="action.disabled"
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
import type { ProjectStatus } from '../../../types/projects.ts';

/** Whether a project in this state offers any card action at all — the card
 *  uses it to skip mounting the menu entirely. Kept beside `actions` below,
 *  which must stay non-empty for exactly these states. */
export function hasCardActions(status: ProjectStatus): boolean {
  return status === 'draft' || status === 'started';
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type Component } from 'vue';
import { useI18n } from 'vue-i18n';
import { MoreVertical, Pencil, Play, Square, Trash2 } from 'lucide-vue-next';
import { useClickOutside } from '../../../composables/useClickOutside.ts';
import { OVERLAY_LAYERS } from '../../../utils/overlayLayers.ts';

const props = defineProps<{ status: ProjectStatus }>();

const emit = defineEmits<{ edit: []; delete: [] }>();

const { t } = useI18n();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const position = ref({ top: 0, left: 0 });

useClickOutside(root, () => {
  open.value = false;
});

interface MenuAction {
  key: string;
  labelKey: string;
  icon: Component;
  class: string;
  disabled?: boolean;
  run?: () => void;
}

// A menu rather than a row of labelled buttons, so the card stays readable
// at a fifth of the board's width. Start and Stop have no endpoint yet
// (plan §7 step 8) and are listed disabled rather than hidden, so the card
// still shows what a project can do next.
const actions = computed<MenuAction[]>(() => {
  if (props.status === 'draft') {
    return [
      {
        key: 'edit',
        labelKey: 'edit',
        icon: Pencil,
        class: 'text-slate-700 hover:bg-slate-50',
        run: () => emit('edit'),
      },
      {
        key: 'start',
        labelKey: 'start_project',
        icon: Play,
        class: 'text-emerald-700 hover:bg-emerald-50',
        disabled: true,
      },
      {
        key: 'delete',
        labelKey: 'delete',
        icon: Trash2,
        class: 'text-red-600 hover:bg-red-50',
        run: () => emit('delete'),
      },
    ];
  }
  if (props.status === 'started') {
    return [
      {
        key: 'stop',
        labelKey: 'stop_project',
        icon: Square,
        class: 'text-amber-700 hover:bg-amber-50',
        disabled: true,
      },
    ];
  }
  return [];
});

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

// `capture` so a scroll of the column — not just the window — is caught.
watch(open, (isOpen) => {
  if (isOpen) {
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
  } else {
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('resize', close);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('scroll', close, true);
  window.removeEventListener('resize', close);
});

function run(action: MenuAction) {
  close();
  action.run?.();
}
</script>
