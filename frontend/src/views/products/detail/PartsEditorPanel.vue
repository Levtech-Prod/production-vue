<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Header -->
    <div
      class="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-3"
    >
      <h3 class="flex min-w-0 items-center gap-2 font-semibold text-slate-700">
        <span class="truncate">{{ t('tab_parts') }}</span>
        <span
          class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
        >
          {{ spName }} · {{ revLabel }}
        </span>
      </h3>
      <div class="flex shrink-0 items-center gap-3">
        <span v-if="saving" class="text-xs text-slate-400">{{
          t('saving')
        }}</span>
        <button
          v-if="canEdit"
          type="button"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:pointer-events-none disabled:opacity-60"
          :title="t('add_parts')"
          :disabled="saving || allPartsLoading"
          @click="addOpen = true"
        >
          <Plus class="h-3.5 w-3.5" />
          {{ t('add_part') }}
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <!-- ── Current parts of the revision ─────────────────────────────── -->
      <div
        v-if="loading || allPartsLoading"
        class="py-8 text-center text-sm text-slate-400"
      >
        {{ t('loading') }}
      </div>
      <PartsTable
        v-else
        :parts="currentRows"
        :empty-text="t('no_parts_in_revision')"
        :expanded-part-ids="expandedPartIds"
        dense
      >
        <template #qty="{ part }">
          <div class="flex items-center gap-1.5">
            <input
              type="number"
              min="0"
              step="1"
              class="input !w-20 !py-1 text-center text-sm"
              :value="revisionPartOf(part.id)?.quantity ?? ''"
              :disabled="!canEdit || saving"
              :title="t('quantity')"
              @keydown="blockNonIntegerKeys"
              @change="onQtyChange(part.id, $event)"
            />
            <span class="w-8 truncate text-xs text-slate-400">
              {{ revisionPartOf(part.id)?.unit || '' }}
            </span>
          </div>
        </template>
        <template #position="{ part }">
          <input
            type="text"
            class="input !w-32 !py-1 text-sm"
            :value="revisionPartOf(part.id)?.mountPosition ?? ''"
            :disabled="!canEdit || saving"
            :title="t('mount_position')"
            @change="onPositionChange(part.id, $event)"
          />
        </template>
        <template #notes="{ part }">
          <input
            type="text"
            class="input !w-48 !py-1 text-sm"
            :value="revisionPartOf(part.id)?.notes ?? ''"
            :disabled="!canEdit || saving"
            :title="t('notes')"
            @change="onNotesChange(part.id, $event)"
          />
        </template>
        <template #actions="{ part }">
          <div class="flex items-center justify-center gap-1.5">
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-lg px-1.5 py-1"
              :class="
                expandedPartIds.has(part.id)
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-slate-400 hover:bg-blue-50 hover:text-blue-600'
              "
              :title="t('view_alternative')"
              @click="toggleExpanded(part.id)"
            >
              <Link2 class="h-4 w-4" />
              <!-- A dot rather than a count: a part carries at most one
                   alternate. It turns emerald when the revision is built with
                   that alternate instead of this row, so a collapsed row
                   still shows it is being substituted. -->
              <span
                v-if="altParts.hasAlternate(revId, part.id)"
                class="h-1.5 w-1.5 rounded-full"
                :class="altParts.alternateInUse(revId, part.id) ? 'bg-emerald-500' : 'bg-blue-500'"
              ></span>
            </button>
            <button
              v-if="canEdit"
              type="button"
              class="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
              :title="t('delete')"
              :disabled="saving"
              @click="askRemove(part.id)"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </div>
        </template>
        <template #expanded="{ part }">
          <AlternativesPanel
            :alternate="altParts.alternateFor(revId, part.id)"
            :in-use="altParts.alternateInUse(revId, part.id)"
            :quantity="revisionPartOf(part.id)?.quantity"
            :unit="revisionPartOf(part.id)?.unit"
            :mount-position="revisionPartOf(part.id)?.mountPosition"
            :notes="revisionPartOf(part.id)?.notes"
            :editable="canEdit"
            :candidates="altCandidatesFor(part.id)"
            :saving="altParts.saving"
            @remove="() => removeAlternative(part.id)"
            @add="(altPartId) => setAlternative(part.id, altPartId)"
            @set-in-use="(inUse) => setAlternateInUse(part.id, inUse)"
          />
        </template>
      </PartsTable>
    </div>

    <!-- Add parts: the catalog list lives in a modal so it never pushes the
         revision's own table off screen. -->
    <AddPartsModal
      v-if="canEdit"
      v-model="addOpen"
      :parts="availableParts"
      :loading="allPartsLoading"
      :saving="saving"
      @add="onAddParts"
    />

    <!-- Remove part confirmation -->
    <ConfirmModal
      :visible="removeTarget != null"
      :title="t('delete')"
      :message="`${t('confirmations.remove_part_msg')}${removeTarget ? `: ${removeTarget.name}` : ''}`"
      :confirm-text="t('delete')"
      :cancel-text="t('cancel')"
      :loading="saving"
      @confirm="confirmRemove"
      @cancel="removeTarget = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { Link2, Plus, Trash2 } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import ConfirmModal from '../../../components/notification/ConfirmModal.vue';
import AddPartsModal from './AddPartsModal.vue';
import PartsTable from '../../parts/PartsTable.vue';
import AlternativesPanel from './bom/AlternativesPanel.vue';
import { usePartsStore } from '../../../stores/partsStore.ts';
import { useRevisionPartRows } from './bom/composables/useRevisionPartRows.ts';
import { blockNonIntegerKeys } from '../../../utils/numberInput.ts';
import type { UseAlternativeParts } from './bom/composables/useAlternativeParts.ts';
import type { Part } from '../../../types/parts.ts';
import type {
  RevisionPart,
  RevisionPartInput,
} from '../../../types/products.ts';

const props = defineProps<{
  spId: number;
  revId: number;
  spName: string;
  revLabel: string;
  parts: RevisionPart[];
  loading: boolean;
  saving: boolean;
  canEdit: boolean;
  altParts: UseAlternativeParts;
}>();

const emit = defineEmits<{ update: [parts: RevisionPartInput[]] }>();

const { t } = useI18n();

// ── Part catalog (full stock details for both tables) ───────────────────────

// Shared across the app (see partsStore) so switching between sub-product
// revisions here — which remounts this panel via its :key — doesn't refetch
// the entire parts catalog every time; it's loaded once and reused.
const partsStore = usePartsStore();
const allParts = computed(() => partsStore.parts);

// Revision parts joined with the catalog (loads the catalog on mount) so the
// table can show category, location and parameters. Shared with the BOM panel.
const { rows: currentRows, catalogLoading: allPartsLoading } =
  useRevisionPartRows(toRef(props, 'parts'));

function revisionPartOf(partId: number): RevisionPart | undefined {
  return props.parts.find((p) => p.id === partId);
}

// Ids of parts currently in this revision's BOM — excludes them from the "add
// part" list below. Deliberately NOT used to mark the alternate: the alternate
// is a catalog part rather than a BOM row, so it is essentially never in this
// set. Which part is actually fitted comes from the link's own
// `alternate_in_use` flag instead (see migration 021).
const inBomIds = computed(() => new Set(props.parts.map((p) => p.id)));

// Catalog parts not yet in this revision — the pool the add modal picks from.
// Searching within it is the modal's own business.
const availableParts = computed(() =>
  allParts.value.filter((p) => !inBomIds.value.has(p.id)),
);

// ── Mutations (each emits the full new part set; parent persists it) ────────

function toInputs(parts: RevisionPart[]): RevisionPartInput[] {
  return parts.map((p) => ({
    partId: p.id,
    quantity: Number(p.quantity) || 0,
    unit: p.unit || null,
    notes: p.notes || null,
    mountPosition: p.mountPosition || null,
  }));
}

function onQtyChange(partId: number, e: Event) {
  const input = e.target as HTMLInputElement;
  // Truncated, not just parsed: the keydown guard blocks a typed decimal but
  // not a pasted one, and quantities here are whole numbers.
  const qty = Math.trunc(Number(input.value));
  const current = revisionPartOf(partId);
  if (!current) return;
  if (!Number.isFinite(qty) || qty <= 0) {
    input.value = String(current.quantity);
    return;
  }
  // Keep the field showing what is actually being saved.
  input.value = String(qty);
  updateLine(partId, { quantity: qty });
}

/** Re-send the whole part set with one line changed; the parent persists it. */
function updateLine(partId: number, patch: Partial<RevisionPartInput>) {
  if (!revisionPartOf(partId)) return;
  emit(
    'update',
    toInputs(props.parts).map((p) =>
      p.partId === partId ? { ...p, ...patch } : p,
    ),
  );
}

// Blank clears the value rather than storing '', so the change log and the
// revision compare read it as unset.
function textValue(e: Event): string | null {
  return (e.target as HTMLInputElement).value.trim() || null;
}

function onPositionChange(partId: number, e: Event) {
  updateLine(partId, { mountPosition: textValue(e) });
}

function onNotesChange(partId: number, e: Event) {
  updateLine(partId, { notes: textValue(e) });
}

// Add flow: the modal stages a whole batch and hands it over in one go, so
// this is a single update rather than one save per part.
const addOpen = ref(false);

function onAddParts(rows: { partId: number; quantity: number }[]) {
  if (rows.length === 0) return;
  emit('update', [
    ...toInputs(props.parts),
    ...rows.map((row) => ({
      partId: row.partId,
      quantity: row.quantity,
      unit: null,
      notes: null,
      mountPosition: null,
    })),
  ]);
}

// Remove flow with confirmation.
const removeTarget = ref<Part | null>(null);

function askRemove(partId: number) {
  removeTarget.value = currentRows.value.find((p) => p.id === partId) ?? null;
}

function confirmRemove() {
  const target = removeTarget.value;
  if (!target) return;
  emit(
    'update',
    toInputs(props.parts).filter((p) => p.partId !== target.id),
  );
  removeTarget.value = null;
}

// ── Alternative part (see migration 021) — one per part, per sub-product
// REVISION, so every call takes both props.spId and props.revId. The link
// icon in the Actions column opens a secondary row under the part (rendered
// via PartsTable's #expanded slot) where the alternate is managed. ────────

// Parts whose panel is open. Seeded below from whichever parts already have
// an alternate, and then owned by the user: once they collapse or open a row
// by hand, that choice survives until the revision or the links change.
const expandedPartIds = ref<Set<number>>(new Set());

function toggleExpanded(partId: number) {
  const next = new Set(expandedPartIds.value);
  if (next.has(partId)) next.delete(partId);
  else next.add(partId);
  expandedPartIds.value = next;
}

// Auto-expand: a part that has an alternate opens by default, so the
// substitution is visible without hunting for it. Re-seeded whenever the
// revision's parts or its links change (switching revisions remounts this
// panel via its :key, so this covers arrival of both fetches).
watch(
  [() => props.revId, currentRows, () => props.altParts.linkVersion],
  () => {
    const seeded = new Set(expandedPartIds.value);
    for (const part of currentRows.value) {
      if (props.altParts.hasAlternate(props.revId, part.id)) seeded.add(part.id);
    }
    expandedPartIds.value = seeded;
  },
  { immediate: true },
);

// Catalog parts this row could be set to: anything but itself and whatever
// it already points at.
function altCandidatesFor(partId: number): Part[] {
  const current = props.altParts.alternateFor(props.revId, partId);
  return allParts.value.filter((p) => p.id !== partId && p.id !== current?.id);
}

async function setAlternative(partId: number, alternatePartId: number) {
  // Replaces whatever was set — see the POST route's replace semantics.
  await props.altParts.link(props.spId, props.revId, partId, alternatePartId);
}

async function removeAlternative(partId: number) {
  const linkId = props.altParts.linkIdFor(props.revId, partId);
  if (linkId == null) return;
  await props.altParts.unlink(props.spId, props.revId, linkId);
}

// Which half of the pair this revision is actually built with.
async function setAlternateInUse(partId: number, inUse: boolean) {
  const linkId = props.altParts.linkIdFor(props.revId, partId);
  if (linkId == null) return;
  await props.altParts.setInUse(props.spId, props.revId, linkId, inUse);
}
</script>
