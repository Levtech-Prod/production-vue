<template>
  <div class="card flex h-full flex-col overflow-hidden">
    <!-- Card header -->
    <div
      class="flex shrink-0 items-center gap-1.5 border-b border-slate-100 px-3 py-3"
    >
      <button
        type="button"
        class="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        :title="collapsed ? t('expand') : t('collapse')"
        @click="emit('update:collapsed', !collapsed)"
      >
        <PanelLeftOpen v-if="collapsed" class="h-4 w-4" />
        <PanelLeftClose v-else class="h-4 w-4" />
      </button>
      <h2
        v-show="!collapsed"
        class="min-w-0 flex-1 truncate font-semibold text-slate-700"
      >
        {{ t('overview') }}
      </h2>
      <button
        v-if="!isArchived"
        v-show="!collapsed"
        type="button"
        class="inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors"
        :class="
          revisionsMode
            ? 'border-blue-500 bg-blue-600 text-white hover:bg-blue-700'
            : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
        "
        @click="emit('toggle-revisions-mode')"
      >
        <GitBranch class="h-3.5 w-3.5" />
        {{ t('revision_mode') }}
      </button>
    </div>

    <!-- Collapsed rail: still shows what this panel is / which product it's
         showing, so collapsing doesn't leave a mystery strip. -->
    <div
      v-if="collapsed"
      class="flex shrink-0 flex-col items-center gap-2 border-b border-slate-100 py-3"
      :title="`${t('overview')} — ${detail.name}`"
    >
      <img
        v-if="detail.image"
        :src="detail.image"
        class="h-8 w-8 rounded-lg border border-slate-200 object-cover"
        :alt="detail.name"
      />
      <div
        v-else
        class="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-slate-100 text-slate-300"
      >
        ▣
      </div>
      <GitBranch
        v-if="revisionsMode"
        class="h-3.5 w-3.5 shrink-0 text-blue-600"
        :title="t('revision_mode')"
      />
    </div>

    <template v-if="!collapsed">
      <!-- ── Main product block (fixed — doesn't scroll with the sub-products
           list below it) ──────────────────────────────────────────────── -->
      <div
        class="shrink-0 border-b border-slate-200 bg-slate-50/70 px-2 py-2.5"
      >
        <button
          type="button"
          class="flex w-full items-center gap-2.5 rounded-lg border-l-2 px-2 py-2 text-left transition-colors"
          :class="
            selection.type === 'product'
              ? 'border-blue-500 bg-blue-50'
              : 'border-transparent hover:bg-slate-50'
          "
          @click="emit('select', { type: 'product' })"
        >
          <img
            v-if="detail.image"
            :src="detail.image"
            class="h-9 w-9 shrink-0 rounded-lg border border-slate-200 object-cover"
            :alt="detail.name"
          />
          <div
            v-else
            class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-100 text-slate-300"
          >
            ▣
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate font-semibold text-slate-800">
              {{ detail.name }}
            </div>
            <div class="truncate font-mono text-xs text-slate-400">
              {{ detail.sku }}
            </div>
          </div>
          <span
            v-if="activeRevLabel"
            class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500"
          >
            {{ activeRevLabel }}
          </span>
        </button>

        <!-- Product revision chips (composition view only): switch the active
             revision to inspect its composition, edit it, or make it the
             default. The changelog view has the timeline for this instead. -->
        <div
          v-if="showCompositionTools"
          class="ml-2 mt-1.5 flex flex-wrap items-center gap-1.5"
        >
          <button
            v-for="rev in detail.revisions"
            :key="rev.id"
            type="button"
            class="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors"
            :class="
              rev.id === activeProductRevId
                ? 'border-blue-500 bg-blue-600 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            "
            @click="emit('set-active-rev', rev.id)"
          >
            {{ rev.label }}
            <Star
              v-if="rev.id === detail.defaultRevisionId"
              class="h-3 w-3 fill-current"
              :title="t('default_revision')"
            />
            <span
              v-if="!isArchived"
              class="-mr-1 rounded-full p-0.5 hover:bg-white/25"
              :title="t('edit_revision')"
              @click.stop="emit('edit-product-rev', rev)"
            >
              <Pencil class="h-3 w-3" />
            </span>
          </button>

          <button
            v-if="canSetDefault && !isArchived"
            type="button"
            class="inline-flex items-center gap-1 rounded-full border border-amber-300 px-2.5 py-0.5 text-xs text-amber-600 hover:bg-amber-50"
            @click="emit('set-default-revision')"
          >
            <Star class="h-3 w-3" /> {{ t('set_as_default') }}
          </button>
        </div>

        <!-- Composition-view actions: both filled, side by side. The changelog
             view has its own "Add new revision" in the timeline footer. -->
        <div
          v-if="!isArchived && showCompositionTools"
          class="ml-2 mt-1.5 flex items-center gap-1.5"
        >
          <button
            v-if="!composingRevision"
            type="button"
            class="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-blue-600"
            :disabled="!hasSubProducts"
            :title="!hasSubProducts ? t('add_new_revision_disabled_hint') : ''"
            @click="emit('start-new-revision')"
          >
            <Plus class="h-3.5 w-3.5" /> {{ t('add_new_revision') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
            @click="emit('new-sub-product')"
          >
            <Plus class="h-3.5 w-3.5" /> {{ t('new_sub_product') }}
          </button>
        </div>

        <!-- Composing toolbar: right under the main product section while
             actively building a new revision (started via "Add new revision"
             above). -->
        <div
          v-if="composingRevision"
          class="ml-2 mt-1.5 flex flex-nowrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5"
        >
          <span class="shrink-0 whitespace-nowrap text-xs text-slate-500">
            {{ t('n_selected', { n: composedCount }) }}
          </span>
          <div class="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              :disabled="composedCount === 0"
              @click="emit('save-composition')"
            >
              <Save class="h-3.5 w-3.5" />
              {{ t('save_as_new_revision') }}
            </button>
            <button
              type="button"
              class="grid shrink-0 place-items-center rounded-lg border border-slate-300 bg-white p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              :title="t('cancel')"
              @click="emit('cancel-new-revision')"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <!-- ── Revisions mode: pick which of its two views to show ─────────── -->
      <div
        v-if="revisionsMode"
        class="shrink-0 border-b border-slate-100 px-2 py-1.5"
      >
        <div class="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
          <button
            v-for="view in revViews"
            :key="view.key"
            type="button"
            class="flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
            :class="
              revPanelView === view.key
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            "
            @click="emit('update:revPanelView', view.key)"
          >
            <component :is="view.icon" class="h-3.5 w-3.5" />
            {{ t(view.labelKey) }}
          </button>
        </div>
      </div>

      <!-- ── Changelog: the revision history itself ──────────────────────── -->
      <RevisionTimeline
        v-if="revisionsMode && revPanelView === 'changelog'"
        :detail="detail"
        :active-product-rev-id="activeProductRevId"
        :is-archived="isArchived"
        @set-active-rev="onTimelineRevision"
        @start-new-revision="emit('start-new-revision')"
      />

      <template v-else>
        <!-- ── Sub-products section label (fixed) ──────────────────────────── -->
        <div
          class="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-1.5"
        >
          <h3
            class="text-[11px] font-semibold uppercase tracking-wide text-slate-400"
          >
            {{ t('sub_products') }}
            <span v-if="detail.subProducts.length"></span>
          </h3>
        </div>

        <!-- ── Sub-products list (this is the part that scrolls) ───────────── -->
        <div class="flex-1 overflow-y-auto">
          <div
            v-if="detail.subProducts.length === 0"
            class="py-10 text-center text-sm text-slate-400"
          >
            {{ t('no_sub_products_in_product') }}
          </div>

          <!-- Normal mode: only sub-products linked to the active product revision -->
          <template v-else-if="!revisionsMode">
            <div
              v-if="normalRows.length === 0"
              class="py-10 text-center text-sm text-slate-400"
            >
              {{ t('no_linked_sub_products') }}
            </div>
            <ul v-else class="divide-y divide-slate-100">
              <li
                v-for="row in normalRows"
                :key="row.sp.id"
                class="flex items-center gap-1 px-2 py-1.5"
              >
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border-l-2 px-2 py-2 text-left transition-colors"
                  :class="
                    selection.type === 'subProduct' &&
                    selection.spId === row.sp.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-transparent hover:bg-slate-50'
                  "
                  @click="
                    emit('select', {
                      type: 'subProduct',
                      spId: row.sp.id,
                      spRevId: row.rev.id,
                    })
                  "
                >
                  <img
                    v-if="row.sp.image"
                    :src="row.sp.image"
                    class="h-9 w-9 shrink-0 rounded-lg border border-slate-200 object-cover"
                    :alt="row.sp.name"
                  />
                  <div
                    v-else
                    class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-100 text-slate-300"
                  >
                    ▣
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-semibold text-slate-800">
                      {{ row.sp.name }}
                    </div>
                    <div class="truncate font-mono text-xs text-slate-400">
                      {{ row.sp.sku || '—' }}
                    </div>
                  </div>
                  <span
                    class="flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500"
                    :title="t('linked_revision')"
                  >
                    <span
                      class="h-1.5 w-1.5 rounded-full"
                      :class="statusDot(row.rev.status)"
                    />
                    {{ row.rev.label }}
                  </span>
                </button>
              </li>
            </ul>
          </template>

          <!-- Revisions mode: all sub-products with all revisions, compose checkboxes -->
          <ul v-else class="divide-y divide-slate-100">
            <li v-for="sp in detail.subProducts" :key="sp.id" class="px-2 py-1.5">
              <div class="flex items-center gap-1">
                <div class="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5">
                  <img
                    v-if="sp.image"
                    :src="sp.image"
                    class="h-8 w-8 shrink-0 rounded-lg border border-slate-200 object-cover"
                    :alt="sp.name"
                  />
                  <div
                    v-else
                    class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-100 text-slate-300"
                  >
                    ▣
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-semibold text-slate-800">
                      {{ sp.name }}
                    </div>
                    <div class="truncate font-mono text-xs text-slate-400">
                      {{ sp.sku || '—' }}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  class="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                  :title="t('new_revision')"
                  @click="emit('new-sp-revision', sp)"
                >
                  <Plus class="h-4 w-4" />
                </button>
                <button
                  v-if="isAdmin"
                  type="button"
                  class="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                  :title="t('edit_sub_product')"
                  @click="emit('edit-sub-product', sp)"
                >
                  <Pencil class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  class="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  :title="t('delete_sub_product')"
                  @click="emit('delete-sub-product', sp)"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>

              <!-- Revision rows -->
              <div class="mb-1 ml-3 mt-0.5 flex flex-col gap-0.5">
                <div
                  v-for="rev in sp.revisions"
                  :key="rev.id"
                  class="group flex items-center gap-1.5 rounded-r-md border-l-2 py-1 pl-2 pr-1 transition-colors"
                  :class="spRevRowClass(sp.id, rev.id)"
                >
                  <!-- Compose checkbox: while not composing, shows (read-only)
                     whether this revision belongs to the selected product
                     revision; only interactive once "Add new revision" has
                     been clicked (see button above). -->
                  <button
                    type="button"
                    class="grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors"
                    :class="[
                      isChecked(sp.id, rev.id)
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-300 bg-white text-transparent hover:border-blue-400',
                      !composingRevision &&
                        'cursor-not-allowed opacity-70 hover:border-slate-300',
                    ]"
                    :disabled="!composingRevision"
                    :title="
                      composingRevision
                        ? t('compose_check_hint')
                        : t('compose_disabled_hint')
                    "
                    @click="emit('toggle-compose', sp.id, rev.id)"
                  >
                    <Check class="h-3 w-3" />
                  </button>

                  <!-- Row: select for viewing docs/BOM -->
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center justify-between gap-2 py-0.5 text-left text-sm"
                    @click="
                      emit('select', {
                        type: 'subProduct',
                        spId: sp.id,
                        spRevId: rev.id,
                      })
                    "
                  >
                    <span class="flex min-w-0 items-center gap-2">
                      <span
                        class="h-1.5 w-1.5 shrink-0 rounded-full"
                        :class="statusDot(rev.status)"
                        :title="rev.status"
                      />
                      <span class="truncate">{{ rev.label }}</span>
                      <span
                        v-if="activeSet.has(rev.id)"
                        class="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500"
                        :title="t('linked_revision')"
                      >
                        {{ activeRevLabel }}
                      </span>
                    </span>
                  </button>

                  <!-- Edit revision -->
                  <button
                    type="button"
                    class="shrink-0 rounded p-1 text-slate-300 hover:bg-white hover:text-blue-600 group-hover:text-slate-400"
                    :title="t('edit_revision')"
                    @click="emit('edit-sp-revision', sp, rev)"
                  >
                    <Pencil class="h-3.5 w-3.5" />
                  </button>
                  <!-- Delete revision -->
                  <button
                    type="button"
                    class="shrink-0 rounded p-1 text-slate-300 hover:bg-white hover:text-red-600 group-hover:text-slate-400"
                    :title="t('delete_revision')"
                    @click="emit('delete-sp-revision', sp, rev)"
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  Check,
  GitBranch,
  History,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Save,
  Star,
  Trash2,
  X,
} from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import RevisionTimeline from './revisions/RevisionTimeline.vue';
import { linkedRevOf, statusDot } from './revisionHelpers.ts';
import type {
  ProductDetail,
  ProductRevision,
  DetailSubProduct,
  SubProductRevision,
} from '../../../types/products.ts';
import type { Selection, ComposeSelection, RevPanelView } from './types.ts';

const props = defineProps<{
  detail: ProductDetail;
  activeProductRevId: number | null;
  selection: Selection;
  revisionsMode: boolean;
  /** Which of Revisions mode's two views to show. Ignored in normal mode. */
  revPanelView: RevPanelView;
  /** productRevisionId -> Set<subProductRevisionId>, derived once by the page. */
  membershipMap: Map<number, Set<number>>;
  /** True while the user is actively building a new product revision. */
  composingRevision: boolean;
  composeSelection: ComposeSelection;
  isArchived: boolean;
  collapsed: boolean;
  /** Sub-product general-info editing is restricted to admins. */
  isAdmin: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:collapsed', v: boolean): void;
  (e: 'update:revPanelView', v: RevPanelView): void;
  (e: 'select', sel: Selection): void;
  (e: 'toggle-revisions-mode'): void;
  (e: 'toggle-compose', spId: number, revId: number): void;
  (e: 'new-sub-product'): void;
  (e: 'edit-sub-product', sp: DetailSubProduct): void;
  (e: 'new-sp-revision', sp: DetailSubProduct): void;
  (e: 'edit-sp-revision', sp: DetailSubProduct, rev: SubProductRevision): void;
  (
    e: 'delete-sp-revision',
    sp: DetailSubProduct,
    rev: SubProductRevision,
  ): void;
  (e: 'delete-sub-product', sp: DetailSubProduct): void;
  (e: 'set-active-rev', revId: number): void;
  (e: 'edit-product-rev', rev: ProductRevision): void;
  (e: 'set-default-revision'): void;
  (e: 'start-new-revision'): void;
  (e: 'cancel-new-revision'): void;
  (e: 'save-composition'): void;
}>();

const { t } = useI18n();

const revViews = [
  { key: 'changelog' as RevPanelView, labelKey: 'changelog', icon: History },
  { key: 'composition' as RevPanelView, labelKey: 'composition', icon: Layers },
];

// Revision chips and the sub-product CRUD toolbar belong to the composition
// view; the changelog has the timeline and its own footer button instead.
const showCompositionTools = computed(
  () => props.revisionsMode && props.revPanelView === 'composition',
);

// Picking a revision in the timeline scopes the right panel to that revision.
// Without resetting the selection, a sub-product chosen under the previous
// revision would stay selected and the panels would show a revision the
// timeline is no longer pointing at.
function onTimelineRevision(revId: number) {
  emit('set-active-rev', revId);
  emit('select', { type: 'product' });
}

// ── Membership lookups ───────────────────────────────────────────────────────

const activeSet = computed<Set<number>>(() =>
  props.activeProductRevId != null
    ? (props.membershipMap.get(props.activeProductRevId) ?? new Set())
    : new Set(),
);

// Checkbox state: while composing, reflect the in-progress selection;
// otherwise (read-only) reflect what's actually linked to the selected
// product revision, so the box always shows the truth even when disabled.
function isChecked(spId: number, revId: number): boolean {
  if (props.composingRevision) return props.composeSelection[spId] === revId;
  return activeSet.value.has(revId);
}

const activeRevLabel = computed(
  () =>
    props.detail.revisions.find((r) => r.id === props.activeProductRevId)
      ?.label ?? '',
);

const canSetDefault = computed(
  () =>
    props.activeProductRevId != null &&
    props.activeProductRevId !== props.detail.defaultRevisionId,
);

const composedCount = computed(
  () => Object.keys(props.composeSelection).length,
);

// A revision has nothing to compose without at least one sub-product to
// pick from — gates the "Add new revision" button.
const hasSubProducts = computed(() => props.detail.subProducts.length > 0);

// ── Normal mode rows ─────────────────────────────────────────────────────────

const normalRows = computed(() =>
  props.detail.subProducts
    .map((sp) => ({
      sp,
      rev: linkedRevOf(sp, props.membershipMap, props.activeProductRevId),
    }))
    .filter(
      (row): row is { sp: DetailSubProduct; rev: SubProductRevision } =>
        row.rev != null,
    ),
);

// ── Row styling ──────────────────────────────────────────────────────────────

function spRevRowClass(spId: number, revId: number): string {
  const sel = props.selection;
  if (sel.type === 'subProduct' && sel.spId === spId && sel.spRevId === revId) {
    return 'border-blue-500 bg-blue-50 text-blue-700';
  }
  return 'border-transparent text-slate-600 hover:bg-slate-50';
}
</script>
