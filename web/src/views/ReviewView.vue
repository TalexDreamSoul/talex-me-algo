<script setup>
import { computed } from 'vue';
import { TxCard } from '@talex-touch/tuffex/card';
import { TxDataTable } from '@talex-touch/tuffex/data-table';
import { TxEmptyState } from '@talex-touch/tuffex/empty-state';
import { TxTag } from '@talex-touch/tuffex/tag';
import { TxFlex } from '@talex-touch/tuffex/flex';
import { DIFF_COLOR } from '../constants.js';

const props = defineProps({ data: { type: Object, required: true } });
const emit = defineEmits(['pick']);

const rows = computed(() =>
  props.data.problems
    .filter((p) => p.dueOn)
    .map((p) => ({
      ...p,
      due: p.dueOn,
      lateDays: p.overdue ? daysBetween(p.dueOn, props.data.today) : 0,
    }))
    .sort((a, b) => a.due.localeCompare(b.due)),
);

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

const columns = [
  { key: 'id', title: '#', width: 60 },
  { key: 'title', title: '题目', auto: true },
  { key: 'difficulty', title: '难度', width: 90 },
  { key: 'due', title: '到期', width: 140, sorter: (a, b) => a.due.localeCompare(b.due) },
  { key: 'reps', title: '轮次', width: 80, align: 'right' },
  { key: 'lapses', title: '失手', width: 80, align: 'right' },
  { key: 'pattern', title: '模板', width: 160 },
];
</script>

<template>
  <TxEmptyState
    v-if="!rows.length"
    variant="no-data"
    surface="card"
    title="还没有复习排期"
    description="做完第一道题后跑 algo submit，系统会自动排下次复习。"
  />

  <TxCard v-else background="mask" style="padding: 0">
    <TxDataTable
      :columns="columns"
      :data="rows"
      row-key="id"
      hover
      interactive-rows
      :default-sort="{ key: 'due', order: 'asc' }"
      @row-click="({ row }) => emit('pick', row.id)"
    >
      <template #cell-difficulty="{ row }">
        <TxTag :label="row.difficulty" :color="DIFF_COLOR[row.difficulty]" variant="soft" />
      </template>
      <template #cell-due="{ row }">
        <TxFlex :gap="6" align="center">
          <span>{{ row.due }}</span>
          <TxTag
            v-if="row.overdue"
            :label="row.lateDays > 0 ? `逾期 ${row.lateDays} 天` : '今天'"
            color="var(--tx-color-danger)"
            variant="soft"
          />
        </TxFlex>
      </template>
      <template #cell-lapses="{ row }">
        <span :style="{ color: row.lapses ? 'var(--tx-color-danger)' : 'inherit' }">
          {{ row.lapses }}
        </span>
      </template>
      <template #cell-pattern="{ row }">
        <TxTag v-if="row.pattern" :label="row.pattern" variant="plain" />
        <span v-else style="color: var(--tx-text-color-secondary)">—</span>
      </template>
    </TxDataTable>
  </TxCard>
</template>
