<template>
  <!-- bg-blue-50/60, not slate-50: the parts table alternates white and
       even:bg-slate-50, and slate-50 is also the page background, so a
       slate-50 ground merges into the row this belongs to. -->
  <div class="bg-blue-50/60 py-1 pl-14 pr-3">
    <!-- The rail alone marks the fitted part; a full green fill was too loud
         with several open at once. -->
    <div
      class="border-l-[3px] pl-2.5"
      :class="inUse ? 'border-emerald-500' : 'border-blue-400'"
    >
      <div class="mb-0.5 flex items-center gap-2 leading-none">
        <CornerDownRight class="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span
          class="text-[10px] font-bold uppercase tracking-wide"
          :class="inUse ? 'text-emerald-700' : 'text-slate-500'"
        >
          {{ t('alternative_part') }}
        </span>

        <div v-if="alternate" class="ml-auto flex shrink-0 items-center gap-1.5">
          <!-- Labels the switch only: the read-only badge reads as a status
               of the alternative, which this prefix would misdescribe. -->
          <span v-if="editable" class="text-[10px] uppercase tracking-wide text-slate-500">
            {{ t('built_with') }}
          </span>
          <div
            v-if="editable"
            class="inline-flex overflow-hidden rounded-md text-[10px] font-bold ring-1 ring-slate-300"
          >
            <button
              type="button"
              class="px-1.5 py-0.5"
              :class="!inUse ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'"
              :title="t('use_main_part_hint')"
              :disabled="saving"
              @click="emit('setInUse', false)"
            >
              {{ t('use_main_part') }}
            </button>
            <button
              type="button"
              class="border-l border-slate-300 px-1.5 py-0.5"
              :class="inUse ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'"
              :title="t('use_alternative_hint')"
              :disabled="saving"
              @click="emit('setInUse', true)"
            >
              {{ t('use_alternative') }}
            </button>
          </div>
          <!-- Icon + words, never colour alone. -->
          <span
            v-else-if="inUse"
            class="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white"
          >
            <Check class="h-3 w-3" /> {{ t('in_this_bom') }}
          </span>
          <span
            v-else
            class="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-300"
          >
            {{ t('standby') }}
          </span>
        </div>
      </div>

      <div v-if="alternate" class="overflow-hidden rounded-md ring-1 ring-slate-200">
        <table class="w-full text-left">
          <!-- Widths belong on the <th>: in an auto-layout table the wider of
               th/td wins, so body-only widths let the header stretch a column
               back out. "Other parameters" is left unconstrained to absorb
               the slack, as it does in the parts table. -->
          <thead class="table-head text-[9px] tracking-wide">
            <tr>
              <th class="w-10 px-2 py-0.5 font-semibold">{{ t('image') }}</th>
              <th class="w-24 px-2 py-0.5 font-semibold">{{ t('code') }}</th>
              <th class="w-56 px-2 py-0.5 font-semibold">{{ t('name') }}</th>
              <th class="w-28 px-2 py-0.5 font-semibold">{{ t('category') }}</th>
              <th class="w-20 px-2 py-0.5 font-semibold">{{ t('avg_price_per_piece') }}</th>
              <th class="w-20 px-2 py-0.5 font-semibold">{{ t('total_quantity') }}</th>
              <th class="w-20 px-2 py-0.5 font-semibold">{{ t('quantity') }}</th>
              <th class="w-24 px-2 py-0.5 font-semibold">{{ t('mount_position') }}</th>
              <th class="w-32 px-2 py-0.5 font-semibold">{{ t('notes') }}</th>
              <th class="px-2 py-0.5 font-semibold">{{ t('other_parameters') }}</th>
              <th class="w-24 px-2 py-0.5 font-semibold">{{ t('location') }}</th>
              <th class="w-14 px-2 py-0.5"></th>
            </tr>
          </thead>
          <tbody>
            <tr class="bg-white">
              <td class="px-2 py-1">
                <img
                  v-if="alternate.image"
                  :src="alternate.image"
                  class="h-6 w-6 rounded border border-slate-200 object-cover"
                  :alt="alternate.name"
                />
                <div
                  v-else
                  class="grid h-6 w-6 place-items-center rounded border border-slate-200 bg-slate-100 text-[9px] text-slate-300"
                >
                  ▣
                </div>
              </td>
              <td class="whitespace-nowrap px-2 py-1 font-mono text-[11px] text-slate-600">
                {{ alternate.code }}
              </td>
              <td class="max-w-0 truncate px-2 py-1 text-xs font-semibold text-slate-800">
                {{ alternate.name }}
              </td>
              <td class="truncate px-2 py-1 text-[11px] text-slate-500">
                {{ alternate.category.name }}
              </td>
              <td class="whitespace-nowrap px-2 py-1 text-[11px] text-slate-600">
                {{ formatPrice(alternate.avgPricePerPiece ?? Number(alternate.pricePerPiece)) }}
              </td>
              <td class="whitespace-nowrap px-2 py-1 text-[11px] text-slate-500">
                {{ Math.round(Number(alternate.totalQuantity ?? 0)) }}
              </td>
              <!-- Not stored on the link: the alternative is fitted in the BOM
                   line's place, so both are read off that line. -->
              <td
                class="whitespace-nowrap px-2 py-1 text-[11px] text-slate-700"
                :title="t('same_qty_as_main')"
              >
                <span class="font-semibold">{{ quantity ?? '—' }}</span>
                <span class="text-slate-400"> {{ unit || '' }}</span>
              </td>
              <td
                class="whitespace-nowrap px-2 py-1 text-[11px] text-slate-500"
                :title="t('same_qty_as_main')"
              >
                {{ mountPosition || '—' }}
              </td>
              <td
                class="max-w-0 truncate px-2 py-1 text-[11px] text-slate-500"
                :title="notes || t('same_qty_as_main')"
              >
                {{ notes || '—' }}
              </td>
              <!-- One line, unlike the stacked chips upstairs: several
                   parameters would make this taller than its own row. -->
              <td class="max-w-0 px-2 py-1">
                <div class="flex items-center gap-1 overflow-hidden">
                  <span
                    v-for="v in alternate.parameters ?? []"
                    :key="v.id"
                    class="shrink-0 whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                  >
                    {{ v.parameter?.name }}: {{ v.value }}
                  </span>
                  <span v-if="!(alternate.parameters ?? []).length" class="text-slate-300">
                    —
                  </span>
                </div>
              </td>
              <td class="truncate px-2 py-1 text-[11px] text-slate-500">
                {{ alternate.location || '—' }}
              </td>
              <td class="w-14 px-2 py-1">
                <div v-if="editable" class="flex items-center justify-end gap-0.5">
                  <button
                    type="button"
                    class="rounded p-0.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                    :title="t('replace_alternative')"
                    :disabled="saving"
                    @click="picking = !picking"
                  >
                    <Pencil class="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    class="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    :title="t('remove_alternative')"
                    :disabled="saving"
                    @click="emit('remove', alternate)"
                  >
                    <X class="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-else
        class="flex items-center gap-2 rounded-md bg-white px-2 py-1 ring-1 ring-slate-200"
      >
        <span class="text-[11px] text-slate-500">{{ t('no_alternative') }}</span>
        <button
          v-if="editable && !picking"
          type="button"
          class="ml-auto shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold text-blue-700 ring-1 ring-blue-300 hover:bg-blue-50"
          :disabled="saving"
          @click="picking = true"
        >
          + {{ t('add_alternative') }}
        </button>
      </div>

      <!-- Rendered only while choosing, so it costs no height at rest. -->
      <div v-if="editable && picking" class="mt-1 flex items-center gap-2">
        <select v-model.number="selected" class="input !w-56 !py-0.5 !text-[11px]" :disabled="saving">
          <option :value="0" disabled>{{ t('select_part') }}</option>
          <option v-for="p in candidates" :key="p.id" :value="p.id">
            {{ p.name }} ({{ p.code }})
          </option>
        </select>
        <button
          type="button"
          class="shrink-0 rounded-md bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="!selected || saving"
          @click="confirmSet"
        >
          <Check class="h-3 w-3" />
        </button>
        <button
          type="button"
          class="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200"
          :title="t('cancel')"
          @click="cancelPick"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Check, CornerDownRight, Pencil, X } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { formatPrice } from '../../../../utils/formatters.ts';
import type { Part } from '../../../../types/parts.ts';

withDefaults(
  defineProps<{
    /** A part carries at most one alternate per revision (see migration 021). */
    alternate?: Part;
    /** Marks the fitted part. Not BOM membership — the alternative is a
     *  catalog part, so it is never a BOM row itself. */
    inUse?: boolean;
    editable?: boolean;
    /** Catalog parts this row could be set to (only needed when editable). */
    candidates?: Part[];
    saving?: boolean;
    /** Read off the BOM line, not the link: the alternative is fitted in
     *  that line's place. */
    quantity?: number | string | null;
    unit?: string | null;
    mountPosition?: string | null;
    notes?: string | null;
  }>(),
  {
    alternate: undefined,
    inUse: false,
    editable: false,
    candidates: () => [],
    saving: false,
    quantity: null,
    unit: null,
    mountPosition: null,
    notes: null,
  },
);

const emit = defineEmits<{
  remove: [part: Part];
  add: [partId: number];
  setInUse: [inUse: boolean];
}>();

const { t } = useI18n();

const picking = ref(false);
const selected = ref(0);

// Emits `add` either way: the route treats a post as "set", and replaces.
function confirmSet() {
  if (!selected.value) return;
  emit('add', selected.value);
  cancelPick();
}

function cancelPick() {
  picking.value = false;
  selected.value = 0;
}
</script>
