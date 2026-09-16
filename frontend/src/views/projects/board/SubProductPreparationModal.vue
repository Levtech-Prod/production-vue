<template>
  <BaseModal
    :model-value="target != null"
    :title="target ? `${target.subProduct.name} ${target.subProduct.revisionLabel}` : ''"
    size="xl"
    @update:model-value="close"
  >
    <div v-if="target" class="flex flex-col gap-3">
      <p class="text-sm text-slate-500">
        {{ target.project.name }}
        <span class="text-slate-300">·</span>
        {{ target.product.name }}
        <span class="text-slate-400">{{ target.product.revisionLabel }}</span>
      </p>

      <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>

      <p v-if="loading" class="py-8 text-center text-sm text-slate-400">{{ t('loading') }}</p>
      <p v-else-if="rows.length === 0" class="py-8 text-center text-sm text-slate-400">
        {{ t('no_project_parts_msg') }}
      </p>

      <table v-else class="w-full text-left text-sm">
        <thead class="table-head text-xs">
          <tr>
            <th class="w-10 px-3 py-2">
              <!-- Filling a pick list is normally one action, not one per
                   line: this ticks every line as far as the project can cover
                   it, in a single request. It only ever fills — there is no
                   click here that empties thirty boxes at once, which the
                   per-row checkboxes already do one at a time and on purpose. -->
              <input
                type="checkbox"
                class="h-4 w-4 cursor-pointer accent-emerald-600 disabled:cursor-not-allowed"
                :checked="allComplete"
                :disabled="busy || !canPickMore"
                :title="canPickMore ? t('pick_all_available') : t('part_prepared')"
                @change="pickAllAvailable"
              />
            </th>
            <th class="px-3 py-2">{{ t('name') }}</th>
            <th class="px-3 py-2">{{ t('code') }}</th>
            <th class="px-3 py-2 text-right">{{ t('required_quantity') }}</th>
            <th class="px-3 py-2 text-right">{{ t('on_hand_quantity') }}</th>
            <th class="w-28 px-3 py-2 text-right">{{ t('picked_quantity') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.usageId"
            class="border-t border-slate-100"
            :class="isComplete(row) ? 'bg-emerald-50/60' : 'even:bg-slate-50'"
          >
            <td class="px-3 py-2">
              <!-- The fast path for the ordinary line: everything is there, so
                   tick it and the quantity fills itself in. A line the project
                   cannot cover in full has nothing to tick — the number beside
                   it is how that one gets picked. -->
              <input
                type="checkbox"
                class="h-4 w-4 cursor-pointer accent-emerald-600 disabled:cursor-not-allowed"
                :checked="isComplete(row)"
                :disabled="busy || row.onHandQty < row.requiredQty"
                :title="
                  row.onHandQty < row.requiredQty ? t('part_cannot_be_completed') : undefined
                "
                @change="save(row, isComplete(row) ? 0 : row.requiredQty)"
              />
            </td>
            <td class="px-3 py-2 font-medium text-slate-700">{{ row.name }}</td>
            <td class="px-3 py-2 font-mono text-xs text-slate-600">{{ row.code }}</td>
            <td class="px-3 py-2 text-right tabular-nums">{{ row.requiredQty }}</td>
            <td class="px-3 py-2 text-right tabular-nums">
              <!-- The hover text sits on the span, not on the icon: a `title`
                   attribute on an inline <svg> is not what browsers read for a
                   tooltip, and this one has to say the numbers rather than
                   just that something is wrong. -->
              <span
                v-if="row.onHandQty < row.requiredQty"
                class="inline-flex items-center gap-1.5 text-amber-700"
                :title="
                  t('part_short_warning', {
                    available: row.onHandQty,
                    required: row.requiredQty,
                  })
                "
              >
                <TriangleAlert class="h-3.5 w-3.5 shrink-0 text-amber-600" />
                {{ row.onHandQty }}
              </span>
              <span v-else class="text-slate-600">{{ row.onHandQty }}</span>
            </td>
            <td class="px-3 py-2">
              <input
                :ref="(el) => registerInput(row.usageId, el)"
                type="number"
                class="input-sm text-right tabular-nums"
                :value="row.pickedQty"
                min="0"
                :max="row.onHandQty"
                :disabled="busy"
                @change="save(row, ($event.target as HTMLInputElement).value)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <template #footer>
      <span class="mr-auto text-xs tabular-nums text-slate-400">
        {{ t('n_parts_prepared_of', { picked: completeCount, total: rows.length }) }}
      </span>
      <button type="button" class="btn-secondary" @click="close">{{ t('close') }}</button>
      <!-- No second confirmation behind this one, unlike the card's button:
           the list the person just filled IS the confirmation. -->
      <button
        type="button"
        class="btn-primary !bg-emerald-600 hover:!bg-emerald-700 disabled:!bg-slate-200 disabled:!text-slate-400"
        :disabled="!allComplete || busy"
        @click="markPrepared"
      >
        {{ t('mark_prepared') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { TriangleAlert } from 'lucide-vue-next';
import BaseModal from '../../../components/modal/BaseModal.vue';
import { projectsApi } from '../../../api/projectsAPI.ts';
import { useProjectsStore } from '../../../stores/projectsStore.ts';
import { translateApiError } from '../../../utils/apiError.ts';
import type { SubProductTarget } from './columns.ts';
import type { ProjectPartPick, ProjectSubProductPart } from '../../../types/projects.ts';

const props = defineProps<{
  /** The sub-product whose pick list is open; `null` closes the dialog. */
  target: SubProductTarget | null;
}>();

const emit = defineEmits<{
  close: [];
  prepared: [];
}>();

const { t, te } = useI18n();
// Every write here answers with the board card it moved, and handing it to the
// store is what keeps the cards behind this dialog right. Nothing reloads the
// board on close any more, so this is the only thing keeping it current.
const projects = useProjectsStore();

const rows = ref<ProjectSubProductPart[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
// One write at a time. A batch is resolved against a single locked read on the
// server, so the shared pile is safe within one request — but two requests in
// flight would still be two reads of a headroom only one of them can have.
const busy = ref(false);

const inputs = new Map<number, HTMLInputElement>();

function registerInput(usageId: number, el: unknown) {
  if (el instanceof HTMLInputElement) inputs.set(usageId, el);
  else inputs.delete(usageId);
}

function isComplete(row: ProjectSubProductPart): boolean {
  return row.pickedQty >= row.requiredQty;
}

const completeCount = computed(() => rows.value.filter(isComplete).length);
const allComplete = computed(
  () => rows.value.length > 0 && completeCount.value === rows.value.length,
);
/** Is there anything left the project could actually put in the box today? */
const canPickMore = computed(() => rows.value.some((row) => row.pickedQty < row.onHandQty));

watch(
  () => props.target,
  async (target) => {
    if (!target) return;
    rows.value = [];
    inputs.clear();
    error.value = null;
    loading.value = true;
    try {
      const { data } = await projectsApi.getSubProductParts(target.project.id, {
        projectProductId: target.subProduct.projectProductId,
        subProductRevisionId: target.subProduct.subProductRevisionId,
      });
      rows.value = data;
    } catch (err) {
      error.value = translateApiError(err, { t, te }, 'errors.load_project_parts_failed');
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

/**
 * Send a batch of picks and take the whole list back from the answer.
 *
 * Every line is re-read, not only the ones sent: two lines of one project can
 * draw on the same part, so taking pieces for one moves what another could
 * still be filled to. The server computes that under the lock it wrote with —
 * working it out here would be a guess at a number another user can move.
 */
async function savePicks(picks: ProjectPartPick[]) {
  const target = props.target;
  if (!target || busy.value || picks.length === 0) return;

  busy.value = true;
  error.value = null;
  try {
    const { parts } = await projects.saveSubProductPicks(
      target.project.id,
      {
        projectProductId: target.subProduct.projectProductId,
        subProductRevisionId: target.subProduct.subProductRevisionId,
      },
      picks,
    );
    const byUsage = new Map(parts.map((part) => [part.usageId, part]));
    rows.value = rows.value.map((row) => {
      const updated = byUsage.get(row.usageId);
      return updated ? { ...row, ...updated } : row;
    });
  } catch (err) {
    error.value = translateApiError(err, { t, te }, 'errors.save_part_pick_failed');
  } finally {
    busy.value = false;
    // The stored quantity goes back in every box, whatever happened: a refused
    // or clamped write leaves the bound number unchanged, so Vue sees nothing
    // to re-render and a field keeps what was typed into it.
    for (const row of rows.value) restoreInput(row);
  }
}

/** One line, typed or ticked. */
async function save(row: ProjectSubProductPart, raw: number | string) {
  if (!props.target || busy.value) return;
  // An empty or unreadable box is not an instruction to empty the line: a
  // cleared field on the way to retyping a number would otherwise save a zero
  // and put the parts back without anyone asking for it. `Number('')` is 0,
  // so emptiness has to be caught before the parse, not after it.
  const text = String(raw).trim();
  const parsed = text === '' ? NaN : Math.trunc(Number(text));
  if (!Number.isFinite(parsed)) {
    restoreInput(row);
    return;
  }
  const pickedQty = Math.min(Math.max(parsed, 0), row.onHandQty);
  if (pickedQty === row.pickedQty) {
    restoreInput(row);
    return;
  }
  await savePicks([{ usageId: row.usageId, pickedQty }]);
}

/**
 * Fill every line as far as the project can cover it — the whole list in one
 * request.
 *
 * `onHandQty` is already capped at what each line needs, so this completes what
 * can be completed and part-fills the rest, which is what someone walking the
 * shelf with the list actually does. Within one sub-product each part appears
 * on exactly one line (`project_part_usages` is unique on the three ids), so
 * these quantities do not compete with each other for the same pile.
 */
async function pickAllAvailable() {
  const picks = rows.value
    .filter((row) => row.pickedQty < row.onHandQty)
    .map((row) => ({ usageId: row.usageId, pickedQty: row.onHandQty }));
  if (picks.length === 0) return;
  await savePicks(picks);
}

/** Put the stored quantity back in the box. */
function restoreInput(row: ProjectSubProductPart) {
  const input = inputs.get(row.usageId);
  if (input) input.value = String(row.pickedQty);
}

async function markPrepared() {
  if (!props.target || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await projects.prepareSubProduct(props.target.project.id, {
      projectProductId: props.target.subProduct.projectProductId,
      subProductRevisionId: props.target.subProduct.subProductRevisionId,
    });
    emit('prepared');
  } catch (err) {
    error.value = translateApiError(err, { t, te }, 'errors.mark_prepared_failed');
  } finally {
    busy.value = false;
  }
}

function close() {
  emit('close');
}
</script>
