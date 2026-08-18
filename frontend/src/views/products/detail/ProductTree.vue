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
            <span
              v-if="isAdmin && !isArchived"
              class="-mr-1 rounded-full p-0.5 hover:bg-white/25"
              :title="t('delete_product_revision')"
              @click.stop="emit('delete-product-rev', rev)"
            >
              <Trash2 class="h-3 w-3" />
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

        <!-- The two revision actions, side by side: start a new revision or
             edit the selected one's composition. Both are replaced by the
             composing toolbar below while either is in progress. -->
        <div
          v-if="!isArchived && showCompositionTools && !composingRevision"
          class="ml-2 mt-1.5 flex items-center gap-1.5"
        >
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-blue-600"
            :disabled="!hasSubProducts"
            :title="!hasSubProducts ? t('add_new_revision_disabled_hint') : ''"
            @click="emit('start-new-revision')"
          >
            <Plus class="h-3.5 w-3.5" /> {{ t('add_new_revision') }}
          </button>
          <!-- Same checkboxes as composing a new revision, but saved onto the
               revision that is already selected. -->
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
            :disabled="activeProductRevId == null"
            :title="activeProductRevId == null ? t('edit_composition_disabled_hint') : ''"
            @click="emit('start-edit-composition')"
          >
            <ListChecks class="h-3.5 w-3.5" /> {{ t('edit_composition') }}
          </button>
        </div>

        <!-- Composing toolbar: right under the main product section while
             actively building a new revision (started via "Add new revision"
             above). -->
        <div
          v-if="composingRevision"
          class="ml-2 mt-1.5 flex flex-nowrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5"
        >
          <span class="min-w-0 truncate text-xs text-slate-500">
            <span v-if="editingComposition" class="font-medium text-blue-700">
              {{ t('editing_composition_of', { label: activeRevLabel }) }} ·
            </span>
            {{ t('n_selected', { n: composedCount }) }}
          </span>
          <div class="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              :disabled="composedCount === 0 || (editingComposition && !composeDirty)"
              @click="emit('save-composition')"
            >
              <Save class="h-3.5 w-3.5" />
              {{ editingComposition ? t('save_composition_changes') : t('save_as_new_revision') }}
            </button>
            <button
              type="button"
              class="grid shrink-0 place-items-center rounded-lg border border-slate-300 bg-white p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              :title="t('cancel')"
              @click="emit('cancel-composing')"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

        <!-- ── Sub-products section label (fixed) ──────────────────────────── -->
        <div
          class="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-1.5"
        >
          <h3
            class="text-[11px] font-semibold uppercase tracking-wide text-slate-400"
          >
            {{ t('sub_products') }}
          </h3>
          <button
            v-if="!isArchived && showCompositionTools"
            type="button"
            class="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-2 py-0.5 text-[11px] font-medium text-white transition-colors hover:bg-blue-700"
            @click="emit('new-sub-product')"
          >
            <Plus class="h-3 w-3" /> {{ t('new_sub_product') }}
          </button>
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
                        ? editingComposition
                          ? t('compose_edit_hint')
                          : t('compose_check_hint')
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
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  Check,
  GitBranch,
  ListChecks,
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
import { linkedRevOf } from './revisionHelpers.ts';
import { statusDot } from '../../../utils/statusColors.ts';
import type {
  ProductDetail,
  ProductRevision,
  DetailSubProduct,
  SubProductRevision,
} from '../../../types/products.ts';
import type { Selection, ComposeSelection } from './types.ts';

const props = defineProps<{
  detail: ProductDetail;
  activeProductRevId: number | null;
  selection: Selection;
  revisionsMode: boolean;
  /** productRevisionId -> Set<subProductRevisionId>, derived once by the page. */
  membershipMap: Map<number, Set<number>>;
  /** True while the compose checkboxes are interactive. */
  composingRevision: boolean;
  /** Which revision is being composed: null = a new one, otherwise the
   *  existing revision whose composition is being edited. */
  composeTargetRevId: number | null;
  composeSelection: ComposeSelection;
  /** Whether the in-progress composition differs from what it started as. */
  composeDirty: boolean;
  isArchived: boolean;
  collapsed: boolean;
  /** Sub-product general-info editing is restricted to admins. */
  isAdmin: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:collapsed', v: boolean): void;
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
  (e: 'delete-product-rev', rev: ProductRevision): void;
  (e: 'set-default-revision'): void;
  (e: 'start-new-revision'): void;
  (e: 'start-edit-composition'): void;
  (e: 'cancel-composing'): void;
  (e: 'save-composition'): void;
}>();

const { t } = useI18n();

const showCompositionTools = computed(() => props.revisionsMode);

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

const editingComposition = computed(
  () => props.composingRevision && props.composeTargetRevId != null,
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
