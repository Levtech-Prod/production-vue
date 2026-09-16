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
            <th class="w-10 px-3 py-2">{{ t('part_prepared') }}</th>
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
import { translateApiError } from '../../../utils/apiError.ts';
import type { SubProductTarget } from './columns.ts';
import type { ProjectSubProductPart } from '../../../types/projects.ts';

const props = defineProps<{
  /** The sub-product whose pick list is open; `null` closes the dialog. */
  target: SubProductTarget | null;
}>();

const emit = defineEmits<{
  /** `changed` is true when any line moved, so the board's counts are stale
   *  and the caller should refetch. */
  close: [changed: boolean];
  prepared: [];
}>();

const { t, te } = useI18n();

const rows = ref<ProjectSubProductPart[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
// One write at a time: each one moves the part's prepared quantity, and two in
// flight would be two reads of a headroom only one of them can have.
const busy = ref(false);
// Picks are saved one at a time, so the parent only needs to know that at
// least one landed — the board reads its counts back from the server.
let changed = false;

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

watch(
  () => props.target,
  async (target) => {
    if (!target) return;
    rows.value = [];
    inputs.clear();
    changed = false;
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

async function save(row: ProjectSubProductPart, raw: number | string) {
  if (!props.target || busy.value) return;
  const parsed = Math.trunc(Number(raw));
  const next = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), row.onHandQty) : 0;

  busy.value = true;
  error.value = null;
  try {
    // The server's answer, not the typed number: a refused or clamped write
    // must leave the row reading what is actually stored.
    const { data } = await projectsApi.setPartPickedQty(
      props.target.project.id,
      row.usageId,
      next,
    );
    row.pickedQty = data.pickedQty;
    row.onHandQty = data.onHandQty;
    changed = true;
  } catch (err) {
    error.value = translateApiError(err, { t, te }, 'errors.save_part_pick_failed');
  } finally {
    busy.value = false;
    // `:value` alone cannot undo a rejected edit: the bound number never
    // changed, so Vue sees nothing to re-render and the box keeps what was
    // typed into it.
    const input = inputs.get(row.usageId);
    if (input) input.value = String(row.pickedQty);
  }
}

async function markPrepared() {
  if (!props.target || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await projectsApi.prepareSubProduct(props.target.project.id, {
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
  emit('close', changed);
}
</script>
