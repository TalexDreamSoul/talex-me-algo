<script setup>
import { computed, ref } from 'vue';
import { TxStack } from '@talex-touch/tuffex/stack';
import { TxFlex } from '@talex-touch/tuffex/flex';
import { TxCard } from '@talex-touch/tuffex/card';
import { TxCollapse, TxCollapseItem } from '@talex-touch/tuffex/collapse';
import { TxProgressBar } from '@talex-touch/tuffex/progress-bar';
import { TxTag } from '@talex-touch/tuffex/tag';
import { TxStatCard } from '@talex-touch/tuffex/stat-card';
import { TxSearchInput } from '@talex-touch/tuffex/search-input';
import { TxFilterChips } from '@talex-touch/tuffex/filter-chips';
import { DIFF_COLOR, STATUS_LABEL, STATUS_COLOR } from '../constants.js';

const props = defineProps({ data: { type: Object, required: true } });
const emit = defineEmits(['pick']);

const keyword = ref('');
const filter = ref('all');

const filters = computed(() => {
  const all = props.data.problems;
  return [
    { value: 'all', label: '全部', count: all.length },
    { value: 'todo', label: '未开始', count: all.filter((p) => !p.started).length },
    { value: 'started', label: '已建立', count: all.filter((p) => p.started).length },
    { value: 'due', label: '待复习', count: all.filter((p) => p.overdue).length },
  ];
});

const topicName = computed(() =>
  Object.fromEntries(props.data.topics.map((t) => [t.slug, t.name])),
);

const visible = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return props.data.problems.filter((p) => {
    if (kw && !p.title.toLowerCase().includes(kw) && !p.id.includes(kw)) return false;
    if (filter.value === 'todo' && p.started) return false;
    if (filter.value === 'started' && !p.started) return false;
    if (filter.value === 'due' && !p.overdue) return false;
    return true;
  });
});

const groups = computed(() => {
  const map = new Map();
  for (const p of visible.value) {
    if (!map.has(p.topic)) map.set(p.topic, []);
    map.get(p.topic).push(p);
  }
  return [...map].map(([topic, list]) => {
    const all = props.data.problems.filter((p) => p.topic === topic);
    const started = all.filter((p) => p.started).length;
    const mastered = all.filter((p) => p.status === 'mastered').length;
    return {
      topic,
      name: topicName.value[topic] ?? topic,
      list,
      started,
      mastered,
      total: all.length,
      percent: Math.round((started / all.length) * 100),
    };
  });
});

const stats = computed(() => {
  const all = props.data.problems;
  return {
    total: all.length,
    started: all.filter((p) => p.started).length,
    mastered: all.filter((p) => p.status === 'mastered').length,
    due: all.filter((p) => p.overdue).length,
  };
});

const masteredPercent = computed(() =>
  stats.value.started ? Math.round((stats.value.mastered / stats.value.started) * 100) : 0,
);
/** 待复习占已建立的比例 —— 满格意味着欠账全在等你 */
const duePercent = computed(() =>
  stats.value.started ? Math.round((stats.value.due / stats.value.started) * 100) : 0,
);
</script>

<template>
  <TxFlex :gap="12" wrap>
    <TxStatCard
      :value="stats.started"
      label="已建立"
      icon-class="i-carbon-document-add"
      variant="progress"
      :progress="Math.round((stats.started / stats.total) * 100)"
      :meta="`路线共 ${stats.total} 题`"
      style="flex: 1; min-width: 210px"
    />
    <TxStatCard
      :value="stats.mastered"
      label="已掌握"
      icon-class="i-carbon-checkmark-filled"
      variant="progress"
      :progress="masteredPercent"
      :meta="`占已做的 ${masteredPercent}%`"
      style="flex: 1; min-width: 210px"
    />
    <TxStatCard
      :value="stats.due"
      label="待复习"
      icon-class="i-carbon-repeat"
      variant="progress"
      :progress="duePercent"
      :meta="stats.due ? '去「复习」页处理' : '暂时没有到期的'"
      style="flex: 1; min-width: 210px"
    />
  </TxFlex>

  <TxFlex :gap="12" align="center" wrap>
    <TxSearchInput v-model="keyword" placeholder="搜题号或标题" style="flex: 1; min-width: 220px" />
    <TxFilterChips v-model="filter" :items="filters" />
  </TxFlex>

  <TxCollapse accordion>
    <TxCollapseItem
      v-for="g in groups"
      :key="g.topic"
      :name="g.topic"
      :title="g.name"
    >
      <template #title>
        <TxFlex :gap="12" align="center" style="width: 100%">
          <strong>{{ g.name }}</strong>
          <TxTag :label="`${g.started}/${g.total}`" variant="plain" />
          <TxProgressBar
            :percentage="g.percent"
            :show-text="false"
            style="flex: 1; max-width: 200px"
          />
        </TxFlex>
      </template>

      <TxFlex :gap="8" wrap>
        <TxCard
          v-for="p in g.list"
          :key="p.id"
          background="mask"
          clickable
          style="width: 250px; padding: 10px 12px"
          @click="emit('pick', p.id)"
        >
          <TxFlex :gap="8" align="center">
            <TxTag :label="p.id" variant="plain" />
            <span
              :style="{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                opacity: p.started ? 1 : 0.55,
              }"
              :title="p.title"
            >{{ p.title }}</span>
            <TxTag :label="p.difficulty" :color="DIFF_COLOR[p.difficulty]" variant="soft" />
          </TxFlex>
          <TxFlex v-if="p.started || p.overdue" :gap="6" align="center" style="margin-top: 7px">
            <TxTag
              v-if="p.overdue"
              label="待复习"
              color="var(--tx-color-danger)"
              variant="soft"
            />
            <TxTag
              v-else-if="p.status !== 'new'"
              :label="STATUS_LABEL[p.status]"
              :color="STATUS_COLOR[p.status]"
              variant="soft"
            />
            <TxTag v-if="p.pattern" :label="p.pattern" variant="plain" />
          </TxFlex>
        </TxCard>
      </TxFlex>
    </TxCollapseItem>
  </TxCollapse>
</template>
